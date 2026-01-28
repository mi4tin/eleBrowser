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
    
    // 监听控制台消息以调试问题
    contents.on('console-message', (event, level, message, line, sourceId) => {
        if (message.includes('xmtls') || message.includes('wasm') || message.includes('QQ')) {
            console.log(`[WebView Console] ${message}`);
        }
    });
    
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
        // 记录加载失败信息（排除 xmtls.wasm）
        if (!validatedURL.includes('xmtls.wasm') && errorCode !== 0 && errorCode !== -3) {
            console.log(`页面加载失败: ${validatedURL}, 错误代码: ${errorCode}, 描述: ${errorDescription}`);
        }
    });
}

// 存储 webview 的 webContents 映射
const webviewContentsMap = new Map();

// 拦截所有 webContents 的自定义协议请求（包括 webview）
app.on('web-contents-created', (event, contents) => {
    console.log("web-contents-created, ID:", contents.id, "URL:", contents.getURL());
    setupProtocolBlocking(contents);
    
    // 修改 CSP 以允许加载本地 wasm 文件等资源
    contents.session.webRequest.onHeadersReceived((details, callback) => {
        const responseHeaders = details.responseHeaders || {};
        
        // 如果存在 CSP 头，修改它以允许本地资源
        if (responseHeaders['content-security-policy']) {
            responseHeaders['content-security-policy'] = responseHeaders['content-security-policy'].map(csp => {
                // 为 connect-src 添加 file: 协议支持
                if (csp.includes('connect-src')) {
                    // 如果已有 connect-src，添加 file: 协议
                    return csp.replace(/connect-src ([^;]+)/g, 'connect-src $1 file:');
                }
                return csp;
            });
        }
        
        callback({ responseHeaders });
    });
    
    // 允许 webview 加载本地资源（Electron 内部资源）
    contents.session.webRequest.onBeforeRequest({ urls: ['file://*'] }, (details, callback) => {
        // 对于 xmtls.wasm 文件请求，返回一个空的 wasm 文件而不是取消请求
        if (details.url.includes('xmtls.wasm')) {
            console.log('拦截 xmtls.wasm 请求，提供空响应');
            // 不取消请求，而是让它继续（会失败，但 QQ 邮箱会处理失败情况）
            callback({});
            return;
        }
        
        // 允许加载 Electron 内部的其他资源文件
        if (details.url.includes('electron.asar') || details.url.includes('electron/dist')) {
            callback({ cancel: false });
        } else {
            callback({});
        }
    });
    
    // 为所有 webview 添加右键菜单
    // 检查是否是 webview（通过检查 hostWebContents 是否存在）
    const isWebview = contents.hostWebContents !== undefined;
    
    if (isWebview) {
        // 存储 webview 的 webContents
        const url = contents.getURL();
        if (url) {
            webviewContentsMap.set(url, contents);
        }
        
        // 添加右键菜单
        contents.on('context-menu', (event, params) => {
            const menu = Menu.buildFromTemplate([
                {
                    label: '查看网页源码',
                    click: () => {
                        // 获取页面源码
                        contents.executeJavaScript(`
                            (function() {
                                try {
                                    return document.documentElement.outerHTML;
                                } catch(e) {
                                    return '<html><body>无法获取源码</body></html>';
                                }
                            })()
                        `).then((html) => {
                            if (!html) {
                                html = '<html><body>无法获取源码</body></html>';
                            }
                            
                            // 创建新窗口显示源码
                            const sourceWindow = new BrowserWindow({
                                width: 1000,
                                height: 700,
                                title: '网页源码 - ' + (contents.getURL() || '未知页面'),
                                webPreferences: {
                                    nodeIntegration: false,
                                    contextIsolation: true
                                }
                            });
                            
                            // 转义 HTML 以便在文本中显示
                            const escapedHtml = html
                                .replace(/&/g, '&amp;')
                                .replace(/</g, '&lt;')
                                .replace(/>/g, '&gt;')
                                .replace(/"/g, '&quot;')
                                .replace(/'/g, '&#039;');
                            
                            // 创建显示源码的 HTML
                            const sourceHtml = `
                                <!DOCTYPE html>
                                <html>
                                <head>
                                    <meta charset="UTF-8">
                                    <title>网页源码</title>
                                    <style>
                                        * {
                                            margin: 0;
                                            padding: 0;
                                            box-sizing: border-box;
                                        }
                                        body {
                                            padding: 15px;
                                            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                                            font-size: 13px;
                                            background: #1e1e1e;
                                            color: #d4d4d4;
                                            overflow: auto;
                                            line-height: 1.5;
                                        }
                                        pre {
                                            margin: 0;
                                            white-space: pre-wrap;
                                            word-wrap: break-word;
                                        }
                                        .header {
                                            margin-bottom: 10px;
                                            padding-bottom: 10px;
                                            border-bottom: 1px solid #444;
                                        }
                                        .url {
                                            color: #569cd6;
                                            word-break: break-all;
                                        }
                                    </style>
                                </head>
                                <body>
                                    <div class="header">
                                        <div style="color: #858585; font-size: 11px;">页面URL:</div>
                                        <div class="url">${contents.getURL() || '未知'}</div>
                                    </div>
                                    <pre id="source">${escapedHtml}</pre>
                                </body>
                                </html>
                            `;
                            
                            sourceWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(sourceHtml));
                        }).catch((err) => {
                            console.error('获取源码失败:', err);
                            // 显示错误提示
                            const errorWindow = new BrowserWindow({
                                width: 400,
                                height: 200,
                                title: '错误',
                                webPreferences: {
                                    nodeIntegration: false,
                                    contextIsolation: true
                                }
                            });
                            errorWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
                                <html>
                                <body style="font-family: Arial; padding: 20px;">
                                    <h3>无法获取网页源码</h3>
                                    <p>错误信息: ${err.message || '未知错误'}</p>
                                </body>
                                </html>
                            `));
                        });
                    }
                },
                {
                    label: '打开开发者工具',
                    accelerator: 'F12',
                    click: () => {
                        contents.openDevTools();
                    }
                },
                { type: 'separator' },
                {
                    label: '刷新',
                    accelerator: 'F5',
                    click: () => {
                        contents.reload();
                    }
                },
                {
                    label: '强制刷新',
                    accelerator: 'Ctrl+F5',
                    click: () => {
                        contents.reloadIgnoringCache();
                    }
                }
            ]);
            
            menu.popup();
        });
    }
    
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


// IPC 处理器：打开指定标签页的开发者工具
ipcMain.on('open-devtools-for-webview', (event, tabId) => {
    // 通过 tabId 找到对应的 webview webContents
    // 由于 webview 的 webContents 在主进程中，我们需要通过其他方式找到它
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach(win => {
        if (win && !win.isDestroyed()) {
            // 发送消息到渲染进程，让渲染进程通过 tabId 找到 webview 并打开开发者工具
            win.webContents.send('open-devtools-for-tab', tabId);
        }
    });
});

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

// 书签数据文件路径
const path = require('path');
const fs = require('fs');
const bookmarksFilePath = path.join(app.getPath('userData'), 'bookmarks.json');

// 历史记录数据文件路径
const historyFilePath = path.join(app.getPath('userData'), 'history.json');

// 确保userData目录存在
const userDataPath = app.getPath('userData');
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}

// IPC 处理器：加载书签数据
ipcMain.on('load-bookmarks', (event) => {
    console.log('收到加载书签请求',bookmarksFilePath);
    try {
        if (fs.existsSync(bookmarksFilePath)) {
            const data = fs.readFileSync(bookmarksFilePath, 'utf8');
            const bookmarks = JSON.parse(data);
            event.reply('load-bookmarks-reply', bookmarks);
        } else {
            event.reply('load-bookmarks-reply', null);
        }
    } catch (e) {
        console.error('加载书签数据失败:', e);
        event.reply('load-bookmarks-reply', null);
    }
});

// IPC 处理器：保存书签数据
ipcMain.on('save-bookmarks', (event, bookmarks) => {
    console.log('收到保存书签请求');
    try {
        fs.writeFileSync(bookmarksFilePath, JSON.stringify(bookmarks, null, 2), 'utf8');
        event.reply('save-bookmarks-reply', { success: true });
    } catch (e) {
        console.error('保存书签数据失败:', e);
        event.reply('save-bookmarks-reply', { success: false, error: e.message });
    }
});

// IPC 处理器：记录浏览历史
ipcMain.handle('record-history', (event, title, url) => {
    try {
        let history = [];
        
        // 检查历史记录文件是否存在
        if (fs.existsSync(historyFilePath)) {
            const data = fs.readFileSync(historyFilePath, 'utf8');
            history = JSON.parse(data);
        }
        
        // 检查是否已存在相同的URL（避免重复）
        const existingIndex = history.findIndex(item => item.url === url);
        if (existingIndex !== -1) {
            history.splice(existingIndex, 1);
        }
        
        // 创建新的历史记录项
        const historyItem = {
            id: Date.now() + Math.random(),
            title: title || url,
            url: url,
            timestamp: Date.now(),
            date: new Date().toLocaleDateString(),
            time: new Date().toLocaleTimeString()
        };
        
        // 将新记录添加到开头
        history.unshift(historyItem);
        
        // 只保留最近的1000条记录
        if (history.length > 1000) {
            history = history.slice(0, 1000);
        }
        
        // 保存到文件
        fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2), 'utf8');
        
        return { success: true };
    } catch (e) {
        console.error('保存历史记录失败:', e);
        return { success: false, error: e.message };
    }
});

// IPC 处理器：删除单个历史记录项
ipcMain.handle('remove-history-item', (event, id) => {
    try {
        let history = [];
        
        // 检查历史记录文件是否存在
        if (fs.existsSync(historyFilePath)) {
            const data = fs.readFileSync(historyFilePath, 'utf8');
            history = JSON.parse(data);
            
            // 过滤掉指定ID的记录
            history = history.filter(item => item.id !== id);
            
            // 保存到文件
            fs.writeFileSync(historyFilePath, JSON.stringify(history, null, 2), 'utf8');
        }
        
        return { success: true };
    } catch (e) {
        console.error('删除历史记录失败:', e);
        return { success: false, error: e.message };
    }
});

// IPC 处理器：获取历史记录
ipcMain.handle('get-history', (event) => {
    try {
        let history = [];
        
        // 检查历史记录文件是否存在
        if (fs.existsSync(historyFilePath)) {
            const data = fs.readFileSync(historyFilePath, 'utf8');
            history = JSON.parse(data);
        }
        
        return history;
    } catch (e) {
        console.error('获取历史记录失败:', e);
        return [];
    }
});

// IPC 处理器：清空所有历史记录
ipcMain.handle('clear-history', (event) => {
    try {
        // 直接创建空数组并保存
        fs.writeFileSync(historyFilePath, JSON.stringify([], null, 2), 'utf8');
        
        return { success: true };
    } catch (e) {
        console.error('清空历史记录失败:', e);
        return { success: false, error: e.message };
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
            },
            {
                label: '浏览历史',
                accelerator: isMac ? 'Cmd+H' : 'Ctrl+H',
                click: () => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('open-history-tab');
                        if (mainWindow.isMinimized()) {
                            mainWindow.restore();
                        }
                        mainWindow.focus();
                    }
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
