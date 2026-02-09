const { contextBridge, ipcRenderer } = require('electron');

// 暴露一个受限的 API 给 BrowserView 中的页面，避免开启 nodeIntegration
contextBridge.exposeInMainWorld('electronAPI', {
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    once: (channel, listener) => ipcRenderer.once(channel, (event, ...args) => listener(event, ...args)),
    on: (channel, listener) => {
        const wrapped = (event, ...args) => listener(event, ...args);
        ipcRenderer.on(channel, wrapped);
        return () => ipcRenderer.removeListener(channel, wrapped);
    }
});
