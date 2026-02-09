const { ipcRenderer } = require('electron');

const DEFAULT_URL = "https://www.baidu.com"//'https://wx.mail.qq.com/';
const tabsContainer = document.getElementById('tabs');
const webviewsContainer = document.getElementById('webviews');
const addTabBtn = document.getElementById('add-tab');
const addressInput = document.getElementById('address-input');
const goBtn = document.getElementById('address-go');
const backBtn = document.getElementById('nav-back');
const forwardBtn = document.getElementById('nav-forward');
const refreshBtn = document.getElementById('nav-refresh');

let tabIdCounter = 0;
let currentTabId = null;

// Safe helpers for calling webview methods that require the webview
// to be attached and dom-ready. These wrappers avoid throwing
// when the underlying method is not available yet.
function safeGetURL(wv) {
    if (!wv) return '';
    try {
        if (typeof wv.getURL === 'function') return wv.getURL();
    } catch (e) {
        // ignore
    }
    return wv.src || '';
}

function safeGetTitle(wv) {
    if (!wv) return '';
    try {
        if (typeof wv.getTitle === 'function') return wv.getTitle();
    } catch (e) {
        // ignore
    }
    return '';
}

function safeCanGoBack(wv) {
    if (!wv) return false;
    try {
        return typeof wv.canGoBack === 'function' && wv.canGoBack();
    } catch (e) {
        return false;
    }
}

function safeCanGoForward(wv) {
    if (!wv) return false;
    try {
        return typeof wv.canGoForward === 'function' && wv.canGoForward();
    } catch (e) {
        return false;
    }
}

// Safe wrappers for executeJavaScript / findInPage / stopFindInPage
function safeExecuteJS(wv, code) {
    if (!wv) return Promise.resolve();
    try {
        if (typeof wv.executeJavaScript === 'function') {
            return wv.executeJavaScript(code).catch(() => {});
        }
    } catch (e) {
        // ignore
    }
    return Promise.resolve();
}

function safeStopFind(wv, action) {
    if (!wv) return;
    try {
        if (typeof wv.stopFindInPage === 'function') {
            wv.stopFindInPage(action);
        }
    } catch (e) {
        // ignore
    }
}

function safeFindInPage(wv, text, options) {
    if (!wv) return;
    try {
        if (typeof wv.findInPage === 'function') {
            wv.findInPage(text, options);
        }
    } catch (e) {
        // ignore
    }
}

function formatUrl(input) {
    if (!input) return DEFAULT_URL;
    const trimmed = input.trim();
    // 检查是否是 dxbrowser:// 协议
    if (trimmed.startsWith('dxbrowser://')) {
        return trimmed;
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return trimmed;
    return 'https://' + trimmed;
}

function updateAddressBar(url) {
    if (currentTabId == null) return;
    addressInput.value = url || '';
}

async function loadAddressForCurrentTab() {
    const inputValue = addressInput.value.trim();
    
    // 检查是否是 dxbrowser://bookmarks/ 协议
    if (inputValue === 'dxbrowser://bookmarks/' || inputValue.startsWith('dxbrowser://bookmarks')) {
        await openBookmarksTab();
        return;
    }
    
    // 检查是否是 dxbrowser://history/ 协议
    if (inputValue === 'dxbrowser://history/' || inputValue.startsWith('dxbrowser://history')) {
        await openHistoryTab();
        return;
    }
    
    if (currentTabId == null) return;
    
    const target = formatUrl(inputValue);
    
    try {
        // 尝试使用 BrowserView 方式加载URL
        const success = await ipcRenderer.invoke('browser-view-load-url', currentTabId, target);
        if (!success) {
            // 如果 BrowserView 方式失败，回退到 webview 方式
            const wv = document.querySelector('webview[data-id="' + currentTabId + '"]');
            if (wv) {
                wv.src = target;
            }
        }
    } catch (error) {
        console.error('加载URL失败:', error);
        // 回退到 webview 方式
        const wv = document.querySelector('webview[data-id="' + currentTabId + '"]');
        if (wv) {
            wv.src = target;
        }
    }
}

async function openBookmarksTab() {
    // 检查是否已经有书签管理器标签页
    const existingTab = document.querySelector('.tab[data-bookmarks="true"]');
    if (existingTab) {
        const tabId = Number(existingTab.dataset.id);
        activateTab(tabId);
        return;
    }
    
    try {
        // 使用主进程的 createBrowserView 创建书签管理器
        const bookmarksUrl = 'file://' + __dirname.replace(/\\/g, '/') + '/bookmarks/bookmarks.html';
        const tabId = await ipcRenderer.invoke('create-browser-view', bookmarksUrl);
        // console.log('创建书签管理器标签页成功，tabId:', tabId);
        console.trace('创建书签管理器标签页成功，tabId:', tabId);
        
        // 创建 tab 按钮
        const tabEl = document.createElement('div');
        tabEl.className = 'tab active';
        tabEl.dataset.id = tabId;
        tabEl.dataset.bookmarks = 'true';
        
        // 创建标签文本容器
        const textEl = document.createElement('span');
        textEl.className = 'tab-text';
        textEl.textContent = '书签管理';
        tabEl.appendChild(textEl);
        
        const closeEl = document.createElement('span');
        closeEl.className = 'close';
        closeEl.textContent = '×';
        tabEl.appendChild(closeEl);
        
        // 临时移除加号按钮
        const addButton = document.getElementById('add-tab');
        if (addButton) {
            addButton.remove();
        }
        
        tabsContainer.appendChild(tabEl);
        
        // 重新添加加号按钮到末尾
        if (addButton) {
            tabsContainer.appendChild(addButton);
        }
        
        // 点击切换标签
        let clickCount = 0;
        let clickTimer = null;
        
        tabEl.addEventListener('click', (e) => {
            if (e.target === closeEl) return;
            
            clickCount++;
            
            if (clickCount === 1) {
                // 第一次点击，启动计时器
                clickTimer = setTimeout(() => {
                    // 单击：激活标签
                    activateTab(tabId);
                    clickCount = 0;
                }, 300); // 300ms 内没有第二次点击则认为是单击
            } else if (clickCount === 2) {
                // 双击：关闭标签
                clearTimeout(clickTimer);
                closeTab(tabId);
                clickCount = 0;
            }
        });
        
        // 关闭标签
        closeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(tabId);
        });
        
        // 激活新建的标签
        currentTabId = tabId;
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', Number(tab.dataset.id) === tabId);
        });
        // 注意：这里不再需要切换webview的active状态，因为使用BrowserView
        
        updateAddressBar('dxbrowser://bookmarks/');
    } catch (error) {
        console.error('创建书签管理器标签页失败:', error);
        // 如果IPC调用失败，回退到原来的webview方式
        openBookmarksTabFallback();
    }
}

// 回退到原来的webview创建方式
function openBookmarksTabFallback() {
    // 创建书签管理器标签页
    const id = ++tabIdCounter;
    
    // 创建 tab 按钮
    const tabEl = document.createElement('div');
    tabEl.className = 'tab active';
    tabEl.dataset.id = id;
    tabEl.dataset.bookmarks = 'true';
    
    // 创建标签文本容器
    const textEl = document.createElement('span');
    textEl.className = 'tab-text';
    textEl.textContent = '书签管理';
    tabEl.appendChild(textEl);
    
    const closeEl = document.createElement('span');
    closeEl.className = 'close';
    closeEl.textContent = '×';
    tabEl.appendChild(closeEl);
    
    // 临时移除加号按钮
    const addButton = document.getElementById('add-tab');
    if (addButton) {
        addButton.remove();
    }
    
    tabsContainer.appendChild(tabEl);
    
    // 重新添加加号按钮到末尾
    if (addButton) {
        tabsContainer.appendChild(addButton);
    }
    
    // 创建对应的 webview
    const wv = document.createElement('webview');
    // 使用绝对路径，因为 index.html 和 bookmarks.html 都在 html 目录下
    const path = require('path');
    const bookmarksPath = path.join(__dirname,'bookmarks/bookmarks.html');
    // 确保路径格式正确（Windows 路径需要转换）
    let filePath = bookmarksPath.replace(/\\/g, '/');
    if (!filePath.startsWith('/')) {
        filePath = '/' + filePath;
    }
    wv.src = 'file://' + filePath;
    wv.dataset.id = id;
    wv.setAttribute('allowpopups', 'false');
    wv.setAttribute('nodeintegration', 'true');
    wv.setAttribute('webpreferences', 'nodeIntegration=yes,contextIsolation=no');
    
    // 设置协议拦截
    wv.addEventListener('new-window', (e) => {
        e.preventDefault();
        if (e.url && (e.url.startsWith('http://') || e.url.startsWith('https://'))) {
            createTab(e.url, e.url);
        }
    });
    
    webviewsContainer.appendChild(wv);
    
    // 点击切换标签
    let clickCount = 0;
    let clickTimer = null;
    
    tabEl.addEventListener('click', (e) => {
        if (e.target === closeEl) return;
        
        clickCount++;
        
        if (clickCount === 1) {
            // 第一次点击，启动计时器
            clickTimer = setTimeout(() => {
                // 单击：激活标签
                activateTab(id);
                clickCount = 0;
            }, 300); // 300ms 内没有第二次点击则认为是单击
        } else if (clickCount === 2) {
            // 双击：关闭标签
            clearTimeout(clickTimer);
            closeTab(id);
            clickCount = 0;
        }
    });
    
    // 关闭标签
    closeEl.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(id);
    });
    
    // 激活新建的标签
    currentTabId = id;
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', Number(tab.dataset.id) === id);
    });
    document.querySelectorAll('webview').forEach(wv => {
        wv.classList.toggle('active', Number(wv.dataset.id) === id);
    });
    
    updateAddressBar('dxbrowser://bookmarks/');
}

async function openHistoryTab() {
    // 检查是否已经有历史记录标签页
    const existingTab = document.querySelector('.tab[data-history="true"]');
    if (existingTab) {
        const tabId = Number(existingTab.dataset.id);
        activateTab(tabId);
        return;
    }
    
    try {
        // 使用主进程的 createBrowserView 创建历史记录管理器
        const historyUrl = 'file://' + __dirname.replace(/\\/g, '/') + '/history/history.html';
        const tabId = await ipcRenderer.invoke('create-browser-view', historyUrl);
        console.log('创建历史记录标签页成功，tabId:', tabId);
        
        // 创建 tab 按钮
        const tabEl = document.createElement('div');
        tabEl.className = 'tab active';
        tabEl.dataset.id = tabId;
        tabEl.dataset.history = 'true';
        
        // 创建标签文本容器
        const textEl = document.createElement('span');
        textEl.className = 'tab-text';
        textEl.textContent = '浏览历史';
        tabEl.appendChild(textEl);
        
        const closeEl = document.createElement('span');
        closeEl.className = 'close';
        closeEl.textContent = '×';
        tabEl.appendChild(closeEl);
        
        // 临时移除加号按钮
        const addButton = document.getElementById('add-tab');
        if (addButton) {
            addButton.remove();
        }
        
        tabsContainer.appendChild(tabEl);
        
        // 重新添加加号按钮到末尾
        if (addButton) {
            tabsContainer.appendChild(addButton);
        }
        
        // 点击切换标签
        let clickCount = 0;
        let clickTimer = null;
        
        tabEl.addEventListener('click', (e) => {
            if (e.target === closeEl) return;
            
            clickCount++;
            
            if (clickCount === 1) {
                // 第一次点击，启动计时器
                clickTimer = setTimeout(() => {
                    // 单击：激活标签
                    activateTab(tabId);
                    clickCount = 0;
                }, 300); // 300ms 内没有第二次点击则认为是单击
            } else if (clickCount === 2) {
                // 双击：关闭标签
                clearTimeout(clickTimer);
                closeTab(tabId);
                clickCount = 0;
            }
        });
        
        // 关闭标签
        closeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(tabId);
        });
        
        // 激活新建的标签
        currentTabId = tabId;
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', Number(tab.dataset.id) === tabId);
        });
        // 注意：这里不再需要切换webview的active状态，因为使用BrowserView
        
        updateAddressBar('dxbrowser://history/');
    } catch (error) {
        console.error('创建历史记录标签页失败:', error);
        // 如果IPC调用失败，回退到原来的webview方式
        openHistoryTabFallback();
    }
}

// 回退到原来的webview创建方式
function openHistoryTabFallback() {
    // 创建历史记录标签页
    const id = ++tabIdCounter;
    
    // 创建 tab 按钮
    const tabEl = document.createElement('div');
    tabEl.className = 'tab active';
    tabEl.dataset.id = id;
    tabEl.dataset.history = 'true';
    
    // 创建标签文本容器
    const textEl = document.createElement('span');
    textEl.className = 'tab-text';
    textEl.textContent = '浏览历史';
    tabEl.appendChild(textEl);
    
    const closeEl = document.createElement('span');
    closeEl.className = 'close';
    closeEl.textContent = '×';
    tabEl.appendChild(closeEl);
    
    // 临时移除加号按钮
    const addButton = document.getElementById('add-tab');
    if (addButton) {
        addButton.remove();
    }
    
    tabsContainer.appendChild(tabEl);
    
    // 重新添加加号按钮到末尾
    if (addButton) {
        tabsContainer.appendChild(addButton);
    }
    
    // 创建对应的 webview
    const wv = document.createElement('webview');
    // 使用绝对路径，因为 index.html 和 history.html 都在 html 目录下
    const path = require('path');
    const historyPath = path.join(__dirname, 'history/history.html');
    // 确保路径格式正确（Windows 路径需要转换）
    let filePath = historyPath.replace(/\\/g, '/');
    if (!filePath.startsWith('/')) {
        filePath = '/' + filePath;
    }
    wv.src = 'file://' + filePath;
    wv.dataset.id = id;
    wv.setAttribute('allowpopups', 'false');
    wv.setAttribute('nodeintegration', 'true');
    wv.setAttribute('webpreferences', 'nodeIntegration=yes,contextIsolation=no');
    
    // 设置协议拦截
    wv.addEventListener('new-window', (e) => {
        e.preventDefault();
        if (e.url && (e.url.startsWith('http://') || e.url.startsWith('https://'))) {
            createTab(e.url, e.url);
        }
    });
    
    webviewsContainer.appendChild(wv);
    
    // 点击切换标签
    let clickCount = 0;
    let clickTimer = null;
    
    tabEl.addEventListener('click', (e) => {
        if (e.target === closeEl) return;
        
        clickCount++;
        
        if (clickCount === 1) {
            // 第一次点击，启动计时器
            clickTimer = setTimeout(() => {
                // 单击：激活标签
                activateTab(id);
                clickCount = 0;
            }, 300); // 300ms 内没有第二次点击则认为是单击
        } else if (clickCount === 2) {
            // 双击：关闭标签
            clearTimeout(clickTimer);
            closeTab(id);
            clickCount = 0;
        }
    });
    
    // 关闭标签
    closeEl.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(id);
    });
    
    // 激活新建的标签
    currentTabId = id;
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', Number(tab.dataset.id) === id);
    });
    document.querySelectorAll('webview').forEach(wv => {
        wv.classList.toggle('active', Number(wv.dataset.id) === id);
    });
    
    updateAddressBar('dxbrowser://history/');
}

async function openUnderlineTab() {
    // 检查是否已经有划线记录标签页
    const existingTab = document.querySelector('.tab[data-underline="true"]');
    if (existingTab) {
        const tabId = Number(existingTab.dataset.id);
        activateTab(tabId);
        return;
    }
    
    try {
        // 使用主进程的 createBrowserView 创建划线记录管理器
        const underlineUrl = 'file://' + __dirname.replace(/\\/g, '/') + '/underline/underline.html';
        const tabId = await ipcRenderer.invoke('create-browser-view', underlineUrl);
        console.log('创建划线记录标签页成功，tabId:', tabId);
        
        // 创建 tab 按钮
        const tabEl = document.createElement('div');
        tabEl.className = 'tab active';
        tabEl.dataset.id = tabId;
        tabEl.dataset.underline = 'true';
        
        // 创建标签文本容器
        const textEl = document.createElement('span');
        textEl.className = 'tab-text';
        textEl.textContent = '划线记录';
        tabEl.appendChild(textEl);
        
        const closeEl = document.createElement('span');
        closeEl.className = 'close';
        closeEl.textContent = '×';
        tabEl.appendChild(closeEl);
        
        // 临时移除加号按钮
        const addButton = document.getElementById('add-tab');
        if (addButton) {
            addButton.remove();
        }
        
        tabsContainer.appendChild(tabEl);
        
        // 重新添加加号按钮到末尾
        if (addButton) {
            tabsContainer.appendChild(addButton);
        }
        
        // 点击切换标签
        let clickCount = 0;
        let clickTimer = null;
        
        tabEl.addEventListener('click', (e) => {
            if (e.target === closeEl) return;
            
            clickCount++;
            
            if (clickCount === 1) {
                // 第一次点击，启动计时器
                clickTimer = setTimeout(() => {
                    // 单击：激活标签
                    activateTab(tabId);
                    clickCount = 0;
                }, 300); // 300ms 内没有第二次点击则认为是单击
            } else if (clickCount === 2) {
                // 双击：关闭标签
                clearTimeout(clickTimer);
                closeTab(tabId);
                clickCount = 0;
            }
        });
        
        // 关闭标签
        closeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(tabId);
        });
        
        // 激活新建的标签
        currentTabId = tabId;
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', Number(tab.dataset.id) === tabId);
        });
        // 注意：这里不再需要切换webview的active状态，因为使用BrowserView
        
        updateAddressBar('dxbrowser://underline/');
    } catch (error) {
        console.error('创建划线记录标签页失败:', error);
        // 如果IPC调用失败，回退到原来的webview方式
        openUnderlineTabFallback();
    }
}

// 回退到原来的webview创建方式
function openUnderlineTabFallback() {
    // 创建划线记录标签页
    const id = ++tabIdCounter;
    
    // 创建 tab 按钮
    const tabEl = document.createElement('div');
    tabEl.className = 'tab active';
    tabEl.dataset.id = id;
    tabEl.dataset.underline = 'true';
    
    // 创建标签文本容器
    const textEl = document.createElement('span');
    textEl.className = 'tab-text';
    textEl.textContent = '划线记录';
    tabEl.appendChild(textEl);
    
    const closeEl = document.createElement('span');
    closeEl.className = 'close';
    closeEl.textContent = '×';
    tabEl.appendChild(closeEl);
    
    // 临时移除加号按钮
    const addButton = document.getElementById('add-tab');
    if (addButton) {
        addButton.remove();
    }
    
    tabsContainer.appendChild(tabEl);
    
    // 重新添加加号按钮到末尾
    if (addButton) {
        tabsContainer.appendChild(addButton);
    }
    
    // 创建对应的 webview
    const wv = document.createElement('webview');
    // 使用绝对路径，因为 index.html 和 underline.html 都在 html 目录下
    const path = require('path');
    const underlinePath = path.join(__dirname, 'underline/underline.html');
    // 确保路径格式正确（Windows 路径需要转换）
    let filePath = underlinePath.replace(/\\/g, '/');
    if (!filePath.startsWith('/')) {
        filePath = '/' + filePath;
    }
    wv.src = 'file://' + filePath;
    wv.dataset.id = id;
    wv.setAttribute('allowpopups', 'false');
    wv.setAttribute('nodeintegration', 'true');
    wv.setAttribute('webpreferences', 'nodeIntegration=yes,contextIsolation=no');
    
    // 设置协议拦截
    wv.addEventListener('new-window', (e) => {
        e.preventDefault();
        if (e.url && (e.url.startsWith('http://') || e.url.startsWith('https://'))) {
            createTab(e.url, e.url);
        }
    });
    
    webviewsContainer.appendChild(wv);
    
    // 点击切换标签
    let clickCount = 0;
    let clickTimer = null;
    
    tabEl.addEventListener('click', (e) => {
        if (e.target === closeEl) return;
        
        clickCount++;
        
        if (clickCount === 1) {
            // 第一次点击，启动计时器
            clickTimer = setTimeout(() => {
                // 单击：激活标签
                activateTab(id);
                clickCount = 0;
            }, 300); // 300ms 内没有第二次点击则认为是单击
        } else if (clickCount === 2) {
            // 双击：关闭标签
            clearTimeout(clickTimer);
            closeTab(id);
            clickCount = 0;
        }
    });
    
    // 关闭标签
    closeEl.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(id);
    });
    
    // 激活新建的标签
    currentTabId = id;
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', Number(tab.dataset.id) === id);
    });
    document.querySelectorAll('webview').forEach(wv => {
        wv.classList.toggle('active', Number(wv.dataset.id) === id);
    });
    
    updateAddressBar('dxbrowser://underline/');
}

// 记录浏览历史
function recordHistory(title, url) {
    // 避免记录内部协议页面
    if (url.startsWith('dxbrowser://') || url.includes('bookmarks.html') || url.includes('history.html')) {
        return;
    }
    
    try {
        // 通过IPC发送消息给主进程，让主进程处理历史记录
        ipcRenderer.invoke('record-history', title, url);
    } catch (e) {
        console.error('记录历史失败:', e);
        
        // 如果IPC调用失败，尝试使用本地存储
        try {
            const historyItem = {
                id: Date.now() + Math.random(),
                title: title || url,
                url: url,
                timestamp: Date.now(),
                date: new Date().toLocaleDateString(),
                time: new Date().toLocaleTimeString()
            };
            
            let history = [];
            const stored = localStorage.getItem('browser_history');
            if (stored) {
                history = JSON.parse(stored);
            }
            
            // 检查是否已存在相同的URL（避免重复）
            const existingIndex = history.findIndex(item => item.url === url);
            if (existingIndex !== -1) {
                history.splice(existingIndex, 1);
            }
            
            // 将新记录添加到开头
            history.unshift(historyItem);
            
            // 只保留最近的1000条记录
            if (history.length > 1000) {
                history = history.slice(0, 1000);
            }
            
            localStorage.setItem('browser_history', JSON.stringify(history));
        } catch (storageErr) {
            console.error('本地存储历史失败:', storageErr);
        }
    }
}

function updateNavButtons() {
    const wv = currentTabId != null
        ? document.querySelector('webview[data-id="' + currentTabId + '"]')
        : null;
    const canGoBack = safeCanGoBack(wv);
    const canGoForward = safeCanGoForward(wv);
    backBtn.disabled = !canGoBack;
    forwardBtn.disabled = !canGoForward;
    refreshBtn.disabled = !wv;
}

async function createTab(url = DEFAULT_URL, title = '新标签页') {
    try {
        // 调用主进程的 createBrowserView 方法
        const tabId = await ipcRenderer.invoke('create-browser-view', url);
        console.log('创建BrowserView标签页成功，tabId:', tabId);
        
        // 创建 tab 按钮
        const tabEl = document.createElement('div');
        tabEl.className = 'tab';
        tabEl.dataset.id = tabId;
        
        // 创建标签文本容器
        const textEl = document.createElement('span');
        textEl.className = 'tab-text';
        textEl.textContent = title;
        tabEl.appendChild(textEl);
        
        const closeEl = document.createElement('span');
        closeEl.className = 'close';
        closeEl.textContent = '×';
        tabEl.appendChild(closeEl);

        const addButton = document.getElementById('add-tab');
        if (addButton) {
            // 临时移除加号按钮
            addButton.remove();
        }
        
        tabsContainer.appendChild(tabEl);
        
        // 重新添加加号按钮到末尾
        if (addButton) {
            tabsContainer.appendChild(addButton);
        }

        // 点击切换标签
        let clickCount = 0;
        let clickTimer = null;
        
        tabEl.addEventListener('click', (e) => {
            if (e.target === closeEl) return; // 关闭按钮单独处理
            
            clickCount++;
            
            if (clickCount === 1) {
                // 第一次点击，启动计时器
                clickTimer = setTimeout(() => {
                    // 单击：激活标签
                    activateTab(tabId);
                    clickCount = 0;
                }, 300); // 300ms 内没有第二次点击则认为是单击
            } else if (clickCount === 2) {
                // 双击：关闭标签
                clearTimeout(clickTimer);
                closeTab(tabId);
                clickCount = 0;
            }
        });

        // 关闭标签
        closeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(tabId);
        });

        // 激活新建的标签
        activateTab(tabId);
        updateAddressBar(url);
        updateNavButtons();
        
        return tabId;
    } catch (error) {
        console.error('创建标签页失败:', error);
        // 如果IPC调用失败，回退到原来的webview方式
        return createTabFallback(url, title);
    }
}

// 回退到原来的webview创建方式
function createTabFallback(url = DEFAULT_URL, title = '新标签页') {
    const id = ++tabIdCounter;
    
    // 检查是否是书签管理器
    const isBookmarks = url === 'dxbrowser://bookmarks/' || url.includes('bookmarks.html');
    if (isBookmarks) {
        return openBookmarksTab();
    }
    
    // 检查是否是历史记录页面
    const isHistory = url === 'dxbrowser://history/' || url.includes('history.html');
    if (isHistory) {
        return openHistoryTab();
    }

    // 创建 tab 按钮
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.dataset.id = id;
    
    // 创建标签文本容器
    const textEl = document.createElement('span');
    textEl.className = 'tab-text';
    textEl.textContent = title;
    tabEl.appendChild(textEl);
    
    const closeEl = document.createElement('span');
    closeEl.className = 'close';
    closeEl.textContent = '×';
    tabEl.appendChild(closeEl);

    const addButton = document.getElementById('add-tab');
    if (addButton) {
        // 临时移除加号按钮
        addButton.remove();
    }
    
    tabsContainer.appendChild(tabEl);
    
    // 重新添加加号按钮到末尾
    if (addButton) {
        tabsContainer.appendChild(addButton);
    }

    // 创建对应的 webview
    const wv = document.createElement('webview');
    // 处理 dxbrowser://bookmarks/ 协议，转换为本地文件路径
    let srcUrl = url;
    if (url === 'dxbrowser://bookmarks/' || url.startsWith('dxbrowser://bookmarks')) {
        // 使用绝对路径加载本地文件
        const path = require('path');
        console.log("path11:",__dirname);
        const bookmarksPath = path.join(__dirname, 'bookmarks/bookmarks.html');
        // 确保路径格式正确（Windows 路径需要转换）
        let filePath = bookmarksPath.replace(/\\/g, '/');
        if (!filePath.startsWith('/')) {
            filePath = '/' + filePath;
        }
        srcUrl = 'file://' + filePath;
    }
    wv.src = srcUrl;
    wv.dataset.id = id;
    wv.setAttribute('nodeintegration', 'false');
    wv.setAttribute('webpreferences', 'contextIsolation=yes');
    // 禁用弹出窗口，防止自定义协议链接打开外部应用
    wv.setAttribute('allowpopups', 'false');
    
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
    
    // 阻止自定义协议；对于正常 http/https 链接，改为新建标签页打开
    wv.addEventListener('new-window', (e) => {
        if (isCustomProtocol(e.url)) {
            e.preventDefault();
            console.log('阻止打开自定义协议链接:', e.url);
            return;
        }

        if (e.url && (e.url.startsWith('http://') || e.url.startsWith('https://'))) {
            e.preventDefault();
            // 在新标签中打开原本要新窗口打开的链接
            createTab(e.url, e.url);
        }
    });
    
    // 阻止导航到自定义协议
    wv.addEventListener('will-navigate', (e) => {
        if (isCustomProtocol(e.url)) {
            e.preventDefault();
            console.log('阻止导航到自定义协议:', e.url);
        }
    });
    
    // 监听 webview 的 webContents 事件（通过 IPC）
    wv.addEventListener('did-attach', () => {
        // webview 附加后，主进程的事件监听器会自动处理
    });
    
    // 在页面加载前注入 JavaScript 来拦截所有协议链接
    wv.addEventListener('did-start-loading', () => {
        // 在页面开始加载时就注入拦截代码
            safeExecuteJS(wv, `
                (function() {
                    // 立即拦截所有可能的协议调用方式
                    if (window.location && window.location.href) {
                        const currentHref = window.location.href;
                        if (currentHref && !currentHref.startsWith('http://') && !currentHref.startsWith('https://') && !currentHref.startsWith('file://') && currentHref.includes('://')) {
                            console.log('阻止初始加载的自定义协议:', currentHref);
                            window.stop();
                            return;
                        }
                    }
                })();
            `);
    });
    
    // 在页面加载时注入 JavaScript 来拦截所有协议链接
    wv.addEventListener('dom-ready', () => {
        // 注入代码拦截所有链接点击和协议调用
        safeExecuteJS(wv, `
            (function() {
                // 拦截所有链接点击
                document.addEventListener('click', function(e) {
                    let target = e.target;
                    while (target && target.tagName !== 'A') {
                        target = target.parentElement;
                    }
                    if (target && target.href) {
                        const url = target.href;
                        if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://') && url.includes('://')) {
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();
                            console.log('阻止自定义协议链接:', url);
                            return false;
                        }
                    }
                }, true); // 使用捕获阶段
                
                // 拦截 window.open 调用
                const originalOpen = window.open;
                window.open = function(url, target, features) {
                    if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://') && url.includes('://')) {
                        console.log('阻止 window.open 自定义协议:', url);
                        return null;
                    }
                    return originalOpen.call(window, url, target, features);
                };
                
                // 拦截 location.href 赋值
                try {
                    const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
                    if (locationDescriptor && locationDescriptor.set) {
                        const originalLocationSetter = locationDescriptor.set;
                        Object.defineProperty(window, 'location', {
                            set: function(url) {
                                if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://') && url.includes('://')) {
                                    console.log('阻止 location 跳转到自定义协议:', url);
                                    return;
                                }
                                originalLocationSetter.call(window, url);
                            },
                            get: locationDescriptor.get
                        });
                    }
                } catch (e) {
                    // 某些浏览器可能不允许修改 location
                    console.log('无法拦截 location:', e);
                }
                
                // 抑制 xmtls.wasm 加载错误的控制台警告
                const originalError = console.error;
                console.error = function(...args) {
                    const msg = args.join(' ');
                    if (msg.includes('xmtls.wasm') || msg.includes('ERR_FILE_NOT_FOUND')) {
                        // 忽略 xmtls.wasm 相关错误，QQ邮箱会自动回退到WebSocket
                        return;
                    }
                    originalError.apply(console, args);
                };
            })();
        `);
        

    });
    
    webviewsContainer.appendChild(wv);

    // webview 加载完成后尝试更新标题
    wv.addEventListener('page-title-updated', (event) => {
        var title= event.title || title;
        const textEl = tabEl.querySelector('.tab-text');
        if (textEl) {
            textEl.textContent = title.substr(0,4)+'...';//显示标题前4个字符
        }
    });

    const syncAddress = (nextUrl) => {
        if (currentTabId === id) {
            updateAddressBar(nextUrl || safeGetURL(wv));
        }
    };
    wv.addEventListener('did-navigate', (event) => syncAddress(event.url));
    wv.addEventListener('did-navigate-in-page', (event) => syncAddress(event.url));
    wv.addEventListener('did-stop-loading', () => {
        syncAddress(safeGetURL(wv));
        updateNavButtons();
        
        // 记录历史（仅记录正常网站页面）
        const currentUrl = safeGetURL(wv);
        if (currentUrl && !currentUrl.includes('bookmarks.html') && !currentUrl.includes('history.html') && !currentUrl.startsWith('dxbrowser://')) {
            const pageTitle = safeGetTitle(wv) || currentUrl;
            recordHistory(pageTitle, currentUrl);
        }
        
        // 页面加载完成后，加载并恢复划线信息
        setTimeout(() => {
            const currentUrl = safeGetURL(wv);
            if (currentUrl) {
                // 通过IPC请求加载该URL的划线数据
                ipcRenderer.invoke('load-underline-data', currentUrl)
                .then(underlineData => {
                    if (underlineData && underlineData.length > 0) {
                        // 应用划线数据到页面
                        underlineData.forEach(underlineInfo => {
                            restoreUnderline(underlineInfo);
                        });
                    }
                })
                .catch(err => console.log('加载划线数据失败:', err));
            }
        }, 500); // 延迟0.5秒执行，确保页面内容已加载
    });

    return id;
}

async function activateTab(id) {
    currentTabId = id;

    // 切换 tab 样式
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', Number(tab.dataset.id) === id);
    });

    // 通知主进程激活对应的 BrowserView
    try {
        await ipcRenderer.invoke('activate-browser-view', id);
        
        // 获取当前标签页的URL并更新地址栏
        const url = await ipcRenderer.invoke('browser-view-get-url', id);
        updateAddressBar(url);
    } catch (error) {
        console.error('激活标签页失败:', error);
        // 如果IPC调用失败，尝试使用webview方式
        const activeWv = document.querySelector('webview[data-id="' + id + '"]');
        if (activeWv) {
            let url;
            try {
                url = typeof activeWv.getURL === 'function' ? activeWv.getURL() : activeWv.src;
            } catch (e) {
                url = activeWv.src;
            }
            updateAddressBar(url);
        }
    }
    
    updateNavButtons();
}

async function closeTab(id) {
    const tabEl = document.querySelector('.tab[data-id="' + id + '"]');
    const wv = document.querySelector('webview[data-id="' + id + '"]');
        
    // 保存加号按钮引用
    const addButton = document.getElementById('add-tab');
    if (addButton) {
        // 临时移除加号按钮
        addButton.remove();
    }

    // 通知主进程关闭对应的 BrowserView
    try {
        await ipcRenderer.invoke('close-browser-view', id);
        console.log('成功关闭BrowserView标签页:', id);
    } catch (error) {
        console.error('关闭BrowserView标签页失败:', error);
        // 如果IPC调用失败，仍然移除DOM元素
    }

    if (tabEl) tabEl.remove();
    if (wv) wv.remove();

    // 重新添加加号按钮到末尾
    if (addButton) {
        document.getElementById('tabs').appendChild(addButton);
    }
        
    // 如果关的是当前标签，自动激活一个相邻的
    if (currentTabId === id) {
        const remainingTabs = document.querySelectorAll('.tab');
        if (remainingTabs.length > 0) {
            const lastTab = remainingTabs[remainingTabs.length - 1];
            await activateTab(Number(lastTab.dataset.id));
        } else {
            currentTabId = null;
        }
    }
}

// "+" 按钮：新建标签
addTabBtn.addEventListener('click', () => {
    createTab();
});

backBtn.addEventListener('click', async () => {
    if (currentTabId == null) return;
    
    try {
        // 尝试使用 BrowserView 方式
        const success = await ipcRenderer.invoke('browser-view-go-back', currentTabId);
        if (!success) {
            // 如果 BrowserView 方式失败，回退到 webview 方式
            const wv = document.querySelector('webview[data-id="' + currentTabId + '"]');
            if (safeCanGoBack(wv)) {
                try { wv.goBack(); } catch (e) { /* ignore */ }
            }
        }
    } catch (error) {
        console.error('后退操作失败:', error);
        // 回退到 webview 方式
        const wv = document.querySelector('webview[data-id="' + currentTabId + '"]');
        if (safeCanGoBack(wv)) {
            try { wv.goBack(); } catch (e) { /* ignore */ }
        }
    }
});

forwardBtn.addEventListener('click', async () => {
    if (currentTabId == null) return;
    
    try {
        // 尝试使用 BrowserView 方式
        const success = await ipcRenderer.invoke('browser-view-go-forward', currentTabId);
        if (!success) {
            // 如果 BrowserView 方式失败，回退到 webview 方式
            const wv = document.querySelector('webview[data-id="' + currentTabId + '"]');
            if (safeCanGoForward(wv)) {
                try { wv.goForward(); } catch (e) { /* ignore */ }
            }
        }
    } catch (error) {
        console.error('前进操作失败:', error);
        // 回退到 webview 方式
        const wv = document.querySelector('webview[data-id="' + currentTabId + '"]');
        if (safeCanGoForward(wv)) {
            try { wv.goForward(); } catch (e) { /* ignore */ }
        }
    }
});

refreshBtn.addEventListener('click', async () => {
    if (currentTabId == null) return;
    
    try {
        // 尝试使用 BrowserView 方式
        const success = await ipcRenderer.invoke('browser-view-reload', currentTabId);
        if (!success) {
            // 如果 BrowserView 方式失败，回退到 webview 方式
            const wv = document.querySelector('webview[data-id="' + currentTabId + '"]');
            if (wv && typeof wv.reload === 'function') {
                wv.reload();
            }
        }
    } catch (error) {
        console.error('刷新操作失败:', error);
        // 回退到 webview 方式
        const wv = document.querySelector('webview[data-id="' + currentTabId + '"]');
        if (wv && typeof wv.reload === 'function') {
            wv.reload();
        }
    }
});

addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        loadAddressForCurrentTab();
    }
});

// 全局快捷键：F12 打开开发者工具
document.addEventListener('keydown', (e) => {
    if (e.key === 'F12' || e.keyCode === 123) {
        e.preventDefault();
        e.stopPropagation();
        const wv = currentTabId != null
            ? document.querySelector('webview[data-id="' + currentTabId + '"]')
            : null;
        if (wv) {
            // 通过 IPC 发送消息到主进程，让主进程打开开发者工具
            // 主进程会通过 web-contents-created 事件找到对应的 webContents
            ipcRenderer.send('open-devtools-for-webview', currentTabId);
        }
    }
});
goBtn.addEventListener('click', () => {
    loadAddressForCurrentTab();
});

// 主进程要求在新标签中打开链接
ipcRenderer.on('open-url-in-new-tab', (_event, url) => {
    console.log("主窗口收到打开URL请求:", url);
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        console.log("创建新标签页:", url);
        createTab(url, url);
    } else {
        console.log("URL格式不正确，已忽略:", url);
    }
});

// 主进程通知 BrowserView 状态更新（URL / 标题）
ipcRenderer.on('browser-view-updated', (_event, data) => {
    try {
        const tabId = Number(data.tabId);
        const url = data.url;
        const title = data.title;

        const tabEl = document.querySelector('.tab[data-id="' + tabId + '"]');
        if (tabEl && title) {
            const textEl = tabEl.querySelector('.tab-text');
            if (textEl) {
                // 保持与 webview 相同的展示策略（前4个字符 + ...）
                textEl.textContent = title.length > 4 ? title.substr(0, 4) + '...' : title;
            }
        }

        // 如果是当前活动标签，更新地址栏
        if (currentTabId === tabId && url) {
            updateAddressBar(url);
        }

        // 更新导航按钮状态（如果是当前标签）
        if (currentTabId === tabId) updateNavButtons();
    } catch (e) {
        console.error('处理 browser-view-updated 失败:', e);
    }
});

// 主进程要求打开书签管理器标签页
ipcRenderer.on('open-bookmarks-tab', () => {
    console.log("主窗口收到打开书签管理器请求");
    openBookmarksTab();
});

// 主进程要求打开指定标签页的开发者工具
ipcRenderer.on('open-devtools-for-tab', (_event, tabId) => {
    const wv = document.querySelector('webview[data-id="' + tabId + '"]');
    if (wv) {
        // 尝试打开开发者工具
        const tryOpenDevTools = () => {
            try {
                // 方法1: 直接调用 openDevTools（如果可用）
                if (typeof wv.openDevTools === 'function') {
                    wv.openDevTools();
                    return;
                }
                // 方法2: 通过 getWebContents
                if (wv.getWebContents) {
                    const webContents = wv.getWebContents();
                    if (webContents && typeof webContents.openDevTools === 'function') {
                        webContents.openDevTools();
                        return;
                    }
                }
            } catch (err) {
                console.error('打开开发者工具失败:', err);
            }
        };
        
        // 如果 webview 已附加，直接尝试
        tryOpenDevTools();
        
        // 如果失败，等待 webview 附加
        wv.addEventListener('did-attach', tryOpenDevTools, { once: true });
    }
});


// 搜索功能相关变量
let currentSearchTerm = '';
let searchResultsCount = 0;
let currentResultIndex = 0;

// 获取搜索面板相关元素
const searchPanel = document.getElementById('search-panel');
const searchInput = document.getElementById('search-input');
const searchPrevBtn = document.getElementById('search-prev');
const searchNextBtn = document.getElementById('search-next');
const searchCountDisplay = document.getElementById('search-count');
const searchCloseBtn = document.getElementById('search-close');

// 搜索面板控制函数
function showSearchPanel() {
    console.log('显示搜索面板');
    searchPanel.style.display = 'block';
    searchInput.focus();
    searchInput.select();
    // 重置搜索状态
    currentSearchTerm = '';
    searchResultsCount = 0;
    currentResultIndex = 0;
    updateSearchCountDisplay();
}

function hideSearchPanel() {
    searchPanel.style.display = 'none';
    clearSearchHighlight();
}

// 清除搜索高亮
function clearSearchHighlight() {
    const wv = getCurrentWebview();
    safeStopFind(wv, 'clearSelection');
    currentSearchTerm = '';
    searchResultsCount = 0;
    currentResultIndex = 0;
    updateSearchCountDisplay();
}

// 更新搜索计数显示
function updateSearchCountDisplay() {
    console.log('更新搜索计数显示:', currentResultIndex, '/', searchResultsCount);
    if (searchInput.value.trim()!='') {//searchResultsCount > 0
        searchCountDisplay.textContent = `${currentResultIndex}/${searchResultsCount}`;
        searchCountDisplay.style.opacity = '1';
        // 添加动画效果
        searchCountDisplay.style.transform = 'scale(1.05)';
        setTimeout(() => {
            searchCountDisplay.style.transform = 'scale(1)';
        }, 150);
    } else {
        searchCountDisplay.textContent = '';
        searchCountDisplay.style.opacity = '0.5';
    }
    
    // 更新导航按钮状态
    const prevBtn = document.getElementById('search-prev');
    const nextBtn = document.getElementById('search-next');
    if (prevBtn && nextBtn) {
        if (searchResultsCount <= 1) {
            prevBtn.disabled = true;
            nextBtn.disabled = true;
            prevBtn.style.cursor = 'not-allowed';
            nextBtn.style.cursor = 'not-allowed';
            prevBtn.style.opacity = '0.5';
            nextBtn.style.opacity = '0.5';
        } else {
            prevBtn.disabled = false;
            nextBtn.disabled = false;
            prevBtn.style.cursor = 'pointer';
            nextBtn.style.cursor = 'pointer';
            prevBtn.style.opacity = '1';
            nextBtn.style.opacity = '1';
        }
    }
}

// 获取当前活动的webview
function getCurrentWebview() {
    if (currentTabId == null) return null;
    return document.querySelector('webview[data-id="' + currentTabId + '"]');
}

// 执行搜索
function performSearch(forward = true) {
    const searchTerm = searchInput.value.trim();
    const wv = getCurrentWebview();
    
    if (!wv || !searchTerm) {
        if (!searchTerm) {
            clearSearchHighlight();
        }
        return;
    }
    
    // 如果搜索词改变，重新开始搜索
    if (searchTerm !== currentSearchTerm) {
        currentSearchTerm = searchTerm;
        safeStopFind(wv, 'clearSelection');
        
        // 开始新的搜索
        safeFindInPage(wv, searchTerm, {
            findNext: false,
            forward: true,
            matchCase: false,
            wordStart: false,
            medialCapitalAsWordStart: false
        });
    } else {
        // 继续搜索，根据方向前进或后退
        safeFindInPage(wv, searchTerm, {
            findNext: true,
            forward: forward,
            matchCase: false,
            wordStart: false,
            medialCapitalAsWordStart: false
        });
        console.log('继续搜索:', searchTerm, '方向:', forward ? '下一个' : '上一个');
    }
}

// 搜索事件监听器
searchInput.addEventListener('input', () => {
    if (searchInput.value.trim() === '') {
        clearSearchHighlight();
    } else {
        performSearch(true);
    }
});

searchInput.addEventListener('keyup', (e) => {
    // if (e.key === 'Enter') {
    //     performSearch(true);
    // }

    performSearch(true);
});

searchPrevBtn.addEventListener('click', () => {
    if (searchInput.value.trim() !== '') {
        performSearch(false); // 向前搜索
    }
});

searchNextBtn.addEventListener('click', () => {
    if (searchInput.value.trim() !== '') {
        performSearch(true); // 向后搜索
    }
});

searchCloseBtn.addEventListener('click', hideSearchPanel);

// 为新创建的webview添加事件监听器
function setupWebviewSearchListener(webview) {
    console.log('为webview添加搜索监听器:', webview.dataset.id);
    
    webview.addEventListener('found-in-page', (event) => {
        console.log('收到搜索结果事件:', event.result);
        if (event.result) {
            searchResultsCount = event.result.matches;
            console.log('总匹配数:', searchResultsCount);

            currentResultIndex = event.result.activeMatchOrdinal;
            console.log('当前匹配序号:', currentResultIndex);
            
            updateSearchCountDisplay();
        }
    });
    
    // 当webview导航时清除搜索高亮
    webview.addEventListener('did-navigate', () => {
        clearSearchHighlight();
    });
    
    // 页面开始加载时也清除搜索高亮
    webview.addEventListener('did-start-loading', () => {
        clearSearchHighlight();
    });
}

// 为所有现有webview添加搜索监听器
function initializeSearchListeners() {
    // 为所有现有的webview添加监听器
    document.querySelectorAll('webview').forEach(webview => {
        setupWebviewSearchListener(webview);
    });
}

// 修改createTab函数以添加搜索监听器
(function() {
    const originalCreateTab = window.createTab || createTab;
    
    // 重新定义createTab函数
    window.createTab = function(url = DEFAULT_URL, title = '新标签页') {
        console.log('创建标签页:', url, title);
        // 调用原始函数创建标签页
        const result = originalCreateTab.apply(this, arguments);
        
        // 获取最新创建的webview
        const wv = document.querySelector('webview[data-id="' + tabIdCounter + '"]');
        if (wv) {
            setupWebviewSearchListener(wv);
        }
        
        return result;
    };
})();

// 在页面加载完成后初始化搜索监听器
document.addEventListener('DOMContentLoaded', () => {
    // 延迟一点执行，确保webview已经创建
    setTimeout(initializeSearchListeners, 100);
});

// 键盘快捷键支持
document.addEventListener('keydown', (e) => {
    console.log('Key pressed:', e.key);
    // Ctrl+F 或 Cmd+F 打开搜索面板
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        showSearchPanel();
    }
    
    // ESC 关闭搜索面板
    if (e.key === 'Escape') {
        if (searchPanel.style.display === 'block') {
            e.preventDefault();
            hideSearchPanel();
        }
    }
    
    // F3 或 Shift+F3 在搜索结果间导航
    if (e.key === 'F3') {
        e.preventDefault();
        if (searchPanel.style.display === 'block' && searchInput.value.trim() !== '') {
            performSearch(!e.shiftKey); // F3向下，Shift+F3向上
        } else if (searchPanel.style.display !== 'block') {
            showSearchPanel();
        }
    }
});

// 监听主进程发送的全局快捷键消息
ipcRenderer.on('show-search-panel', () => {
    console.log('收到主进程消息: 打开搜索面板');
    showSearchPanel();
});

ipcRenderer.on('show-search-panel-with-text', (event, text) => {
    try {
        console.log('收到主进程消息: 打开搜索面板并填充文本', text);
        if (typeof text === 'string') {
            searchInput.value = text;
        } else {
            searchInput.value = '';
        }
        showSearchPanel();
        // 立即触发一次搜索
        performSearch(true);
    } catch (err) {
        console.error('处理 show-search-panel-with-text 失败:', err);
    }
});

ipcRenderer.on('new-tab', () => {
    console.log('收到主进程消息: 新建标签页');
    createTab();
});

ipcRenderer.on('refresh-tab', () => {
    console.log('收到主进程消息: 刷新标签页');
    if (currentTabId == null) return;
    const wv = document.querySelector('webview[data-id="' + currentTabId + '"]');
    if (wv) {
        wv.reload();
    }
});

ipcRenderer.on('force-refresh-tab', () => {
    console.log('收到主进程消息: 强制刷新标签页');
    if (currentTabId == null) return;
    const wv = document.querySelector('webview[data-id="' + currentTabId + '"]');
    if (wv) {
        wv.reloadIgnoringCache();
    }
});

ipcRenderer.on('open-history-tab', () => {
    console.log('收到主进程消息: 打开历史记录标签页');
    openHistoryTab();
});

ipcRenderer.on('open-underline-tab', () => {
    console.log('收到主进程消息: 打开划线记录标签页');
    openUnderlineTab();
});

// 启动时自动创建一个标签
createTab();