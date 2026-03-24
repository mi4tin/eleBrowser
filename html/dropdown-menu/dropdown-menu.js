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
                if (channel === 'show-folder-dropdown-reply') {
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

const folderDropdown = document.getElementById('folderDropdown');
const folderDropdownContent = document.getElementById('folderDropdownContent');

// HTML 转义函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 收集文件夹内的所有书签（递归）
function collectFolderBookmarks(folder, results = []) {
    if (!folder.items) return results;
    
    folder.items.forEach(item => {
        if (item.type === 'folder') {
            // 子文件夹也加入结果，并标记为文件夹
            results.push({
                ...item,
                itemType: 'folder',
                isSubFolder: true
            });
            // 递归收集子文件夹的书签
            collectFolderBookmarks(item, results);
        } else if (item.type === 'bookmark') {
            results.push({
                ...item,
                itemType: 'bookmark'
            });
        }
    });
    
    return results;
}

// 显示文件夹下拉菜单
function showFolderDropdown(folderId, folderName, folderBounds) {
    // 查找文件夹数据
    function findFolderById(folder, id) {
        if (folder.id === id) return folder;
        if (!folder.items) return null;
        
        for (const item of folder.items) {
            if (item.type === 'folder') {
                const found = findFolderById(item, id);
                if (found) return found;
            }
        }
        return null;
    }
    
    const targetFolder = findFolderById(bookmarksTreeData, folderId);
    if (!targetFolder) return;
    
    // 收集该文件夹下的所有内容（包括子文件夹和书签）
    const items = collectFolderBookmarks(targetFolder);
    
    if (items.length === 0) {
        // 空文件夹，不显示下拉菜单
        return;
    }
    
    // 清空并重新渲染下拉菜单内容
    folderDropdownContent.innerHTML = '';
    
    // 添加文件夹标题
    const titleEl = document.createElement('div');
    titleEl.className = 'folder-dropdown-item';
    titleEl.style.fontWeight = 'bold';
    titleEl.style.background = '#f5f7fa';
    titleEl.innerHTML = `
        <span class="icon folder-icon">📁</span>
        <span class="label">${escapeHtml(folderName)}</span>
    `;
    folderDropdownContent.appendChild(titleEl);
    
    // 添加分隔线
    const separator = document.createElement('div');
    separator.className = 'folder-dropdown-separator';
    folderDropdownContent.appendChild(separator);
    
    // 渲染每个项目
    items.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'folder-dropdown-item';
        
        if (item.itemType === 'folder') {
            // 子文件夹
            itemEl.innerHTML = `
                <span class="icon folder-icon">📁</span>
                <span class="label">${escapeHtml(item.name)}</span>
            `;
            
            // 点击子文件夹：打开书签管理页面并定位到该文件夹
            itemEl.addEventListener('click', () => {
                hideFolderDropdown();
                ipcRenderer.send('open-bookmarks-manager');
            });
        } else {
            // 书签
            itemEl.innerHTML = `
                <span class="icon">${item.favicon || '🔗'}</span>
                <span class="label">${escapeHtml(item.title)}</span>
            `;
            
            // 点击书签：直接打开网址
            itemEl.addEventListener('click', () => {
                hideFolderDropdown();
                let url = item.url;
                if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
                    url = 'https://' + url;
                }
                if (url) {
                    ipcRenderer.send('open-bookmark-url', url);
                }
            });
        }
        
        folderDropdownContent.appendChild(itemEl);
    });
    
    // 设置下拉菜单位置（从主页面接收的 bounds）
    folderDropdown.style.left = `${folderBounds.x}px`;
    folderDropdown.style.top = `${folderBounds.y}px`;
    
    // 显示下拉菜单
    folderDropdown.classList.add('show');
}

// 隐藏文件夹下拉菜单
function hideFolderDropdown() {
    folderDropdown.classList.remove('show');
}

// 书签数据（从主进程接收）
let bookmarksTreeData = null;

// 加载书签数据
function loadBookmarksData() {
    return new Promise((resolve) => {
        ipcRenderer.send('load-bookmarks');
        ipcRenderer.once('load-bookmarks-reply', (event, bookmarks) => {
            if (bookmarks) {
                resolve(bookmarks);
            } else {
                // 如果没有书签数据，使用默认值
                resolve(getDefaultBookmarks());
            }
        });
        
        // 超时处理
        setTimeout(() => {
            resolve(getDefaultBookmarks());
        }, 1000);
    });
}

// 默认书签数据
function getDefaultBookmarks() {
    return {
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
}

// 初始化书签数据
loadBookmarksData().then(data => {
    bookmarksTreeData = data;
    console.log('下拉菜单书签数据加载完成');
});

// 监听主页面的消息
ipcRenderer.on('show-folder-dropdown', async (event, folderId, folderName, folderBounds) => {
    console.log('收到显示文件夹下拉菜单请求:', folderId, folderName, folderBounds);
    
    // 确保书签数据已加载
    if (!bookmarksTreeData) {
        bookmarksTreeData = await loadBookmarksData();
    }
    
    showFolderDropdown(folderId, folderName, folderBounds);
});

ipcRenderer.on('hide-folder-dropdown', () => {
    hideFolderDropdown();
});

// 全局点击事件监听 - 点击其他地方关闭下拉菜单
document.addEventListener('click', (e) => {
    if (!folderDropdown.contains(e.target)) {
        hideFolderDropdown();
    }
});

// 窗口大小改变时关闭下拉菜单
window.addEventListener('resize', hideFolderDropdown);

console.log('下拉菜单页面初始化完成');
