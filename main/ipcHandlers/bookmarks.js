module.exports = function registerBookmarksIpcHandlers(deps) {
    const {
        app,
        ipcMain,
        BrowserWindow,
        WebContentsView,
        path,
        fs,
        appRootDir,
        getPreloadPath,
        getMainWindow,
        getBrowserViews,
        hideHistoryAutocomplete
    } = deps;

    const bookmarksFilePath = path.join(app.getPath('userData'), 'bookmarks.json');
    let bookmarkDropdownView = null;
    let dropdownFolderId = null;
    let subDropdownViews = [];

    function getDropdownUrl() {
        return 'file:///' + appRootDir.replace(/\\/g, '/') + '/html/dropdown-menu/dropdown-menu.html';
    }

    function createBookmarkDropdownView(window, bounds) {
        try {
            const windowBounds = window.getBounds();
            const contentBounds = window.getContentBounds();

            console.log('contentBounds:', contentBounds, bounds, {
                x: contentBounds.x + bounds.x,
                y: contentBounds.y + bounds.y
            });
            
            const dropdownWindow = new BrowserWindow({
                width: bounds.width,
                height: bounds.height,
                frame: false,
                transparent: true,
                alwaysOnTop: true,
                skipTaskbar: true,
                focusable: false,
                show: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: getPreloadPath('preload-browserview.js')
                }
            });

            dropdownWindow.setAlwaysOnTop(false);
            dropdownWindow.loadURL(getDropdownUrl());
            
            bookmarkDropdownView = {
                webContents: dropdownWindow.webContents,
                window: dropdownWindow,
                getBounds: () => {
                    const bounds = dropdownWindow.getBounds();
                    console.log('bounds.aa:', bounds, contentBounds,{ 
                        x: bounds.x - contentBounds.x,
                        y: bounds.y - contentBounds.y,});
                    return {
                        x: bounds.x ,
                        y: bounds.y,
                        width: bounds.width,
                        height: bounds.height
                    };
                },
                // setBounds: (newBounds) => {
                //     dropdownWindow.setBounds({
                //         x: contentBounds.x + newBounds.x,
                //         y: contentBounds.y + newBounds.y,
                //         width: newBounds.width,
                //         height: newBounds.height
                //     });
                // },
                destroy: () => {
                    if (!dropdownWindow.isDestroyed()) {
                        dropdownWindow.close();
                        dropdownWindow.destroy();
                    }
                }
            };

            dropdownWindow.once('ready-to-show', () => {
                dropdownWindow.setBounds({
                    x: contentBounds.x + bounds.x,
                    y: contentBounds.y + bounds.y,
                    width: bounds.width,
                    height: bounds.height
                });
                dropdownWindow.show();
                console.log('书签栏下拉菜单 BrowserWindow 创建成功');
            });

            return bookmarkDropdownView;
        } catch (error) {
            console.error('创建书签栏下拉菜单 BrowserWindow 失败:', error);
            return null;
        }
    }

    function updateBookmarkDropdownBounds(window) {
        console.log('更新书签栏下拉菜单 bounds');
        if (!bookmarkDropdownView || !bookmarkDropdownView.window || bookmarkDropdownView.window.isDestroyed()) return;
        const windowBounds = window.getBounds();
        const contentBounds = window.getContentBounds();
        const dropdownBounds = bookmarkDropdownView.window.getBounds();
        bookmarkDropdownView.window.setBounds({
            x: contentBounds.x,
            y: contentBounds.y,
            width: contentBounds.width,
            height: contentBounds.height
        });
    }

    function deleteSubMenus(startIndex, window) {
        const deleteSubs = subDropdownViews.splice(startIndex);
        for (let i = 0; i < deleteSubs.length; i++) {
            const oldSubMenu = deleteSubs[i];
            try {
                if (oldSubMenu.destroy) {
                    oldSubMenu.destroy();
                } else if (oldSubMenu.window && !oldSubMenu.window.isDestroyed()) {
                    oldSubMenu.window.close();
                    oldSubMenu.window.destroy();
                }
            } catch (e) {
                console.error('删除旧子菜单失败:', oldSubMenu.folderId, e.message);
            }
        }
    }

    function hideFolderDropdown(window) {
        if (bookmarkDropdownView) {
            try {
                if (bookmarkDropdownView.destroy) {
                    bookmarkDropdownView.destroy();
                } else if (bookmarkDropdownView.window && !bookmarkDropdownView.window.isDestroyed()) {
                    bookmarkDropdownView.window.close();
                    bookmarkDropdownView.window.destroy();
                }
            } catch (e) {
                console.error('销毁主下拉菜单 BrowserWindow 失败:', e);
            }
            bookmarkDropdownView = null;
        }

        if (subDropdownViews.length > 0) {
            for (const subMenu of subDropdownViews) {
                try {
                    if (subMenu.destroy) {
                        subMenu.destroy();
                    } else if (subMenu.window && !subMenu.window.isDestroyed()) {
                        subMenu.window.close();
                        subMenu.window.destroy();
                    }
                } catch (e) {
                    console.error('销毁子下拉菜单 BrowserWindow 失败:', e);
                }
            }
            subDropdownViews = [];
        }
        dropdownFolderId = null;
    }

    function findFolderById(folder, id) {
        if (folder.id === id) return folder;
        if (!folder.items) return null;
        for (const item of folder.items) {
            if (item.type === 'folder') {
                const found = findFolderById(item, id);
                if (found) return found;
            }
        }
        return null;
    }

    function loadBookmarksData(folderId) {
        if (!fs.existsSync(bookmarksFilePath)) return null;
        const data = fs.readFileSync(bookmarksFilePath, 'utf8');
        let bookmarks = JSON.parse(data);
        if (folderId) {
            const folder = findFolderById(bookmarks, folderId);
            if (folder) bookmarks = folder;
        }
        return bookmarks;
    }

    ipcMain.on('show-folder-dropdown', (event, folderData, folderBounds, isMouseenter) => {
        console.log('收到显示文件夹下拉菜单请求:', folderData.name, folderBounds);
        const window = BrowserWindow.fromWebContents(event.sender);
        console.log('收到显示文件夹下拉菜单请求.aa:', window.getURL());
        if (!window) {
            throw new Error('下拉菜单.无法获取窗口实例');
        }

        if (dropdownFolderId && dropdownFolderId !== folderData.id) {
            hideFolderDropdown(window);
        }

        if (!bookmarkDropdownView) {
            createBookmarkDropdownView(window, folderBounds);
            dropdownFolderId = folderData.id;
            // console.log('bookmarkDropdownView.window:', bookmarkDropdownView.window);

            const closeDropdownOnWindowChange = () => {
                if (bookmarkDropdownView && bookmarkDropdownView.window && !bookmarkDropdownView.window.isDestroyed()) {
                    hideFolderDropdown(window);
                }
            };

            window.once('moved', closeDropdownOnWindowChange);
            window.once('resize', closeDropdownOnWindowChange);
            window.once('closed', closeDropdownOnWindowChange);

            bookmarkDropdownView.window.webContents.once('did-finish-load', () => {
                if (window && !window.isDestroyed()) {
                    if (bookmarkDropdownView && !bookmarkDropdownView.window.isDestroyed()) {
                        // console.log('发送到下拉菜单:', folderData, folderBounds);
                        bookmarkDropdownView.window.webContents.send('show-folder-dropdown', folderData, folderBounds);

                        const subMenuInfo = {
                            folderId: folderData.id,
                            folderData,
                            view: bookmarkDropdownView,
                            window: bookmarkDropdownView.window,
                            destroy: bookmarkDropdownView.destroy
                        };
                        subDropdownViews.push(subMenuInfo);
                    }
                }
            });

            event.reply('show-folder-dropdown-mouseenter', true);
            return;
        }

        if (isMouseenter) return;
        hideFolderDropdown(window);
        event.reply('show-folder-dropdown-mouseenter', false);
    });

    ipcMain.on('hide-folder-dropdown', (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            throw new Error('下拉菜单.无法获取窗口实例');
        }
        hideFolderDropdown(window);
    });

    ipcMain.on('dismiss-overlays-from-browser-view', (event) => {
        const wc = event.sender;
        let fromTab = false;
        for (const v of getBrowserViews().values()) {
            if (v.webContents && !v.webContents.isDestroyed() && v.webContents.id === wc.id) {
                fromTab = true;
                break;
            }
        }
        if (!fromTab) return;

        const win = BrowserWindow.fromWebContents(wc);
        if (win && !win.isDestroyed()) {
            hideFolderDropdown(win);
        }
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            hideHistoryAutocomplete(mainWindow);
            mainWindow.webContents.send('browser-view-interacted');
        }
    });

    ipcMain.on('show-folder-dropdown-next', (event, nextBounds, item, parentId) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        // console.log('收到显示下级文件夹菜单请求:', window);
        if (!window) {
            throw new Error('下拉菜单。无法获取窗口实例');
        }
        console.log('显示子文件夹菜单:', item.name, nextBounds, parentId);

        let parentFolder = null;
        let parentIndex = -1;
        let existingSubIndex = -1;

        for (let i = 0; i < subDropdownViews.length; i++) {
            if (parentFolder !== null && existingSubIndex !== -1) {
                break;
            }
            if (subDropdownViews[i].folderId === parentId) {
                parentFolder = subDropdownViews[i];
                parentIndex = i;
                continue;
            }
            if (subDropdownViews[i].folderId === item.id) {
                existingSubIndex = i;
                continue;
            }
        }

        if (nextBounds == null) {
            console.log('书签或无下级');
            deleteSubMenus(parentIndex + 1, window);
            return;
        }

        if (existingSubIndex !== -1) {
            if (parentIndex + 1 === existingSubIndex) {
                deleteSubMenus(existingSubIndex + 1, window);
                return;
            }
            console.error('子菜单异常:', item);
            return;
        }

        // console.log('parentBounds:', parentFolder,parentFolder.view);
        const parentBounds = parentFolder.view.getBounds();
        deleteSubMenus(parentIndex + 1, window);

        const windowBounds = window.getBounds();
        const contentBounds = window.getContentBounds();
        const subDropdownWindow = new BrowserWindow({
            width: nextBounds.width,
            height: nextBounds.height,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            focusable: false,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: getPreloadPath('preload-browserview.js')
            }
        });
        
        subDropdownWindow.setAlwaysOnTop(true, 'screen-saver');
        subDropdownWindow.loadURL(getDropdownUrl());

        const subDropdownView = {
            webContents: subDropdownWindow.webContents,
            window: subDropdownWindow,
            getBounds: () => {
                const bounds = subDropdownWindow.getBounds();
                return {
                    x: bounds.x - contentBounds.x,
                    y: bounds.y - contentBounds.y,
                    width: bounds.width,
                    height: bounds.height
                };
            },
            destroy: () => {
                if (!subDropdownWindow.isDestroyed()) {
                    subDropdownWindow.close();
                    subDropdownWindow.destroy();
                }
            }
        };

        const subMenuInfo = {
            folderId: item.id,
            folderData: item,
            view: subDropdownView,
            window: subDropdownWindow,
            destroy: subDropdownView.destroy
        };

        subDropdownWindow.once('ready-to-show', () => {
            console.log('subDropdownWindow.getBounds:', parentBounds,nextBounds,{ x: parentBounds.x + nextBounds.x,
                y: parentBounds.y + nextBounds.y,});
                //todo:子级下拉显示位置
            subDropdownWindow.setBounds({
                x:  parentBounds.x + nextBounds.x,
                y: parentBounds.y + nextBounds.y,
                width: nextBounds.width,
                height: nextBounds.height
            });
            subDropdownWindow.show();
            if (window && !window.isDestroyed() && subDropdownWindow && !subDropdownWindow.isDestroyed()) {
                window.webContents.focus();
                // console.log('子菜单加载完成，发送数据:', item);
                subDropdownWindow.webContents.send('show-folder-dropdown', item, {
                    x: nextBounds.x,
                    y: nextBounds.y,
                    width: 300,
                    height: Math.max(200, 41 * ((item.items && item.items.length) || 1) + 16 + 2)
                });
                if (!subDropdownWindow.isDestroyed()) {
                    subDropdownViews.push(subMenuInfo);
                }
            }
        });

        const closeSubMenuOnWindowChange = () => {
            if (subMenuInfo.destroy) {
                subMenuInfo.destroy();
            }
        };

        window.once('moved', closeSubMenuOnWindowChange);
        window.once('resize', closeSubMenuOnWindowChange);
        window.once('closed', closeSubMenuOnWindowChange);
    });

    ipcMain.on('open-bookmark-url', (event, url) => {
        console.log('收到从书签栏打开 URL 请求:', url);
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('open-url-in-new-tab', url);
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
        }
    });

    ipcMain.on('open-bookmarks-manager', () => {
        console.log('收到打开书签管理器请求');
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('open-bookmarks-manager');
        }
    });

    ipcMain.on('load-bookmarks', (event, folderId) => {
        console.log('收到加载书签请求', bookmarksFilePath, folderId);
        try {
            const bookmarks = loadBookmarksData(folderId);
            event.reply('load-bookmarks-reply', bookmarks);
        } catch (e) {
            console.error('加载书签数据失败:', e);
            event.reply('load-bookmarks-reply', null);
        }
    });

    ipcMain.on('save-bookmarks', (event, bookmarks) => {
        console.log('收到保存书签请求');
        try {
            fs.writeFileSync(bookmarksFilePath, JSON.stringify(bookmarks, null, 2), 'utf8');
            event.reply('save-bookmarks-reply', { success: true });
        } catch (e) {
            console.error('保存书签数据失败:', e);
            event.reply('save-bookmarks-reply', { success: false, error: e.message });
        }
    });

    return {
        updateBookmarkDropdownBounds,
        hideFolderDropdown
    };
};
