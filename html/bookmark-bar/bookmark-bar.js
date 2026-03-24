// 安全地获取 electron API（优先使用 preload 暴露的 window.electronAPI）
let ipcRenderer;
if (typeof window !== 'undefined' && window.electronAPI) {
    ipcRenderer = window.electronAPI;
} else {
    try {
        const electron = require('electron');
        ipcRenderer = electron.ipcRenderer;
    } catch (e) {
        console.error('无法加载 electron 模块或未提供 preload:', e);
        ipcRenderer = {
            send: function (channel, data) {
                console.log('IPC send (模拟):', channel, data);
            },
            once: function (channel, listener) {
                if (channel === 'load-bookmarks-reply') {
                    setTimeout(() => listener(null, null), 0);
                } else {
                    setTimeout(() => listener(null), 0);
                }
            },
            invoke: function (channel, ...args) {
                console.log('IPC invoke (模拟):', channel, args);
                return Promise.resolve(null);
            },
            on: function (channel, listener) {
                console.log('IPC on (模拟):', channel);
                return () => { };
            }
        };
    }
}

// 默认书签数据
const defaultBookmarksTree = {
    id: 'root',
    name: '书签',
    type: 'folder',
    items: [
        {
            id: 'life',
            name: '生活',
            type: 'folder',
            items: [
                {
                    id: 'life-food',
                    name: '美食',
                    type: 'folder',
                    items: []
                },
                {
                    id: 'life-shopping',
                    name: '购物',
                    type: 'folder',
                    items: [
                        {
                            type: 'bookmark',
                            title: '淘宝',
                            url: 'https://www.taobao.com',
                            favicon: '🛒'
                        }
                    ]
                }
            ]
        },
        {
            id: 'world-news',
            name: '世界消息',
            type: 'folder',
            items: [
                {
                    id: 'bloomberg',
                    name: '彭博社',
                    type: 'folder',
                    items: [
                        {
                            type: 'bookmark',
                            title: '特朗普：将于明年 4 月访华',
                            url: 'https://baijiahao.baidu.com/s?id=123456789',
                            favicon: '🔵'
                        },
                        {
                            type: 'bookmark',
                            title: '彭博社放风救市，地产股集体反弹！但底层数据藏着大信号...',
                            url: 'https://mp.weixin.qq.com/s/abcdefgh',
                            favicon: '🟢'
                        }
                    ]
                },
                {
                    id: 'reuters',
                    name: '路透社',
                    type: 'folder',
                    items: []
                }
            ]
        },
        {
            id: 'weather',
            name: '天气/气象',
            type: 'folder',
            items: [
                {
                    type: 'bookmark',
                    title: '中国天气网',
                    url: 'https://www.weather.com.cn',
                    favicon: '☁️'
                }
            ]
        },
        {
            id: 'travel',
            name: '出行工具',
            type: 'folder',
            items: []
        },
        {
            id: 'hygiene',
            name: '家庭卫生',
            type: 'folder',
            items: []
        }
    ]
};

let bookmarksTreeData = null;
const bookmarkBarContent = document.getElementById('bookmarkBarContent');

// 加载书签数据
async function loadBookmarkBarData() {
    return new Promise((resolve) => {
        ipcRenderer.send('load-bookmarks');
        ipcRenderer.once('load-bookmarks-reply', (event, bookmarks) => {
            if (bookmarks) {
                resolve(bookmarks);
            } else {
                resolve(defaultBookmarksTree);
            }
        });
    });
}

// 收集所有书签和文件夹（扁平化展示）
function collectAllItems(folder, results = []) {
    if (!folder.items) return results;
    
    folder.items.forEach(item => {
        if (item.type === 'folder') {
            results.push({
                ...item,
                itemType: 'folder'
            });
            // 递归收集子文件夹
            collectAllItems(item, results);
        } else if (item.type === 'bookmark') {
            results.push({
                ...item,
                itemType: 'bookmark'
            });
        }
    });
    
    return results;
}

// 渲染书签栏
async function renderBookmarkBar() {
    if (!bookmarkBarContent) return;
    
    try {
        // 加载书签数据
        bookmarksTreeData = await loadBookmarkBarData();
        
        // 收集所有项目
        const allItems = collectAllItems(bookmarksTreeData);
        
        // 清空书签栏
        bookmarkBarContent.innerHTML = '';
        
        if (allItems.length === 0) {
            bookmarkBarContent.innerHTML = '<div style="color:#999;padding:10px;">暂无书签</div>';
            return;
        }
        
        // 渲染每个项目
        allItems.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.className = `bookmark-bar-item ${item.itemType === 'folder' ? 'folder-item' : 'bookmark-item'}`;
            
            if (item.itemType === 'folder') {
                itemEl.innerHTML = `
                    <div class="bookmark-bar-icon">📁</div>
                    <div class="bookmark-bar-label">${escapeHtml(item.name)}</div>
                `;
                
                // 点击文件夹：打开书签管理页面并定位到该文件夹
                itemEl.addEventListener('click', () => {
                    ipcRenderer.send('open-bookmarks-manager');
                });
            } else {
                itemEl.innerHTML = `
                    <div class="bookmark-bar-icon">${item.favicon || '🔗'}</div>
                    <div class="bookmark-bar-label">${escapeHtml(item.title)}</div>
                `;
                
                // 点击书签：直接打开网址
                itemEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    let url = item.url;
                    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
                        url = 'https://' + url;
                    }
                    if (url) {
                        ipcRenderer.send('open-bookmark-url', url);
                    }
                });
            }
            
            // 右键菜单
            itemEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // TODO: 显示右键菜单（编辑、删除等）
                console.log('右键菜单:', item);
            });
            
            bookmarkBarContent.appendChild(itemEl);
        });
        
    } catch (error) {
        console.error('渲染书签栏失败:', error);
    }
}

// HTML 转义函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 初始化书签栏
renderBookmarkBar();
