module.exports = function registerLoginIpcHandlers(deps) {
    const {
        ipcMain,
        BrowserWindow,
        appRootDir,
        getPreloadPath
    } = deps;

    let loginWindow = null;

    function createLoginWindow() {
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.focus();
            return;
        }

        loginWindow = new BrowserWindow({
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

    return {
        createLoginWindow
    };
};
