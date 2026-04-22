const https = require('https');
const http = require('http');

module.exports = function registerLoginIpcHandlers(deps) {
    const {
        ipcMain,
        BrowserWindow,
        appRootDir,
        getPreloadPath,
        getMainWindow
    } = deps;

    let loginWindow = null;

    // beta API 配置
    const API_BASE_URL = 'http://localhost:8011'; // 你可以根据实际情况修改

    function createLoginWindow() {
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.focus();
            return;
        }

        const mainWindow = getMainWindow();

        loginWindow = new BrowserWindow({
            parent: mainWindow,
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

    // HTTP 请求工具函数
    function apiRequest(endpoint, data) {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify(data);
            
            const url = new URL(API_BASE_URL + endpoint);
            const client = url.protocol === 'https:' ? https : http;

            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = client.request(options, (res) => {
                let responseData = '';

                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(responseData);
                        resolve(parsed);
                    } catch (e) {
                        reject(new Error('响应解析失败'));
                    }
                });
            });

            req.on('error', (e) => {
                reject(e);
            });

            req.write(postData);
            req.end();
        });
    }

    return {
        createLoginWindow
    };
};
