const { contextBridge, ipcRenderer } = require('electron');

// 向渲染进程暴露安全的 API
contextBridge.exposeInMainWorld('electronAPI', {
    // 窗口控制功能
    minimize: () => ipcRenderer.send('window-control', 'minimize'),
    maximize: () => ipcRenderer.send('window-control', 'maximize'),
    close: () => ipcRenderer.send('window-control', 'close'),
    
    // 监听窗口状态变化
    onWindowStateChange: (callback) => {
        ipcRenderer.on('window-state-changed', (event, state) => {
            callback(state);
        });
    }
});

console.log('自定义标题栏预加载脚本已加载');