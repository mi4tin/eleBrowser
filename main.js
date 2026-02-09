const { app , BrowserWindow, BrowserView, Menu, BrowserWindow: BW, session, protocol, ipcMain, globalShortcut } = require('electron');

// BrowserView管理器 - 存储所有BrowserView实例
const browserViews = new Map(); // Map<tabId, BrowserView>
let tabIdCounter = 0; // 标签页ID计数器

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

// BrowserView管理函数

/**
 * 创建新的BrowserView
 * @param {BrowserWindow} window - 父窗口
 * @param {string} url - 要加载的URL
 * @returns {number} tabId - 新创建的标签页ID
 */
function createBrowserView(window, url = 'https://www.baidu.com') {
    const tabId = ++tabIdCounter;
    
    // 创建BrowserView实例
    const view = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // 禁用外部协议处理，防止系统弹窗
            disableDialogs: false
        }
    });
    
    // 存储BrowserView实例
    browserViews.set(tabId, view);
    
    // 设置BrowserView到窗口
    window.addBrowserView(view);
    
    // 设置BrowserView的尺寸和位置
    const contentBounds = window.getContentBounds();
    view.setBounds({
        x: 0,
        y: 82, // toolbar高度
        width: contentBounds.width,
        height: contentBounds.height - 82
    });
    
    // 加载URL
    view.webContents.loadURL(url);
    
    console.log(`创建BrowserView，tabId: ${tabId}, URL: ${url}`);
    
    return tabId;
}

/**
 * 激活指定的BrowserView
 * @param {BrowserWindow} window - 父窗口
 * @param {number} tabId - 要激活的标签页ID
 */
function activateBrowserView(window, tabId) {
    const view = browserViews.get(tabId);
    if (!view) {
        console.error(`未找到tabId为${tabId}的BrowserView`);
        return;
    }
    
    // 隐藏所有BrowserView
    browserViews.forEach(v => {
        window.removeBrowserView(v);
    });
    
    // 显示指定的BrowserView
    window.addBrowserView(view);
    
    console.log(`激活BrowserView，tabId: ${tabId}`);
}

/**
 * 关闭指定的BrowserView
 * @param {BrowserWindow} window - 父窗口
 * @param {number} tabId - 要关闭的标签页ID
 */
function closeBrowserView(window, tabId) {
    const view = browserViews.get(tabId);
    if (!view) {
        console.error(`未找到tabId为${tabId}的BrowserView`);
        return;
    }
    
    // 从窗口移除BrowserView
    window.removeBrowserView(view);
    
    // 销毁BrowserView
    view.webContents.destroy();
    
    // 从存储中删除
    browserViews.delete(tabId);
    
    console.log(`关闭BrowserView，tabId: ${tabId}`);
}

/**
 * 调整所有BrowserView的尺寸（当窗口大小改变时调用）
 * @param {BrowserWindow} window - 父窗口
 */
function resizeBrowserViews(window) {
    const contentBounds = window.getContentBounds();
    browserViews.forEach(view => {
        view.setBounds({
            x: 0,
            y: 82,
            width: contentBounds.width,
            height: contentBounds.height - 82
        });
    });
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
    
    // 监听控制台消息以调试问题（使用新的 Event 对象格式）
    contents.on('console-message', (event) => {
        const { level, message, line, sourceId } = event;
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
    
    // 注册全局事件监听器用于调试
    const handleSaveUnderlineRequest = (url, underlineInfo) => {
        console.log('全局监听到划线保存请求:', url, underlineInfo);
        saveUnderlineDirect(url, underlineInfo);
    };
    
    // 将处理函数绑定到app上
    app.removeAllListeners('save-underline-request-debug');
    app.on('save-underline-request-debug', handleSaveUnderlineRequest);
    
    if (isWebview) {
        // 存储 webview 的 webContents
        const url = contents.getURL();
        if (url) {
            webviewContentsMap.set(url, contents);
        }
        
        // 添加右键菜单
        contents.on('context-menu', (event, params) => {
            // 根据选中的文本决定是否启用复制选项
            const text = params.selectionText ? params.selectionText.trim() : '';
            const hasSelection = text.length > 0;

            var selectedMenu=[]//选中文本的菜单项
            var underlineMenu=[];//划线相关菜单项
            
            //基础菜单项
            var baseMenu=[ {
                        label: '查看网页源码',
                        click: () => {
                            // 查看源码逻辑
                            handleViewSource(contents);
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
                    }];

            var preview='';
            if(hasSelection){
                underlineMenu=[{
                        label: '添加下划线',
                        enabled: hasSelection,
                        click: () => {
                            handleAddUnderline(contents);
                        }
                    }]

                preview = text && text.length > 30 ? text.slice(0, 30) + '…' : text;
                selectedMenu=[ {
                            label: text ? `在百度中搜索 "${preview}"` : '在百度中搜索',
                            enabled: hasSelection,
                            click: () => {
                                try {
                                    const t = params.selectionText ? params.selectionText.trim() : '';
                                    if (t && mainWindow && !mainWindow.isDestroyed()) {
                                        const url = 'https://www.baidu.com/s?wd=' + encodeURIComponent(t);
                                        mainWindow.webContents.send('open-url-in-new-tab', url);
                                    }
                                } catch (err) {
                                    console.error('发送百度搜索消息失败:', err);
                                }
                            }
                    },
                    
                    {
                        label: '复制',
                        enabled: hasSelection,  // 只有当选中了文本时才启用
                        accelerator: 'Ctrl+C',
                        click: () => {
                            // 复制选中的文本到剪贴板
                            contents.copy();
                        }
                    },
                    {
                        label: '在页面中搜索选中文本',
                        enabled: hasSelection,
                        click: () => {
                            try {
                                const text = params.selectionText ? params.selectionText.trim() : '';
                                if (mainWindow && !mainWindow.isDestroyed()) {
                                    mainWindow.webContents.send('show-search-panel-with-text', text);
                                }
                            } catch (err) {
                                console.error('发送搜索选中文本消息失败:', err);
                            }
                        }
                    }]
            }
            
            // 检查右键点击位置是否有划线元素
            contents.executeJavaScript(
                `(function() {
                    // 获取鼠标位置的元素
                    const element = document.elementFromPoint(${params.x}, ${params.y});
                    if (!element) return { hasUnderline: false };

                    console.log('右键点击元素:', element.tagName, element.className, element,element.classList);
                    
                    // 检查元素本身是否是划线元素
                    if (element.classList && element.classList.contains('underline-fb3b780f')||
                    element.querySelector('.underline-fb3b780f') !== null) {
                        console.log('直接点击了划线元素');
                        return { hasUnderline: true };
                    }
                    
                    // 检查元素或其祖先是否有下划线类
                    let current = element.parentElement; // 从父元素开始检查
                    let foundUnderlineElement = null;
                    while (current && current !== document.body) {
                        if (current.classList && current.classList.contains('underline-fb3b780f')) {
                            foundUnderlineElement = current;
                            console.log('在祖先元素中找到划线元素:', current.tagName, current.className);
                            break;
                        }
                        current = current.parentElement;
                    }
                    
                    if (foundUnderlineElement) {
                        return { hasUnderline: true };
                    }
                    
                    // 如果没有找到划线元素，但有选中文本，则可以添加下划线
                    return { hasUnderline: false };
                })()`
            ).then(elementCheckResult => {
                console.log('元素检查结果:', elementCheckResult);

                if(elementCheckResult.hasUnderline|| hasSelection){
                    underlineMenu=[ {
                        label: elementCheckResult.hasUnderline ? '取消划线' : '添加下划线',
                        enabled: true,
                        click: () => {
                            if (elementCheckResult.hasUnderline) {
                                // 取消划线逻辑
                                handleRemoveUnderline(contents);
                            } else {
                                // 添加下划线逻辑
                                handleAddUnderline(contents);
                            }
                        }
                    }]
                }

                
                const menu = Menu.buildFromTemplate([
                   ...selectedMenu,
                   ...underlineMenu,
                   ...baseMenu,
                ]);
                
                menu.popup();
            }).catch(error => {
                console.error('执行右键菜单JavaScript时发生错误:', error);
                // 创建一个简化版的菜单作为后备方案
                const menu = Menu.buildFromTemplate([
                    // 在百度中搜索选中文本（后备菜单）
                    ...selectedMenu,
                    ...underlineMenu,
                   ...baseMenu
                ]);
                
                menu.popup();
            });
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

    // 应用启动时不立即注册快捷键，等待窗口创建后再注册

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

    // 监听窗口大小改变，调整BrowserView尺寸
    myWindow.on('resize', () => {
        resizeBrowserViews(myWindow);
    });

    // 检查是否需要打开测试页面
    const shouldOpenTestPage = process.argv.includes('--test-search');
    if (shouldOpenTestPage) {
        // 延迟一点打开测试页面，确保主页面已加载
        setTimeout(() => {
            if (myWindow && !myWindow.isDestroyed()) {
                const testPagePath = 'file:///' + __dirname.replace(/\\/g, '/') + '/search-demo.html';
                console.log('打开测试页面:', testPagePath);
                myWindow.webContents.send('open-url-in-new-tab', testPagePath);
            }
        }, 1000);
    }

    // 监听窗口焦点变化
    myWindow.on('focus', () => {
        console.log('窗口获得焦点，注册快捷键');
        registerAppShortcuts();
    });
    
    myWindow.on('blur', () => {
        console.log('窗口失去焦点，注销快捷键');
        unregisterAppShortcuts();
    });
    
    // 监听窗口关闭
    myWindow.on('closed', () => {
        mainWindow = null;
        // 窗口关闭时注销快捷键
        unregisterAppShortcuts();
        // 清理所有BrowserView
        browserViews.clear();
        tabIdCounter = 0;
    });
    
    // 窗口创建后立即注册快捷键（因为新窗口默认是有焦点的）
    registerAppShortcuts();
}

// 存储已注册的快捷键
let registeredShortcuts = [];

// 注册应用内快捷键（仅在应用获得焦点时生效）
function registerAppShortcuts() {
    try {
        // 先注销已存在的快捷键
        unregisterAppShortcuts();
        
        const shortcutsToRegister = [
            {
                key: 'CommandOrControl+F',
                name: '文本搜索',
                action: () => {
                    console.log('应用内快捷键: 打开文本搜索');
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('show-search-panel');
                    }
                }
            },
            {
                key: 'CommandOrControl+T',
                name: '新建标签页',
                action: () => {
                    console.log('应用内快捷键: 新建标签页');
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('new-tab');
                    }
                }
            },
            {
                key: 'F5',
                name: '刷新页面',
                action: () => {
                    console.log('应用内快捷键: 刷新页面');
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('refresh-tab');
                    }
                }
            },
            {
                key: 'CommandOrControl+F5',
                name: '强制刷新页面',
                action: () => {
                    console.log('应用内快捷键: 强制刷新页面');
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('force-refresh-tab');
                    }
                }
            },
            {
                key: 'CommandOrControl+Shift+B',
                name: '打开书签管理',
                action: () => {
                    console.log('应用内快捷键: 打开书签管理');
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('open-bookmarks-tab');
                    }
                }
            },
            {
                key: 'CommandOrControl+H',
                name: '打开历史记录',
                action: () => {
                    console.log('应用内快捷键: 打开历史记录');
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('open-history-tab');
                    }
                }
            },
            {
                key: 'CommandOrControl+U',
                name: '打开划线记录',
                action: () => {
                    console.log('应用内快捷键: 打开划线记录');
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('open-underline-tab');
                    }
                }
            },
            {
                key: 'F12',
                name: '打开开发者工具',
                action: () => {
                    console.log('应用内快捷键: 打开开发者工具');
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.openDevTools();
                    }
                }
            }
        ];

        const successfulShortcuts = [];
        const failedShortcuts = [];

        shortcutsToRegister.forEach(shortcutConfig => {
            try {
                const shortcut = globalShortcut.register(shortcutConfig.key, shortcutConfig.action);
                if (shortcut) {
                    successfulShortcuts.push({
                        key: shortcutConfig.key,
                        name: shortcutConfig.name,
                        shortcut: shortcut
                    });
                    console.log(`✓ 已注册快捷键: ${shortcutConfig.name} (${shortcutConfig.key})`);
                } else {
                    failedShortcuts.push({
                        key: shortcutConfig.key,
                        name: shortcutConfig.name
                    });
                    console.log(`✗ 快捷键注册失败: ${shortcutConfig.name} (${shortcutConfig.key})`);
                }
            } catch (registerError) {
                failedShortcuts.push({
                    key: shortcutConfig.key,
                    name: shortcutConfig.name
                });
                console.log(`✗ 快捷键注册异常: ${shortcutConfig.name} (${shortcutConfig.key}) - ${registerError.message}`);
            }
        });

        // 存储已注册的快捷键
        registeredShortcuts = successfulShortcuts.map(s => s.shortcut);

        if (failedShortcuts.length > 0) {
            console.log(`注册失败的快捷键数量: ${failedShortcuts.length}`);
            console.log('失败的快捷键列表:', failedShortcuts.map(f => `${f.name} (${f.key})`).join(', '));
        } else {
            console.log('所有快捷键注册成功');
        }
    } catch (error) {
        console.error('注册快捷键过程中发生严重错误:', error);
        registeredShortcuts = [];
    }
}

// 注销应用内快捷键
function unregisterAppShortcuts() {
    try {
        // 使用 globalShortcut.unregisterAll() 来确保完全清理
        globalShortcut.unregisterAll();
        registeredShortcuts = [];
        console.log('已注销所有应用内快捷键');
    } catch (error) {
        console.error('注销快捷键过程中发生错误:', error);
        registeredShortcuts = []; // 确保数组被清空
    }
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


// IPC 处理器：处理BrowserView相关操作

/**
 * 创建新的BrowserView标签页
 */
ipcMain.handle('create-browser-view', (event, url) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
        throw new Error('无法获取窗口实例');
    }
    return createBrowserView(window, url);
});

/**
 * 激活指定的BrowserView标签页
 */
ipcMain.handle('activate-browser-view', (event, tabId) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
        throw new Error('无法获取窗口实例');
    }
    activateBrowserView(window, tabId);
});

/**
 * 关闭指定的BrowserView标签页
 */
ipcMain.handle('close-browser-view', (event, tabId) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
        throw new Error('无法获取窗口实例');
    }
    closeBrowserView(window, tabId);
});

/**
 * 导航操作：后退
 */
ipcMain.handle('browser-view-go-back', (event, tabId) => {
    const view = browserViews.get(tabId);
    if (view && view.webContents.canGoBack()) {
        view.webContents.goBack();
        return true;
    }
    return false;
});

/**
 * 导航操作：前进
 */
ipcMain.handle('browser-view-go-forward', (event, tabId) => {
    const view = browserViews.get(tabId);
    if (view && view.webContents.canGoForward()) {
        view.webContents.goForward();
        return true;
    }
    return false;
});

/**
 * 导航操作：刷新
 */
ipcMain.handle('browser-view-reload', (event, tabId) => {
    const view = browserViews.get(tabId);
    if (view) {
        view.webContents.reload();
        return true;
    }
    return false;
});

/**
 * 导航操作：强制刷新
 */
ipcMain.handle('browser-view-reload-ignoring-cache', (event, tabId) => {
    const view = browserViews.get(tabId);
    if (view) {
        view.webContents.reloadIgnoringCache();
        return true;
    }
    return false;
});

/**
 * 加载指定URL
 */
ipcMain.handle('browser-view-load-url', (event, tabId, url) => {
    const view = browserViews.get(tabId);
    if (view) {
        view.webContents.loadURL(url);
        return true;
    }
    return false;
});

/**
 * 获取当前URL
 */
ipcMain.handle('browser-view-get-url', (event, tabId) => {
    const view = browserViews.get(tabId);
    if (view) {
        return view.webContents.getURL();
    }
    return '';
});

/**
 * 获取页面标题
 */
ipcMain.handle('browser-view-get-title', (event, tabId) => {
    const view = browserViews.get(tabId);
    if (view) {
        return view.webContents.getTitle();
    }
    return '';
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

// IPC 处理器：从历史记录或其他地方打开URL
ipcMain.on('open-url-in-new-tab', (event, url) => {
    console.log('收到打开URL请求:', url);
    // 在主窗口中打开URL
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

// 划线数据文件路径
const underlineFilePath = path.join(app.getPath('userData'), 'underline.json');

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

// IPC 处理器：加载划线数据
ipcMain.handle('load-underline-data', async (event, url) => {
    console.log('收到加载划线数据请求1', url);
    try {
        let underlineData = {};
        
        if (fs.existsSync(underlineFilePath)) {
            const data = fs.readFileSync(underlineFilePath, 'utf8');
            underlineData = JSON.parse(data);
        }
        
        // 返回特定URL的划线数据
        return underlineData[url] || [];
    } catch (e) {
        console.error('加载划线数据失败:', e);
        return [];
    }
});

// IPC 处理器：保存划线数据
ipcMain.handle('save-underline-data', async (event, url, underlineInfo) => {
    try {
        let underlineData = {};
        console.log("保存划线数据:", url, underlineInfo)
        
        // 检查划线数据文件是否存在
        if (fs.existsSync(underlineFilePath)) {
            const data = fs.readFileSync(underlineFilePath, 'utf8');
            underlineData = JSON.parse(data);
        }
        
        // 更新特定URL的划线数据
        if (!underlineData[url]) {
            underlineData[url] = [];
        }
        
        // 添加新的划线信息
        underlineData[url].push(underlineInfo);
        
        // 保存到文件
        fs.writeFileSync(underlineFilePath, JSON.stringify(underlineData, null, 2), 'utf8');
        
        return { success: true };
    } catch (e) {
        console.error('保存划线数据失败:', e);
        return { success: false, error: e.message };
    }
});

// IPC 处理器：更新划线数据（替换整个URL的划线数据）
ipcMain.handle('update-underline-data', async (event, url, underlineArray) => {
    try {
        let underlineData = {};
        
        // 检查划线数据文件是否存在
        if (fs.existsSync(underlineFilePath)) {
            const data = fs.readFileSync(underlineFilePath, 'utf8');
            underlineData = JSON.parse(data);
        }
        
        // 更新特定URL的划线数据
        underlineData[url] = underlineArray;
        
        // 保存到文件
        fs.writeFileSync(underlineFilePath, JSON.stringify(underlineData, null, 2), 'utf8');
        
        return { success: true };
    } catch (e) {
        console.error('更新划线数据失败:', e);
        return { success: false, error: e.message };
    }
});

// 处理直接保存划线数据的请求
const saveUnderlineDirect = async (url, underlineInfo) => {
    try {
        console.log('开始保存划线数据:', url, underlineInfo);
        
        // 确保 userData 目录存在
        const userDataPath = app.getPath('userData');
        if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
            console.log('创建 userData 目录:', userDataPath);
        }
        
        let underlineData = {};
        
        // 检查划线数据文件是否存在
        if (fs.existsSync(underlineFilePath)) {
            try {
                const data = fs.readFileSync(underlineFilePath, 'utf8');
                underlineData = JSON.parse(data);
                console.log('读取现有划线数据成功');
            } catch (readError) {
                console.error('读取划线数据文件失败:', readError);
                underlineData = {};
            }
        }
        
        // 更新特定URL的划线数据
        if (!underlineData[url]) {
            underlineData[url] = [];
        }
        
        // 添加新的划线信息
        underlineData[url].push(underlineInfo);
        
        // 保存到文件
        fs.writeFileSync(underlineFilePath, JSON.stringify(underlineData, null, 2), 'utf8');
        
        console.log('成功保存划线数据:', url, underlineInfo.text);
    } catch (e) {
        console.error('保存划线数据失败:', e);
        console.error('错误详情:', e.stack);
    }
};

// 注册IPC处理器供渲染进程调用
ipcMain.handle('save-underline-sync', async (event, url, underlineInfo) => {
    await saveUnderlineDirect(url, underlineInfo);
    return { success: true };
});

// 调试用：获取所有划线数据
ipcMain.handle('get-all-underlines', async (event) => {
    try {
        if (fs.existsSync(underlineFilePath)) {
            const data = fs.readFileSync(underlineFilePath, 'utf8');
            return JSON.parse(data);
        }
        return {};
    } catch (e) {
        console.error('获取所有划线数据失败:', e);
        return {};
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
    // {
    //     label: '刷新',
    //     accelerator: 'F5',
    //     click: (menuItem, browserWindow) => {
    //         if (browserWindow) {
    //             browserWindow.reload();
    //         }
    //     }
    // },
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
            },
            {
                label: '划线记录',
                accelerator: isMac ? 'Cmd+U' : 'Ctrl+U',
                click: () => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('open-underline-tab');
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

// 在应用程序退出前注销所有快捷键
app.on('will-quit', () => {
    unregisterAppShortcuts();
    // 确保完全清理所有快捷键
    globalShortcut.unregisterAll();
});

// 关闭所有窗口时退出应用
app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit()
})

// 处理添加下划线的函数
function handleAddUnderline(contents) {
    contents.executeJavaScript('window.getSelection().toString()')
    .then((selectedText) => {
        // 为选中的文本添加绿色下划线
        contents.executeJavaScript(
            `(function() {
                // 检查并注入划线样式
                if (!document.getElementById('underline-styles')) {
                    const style = document.createElement('style');
                    style.id = 'underline-styles';
                    style.textContent = '.underline-fb3b780f { text-decoration: underline; text-decoration-color: green; text-decoration-style: solid; text-decoration-thickness: 2px; text-underline-offset: 3px; }';
                    document.head.appendChild(style);
                }
                
                // 获取用户选择的范围
                const selectedTextObj = window.getSelection();
                if (selectedTextObj.rangeCount > 0) {
                    const range = selectedTextObj.getRangeAt(0);
                    
                    // 创建一个span元素用于添加下划线样式
                    const span = document.createElement('span');
                    span.className = 'underline-fb3b780f';
                    
                    // 将选中的内容包装在span中
                    try {
                        range.surroundContents(span);
                    } catch (e) {
                        // 如果surroundContents失败（例如跨越多个节点），则使用extractContents方法
                        const contents = range.extractContents();
                        span.appendChild(contents);
                        range.insertNode(span);
                    }
                }
            })()`
        ).then(() => {
            // 成功添加下划线后，记录划线信息
            const url = contents.getURL();
            if (url && selectedText && selectedText.trim()) {
                // 构造划线信息对象
                const underlineInfo = {
                    text: selectedText,
                    timestamp: Date.now(),
                    url: url
                };

                console.log('保存划线数据1:', url, underlineInfo);
                
                // 只使用最可靠的方式保存划线数据
                try {
                    saveUnderlineDirect(url, underlineInfo);
                    console.log('已保存划线信息:', url, underlineInfo.text);
                } catch (e) {
                    console.log('保存划线失败:', e);
                }
            }
        }).catch((err) => {
            console.log('添加下划线失败:', err);
        });
    }).catch((err) => {
        console.log('获取选中文本失败:', err);
    });
}

// 处理取消下划线的函数
function handleRemoveUnderline(contents) {
    contents.executeJavaScript('window.getSelection().toString()')
    .then((selectedText) => {
        // 取消划线
        contents.executeJavaScript(
            `(function() {
                // 检查并注入划线样式（确保样式定义存在）
                if (!document.getElementById('underline-styles')) {
                    const style = document.createElement('style');
                    style.id = 'underline-styles';
                    style.textContent = '.underline-fb3b780f { text-decoration: underline; text-decoration-color: green; text-decoration-style: solid; text-decoration-thickness: 2px; text-underline-offset: 3px; }';
                    document.head.appendChild(style);
                }
                
                // 获取用户选择的范围
                const selectedTextObj = window.getSelection();
                if (selectedTextObj.rangeCount > 0) {
                    console.log("开始取消划线");
                    // 检查选中的内容是否在划线元素中
                    let currentNode = selectedTextObj.anchorNode;
                    let underlineNode = null;
                    
                    // 向上查找划线元素
                    while (currentNode && currentNode !== document.body) {
                        console.log("检查节点:", currentNode, "类名:", currentNode.className);
                        if (currentNode.classList && currentNode.classList.contains('underline-fb3b780f')) {
                            underlineNode = currentNode;
                            console.log("找到划线元素:", underlineNode);
                            break;
                        }
                        currentNode = currentNode.parentNode;
                    }
                    
                    // 如果找到划线元素，移除下划线
                    if (underlineNode) {
                        console.log("找到划线");
                        // 移除划线类名
                        underlineNode.classList.remove('underline-fb3b780f');
                        console.log("已移除划线类名");
                    } else {
                        console.log("未找到划线，尝试查找选中范围内的划线元素");
                        // 如果没有找到包含下划线的父元素，检查选中范围内的所有元素
                        const range = selectedTextObj.getRangeAt(0);
                        const commonAncestor = range.commonAncestorContainer;
                        console.log("共同祖先节点:", commonAncestor);
                        
                        // 查找选中范围内的所有带下划线的元素
                        const walker = document.createTreeWalker(
                            commonAncestor,
                            NodeFilter.SHOW_ELEMENT,
                            null,
                            false
                        );
                        
                        let node;
                        const underlineNodes = [];
                        
                        while (node = walker.nextNode()) {
                            console.log("遍历节点:", node, "类名:", node.className);
                            if (node.classList && node.classList.contains('underline-fb3b780f')) {
                                underlineNodes.push(node);
                                console.log("找到带下划线的节点:", node);
                            }
                        }
                        
                        // 移除找到的划线元素的类名
                        underlineNodes.forEach(node => {
                            console.log("移除划线节点类名:", node);
                            node.classList.remove('underline-fb3b780f');
                            console.log("已移除划线节点类名");
                        });
                    }
                }
            })()`
        ).then(() => {
            console.log("删除划线")
            // 成功取消下划线后，从划线数据中删除对应的记录
            const url = contents.getURL();
            if (url && selectedText && selectedText.trim()) {
                // 从划线数据中删除
                try {
                    let underlineData = {};
                    if (fs.existsSync(underlineFilePath)) {
                        const data = fs.readFileSync(underlineFilePath, 'utf8');
                        underlineData = JSON.parse(data);
                    }
                    
                    if (underlineData[url]) {
                        // 查找并删除匹配的划线记录
                        underlineData[url] = underlineData[url].filter(item => 
                            item.text !== selectedText
                        );
                        
                        // 如果该URL没有划线记录了，删除该URL的条目
                        if (underlineData[url].length === 0) {
                            delete underlineData[url];
                        }
                        
                        // 保存更新后的数据
                        fs.writeFileSync(underlineFilePath, JSON.stringify(underlineData, null, 2), 'utf8');
                        console.log('已删除划线信息:', url, selectedText);
                    }
                } catch (e) {
                    console.log('删除划线失败:', e);
                }
            }
        }).catch((err) => {
            console.log('取消下划线失败:', err);
        });
    }).catch((err) => {
        console.log('获取选中文本失败:', err);
    });
}

// 处理查看网页源码的函数
function handleViewSource(contents) {
    contents.executeJavaScript(`
        (function() {
            try {
                return document.documentElement.outerHTML;
            } catch(e) {
                return '<html><body>无法获取源码</body></html>';
            }
        })()`
    ).then((html) => {
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
