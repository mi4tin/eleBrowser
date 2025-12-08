const { app , BrowserWindow, Menu, BrowserWindow: BW, session, protocol } = require('electron');

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
            return { action: 'allow' };
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


function newWindow() {
    const myWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: true,
            // 禁用外部协议处理，防止系统弹窗
            disableDialogs: false
        }
    });


    console.log("crt")
    
    // 在主窗口的 webContents 上也设置拦截（双重保险）
    setupProtocolBlocking(myWindow.webContents);
    
    myWindow.loadFile('html/index.html');
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
    }
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit()
})
