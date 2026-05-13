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





   

    return {
        createLoginWindow
    };
};
