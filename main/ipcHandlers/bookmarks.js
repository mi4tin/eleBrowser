const { apiRequest, API_BASE_URL, initUserDataPath, getLoginUserInfo, saveUserData } = require('./ipcTool');

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

    // 初始化用户数据路径
    initUserDataPath(app);

    const bookmarksFilePath = path.join(app.getPath('userData'), 'bookmarks.json');
    const syncStateFilePath = path.join(app.getPath('userData'), 'bookmark-sync-state.json');
    let bookmarkDropdownView = null;
    let dropdownFolderId = null;
    let subDropdownViews = [];
    let bookmarksCache = null; // 书签数据缓存
    
    // 同步相关变量
    let syncState = {
        syncVersion: 0,
        lastSyncTime: 0,
        lastSyncSnapshot: null,
        changes: [],
        deviceId: null,
        isSyncing: false
    };
    
    // 初始化同步状态
    function loadSyncState() {
        try {
            if (fs.existsSync(syncStateFilePath)) {
                const data = fs.readFileSync(syncStateFilePath, 'utf8');
                syncState = JSON.parse(data);
            }
            if (!syncState.deviceId) {
                syncState.deviceId = 'device-' + Math.random().toString(36).slice(2, 10);
                saveSyncState();
            }
        } catch (error) {
            console.error('加载同步状态失败:', error);
        }
    }
    
    function saveSyncState() {
        try {
            fs.writeFileSync(syncStateFilePath, JSON.stringify(syncState, null, 2), 'utf8');
        } catch (error) {
            console.error('保存同步状态失败:', error);
        }
    }
    
    // 生成书签ID
    function generateBookmarkId(url) {
        return murmur3(url);
    }
    
    // 快速哈希函数
    function murmur3(str, seed = 0) {
        let h1 = seed | 0;
        const c1 = 0xcc9e2d51, c2 = 0x1b873593;
        
        for (let i = 0; i < str.length; i++) {
            let k1 = str.charCodeAt(i);
            k1 = Math.imul(k1, c1);
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 = Math.imul(k1, c2);
            h1 ^= k1;
            h1 = (h1 << 13) | (h1 >>> 19);
            h1 = Math.imul(h1, 5) + 0xe6546b64 | 0;
        }
        
        h1 ^= str.length;
        h1 ^= h1 >>> 16;
        h1 = Math.imul(h1, 0x85ebca6b);
        h1 ^= h1 >>> 13;
        h1 = Math.imul(h1, 0xc2b2ae35);
        h1 ^= h1 >>> 16;
        
        return (h1 >>> 0).toString(36);
    }
    
    // 扁平化树结构
    function flattenTree(tree, parentId = null, result = [], parentIndex = 0) {
        if (tree.id === 'root') {
            if (tree.items && tree.items.length > 0) {
                tree.items.forEach((child, index) => {
                    child.orderIndex = index;
                    flattenTree(child, 'root', result, index);
                });
            }
            return result;
        }
        
        const localId = tree.id || generateBookmarkId(tree.url||tree.title);
        
        const item = {
            localId: localId,
            parentId: parentId,
            type: tree.type,
            title: tree.title,
            url: tree.url || '',
            favicon: tree.favicon || '',
            orderIndex: tree.orderIndex !== undefined ? tree.orderIndex : parentIndex,
            syncVersion: syncState.syncVersion,
            isDeleted: false
        };
        
        if (!tree.id) {
            tree.id = localId;
        }
        
        result.push(item);
        
        if (tree.items && tree.items.length > 0) {
            tree.items.forEach((child, index) => {
                child.orderIndex = index;
                flattenTree(child, localId, result);
            });
        }
        
        return result;
    }
    
    // 记录变更（主进程版）
    function recordChange(operation, item, parentId = null) {
        const change = {
            localId: item.id || generateBookmarkId(item.url||item.title),
            parentId: parentId,
            type: item.type,
            title: item.title,
            url: item.url || '',
            favicon: item.favicon || '',
            orderIndex: item.orderIndex !== undefined ? item.orderIndex : 0,
            operation: operation,
            timestamp: Date.now()
        };
        
        syncState.changes.push(change);
        console.log('记录变更（主进程）:', change);
        
        if (!item.id) {
            item.id = change.localId;
        }
        
        saveSyncState();
        
        // 触发同步
        syncBookmarksMain();
    }

    // 从扁平化列表重建树结构
    function unflattenTree(flatList) {
        const map = {};
        const rootItems = [];

        // 先把所有节点放入map
        flatList.forEach(item => {
            map[item.localId] = {
                id: item.localId,
                type: item.type,
                title: item.title,
                url: item.url,
                favicon: item.favicon,
                syncVersion: item.syncVersion,
                lastModified: Date.now(),
                isDeleted: item.isDeleted,
                orderIndex: item.orderIndex,
                items: []
            };
        });

        // 构建树形关系
        flatList.forEach(item => {
            if (item.parentId && item.parentId !== '' && map[item.parentId]) {
                map[item.parentId].items.push(map[item.localId]);
            } else if (item.localId !== 'root') {
                rootItems.push(map[item.localId]);
            }
        });

        // 按orderIndex排序
        const sortItems = (node) => {
            if (node.items && node.items.length > 0) {
                node.items.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
                node.items.forEach(sortItems);
            }
        };
        Object.values(map).forEach(sortItems);
        rootItems.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));

        // 创建或获取 root 节点
        let root = map['root'] || {
            id: 'root',
            type: 'folder',
            title: '书签',
            items: []
        };
        
        root.items = rootItems;
        
        return root;
    }

    // 主同步方法
    async function syncBookmarksMain(token) {
        if (syncState.isSyncing) {
            console.log('同步已在进行中');
            return { success: false, error: '同步已在进行中' };
        }

        // 如果没有提供token，尝试从用户数据中获取
        if (!token) {
            const userResult = getLoginUserInfo();
            if (!userResult.success || !userResult.data || !userResult.data.token) {
                console.error('获取用户数据失败');
                return { success: false, error: '未登录' };
            }
            token = userResult.data.token;
        }
        
        syncState.isSyncing = true;
        
        try {
            // 收集本地变更
            const localChanges = syncState.changes.length > 0 ? syncState.changes.map(c => ({
                localId: c.localId,
                parentId: c.parentId,
                type: c.type,
                title: c.title,
                url: c.url,
                favicon: c.favicon,
                orderIndex: c.orderIndex,
                syncVersion: syncState.syncVersion,
                isDeleted: c.operation === 'delete'
            })) : [];

            //开始同步
            console.log('开始同步:',localChanges);
            
            
            // 调用同步接口
            const result = await apiRequest('/api/bookmarks/sync', {
                token: token,
                localVersion: syncState.syncVersion,
                changes: localChanges,
                deviceId: syncState.deviceId
            });
            
            if (result && result.code === 0) {
                const data = result.data;
                
                // 更新服务器版本
                if (data.serverVersion !== undefined) {
                    syncState.syncVersion = data.serverVersion;
                }
                
                // 应用服务器变更
                let newBookmarksTree = null;
                if (data.hasChanges && data.changes && data.changes.length > 0) {
                    // 这里需要实现合并逻辑，暂时简化为下载完整数据
                    const downloadResult = await apiRequest('/api/bookmarks/download', {
                        token: token
                    });
                    
                    newBookmarksTree = unflattenTree(downloadResult.data.bookmarks);
                    if (downloadResult && downloadResult.code === 0 && downloadResult.data && downloadResult.data.bookmarks) {
                    }
                }
                
                // 清空变更
                syncState.changes = [];
                
                // 更新快照
                const currentBookmarks = loadBookmarksData(null);
                syncState.lastSyncSnapshot = JSON.parse(JSON.stringify(currentBookmarks));
                syncState.lastSyncTime = Date.now();
                
                saveSyncState();
                
                console.log('同步成功');
                return { 
                    success: true, 
                    data: {
                        serverVersion: syncState.syncVersion,
                        newBookmarksTree: newBookmarksTree
                    }
                };
            } else {
                console.error('同步失败:', result);
                return { success: false, error: result?.msg || '同步失败' };
            }
        } catch (error) {
            console.error('同步书签失败:', error);
            return { success: false, error: error.message };
        } finally {
            syncState.isSyncing = false;
        }
    }
    
    // 加载同步状态
    loadSyncState();

    function getDropdownUrl() {
        return 'file:///' + appRootDir.replace(/\\/g, '/') + '/html/dropdown-menu/dropdown-menu.html';
    }

    function createBookmarkDropdownView(window, bounds) {
        try {
            // const windowBounds = window.getBounds();
            const contentBounds = window.getContentBounds();

            console.log('contentBounds:',  {
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

            dropdownWindow.setAlwaysOnTop(true, 'screen-saver');// 确保在屏幕顶部
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
        // console.log('更新书签栏下拉菜单 bounds');
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
        // 先尝试从缓存获取
        let bookmarks = bookmarksCache;
        if (bookmarks) {
            // console.log('从缓存获取书签数据:', bookmarks);
            // return bookmarks;
        }
        
        if (!bookmarks && fs.existsSync(bookmarksFilePath)) {
            // 从文件读取
            const data = fs.readFileSync(bookmarksFilePath, 'utf8');
            bookmarks = JSON.parse(data);
            bookmarksCache = bookmarks; // 存入缓存
        }
        
        if (!bookmarks) {
            // 返回默认数据
            bookmarks = {
                id: 'root',
                title: '书签',
                name: '书签', // 向后兼容
                type: 'folder',
                items: []
            };
            bookmarksCache = bookmarks; // 存入缓存
        }
        
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
                    console.log('窗口大小改变，关闭下拉菜单');
                    window.isDestroyed()==false&&window.webContents.send('show-folder-dropdown-mouseenter', false);
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
                    x: bounds.x,
                    y: bounds.y,
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
                y: parentBounds.y + nextBounds.y,//再-8可以让第一排保持对齐，但后面对齐又会有视觉偏差，先放弃
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
        // console.log('收到加载书签请求', bookmarksFilePath, folderId);
        try {
            const bookmarks = loadBookmarksData(folderId);
            event.reply('load-bookmarks-reply', bookmarks);
        } catch (e) {
            console.error('加载书签数据失败:', e);
            event.reply('load-bookmarks-reply', null);
        }
    });

    // 向所有窗口发送书签保存通知
    function notifyAllWindowsBookmarksSaved() {
        getBrowserViews().values().forEach(tabView => {
            console.log('tabView:', tabView);
            tabView.webContents.send('bookmarks-saved');
        });
        console.log('向所有窗口发送书签保存通知');

        getMainWindow().webContents.send('bookmarks-saved');
    }

    ipcMain.on('save-bookmarks', (event, bookmarks) => {
        console.log('收到保存书签请求');
        saveBookmarksData(event, bookmarks);
    });

    function saveBookmarksData(event, bookmarks) {
       try {
            fs.writeFileSync(bookmarksFilePath, JSON.stringify(bookmarks, null, 2), 'utf8');
            bookmarksCache = bookmarks; // 更新缓存
            event&&event.reply('save-bookmarks-reply', { success: true });
            // 通知所有窗口更新
            notifyAllWindowsBookmarksSaved();
        } catch (e) {
            console.error('保存书签数据失败:', e);
            event&&event.reply('save-bookmarks-reply', { success: false, error: e.message });
        }
    }
    
    // 递归查找并移除项目
    function findAndRemoveItem(folder, itemData) {
        if (!folder.items) return null;
        
        const sourceIndex = folder.items.findIndex(item => {
            if (item.type === 'folder' && itemData.itemType === 'folder') {
                return item.id === itemData.id;
            } else if (item.type === 'bookmark' && itemData.itemType === 'bookmark') {
                return item.id === itemData.id || item.url === itemData.id;
            }
            return false;
        });
        
        if (sourceIndex !== -1) {
            return folder.items.splice(sourceIndex, 1)[0];
        }
        
        // 递归查找子文件夹
        for (const item of folder.items) {
            if (item.type === 'folder') {
                const found = findAndRemoveItem(item, itemData);
                if (found) return found;
            }
        }
        
        return null;
    }

    // 移动书签到文件夹
    ipcMain.on('move-bookmark-to-folder', (event, itemData, targetFolderId) => {
        console.log('收到移动书签到文件夹请求:', itemData, targetFolderId);
        try {
            const bookmarks = loadBookmarksData(null);
            if (!bookmarks) return;


            // 找到目标文件夹并添加项目
            const targetFolder = findFolderById(bookmarks, targetFolderId);
            if (targetFolder) {
                if (!targetFolder.items) {
                    targetFolder.items = [];
                }

                //判断是否已存在
                const existingBookmark = targetFolder.items.find(item => item.url === itemData.url);
                if (existingBookmark) {
                    console.log('书签已存在:', existingBookmark);
                    return;
                }
                // targetFolder.items.push(movedItem);
            }

            // 从任意源文件夹中移除项目
            const movedItem = findAndRemoveItem(bookmarks, itemData);

            if (movedItem) {
                // 找到目标文件夹并添加项目
                targetFolder.items.push(movedItem);

                // 保存书签数据
                fs.writeFileSync(bookmarksFilePath, JSON.stringify(bookmarks, null, 2), 'utf8');

                // 通知所有窗口更新
                notifyAllWindowsBookmarksSaved();

                // 关闭所有下拉菜单
                const window = BrowserWindow.fromWebContents(event.sender);
                if (window) {
                    hideFolderDropdown(window);
                }
            }
        } catch (e) {
            console.error('移动书签到文件夹失败:', e);
        }
    });

    // 同一文件夹内排序或跨文件夹移动到指定位置
    ipcMain.on('reorder-bookmark-in-folder', (event, itemData, folderId, targetIndex) => {
        console.log('收到排序请求:', itemData, folderId, targetIndex);
        try {
            const bookmarks = loadBookmarksData(null);
            if (!bookmarks) return;

            const targetFolder = findFolderById(bookmarks, folderId);
            if (!targetFolder) return;
            if (!targetFolder.items) {
                targetFolder.items = [];
            }

            // 先检查项目是否已经在目标文件夹中
            let sourceIndex = targetFolder.items.findIndex(item => {
                if (item.type === 'folder' && itemData.itemType === 'folder') {
                    return item.id === itemData.id;
                } else if (item.type === 'bookmark' && itemData.itemType === 'bookmark') {
                    return item.id === itemData.id || item.url === itemData.id;
                }
                return false;
            });

            let movedItem;
            if (sourceIndex !== -1) {
                // 同一文件夹内：从源位置移除
                [movedItem] = targetFolder.items.splice(sourceIndex, 1);
            } else {
                // 跨文件夹：从源位置移除
                movedItem = findAndRemoveItem(bookmarks, itemData);
                if (!movedItem) return;
                // 跨文件夹移动时，sourceIndex 设为 -1，不需要调整 targetIndex
                sourceIndex = -1;
            }

            // 计算目标索引（如果同一文件夹且源索引小于目标索引，移除后目标索引需要减1）
            let finalTargetIndex = targetIndex;
            if (sourceIndex !== -1 && sourceIndex < finalTargetIndex) {
                finalTargetIndex--;
            }

            // 确保索引不越界
            finalTargetIndex = Math.max(0, Math.min(finalTargetIndex, targetFolder.items.length));

            // 插入到目标位置
            targetFolder.items.splice(finalTargetIndex, 0, movedItem);

            // 保存书签数据
            fs.writeFileSync(bookmarksFilePath, JSON.stringify(bookmarks, null, 2), 'utf8');

            // 通知所有窗口更新
            notifyAllWindowsBookmarksSaved();

            // 关闭所有下拉菜单
            const window = BrowserWindow.fromWebContents(event.sender);
            if (window) {
                hideFolderDropdown(window);
            }
        } catch (e) {
            console.error('排序失败:', e);
        }
    });
    
    // 记录书签变更
    ipcMain.on('record-bookmark-change', (event, operation, item, parentId) => {
        console.log('收到记录变更请求:', operation, item, parentId);
        recordChange(operation, item, parentId);
        event.reply('record-bookmark-change-reply', { success: true });
    });
    
    // 获取同步状态
    ipcMain.handle('get-sync-state', () => {
        return {
            success: true,
            data: {
                syncVersion: syncState.syncVersion,
                lastSyncTime: syncState.lastSyncTime,
                hasChanges: syncState.changes.length > 0,
                deviceId: syncState.deviceId
            }
        };
    });
    
    // 获取变更列表
    ipcMain.handle('get-bookmark-changes', () => {
        return {
            success: true,
            data: syncState.changes
        };
    });
    
    // 清空变更记录
    ipcMain.handle('clear-bookmark-changes', () => {
        syncState.changes = [];
        saveSyncState();
        return { success: true };
    });
    
    // 更新同步版本
    ipcMain.handle('update-sync-version', (event, version) => {
        syncState.syncVersion = version;
        syncState.lastSyncTime = Date.now();
        // 更新快照
        const bookmarks = loadBookmarksData(null);
        syncState.lastSyncSnapshot = JSON.parse(JSON.stringify(bookmarks));
        saveSyncState();
        return { success: true };
    });

    // 获取用户信息（用于同步）
    ipcMain.handle('get-user-info', async () => {
        return getLoginUserInfo();
    });
    
    // 获取扁平化的书签数据（用于上传）
    ipcMain.handle('get-flat-bookmarks', () => {
        const bookmarks = loadBookmarksData(null);
        const flatList = flattenTree(bookmarks);
        return {
            success: true,
            data: flatList
        };
    });


    
        // ============ 书签同步相关 IPC ============
    
        // 上传书签
        ipcMain.handle('upload-bookmarks', async (_event, params) => {
            console.log('upload-bookmarks', params);
            try {
                const result = await apiRequest('/api/bookmarks/upload', params);
                return { success: true, data: result };
            } catch (error) {
                console.error('上传书签失败:', error);
                return { success: false, error: error.message };
            }
        });
    
        // 同步书签（旧版，保留兼容性）
        ipcMain.handle('sync-bookmarks', async (_event, params) => {
            console.log('sync-bookmarks', params);
            try {
                const result = await apiRequest('/api/bookmarks/sync', params);
                return { success: true, data: result };
            } catch (error) {
                console.error('同步书签失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 完整同步书签（新版）
        ipcMain.handle('sync-bookmarks-full', async (_event, token) => {
            console.log('sync-bookmarks-full');
            return await syncBookmarksMain(token);
        });
    
        // 下载书签
        ipcMain.handle('download-bookmarks', async (_event, params) => {
            console.log('download-bookmarks', params);
            try {
                const result = await apiRequest('/api/bookmarks/download', params);
                console.log('下载书签:', result);
                return { success: true, data: result.data };
            } catch (error) {
                console.error('下载书签失败:', error);
                return { success: false, error: error.message };
            }
        });
    
        // 获取书签最新版本
        ipcMain.handle('get-bookmarks-version', async (_event, params) => {
            console.log('get-bookmarks-version', params);
            try {
                const result = await apiRequest('/api/bookmarks/getVersion', params);
                console.log('获取书签版本:', result);
                if (result.code === 0) {
                    return { success: true, data: result.data };
                } else {
                    return { success: false, data: {} };
                }
            } catch (error) {
                console.error('获取书签版本失败:', error);
                return { success: false, error: error.message };
            }
        });
    
        // ============ 书签自动同步 ============
        // 监听书签保存事件，触发自动同步
        ipcMain.on('bookmarks-saved', () => {
            console.log('收到书签保存通知，触发自动同步');
            onBookmarkChanged();
        });




        // ============ 自动同步机制 ============
    let autoSyncTimer = null;
    let bookmarkChangeTimer = null;
    let lastAutoSyncTime = null;
    const AUTO_SYNC_INTERVAL = 30 * 60 * 1000; // 30分钟
    const BOOKMARK_CHANGE_DELAY = 10 * 1000; // 书签变更后10秒
    
    // 启动自动同步
    function startAutoSync() {
        console.log('启动自动同步机制');
        
        // 先停止现有的定时器
        stopAutoSync();
        
        // 设置30分钟自动同步
        autoSyncTimer = setInterval(() => {
            checkAndAutoSync();
        }, AUTO_SYNC_INTERVAL);
        
        // 立即检查一次是否需要同步
        setTimeout(() => checkAndAutoSync(), 5000);
    }
    
    // 停止自动同步
    function stopAutoSync() {
        if (autoSyncTimer) {
            clearInterval(autoSyncTimer);
            autoSyncTimer = null;
        }
        if (bookmarkChangeTimer) {
            clearTimeout(bookmarkChangeTimer);
            bookmarkChangeTimer = null;
        }
    }
    
    // 检查并执行自动同步
    async function checkAndAutoSync() {
        try {
            // 检查是否有用户数据
            const userResult = getLoginUserInfo();
            if (!userResult.success || !userResult.data || !userResult.data.token) {
                return;
            }
            
            const userData = userResult.data;
            
            // 检查距离上次同步的时间
            const now = Date.now();
            const lastSync = userData.lastSyncTime || 0;
            if (now - lastSync < AUTO_SYNC_INTERVAL) {
                return;
            }
            
            console.log('先同步本地书签到服务器');
            await syncBookmarksMain(userData.token);
            console.log('本地书签已同步到服务器');
            
            // 获取服务器版本
            const versionResult = await apiRequest('/api/bookmarks/getVersion', {
                token: userData.token
            });
            
            const serverVersion = versionResult?.version || 0;
            const localVersion = userData.bookmarkSyncVersion || 0;
            
            // 如果云端有新版本，尝试同步（静默同步，不显示UI）
            if (serverVersion > localVersion) {
                console.log('发现云端新版本，合并云版本到本地');
                
                // 下载云端数据
                const downloadResult = await apiRequest('/api/bookmarks/download', {
                    token: userData.token,
                    minVersion: localVersion
                });
                
                if (downloadResult?.bookmarks) {
                    const bookmarks =loadBookmarksData(null)
                    var localList = flattenTree(bookmarks);
                    //直接合并到本地
                    const mergedBookmarks = mergeBookmarks(localList, downloadResult.bookmarks);
                    saveBookmarksData(null, mergedBookmarks.tree);
                    // userData.bookmarks = mergedBookmarks;
                    
                    console.log('云端已合并到本地，自动同步完成');
                    
                    // 更新本地版本
                    userData.bookmarkSyncVersion = serverVersion;
                    userData.lastSyncTime = now;
                    saveUserData(userData);
                }
            }else{
                console.log('云端版本与本地版本相同，无需同步');
                return;
            }
        } catch (error) {
            console.error('自动同步失败:', error);
        }
    }

         // 初始化：检查是否有已登录的用户
    function initAutoSync() {
        try {
            const userResult = getLoginUserInfo();
            if (userResult.success && userResult.data && userResult.data.token) {
                console.log('发现已登录用户，启动自动同步');
                startAutoSync();
            }
        } catch (error) {
            console.error('初始化自动同步失败:', error);
        }
    }
    
    // 执行初始化
    initAutoSync();


    //方法与bookmark-sync.js中的mergeBookmarks方法一致
    function mergeBookmarks(localList, cloudList) {
        const itemMap = new Map();
        
        // 第一步：先处理本地数据
        for (const item of localList) {
            itemMap.set(item.parentId+'-'+item.localId, { ...item });
        }
        
        // 第二步：处理云端数据，根据合并策略
        for (const item of cloudList) {
            const existing = itemMap.get(item.parentId+'-'+item.localId);
            
            if (existing) {
                // 同一书签存在，比较版本
                // 策略：保留最新版本，相同版本保留本地的
                const localVersion = existing.syncVersion || 0;
                const cloudVersion = item.syncVersion || 0;
                
                if (cloudVersion > localVersion) {
                    // 云端版本更新，替换本地
                    itemMap.set(item.parentId+'-'+item.localId, { ...item });
                }
                // 否则保留本地的，不需要操作
            } else {
                // 云端新增的项目，直接添加
                itemMap.set(item.parentId+'-'+item.localId, { ...item });
            }
        }
        
        // 第三步：转换为合并后的扁平数组
        const mergeFlat = Array.from(itemMap.values());
        
        // 第四步：重建树结构
        const mergeTree = this.unflattenTree(mergeFlat);
        
        return {
            flat: mergeFlat,
            tree: mergeTree,
        };
    }
    


        

    return {
        updateBookmarkDropdownBounds,
        hideFolderDropdown
    };
};
