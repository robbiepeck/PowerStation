const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('powerStationDesktop', {
  platform: process.platform,
  runtime: 'electron',
})
