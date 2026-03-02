const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // 发送历史记录选择结果
    invoke: (channel, ...args) => {
        //只允许特定的IPC通道
        const validChannels = [
            'history-autocomplete-selected',
            'history-autocomplete-hide'
        ];
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, ...args);
        }
    },
    
    //接收消息
    on: (channel, func) => {
        const validChannels = [
            'update-history-autocomplete',
            'history-autocomplete-keyboard'
        ];
        if (validChannels.includes(channel)) {
            // 从主进程接收消息
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    }
});