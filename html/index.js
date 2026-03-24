const { ipcRenderer } = require('electron');

const DEFAULT_URL ="https://www.baidu.com"// "file:///F:/DEV/Code/gitee.com/eleBrowser/html/bookmarks/bookmarks.html"//https://www.baidu.com"//'https://wx.mail.qq.com/';
const tabsContainer = document.getElementById('tabs');
const addTabBtn = document.getElementById('add-tab');
const addressInput = document.getElementById('address-input');
const goBtn = document.getElementById('address-go');
const backBtn = document.getElementById('nav-back');
const forwardBtn = document.getElementById('nav-forward');
const refreshBtn = document.getElementById('nav-refresh');


/** 应用URL映射，用于从应用URL到浏览器URL的映射 
 * 比如：
 * 'dxbrowser://bookmarks/': 'file://' + __dirname.replace(/\\/g, '/') + '/bookmarks/bookmarks.html',
 * 'dxbrowser://history/': 'file://' + __dirname.replace(/\\/g, '/') + '/history/history.html',
 * 'dxbrowser://underline/': 'file://' + __dirname.replace(/\\/g, '/') + '/underline/underline.html',
*/
var appUrlMap = {
};

const appUrlStart="dxbrowser://"//应用URL前缀协议，如：dxbrowser://bookmarks/


let currentTabId = null;
// 记录地址栏的上一个值，用于检测是输入还是删除
let addressInputPreviousValue = '';
// 各标签页加载状态，用于刷新按钮在「刷新/停止」间切换
let tabLoadingState = {};

/** 判断输入是否像要直接访问的地址（域名/URL），如是则回车应直接加载而非走自动补全 */
function looksLikeDirectUrl(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) return false;
    if (trimmed.startsWith(appUrlStart)) return true;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return true;
    // 无协议但包含点且无空格，视为域名（如 123.huahu.cool）
    if (/^[^/\s]+\./.test(trimmed) && !/\s/.test(trimmed)) return true;
    return false;
}

function formatUrl(input) {
    if (!input) return DEFAULT_URL;
    const trimmed = input.trim();
    // 检查是否是 dxbrowser:// 协议
    if (trimmed.startsWith(appUrlStart)) {
        return trimmed;
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return trimmed;
    return 'https://' + trimmed;
}

let lastUrl = '';//事件等更新到地址栏的最新地址，而非手动输入的
function updateAddressBar(url) {
    if (currentTabId == null) return;
    lastUrl=url||'';

    // console.log('updateAddressBar.url:', lastUrl,addressInput.value,appUrlMap,appUrlMap[lastUrl]);
    if (appUrlMap[lastUrl]) {
        lastUrl = appUrlMap[lastUrl];
        // console.log('updateAddressBar.appUrlMap:', lastUrl);
    }
    addressInput.value =lastUrl;
}

async function loadAddressForCurrentTab() {
    const inputValue = addressInput.value.trim();

    // 检查是否是 dxbrowser://bookmarks/ 协议
    if (inputValue === appUrlStart+'bookmarks/' || inputValue.startsWith(appUrlStart+'bookmarks')) {
        await openBookmarksTab();
        return;
    }

    // 检查是否是 dxbrowser://history/ 协议
    if (inputValue === appUrlStart+'history/' || inputValue.startsWith(appUrlStart+'history')) {
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
        const bookmarksUrl = 'file:///' + __dirname.replace(/\\/g, '/') + '/bookmarks/bookmarks.html';
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

        const appUrl = appUrlStart+'bookmarks/';
        appUrlMap[bookmarksUrl] = appUrl;

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
        console.log('createHistoryTab.dirname:', __dirname);
        const historyUrl = 'file:///' + __dirname.replace(/\\/g, '/') + '/history/history.html';
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


        appUrlMap[historyUrl] = appUrlStart+'history/';

        updateAddressBar(appUrlStart+'history/');
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
        const underlineUrl = 'file:///' + __dirname.replace(/\\/g, '/') + '/underline/underline.html';
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

        const appUrl = appUrlStart+'underline/';

        appUrlMap[underlineUrl] =appUrl;

        updateAddressBar(appUrl);
    } catch (error) {
        console.error('创建划线记录标签页失败:', error);
    }
}


// 关闭其他标签
async function closeOtherTabs(exceptTabId) {
    const allTabs = document.querySelectorAll('.tab');
    for (let i = 0; i < allTabs.length; i++) {
        const tab = allTabs[i];
        const tabId = Number(tab.dataset.id);

        if (tabId !== exceptTabId) {
            await closeTab(tabId);
        }
    }
}

// 关闭右侧标签
async function closeRightTabs(fromTabId) {
    const allTabs = document.querySelectorAll('.tab');
    let startIndex = -1;

    // 找到起始标签的索引
    for (let i = 0; i < allTabs.length; i++) {
        if (Number(allTabs[i].dataset.id) === fromTabId) {
            startIndex = i;
            break;
        }
    }

    if (startIndex === -1) return;

    // 关闭右侧的所有标签
    for (let i = allTabs.length - 1; i > startIndex; i--) {
        const tab = allTabs[i];
        const tabId = Number(tab.dataset.id);
        await closeTab(tabId);
    }
}

// 关闭左侧标签
async function closeLeftTabs(fromTabId) {
    const allTabs = document.querySelectorAll('.tab');
    let startIndex = -1;

    // 找到起始标签的索引
    for (let i = 0; i < allTabs.length; i++) {
        if (Number(allTabs[i].dataset.id) === fromTabId) {
            startIndex = i;
            break;
        }
    }

    if (startIndex === -1) return;

    // 关闭左侧的所有标签
    for (let i = 0; i < startIndex; i++) {
        const tab = allTabs[i];
        const tabId = Number(tab.dataset.id);
        await closeTab(tabId);
    }
}

// 关闭所有标签
async function closeAllTabs() {
    const allTabs = document.querySelectorAll('.tab');
    for (let i = allTabs.length - 1; i >= 0; i--) {
        const tab = allTabs[i];
        const tabId = Number(tab.dataset.id);
        await closeTab(tabId);
    }
}

// 记录浏览历史
function recordHistory(title, url) {
    console.log('记录历史:', title, url);
    // 避免记录内部协议页面
    if (url.startsWith(appUrlStart) || url.startsWith('file://')) {
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
    } else {
        console.error('当前没有活动标签页');
    }

    backBtn.disabled = !canGoBack;
    forwardBtn.disabled = !canGoForward;
    refreshBtn.disabled = currentTabId == null;
    updateRefreshButton();
}

function updateRefreshButton() {
    const loading = !!tabLoadingState[currentTabId];
    refreshBtn.textContent = loading ? '⏹' : '⟳';
    refreshBtn.title = loading ? '停止' : '刷新';
    refreshBtn.dataset.loading = loading ? 'true' : 'false';
}

async function createTab(url = DEFAULT_URL, title = '新标签页') {
    try {

        try {
            new URL(url);
        } catch (error) {
            console.log('不是url:' + url);
            url = "https://www.baidu.com/s?wd=" + encodeURIComponent(url);
        }

        // 调用主进程的 createBrowserView 方法
        const tabId = await ipcRenderer.invoke('create-browser-view', url);
        addressInput.value = url;
        console.log('创建BrowserView标签页成功，tabId:', tabId);

        // 创建 tab 按钮
        const tabEl = document.createElement('div');
        tabEl.className = 'tab';
        tabEl.dataset.id = tabId;

        // 创建标签favicon容器
        const faviconEl = document.createElement('span');
        faviconEl.className = 'tab-favicon';
        faviconEl.innerHTML = '<img src="" alt="" style="display:none;">'; // 初始化一个隐藏的img元素
        tabEl.appendChild(faviconEl);

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
    if (id === currentTabId) return;
    
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
        const loading = refreshBtn.dataset.loading === 'true';
        if (loading) {
            const success = await ipcRenderer.invoke('browser-view-stop-loading', currentTabId);
            if (!success) console.error('BrowserView 停止加载失败');
        } else {
            const success = await ipcRenderer.invoke('browser-view-reload', currentTabId);
            if (!success) console.error('BrowserView 刷新操作失败');
        }
    } catch (error) {
        console.error(refreshBtn.dataset.loading === 'true' ? '停止加载失败:' : '刷新操作失败:', error);
    }
});

addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        console.log("11keydown", e.key);
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

// 主进程通知当前标签页加载状态（用于刷新/停止按钮切换）
ipcRenderer.on('browser-view-loading-state', (_event, data) => {
    tabLoadingState[data.tabId] = data.loading;
    if (currentTabId === data.tabId) updateRefreshButton();
});

// 主进程通知 favicon 更新
ipcRenderer.on('browser-view-favicon-updated', async (_event, data) => {
    try {
        const tabId = Number(data.tabId);
        const faviconUrl = data.favicon;

        // 更新标签页的favicon
        const tabEl = document.querySelector('.tab[data-id="' + tabId + '"]');
        if (tabEl && faviconUrl) {
            const faviconImg = tabEl.querySelector('.tab-favicon img');
            if (faviconImg) {
                faviconImg.src = faviconUrl;
                faviconImg.style.display = 'block'; // 显示favicon图片
            }
        }

        // 如果是当前活动标签，则同时更新地址栏的favicon
        if (currentTabId === tabId && faviconUrl) {
            const addressFaviconImg = document.getElementById('address-favicon').querySelector('img');
            if (addressFaviconImg) {
                addressFaviconImg.src = faviconUrl;
                addressFaviconImg.style.display = 'block'; // 显示favicon图片
            }
        }
    } catch (e) {
        console.error('处理 browser-view-favicon-updated 失败:', e);
    }
});

// 主进程要求打开书签管理器标签页
ipcRenderer.on('open-bookmarks-tab', () => {
    console.log("主窗口收到打开书签管理器请求");
    openBookmarksTab();
});

// 修改createTab函数以添加搜索监听器
(function () {
    const originalCreateTab = window.createTab || createTab;

    // 重新定义createTab函数
    window.createTab = function (url = DEFAULT_URL, title = '新标签页') {
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

ipcRenderer.on('open-history-tab', () => {
    console.log('收到主进程消息: 打开历史记录标签页');
    openHistoryTab();
});

ipcRenderer.on('open-underline-tab', () => {
    console.log('收到主进程消息: 打开划线记录标签页');
    openUnderlineTab();
});

ipcRenderer.on('close-tab', (_event, tabid) => {
    console.log('收到主进程消息: 关闭标签页', tabid);
    closeTab(tabid);
});

ipcRenderer.on('close-other-tab', (_event, tabid) => {
    console.log('收到主进程消息: 关闭其它标签页', tabid);
    closeOtherTabs(tabid);
});

ipcRenderer.on('close-left-tab', (_event, tabid) => {
    console.log('收到主进程消息: 关闭左侧标签页', tabid);
    closeLeftTabs(tabid);
});

ipcRenderer.on('close-right-tab', (_event, tabid) => {
    console.log('收到主进程消息: 关闭右侧标签页', tabid);
    closeRightTabs(tabid);
});

//启时动时自动创建一个标签页
createTab();

// ===记录自动匹配功能 ===
// === 历史记录自动匹配功能（使用BrowserView方案） ===
let autocompleteSearchTimeout = null;
let addressInputBounds = null;

// 获取地址栏位置信息
function getAddressInputBounds() {
    const rect = addressInput.getBoundingClientRect();
    const bounds = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
    };
    console.log('地址栏位置:', bounds);
    return bounds;
}

//显示自动匹配结果
async function showAutocomplete(items) {
    if (!items || items.length === 0) {
        await hideAutocomplete();
        return;
    }

    try {
        addressInputBounds = getAddressInputBounds();
        const result = await ipcRenderer.invoke('show-history-autocomplete', items, addressInputBounds);
        if (!result.success) {
            console.error('显示历史记录自动匹配失败:', result.error);
        } else {
            console.log('成功发送显示请求，匹配项数:', items.length);
        }
    } catch (error) {
        console.error('显示历史记录自动匹配失败:', error);
    }
}

//隐藏自动匹配
async function hideAutocomplete() {
    try {
        const result = await ipcRenderer.invoke('hide-history-autocomplete');
        if (!result.success) {
            console.error('隐藏历史记录自动匹配失败:', result.error);
        } else {
            addressInputPreviousValue = ''//重置
            console.log('成功发送隐藏请求');
        }
    } catch (error) {
        console.error('隐藏历史记录自动匹配失败:', error);
    }
}

// 搜索历史记录
async function searchHistory(query) {
    if (!query || query.trim() === '') {
        await hideAutocomplete();
        return;
    }

    console.log('开始搜索历史记录，查询:', query);
    try {
        const results = await ipcRenderer.invoke('search-history', query.trim());
        console.log('搜索到结果数量:', results.length);
        await showAutocomplete(results);
    } catch (error) {
        console.error('搜索历史记录失败:', error);
        await hideAutocomplete();
    }
}

// 搜索函数
function throttledSearch(query) {
    if (autocompleteSearchTimeout) {
        clearTimeout(autocompleteSearchTimeout);
    }

    // console.log('设置搜索延时，查询:', query);

    autocompleteSearchTimeout = setTimeout(() => {
        searchHistory(query);
    }, 300); // 300ms延迟
}

//处理键盘导航
async function handleAutocompleteNavigation(key) {
    try {
        switch (key) {
            case 'ArrowDown':
                await ipcRenderer.invoke('history-autocomplete-keyboard', 'down');
                return true;
            case 'ArrowUp':
                await ipcRenderer.invoke('history-autocomplete-keyboard', 'up');
                return true;
            case 'Enter':
                await ipcRenderer.invoke('history-autocomplete-keyboard', 'enter');
                return true;
            case 'Escape':
                await ipcRenderer.invoke('history-autocomplete-keyboard', 'escape');
                return true;
        }
    } catch (error) {
        console.error('处理自动匹配导航失败:', error);
    }

    return false;
}

// === 事件监听器 ===

//地址栏输入事件
addressInput.addEventListener('input', (e) => {
    const query = e.target.value;

    // 记录上一个值
    // addressInputPreviousValue = query;

    // 如果是内部协议或特殊页面，不显示自动匹配
    if (query.startsWith(appUrlStart) || query.startsWith('file://')) {
        hideAutocomplete();
        return;
    }

    console.log('地址栏输入:', query);
    throttledSearch(query);
});

//地址栏键盘事件
addressInput.addEventListener('keydown', async (e) => {
    console.log("12keydown", e.key);
    // 回车时：若当前输入像直接访问的 URL/域名，则直接加载该地址，不交给自动补全（避免 123.huahu.cool 被补全成 123.baidu.com）
    if (e.key === 'Enter' && looksLikeDirectUrl(addressInput.value)) {
        e.preventDefault();
        e.stopPropagation();
        await hideAutocomplete();
        loadAddressForCurrentTab();
        return;
    }
    //处理自动匹配导航
    if (await handleAutocompleteNavigation(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    //普回车键处理
    if (e.key === 'Enter') {
        loadAddressForCurrentTab();
    }
});

//失时隐藏自动匹配
addressInput.addEventListener('blur', () => {
    console.log('地址栏失去焦点');
    setTimeout(async () => {
        //检查是否焦点转移到了自动匹配BrowserView
        const result = await ipcRenderer.invoke('check-autocomplete-focus');
        if (!result.hasFocus) {
            console.log('焦点未转移到自动匹配BrowserView，隐藏结果');
            hideAutocomplete();
        } else {
            console.log('焦点已转移到自动匹配BrowserView，保持显示');
        }
    }, 150);
});

//点击页面其他地方隐藏自动匹配
document.addEventListener('click', (e) => {
    if (!addressInput.contains(e.target)) {
        console.log('点击页面其他地方，隐藏自动匹配');
        hideAutocomplete();
    }
});

//接收历史记录自动匹配选择结果
ipcRenderer.on('history-autocomplete-selected', (event, selectedItem) => {
    console.log('接收到历史记录自动匹配选择:', selectedItem);
    addressInput.value = selectedItem.url;
    loadAddressForCurrentTab();
});

//接收历史记录自动匹配默认选中结果
ipcRenderer.on('history-autocomplete-selected-default', (event, selectedItem) => {
    console.log('接收到历史记录自动匹配默认选中:', selectedItem);
    const currentValue = addressInput.value;

    console.log('接收到默认选中当前输入值:', currentValue, '上一个输入值:', addressInputPreviousValue);

    // 检查是否是删除操作
    if (currentValue.length < addressInputPreviousValue.length) {
        console.log('检测到删除操作，不自动写入地址栏');
        addressInputPreviousValue = ''
        return;
    }

    if (currentValue) {

        try {
            const urlObj = new URL(selectedItem.url);
            const hostname = urlObj.hostname;

            console.log('接收到默认选中:', hostname.startsWith(currentValue), hostname, selectedItem.url);
            // 检查域名是否以用户输入开头
            if (hostname.startsWith(currentValue)||hostname.startsWith('www.'+currentValue)) {
                addressInputPreviousValue = selectedItem.url
                console.log("修改地址为：", addressInputPreviousValue)
                addressInput.value = selectedItem.url;
                // 找到选中地址与用户输入匹配的位置
                const currentIndex = selectedItem.url.indexOf(currentValue);
                console.log('接收到默认选中1:', currentIndex, currentValue);
                if (currentIndex !== -1) {
                    //选中从用户输入结束位置到selectedItem.url结束位置的部分
                    const selectionStart = currentIndex + currentValue.length;
                    const selectionEnd = selectedItem.url.length
                    addressInput.setSelectionRange(selectionStart, selectionEnd);
                    return;
                }
            } else {
                addressInputPreviousValue = currentValue;
            }
        } catch (e) {
            // URL解析失败，使用默认行为
            console.log('URL解析失败:', e);
        }

        // 默认行为：选中未输入的部分
        // addressInput.setSelectionRange(currentValue.length, selectedItem.url.length);
        // }
    } else {
        // 首次显示，直接显示第一个匹配项
        addressInput.value = selectedItem.url;
        // 将光标移动到输入框末尾
        addressInput.setSelectionRange(selectedItem.url.length, selectedItem.url.length);
    }
});

//接收历史记录自动匹配导航选择结果
ipcRenderer.on('history-autocomplete-navigated', (event, selectedItem) => {
    console.log('接收到历史记录自动匹配导航选择:', selectedItem);
    addressInput.value = selectedItem.url;

    console.log('自动匹配导航选择结果:', selectedItem.url);

    // 将光标移动到输入框末尾
    addressInput.setSelectionRange(selectedItem.url.length, selectedItem.url.length);
});


//窗resize事件监听器
window.addEventListener('resize', () => {
    const bounds = getAddressInputBounds();  // 获取新地址栏边界
    ipcRenderer.invoke('update-address-input-bounds', bounds);  // 更新到主进程
});

// 为地址栏添加拖动事件监听器
addressInput.addEventListener('dragstart', (e) => {
    const url = addressInput.value.trim();
    var dragStr = e.dataTransfer.getData('text/plain')
    // console.log("开始拖动", dragStr)
    //判断是否拖动的完整有效地址
    if (lastUrl == dragStr) {
        // e.dataTransfer.setData('text/plain', url);
        e.effectAllowed = 'copy';

        // 获取favicon和标题
        const addressFaviconImg = document.getElementById('address-favicon').querySelector('img');
        const faviconUrl = addressFaviconImg ? addressFaviconImg.src : '';
        const titleStr = document.querySelector('.tab[data-id="' + currentTabId + '"]').querySelector('.tab-text').textContent;

        // 只有当favicon存在且不为空时，说明页面已加载完成，才显示拖动效果
        if (faviconUrl && faviconUrl !== '') {
            // 创建一个临时元素用于拖动时的视觉效果
            const dragImage = document.createElement('div');
            dragImage.style.position = 'absolute';
            dragImage.style.left = '-9999px';
            dragImage.style.top = '-9999px';
            dragImage.style.padding = '8px';
            dragImage.style.borderRadius = '4px';
            dragImage.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
            dragImage.style.display = 'flex';
            dragImage.style.alignItems = 'center';
            dragImage.style.gap = '8px';

            // 添加favicon
            const favicon = document.createElement('img');
            favicon.src = faviconUrl;
            favicon.style.width = '16px';
            favicon.style.height = '16px';
            dragImage.appendChild(favicon);

            // 添加标题或URL
            const title = document.createElement('span');
            title.textContent = titleStr.length > 30 ? titleStr.substring(0, 30) + '...' : titleStr;
            title.style.fontSize = '12px';
            title.style.maxWidth = '200px';
            title.style.overflow = 'hidden';
            title.style.textOverflow = 'ellipsis';
            title.style.whiteSpace = 'nowrap';
            dragImage.appendChild(title);

            document.body.appendChild(dragImage);
            e.dataTransfer.setDragImage(dragImage, 10, 10);

            // 拖动结束后移除临时元素
            setTimeout(() => {
                if (dragImage.parentNode) {
                    dragImage.parentNode.removeChild(dragImage);
                }
            }, 0);
        }
    }
});

// 为标签栏添加放置事件监听器
tabsContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    
    // 检测是否拖动到了具体的标签上
    const targetTab = e.target.closest('.tab');
    if (targetTab) {
        // 激活该标签
        const tabId = Number(targetTab.dataset.id);
        activateTab(tabId);
    }
});

tabsContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    const url = e.dataTransfer.getData('text/plain');
    console.log(" 拖动结束:", url)

    if (url) {
        // 检查是否拖动到了书签管理标签
        const targetTab = e.target.closest('.tab');
        if (targetTab && targetTab.dataset.bookmarks === 'true') {
            // 发送消息给书签管理页面，添加书签
            // ipcRenderer.send('add-bookmark-from-drag', url);
        } else {
            // 否则创建新标签
            createTab(url, url);
        }
    }
});