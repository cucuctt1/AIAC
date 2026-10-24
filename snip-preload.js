const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snip', {
  onStart: callback => ipcRenderer.once('snip-start', (_event, payload) => callback(payload)),
  screenChanged: index => ipcRenderer.send('snip-screen-change', index),
  complete: rect => ipcRenderer.send('snip-complete', rect),
  cancel: () => ipcRenderer.send('snip-cancel')
});
