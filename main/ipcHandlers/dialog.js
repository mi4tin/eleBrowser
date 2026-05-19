function registerDialogIpcHandlers(deps) {
    const { ipcMain, getShowDialog, getMainWindow } = deps;

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

    ipcMain.handle('show-save-password-dialog', async (event, options) => {
        const showDialogFunc = getShowDialog();
        const mainWindow = getMainWindow();
        
        if (!showDialogFunc) {
            console.error('showDialog function not available');
            return { confirmed: false };
        }

        const { 
            title = '要保存密码吗？',
            message = '', 
            confirmText = '保存', 
            cancelText = '一律不',
            username = '',
            password = ''
        } = options;
        
        const result = await showDialogFunc({
            title,
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

    return {};
}

module.exports = registerDialogIpcHandlers;
