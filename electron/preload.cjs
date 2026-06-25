const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('powerStation', {
  platform: process.platform,
  runtime: 'electron',
  app: {
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  },
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    pickFile: () => ipcRenderer.invoke('models:pickFile'),
    pickFolder: () => ipcRenderer.invoke('models:pickFolder'),
    select: (filePath) => ipcRenderer.invoke('models:select', filePath),
    getSelected: () => ipcRenderer.invoke('models:getSelected'),
    remove: (filePath) => ipcRenderer.invoke('models:remove', filePath),
    deleteFile: (filePath) => ipcRenderer.invoke('models:deleteFile', filePath),
    reveal: (filePath) => ipcRenderer.invoke('models:reveal', filePath),
    download: (uri) => ipcRenderer.invoke('models:download', uri),
    onDownloadProgress: (callback) => subscribe('models:downloadProgress', callback),
    onDownloadDone: (callback) => subscribe('models:downloadDone', callback),
    onDownloadError: (callback) => subscribe('models:downloadError', callback),
  },
  chat: {
    send: (payload) => ipcRenderer.invoke('chat:send', payload),
    stop: (requestId) => ipcRenderer.invoke('chat:stop', requestId),
    reset: () => ipcRenderer.invoke('chat:reset'),
    unload: () => ipcRenderer.invoke('chat:unload'),
    onToken: (callback) => subscribe('chat:token', callback),
    onDone: (callback) => subscribe('chat:done', callback),
    onError: (callback) => subscribe('chat:error', callback),
    onStatus: (callback) => subscribe('chat:status', callback),
  },
  telemetry: {
    onUpdate: (callback) => subscribe('telemetry:update', callback),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
  },
  device: {
    info: () => ipcRenderer.invoke('device:info'),
  },
  updates: {
    getState: () => ipcRenderer.invoke('updates:getState'),
    check: () => ipcRenderer.invoke('updates:check'),
    installLatest: () => ipcRenderer.invoke('updates:installLatest'),
    onState: (callback) => subscribe('updates:state', callback),
  },
})
