const { app, BrowserWindow, WebContentsView, Menu, BrowserWindow: BW, session, protocol, ipcMain, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const registerIpcHandlers = require('./main/ipcHandlers');
const createWindowManager = require('./main/windowManager');
const createUnderlineContextMenu = require('./main/underlineContextMenu');
const { createShowDialog, closeDialog, isShowingSavedPasswords } = require('./main/dialog');
const { initPasswordManager } = require('./main/passwordManager');

/** 获取 preload 脚本的绝对路径（开发与打包均可用；打包且 asarUnpack 时指向 app.asar.unpacked 内文件） */
function getPreloadPath(filename) {
    if (!app.isPackaged) {
        return path.join(__dirname, filename);
    }
    // 打包后 __dirname 为 .../resources/app.asar，preload 解包在 app.asar.unpacked 下
    const resourcesDir = path.dirname(__dirname);
    return path.join(resourcesDir, 'app.asar.unpacked', filename);
}

// 与 Chrome 一致的 User-Agent，避免部分站点（如云控制台登录页）因检测到 Electron 而返回空白或限制内容
const CUSTOM_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

// WebContentsView 管理器 - 存储所有标签页 WebContentsView 实例
const browserViews = new Map(); // Map<tabId, WebContentsView>
let tabIdCounter = 0; //标签页 ID 计数器
// 当前激活的 tabId
let lastActiveTabId = null;
// 搜索面板 WebContentsView
let searchPanelView = null;
// 历史记录自动匹配 WebContentsView
let historyAutocompleteView = null;
// 密码管理模块 API
let passwordManagerIpcApi = null;

// 主窗口引用
let mainWindow = null;
// 书签模块 API（延迟初始化）
let bookmarksIpcApi = {
    updateBookmarkDropdownBounds: () => { },
    hideFolderDropdown: () => { }
};
// 下载模块 API（延迟初始化）
let downloadsIpcApi = {
    hideDownloadsPanel: () => { }
};
/** 供下载模块感知主窗口焦点（系统另存为弹窗启发式），在 registerIpcHandlers 之后赋值 */
let downloadsMainWindowHooks = {
    onBlur: () => {},
    onFocus: () => {}
};
let showDialog = null;

// 历史记录数据文件路径（需要在 app.whenReady 之后才能正确获取 userData 路径，但定义在这里用于后续使用）
let historyFilePath = null;

// 辅助函数：检查是否为自定义协议
function isCustomProtocol(url) {
    if (!url) return false;
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'file:';
    } catch (e) {
        console.error("isCustomProtocol err=>", e)
        // 如果 URL 解析失败，可能是相对路径，返回 false（不是自定义协议）
        return false;
    }
}

// WebContentsView 管理函数
const bookmarkBarY = 82; // 书签栏 Y 坐标（地址栏下方）
const bookmarkBarHeight = 50; // 书签栏高度
const viewY = 82 + bookmarkBarHeight;

// 注意：书签栏已移至 index.html 中，此函数已废弃
// function createBookmarkBarView(window) { ... }

// 注意：书签栏已移至 index.html 中，此函数已废弃
// function updateBookmarkBarBounds(window) { ... }

/**
 * 创建新的 WebContentsView（标签页）
 * @param {BrowserWindow} window -
 * @param {string} url -要的URL
 * @returns {number} tabId - 新创建的标签页ID
 */
// 创建历史记录自动匹配的 WebContentsView
function createHistoryAutocompleteView(window) {
    if (historyAutocompleteView) {
        // 如果已经存在，先销毁
        try {
            if (window && !window.isDestroyed()) {
                window.contentView.removeChildView(historyAutocompleteView);
            }
            if (historyAutocompleteView.webContents && !historyAutocompleteView.webContents.isDestroyed()) {
                historyAutocompleteView.webContents.destroy();
            }
        } catch (e) {
            console.error('销毁历史记录自动匹配 WebContentsView 失败:', e);
        }
        historyAutocompleteView = null;
    }

    try {
        // 创建 WebContentsView 实例
        historyAutocompleteView = new WebContentsView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,//contextIsolation为false时，preload脚本不能加载
                preload: getPreloadPath('preload-history-autocomplete.js')
            }
        });

        // 透明背景（WebContentsView 默认白底）
        historyAutocompleteView.setBackgroundColor('#00000000');

        // 设置 WebContentsView 到窗口
        window.contentView.addChildView(historyAutocompleteView);

        // 加载自动匹配页面
        const autocompleteUrl = 'file://' + __dirname.replace(/\\/g, '/') + '/html/history-autocomplete.html';
        historyAutocompleteView.webContents.loadURL(autocompleteUrl);

        // loadURL 是异步的，页面加载完成时可能抢走焦点，需要还给主渲染进程
        historyAutocompleteView.webContents.once('did-finish-load', () => {
            if (window && !window.isDestroyed()) {
                window.webContents.focus();
            }
        });

        console.log('历史记录自动匹配 WebContentsView 创建成功');
        return historyAutocompleteView;
    } catch (error) {
        console.error('创建历史记录自动匹配 WebContentsView 失败:', error);
        return null;
    }
}

// 显示历史记录自动匹配 WebContentsView
function showHistoryAutocomplete(window, items, addressInputBounds) {
    if (!historyAutocompleteView) {
        console.log("createHistoryAutocompleteView")
        createHistoryAutocompleteView(window);
    }

    if (!historyAutocompleteView) return;

    try {
        // 确保 WebContentsView 被添加到窗口中
        window.contentView.addChildView(historyAutocompleteView);
        // addChildView 会让新 view 抢走焦点，立即还给主渲染进程（地址栏）
        // window.webContents.focus();

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

        // 发送匹配结果到 WebContentsView
        if (!historyAutocompleteView.webContents.isDestroyed()) {
            console.log('发送历史记录自动匹配数据到 WebContentsView');
            historyAutocompleteView.webContents.send('update-history-autocomplete', items);
        }

        console.log('显示历史记录自动匹配 WebContentsView.items[0]:', JSON.stringify(items[0]));

        console.log(`显示历史记录自动匹配，项目数: ${items.length}, 位置: (${x}, ${y}),尺: ${width}x${maxHeight}`);
    } catch (error) {
        console.error('显示历史记录自动匹配失败:', error);
    }
}

// 隐藏历史记录自动匹配 WebContentsView
function hideHistoryAutocomplete(window) {
    if (!historyAutocompleteView) return;

    try {
        if (window && !window.isDestroyed()) {
            window.contentView.removeChildView(historyAutocompleteView);
        }
        // console.log('隐藏历史记录自动匹配 WebContentsView');
    } catch (error) {
        console.error('隐藏历史记录自动匹配 WebContentsView 失败:', error);
    }
}

// 销毁历史记录自动匹配 WebContentsView
function destroyHistoryAutocompleteView() {
    if (!historyAutocompleteView) return;

    try {
        if (historyAutocompleteView.webContents && !historyAutocompleteView.webContents.isDestroyed()) {
            historyAutocompleteView.webContents.destroy();
        }
        historyAutocompleteView = null;
        console.log('销毁历史记录自动匹配 WebContentsView');
    } catch (error) {
        console.error('销毁历史记录自动匹配 WebContentsView 失败:', error);
    }
}


const willPreventUnloadMap=new Map();

/**
 * 创建新的 WebContentsView（标签页）
 * @param {BrowserWindow} window -
 * @param {string} url -的URL
 * @param {boolean} isAppPage - 是否为应用内部页面
 * @returns {number} tabId - 新创建的标签页ID
 */
function createBrowserView(window, url = 'https://www.baidu.com',isAppPage) {
    const tabId = ++tabIdCounter;

    console.log(`创建新的 WebContentsView，URL: ${url}，name: ${__dirname}`);

    let preload = getPreloadPath('preload-browserview.js');
    if (isAppPage) {
        preload = getPreloadPath('preload-browserview-app.js');
    }

    // 创建 WebContentsView 实例
    const view = new WebContentsView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,//与渲染层隔离，主进程preload里的方法无法直接操作渲染层，除非通过contextBridge暴露方法，让渲染层调用
            // 指定 preload 脚本以暴露受限的 ipc API
            preload: preload,
            // 禁用外部协议处理，防止系统弹窗
            disableDialogs: false,
            //  disableBlinkFeatures: 'Autofill'
        }
    });
    // 透明背景（WebContentsView 默认白底）
    // view.setBackgroundColor('#00000000');

    // 存储 WebContentsView 实例
    browserViews.set(tabId, view);

    // 显式设置 Chrome 风格 User-Agent，避免云控制台等站点返回空白页（Chrome 可打开、Electron 空白时多为 UA/环境检测）
    view.webContents.setUserAgent(CUSTOM_USER_AGENT);

    // 设置 WebContentsView 到窗口
    window.contentView.addChildView(view);

    // 设置 WebContentsView 的尺寸和位置
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
        setupProtocolBlocking(view.webContents,window,tabId);
    } catch (e) {
        console.error('设置 WebContentsView 协议拦截失败:', e);
    }

    // 打印该标签页加载的资源链接（仅当前 view 的请求）
    const wcId = view.webContents.id;
    view.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        // if (details.webContentsId === wcId) {
        //     const type = details.resourceType || 'other';
        //     console.log(`[资源加载] tabId=${tabId} type=${type} url=${details.url}`);
        // }
        callback({});
    });

    var viewData = {}

    // 转发 WebContentsView 的导航/标题事件到渲染进程，以便更新地址栏和标签标题
    const sendUpdate = (data) => {
        try {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('browser-view-updated', Object.assign({ tabId }, data));
            }
        } catch (err) {
            console.error('发送 browser-view-updated 失败:', err);
        }
    };

    function setupViewListeners(v) {
        // 让 Electron 自动处理 beforeunload 事件，显示原生确认对话框
        // 不调用 event.preventDefault()，这样 Electron 会显示默认对话框
        // 当 webContents.close() 或导航时，会自动触发 beforeunload 检查

        v.webContents.on('did-navigate', (_event, navigationUrl, httpResponseCode) => {
            if (navigationUrl) {
                viewData["url"] = navigationUrl;
                sendUpdate(viewData);
            }
            if (httpResponseCode >= 400 || httpResponseCode <= 0) {
                console.log(`[ERROR269] url=${navigationUrl} status=${httpResponseCode}, retrying with contextIsolation=false`);
                if (!v._retriedWithoutContextIsolation) {
                    v._retriedWithoutContextIsolation = true;
                    const retryUrl = navigationUrl;
                    setTimeout(() => {
                        try {
                            const newView = new WebContentsView({
                                webPreferences: {
                                    nodeIntegration: false,
                                    contextIsolation: false,//contextIsolation为false
                                    // preload: preload,//preload脚本有contextBridge时，contextIsolation必须为true，否则不能加载。安全要求高的网站也不能加载preload
                                    disableDialogs: false,
                                }
                            });
                            newView._retriedWithoutContextIsolation = true;
                            newView.webContents.setUserAgent(CUSTOM_USER_AGENT);
                            window.contentView.removeChildView(v);
                            window.contentView.addChildView(newView);
                            const contentBounds = window.getContentBounds();
                            newView.setBounds({
                                x: 0,
                                y: viewY,
                                width: contentBounds.width,
                                height: contentBounds.height - viewY
                            });
                            browserViews.set(tabId, newView);
                            try { setupProtocolBlocking(newView.webContents); } catch (e) { }
                            setupViewListeners(newView);
                            try { v.webContents.destroy(); } catch (_) { }
                            newView.webContents.loadURL(retryUrl);
                            console.log(`[RETRY] tabId=${tabId} reloaded with contextIsolation=false: ${retryUrl}`);
                        } catch (err) {
                            console.error(`[RETRY] tabId=${tabId} failed:`, err);
                        }
                    }, 0);
                }
            }
        });

        v.webContents.on('did-navigate-in-page', (_event, navigationUrl) => {
            if (navigationUrl) {
                viewData["url"] = navigationUrl;
                sendUpdate(viewData);
            }
        });

        v.webContents.on('page-title-updated', (_event, title) => {
            if (title) {
                viewData["title"] = title;
                sendUpdate(viewData);
            }
        });

        v.webContents.on('did-start-loading', (event, a, b, c, d) => {
            console.log("did-start-loading", event, v.webContents.getURL())
            // event.preventDefault();
            // return;
            try {
                if (mainWindow && !mainWindow.isDestroyed()&&!willPreventUnloadMap.get(tabId)) {
                    mainWindow.webContents.send('browser-view-loading-state', { tabId, loading: true });
                    // 通知渲染进程清除favicon，显示加载状态
                    mainWindow.webContents.send('browser-view-favicon-cleared', { tabId });
                }
            } catch (err) {
                console.error('发送 browser-view-loading-state 失败:', err);
            }
        });

        // Ctrl+滑轮缩放
        let zoomLevel = 0
        v.webContents.on('dom-ready', () => {
            zoomLevel = v.webContents.zoomLevel
            console.log("zoomLevel.aa12b", zoomLevel)
        });

        v.webContents.on('zoom-changed', (e, zoomDirection) => {
            // console.log('zoom-changed', zoomLevel, zoomDirection)
            if (zoomDirection === 'in') {
                zoomLevel = zoomLevel += 0.2
            } else {
                zoomLevel = zoomLevel -= 0.2
            }
            v.webContents.setZoomLevel(zoomLevel)
        })

        v.webContents.on('did-finish-load', () => {
            try {
                console.log("@@@did-finish-load")
                lastActiveTabId = tabId;
                const title = v.webContents.getTitle();
                if (title) {
                    viewData["title"] = title;
                    sendUpdate(viewData);
                }
            } catch (e) {
                console.error('加载并恢复划线信息失败:', e);
            }
        });

        //这个事件跳转可能不触发
        v.webContents.on('ready-to-show', async (event,navigationUrl) => {
            console.log("ready-to-show", event,navigationUrl,v.webContents.getURL())
            
        });

        v.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            if (isMainFrame) {
                console.warn(`[WebContentsView tabId=${tabId}] 主框架加载失败: ${errorCode} ${errorDescription} ,validatedURL:${validatedURL}`);
            }
        });
      
        v.webContents.on('console-message', (_event, level, message) => {
            // if (level >= 3) console.log(`[WebContentsView tabId=${tabId} console]`, message);
            // console.log(`[WebContentsView tabId=${tabId} console]`, message,v.webContents.getURL());
        });

        v.webContents.on('did-stop-loading', async (event,a,b,c,d) => {
            console.log("did-stop-loading.a11",event,v.webContents.getURL())
            try {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('browser-view-loading-state', { tabId, loading: false });
                }
                const url = v.webContents.getURL();

                // console.log("@@@did-stop-loading", url)
                lastActiveTabId = tabId;

                const title = v.webContents.getTitle();
                if (title) {
                    viewData["title"] = title;
                    sendUpdate(viewData);
                }

                setTimeout(async () => {
                    await loadAndRestoreUnderline(url, v.webContents);
                }, 0);


                // 检查并显示保存密码弹窗
                try {
                    if (passwordManagerIpcApi && passwordManagerIpcApi.checkAndShowSavePasswordDialog) {
                        await passwordManagerIpcApi.checkAndShowSavePasswordDialog();
                    }
                } catch (e) {
                    // 忽略错误
                }

            } catch (e) {
                console.error('加载并恢复划线信息失败:', e);
            }
        });

        v.webContents.on('page-favicon-updated', (_event, favicons) => {
            if (favicons && favicons.length > 0) {
                try {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('browser-view-favicon-updated', { tabId, favicon: favicons[0] });
                    }
                } catch (err) {
                    console.error('发送 browser-view-favicon-updated 失败:', err);
                }
            }
        });

          // 监听导航开始事件，这个事件在跳转时触发
        v.webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId,x) => {
            console.log(`did-start-navigation: `,event, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId,v.webContents.getURL(),x);
            //todo:暂时根据地址判断是否刷新还是跳转，但无法区分window.reload与location.href=locaton.href 
            // event.preventDefault();
        });

        v.webContents.on('will-redirect', (event, url) => {
            console.log('will-redirect', event, url);
        })
        
        // 监听 will-prevent-unload 事件，这个事件优先于关闭时注册的will-prevent-unload事件执行
        v.webContents.on('will-prevent-unload',async (event,a) => {
            console.log('will-prevent-unload 事件被触发2a1',event,a,v.webContents.getURL());
            console.dir(event);
            console.log('will-prevent-unload 事件被触发2a1.end')

            if(closeMap.get(tabId)){
                closeMap.delete(tabId);//删除closeMap中的tabId
                return;
            }

            willPreventUnloadMap.set(tabId,true);
            event.preventDefault();//允许关闭。即阻止 阻止关闭，阻止关闭是默认行为，这里阻止默认行为（阻止关闭），就等于允许关闭
            return
            // event.preventDefault();//允许关闭。即阻止 阻止关闭，阻止关闭是默认行为，这里阻止默认行为（阻止关闭），就等于允许关闭
            
            // 显示自定义对话框
            // showDialog({
            //     message: '系统可能不会保存您所做的更改2。',
            //     confirmText: '离开',
            //     cancelText: '取消',
            //     parentWindow: mainWindow
            // }).then((result) => {
            //     if (result) {
            //         // 用户选择离开，但是这里我们不能重新触发关闭
            //         // 因为 will-prevent-unload 事件已经结束了
            //         // 实际上，一旦我们 preventDefault，Electron 就不会继续关闭了
            //         console.log('用户选择离开，但我们需要找到另一种方式');
            //     }
            // });
        });
    }

    try {
        setupViewListeners(view);
    } catch (e) {
        console.error('注册 WebContentsView 事件监听失败:', e);
    }

    console.log(`创建 WebContentsView，tabId: ${tabId}, URL: ${url}`);

    return tabId;
}

/**
 * 激活指定的 WebContentsView（标签页）
 * @param {BrowserWindow} window - 父窗口
 * @param {number} tabId - 要激活的标签页ID
 */
function activateBrowserView(window, tabId) {
    const view = browserViews.get(tabId);
    if (!view) {
        console.error(`未找到tabId为${tabId}的 WebContentsView`);
        return;
    }

    // 隐藏所有标签页视图（从 contentView 移除）
    browserViews.forEach(v => {
        window.contentView.removeChildView(v);
    });

    // 显示指定的 WebContentsView
    window.contentView.addChildView(view);
    lastActiveTabId = tabId;

    console.log(`激活 WebContentsView，tabId: ${tabId}`);

    // 如果存在搜索面板，将其重新添加以保证在最上层并重新定位
    if (searchPanelView && !searchPanelView.webContents.isDestroyed()) {
        try {
            try { window.contentView.removeChildView(searchPanelView); } catch (e) { }
            window.contentView.addChildView(searchPanelView);
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

const closeMap=new Map();
/**
 * 关闭指定的 WebContentsView（标签页）
 * @param {BrowserWindow} window - 父窗口
 * @param {number} tabId - 要关闭的标签页ID
 */
async function closeBrowserView(window, tabId) {
    const view = browserViews.get(tabId);
    if (!view) {
        console.error(`未找到tabId为${tabId}的 WebContentsView`);
        return true;
    }

    const wc = view.webContents;
    if (wc.isDestroyed()) {
        return true;
    }

    console.log('closeBrowserView.view', view);

    // 清理函数
    const cleanup = () => {
        console.log('cleanup');
        try {
            if (view && window && !window.isDestroyed()) {
                try {
                    window.contentView.removeChildView(view);
                } catch (e) {
                    // 可能已经被移除了，忽略错误
                }
            }
            if (view && view.webContents && !view.webContents.isDestroyed()) {
                view.webContents.destroy();
            }
        } catch (e) {
            console.error('清理 WebContentsView 失败:', e);
        }
        browserViews.delete(tabId);
        console.log(`关闭 WebContentsView，tabId: ${tabId}`);
    };

    try {
        console.log('closeBrowserView', wc.getURL());

        // 使用 will-prevent-unload 事件来检测
        let shouldPrompt = false;

        const handleWillPreventUnload = (event) => {
            console.log('will-prevent-unload 事件被触发1');
            shouldPrompt = true;

            closeMap.set(tabId,true);

            return
            event.preventDefault(); //允许关闭。即阻止 阻止关闭，阻止关闭是默认行为，这里阻止默认行为（阻止关闭），就等于允许关闭
        };

        wc.prependOnceListener('will-prevent-unload', handleWillPreventUnload);//使用prependOnceListener，让该事件先于已绑定的相同事件执行

        // 保存当前 URL
        const currentUrl = wc.getURL();

        try {
            // 尝试导航到 about:blank 来触发 beforeunload
            // 设置一个超时
            await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve();
                }, 300);

                console.log("close.url:",wc.getURL())
                wc.loadURL('about:blank').then(() => {
                    clearTimeout(timeout);
                    resolve();
                }).catch(() => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        } catch (e) {
            console.log('导航到 about:blank 出错:', e.message);
        }

        // 移除监听器
        wc.removeListener('will-prevent-unload', handleWillPreventUnload);

        console.log('shouldPrompt:', shouldPrompt);

        if (shouldPrompt) {
            // 如果之前导航成功，先恢复原页面
            // if (!wc.isDestroyed() && wc.getURL() === 'about:blank') {
            //     try {
            //         await wc.loadURL(currentUrl);
            //     } catch (e) {
            //         console.log('恢复原页面出错:', e.message);
            //     }
            // }

            // 显示自定义对话框
            const result = await showDialog({
                title: '离开页面？',
                message: '系统可能不会保存您所做的更改。',
                confirmText: '离开',
                cancelText: '取消',
                parentWindow: window
            });

            console.log('will-prevent-unload 事件被触发.result', result);

            if (result) {
                cleanup();
                return true;
            }else{
                console.log('will-prevent-unload 事件被触发.result.else');
                return false;
            }
        } else {
            // 没有 beforeunload，直接关闭
            cleanup();
            return true;
        }

    } catch (e) {
        console.error('关闭标签页时出错:', e);
        // 出错时直接关闭
        cleanup();
    }
    return true;
}

function closeBrowserView2(window, tabId) {
    const view = browserViews.get(tabId);
    if (!view) {
        console.error(`未找到tabId为${tabId}的 WebContentsView`);
        return;
    }

    // 从窗口移除 WebContentsView
    window.contentView.removeChildView(view);

    // 销毁 webContents
    view.webContents.destroy();

    // 从存储中删除
    browserViews.delete(tabId);

    console.log(`关闭 WebContentsView，tabId: ${tabId}`);
}

/**
 * 重新排序 WebContentsView，保持与标签 DOM 顺序一致
 * 暂时意义不大，为后续改成多视图叠加显示或标签预览做准备
 * @param {number} draggedId - 被拖动的标签页ID
 * @param {number} targetId - 目标标签页ID
 * @param {boolean} insertBefore - 是否插入到目标之前
 */
function reorderBrowserView(draggedId, targetId, insertBefore) {
    const entries = Array.from(browserViews.entries());
    const draggedEntry = entries.find(([id]) => id === draggedId);
    const targetEntry = entries.find(([id]) => id === targetId);
    if (!draggedEntry || !targetEntry) return;

    // 从数组中移除被拖动的条目
    const filtered = entries.filter(([id]) => id !== draggedId);
    const targetIndex = filtered.findIndex(([id]) => id === targetId);
    const insertIndex = insertBefore ? targetIndex : targetIndex + 1;
    filtered.splice(insertIndex, 0, draggedEntry);

    // 重建 Map 以反映新顺序
    browserViews.clear();
    filtered.forEach(([id, view]) => {
        browserViews.set(id, view);
    });
}

/**
 * 调整所有标签页 WebContentsView 的尺寸（当窗口大小改变时调用）
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

    // 更新书签栏下拉菜单位置
    bookmarksIpcApi.updateBookmarkDropdownBounds(window);

    downloadsIpcApi.hideDownloadsPanel();

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

const panelWidth = 444;
const panelHeight = 58;
const panelY = 0;
const panelPadding = 53;
// 创建并显示搜索面板（WebContentsView）
function createSearchPanel(window) {
    if (!window) return null;
    if (searchPanelView && !searchPanelView.webContents.isDestroyed()) {
        // 已存在，直接返回
        return searchPanelView;
    }

    const panel = new WebContentsView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: getPreloadPath('preload-search-panel.js')
        }
    });

    // 透明背景（WebContentsView 默认白底）
    panel.setBackgroundColor('#00000000');

    console.log('创建搜索面板 WebContentsView');

    searchPanelView = panel;
    window.contentView.addChildView(panel);

    // 初始位置与尺寸（resize 时由 resizeBrowserViews 更新）
    const contentBounds = window.getContentBounds();

    panel.setBounds({
        x: Math.max(0, contentBounds.width - panelWidth - panelPadding),
        y: panelY + panelPadding,
        width: panelWidth,
        height: panelHeight
    });

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
            try { targetView.webContents.stopFindInPage('clearSelection'); } catch (e) { }
        }
        if (window && !window.isDestroyed()) window.contentView.removeChildView(searchPanelView);

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
    // const gotTheLock = app.requestSingleInstanceLock();
    // if (!gotTheLock) {
    //     // 如果已经有实例在运行，退出当前实例
    //     app.quit();
    //     return;
    // }

    // 处理第二个实例（可能是通过协议启动）
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // 如果应用已经运行，第二个实例被启动（可能是协议链接）
        const protocolUrl = commandLine.find(arg => arg && (arg.includes('://') || arg.startsWith('bytedance') || arg.startsWith('douyin') || arg.startsWith('snssdk')));
        if (protocolUrl) {
            console.log('阻止协议请求（第二个实例）:', protocolUrl);
            // 不创建新窗口，直接返回
            return;
        }
        // 如果没有协议参数，激活现有窗口（可选行为，保留以支持从快捷方式启动时激活已有窗口）
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
function setupProtocolBlocking(contents,window,tabId) {
    console.log('设置协议拦截，webContents ID:', contents.id);

    // console.trace()

    // 监听控制台消息以调试问题（使用新的 Event 对象格式）
    contents.on('console-message', (event) => {
        const { level, message, line, sourceId } = event;
        if (message.includes('xmtls') || message.includes('wasm') || message.includes('QQ')) {
            console.log(`[WebView Console] ${message}`);
        }
    });

    // 拦截导航到自定义协议,目前发现will-prevent-unload必然触发触发本事件,同一页面内跳转也会触发。关闭时的about:blank不会触发
    // 事件顺序will-prevent-unload>did-start-loading>did-start-navigation>will-navigate 。但只有will-navigate里 event.preventDefault()才能阻止导航。
    contents.on('will-navigate',async (event, navigationUrl,a,b,c,d,e,f,g) => {
        console.log('will-navigate.a1 事件:', event,navigationUrl,contents.getURL(),contents.id);
        // event.preventDefault();

        // 显示自定义对话框
        if(window&&willPreventUnloadMap.get(tabId)){
            event.preventDefault();//先取消跳转

            willPreventUnloadMap.delete(tabId);//删除willPreventUnloadMap中的tabId

            const result = await showDialog({
                title: '离开或重新加载页面？',
                message: '系统可能不会保存您所做的更改。',
                confirmText: '确定',
                cancelText: '取消',
                parentWindow: window
            });

            if (result) {
                console.log('will-navigate 事件被触发.result.true');
                contents.loadURL(navigationUrl);
            }else{
                console.log('will-navigate 事件被触发.result.false');
            }
            
            return
        }

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
        // 记录加载失败信息（排除 xmtls.wasm）
        if (!validatedURL.includes('xmtls.wasm') && errorCode !== 0 && errorCode !== -3) {
            console.log(`页面加载失败: ${validatedURL}, 错误代码: ${errorCode}, 描述: ${errorDescription}`);

            // 跳转到网页加载失败提示页面
            const path = require('path');
            const errorPagePath = path.join(__dirname, 'html/error-page.html');

            // 构造包含错误信息的URL
            const errorPageUrl = `file://${errorPagePath.replace(/\\/g, '/')}?url=${encodeURIComponent(validatedURL)}&error=${encodeURIComponent(errorDescription)}`;

            // 加载错误页面
            contents.loadURL(errorPageUrl);
        }
    });
}

// 延迟获取 newWindow 的引用，因为它在后面才被定义
let getNewWindow;
const underlineContextMenu = createUnderlineContextMenu({
    app,
    ipcMain,
    BrowserWindow,
    Menu,
    nativeImage,
    fs: require('fs'),
    path,
    setupProtocolBlocking,
    getMainWindow: () => mainWindow,
    getLastActiveTabId: () => lastActiveTabId,
    newWindow: (url) => getNewWindow()(url)
});
underlineContextMenu.init();
const loadAndRestoreUnderline = (...args) => underlineContextMenu.loadAndRestoreUnderline(...args);

app.whenReady().then(() => {
    app.setAppUserModelId('com.elebrowser.app');
    
    // 设置历史记录数据文件路径（必须在 app.whenReady 之后）
    historyFilePath = path.join(app.getPath('userData'), 'history.json');
    
    // 初始化密码管理器
    initPasswordManager(app);

    // 在 session 级别设置 User-Agent，使主文档和所有子资源请求均生效（避免 onBeforeSendHeaders 对部分子资源不生效）
    session.defaultSession.setUserAgent(CUSTOM_USER_AGENT);

    // 全局请求头：仅注册一次，对所有 webContents 的请求（含子资源）统一生效
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const requestHeaders = details.requestHeaders || {};
        requestHeaders['Cache-Control'] = 'max-age=0';
        delete requestHeaders['sec-ch-ua'];
        delete requestHeaders['sec-ch-ua-mobile'];
        delete requestHeaders['sec-ch-ua-platform'];
        delete requestHeaders['sec-ch-ua-full-version-list'];
        requestHeaders['Sec-Ch-Ua'] = '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"';
        requestHeaders['Sec-Ch-Ua-Mobile'] = '?0';
        requestHeaders['Sec-Ch-Ua-Platform'] = '"Windows"';
        requestHeaders['Sec-Fetch-Dest'] = 'document';
        requestHeaders['Sec-Fetch-Mode'] = 'navigate';
        requestHeaders['Sec-Fetch-Site'] = 'none';
        requestHeaders['Sec-Fetch-User'] = '?1';
        requestHeaders['Accept-Encoding'] = 'gzip, deflate, br';
        callback({ requestHeaders });
    });

    // SSL证书错误消息映射
    function getCertificateErrorMessage(error) {
        const errorMessages = {
            'net::ERR_CERT_DATE_INVALID': '证书已过期或尚未生效',
            'net::ERR_CERT_COMMON_NAME_INVALID': '证书域名不匹配',
            'net::ERR_CERT_AUTHORITY_INVALID': '证书颁发机构不可信',
            'net::ERR_CERT_REVOKED': '证书已被吊销',
            'net::ERR_CERT_INVALID': '证书无效',
            'net::ERR_SSL_PROTOCOL_ERROR': 'SSL协议错误',
            'net::ERR_CONNECTION_CLOSED': '连接已关闭',
            'net::ERR_CONNECTION_RESET': '连接被重置',
            'net::ERR_CONNECTION_REFUSED': '连接被拒绝',
            'net::ERR_NAME_NOT_RESOLVED': '无法解析域名',
            'net::ERR_INTERNET_DISCONNECTED': '网络已断开',
            'net::ERR_NETWORK_IO_SUSPENDED': '网络IO已暂停',
            'net::ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN': 'SSL固定密钥不在证书链中',
            'net::ERR_SSL_CLIENT_AUTH_CERT_NEEDED': '需要客户端证书',
            'net::ERR_TUNNEL_CONNECTION_FAILED': '隧道连接失败',
            'net::ERR_CERT_WEAK_SIGNATURE_ALGORITHM': '证书签名算法太弱',
            'net::ERR_CERT_SYMantec_LEGACY': '证书由Symantec颁发（已不被信任）',
            'net::ERR_CERT_KNOWN_INTERCEPTION_BLOCKED': '证书被已知拦截器阻止'
        };
        return errorMessages[error] || error || '未知错误';
    }

    // 存储证书错误信息，用于继续访问功能
    const certificateErrors = new Map();
    // 用户选择「继续访问」后放行的主机名（按站点维度，会话内持久），避免 301 跳转后或同站 AJAX 再次报错
    const sessionAllowedCertHostnames = new Set();

    // SSL证书错误处理 - 仅当地址栏对应页面（主框架）报错时显示安全警告页面
    app.on('certificate-error', (event, webContents, url, error, certificate, callback, isMainFrame) => {
        console.log('SSL证书错误:', url, error, 'isMainFrame:', isMainFrame);

        let hostname;
        try {
            hostname = new URL(url).hostname;
        } catch (e) {
            hostname = '';
        }
        // 若该主机名已被用户选择继续访问（含同站 AJAX、重定向后回源请求），直接信任
        if (hostname && sessionAllowedCertHostnames.has(hostname)) {
            console.log('已放行该站点证书，忽略证书错误:', hostname);
            event.preventDefault();
            callback(true); // 信任证书
            return;
        }

        // 仅当主框架（地址栏里的页面）出现证书错误时才跳转 ssl-warning；子资源/iframe 报错只拒绝，不跳转
        if (isMainFrame === false) {
            event.preventDefault();
            callback(false);
            return;
        }

        // 阻止默认行为
        event.preventDefault();

        // 存储证书错误信息，用于继续访问功能
        certificateErrors.set(webContents.id, { url, error, certificate });

        // 获取主机名和错误消息
        const errorMessage = getCertificateErrorMessage(error);

        // 构建SSL警告页面的URL，通过查询参数传递信息
        const sslWarningUrl = `file://${__dirname.replace(/\\/g, '/')}/html/ssl-warning.html?hostname=${encodeURIComponent(hostname)}&url=${encodeURIComponent(url)}&error=${encodeURIComponent(error)}`;

        // 加载安全警告页面
        webContents.loadURL(sslWarningUrl);

        // 不信任证书
        callback(false);
    });

    // 处理用户选择继续访问的请求（不设置 setCertificateVerifyProc，仅用 certificate-error + 白名单，避免影响其他域名如 huahu.cool 的默认校验）
    ipcMain.on('ssl-continue-access', (event, url) => {
        const webContents = event.sender;
        const webContentsId = webContents.id;

        console.log('用户选择继续访问:', url, 'webContentsId:', webContentsId);

        let hostname;
        try {
            hostname = new URL(url).hostname;
        } catch (e) {
            hostname = '';
        }
        if (hostname) {
            sessionAllowedCertHostnames.add(hostname);
        }

        if (certificateErrors.has(webContentsId)) {
            certificateErrors.delete(webContentsId);
        }

        // 仅依赖 certificate-error：下次请求该 host 时会命中 sessionAllowedCertHostnames 并 callback(true)；其它域名（如 huahu.cool）不受影响，走系统默认验证
        webContents.loadURL(url);
    });

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
            } else if (url.includes('profile')) {
                // 处理 dxbrowser://profile/ 请求
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('open-profile-tab');
                    if (mainWindow.isMinimized()) {
                        mainWindow.restore();
                    }
                    mainWindow.focus();
                } else {
                    newWindow();
                    mainWindow.webContents.once('did-finish-load', () => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('open-profile-tab');
                        }
                    });
                }
                // 返回一个空白页面
                callback({ data: '<html><body><script>window.close();</script></body></html>', mimeType: 'text/html' });
            } else if (url.includes('sync')) {
                // 处理 dxbrowser://sync/ 请求
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('open-sync-tab');
                    if (mainWindow.isMinimized()) {
                        mainWindow.restore();
                    }
                    mainWindow.focus();
                } else {
                    newWindow();
                    mainWindow.webContents.once('did-finish-load', () => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('open-sync-tab');
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

    // 阻止外部协议弹窗（如 ms-windows-store://），Chromium 通过 openExternal 权限请求处理
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'openExternal') {
            console.log('setPermissionRequestHandler 阻止外部协议请求:', webContents.getURL());
            return callback(false);
        }
        callback(true);
    });
    
    // 创建窗口管理器
    const { newWindow: createNewWindow } = createWindowManager({
        BrowserWindow,
        appRootDir: __dirname,
        setupProtocolBlocking,
        resizeBrowserViews,
        registerAppShortcuts,
        unregisterAppShortcuts,
        hideFolderDropdown: (window) => bookmarksIpcApi.hideFolderDropdown(window),
        hideDownloadsPanel: () => downloadsIpcApi.hideDownloadsPanel(),
        getDownloadsApi: () => downloadsIpcApi,
        clearBrowserViews: () => browserViews.clear(),
        resetTabIdCounter: () => { tabIdCounter = 0; },
        setMainWindow: (window) => { mainWindow = window; },
        getMainWindow: () => mainWindow,
    });
    newWindow = createNewWindow;
    
    // 设置延迟获取 newWindow 的函数（供 underlineContextMenu 使用）
    getNewWindow = () => newWindow;
    showDialog = createShowDialog(() => mainWindow);

    // 注册 IPC 处理器（需要在 newWindow 定义之后）
    ipcModules = registerIpcHandlers({
        app,
        ipcMain,
        BrowserWindow,
        WebContentsView,
        session,
        path,
        fs: require('fs'),
        appRootDir: __dirname,
        getPreloadPath,
        historyFilePath,
        getMainWindow: () => mainWindow,
        getShowDialog: () => showDialog,
        closeDialog,
        isShowingSavedPasswords,
        getBrowserViews: () => browserViews,
        getLastActiveTabId: () => lastActiveTabId,
        getSearchPanelView: () => searchPanelView,
        getHistoryAutocompleteView: () => historyAutocompleteView,
        createBrowserView,
        activateBrowserView,
        closeBrowserView,
        reloadBrowserView,
        reloadBrowserViewIgnoringCache,
        reorderBrowserView,
        createSearchPanel,
        destroySearchPanel,
        showHistoryAutocomplete,
        hideHistoryAutocomplete,
        newWindow,
        getDownloadsApi: () => downloadsIpcApi
    });
    bookmarksIpcApi = ipcModules.bookmarks || bookmarksIpcApi;
    downloadsIpcApi = ipcModules.downloads || downloadsIpcApi;
    passwordManagerIpcApi = ipcModules.passwordManager;

    // 应用启动时不立即注册快捷键，等待窗口创建后再注册

    newWindow();
});

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
                    // console.log(`✓ 已注册快捷键: ${shortcutConfig.name} (${shortcutConfig.key})`);
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

function openDialogTestWindow() {
    // 创建一个新窗口来显示对话框测试页面
    const testWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 500,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    
    const testPath = path.join(__dirname, 'html', 'dialog', 'dialog-test.html');
    testWindow.loadFile(testPath);
    
    // 打开开发者工具方便调试
    testWindow.webContents.openDevTools();
}


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

// IPC 处理器：从主窗口拖动URL到书签管理标签
// ipcMain.on('add-bookmark-from-drag', (event, url) => {
//     console.log('收到从主窗口拖动的URL:', url);
//     // 查找书签管理的BrowserView并转发消息
//     browserViews.forEach((view, tabId) => {
//         try {
//             const viewUrl = view.webContents.getURL();
//             if (viewUrl.includes('bookmarks.html')) {
//                 console.log('找到书签管理页面，发送添加书签消息');
//                 view.webContents.send('add-bookmark-from-drag', url);
//             }
//         } catch (e) {
//             console.error('检查BrowserView URL失败:', e);
//         }
//     });
// });

const fs = require('fs');

// 自定义应用菜单（包括 File / 文件 菜单）
const isMac = process.platform === 'darwin';

//应用内快捷键
const appShortcuts = [
    {
        label: '关闭搜索',
        accelerator: 'Escape',
        visible: false,
        click: () => {
            console.log('窗口级别快捷键: 关闭搜索');
            if (mainWindow && !mainWindow.isDestroyed()) {
                destroySearchPanel(mainWindow);
            }
        }
    },
];

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

            , ...appShortcuts
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
                label: '清除浏览缓存',
                click: async () => {
                    try {
                        await session.defaultSession.clearCache();
                        await session.defaultSession.clearStorageData({ storages: ['cookies'] });
                        console.log('清除浏览缓存成功2');
                    } catch (e) {
                        console.error('清除浏览缓存失败:', e);
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
                            currentView.webContents.openDevTools();//right, bottom, detach
                            // setTimeout(() => {
                            //     console.log('打开开发者工具777.a2:', lastActiveTabId);
                            //     currentView.webContents.openDevTools({ mode: 'left' });
                            // }, 5000);
                        }
                    } else {
                        // 如果没有活动的BrowserView，就在主窗口打开
                        myWindow.webContents.openDevTools();
                    }
                }
            }
        ]
    }, {
        label: '视图',

        submenu: [
            { role: 'resetzoom', label: '重置缩放' },
            { role: 'resetzoom', label: '重置缩放0', visible: false, accelerator: 'CommandOrControl+num0' },
            { role: 'zoomin', label: '放大' },
            { role: 'zoomin', label: '放大0', visible: false, accelerator: isMac ? 'Cmd+Plus' : 'Ctrl+=' },
            { role: 'zoomin', label: '放大1', visible: false, accelerator: 'CommandOrControl+numadd' },
            { role: 'zoomout', label: '缩小' },
            { role: 'zoomout', label: '缩小0', visible: false, accelerator: 'CommandOrControl+numsub' },
            { role: 'togglefullscreen', label: '全屏/退出全屏', accelerator: isMac ? 'Cmd+F11' : 'Ctrl+F11' },
        ]
    }
];


// 开发测试菜单（仅在开发模式显示）
if (!app.isPackaged) {
    template.push({
        label: '开发',
        submenu: [
            {
                label: '对话框测试页面',
                accelerator: isMac ? 'Cmd+Shift+D' : 'Ctrl+Shift+D',
                click: () => {
                    openDialogTestWindow();
                }
            }
        ]
    });
}

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