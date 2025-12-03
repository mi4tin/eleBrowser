const { app , BrowserWindow, Menu } = require('electron');

app.whenReady().then(() => {
    newWindow();
});


function newWindow() {
    const myWindow = new BrowserWindow({
        width: 500,
        height: 300,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    // myWindow.loadFile('html/index.html');
    myWindow.loadURL('https://www.douyin.com');
}

// 自定义应用菜单（包括 File / 文件 菜单）
const isMac = process.platform === 'darwin';

const template = [
    // macOS 上通常第一个是应用菜单
    ...(isMac ? [{
        label: app.name,
        submenu: [
            { role: 'about', label: '关于' },
            { type: 'separator' },
            { role: 'hide', label: '隐藏' },
            { role: 'hideOthers', label: '隐藏其他' },
            { role: 'unhide', label: '显示全部' },
            { type: 'separator' },
            { role: 'quit', label: '退出' }
        ]
    }] : []),
    {
        label: '文件',
        submenu: [
            {
                label: '刷新',
                accelerator: 'F5',
                click: (menuItem, browserWindow) => {
                    if (browserWindow) {
                        browserWindow.reload();
                    }
                }
            },
            { type: 'separator' },
            isMac
                ? { role: 'close', label: '关闭窗口' }
                : { role: 'quit', label: '退出' }
        ]
    },
    {
        label: '刷新',
        accelerator: 'F5',
        click: (menuItem, browserWindow) => {
            if (browserWindow) {
                browserWindow.reload();
            }
        }
    }
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit()
})
