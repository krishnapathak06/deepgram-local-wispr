const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  wispr: {
    getStatus: () => ipcRenderer.invoke('wispr:getStatus'),
    start: () => ipcRenderer.invoke('wispr:start'),
    stop: () => ipcRenderer.invoke('wispr:stop'),
    getConfig: () => ipcRenderer.invoke('wispr:getConfig'),
    saveConfig: (config) => ipcRenderer.invoke('wispr:saveConfig', config),
    getModels: () => ipcRenderer.invoke('wispr:getModels'),
    downloadModel: (modelId) => ipcRenderer.invoke('wispr:downloadModel', modelId),
    getAudioDevices: () => ipcRenderer.invoke('wispr:getAudioDevices'),
    onDownloadLog: (callback) => {
      ipcRenderer.on('wispr:downloadLog', (event, data) => callback(data));
    }
  },
  transcribe: {
    start: (filePaths, options) => ipcRenderer.invoke('transcribe:start', { filePaths, options }),
    getHistory: () => ipcRenderer.invoke('transcribe:getHistory'),
    cancel: (jobId) => ipcRenderer.invoke('transcribe:cancel', jobId),
    onProgress: (callback) => {
      ipcRenderer.on('transcribe:progress', (event, data) => callback(data));
    },
    onStatus: (callback) => {
      ipcRenderer.on('transcribe:status', (event, data) => callback(data));
    },
    onJobComplete: (callback) => {
      ipcRenderer.on('transcribe:complete', (event, data) => callback(data));
    },
    onJobError: (callback) => {
      ipcRenderer.on('transcribe:error', (event, data) => callback(data));
    }
  },
  dialog: {
    selectFiles: () => ipcRenderer.invoke('dialog:selectFiles'),
    saveFile: (defaultName, content) => ipcRenderer.invoke('dialog:saveFile', { defaultName, content })
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:writeText', text)
  },
  system: {
    openFolder: (dirPath) => ipcRenderer.invoke('system:openFolder', dirPath),
    isElectron: true
  },
  hud: {
    onState: (callback) => {
      ipcRenderer.on('hud:state', (event, data) => callback(data));
    },
    changeCorner: (corner) => ipcRenderer.invoke('hud:setCorner', corner),
    testState: (state) => ipcRenderer.invoke('hud:testState', state)
  },
  dictation: {
    toggle: () => ipcRenderer.invoke('dictation:toggle')
  }
});

// Also expose electronAPI for hud.js
contextBridge.exposeInMainWorld('electronAPI', {
  onHudState: (callback) => {
    ipcRenderer.on('hud:state', (event, data) => callback(data));
  }
});
