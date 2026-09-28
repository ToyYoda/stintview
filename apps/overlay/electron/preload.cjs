const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stintview', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  onEditMode: (cb) => ipcRenderer.on('edit-mode', (_e, on) => cb(on)),
});
