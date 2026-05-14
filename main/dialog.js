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

            const {
                message = '',
                confirmText = '确定',
                cancelText = null,
                parentWindow = null,
            } = options;

            const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
            const parent = parentWindow || mainWindow;

            dialogWindow = new BrowserWindow({
                width: 420,
                height: 180,
                minWidth: 320,
                minHeight: 150,
                frame: false,
                resizable: false,
                modal: parent !== null,
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
                    message,
                    confirmText,
                    cancelText,
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
                    dialogResolve(false);
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
