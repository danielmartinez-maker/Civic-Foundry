import { contextBridge, ipcRenderer } from 'electron';

function call(method, handleId, ...args) {
  const response = ipcRenderer.sendSync('civic-native:call', {
    method,
    handleId,
    args,
  });
  if (!response?.ok) throw new Error(response?.error ?? 'native engine IPC failed');
  return response.value;
}

if (ipcRenderer.sendSync('civic-native:available')) {
  const addon = Object.freeze({
    createEngine: (config) => Object.freeze({ id: call('createEngine', null, config) }),
    destroyEngine: (handle) => call('destroyEngine', handle.id),
    submitCommands: (handle, commandsJson) =>
      call('submitCommands', handle.id, commandsJson),
    step: (handle, ticks) => call('step', handle.id, ticks),
    loadV9: (handle, saveJson) => call('loadV9', handle.id, saveJson),
    saveV9: (handle) => call('saveV9', handle.id),
    getSnapshot: (handle) => call('getSnapshot', handle.id),
    getEvents: (handle) => call('getEvents', handle.id),
    getDomainHash: (handle, domain) => {
      const result = call('getDomainHash', handle.id, domain);
      return Object.freeze({ ...result, value: BigInt(result.value) });
    },
    createWorld: (handle, requestJson) =>
      call('createWorld', handle.id, requestJson),
    restoreWorld: (handle, snapshotJson) =>
      call('restoreWorld', handle.id, snapshotJson),
    createLegacyWorld: (handle, requestJson) =>
      call('createLegacyWorld', handle.id, requestJson),
    runDesignStorm: (handle, requestJson) =>
      call('runDesignStorm', handle.id, requestJson),
    rebuildUrbanLegacy: (handle, requestJson) =>
      call('rebuildUrbanLegacy', handle.id, requestJson),
    restoreUrbanState: (handle, snapshotJson) =>
      call('restoreUrbanState', handle.id, snapshotJson),
    getUrbanSnapshot: (handle) => call('getUrbanSnapshot', handle.id),
  });
  contextBridge.exposeInMainWorld('civicNativeAddon', addon);
}
