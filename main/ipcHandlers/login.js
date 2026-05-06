const { apiRequest, API_BASE_URL, initUserDataPath, getLoginUserInfo, saveUserData } = require('./ipcTool');

module.exports = function registerLoginIpcHandlers(deps) {
    const {
        ipcMain,
        BrowserWindow,
        appRootDir,
        getPreloadPath,
        getMainWindow,
        app
    } = deps;

    let loginWindow = null;

    // 初始化用户数据路径
    initUserDataPath(app);
    
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
            
            console.log('执行自动同步');
            
            // 获取服务器版本
            const versionResult = await apiRequest('/api/bookmarks/getVersion', {
                token: userData.token
            });
            
            const serverVersion = versionResult?.version || 0;
            const localVersion = userData.bookmarkSyncVersion || 0;
            
            // 如果云端有新版本，尝试同步（静默同步，不显示UI）
            if (serverVersion > localVersion) {
                console.log('发现云端新版本，执行自动同步');
                
                // 下载云端数据
                const downloadResult = await apiRequest('/api/bookmarks/download', {
                    token: userData.token
                });
                
                if (downloadResult?.bookmarks) {
                    // 保存到本地
                    // todo:这里简化处理，实际应该有更完善的合并策略
                    console.log('自动同步完成');
                    
                    // 更新本地版本
                    userData.bookmarkSyncVersion = serverVersion;
                    userData.lastSyncTime = now;
                    saveUserData(userData);
                }
            }
        } catch (error) {
            console.error('自动同步失败:', error);
        }
    }
    
    // 书签变更时触发同步
    function onBookmarkChanged() {
        if (bookmarkChangeTimer) {
            clearTimeout(bookmarkChangeTimer);
        }
        bookmarkChangeTimer = setTimeout(() => {
            checkAndAutoSync();
        }, BOOKMARK_CHANGE_DELAY);
    }

    function createLoginWindow() {
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.focus();
            return;
        }

        const mainWindow = getMainWindow();

        loginWindow = new BrowserWindow({
            // parent: mainWindow,
            // modal: true,
            width: 480,
            height: 520,
            minWidth: 400,
            minHeight: 450,
            resizable: true,
            show: false,
            frame: false,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        const loginUrl = `file://${appRootDir.replace(/\\/g, '/')}/html/login.html`;
        loginWindow.loadURL(loginUrl);

        loginWindow.once('ready-to-show', () => {
            loginWindow.show();
        });

        loginWindow.on('closed', () => {
            loginWindow = null;
        });
    }

    ipcMain.on('open-login-window', () => {
        console.log('open-login-window');
        createLoginWindow();
    });

    ipcMain.on('close-login-window', () => {
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close();
        }
    });

    // 发送验证码的 IPC 处理
    ipcMain.handle('auth-send-code', async (_event, params) => {
        console.log('发送验证码参数:', params);
        try {
            const result = await apiRequest('/api/auth/sendCode', {
                email: params.email,
                type: params.type || 'login'
            });
            return { success: true, data: result };
        } catch (error) {
            console.error('发送验证码失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 登录的 IPC 处理
    ipcMain.handle('auth-login', async (_event, params) => {
        try {
            const result = await apiRequest('/api/auth/login', {
                email: params.email,
                code: params.code
            });
            return { success: true, data: result };
        } catch (error) {
            console.error('登录失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 登陆成功后，保存用户信息到本地文件
    ipcMain.handle('save-user-data', async (_event, userData) => {
        console.log('save-user-data', userData);
        try {
            if (!userData) {
                // 清除用户数据
                saveUserData(null);
                stopAutoSync();
            }else{
                saveUserData(userData);
                startAutoSync();
            }

            const mainWindow = getMainWindow();
            // 登录成功后，通知主进程更新用户信息
            mainWindow.webContents.send('update-user-data', userData);
            
            return { success: true };
        } catch (error) {
            console.error('保存用户数据失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 从本地文件读取用户信息
    ipcMain.handle('load-user-data', async () => {
         return getLoginUserInfo();
    });

    // 验证 token 并返回用户信息
    ipcMain.handle('validate-token', async (_event, token) => {
        try {
            const result = await apiRequest('/api/auth/validateToken', {
                token: token
            });
            return { success: true, data: result };
        } catch (error) {
            console.error('验证token失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 清除用户登录信息
    ipcMain.handle('clear-user-data', async () => {
        console.log('clear-user-data');
        try {
            saveUserData(null);
            const mainWindow = getMainWindow();
            // 登录成功后，通知主进程更新用户信息
            mainWindow.webContents.send('update-user-data', null);
            
            return { success: true };
        } catch (error) {
            console.error('清除用户数据失败:', error);
            return { success: false, error: error.message };
        }
    });



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

    return {
        createLoginWindow
    };
};
