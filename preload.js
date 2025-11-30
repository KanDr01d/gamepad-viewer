// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onChangeSkin: (callback) => ipcRenderer.on('set-skin', (_, skin) => callback && callback(skin)),
  onChangeColor: (callback) => ipcRenderer.on('change-color', (_, color) => callback && callback(color)),
  onChangeBackground: (callback) => ipcRenderer.on('change-background', (_, bg) => callback && callback(bg)),
  onToggleTriggers: (callback) => ipcRenderer.on('toggle-triggers', (_, on) => callback && callback(on)),
  onDebug: (callback) => ipcRenderer.on('set-debug', (_, on) => callback && callback(on)),
  debugLog: (line) => ipcRenderer.send('debug-log', line),
});

contextBridge.exposeInMainWorld('gamepadBridge', {
  setSkin: (skin) => ipcRenderer.send('set-skin', skin),
  setColor: (color) => ipcRenderer.send('set-color', color),
  setBackground: (bg) => ipcRenderer.send('set-background', bg),
  toggleTriggers: (on) => ipcRenderer.send('toggle-triggers', on)
});