const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (data) => ipcRenderer.invoke('save-config', data),
  fetchTimetable: (identifier) => ipcRenderer.invoke('fetch-timetable', identifier),
  setOpacity: (v) => ipcRenderer.send('set-opacity', v),
  setAlwaysOnTop: (f) => ipcRenderer.send('set-always-on-top', f),
  close: () => ipcRenderer.send('close-app'),
  minimize: () => ipcRenderer.send('minimize-app'),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  lmsLogin: () => ipcRenderer.invoke('lms-login'),
  lmsStatus: () => ipcRenderer.invoke('lms-status'),
  lmsRefresh: () => ipcRenderer.invoke('lms-refresh'),
  lmsOpen: (url) => ipcRenderer.send('lms-open', url),
  lmsDump: () => ipcRenderer.invoke('lms-dump'),
  setMini: (on) => ipcRenderer.send('set-mini', on),
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (on) => ipcRenderer.invoke('set-auto-start', on),
});
