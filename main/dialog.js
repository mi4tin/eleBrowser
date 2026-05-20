const { ipcMain, BrowserWindow } = require('electron');
const path = require('path');

let dialogWindow = null;
let dialogResolve = null;

function createShowDialog(getMainWindow) {
    return function showDialog(options) {
        return new Promise((resolve) => {
            if (dialogWindow && !dialogWindow.isDestroyed()) {
                dialogWindow.focus();
                return;
            }


            console.log("createShowDialog",options);

            const {
                title = '',
                message = '',
                confirmText = '确定',
                cancelText = null,
                parentWindow = null,
                type = 'default',
                username = '',
                password = '',
                modal = true,//是否为模态弹窗，为true时，其他窗口不能操作
            } = options;

            const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
            const parent = parentWindow || mainWindow;

            const windowHeight = type === 'save-password' ? 320 : 180;

            dialogWindow = new BrowserWindow({
                width: 420,
                height: windowHeight,
                minWidth: 320,
                minHeight: type === 'save-password' ? 280 : 150,
                transparent: true,
                frame: false,
                resizable: false,
                modal: modal,
                parent: parent,
                show: false,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                }
            });

            // 构建 dialog.html 的路径
            const dialogHtmlPath = path.join(__dirname, '..', 'html', 'dialog', 'dialog.html');
            dialogWindow.loadFile(dialogHtmlPath);

            dialogWindow.once('ready-to-show', () => {
                dialogWindow.show();
                dialogWindow.webContents.send('dialog-init', {
                    title,
                    message,
                    confirmText,
                    cancelText,
                    type,
                    username,
                    password,
                });
            });

            dialogResolve = resolve;

            const handleDialogResult = (event, result) => {
                if (dialogResolve) {
                    dialogResolve(result);
                    dialogResolve = null;
                }
                if (dialogWindow && !dialogWindow.isDestroyed()) {
                    dialogWindow.destroy();
                }
                dialogWindow = null;
                ipcMain.removeListener('dialog-result', handleDialogResult);
            };

            ipcMain.on('dialog-result', handleDialogResult);

            dialogWindow.on('closed', () => {
                if (dialogResolve) {
                    if (type === 'save-password') {
                        dialogResolve({ confirmed: false });
                    } else {
                        dialogResolve(false);
                    }
                    dialogResolve = null;
                }
                dialogWindow = null;
                ipcMain.removeListener('dialog-result', handleDialogResult);
            });
        });
    };
}

module.exports = {
    createShowDialog
};
