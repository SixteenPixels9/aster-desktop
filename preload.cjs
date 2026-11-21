const { contextBridge, ipcRenderer } = require('electron');

const methods = new Set([
  'initial', 'chat-state', 'chat-connect', 'chat-disconnect', 'chat-models', 'chat-send',
  'chat-stop', 'open-chatgpt', 'open-web', 'open-app', 'open-file', 'edit-file',
  'save-file', 'capture-sources', 'select-source', 'record-start', 'record-chunk',
  'record-finish', 'recordings', 'open-recording', 'settings-save', 'float'
]);
const events = new Set(['chat-delta', 'focus-input']);

contextBridge.exposeInMainWorld('aster', {
  invoke(method, ...args) {
    if (!methods.has(method)) throw new Error('Unknown Aster operation.');
    return ipcRenderer.invoke('aster:' + method, ...args);
  },
  on(event, callback) {
    if (!events.has(event)) throw new Error('Unknown Aster event.');
    ipcRenderer.on('aster:' + event, (_event, value) => callback(value));
  }
});
