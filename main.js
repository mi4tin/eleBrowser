const { app , BrowserWindow, BrowserView, Menu, BrowserWindow: BW, session, protocol, ipcMain, globalShortcut } = require('electron');
const path = require('path');

// BrowserView管理器 -存储所有BrowserView实例
const browserViews = new Map(); // Map<tabId, BrowserView>
let tabIdCounter = 0; //标签页ID计数器
// 当前激活的 tabId
let lastActiveTabId = null;
// 搜索面板 BrowserView
let searchPanelView = null;
//记录自动匹配 BrowserView
let historyAutocompleteView = null;

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

const viewY = 82;

/**
 * 创建新的BrowserView
 * @param {BrowserWindow} window -
 * @param {string} url -要的URL
 * @returns {number} tabId - 新创建的标签页ID
 */
function createHistoryAutocompleteView(window, url = 'https://www.baidu.com') {
    if (historyAutocompleteView) {
        // 如果已经存在，先销毁
        try {
            if (window && !window.isDestroyed()) {
                window.removeBrowserView(historyAutocompleteView);
            }
            if (historyAutocompleteView.webContents && !historyAutocompleteView.webContents.isDestroyed()) {
                historyAutocompleteView.webContents.destroy();
            }
        } catch (e) {
            console.error('销毁历史记录自动匹配BrowserView失败:', e);
        }
        historyAutocompleteView = null;
    }
    
    try {
        // 创建BrowserView实例
        historyAutocompleteView = new BrowserView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload-history-autocomplete.js')
            }
        });
        
        // 设置BrowserView到窗口
        window.addBrowserView(historyAutocompleteView);
        
        // 加载自动匹配页面
        const autocompleteUrl = 'file://' + __dirname.replace(/\\/g, '/') + '/html/history-autocomplete.html';
        historyAutocompleteView.webContents.loadURL(autocompleteUrl);
        
        console.log('历史记录自动匹配BrowserView创建成功');
        return historyAutocompleteView;
    } catch (error) {
        console.error('创建历史记录自动匹配BrowserView失败:', error);
        return null;
    }
}

//显示历史记录自动匹配BrowserView
function showHistoryAutocomplete(window, items, addressInputBounds) {
    if (!historyAutocompleteView) {
        createHistoryAutocompleteView(window);
    }
    
    if (!historyAutocompleteView) return;
    
    try {
        //计算位置和尺寸
        const contentBounds = window.getContentBounds();
        const itemHeight = 36; //项目的高度
        const maxHeight = Math.min(items.length * itemHeight + 20, 300); // 最大高度300px
        const width = addressInputBounds.width;
        const x = addressInputBounds.x;
        const y = addressInputBounds.y + addressInputBounds.height;
        
        // 设置位置和尺寸
        historyAutocompleteView.setBounds({
            x: x,
            y: y,
            width: width,
            height: maxHeight
        });
        
        // 发送匹配结果到BrowserView
        if (!historyAutocompleteView.webContents.isDestroyed()) {
            historyAutocompleteView.webContents.send('update-history-autocomplete', items);
        }
        
        console.log(`显示历史记录自动匹配，项目数: ${items.length}, 位置: (${x}, ${y}),尺: ${width}x${maxHeight}`);
    } catch (error) {
        console.error('显示历史记录自动匹配失败:', error);
    }
}

//记录自动匹配BrowserView
function hideHistoryAutocomplete(window) {
    if (!historyAutocompleteView) return;
    
    try {
        if (window && !window.isDestroyed()) {
            window.removeBrowserView(historyAutocompleteView);
        }
        console.log('隐藏历史记录自动匹配BrowserView');
    } catch (error) {
        console.error('隐藏历史记录自动匹配BrowserView失败:', error);
    }
}

//销历史记录自动匹配BrowserView
function destroyHistoryAutocompleteView() {
    if (!historyAutocompleteView) return;
    
    try {
        if (historyAutocompleteView.webContents && !historyAutocompleteView.webContents.isDestroyed()) {
            historyAutocompleteView.webContents.destroy();
        }
        historyAutocompleteView = null;
        console.log('销毁历史记录自动匹配BrowserView');
    } catch (error) {
        console.error('销毁历史记录自动匹配BrowserView失败:', error);
    }
}

/**
 * 创建新的BrowserView
 * @param {BrowserWindow} window -
 * @param {string} url -的URL
 * @returns {number} tabId - 新创建的标签页ID
 */
function createBrowserView(window, url = 'https://www.baidu.com') {
    const tabId = ++tabIdCounter;
    
    // 创建BrowserView实例
    const view = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            // 指定 preload 脚本以暴露受限的 ipc API
            preload: path.join(__dirname, 'preload-browserview.js'),
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
        y: viewY, // toolbar高度
        width: contentBounds.width,
        height: contentBounds.height - viewY
    });
    
    // 加载URL
    view.webContents.loadURL(url);
    // 设置协议拦截和其他安全处理
    try {
        setupProtocolBlocking(view.webContents);
    } catch (e) {
        console.error('设置 BrowserView 协议拦截失败:', e);
    }

    var viewData={}

    // 转发 BrowserView 的导航/标题事件到渲染进程，以便更新地址栏和标签标题
    try {
        const sendUpdate = (data) => {
            try {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('browser-view-updated', Object.assign({ tabId }, data));
                }
            } catch (err) {
                console.error('发送 browser-view-updated 失败:', err);
            }
        };

        view.webContents.on('did-navigate', (_event, navigationUrl) => {
            if(navigationUrl){
                viewData["url"]=navigationUrl;
                sendUpdate(viewData);
            }
        });

        view.webContents.on('did-navigate-in-page', (_event, navigationUrl) => {
            if(navigationUrl){
                viewData["url"]=navigationUrl;
                sendUpdate(viewData);
            }
        });

        view.webContents.on('page-title-updated', (_event, title) => {
            if(title){
                viewData["title"]=title;
                sendUpdate(viewData);
            }
        });

        view.webContents.on('did-finish-load', () => {
            try {
                console.log("@@@did-finish-load")
                // 记录最近激活的 tabId
                lastActiveTabId = tabId;
            } catch (e) {
                console.error('加载并恢复划线信息失败:', e);
            }
        });
        
        // 监听did-stop-loading事件，处理同一标签页内的导航,每次加载页面都会执行
        view.webContents.on('did-stop-loading', async () => {
            try {
                const url = view.webContents.getURL();

                console.log("@@@did-stop-loading",url)
                // 记录最近激活的 tabId
                lastActiveTabId = tabId;

                // 加载并恢复划线信息
                await loadAndRestoreUnderline(url, view.webContents);
            } catch (e) {
                console.error('加载并恢复划线信息失败:', e);
            }
        });

        // 监听页面favicon更新事件
        view.webContents.on('page-favicon-updated', (_event, favicons) => {
            if(favicons && favicons.length > 0){
                // 发送favicon更新事件到渲染进程
                try {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('browser-view-favicon-updated', { tabId, favicon: favicons[0] });
                    }
                } catch (err) {
                    console.error('发送 browser-view-favicon-updated 失败:', err);
                }
            }
        });
    } catch (e) {
        console.error('注册 BrowserView 事件监听失败:', e);
    }
    
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
    lastActiveTabId = tabId;
    
    console.log(`激活BrowserView，tabId: ${tabId}`);

    // 如果存在搜索面板，将其重新添加以保证在最上层并重新定位
    if (searchPanelView && !searchPanelView.webContents.isDestroyed()) {
        try {
            try { window.removeBrowserView(searchPanelView); } catch (e) {}
            window.addBrowserView(searchPanelView);
            // 重新定位
            const contentBounds = window.getContentBounds();
            searchPanelView.setBounds({
                x: Math.max(0, contentBounds.width - panelWidth - panelPadding),
                y: panelY + panelPadding,
                width: panelWidth,
                height: panelHeight
            });
        } catch (e) {
            console.error('激活时重新添加搜索面板失败:', e);
        }
    }
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
            y: viewY,
            width: contentBounds.width,
            height: contentBounds.height - viewY
        });
    });
    // 如果搜索面板存在，则重新定位它
    if (searchPanelView && !searchPanelView.webContents.isDestroyed()) {
        try {
            searchPanelView.setBounds({
                x: Math.max(0, contentBounds.width - panelWidth - panelPadding),
                y: panelY + panelPadding,
                width: panelWidth,
                height: panelHeight
            });
        } catch (e) {
            console.error('重新定位搜索面板失败:', e);
        }
    }
}

const panelWidth = 488;
const panelHeight = 58;
const panelY = 0 ;
const panelPadding = 53;
// 创建并显示搜索面板（BrowserView）
function createSearchPanel(window) {
    if (!window) return null;
    if (searchPanelView && !searchPanelView.webContents.isDestroyed()) {
        // 已存在，直接返回
        return searchPanelView;
    }

    const panel = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload-search-panel.js')
        }
    });

    console.log('创建搜索面板 BrowserView');

    searchPanelView = panel;
    window.addBrowserView(panel);

    // 初始位置与尺寸
    const contentBounds = window.getContentBounds();
   
    panel.setBounds({
        x: Math.max(0, contentBounds.width - panelWidth - panelPadding),
        y: panelY + panelPadding,
        width: panelWidth,
        height: panelHeight
    });
    panel.setAutoResize({ width: false, height: false });

    // 加载本地搜索面板页面
    const panelUrl = 'file://' + path.join(__dirname, 'html', 'search-panel.html').replace(/\\/g, '/');
    panel.webContents.loadURL(panelUrl).catch(err => console.error('加载搜索面板失败:', err));

    // 确保面板缩放为 1，避免系统 DPI / 缩放引起的样式错乱
    panel.webContents.on('did-finish-load', () => {
        try {
            panel.webContents.setZoomFactor(1);
        } catch (e) {
            console.error('设置搜索面板缩放失败:', e);
        }
    });

    // 当搜索面板关闭/销毁时清理引用
    panel.webContents.on('destroyed', () => {
        console.log('搜索面板 webContents 已销毁');
        searchPanelView = null;
    });
    
    // 防止内存泄漏：限制事件监听器数量
    if (window.listenerCount && window.listenerCount('closed') > 10) {
        console.warn('检测到过多的 closed 事件监听器，可能存在内存泄漏');
    }

    return panel;
}

// 隐藏并销毁搜索面板
function destroySearchPanel(window) {
    if (!searchPanelView) return;
    try {
        // 停止在页面中的查找
        const targetView = browserViews.get(lastActiveTabId) || Array.from(browserViews.values())[0];
        if (targetView && targetView.webContents && !targetView.webContents.isDestroyed()) {
            try { targetView.webContents.stopFindInPage('clearSelection'); } catch (e) {}
        }
        if (window && !window.isDestroyed()) window.removeBrowserView(searchPanelView);
        
        // 正确销毁搜索面板的webContents
        if (searchPanelView.webContents && !searchPanelView.webContents.isDestroyed()) {
            searchPanelView.webContents.destroy();
        }
    } catch (e) {
        console.error('销毁搜索面板失败:', e);
    } finally {
        // 确保清理引用
        searchPanelView = null;
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
            console.log('新窗口 URL:', url);
            // 对于普通 http/https 链接，阻止新窗口并让渲染进程新建标签
            if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                try {
                    // 将消息发给宿主（包含标签 UI 的页面）
                    // const hostContents = contents.hostWebContents || contents;
                    console.log('发送 open-url-in-new-tab 消息到宿主，URL:', url);
                    mainWindow.webContents.send('open-url-in-new-tab', url);
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

// 拦截所有 webContents 的自定义协议请求（包括 WebView、BrowserView、BrowserWindow)
app.on('web-contents-created', (event, contents) => {
    console.log("web-contents-created, ID:", contents.id, "URL:", contents.getURL(),"Type:", contents.getType());
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
    
    // 为所有 网页/窗口/BrowserView 添加右键菜单
    // 检查类型，区分 webview / window / browserView 等
    const type = (typeof contents.getType === 'function') ? contents.getType() : 'unknown';
    const isWeb = contents.hostWebContents !== undefined;
    // 对于 webview、浏览器窗口（window）和 BrowserView，都要绑定右键菜单
    const shouldAttachContextMenu = isWeb || type === 'window' || type === 'browserView';

    console.log('web-contents-created, 是否是 网页:', isWeb, '类型:', type, '绑定右键菜单:', shouldAttachContextMenu)
    
    // 注册全局事件监听器用于调试
    const handleSaveUnderlineRequest = (url, underlineInfo) => {
        console.log('全局监听到划线保存请求:', url, underlineInfo);
        saveUnderlineDirect(url, underlineInfo);
    };
    
    // 将处理函数绑定到app上
    app.removeAllListeners('save-underline-request-debug');
    app.on('save-underline-request-debug', handleSaveUnderlineRequest);
    
    if (shouldAttachContextMenu) {
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
            var closeTabMenu=[];//关闭标签相关菜单项
            
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
                            try {
                                console.log('打开开发者工具12, webContents id:', contents.id);
                                // 记录当前 DevTools 状态
                                const isOpened = typeof contents.isDevToolsOpened === 'function' ? contents.isDevToolsOpened() : false;
                                console.log('DevTools 已打开:', isOpened);

                                // 尝试聚焦并显示所属窗口（如果存在）
                                try {
                                    const win = BrowserWindow.fromWebContents(contents);
                                    if (win && !win.isDestroyed()) {
                                        win.show();
                                        win.focus();
                                    }
                                } catch (err) {
                                    console.log('无法从 webContents 获取窗口或聚焦窗口:', err && err.message);
                                }

                                const url = contents.getURL();
                                console.log('调用 openDevTools，URL:', url,url.endsWith('search-panel.html'));
                                
                                if (type !== 'browserView'||url.endsWith('search-panel.html')) {
                                    contents.openDevTools({ mode: 'detach' });// 使用 detach 模式打开（更可靠地弹出独立 DevTools 窗口）。因为有browserView的特殊性，直接打开可能会被隐藏在窗口后面，detach 模式可以让它成为独立窗口，更容易被用户发现和操作。
                                }else{
                                    contents.openDevTools();
                                    // contents.openDevTools({ mode: 'detach' });
                                }
                                
                                console.log('已调用 openDevTools，检查是否成功打开');

                                // 若若干毫秒后仍未打开，记录并再次尝试（用于排查隐藏/被覆盖问题）
                                setTimeout(() => {
                                    const openedAfter = typeof contents.isDevToolsOpened === 'function' ? contents.isDevToolsOpened() : false;
                                    console.log('延迟检查 DevTools 已打开:', openedAfter);
                                    if (!openedAfter) {
                                        console.log('DevTools 未显示，尝试再次打开（detach）');
                                        try { contents.openDevTools({ mode: 'detach' }); } catch (e) { console.error('再次打开 DevTools 失败:', e && e.message); }
                                    }
                                }, 300);
                            } catch (e) {
                                console.error('打开开发者工具出错:', e && e.message);
                            }
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
                    }, { type: 'separator' }]
            }
            
            // 检查右键点击位置是否有划线元素或是否是右键的标签
            contents.executeJavaScript(
                `(function() {
                    // 获取鼠标位置的元素
                    const element = document.elementFromPoint(${params.x}, ${params.y});
                    if (!element) return { hasUnderline: false, underlineText: '' };

                    console.log('右键点击元素:', element.tagName, element.className, element,element.classList);
                    
                    // 检查元素本身是否是划线元素
                    if (element.classList && element.classList.contains('underline-fb3b780f')) {
                        console.log('直接点击了划线元素');
                        return { 
                            hasUnderline: true, 
                            underlineText: element.textContent || element.innerText || '',
                            underlineElement: element
                        };
                    }
                    
                    let hasLeftTab=false,hasRightTab=false;
                    // console.log('检查元素的兄弟元素:', element.parentElement.previousElementSibling.classList, element.parentElement.nextElementSibling);
                    if(
                    (element.previousElementSibling&&element.previousElementSibling.classList.contains('tab'))
                    ||
                    (element.parentElement.previousElementSibling&&element.parentElement.previousElementSibling.classList.contains('tab'))
                    ){
                        hasLeftTab=true;
                    }
                    
                    if(
                    (element.nextElementSibling&&element.nextElementSibling.classList.contains('tab'))
                    ||
                    (element.parentElement.nextElementSibling&&element.parentElement.nextElementSibling.classList.contains('tab'))
                    ){
                        hasRightTab=true;
                    }
                    
                    let isTab = false;
                    if(element.classList.contains('tab-text')||element.classList.contains('tab')){
                        console.log('点击了标签');
                        isTab=true;
                    }
                    
                    //暂时只管元素本身是否有划线类，不检查子元素和祖先元素
                    // 检查元素内是否有划线子元素
                    // const underlineChild = element.querySelector('.underline-fb3b780f');
                    // if (underlineChild) {
                    //     console.log('在子元素中找到划线元素:', underlineChild);
                    //     return {
                    //         hasUnderline: true, 
                    //         underlineText: underlineChild.textContent || underlineChild.innerText || '',
                    //         underlineElement: underlineChild
                    //     };
                    // }
                    
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
                        return { 
                            hasUnderline: true, 
                            underlineText: foundUnderlineElement.textContent || foundUnderlineElement.innerText || '',
                            underlineElement: foundUnderlineElement
                        };
                    }
                    
                    // 如果没有找到划线元素，但有选中文本，则可以添加下划线
                    return { hasUnderline: false, underlineText: '',isTab:isTab, hasLeftTab:hasLeftTab, hasRightTab:hasRightTab };
                })()`
            ).then(elementCheckResult => {
                console.log('元素检查结果:', elementCheckResult);

                if(elementCheckResult.hasUnderline || hasSelection){
                    underlineMenu=[ {
                        label: elementCheckResult.hasUnderline ? '取消划线' : '添加下划线',
                        enabled: true,
                        click: () => {
                            if (elementCheckResult.hasUnderline) {
                                // 取消划线逻辑，传递划线文本内容
                                handleRemoveUnderline(contents, elementCheckResult.underlineText);
                            } else {
                                // 添加下划线逻辑
                                handleAddUnderline(contents);
                            }
                        }
                    }]
                }

                if(hasSelection&&elementCheckResult.hasUnderline==false){
                    underlineMenu=[...underlineMenu, { type: 'separator' }]
                }

                if(elementCheckResult.isTab&&type === 'window'){
                    closeTabMenu=[
                        { type: 'separator' },
                        {
                            label: '关闭标签',
                            click: () => {
                                try {
                                    if (mainWindow && !mainWindow.isDestroyed()) {
                                        mainWindow.webContents.send('close-tab',lastActiveTabId);
                                    }
                                } catch (err) {
                                    console.error('发送关闭标签消息失败:', err);
                                }
                            }
                        },
                        {
                            label: '关闭其它标签',
                            enabled: elementCheckResult.hasLeftTab || elementCheckResult.hasRightTab,
                            click: () => {
                                try {
                                    if (mainWindow && !mainWindow.isDestroyed()) {
                                        mainWindow.webContents.send('close-other-tab',lastActiveTabId);
                                    }
                                } catch (err) {
                                    console.error('发送关闭其它标签消息失败:', err);
                                }
                            }
                        },
                        {
                            label: '关闭左侧标签',
                            enabled: elementCheckResult.hasLeftTab,
                            click: () => {
                                try {
                                    if (mainWindow && !mainWindow.isDestroyed()) {
                                        mainWindow.webContents.send('close-left-tab',lastActiveTabId);
                                    }
                                } catch (err) {
                                    console.error('发送关闭左侧标签消息失败:', err);
                                }
                            }
                        },
                        {
                            label: '关闭右侧标签',
                            enabled: elementCheckResult.hasRightTab,
                            click: () => {
                                try {
                                    if (mainWindow && !mainWindow.isDestroyed()) {
                                        mainWindow.webContents.send('close-right-tab',lastActiveTabId);
                                    }
                                } catch (err) {
                                    console.error('发送关闭右侧标签消息失败:', err);
                                }
                            }
                        }
                    ]
                }

                
                const menu = Menu.buildFromTemplate([
                   ...underlineMenu,
                    ...selectedMenu,
                   ...baseMenu,
                   ...closeTabMenu
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

    // 默认最大化窗口
    // myWindow.maximize();

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
                        console.log('尝试获取选中文本，当前活动tabId:', lastActiveTabId);
                        
                        // 直接使用已知的活动tabId
                        if (lastActiveTabId !== null) {
                            const activeView = browserViews.get(lastActiveTabId);
                            if (activeView && activeView.webContents) {
                                activeView.webContents.executeJavaScript(`
                                    (() => {
                                        const selection = window.getSelection();
                                        return selection ? selection.toString().trim() : '';
                                    })()
                                `, true).then(selectedText => {
                                    console.log('获取到选中文本:', selectedText);
                                    if (selectedText && selectedText.length > 0) {
                                        // 如果有选中文本，则传递给搜索面板
                                        showSearchPanelWithText(selectedText);
                                    } else {
                                        // 没有选中文本，正常打开搜索面板
                                        showSearchPanel();
                                    }
                                }).catch(err => {
                                    console.error('获取选中文本失败:', err);
                                    showSearchPanel();
                                });
                            } else {
                                console.log('未找到活动的BrowserView，正常打开搜索面板');
                                showSearchPanel();
                            }
                        } else {
                            console.log('没有活动的tab，正常打开搜索面板');
                            showSearchPanel();
                        }
                    }
                }
            },
             {
                key: 'Escape',
                name: '关闭搜索',
                action: () => {
                    console.log('应用内快捷键: 关闭搜索');
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        // mainWindow.webContents.send('show-search-panel');
                        // showSearchPanel();
                        destroySearchPanel(mainWindow);
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
                        reloadBrowserView(lastActiveTabId);
                    }
                }
            },
            {
                key: 'CommandOrControl+F5',
                name: '强制刷新页面',
                action: () => {
                    console.log('应用内快捷键: 强制刷新页面');
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        reloadBrowserViewIgnoringCache(lastActiveTabId);
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
            // {
            //     key: 'CommandOrControl+U',
            //     name: '打开划线记录',
            //     action: () => {
            //         console.log('应用内快捷键: 打开划线记录');
            //         if (mainWindow && !mainWindow.isDestroyed()) {
            //             mainWindow.webContents.send('open-underline-tab');
            //         }
            //     }
            // },
            // {
            //     key: 'F12',
            //     name: '打开开发者工具',
            //     action: () => {
            //         console.log('应用内快捷键: 打开开发者工具11');
            //         if (mainWindow && !mainWindow.isDestroyed()) {
            //             console.log('执行: 打开开发者工具11');
            //             mainWindow.webContents.openDevTools();
            //         }
            //     }
            // }
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
        console.log('openBookmarksWindow发送打开书签管理器消息到主窗口');
        mainWindow.webContents.send('open-bookmarks-tab');
        // 如果主窗口最小化，则恢复并聚焦
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.focus();
    } else {
        console.log('openBookmarksWindow主窗口不存在，创建新窗口');
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
    if (view && view.webContents.navigationHistory.canGoBack()) {
        view.webContents.navigationHistory.goBack();
        return true;
    }
    return false;
});

/**
 * 导航操作：前进
 */
ipcMain.handle('browser-view-go-forward', (event, tabId) => {
    const view = browserViews.get(tabId);
    if (view && view.webContents.navigationHistory.canGoForward()) {
        view.webContents.navigationHistory.goForward();
        return true;
    }
    return false;
});

/**
 * 导航操作：刷新
 */
ipcMain.handle('browser-view-reload', (event, tabId) => {
    return reloadBrowserView(tabId);
});

function reloadBrowserView(tabId) {
    const view = browserViews.get(tabId);
    if (view) {
        view.webContents.reload();
        return true;
    }
    return false;
}

function reloadBrowserViewIgnoringCache(tabId) {
    const view = browserViews.get(tabId);
    if (view) {
        view.webContents.reloadIgnoringCache();
        return true;
    }
    return false;
}

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

/**
 * 获取是否可以后退
 */
ipcMain.handle('browser-view-can-go-back', (event, tabId) => {
    const view = browserViews.get(tabId);
    if (view) {
        return view.webContents.navigationHistory.canGoBack();
    }
    return false;
});

/**
 * 获取是否可以前进
 */
ipcMain.handle('browser-view-can-go-forward', (event, tabId) => {
    const view = browserViews.get(tabId);
    if (view) {
        return view.webContents.navigationHistory.canGoForward();
    }
    return false;
});

/**
 * 在指定的BrowserView中执行JavaScript代码
 */
ipcMain.handle('execute-javascript-in-browser-view', (event, tabId, code) => {
    const view = browserViews.get(tabId);
    if (view && view.webContents) {
        return view.webContents.executeJavaScript(code);
    }
    return Promise.resolve();
});

// 显示搜索面板（快捷键触发）
ipcMain.on('show-search-panel', (event) => {
    console.log('收到显示搜索面板请求');
    const window = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!window) return;
    try {
        createSearchPanel(window);
        // 聚焦到搜索面板的输入框
        setTimeout(() => {
            if (searchPanelView && searchPanelView.webContents && !searchPanelView.webContents.isDestroyed()) {
                searchPanelView.webContents.focus();
                searchPanelView.webContents.send('focus-input');
            }
        }, 200);
    } catch (e) {
        console.error('显示搜索面板失败:', e);
    }
});

function showSearchPanel(text) {
    try {
        createSearchPanel(mainWindow);
        // 聚焦到搜索面板的输入框
        setTimeout(() => {
            if (searchPanelView && searchPanelView.webContents && !searchPanelView.webContents.isDestroyed()) {
                searchPanelView.webContents.focus();
                searchPanelView.webContents.send('focus-input');
            }
        }, 200);
    } catch (e) {
        console.error('显示搜索面板失败:', e);
    }
}

// 显示搜索面板并填充选中文本
function showSearchPanelWithText(selectedText) {
    try {
        console.log('显示搜索面板并填充文本:', selectedText);
        createSearchPanel(mainWindow);
        // 聚焦到搜索面板的输入框并填充文本
        setTimeout(() => {
            if (searchPanelView && searchPanelView.webContents && !searchPanelView.webContents.isDestroyed()) {
                searchPanelView.webContents.focus();
                searchPanelView.webContents.send('set-search-text', selectedText);
                searchPanelView.webContents.send('focus-input');
                // 延迟一小段时间后自动触发搜索
                setTimeout(() => {
                    searchPanelView.webContents.send('trigger-search');
                }, 100);
            }
        }, 200);
    } catch (e) {
        console.error('显示搜索面板并填充文本失败:', e);
    }
}

// 显示搜索面板并填充初始文本（右键菜单触发）
ipcMain.on('show-search-panel-with-text', (event, text) => {
    const window = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!window) return;
    try {
        createSearchPanel(window);
        setTimeout(() => {
            if (searchPanelView && searchPanelView.webContents && !searchPanelView.webContents.isDestroyed()) {
                searchPanelView.webContents.send('set-search-text', text || '');
                searchPanelView.webContents.send('focus-input');
            }
        }, 300);
    } catch (e) {
        console.error('显示搜索面板并设置文本失败:', e);
    }
});



// 搜索面板发起查找请求
ipcMain.on('search-panel-find', (event, payload) => {
    try {
        console.log('收到搜索面板查找请求:', payload, '最后活跃标签ID:', lastActiveTabId);
        const { text, forward, findNext, matchCase } = payload || {};
        const targetView = browserViews.get(lastActiveTabId) || Array.from(browserViews.values())[0];
        if (!targetView || !targetView.webContents) return;
        
        const wc = targetView.webContents;
        // 首次搜索findNext必须为true，否则found-in-page事件不触发
        const options = { forward: payload.forward, findNext:payload.findNext, matchCase: false };
        
        const foundListener = (e, result) => {
            console.log('found-in-page 事件:', result);
            // 规范化并只发送必要字段，避免在渲染端处理 undefined
            const payload = {
                matches: (result && typeof result.matches === 'number') ? result.matches : 0,
                activeMatchOrdinal: (result && typeof result.activeMatchOrdinal === 'number') ? result.activeMatchOrdinal : 0,
                final: !!(result && result.final)
            };
            if (searchPanelView && searchPanelView.webContents && !searchPanelView.webContents.isDestroyed()) {
                searchPanelView.webContents.send('found-in-page', payload);
            }
            if (payload.final) {
                try { wc.removeAllListeners('found-in-page'); } catch (e) {console.log('移除 found-in-page 监听器失败2:', e);}
            }
        };
        
        try { 
            wc.removeAllListeners('found-in-page'); 
        } catch (e) {
            console.log('移除 found-in-page 监听器失败:', e);
        }

        wc.on('found-in-page', foundListener);
        
        console.log('执行 findInPage.options:',options);
        var id=wc.findInPage(text || '', options);
        console.log('findInPage 执行结果:', id);
    } catch (e) {
        console.error('处理搜索请求失败:', e);
    }
});

// 关闭搜索面板
ipcMain.on('search-panel-close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    destroySearchPanel(window);
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
const fs = require('fs');
const bookmarksFilePath = path.join(app.getPath('userData'), 'bookmarks.json');

// 历史记录数据文件路径
const historyFilePath = path.join(app.getPath('userData'), 'history.json');

// 划线数据文件路径
const underlineFilePath = path.join(app.getPath('userData'), 'underline.json');

/**
 * 加载并恢复划线信息
 * @param {string} url - 页面URL
 * @param {BrowserView} view - BrowserView实例
 */
async function loadAndRestoreUnderline(url, contents) {
    try {
        console.log('加载划线数据请求:', url);
        
        let underlineData = {};
        if (fs.existsSync(underlineFilePath)) {
            const data = fs.readFileSync(underlineFilePath, 'utf8');
            underlineData = JSON.parse(data);
        }
        
        const underlines = underlineData[url] || [];
        if (underlines && underlines.length > 0) {
            underlineNameIndex=1;//每个页面重置 
            console.log('找到划线数据:', underlines.length, '条');
            // 恢复划线信息
            for (const underlineInfo of underlines) {
                await restoreUnderlineInBrowserView(contents, underlineInfo);
            }
        }
    } catch (error) {
        console.error('加载划线数据失败:', error);
    }
}


let underlineNameIndex = 1;//用于同一页面的不同下划线的命名标识

/**
 * 在BrowserView中恢复划线信息
 * @param {BrowserView} view - BrowserView实例
 * @param {object} underlineInfo - 划线信息
 */
async function restoreUnderlineInBrowserView(contents, underlineInfo) {
    try {
        underlineInfo.mode=underlineInfo.mode || 1
        underlineInfo.occurrenceIndex=underlineInfo.occurrenceIndex || 0

        console.log('恢复划线信息:', underlineInfo.text, underlineInfo.mode , underlineInfo.occurrenceIndex, underlineNameIndex);
        
        // 在BrowserView中执行JavaScript代码来恢复划线。内部添加划线的核心方法来源 ds(chat.deepseek.com):JS跨标签文本添加下划线方法
        await contents.executeJavaScript(
            `(function(text, mode, occurrenceIndex) {
                // 检查并注入划线样式
                if (!document.getElementById('underline-styles')) {
                    const style = document.createElement('style');
                    style.id = 'underline-styles';
                    style.textContent = '.underline-fb3b780f { text-decoration: underline; text-decoration-color: green; text-decoration-style: solid; text-decoration-thickness: 2px; text-underline-offset: 3px; }';
                    document.head.appendChild(style);
                }


                /**
                 * 在容器中，根据全局字符偏移量查找所在的文本节点及内部偏移
                 * @param {HTMLElement} container 
                 * @param {number} offset - 从容器文本开头计算的字符偏移（0-based）
                 * @returns {{ node: Text, offset: number }} 文本节点和内部偏移
                 */
                function getTextNodeAtPosition(container, offset) {
                const walker = document.createTreeWalker(
                    container,
                    NodeFilter.SHOW_TEXT,
                    null,
                    false
                );

                let currentPos = 0;
                let node;
                while ((node = walker.nextNode())) {
                    const nodeLength = node.textContent.length;
                    if (offset < currentPos + nodeLength) {
                    return {
                        node: node,
                        offset: offset - currentPos
                    };
                    }
                    currentPos += nodeLength;
                }
                throw new Error('Offset  out of range');
                }

                /**
                 * 包裹单个文本节点中的一段
                 */
                function wrapTextNodeSegment(node, start, end, index) {
                const parent = node.parentNode;
                if (!parent) return;
                if (parent.classList && parent.classList.contains('underline-fb3b780f')) return;

                const content = node.textContent;
                const fragment = document.createDocumentFragment();

                if (start > 0) {
                    fragment.appendChild(document.createTextNode(content.substring(0, start)));
                }

                const span = document.createElement('span');
                span.className = 'underline-fb3b780f';
                span.setAttribute('name', 'underline-fb3b780f-name${underlineNameIndex}');
                span.setAttribute('data-occurrence-index', index);
                
                span.textContent = content.substring(start, end);
                fragment.appendChild(span);

                if (end < content.length) {
                    fragment.appendChild(document.createTextNode(content.substring(end)));
                }

                parent.replaceChild(fragment, node);
                }


                /**
                 * 处理跨文本节点的范围
                 */
                function handleMultiNodeRange(startNode, startOffset, endNode, endOffset, index) {
                // 1. 处理起始节点（保留后半部分）
                const startParent = startNode.parentNode;
                if (startParent) {
                    const startContent = startNode.textContent;
                    const startFrag = document.createDocumentFragment();
                    
                    // 从 startOffset 到末尾的内容加上下划线
                    const underlineSpan = document.createElement('span');
                    underlineSpan.className = 'underline-fb3b780f';
                    underlineSpan.setAttribute('name', 'underline-fb3b780f-name${underlineNameIndex}');
                    underlineSpan.setAttribute('data-occurrence-index', index);
                    underlineSpan.textContent = startContent.substring(startOffset);
                    startFrag.appendChild(underlineSpan);
                    
                    // 前半部分保留为纯文本（如果存在）
                    if (startOffset > 0) {
                    const beforeText = document.createTextNode(startContent.substring(0, startOffset));
                    startFrag.insertBefore(beforeText, underlineSpan);
                    }
                    
                    startParent.replaceChild(startFrag, startNode);
                }

                // 2. 处理结束节点（保留前半部分）
                const endParent = endNode.parentNode;
                if (endParent) {
                    const endContent = endNode.textContent;
                    const endFrag = document.createDocumentFragment();
                    
                    // 从开头到 endOffset 的内容加上下划线
                    const underlineSpan = document.createElement('span');
                    underlineSpan.className = 'underline-fb3b780f';
                    underlineSpan.setAttribute('name', 'underline-fb3b780f-name${underlineNameIndex}');
                    underlineSpan.setAttribute('data-occurrence-index', index);
                    underlineSpan.textContent = endContent.substring(0, endOffset);
                    endFrag.appendChild(underlineSpan);
                    
                    // 后半部分保留为纯文本（如果存在）
                    if (endOffset < endContent.length) {
                    const afterText = document.createTextNode(endContent.substring(endOffset));
                    endFrag.appendChild(afterText);
                    }
                    
                    endParent.replaceChild(endFrag, endNode);
                }

                // 3. 处理中间的所有文本节点（整个包裹）
                let currentNode = startNode.nextSibling;
                while (currentNode && currentNode !== endNode) {
                    if (currentNode.nodeType === Node.TEXT_NODE && currentNode.parentNode) {
                    const parent = currentNode.parentNode;
                    const content = currentNode.textContent;
                    if (content.length > 0) {
                        const span = document.createElement('span');
                        span.className = 'underline-fb3b780f';
                        span.setAttribute('name', 'underline-fb3b780f-name${underlineNameIndex}');
                        span.setAttribute('data-occurrence-index', index);
                        span.textContent = content;
                        parent.replaceChild(span, currentNode);
                    }
                    }
                    currentNode = currentNode.nextSibling;
                }
                }


                 /**
                 * 跨标签添加下划线，支持指定第几个匹配
                 * @param {HTMLElement} container - 容器元素
                 * @param {string} text - 要添加下划线的文本
                 * @param {number} [matchIndex=null] - 匹配索引（0-based）
                 * @returns {number} 实际处理的匹配数量
                 */
                function underlineAllMatches(container, text,mode, matchIndex) {
                if (!container || !text) return 0;

                // 1. 基于当前实时文本查找所有匹配位置
                const fullText = container.textContent;
                const matches = [];
                let pos = 0;
                while ((pos = fullText.indexOf(text, pos)) !== -1) {
                    matches.push({ start: pos, end: pos + text.length });
                    pos += text.length;
                }
                if (matches.length === 0) return 0;

                // 2. 确定要处理的匹配列表
                let matchesToProcess = [];
                if (mode === 1 && matchIndex >= 0) {
                    // 校验索引合法性
                    if (matchIndex >= 0 && matchIndex < matches.length) {
                    matchesToProcess = [matches[matchIndex]];
                    } else {
                    console.warn("❌ 匹配索引 " + matchIndex + " 超出范围，共有 " + matches.length + " 个匹配");
                    return 0;
                    }
                } else {
                    matchesToProcess = matches.slice(); // 处理全部
                }

                // 3. 按结束位置降序排序（从后往前处理，保证节点定位正确）
                matchesToProcess.sort((a, b) => b.end - a.end);


                var index = 0;
                // 4. 处理每个匹配（依赖辅助函数）
                matchesToProcess.forEach(match => {
                    try {
                    index++;
                    console.log('处理匹配aa:', match, '索引:', index);
                    const startInfo = getTextNodeAtPosition(container, match.start);
                    const endInfo = getTextNodeAtPosition(container, match.end - 1);
                    
                    if (startInfo.node === endInfo.node) {
                        wrapTextNodeSegment(startInfo.node, startInfo.offset, endInfo.offset + 1,index);
                    } else {
                        handleMultiNodeRange(
                        startInfo.node, startInfo.offset,
                        endInfo.node, endInfo.offset + 1,index
                        );
                    }
                    } catch (e) {
                    console.warn('⚠️ 处理匹配失败:', match, e);
                    }
                });

                return matchesToProcess.length;
                }

                
                // 确保DOM完全加载后再应用划线
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', function() {
                        console.log('DOMContentLoaded事件触发，开始应用划线');
                        underlineAllMatches(document.body, text, mode, occurrenceIndex);
                    });
                } else {
                    console.log('DOMContentLoaded事件未触发，立即应用划线');
                    underlineAllMatches(document.body, text, mode, occurrenceIndex);
                }

                console.log('划线应用完成');
            })('${underlineInfo.text}', ${underlineInfo.mode}, ${underlineInfo.occurrenceIndex})`
        );

        underlineNameIndex++
    } catch (error) {
        console.error('恢复划线失败:', error);
        console.log('恢复划线失败的详细信息:', error.stack);
    }
}


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

// IPC处理器：搜索历史记录
ipcMain.handle('search-history', (event, query) => {
    try {
        let history = [];
        
        //检查历史记录文件是否存在
        if (fs.existsSync(historyFilePath)) {
            const data = fs.readFileSync(historyFilePath, 'utf8');
            history = JSON.parse(data);
        }
        
        if (!query || query.trim() === '') {
            return [];
        }
        
        const searchTerm = query.toLowerCase().trim();
        const matches = [];
        
        // 搜索历史记录（按URL和标题）
        for (const item of history) {
            const urlMatch = item.url.toLowerCase().includes(searchTerm);
            const titleMatch = item.title.toLowerCase().includes(searchTerm);
            
            if (urlMatch || titleMatch) {
                //计匹配度
                let score = 0;
                if (urlMatch) {
                    // URL完全匹配得分最高
                    if (item.url.toLowerCase() === searchTerm) {
                        score += 100;
                    } else if (item.url.toLowerCase().startsWith(searchTerm)) {
                        // URL前缀匹配
                        score += 50 + (searchTerm.length / item.url.length) * 30;
                    } else {
                        // URL包含匹配
                        score += 20 + (searchTerm.length / item.url.length) * 10;
                    }
                }
                
                if (titleMatch) {
                    //标题完全匹配
                    if (item.title.toLowerCase() === searchTerm) {
                        score += 80;
                    } else if (item.title.toLowerCase().startsWith(searchTerm)) {
                        // 标题前缀匹配
                        score += 40 + (searchTerm.length / item.title.length) * 20;
                    } else {
                        //标题包含匹配
                        score += 15 + (searchTerm.length / item.title.length) * 10;
                    }
                }
                
                matches.push({
                    ...item,
                    matchScore: score
                });
            }
        }
        
        //按匹配度排序，取前10个
        matches.sort((a, b) => b.matchScore - a.matchScore);
        return matches.slice(0, 10);
    } catch (e) {
        console.error('搜索历史记录失败:', e);
        return [];
    }
});

// IPC处理器：显示历史记录自动匹配
ipcMain.handle('show-history-autocomplete', (event, items, addressInputBounds) => {
    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            showHistoryAutocomplete(mainWindow, items, addressInputBounds);
            return { success: true };
        }
        return { success: false, error: '主窗口不存在' };
    } catch (error) {
        console.error('显示历史记录自动匹配失败:', error);
        return { success: false, error: error.message };
    }
});

// IPC处理器：隐藏历史记录自动匹配
ipcMain.handle('hide-history-autocomplete', (event) => {
    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            hideHistoryAutocomplete(mainWindow);
            return { success: true };
        }
        return { success: false, error: '主窗口不存在' };
    } catch (error) {
        console.error('隐藏历史记录自动匹配失败:', error);
        return { success: false, error: error.message };
    }
});

// IPC处理器：处理历史记录自动匹配选择
ipcMain.handle('history-autocomplete-selected', (event, selectedItem) => {
    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            // 发送选择结果到渲染进程
            mainWindow.webContents.send('history-autocomplete-selected', selectedItem);
            //匹配
            hideHistoryAutocomplete(mainWindow);
            return { success: true };
        }
        return { success: false, error: '主窗口不存在' };
    } catch (error) {
        console.error('处理历史记录自动匹配选择失败:', error);
        return { success: false, error: error.message };
    }
});

// IPC处理器：发送键盘导航指令到历史记录自动匹配
ipcMain.handle('history-autocomplete-keyboard', (event, action) => {
    try {
        if (historyAutocompleteView && !historyAutocompleteView.webContents.isDestroyed()) {
            historyAutocompleteView.webContents.send('history-autocomplete-keyboard', action);
            return { success: true };
        }
        return { success: false, error: '历史记录自动匹配BrowserView不存在' };
    } catch (error) {
        console.error('发送键盘导航指令失败:', error);
        return { success: false, error: error.message };
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
    console.log('收到加载划线数据请求1', url,underlineFilePath+"@end");
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
            isMac
                ? { role: 'close', label: '关闭窗口' }
                : { role: 'quit', label: '退出' }
        ]
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
            },
            {
                label: '打开开发者工具',
                accelerator: 'F12',
                click: () => {
                    // 获取当前活动的标签页webContents
                    if (lastActiveTabId && browserViews.has(lastActiveTabId)) {
                        const currentView = browserViews.get(lastActiveTabId);
                        console.log('打开开发者工具777:', lastActiveTabId);
                        if (currentView && currentView.webContents) {
                            currentView.webContents.openDevTools();
                        }
                    } else {
                        // 如果没有活动的BrowserView，就在主窗口打开
                        myWindow.webContents.openDevTools();
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

const underlineMode = 1; // 划线模式，1、只加载指定出现次数的文本划线，2、加载所有匹配文本的划线

// 处理添加下划线的函数
function handleAddUnderline(contents, mode = underlineMode) {
    contents.executeJavaScript('window.getSelection().toString()')
    .then((selectedText) => {

        const url = contents.getURL();
        if (!url||!selectedText || !selectedText.trim()) {
            console.log('没有选中文本');
            return;
        }

         // 构造划线信息对象
        let underlineInfo = {
            text: selectedText,
            timestamp: Date.now(),
            url: url,
            mode: mode,
            occurrenceIndex: 0
        };

        
        const addUnderlinePromise = (mode === 2)
            ? restoreUnderlineInBrowserView(contents, underlineInfo)
            : contents.executeJavaScript( // 只给当前选中的添加下划线
            `(function(selectedText, mode) {
                // 检查并注入划线样式
                if (!document.getElementById('underline-styles')) {
                    const style = document.createElement('style');
                    style.id = 'underline-styles';
                    style.textContent = '.underline-fb3b780f { text-decoration: underline; text-decoration-color: green; text-decoration-style: solid; text-decoration-thickness: 2px; text-underline-offset: 3px; }';
                    document.head.appendChild(style);
                }
                
                // 计算文本在文档中的出现次数
                function getTextOccurrenceIndex(text, node) {
                    let count = 0;
                    let currentNode = node;
                    
                    // 向上查找直到文档根节点
                    while (currentNode && currentNode !== document.body) {
                        currentNode = currentNode.parentNode;
                    }
                    
                    // 遍历文档，计算文本出现次数
                    function traverseNodes(node) {
                        if (node.nodeType === 3) { // 文本节点
                            const textContent = node.textContent;
                            let index = 0;
                            while ((index = textContent.indexOf(text, index)) !== -1) {
                                // 检查是否是当前选中的文本
                                if (node === window.getSelection().anchorNode && 
                                    index <= window.getSelection().anchorOffset && 
                                    index + text.length >= window.getSelection().focusOffset) {
                                    return true; // 找到当前选中的文本
                                }
                                index += text.length;
                                count++;
                            }
                        } else if (node.nodeType === 1) { // 元素节点
                            for (let i = 0; i < node.childNodes.length; i++) {
                                if (traverseNodes(node.childNodes[i])) {
                                    return true;
                                }
                            }
                        }
                        return false;
                    }
                    
                    traverseNodes(document.body);
                    return count;
                }
                
                // 为指定范围添加下划线
                function addUnderlineToRange(range) {
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
                    return span;
                }
                
                const result = { spans: [], occurrenceIndex: 0 };
                
                // 获取用户选择的范围
                const selectedTextObj = window.getSelection();
                if (selectedTextObj.rangeCount > 0) {
                    const range = selectedTextObj.getRangeAt(0);
                    
                    if (mode === 1) {
                        // 模式1: 只为当前选中的文本添加下划线，并记录出现次数
                        const occurrenceIndex = getTextOccurrenceIndex(selectedText, range.commonAncestorContainer);
                        result.occurrenceIndex = occurrenceIndex;

                        console.log('当前选中的文本occurrenceIndex:', occurrenceIndex);
                        
                        const span = addUnderlineToRange(range);
                        span.dataset.occurrenceIndex = occurrenceIndex;
                        result.spans.push(span);
                    } else if (mode === 2) {
                        console.error('不应在此有模式2。当前选中的文本:', selectedText);
                    }
                }

                console.log('添加下划线结果666:', result);
                
                return { occurrenceIndex: result.occurrenceIndex, spansCount: result.spans.length };
            })('${selectedText.replace(/'/g, "\\'")}', ${mode})`
        )
        
        
        addUnderlinePromise.then((result) => {
            // 成功添加下划线后，记录划线信息
            console.log("成功添加下划线.result:", result)
            console.log('保存划线数据1:', url, underlineInfo);

            if(mode==1){
                underlineInfo.occurrenceIndex=result.occurrenceIndex;//只有模式1才会返回result
            }
                
            // 只使用最可靠的方式保存划线数据
            try {
                saveUnderlineDirect(url, underlineInfo);
                console.log('已保存划线信息:', url, underlineInfo.text, '模式:', mode, '出现次数:', underlineInfo.occurrenceIndex);
            } catch (e) {
                console.log('保存划线失败:', e);
            }
        }).catch((err) => {
            console.log('添加下划线失败:', err);
        });
    }).catch((err) => {
        console.log('获取选中文本失败:', err);
    });
}

// 处理取消下划线的函数
function handleRemoveUnderline(contents, underlineText = null) {
    // 如果提供了划线文本，直接使用；否则尝试获取选中文本
    const getTextPromise = underlineText ? 
        Promise.resolve(underlineText) : 
        contents.executeJavaScript('window.getSelection().toString()');
        
    getTextPromise.then((selectedText) => {
        console.log('开始取消划线selectedText:',selectedText)
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
                let underlineNodes = [];
                 let underlineText = '';
                
                // 方案1: 如果有选中文本，按照原有逻辑处理
                if (selectedTextObj.rangeCount > 0 ) {
                    console.log("开始取消划线 - 有选中文本");
                    // 检查选中的内容是否在划线元素中
                    let currentNode = selectedTextObj.anchorNode;
                    let underlineNode = null;

                    // 向上查找划线元素
                    while (currentNode && currentNode !== document.body) {
                        console.log("检查节点:", currentNode, "类名:", currentNode.className);
                        if (currentNode.classList && currentNode.classList.contains('underline-fb3b780f')) {
                            underlineNode = currentNode;
                            console.log("找到划线元素:", underlineNode);
                            
                            //获取关联节点
                            const name=underlineNode.getAttribute('name');
                            const dataOccurrenceIndex=underlineNode.getAttribute('data-occurrence-index');
                            console.log("关联节点名称:", name);
                            if (name) {
                                console.log("关联节点名称存在，尝试查找关联节点");
                                
                                const multiNodes =document.querySelectorAll('[name="'+name+'"][data-occurrence-index="'+dataOccurrenceIndex+'"]');//跨文本节点
                                const associatedNodes = document.getElementsByName(name);// 根据名称查找关联节点
                                if (associatedNodes.length > 0){
                                    underlineNodes=[...associatedNodes]//name获取的包含有currentNode节点，直接赋值associatedNodes没有map方法,只能将其转换为数组
                                }
                                console.log("划线关联节点:", associatedNodes, underlineNodes,underlineNodes.map);

                                underlineText = Array.from(multiNodes).map(node => node.textContent|| node.innerText || '').join('');
                            }else{
                                console.log("关联节点名称不存在");//这种情况基本不存，因为现在都设置有name属性
                                underlineNodes.push(underlineNode);
                                underlineText = underlineNode.textContent|| underlineNode.innerText || '';
                            }

                            break;
                        }
                        currentNode = currentNode.parentNode;
                    }
                        
                    // 如果未找到划线元素
                    if (underlineNodes.length == 0) {
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
                        
                        while (node = walker.nextNode()) {
                            console.log("遍历节点:", node, "类名:", node.className);
                            if (node.classList && node.classList.contains('underline-fb3b780f')) {
                                underlineNodes.push(node);
                                console.log("找到带下划线的节点:", node);
                            }
                        }
                    }
                    
                    if (underlineNodes.length > 0) {
                     // 移除找到的划线元素的类名
                        underlineNodes.forEach(node => {
                            console.log("移除划线节点类名:", node);
                            node.classList.remove('underline-fb3b780f');
                            node.removeAttribute('name');//移除name属性
                            console.log("已移除划线节点类名");
                        });
                    }else{
                        console.log("未找到划线元素1");
                    }
                   
                } else {
                    // 方案2: 没有选中文本时，查找页面上所有的划线元素
                    console.log("开始取消划线 - 无选中文本，查找所有划线元素");
                    const allUnderlineElements = document.querySelectorAll('.underline-fb3b780f');
                    console.log("找到划线元素数量:", allUnderlineElements.length);
                    
                    // 如果只有一个划线元素，直接移除
                    if (allUnderlineElements.length === 1) {
                        const element = allUnderlineElements[0];
                        console.log("移除唯一划线元素:", element);
                        element.classList.remove('underline-fb3b780f');
                        underlineNodes.push(element);
                    } else if (allUnderlineElements.length > 1) {
                        // 如果有多个划线元素，需要用户确认或者提供更多信息
                        console.log("发现多个划线元素，需要进一步处理");
                        // 这里可以添加更复杂的逻辑来确定要删除哪个元素
                        // 暂时移除第一个元素作为示例
                        const firstElement = allUnderlineElements[0];
                        console.log("移除第一个划线元素:", firstElement);
                        firstElement.classList.remove('underline-fb3b780f');
                        underlineNodes.push(firstElement);
                    }
                }

                console.log("找到划线元素数量2:",underlineNodes, underlineNodes.map);
                
                return {
                    success: underlineNodes.length > 0,
                    removedCount: underlineNodes.length,
                    removedTexts: underlineNodes.map(node => node.textContent || node.innerText || ''),
                    underlineText: underlineText
                };
            })()`
        ).then((result) => {
            console.log("删除划线执行结果:", result);
            // 成功取消下划线后，从划线数据中删除对应的记录
            const url = contents.getURL();
            selectedText=result.underlineText;
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
                        // 支持精确匹配和模糊匹配
                        const originalLength = underlineData[url].length;
                        underlineData[url] = underlineData[url].filter(item => {
                            // 精确匹配
                            if (item.text === selectedText) {
                                return false;
                            }
                            // 模糊匹配（去除空白字符后比较）
                            const cleanItemText = item.text.replace(/\s+/g, '');
                            const cleanSelectedText = selectedText.replace(/\s+/g, '');
                            if (cleanItemText === cleanSelectedText) {
                                return false;
                            }
                            return true;
                        });
                        
                        console.log(`从 ${originalLength} 条记录中删除了 ${originalLength - underlineData[url].length} 条`);
                        
                        // 如果该URL没有划线记录了，删除该URL的条目
                        if (underlineData[url].length === 0) {
                            delete underlineData[url];
                        }
                        
                        // 保存更新后的数据
                        fs.writeFileSync(underlineFilePath, JSON.stringify(underlineData, null, 2), 'utf8');
                        console.log('已删除划线信息1:', url, selectedText);
                    }
                } catch (e) {
                    console.error('删除划线失败:', e);
                }
            } else if (url && result.removedTexts && result.removedTexts.length > 0) {
                //正常都不会执行
                // 如果没有选中文本但成功移除了划线元素，使用移除的文本进行删除
                try {
                    let underlineData = {};
                    if (fs.existsSync(underlineFilePath)) {
                        const data = fs.readFileSync(underlineFilePath, 'utf8');
                        underlineData = JSON.parse(data);
                    }
                    
                    if (underlineData[url]) {
                        const originalLength = underlineData[url].length;
                        // 根据移除的文本内容删除对应的记录
                        result.removedTexts.forEach(removedText => {
                            underlineData[url] = underlineData[url].filter(item => {
                                // 精确匹配
                                if (item.text === removedText) {
                                    return false;
                                }
                                // 模糊匹配
                                const cleanItemText = item.text.replace(/\s+/g, '');
                                const cleanRemovedText = removedText.replace(/\s+/g, '');
                                if (cleanItemText === cleanRemovedText) {
                                    return false;
                                }
                                return true;
                            });
                        });
                        
                        console.log(`从 ${originalLength} 条记录中删除了相关记录`);
                        
                        // 如果该URL没有划线记录了，删除该URL的条目
                        if (underlineData[url].length === 0) {
                            delete underlineData[url];
                        }
                        
                        // 保存更新后的数据
                        fs.writeFileSync(underlineFilePath, JSON.stringify(underlineData, null, 2), 'utf8');
                        console.log('已删除划线信息2:', url, result.removedTexts);
                    }
                } catch (e) {
                    console.error('删除划线失败:', e);
                }
            }
        }).catch((err) => {
            console.log('取消下划线失败:', err);
        });
    }).catch((err) => {
        console.log('获取划线文本失败:', err);
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