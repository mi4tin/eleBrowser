module.exports = function registerAppIpcHandlers(deps) {
    const {
        ipcMain,
        BrowserWindow,
        session,
        getBrowserViews,
        createBrowserView,
        activateBrowserView,
        closeBrowserView,
        reloadBrowserView,
        reloadBrowserViewIgnoringCache,
        getMainWindow,
        newWindow
    } = deps;

    ipcMain.handle('create-browser-view', (event, url) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            throw new Error('无法获取窗口实例');
        }
        return createBrowserView(window, url);
    });

    ipcMain.handle('activate-browser-view', (event, tabId) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            throw new Error('无法获取窗口实例');
        }
        activateBrowserView(window, tabId);
    });

    ipcMain.handle('close-browser-view', (event, tabId) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            throw new Error('无法获取窗口实例');
        }
        closeBrowserView(window, tabId);
    });

    ipcMain.handle('browser-view-go-back', (event, tabId) => {
        const view = getBrowserViews().get(tabId);
        if (view && view.webContents.navigationHistory.canGoBack()) {
            view.webContents.navigationHistory.goBack();
            return true;
        }
        return false;
    });

    ipcMain.handle('browser-view-go-forward', (event, tabId) => {
        const view = getBrowserViews().get(tabId);
        if (view && view.webContents.navigationHistory.canGoForward()) {
            view.webContents.navigationHistory.goForward();
            return true;
        }
        return false;
    });

    ipcMain.handle('browser-view-reload', (event, tabId) => {
        return reloadBrowserView(tabId);
    });

    ipcMain.handle('browser-view-stop-loading', (event, tabId) => {
        const view = getBrowserViews().get(tabId);
        if (view) {
            view.webContents.stop();
            return true;
        }
        return false;
    });

    ipcMain.handle('clear-browser-cache', async () => {
        try {
            await session.defaultSession.clearCache();
            await session.defaultSession.clearStorageData({ storages: ['cookies'] });
            console.log('清除浏览缓存和Cookie成功');
            return { ok: true };
        } catch (e) {
            console.error('清除浏览缓存失败:', e);
            return { ok: false, error: (e && e.message) || String(e) };
        }
    });

    ipcMain.handle('browser-view-load-url', (event, tabId, url) => {
        const view = getBrowserViews().get(tabId);
        if (view) {
            view.webContents.loadURL(url);
            return true;
        }
        return false;
    });

    ipcMain.handle('browser-view-get-url', (event, tabId) => {
        const view = getBrowserViews().get(tabId);
        if (view) {
            return view.webContents.getURL();
        }
        return '';
    });

    ipcMain.handle('browser-view-get-title', (event, tabId) => {
        const view = getBrowserViews().get(tabId);
        if (view) {
            return view.webContents.getTitle();
        }
        return '';
    });

    ipcMain.handle('browser-view-can-go-back', (event, tabId) => {
        const view = getBrowserViews().get(tabId);
        if (view) {
            return view.webContents.navigationHistory.canGoBack();
        }
        return false;
    });

    ipcMain.handle('browser-view-can-go-forward', (event, tabId) => {
        const view = getBrowserViews().get(tabId);
        if (view) {
            return view.webContents.navigationHistory.canGoForward();
        }
        return false;
    });

    ipcMain.handle('execute-javascript-in-browser-view', (event, tabId, code) => {
        const view = getBrowserViews().get(tabId);
        if (view && view.webContents) {
            return view.webContents.executeJavaScript(code);
        }
        return Promise.resolve();
    });

    ipcMain.on('open-bookmark', (event, url) => {
        console.log('收到打开书签请求:', url);
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            console.log('发送到主窗口:', url);
            mainWindow.webContents.send('open-url-in-new-tab', url);
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
            return;
        }

        console.log('主窗口不存在，创建新窗口');
        newWindow();
        const nextWindow = getMainWindow();
        if (nextWindow && !nextWindow.isDestroyed()) {
            nextWindow.webContents.once('did-finish-load', () => {
                const win = getMainWindow();
                if (win && !win.isDestroyed()) {
                    console.log('主窗口加载完成，发送 URL:', url);
                    win.webContents.send('open-url-in-new-tab', url);
                }
            });
        }
    });

    ipcMain.on('open-url-in-new-tab', (event, url) => {
        console.log('收到打开URL请求:', url);
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            console.log('发送到主窗口:', url);
            mainWindow.webContents.send('open-url-in-new-tab', url);
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
            return;
        }

        console.log('主窗口不存在，创建新窗口');
        newWindow();
        const nextWindow = getMainWindow();
        if (nextWindow && !nextWindow.isDestroyed()) {
            nextWindow.webContents.once('did-finish-load', () => {
                const win = getMainWindow();
                if (win && !win.isDestroyed()) {
                    console.log('主窗口加载完成，发送URL:', url);
                    win.webContents.send('open-url-in-new-tab', url);
                }
            });
        }
    });

    // 窗口控制IPC处理
    ipcMain.handle('window-minimize', (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
            window.minimize();
        }
    });

    ipcMain.handle('window-maximize', (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
            window.maximize();
        }
    });

    ipcMain.handle('window-unmaximize', (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
            window.unmaximize();
        }
    });

    ipcMain.handle('window-is-maximized', (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
            return window.isMaximized();
        }
        return false;
    });

    ipcMain.handle('window-close', (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
            window.close();
        }
    });
};
