// 渲染进程使用示例
const { ipcRenderer } = require('electron');

// 示例 1: 只有确认按钮的简单弹窗
async function showSimpleDialog() {
    const result = await ipcRenderer.invoke('show-dialog', {
        message: '这是一条提示消息',
        confirmText: '好的'
    });
    console.log('用户点击了确认');
}

// 示例 2: 有确认和取消按钮的弹窗
async function showConfirmDialog() {
    const result = await ipcRenderer.invoke('show-dialog', {
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

// 导出使用示例
module.exports = {
    showSimpleDialog,
    showConfirmDialog
};
