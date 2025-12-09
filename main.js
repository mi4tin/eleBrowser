const { app , BrowserWindow, Menu, BrowserWindow: BW, session, protocol, ipcMain } = require('electron');

// 辅助函数：检查是否为自定义协议
function isCustomProtocol(url) {
    if (!url) return false;
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'file:';
    } catch (e) {
        // 如果 URL 解析失败，检查是否以常见协议开头
        return !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://');
    }
}

// 处理协议请求，阻止系统弹窗（macOS 和 Windows）
app.on('open-url', (event, url) => {
    event.preventDefault();
    console.log('阻止协议请求:', url);
});

// Windows 上处理协议请求（通过命令行参数）
if (process.platform === 'win32') {
    // 单实例锁定 - 必须在处理协议参数之前
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        // 如果已经有实例在运行，退出当前实例
        app.quit();
        return;
    }
    
    // 处理第二个实例（可能是通过协议启动）
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // 如果应用已经运行，第二个实例被启动（可能是协议链接）
        const protocolUrl = commandLine.find(arg => arg && (arg.includes('://') || arg.startsWith('bytedance') || arg.startsWith('douyin') || arg.startsWith('snssdk')));
        if (protocolUrl) {
            console.log('阻止协议请求（第二个实例）:', protocolUrl);
            // 不创建新窗口，直接返回
            return;
        }
        // 如果没有协议参数，激活现有窗口
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });
    
    // 处理首次启动时的协议参数 - 直接忽略，不处理
    const hasProtocolArg = process.argv.some(arg => 
        arg && (arg.includes('://') || arg.startsWith('bytedance') || arg.startsWith('douyin') || arg.startsWith('snssdk'))
    );
    if (hasProtocolArg) {
        console.log('检测到协议参数，已忽略');
    }
}

// 为 webContents 设置协议拦截
function setupProtocolBlocking(contents) {
    console.log('设置协议拦截，webContents ID:', contents.id);
    
    // 拦截导航到自定义协议
    contents.on('will-navigate', (event, navigationUrl) => {
        console.log('will-navigate 事件:', navigationUrl);
        if (isCustomProtocol(navigationUrl)) {
            event.preventDefault();
            console.log('✓ 阻止导航到自定义协议:', navigationUrl);
        }
    });

    // 使用 setWindowOpenHandler 拦截新窗口（Electron 5+）
    if (contents.setWindowOpenHandler) {
        contents.setWindowOpenHandler(({ url }) => {
            console.log('setWindowOpenHandler 事件:', url);
            if (isCustomProtocol(url)) {
                console.log('✓ 阻止打开自定义协议窗口:', url);
                return { action: 'deny' };
            }
            // 对于普通 http/https 链接，阻止新窗口并让渲染进程新建标签
            if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                try {
                    // 将消息发给宿主（包含标签 UI 的页面）
                    const hostContents = contents.hostWebContents || contents;
                    hostContents.send('open-url-in-new-tab', url);
                } catch (err) {
                    console.log('转发 open-url-in-new-tab 失败:', err.message);
                }
                return { action: 'deny' };
            }
            return { action: 'deny' };
        });
    } else {
        // 兼容旧版本 Electron
        contents.on('new-window', (event, navigationUrl) => {
            console.log('new-window 事件:', navigationUrl);
            if (isCustomProtocol(navigationUrl)) {
                event.preventDefault();
                console.log('✓ 阻止打开自定义协议窗口:', navigationUrl);
            }
        });
    }
    
    // 额外拦截：监听所有导航请求
    contents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        if (isCustomProtocol(validatedURL)) {
            console.log('✓ 阻止加载失败的自定义协议:', validatedURL);
        }
    });
}

// 拦截所有 webContents 的自定义协议请求（包括 webview）
app.on('web-contents-created', (event, contents) => {
    console.log("web-contents-created, ID:", contents.id, "URL:", contents.getURL());
    setupProtocolBlocking(contents);
    
    // 特别处理 webview 的 webContents
    contents.on('will-attach-webview', (event, webPreferences, params) => {
        console.log('will-attach-webview, src:', params.src);
        // webview 的 webContents 会在创建后触发 web-contents-created
        // 所以上面的 setupProtocolBlocking 会自动处理
    });
});

app.whenReady().then(() => {
    app.setAppUserModelId('com.elebrowser.app');
    // 在应用内注册空协议处理器，避免抛给系统
    const customProtocols = ['bytedance', 'douyin', 'snssdk'];
    customProtocols.forEach((scheme) => {
        try {
            protocol.registerStringProtocol(scheme, (request, callback) => {
                console.log(`protocol handler -> ${scheme}:`, request.url);
                callback({ data: '' });
            });
        } catch (e) {
            console.log(`protocol handler register failed ${scheme}:`, e.message);
        }
    });

    // 注册自定义协议 dxbrowser://
    try {
        protocol.registerStringProtocol('dxbrowser', (request, callback) => {
            const url = request.url;
            console.log('dxbrowser protocol:', url);
            
            // 处理 dxbrowser://bookmarks/ 请求
            if (url.includes('bookmarks')) {
                // 在主窗口的标签页中打开书签管理器
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('open-bookmarks-tab');
                    if (mainWindow.isMinimized()) {
                        mainWindow.restore();
                    }
                    mainWindow.focus();
                } else {
                    newWindow();
                    mainWindow.webContents.once('did-finish-load', () => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('open-bookmarks-tab');
                        }
                    });
                }
                // 返回一个空白页面
                callback({ data: '<html><body><script>window.close();</script></body></html>', mimeType: 'text/html' });
            } else {
                callback({ data: '' });
            }
        });
    } catch (e) {
        console.log('dxbrowser protocol handler register failed:', e.message);
    }

    // 全局请求拦截：阻止非 http/https/file 协议，防止系统弹窗
    const filter = { urls: ['*://*/*'] };
    session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
        const url = details.url || '';
        if (isCustomProtocol(url)) {
            console.log('webRequest 阻止自定义协议:', url);
            return callback({ cancel: true });
        }
        return callback({});
    });

    newWindow();
});


let mainWindow = null;

function newWindow() {
    console.log("icon",__dirname + '/assets/icon.ico')
    const myWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        icon: __dirname + '/assets/icon.ico',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: true,
            // 禁用外部协议处理，防止系统弹窗
            disableDialogs: false
        }
    });

    mainWindow = myWindow;

    console.log("crt")
    
    // 在主窗口的 webContents 上也设置拦截（双重保险）
    setupProtocolBlocking(myWindow.webContents);
    
    myWindow.loadFile('html/index.html');

    // 监听窗口关闭
    myWindow.on('closed', () => {
        mainWindow = null;
    });
}

function openBookmarksWindow() {
    // 在主窗口的标签页中打开书签管理器
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('open-bookmarks-tab');
        // 如果主窗口最小化，则恢复并聚焦
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.focus();
    } else {
        // 如果主窗口不存在，创建一个新窗口
        newWindow();
        // 等待窗口加载完成后再打开书签管理器
        mainWindow.webContents.once('did-finish-load', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('open-bookmarks-tab');
            }
        });
    }
}

// IPC 处理器：从书签管理窗口打开书签
ipcMain.on('open-bookmark', (event, url) => {
    console.log('收到打开书签请求:', url);
    // 在主窗口中打开书签
    if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('发送到主窗口:', url);
        mainWindow.webContents.send('open-url-in-new-tab', url);
        // 如果主窗口最小化，则恢复并聚焦
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.focus();
    } else {
        console.log('主窗口不存在，创建新窗口');
        // 如果主窗口不存在，创建一个新窗口
        newWindow();
        // 等待窗口加载完成后再发送URL
        mainWindow.webContents.once('did-finish-load', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                console.log('主窗口加载完成，发送URL:', url);
                mainWindow.webContents.send('open-url-in-new-tab', url);
            }
        });
    }
});

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
                label: '新建页卡',
                accelerator: isMac ? 'Cmd+T' : 'Ctrl+T',
                click: () => {
                    const win = BrowserWindow.getFocusedWindow();
                    if (win) {
                        win.webContents.send('new-tab');
                    }
                }
            },
            { type: 'separator' },
            {
                label: '刷新当前页卡',
                accelerator: 'F5',
                click: (menuItem, browserWindow) => {
                    const win = browserWindow || BrowserWindow.getFocusedWindow();
                    if (win) {
                        win.webContents.send('refresh-tab');
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
    },
    {
        label: '书签',
        submenu: [
            {
                label: '书签管理',
                accelerator: isMac ? 'Cmd+Shift+B' : 'Ctrl+Shift+B',
                click: () => {
                    openBookmarksWindow();
                }
            }
        ]
    }
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit()
})
