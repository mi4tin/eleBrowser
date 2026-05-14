function registerDialogIpcHandlers(deps) {
    const { ipcMain, getShowDialog, getMainWindow } = deps;

    ipcMain.handle('show-dialog', async (event, options) => {
        const showDialogFunc = getShowDialog();
        const mainWindow = getMainWindow();
        
        if (!showDialogFunc) {
            console.error('showDialog function not available');
            return false;
        }

        const { message, confirmText = '确定', cancelText } = options;
        
        const result = await showDialogFunc({
            message,
            confirmText,
            cancelText,
            parentWindow: mainWindow
        });
        
        return result;
    });

    return {};
}

module.exports = registerDialogIpcHandlers;
