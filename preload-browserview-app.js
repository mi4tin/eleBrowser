const { contextBridge, ipcRenderer } = require('electron');

// 标签页内点击网页时通知主进程，用于关闭书签下拉、地址栏历史浮层（主界面收不到这些点击）
window.addEventListener(
    'mousedown',
    () => {
        try {
            ipcRenderer.send('dismiss-overlays-from-browser-view');
        } catch (_e) {
            /* ignore */
        }
    },
    true
);

// 暴露一个受限的 API 给 BrowserView 中的页面，contextIsolation必须为true
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
