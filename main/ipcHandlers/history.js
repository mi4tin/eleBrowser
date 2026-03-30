module.exports = function registerHistoryIpcHandlers(deps) {
    const {
        ipcMain,
        fs,
        historyFilePath,
        getMainWindow,
        showHistoryAutocomplete,
        hideHistoryAutocomplete,
        getHistoryAutocompleteView
    } = deps;

    let addressInputBoundsTemp = null;

    ipcMain.handle('record-history', (event, title, url) => {
        try {
            let history = [];
            if (fs.existsSync(historyFilePath)) {
                const data = fs.readFileSync(historyFilePath, 'utf8');
                history = JSON.parse(data);
            }

            const existingIndex = history.findIndex(item => item.url === url);
            if (existingIndex !== -1) {
                history.splice(existingIndex, 1);
            }

            const historyItem = {
                id: Date.now() + Math.random(),
                title: title || url,
                url,
                timestamp: Date.now(),
                date: new Date().toLocaleDateString(),
                time: new Date().toLocaleTimeString()
            };

            history.unshift(historyItem);
            if (history.length > 1000) {
                history = history.slice(0, 1000);
            }

            fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2), 'utf8');
            return { success: true };
        } catch (e) {
            console.error('保存历史记录失败:', e);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('remove-history-item', (event, id) => {
        try {
            let history = [];
            if (fs.existsSync(historyFilePath)) {
                const data = fs.readFileSync(historyFilePath, 'utf8');
                history = JSON.parse(data);
                history = history.filter(item => item.id !== id);
                fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2), 'utf8');
            }
            return { success: true };
        } catch (e) {
            console.error('删除历史记录失败:', e);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('get-history', () => {
        try {
            let history = [];
            if (fs.existsSync(historyFilePath)) {
                const data = fs.readFileSync(historyFilePath, 'utf8');
                history = JSON.parse(data);
            }
            return history;
        } catch (e) {
            console.error('获取历史记录失败:', e);
            return [];
        }
    });

    ipcMain.handle('search-history', (event, query) => {
        try {
            let history = [];
            if (fs.existsSync(historyFilePath)) {
                const data = fs.readFileSync(historyFilePath, 'utf8');
                history = JSON.parse(data);
            }

            if (!query || query.trim() === '') {
                return [];
            }

            const searchTerm = query.toLowerCase().trim();
            const matches = [];

            for (const item of history) {
                const urlMatch = item.url.toLowerCase().includes(searchTerm);
                const titleMatch = item.title.toLowerCase().includes(searchTerm);

                if (urlMatch || titleMatch) {
                    let score = 0;
                    if (urlMatch) {
                        if (item.url.toLowerCase() === searchTerm) {
                            score += 100;
                        } else if (item.url.toLowerCase().startsWith(searchTerm)) {
                            score += 50 + (searchTerm.length / item.url.length) * 30;
                        } else {
                            score += 20 + (searchTerm.length / item.url.length) * 10;
                        }
                    }

                    if (titleMatch) {
                        if (item.title.toLowerCase() === searchTerm) {
                            score += 80;
                        } else if (item.title.toLowerCase().startsWith(searchTerm)) {
                            score += 40 + (searchTerm.length / item.title.length) * 20;
                        } else {
                            score += 15 + (searchTerm.length / item.title.length) * 10;
                        }
                    }

                    matches.push({
                        ...item,
                        matchScore: score
                    });
                }
            }

            matches.sort((a, b) => b.matchScore - a.matchScore);
            return matches.slice(0, 10);
        } catch (e) {
            console.error('搜索历史记录失败:', e);
            return [];
        }
    });

    ipcMain.handle('show-history-autocomplete', (event, items, addressInputBounds) => {
        try {
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                addressInputBoundsTemp = addressInputBounds;
                showHistoryAutocomplete(mainWindow, items, addressInputBounds);
                return { success: true };
            }
            return { success: false, error: '主窗口不存在' };
        } catch (error) {
            console.error('显示历史记录自动匹配失败:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('hide-history-autocomplete', () => {
        try {
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                hideHistoryAutocomplete(mainWindow);
                return { success: true };
            }
            return { success: false, error: '主窗口不存在' };
        } catch (error) {
            console.error('隐藏历史记录自动匹配失败:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-address-input-bounds', (event, addressInputBounds) => {
        try {
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                addressInputBoundsTemp = addressInputBounds;
                const historyAutocompleteView = getHistoryAutocompleteView();
                if (historyAutocompleteView && !historyAutocompleteView.webContents.isDestroyed()) {
                    historyAutocompleteView.setBounds({
                        x: addressInputBoundsTemp.x,
                        y: addressInputBoundsTemp.y + addressInputBoundsTemp.height,
                        width: addressInputBoundsTemp.width,
                        height: historyAutocompleteView.getBounds().height
                    });
                    return { success: true };
                }
                return { success: false, error: '主窗口不存在2' };
            }
        } catch (error) {
            console.error('更新下拉历史失败:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('history-autocomplete-selected', (event, selectedItem) => {
        try {
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('history-autocomplete-selected', selectedItem);
                hideHistoryAutocomplete(mainWindow);
                return { success: true };
            }
            return { success: false, error: '主窗口不存在' };
        } catch (error) {
            console.error('处理历史记录自动匹配选择失败:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('history-autocomplete-selected-default', (event, selectedItem) => {
        console.log('处理历史记录自动匹配默认选中:', selectedItem);
        try {
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                console.log('处理历史记录自动匹配默认选中2:', selectedItem);
                mainWindow.webContents.send('history-autocomplete-selected-default', selectedItem);
                return { success: true };
            }
            return { success: false, error: '主窗口不存在' };
        } catch (error) {
            console.error('处理历史记录自动匹配默认选中失败:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('history-autocomplete-navigated', (event, selectedItem) => {
        console.log('处理历史记录自动匹配导航选择:', selectedItem);
        try {
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('history-autocomplete-navigated', selectedItem);
                return { success: true };
            }
            return { success: false, error: '主窗口不存在' };
        } catch (error) {
            console.error('处理历史记录自动匹配导航选择失败:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('history-autocomplete-keyboard', (event, action) => {
        try {
            const historyAutocompleteView = getHistoryAutocompleteView();
            if (historyAutocompleteView && !historyAutocompleteView.webContents.isDestroyed()) {
                historyAutocompleteView.webContents.send('history-autocomplete-keyboard', action);
                return { success: true };
            }
            return { success: false, error: '历史记录自动匹配BrowserView不存在' };
        } catch (error) {
            console.error('发送键盘导航指令失败:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('check-autocomplete-focus', () => {
        try {
            const historyAutocompleteView = getHistoryAutocompleteView();
            if (historyAutocompleteView && !historyAutocompleteView.webContents.isDestroyed()) {
                const isFocused = historyAutocompleteView.webContents.isFocused();
                console.log('自动匹配BrowserView焦点状态:', isFocused);
                return { hasFocus: isFocused };
            }
            return { hasFocus: false };
        } catch (error) {
            console.error('检查自动匹配焦点状态失败:', error);
            return { hasFocus: false, error: error.message };
        }
    });

    ipcMain.handle('clear-history', () => {
        try {
            fs.writeFileSync(historyFilePath, JSON.stringify([], null, 2), 'utf8');
            return { success: true };
        } catch (e) {
            console.error('清空历史记录失败:', e);
            return { success: false, error: e.message };
        }
    });
};
