import { app, BrowserWindow, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const handles = new Map();
let nextHandleId = 1;

function nativeAddonCandidates() {
  return [
    process.env.CIVIC_NATIVE_ADDON,
    join(root, 'cpp', 'build-msvc', 'Release', 'civic_native.node'),
    join(root, 'cpp', 'build-msvc', 'Debug', 'civic_native.node'),
    join(root, 'cpp', 'build', 'civic_native.node'),
    join(root, 'cpp', 'build-clang', 'civic_native.node'),
    app.isPackaged ? join(process.resourcesPath, 'native', 'civic_native.node') : undefined,
  ].filter(Boolean);
}

function loadNativeAddon() {
  const errors = [];
  for (const candidate of nativeAddonCandidates()) {
    if (!existsSync(candidate)) continue;
    try {
      return require(candidate);
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (app.isPackaged || process.env.CIVIC_REQUIRE_NATIVE === '1') {
    throw new Error(
      errors.length > 0
        ? `Civic Foundry native addon failed to load: ${errors.join('; ')}`
        : 'Civic Foundry native addon was not found',
    );
  }
  return null;
}

const nativeAddon = loadNativeAddon();

function requireHandle(id) {
  const handle = handles.get(id);
  if (!handle) throw new Error(`unknown native engine handle: ${String(id)}`);
  return handle;
}

function registerNativeIpc() {
  ipcMain.on('civic-native:available', (event) => {
    event.returnValue = nativeAddon !== null;
  });
  ipcMain.on('civic-native:call', (event, request) => {
    try {
      if (!nativeAddon) throw new Error('native engine addon is unavailable');
      const { method, handleId, args = [] } = request ?? {};
      if (typeof method !== 'string') throw new Error('native method is required');
      let value;
      if (method === 'createEngine') {
        const handle = nativeAddon.createEngine(args[0]);
        const id = nextHandleId++;
        handles.set(id, handle);
        value = id;
      } else if (method === 'destroyEngine') {
        const handle = requireHandle(handleId);
        nativeAddon.destroyEngine(handle);
        handles.delete(handleId);
      } else {
        const allowed = new Set([
          'submitCommands',
          'step',
          'loadV9',
          'saveV9',
          'getSnapshot',
          'getEvents',
          'getDomainHash',
          'createWorld',
          'restoreWorld',
          'createLegacyWorld',
          'runDesignStorm',
          'rebuildUrbanLegacy',
          'restoreUrbanState',
          'applyUrbanCommand',
          'getUrbanSnapshot',
        ]);
        if (!allowed.has(method)) throw new Error(`unsupported native method: ${method}`);
        const handle = requireHandle(handleId);
        value = nativeAddon[method](handle, ...args);
        if (method === 'getDomainHash' && value && typeof value.value === 'bigint') {
          value = { ...value, value: value.value.toString() };
        }
      }
      event.returnValue = { ok: true, value };
    } catch (error) {
      event.returnValue = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
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

app.on('window-all-closed', () => {
  for (const [id, handle] of handles) {
    try {
      nativeAddon?.destroyEngine(handle);
    } finally {
      handles.delete(id);
    }
  }
  if (process.platform !== 'darwin') app.quit();
});
