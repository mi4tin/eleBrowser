const { ipcMain, BrowserWindow } = require('electron');
const path = require('path');

let dialogWindow = null;
let dialogResolve = null;
let currentDialogType = null;
let parentWindowRef = null;
let initialDialogOffsetX = null;
let initialDialogOffsetY = null;
let parentMoveListener = null;

function createShowDialog(getMainWindow) {
    return function showDialog(options) {
        return new Promise((resolve) => {
            if (dialogWindow && !dialogWindow.isDestroyed()) {
                dialogWindow.focus();
                return;
            }

            console.log("createShowDialog", options);

            const {
                title = '',
                message = '',
                confirmText = '确定',
                cancelText = null,
                parentWindow = null,
                type = 'default',
                username = '',
                password = '',
                savedPasswords = [],
                modal = true,//是否为模态弹窗，为true时，其他窗口不能操作
                inputRect = null
            } = options;

            currentDialogType = type;

            const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
            const parent = parentWindow || mainWindow;

            let windowHeight = 180;
            let windowWidth = 320;
            if (type === 'save-password') {
                windowHeight = 320;
            } else if (type === 'show-saved-passwords') {
                const itemHeight = 60;
                const manageHeight = 60;
                const contentHeight = Math.min(savedPasswords.length * itemHeight + manageHeight, 280);
                windowHeight = contentHeight + 20;
                // 调整宽度为输入框宽度或最小宽度
                if (inputRect && inputRect.width) {
                    windowWidth = Math.max(280, Math.min(inputRect.width, 400));
                }
            }

            // 计算对话框位置
            let x = undefined;
            let y = undefined;
            const viewY = 82 + 50; // WebContentsView 的起始 y 坐标

             const contentBounds = parent.getContentBounds();
            const scaleFactor = parent.getContentSize()[0] / contentBounds.width; // 处理缩放
            if (parent && inputRect && inputRect.x !== undefined && inputRect.y !== undefined) {
               
                // 计算对话框的 x 位置（对齐输入框左侧）
                x = Math.round(inputRect.x / scaleFactor);

                // 计算对话框的 y 位置（显示在输入框下方）
                y = Math.round((viewY + inputRect.y + inputRect.height) / scaleFactor + 2);

                console.log('对话框位置计算:', {
                    inputRect,
                    contentBounds,
                    scaleFactor,
                    viewY,
                    x,
                    y
                });
            }

            dialogWindow = new BrowserWindow({
                x: x+contentBounds.x,
                y: y+contentBounds.y,
                width: windowWidth,
                height: windowHeight,
                minWidth: 280,
                minHeight: type === 'save-password' ? 280 : 150,
                transparent: true,
                frame: false,
                resizable: true,
                modal: type === 'show-saved-passwords' ? false : modal, // 密码列表非模态
                parent: parent,
                show: false,
                focusable: type !== 'show-saved-passwords', // 密码列表不可获取焦点
                acceptFirstMouse: true, // 允许点击直接激活而不获取焦点
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                }
            });

            // 构建 dialog.html 的路径
            const dialogHtmlPath = path.join(__dirname, '..', 'html', 'dialog', 'dialog.html');
            dialogWindow.loadFile(dialogHtmlPath);

            dialogWindow.once('ready-to-show', () => {
                if (type === 'show-saved-passwords') {
                    dialogWindow.showInactive(); // 显示但不获取焦点
                } else {
                    dialogWindow.show();
                }
                dialogWindow.webContents.send('dialog-init', {
                    title,
                    message,
                    confirmText,
                    cancelText,
                    type,
                    username,
                    password,
                    savedPasswords,
                });
            });

            // 保存初始偏移量
            if (parent && x !== undefined && y !== undefined) {
                parentWindowRef = parent;
                initialDialogOffsetX = (x + contentBounds.x) - parent.getPosition()[0];
                initialDialogOffsetY = (y + contentBounds.y) - parent.getPosition()[1];

                // 监听父窗口移动事件
                parentMoveListener = () => {
                    if (dialogWindow && !dialogWindow.isDestroyed() && parentWindowRef && !parentWindowRef.isDestroyed()) {
                        const [parentX, parentY] = parentWindowRef.getPosition();
                        dialogWindow.setPosition(
                            parentX + initialDialogOffsetX,
                            parentY + initialDialogOffsetY
                        );
                    }
                };
                parent.on('move', parentMoveListener);
            }

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
                currentDialogType = null;
                ipcMain.removeListener('dialog-result', handleDialogResult);
            };

            ipcMain.on('dialog-result', handleDialogResult);

            dialogWindow.on('closed', () => {
                if (dialogResolve) {
                    if (type === 'save-password' || type === 'show-saved-passwords') {
                        dialogResolve({ confirmed: false });
                    } else {
                        dialogResolve(false);
                    }
                    dialogResolve = null;
                }
                
                // 清理父窗口移动监听器
                if (parentWindowRef && !parentWindowRef.isDestroyed() && parentMoveListener) {
                    parentWindowRef.removeListener('move', parentMoveListener);
                }
                
                // 清理引用
                dialogWindow = null;
                currentDialogType = null;
                parentWindowRef = null;
                initialDialogOffsetX = null;
                initialDialogOffsetY = null;
                parentMoveListener = null;
                
                ipcMain.removeListener('dialog-result', handleDialogResult);
            });
        });
    };
}

// 关闭对话框的函数
function closeDialog() {
    console.log('closeDialog() 被调用');
    if (dialogWindow && !dialogWindow.isDestroyed()) {
        console.log('正在关闭对话框，类型:', currentDialogType);
        if (dialogResolve && currentDialogType === 'show-saved-passwords') {
            dialogResolve({ confirmed: false, action: 'cancel' });
            dialogResolve = null;
        }
        
        // 清理父窗口移动监听器
        if (parentWindowRef && !parentWindowRef.isDestroyed() && parentMoveListener) {
            parentWindowRef.removeListener('move', parentMoveListener);
        }
        
        dialogWindow.destroy();
        dialogWindow = null;
        currentDialogType = null;
        parentWindowRef = null;
        initialDialogOffsetX = null;
        initialDialogOffsetY = null;
        parentMoveListener = null;
        console.log('对话框已关闭');
    } else {
        console.log('没有打开的对话框可关闭');
    }
}

// 检查当前是否显示的是密码列表
function isShowingSavedPasswords() {
    return dialogWindow && !dialogWindow.isDestroyed() && currentDialogType === 'show-saved-passwords';
}

module.exports = {
    createShowDialog,
    closeDialog,
    isShowingSavedPasswords
};
