// 渲染进程使用示例
const { ipcRenderer } = require('electron');

// 示例 1: 只有确认按钮的简单弹窗
async function showSimpleDialog() {
    const result = await ipcRenderer.invoke('show-dialog', {
        title: '提示',
        message: '这是一条提示消息',
        confirmText: '好的'
    });
    console.log('用户点击了确认');
}

// 示例 2: 有确认和取消按钮的弹窗
async function showConfirmDialog() {
    const result = await ipcRenderer.invoke('show-dialog', {
        title: '确认',
        message: '确定要删除这个文件吗？',
        confirmText: '删除',
        cancelText: '取消'
    });
    if (result) {
        console.log('用户点击了确认删除');
    } else {
        console.log('用户点击了取消');
    }
}

// 示例 3: 保存密码弹窗
async function showSavePasswordDialog() {
    const result = await ipcRenderer.invoke('show-save-password-dialog', {
        title: '要保存密码吗？',
        message: '',
        confirmText: '保存',
        cancelText: '一律不',
        username: 'testuser@example.com',
        password: 'testpassword123'
    });
    
    if (result.confirmed) {
        console.log('用户点击了保存');
        console.log('用户名:', result.username);
        console.log('密码:', result.password);
    } else {
        console.log('用户点击了不保存');
    }
}

// 导出使用示例
module.exports = {
    showSimpleDialog,
    showConfirmDialog,
    showSavePasswordDialog
};
