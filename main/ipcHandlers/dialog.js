const { closeDialog } = require('../dialog');

function registerDialogIpcHandlers(deps) {
    const { ipcMain, getShowDialog, getMainWindow, getBrowserViews } = deps;

    ipcMain.handle('show-dialog', async (event, options) => {
        const showDialogFunc = getShowDialog();
        const mainWindow = getMainWindow();
        
        if (!showDialogFunc) {
            console.error('showDialog function not available');
            return false;
        }

        const { message, confirmText = '确定', cancelText, title = '' } = options;
        
        const result = await showDialogFunc({
            title,
            message,
            confirmText,
            cancelText,
            parentWindow: mainWindow
        });
        
        return result;
    });

    //目前只有测试用例在用
    ipcMain.handle('show-save-password-dialog', async (event, options) => {
        const showDialogFunc = getShowDialog();
        const mainWindow = getMainWindow();
        
        if (!showDialogFunc) {
            console.error('showDialog function not available');
            return { confirmed: false };
        }


        console.log('show-save-password-dialog', options);

        const { 
            title = '要保存密码吗？',
            message = '', 
            confirmText = '保存', 
            cancelText = '一律不',
            username = '',
            password = '',
            modal = false,
        } = options;
        
        const result = await showDialogFunc({
            title,
            modal,
            message,
            confirmText,
            cancelText,
            parentWindow: mainWindow,
            type: 'save-password',
            username,
            password
        });
        
        return result;
    });

    // 关闭密码列表
    ipcMain.on('dismiss-overlays-from-browser-view', (event) => {
        console.log('dialog.js: 收到 dismiss-overlays-from-browser-view 事件');
        const wc = event.sender;
        let fromTab = false;
        if (getBrowserViews) {
            for (const v of getBrowserViews().values()) {
                if (v.webContents && !v.webContents.isDestroyed() && v.webContents.id === wc.id) {
                    fromTab = true;
                    break;
                }
            }
        }
        if (!fromTab) {
            console.log('dialog.js: 不是来自标签页的事件，忽略');
            return;
        }

        console.log('dialog.js: 开始关闭密码列表...');
        // 关闭密码列表
        closeDialog();
    });

    return {};
}

module.exports = registerDialogIpcHandlers;
