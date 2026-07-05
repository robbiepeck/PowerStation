const { contextBridge, ipcRenderer, webUtils } = require('electron')

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
  hardware: {
    profile: () => ipcRenderer.invoke('hardware:profile'),
  },
  catalog: {
    get: () => ipcRenderer.invoke('catalog:get'),
    refresh: () => ipcRenderer.invoke('catalog:refresh'),
    recommend: (intent) => ipcRenderer.invoke('catalog:recommend', intent),
    fitCheck: (payload) => ipcRenderer.invoke('fit:check', payload),
  },
  onboarding: {
    get: () => ipcRenderer.invoke('onboarding:get'),
    complete: (payload) => ipcRenderer.invoke('onboarding:complete', payload),
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
    onBenchmarking: (callback) => subscribe('models:benchmarking', callback),
  },
  bench: {
    run: (modelPath) => ipcRenderer.invoke('bench:run', modelPath),
    results: () => ipcRenderer.invoke('bench:results'),
  },
  chats: {
    list: () => ipcRenderer.invoke('chats:list'),
    get: (id) => ipcRenderer.invoke('chats:get', id),
    save: (payload) => ipcRenderer.invoke('chats:save', payload),
    rename: (id, title) => ipcRenderer.invoke('chats:rename', id, title),
    pin: (id, pinned) => ipcRenderer.invoke('chats:pin', id, pinned),
    delete: (id) => ipcRenderer.invoke('chats:delete', id),
    deleteAll: () => ipcRenderer.invoke('chats:deleteAll'),
    reveal: () => ipcRenderer.invoke('chats:reveal'),
    search: (query) => ipcRenderer.invoke('chats:search', query),
    export: (id) => ipcRenderer.invoke('chats:export', id),
    exportAudit: (id) => ipcRenderer.invoke('chats:exportAudit', id),
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    save: (payload) => ipcRenderer.invoke('skills:save', payload),
    delete: (slug) => ipcRenderer.invoke('skills:delete', slug),
    setMode: (payload) => ipcRenderer.invoke('skills:setMode', payload),
    reveal: () => ipcRenderer.invoke('skills:reveal'),
    gallery: () => ipcRenderer.invoke('skills:gallery'),
    install: (id) => ipcRenderer.invoke('skills:install', id),
  },
  connectors: {
    get: () => ipcRenderer.invoke('connectors:get'),
    add: (payload) => ipcRenderer.invoke('connectors:add', payload),
    pickFolder: () => ipcRenderer.invoke('app:pickFolder'),
  },
  ollama: {
    status: () => ipcRenderer.invoke('ollama:status'),
    import: (name) => ipcRenderer.invoke('ollama:import', name),
  },
  lmstudio: {
    status: () => ipcRenderer.invoke('lmstudio:status'),
    import: (path) => ipcRenderer.invoke('lmstudio:import', path),
  },
  files: {
    pickAndExtract: () => ipcRenderer.invoke('files:pickAndExtract'),
    extract: (paths) => ipcRenderer.invoke('files:extract', paths),
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
  rag: {
    index: (folder) => ipcRenderer.invoke('rag:index', folder),
    info: (folderId) => ipcRenderer.invoke('rag:info', folderId),
    list: () => ipcRenderer.invoke('rag:list'),
    delete: (folderId) => ipcRenderer.invoke('rag:delete', folderId),
    reindex: (folderId) => ipcRenderer.invoke('rag:reindex', folderId),
    onIndexProgress: (callback) => subscribe('rag:indexProgress', callback),
  },
  whatsNew: {
    get: () => ipcRenderer.invoke('app:whatsNew'),
    seen: () => ipcRenderer.invoke('app:whatsNewSeen'),
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
    onAdmission: (callback) => subscribe('chat:admission', callback),
    onToolCall: (callback) => subscribe('chat:toolCall', callback),
    onToolResult: (callback) => subscribe('chat:toolResult', callback),
    onSources: (callback) => subscribe('chat:sources', callback),
    onCompacted: (callback) => subscribe('chat:compacted', callback),
  },
  agent: {
    respondPermission: (payload) => ipcRenderer.invoke('agent:permissionResponse', payload),
    onPermissionRequest: (callback) => subscribe('agent:permissionRequest', callback),
    onPermissionExpired: (callback) => subscribe('agent:permissionExpired', callback),
  },
  mcp: {
    statuses: () => ipcRenderer.invoke('mcp:statuses'),
    toolInfo: () => ipcRenderer.invoke('mcp:toolInfo'),
    reconnect: (serverId) => ipcRenderer.invoke('mcp:reconnect', serverId),
    onStatus: (callback) => subscribe('mcp:status', callback),
  },
  permissions: {
    get: () => ipcRenderer.invoke('permissions:get'),
    set: (payload) => ipcRenderer.invoke('permissions:set', payload),
  },
  runtimeEvents: {
    onEvent: (callback) => subscribe('runtime:event', callback),
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
