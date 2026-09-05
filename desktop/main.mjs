import { app, BrowserWindow, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const nativeSessions = new Map();
let cachedNativeAddon;

function nativeAddonCandidates() {
  const candidates = [];
  if (process.env.CIVIC_NATIVE_ADDON) candidates.push(process.env.CIVIC_NATIVE_ADDON);
  if (process.resourcesPath) candidates.push(join(process.resourcesPath, 'native', 'civic_native.node'));
  candidates.push(
    join(root, 'cpp', 'build-msvc', 'Release', 'civic_native.node'),
    join(root, 'cpp', 'build-msvc', 'Debug', 'civic_native.node'),
    join(root, 'cpp', 'build', 'civic_native.node'),
    join(root, 'build', 'civic_native.node'),
  );
  return candidates;
}

function nativeAddon() {
  if (cachedNativeAddon) return cachedNativeAddon;
  const candidate = nativeAddonCandidates().find((path) => existsSync(path));
  if (!candidate) return undefined;
  cachedNativeAddon = require(candidate);
  return cachedNativeAddon;
}

function destroySession(senderId) {
  const session = nativeSessions.get(senderId);
  if (!session) return;
  try { session.addon.destroyEngine(session.handle); } finally { nativeSessions.delete(senderId); }
}

function sessionFor(event) {
  const session = nativeSessions.get(event.sender.id);
  if (!session) throw new Error('native engine session is not initialized');
  return session;
}

function registerSync(channel, operation) {
  ipcMain.on(channel, (event, ...args) => {
    try {
      event.returnValue = { ok: true, value: operation(event, ...args) };
    } catch (error) {
      event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

function registerNativeIpc() {
  registerSync('civic-native:available', () => nativeAddon() !== undefined);
  registerSync('civic-native:create', (event, config = {}) => {
    const addon = nativeAddon();
    if (!addon) throw new Error('civic native addon is unavailable; set CIVIC_NATIVE_ADDON or build cpp/civic_native');
    destroySession(event.sender.id);
    const handle = addon.createEngine(config);
    nativeSessions.set(event.sender.id, { addon, handle });
    event.sender.once('destroyed', () => destroySession(event.sender.id));
    return true;
  });
  registerSync('civic-native:destroy', (event) => { destroySession(event.sender.id); return true; });
  registerSync('civic-native:submit', (event, commandsJson) => {
    const session = sessionFor(event); session.addon.submitCommands(session.handle, commandsJson); return true;
  });
  registerSync('civic-native:step', (event, ticks) => {
    const session = sessionFor(event); session.addon.step(session.handle, ticks); return true;
  });
  registerSync('civic-native:load-v9', (event, saveJson) => {
    const session = sessionFor(event); session.addon.loadV9(session.handle, saveJson); return true;
  });
  registerSync('civic-native:save-v9', (event) => {
    const session = sessionFor(event); return session.addon.saveV9(session.handle);
  });
  registerSync('civic-native:snapshot', (event) => {
    const session = sessionFor(event); return session.addon.getSnapshot(session.handle);
  });
  registerSync('civic-native:events', (event) => {
    const session = sessionFor(event); return session.addon.getEvents(session.handle);
  });
  registerSync('civic-native:domain-hash', (event, domain) => {
    const session = sessionFor(event);
    const hash = session.addon.getDomainHash(session.handle, domain);
    return { ownership: hash.ownership, version: hash.version, value: hash.value.toString() };
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#11171b',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: join(root, 'desktop', 'preload.mjs'),
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  void window.loadFile(join(root, 'dist', 'index.html'));
}

app.enableSandbox();
app.whenReady().then(() => {
  registerNativeIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  for (const senderId of [...nativeSessions.keys()]) destroySession(senderId);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
