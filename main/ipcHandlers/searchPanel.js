module.exports = function registerSearchPanelIpcHandlers(deps) {
    const {
        ipcMain,
        BrowserWindow,
        getMainWindow,
        getSearchPanelView,
        createSearchPanel,
        destroySearchPanel,
        getBrowserViews,
        getLastActiveTabId
    } = deps;

    ipcMain.on('show-search-panel', (event) => {
        console.log('收到显示搜索面板请求');
        const window = BrowserWindow.fromWebContents(event.sender) || getMainWindow();
        if (!window) return;
        try {
            createSearchPanel(window);
            setTimeout(() => {
                const searchPanelView = getSearchPanelView();
                if (searchPanelView && searchPanelView.webContents && !searchPanelView.webContents.isDestroyed()) {
                    searchPanelView.webContents.focus();
                    searchPanelView.webContents.send('focus-input');
                }
            }, 200);
        } catch (e) {
            console.error('显示搜索面板失败:', e);
        }
    });

    ipcMain.on('show-search-panel-with-text', (event, text) => {
        const window = BrowserWindow.fromWebContents(event.sender) || getMainWindow();
        if (!window) return;
        try {
            createSearchPanel(window);
            setTimeout(() => {
                const searchPanelView = getSearchPanelView();
                if (searchPanelView && searchPanelView.webContents && !searchPanelView.webContents.isDestroyed()) {
                    searchPanelView.webContents.send('set-search-text', text || '');
                    searchPanelView.webContents.send('focus-input');
                }
            }, 300);
        } catch (e) {
            console.error('显示搜索面板并设置文本失败:', e);
        }
    });

    ipcMain.on('search-panel-find', (event, payload) => {
        try {
            const browserViews = getBrowserViews();
            const lastActiveTabId = getLastActiveTabId();
            console.log('收到搜索面板查找请求:', payload, '最后活跃标签ID:', lastActiveTabId);
            const targetView = browserViews.get(lastActiveTabId) || Array.from(browserViews.values())[0];
            if (!targetView || !targetView.webContents) return;

            const wc = targetView.webContents;
            const options = { forward: payload.forward, findNext: payload.findNext, matchCase: false };

            const foundListener = (e, result) => {
                console.log('found-in-page 事件:', result);
                const foundPayload = {
                    matches: (result && typeof result.matches === 'number') ? result.matches : 0,
                    activeMatchOrdinal: (result && typeof result.activeMatchOrdinal === 'number') ? result.activeMatchOrdinal : 0,
                    final: !!(result && result.final)
                };
                const searchPanelView = getSearchPanelView();
                if (searchPanelView && searchPanelView.webContents && !searchPanelView.webContents.isDestroyed()) {
                    searchPanelView.webContents.send('found-in-page', foundPayload);
                }
                if (foundPayload.final) {
                    try { wc.removeAllListeners('found-in-page'); } catch (e) { console.log('移除 found-in-page 监听器失败2:', e); }
                }
            };

            try {
                wc.removeAllListeners('found-in-page');
            } catch (e) {
                console.log('移除 found-in-page 监听器失败:', e);
            }

            wc.on('found-in-page', foundListener);

            console.log('执行 findInPage.options:', options);
            const id = wc.findInPage((payload && payload.text) || '', options);
            console.log('findInPage 执行结果:', id);
        } catch (e) {
            console.error('处理搜索请求失败:', e);
        }
    });

    ipcMain.on('search-panel-close', (event) => {
        const window = BrowserWindow.fromWebContents(event.sender) || getMainWindow();
        destroySearchPanel(window);
    });
};
