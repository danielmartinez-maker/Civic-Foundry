import { contextBridge, ipcRenderer } from 'electron';

function call(channel, ...args) {
  const response = ipcRenderer.sendSync(channel, ...args);
  if (!response || response.ok !== true) {
    const message = response && typeof response.error === 'string' ? response.error : `native IPC failed: ${channel}`;
    throw new Error(message);
  }
  return response.value;
}

contextBridge.exposeInMainWorld('__CIVIC_NATIVE_DESKTOP__', Object.freeze({
  available: () => call('civic-native:available'),
  createEngine: (config = {}) => call('civic-native:create', config),
  destroyEngine: () => call('civic-native:destroy'),
  submitCommands: (commandsJson) => call('civic-native:submit', commandsJson),
  step: (ticks) => call('civic-native:step', ticks),
  loadV9: (saveJson) => call('civic-native:load-v9', saveJson),
  saveV9: () => call('civic-native:save-v9'),
  getSnapshot: () => call('civic-native:snapshot'),
  getEvents: () => call('civic-native:events'),
  getDomainHash: (domain) => call('civic-native:domain-hash', domain),
}));
