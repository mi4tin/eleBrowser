const { getSavedPasswords, savePassword, deletePassword, getPasswordsByUrl } = require('../passwordManager');

// 存储等待保存的登录信息
let pendingLoginInfo = null;
let getShowDialogFunc = null;
let getMainWindowFunc = null;
let activeWebContents = null;

// 显示保存密码弹窗的函数
async function showSavePasswordDialog() {
    if (!pendingLoginInfo) return false;
    
    const showDialogFunc = getShowDialogFunc();
    if (!showDialogFunc) {
        console.error('showDialog function not available');
        return false;
    }
    
    // 显示保存密码弹窗
    const result = await showDialogFunc({
        title: '要保存密码吗？',
        message: '',
        confirmText: '保存',
        cancelText: '一律不',
        parentWindow: getMainWindowFunc(),
        type: 'save-password',
        username: pendingLoginInfo.username,
        password: pendingLoginInfo.password,
        modal: false,
    });
    
    // 处理用户选择
    if (result && typeof result === 'object' && result.confirmed) {
        // 保存密码
        const url = new URL(pendingLoginInfo.url);
        const saveResult = savePassword({
            url: pendingLoginInfo.url,
            hostname: url.hostname,
            username: result.username || pendingLoginInfo.username,
            password: result.password || pendingLoginInfo.password
        });
        
        if (saveResult.success) {
            console.log('密码保存成功');
        } else {
            console.error('密码保存失败:', saveResult.error);
        }
    }
    
    
    pendingLoginInfo = null;
    console.log('保存密码弹窗已重置',pendingLoginInfo);
    return true;
}

// 显示已保存密码列表的函数
async function showSavedPasswordsDialog(url) {
    const showDialogFunc = getShowDialogFunc();
    if (!showDialogFunc) {
        console.error('showDialog function not available');
        return false;
    }
    
    // 获取该URL的已保存密码
    const result = getPasswordsByUrl(url);
    const savedPasswords = result.data || [];
    
    if (savedPasswords.length === 0) {
        console.log('没有保存的密码');
        return false;
    }
    
    // 显示已保存密码弹窗
    const dialogResult = await showDialogFunc({
        title: '',
        message: '',
        confirmText: '',
        cancelText: '',
        parentWindow: getMainWindowFunc(),
        type: 'show-saved-passwords',
        savedPasswords: savedPasswords,
        modal: false,
    });
    
    // 处理用户选择
    if (dialogResult && typeof dialogResult === 'object') {
        if (dialogResult.action === 'fill' && dialogResult.username && dialogResult.password) {
            // 填充密码
            if (activeWebContents && !activeWebContents.isDestroyed()) {
                activeWebContents.send('fill-login-form', {
                    username: dialogResult.username,
                    password: dialogResult.password
                });
            }
        } else if (dialogResult.action === 'manage') {
            // 打开密码管理页面（待实现）
            console.log('打开密码管理');
        }
    }
    
    return true;
}

// 检查并显示保存密码弹窗（供 main.js 直接调用）
async function checkAndShowSavePasswordDialog() {
    console.log('checkAndShowSavePasswordDialog', pendingLoginInfo);

    if (pendingLoginInfo) {
        return await showSavePasswordDialog();
    }
    return false;
}

module.exports = function registerPasswordManagerIpcHandlers(deps) {
    const {
        ipcMain,
        getShowDialog,
        getMainWindow
    } = deps;
    
    getShowDialogFunc = getShowDialog;
    getMainWindowFunc = getMainWindow;
    
    // 检测到登录表单提交时
    ipcMain.on('login-form-submitted', async (_event, loginInfo) => {
        console.log('login-form-submitted收到登录信息:', loginInfo);
        if (!loginInfo || !loginInfo.username || !loginInfo.password) {
            return;
        }
        
        pendingLoginInfo = loginInfo;
    });
    
    // 输入框获得焦点时
    ipcMain.on('input-box-focused', async (event, { url }) => {
        console.log('input-box-focused收到事件:', url);
        activeWebContents = event.sender;
        await showSavedPasswordsDialog(url);
    });
    
    // 检查并显示保存密码弹窗（供渲染进程调用）
    ipcMain.handle('check-and-show-save-password-dialog', async () => {
        const showed = await checkAndShowSavePasswordDialog();
        return { hasPending: showed };
    });
    
    // 获取保存的密码
    ipcMain.handle('get-saved-passwords', async () => {
        return getSavedPasswords();
    });
    
    // 根据 URL 获取密码
    ipcMain.handle('get-passwords-by-url', async (_event, url) => {
        return getPasswordsByUrl(url);
    });
    
    // 删除密码
    ipcMain.handle('delete-password', async (_event, id) => {
        return deletePassword(id);
    });
    
    // 手动触发保存密码对话框
    ipcMain.handle('show-save-password-dialog-manual', async (_event, loginInfo) => {
        if (!loginInfo || !loginInfo.username || !loginInfo.password) {
            return { success: false, error: '缺少必要信息' };
        }
        
        const showDialogFunc = getShowDialogFunc();
        if (!showDialogFunc) {
            console.error('showDialog function not available');
            return { success: false, error: 'showDialog function not available' };
        }
        
        const result = await showDialogFunc({
            title: '要保存密码吗？',
            message: '',
            confirmText: '保存',
            cancelText: '一律不',
            parentWindow: getMainWindowFunc(),
            type: 'save-password',
            username: loginInfo.username,
            password: loginInfo.password,
            modal: false,
        });
        
        if (result && typeof result === 'object' && result.confirmed) {
            const url = new URL(loginInfo.url);
            const saveResult = savePassword({
                url: loginInfo.url,
                hostname: url.hostname,
                username: result.username || loginInfo.username,
                password: result.password || loginInfo.password
            });
            
            return { success: saveResult.success, error: saveResult.error };
        }
        
        return { success: false, cancelled: true };
    });
    
    return { checkAndShowSavePasswordDialog };
};
