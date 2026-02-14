const { ipcRenderer } = require('electron');

const DEFAULT_URL = "https://www.baidu.com"//'https://wx.mail.qq.com/';
const tabsContainer = document.getElementById('tabs');
const addTabBtn = document.getElementById('add-tab');
const addressInput = document.getElementById('address-input');
const goBtn = document.getElementById('address-go');
const backBtn = document.getElementById('nav-back');
const forwardBtn = document.getElementById('nav-forward');
const refreshBtn = document.getElementById('nav-refresh');

let currentTabId = null;

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
            console.error('BrowserView 加载URL操作失败');
        }
    } catch (error) {
        console.error('加载URL失败:', error);
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
                // 第一次点击，立即激活标签
                activateTab(tabId);
                // 启动计时器，判断是否为双击
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 300); // 300ms 内没有第二次点击则重置计数
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
        
        updateAddressBar('dxbrowser://bookmarks/');
    } catch (error) {
        console.error('创建书签管理器标签页失败:', error);
        
    }
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
                // 第一次点击，立即激活标签
                activateTab(tabId);
                // 启动计时器，判断是否为双击
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 300); // 300ms 内没有第二次点击则重置计数
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
        
        updateAddressBar('dxbrowser://history/');
    } catch (error) {
        console.error('创建历史记录标签页失败:', error);
    }
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
                // 第一次点击，立即激活标签
                activateTab(tabId);
                // 启动计时器，判断是否为双击
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 300); // 300ms 内没有第二次点击则重置计数
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
        
        updateAddressBar('dxbrowser://underline/');
    } catch (error) {
        console.error('创建划线记录标签页失败:', error);
    }
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

async function updateNavButtons() {
    let canGoBack = false;
    let canGoForward = false;
    
    if (currentTabId != null) {
        // 使用BrowserView的导航状态
        try {
            canGoBack = await ipcRenderer.invoke('browser-view-can-go-back', currentTabId);
            canGoForward = await ipcRenderer.invoke('browser-view-can-go-forward', currentTabId);
        } catch (error) {
            console.error('获取BrowserView导航状态失败:', error);
        }
    }else{
        console.error('当前没有活动标签页');
    }
    
    backBtn.disabled = !canGoBack;
    forwardBtn.disabled = !canGoForward;
    refreshBtn.disabled = !wv && currentTabId == null;
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
                // 第一次点击，立即激活标签
                activateTab(tabId);
                // 启动计时器，判断是否为双击
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 300); // 300ms 内没有第二次点击则重置计数
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
        await updateNavButtons();
        
        return tabId;
    } catch (error) {
        console.error('创建标签页失败:', error);
    }
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
    }
    
    await updateNavButtons();
}

async function closeTab(id) {
    const tabEl = document.querySelector('.tab[data-id="' + id + '"]');
        
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
            console.error('BrowserView 后退操作失败');
        }
    } catch (error) {
        console.error('后退操作失败:', error);
    }
});

forwardBtn.addEventListener('click', async () => {
    if (currentTabId == null) return;
    
    try {
        // 尝试使用 BrowserView 方式
        const success = await ipcRenderer.invoke('browser-view-go-forward', currentTabId);
        if (!success) {
            console.error('BrowserView 前进操作失败');
        }
    } catch (error) {
        console.error('前进操作失败:', error);
    }
});

refreshBtn.addEventListener('click', async () => {
    if (currentTabId == null) return;
    
    try {
        // 尝试使用 BrowserView 方式
        const success = await ipcRenderer.invoke('browser-view-reload', currentTabId);
        if (!success) {
            console.error('BrowserView 刷新操作失败');
        }
    } catch (error) {
        console.error('刷新操作失败:', error);
    }
});

addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        loadAddressForCurrentTab();
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
ipcRenderer.on('browser-view-updated', async (_event, data) => {
    try {
        const tabId = Number(data.tabId);
        const url = data.url;
        const title = data.title;

        const tabEl = document.querySelector('.tab[data-id="' + tabId + '"]');
        if (tabEl && title) {
            const textEl = tabEl.querySelector('.tab-text');
            if (textEl) {
                // 展示前4个字符 + ...
                textEl.textContent = title.length > 4 ? title.substr(0, 4) + '...' : title;
            }
        }

        console.log("$$更新标签页:", tabId, title, url);

        // 如果是当前活动标签，更新地址栏
        if (currentTabId === tabId && url) {
            updateAddressBar(url);
        }

        if (url && title) {
            recordHistory(title, url);
        }

        // 更新导航按钮状态（如果是当前标签）
        if (currentTabId === tabId) await updateNavButtons();
    } catch (e) {
        console.error('处理 browser-view-updated 失败:', e);
    }
});

// 主进程要求打开书签管理器标签页
ipcRenderer.on('open-bookmarks-tab', () => {
    console.log("主窗口收到打开书签管理器请求");
    openBookmarksTab();
});

// 修改createTab函数以添加搜索监听器
(function() {
    const originalCreateTab = window.createTab || createTab;
    
    // 重新定义createTab函数
    window.createTab = function(url = DEFAULT_URL, title = '新标签页') {
        console.log('创建标签页:', url, title);
        // 调用原始函数创建标签页
        const result = originalCreateTab.apply(this, arguments);
        
        return result;
    };
})();

ipcRenderer.on('new-tab', () => {
    console.log('收到主进程消息: 新建标签页');
    createTab();
});

ipcRenderer.on('refresh-tab', async () => {
    console.log('收到主进程消息: 刷新标签页');
    if (currentTabId == null) return;
    
    try {
        // 优先尝试使用 BrowserView 方式刷新
        const success = await ipcRenderer.invoke('browser-view-reload', currentTabId);
        if (!success) {
            console.error('BrowserView 刷新操作失败');
        }
    } catch (error) {
        console.error('刷新标签页失败:', error);
    }
});

ipcRenderer.on('force-refresh-tab', async () => {
    console.log('收到主进程消息: 强制刷新标签页');
    if (currentTabId == null) return;
    
    try {
        // 优先尝试使用 BrowserView 方式强制刷新
        const success = await ipcRenderer.invoke('browser-view-reload-ignoring-cache', currentTabId);
        if (!success) {
            console.error('BrowserView 强制刷新操作失败');
        }
    } catch (error) {
        console.error('强制刷新标签页失败:', error);
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