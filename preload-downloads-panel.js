const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('downloadsPanel', {
    close: () => ipcRenderer.send('downloads-panel-close'),
    onListInit: (cb) => {
        const fn = (_e, list) => cb(list);
        ipcRenderer.on('downloads-list-init', fn);
        return () => ipcRenderer.removeListener('downloads-list-init', fn);
    },
    onItemUpdated: (cb) => {
        const fn = (_e, item) => cb(item);
        ipcRenderer.on('downloads-item-updated', fn);
        return () => ipcRenderer.removeListener('downloads-item-updated', fn);
    },
    onItemRemoved: (cb) => {
        const fn = (_e, id) => cb(id);
        ipcRenderer.on('downloads-item-removed', fn);
        return () => ipcRenderer.removeListener('downloads-item-removed', fn);
    },
    openUserDownloads: () => ipcRenderer.invoke('downloads-panel-open-user-dir'),
    revealItem: (id) => ipcRenderer.invoke('downloads-panel-reveal', id),
    openFile: (id) => ipcRenderer.invoke('downloads-panel-open-file', id),
    togglePause: (id) => ipcRenderer.invoke('downloads-item-toggle-pause', id),
    cancelDownload: (id) => ipcRenderer.invoke('downloads-item-cancel', id),
    showContextMenu: (id, x, y) =>
        ipcRenderer.invoke('downloads-item-context-menu', { id, x, y })
});
