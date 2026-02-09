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
            send: function(channel, data) {
                console.log('IPC send (模拟):', channel, data);
            },
            once: function(channel, listener) {
                if (channel === 'load-bookmarks-reply') {
                    setTimeout(() => listener(null, null), 0);
                } else {
                    setTimeout(() => listener(null), 0);
                }
            },
            invoke: function(channel, ...args) {
                console.log('IPC invoke (模拟):', channel, args);
                return Promise.resolve(null);
            },
            on: function(channel, listener) {
                console.log('IPC on (模拟):', channel);
                return () => {};
            }
        };
    }
}

// 书签数据结构 - 支持嵌套文件夹
// 默认书签数据
const defaultBookmarksTree = {
    id: 'root',
    name: '书签',
    type: 'folder',
    children: [
        {
            id: 'life',
            name: '生活',
            type: 'folder',
            children: [
                {
                    id: 'life-food',
                    name: '美食',
                    type: 'folder',
                    children: [],
                    bookmarks: []
                },
                {
                    id: 'life-shopping',
                    name: '购物',
                    type: 'folder',
                    children: [],
                    bookmarks: [
                        {
                            title: '淘宝',
                            url: 'https://www.taobao.com',
                            favicon: '🛒'
                        }
                    ]
                }
            ],
            bookmarks: []
        },
        {
            id: 'world-news',
            name: '世界消息',
            type: 'folder',
            children: [
                {
                    id: 'bloomberg',
                    name: '彭博社',
                    type: 'folder',
                    children: [],
                    bookmarks: [
                        {
                            title: '特朗普: 将于明年4月访华',
                            url: 'https://baijiahao.baidu.com/s?id=123456789',
                            favicon: '🔵'
                        },
                        {
                            title: '彭博社放风救市,地产股集体反弹!但底层数据藏着大信号...',
                            url: 'https://mp.weixin.qq.com/s/abcdefgh',
                            favicon: '🟢'
                        }
                    ]
                },
                {
                    id: 'reuters',
                    name: '路透社',
                    type: 'folder',
                    children: [],
                    bookmarks: []
                }
            ],
            bookmarks: []
        },
        {
            id: 'weather',
            name: '天气/气象',
            type: 'folder',
            children: [],
            bookmarks: [
                {
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
            children: [],
            bookmarks: []
        },
        {
            id: 'hygiene',
            name: '家庭卫生',
            type: 'folder',
            children: [],
            bookmarks: []
        }
    ],
    bookmarks: []
};

// 从本地文件加载书签数据
function loadBookmarks() {
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

// 保存书签数据到本地文件
function saveBookmarks() {
    console.log('保存书签数据:', bookmarksTree);
    ipcRenderer.send('save-bookmarks', bookmarksTree);
}

// 初始化书签数据
let bookmarksTree;

const sidebar = document.getElementById('sidebar');
const content = document.getElementById('content');
const contentTitle = document.getElementById('contentTitle');
const contentPath = document.getElementById('contentPath');
const contentGrid = document.getElementById('contentGrid');
const searchInput = document.getElementById('searchInput');
let contextMenuEl = null;

let currentFolder = bookmarksTree;
let expandedFolders = new Set(['root']); // 默认展开根目录

// 初始化
async function init() {
    // 异步加载书签数据
    bookmarksTree = await loadBookmarks();
    currentFolder = bookmarksTree;
    renderTree();
    renderContent(currentFolder);
    setupEventListeners();
}

// 设置事件监听
function setupEventListeners() {
    // 搜索功能
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (query) {
            searchBookmarks(query);
        } else {
            renderContent(currentFolder);
        }
    });
}

// 渲染树形结构
function renderTree() {
    sidebar.innerHTML = '';
    renderTreeItem(bookmarksTree, 0);
}

// 递归渲染树形项
function renderTreeItem(item, level) {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedFolders.has(item.id);
    
    const treeItem = document.createElement('div');
    treeItem.className = 'tree-item';
    if (currentFolder.id === item.id) {
        treeItem.classList.add('selected');
    }
    if (isExpanded && hasChildren) {
        treeItem.classList.add('expanded');
    }
    treeItem.dataset.id = item.id;

    const indent = level * 20;
    treeItem.innerHTML = `
        <div class="tree-item-content" style="padding-left: ${indent}px;">
            <span class="tree-toggle ${hasChildren ? (isExpanded ? 'expanded' : 'collapsed') : 'empty'}"></span>
            <span class="tree-icon">📁</span>
            <span class="tree-label">${escapeHtml(item.name)}</span>
        </div>
        ${hasChildren ? `<div class="tree-children"></div>` : ''}
    `;

    // 添加点击事件
    const contentEl = treeItem.querySelector('.tree-item-content');
    contentEl.addEventListener('click', (e) => {
        e.stopPropagation();
        selectFolder(item);
    });

    // 右键菜单：重命名、删除
    contentEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.id === 'root') return;
        showContextMenu(e.clientX, e.clientY, [
            { label: '重命名文件夹', action: () => renameFolder(item.id) },
            { label: '删除文件夹', action: () => deleteFolder(item.id) }
        ]);
    });

    // 添加展开/折叠事件
    const toggleEl = treeItem.querySelector('.tree-toggle');
    if (hasChildren) {
        toggleEl.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFolder(item.id);
        });
    }

    sidebar.appendChild(treeItem);

    // 递归渲染子项
    if (hasChildren && isExpanded) {
        const childrenContainer = treeItem.querySelector('.tree-children');
        item.children.forEach(child => {
            renderTreeItem(child, level + 1);
        });
    }
}

// 切换文件夹展开/折叠
function toggleFolder(folderId) {
    if (expandedFolders.has(folderId)) {
        expandedFolders.delete(folderId);
    } else {
        expandedFolders.add(folderId);
    }
    renderTree();
}

// 选择文件夹
function selectFolder(folder) {
    currentFolder = folder;
    renderTree();
    renderContent(folder);
}

// 渲染内容区域
function renderContent(folder) {
    contentTitle.textContent = folder.name;
    contentPath.textContent = getFolderPath(folder);
    
    contentGrid.innerHTML = '';
    
    const hasSubFolders = folder.children && folder.children.length > 0;
    const hasBookmarks = folder.bookmarks && folder.bookmarks.length > 0;

    if (!hasSubFolders && !hasBookmarks) {
        contentGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <div class="empty-state-icon">📂</div>
                <div>此文件夹为空</div>
            </div>
        `;
        return;
    }

    // 渲染子文件夹
    if (hasSubFolders) {
        folder.children.forEach(subFolder => {
            const folderCard = createFolderCard(subFolder);
            contentGrid.appendChild(folderCard);
        });
    }

    // 渲染书签
    if (hasBookmarks) {
        folder.bookmarks.forEach(bookmark => {
            const bookmarkCard = createBookmarkCard(bookmark);
            contentGrid.appendChild(bookmarkCard);
        });
    }
}

// 创建文件夹卡片
function createFolderCard(folder) {
    const card = document.createElement('div');
    card.className = 'folder-card';
    card.dataset.id = folder.id;
    
    const bookmarkCount = (folder.bookmarks && folder.bookmarks.length) || 0;
    const subFolderCount = (folder.children && folder.children.length) || 0;
    const totalCount = bookmarkCount + subFolderCount;

    card.innerHTML = `
        <div class="folder-card-icon">📁</div>
        <div class="folder-card-name">${escapeHtml(folder.name)}</div>
        <div class="folder-card-meta">${totalCount} 项</div>
    `;

    card.addEventListener('click', () => {
        selectFolder(folder);
    });

    // 右键菜单：重命名、删除
    card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, [
            {
                label: '重命名文件夹',
                action: () => renameFolder(folder.id)
            },
            {
                label: '删除文件夹',
                action: () => deleteFolder(folder.id)
            }
        ]);
    });

    return card;
}

// 创建书签卡片
function createBookmarkCard(bookmark) {
    const card = document.createElement('div');
    card.className = 'bookmark-card';
    
    card.innerHTML = `
        <div class="bookmark-favicon">${bookmark.favicon || '🔗'}</div>
        <div class="bookmark-info">
            <div class="bookmark-title">${escapeHtml(bookmark.title)}</div>
            <div class="bookmark-url">${escapeHtml(bookmark.url)}</div>
        </div>
        <div class="bookmark-menu">⋮</div>
    `;

    card.addEventListener('click', (e) => {
        if (e.target.classList.contains('bookmark-menu')) {
            e.stopPropagation();
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        
        let url = bookmark.url;
        if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        if (url) {
            ipcRenderer.send('open-bookmark', url);
        }
    });

    // 右键菜单：修改、删除
    card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, [
            {
                label: '修改书签',
                action: () => editBookmark(bookmark)
            },
            {
                label: '删除书签',
                action: () => deleteBookmark(bookmark)
            }
        ]);
    });

    return card;
}

// 获取文件夹路径
function getFolderPath(folder) {
    const path = [];
    let current = folder;
    
    // 向上查找路径
    function findPath(node, targetId) {
        if (node.id === targetId) {
            path.unshift(node.name);
            return true;
        }
        if (node.children) {
            for (const child of node.children) {
                if (findPath(child, targetId)) {
                    path.unshift(node.name);
                    return true;
                }
            }
        }
        return false;
    }
    
    findPath(bookmarksTree, folder.id);
    return '/' + path.join('/');
}

// 搜索书签
function searchBookmarks(query) {
    contentTitle.textContent = `搜索结果: "${query}"`;
    contentPath.textContent = '';
    contentGrid.innerHTML = '';
    
    const results = [];
    function searchInFolder(folder) {
        // 搜索书签
        if (folder.bookmarks) {
            folder.bookmarks.forEach(bookmark => {
                if (bookmark.title.toLowerCase().includes(query) || 
                    bookmark.url.toLowerCase().includes(query)) {
                    results.push(bookmark);
                }
            });
        }
        // 递归搜索子文件夹
        if (folder.children) {
            folder.children.forEach(child => {
                searchInFolder(child);
            });
        }
    }
    
    searchInFolder(bookmarksTree);
    
    if (results.length === 0) {
        contentGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <div class="empty-state-icon">🔍</div>
                <div>未找到匹配的书签</div>
            </div>
        `;
    } else {
        results.forEach(bookmark => {
            const card = createBookmarkCard(bookmark);
            contentGrid.appendChild(card);
        });
    }
}

// ---------- 右键菜单与数据操作 ---------- //
function showContextMenu(x, y, items) {
    hideContextMenu();
    contextMenuEl = document.createElement('div');
    Object.assign(contextMenuEl.style, {
        position: 'fixed',
        left: x + 'px',
        top: y + 'px',
        background: '#fff',
        border: '1px solid #ddd',
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        borderRadius: '6px',
        padding: '6px 0',
        zIndex: 10000,
        minWidth: '160px'
    });
    items.forEach(item => {
        const btn = document.createElement('div');
        btn.textContent = item.label;
        Object.assign(btn.style, {
            padding: '8px 14px',
            cursor: 'pointer',
            fontSize: '13px',
            color: '#333'
        });
        btn.addEventListener('click', () => {
            hideContextMenu();
            item.action && item.action();
        });
        btn.addEventListener('mouseover', () => btn.style.background = '#f5f7fa');
        btn.addEventListener('mouseout', () => btn.style.background = 'transparent');
        contextMenuEl.appendChild(btn);
    });
    document.body.appendChild(contextMenuEl);
    const onHide = () => {
        hideContextMenu();
        document.removeEventListener('click', onHide);
        document.removeEventListener('contextmenu', onHide);
    };
    document.addEventListener('click', onHide);
    document.addEventListener('contextmenu', onHide);
}

function hideContextMenu() {
    if (contextMenuEl) {
        contextMenuEl.remove();
        contextMenuEl = null;
    }
}

function findFolderById(folder, id, parent = null) {
    if (folder.id === id) return { folder, parent };
    if (folder.children) {
        for (const child of folder.children) {
            const res = findFolderById(child, id, folder);
            if (res) return res;
        }
    }
    return null;
}

function renameFolder(id) {
    const res = findFolderById(bookmarksTree, id);
    if (!res) return;
    const newName = prompt('请输入新的文件夹名称', res.folder.name);
    if (newName && newName.trim()) {
        res.folder.name = newName.trim();
        renderTree();
        renderContent(currentFolder.id === id ? res.folder : currentFolder);
        saveBookmarks();
    }
}

function deleteFolder(id) {
    if (id === 'root') return;
    const res = findFolderById(bookmarksTree, id);
    if (!res || !res.parent) return;
    if (confirm('确定要删除该文件夹及其内容吗？')) {
        res.parent.children = res.parent.children.filter(child => child.id !== id);
        if (currentFolder.id === id) {
            currentFolder = res.parent;
        }
        renderTree();
        renderContent(currentFolder);
        saveBookmarks();
    }
}

function editBookmark(bookmark) {
    const content = `
        <div class="form-group">
            <label class="form-label">名称</label>
            <input type="text" class="form-input" id="editBookmarkTitleInput" value="${escapeHtml(bookmark.title)}" autofocus>
        </div>
        <div class="form-group">
            <label class="form-label">网址</label>
            <input type="text" class="form-input" id="editBookmarkUrlInput" value="${escapeHtml(bookmark.url)}">
        </div>
    `;
    
    showModal('修改书签', content, [
        {
            text: '取消',
            type: 'secondary',
            callback: () => {}
        },
        {
            text: '保存',
            type: 'primary',
            callback: () => {
                const titleInput = document.getElementById('editBookmarkTitleInput');
                const urlInput = document.getElementById('editBookmarkUrlInput');
                const newTitle = titleInput ? titleInput.value.trim() : '';
                const newUrl = urlInput ? urlInput.value.trim() : '';
                if (!newTitle || !newUrl) return;
                bookmark.title = newTitle;
                bookmark.url = newUrl;
                renderContent(currentFolder);
                saveBookmarks();
            }
        }
    ]);
}

function deleteBookmark(targetBookmark) {
    function removeFromFolder(folder) {
        if (folder.bookmarks) {
            const before = folder.bookmarks.length;
            folder.bookmarks = folder.bookmarks.filter(b => b !== targetBookmark);
            if (before !== folder.bookmarks.length) return true;
        }
        if (folder.children) {
            for (const child of folder.children) {
                if (removeFromFolder(child)) return true;
            }
        }
        return false;
    }
    if (confirm('确定要删除该书签吗？')) {
        removeFromFolder(bookmarksTree);
        renderContent(currentFolder);
        saveBookmarks();
    }
}

// 右键空白区域（右侧任意非卡片区域）：添加文件夹/书签
content.addEventListener('contextmenu', (e) => {
    // 如果点到文件夹卡片、书签卡片或树节点，忽略
    if (e.target.closest('.folder-card') || e.target.closest('.bookmark-card') || e.target.closest('.tree-item')) return;
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
        { label: '添加文件夹', action: () => addFolder(currentFolder.id) },
        { label: '添加书签', action: () => addBookmark(currentFolder.id) }
    ]);
});

function addFolder(parentId) {
    const content = `
        <div class="form-group">
            <label class="form-label">名称</label>
            <input type="text" class="form-input" id="folderNameInput" placeholder="请输入文件夹名称" autofocus>
        </div>
    `;
    
    showModal('添加文件夹', content, [
        {
            text: '取消',
            type: 'secondary',
            callback: () => {}
        },
        {
            text: '保存',
            type: 'primary',
            callback: () => {
                const input = document.getElementById('folderNameInput');
                const name = input ? input.value.trim() : '';
                if (!name) return;
                const res = findFolderById(bookmarksTree, parentId);
                if (!res) return;
                const newId = parentId + '-' + Math.random().toString(36).slice(2, 8);
                res.folder.children = res.folder.children || [];
                res.folder.children.push({
                    id: newId,
                    name: name,
                    type: 'folder',
                    children: [],
                    bookmarks: []
                });
                expandedFolders.add(parentId);
                renderTree();
                renderContent(currentFolder);
                saveBookmarks();
            }
        }
    ]);
}

function addBookmark(parentId) {
    const content = `
        <div class="form-group">
            <label class="form-label">名称</label>
            <input type="text" class="form-input" id="bookmarkTitleInput" placeholder="请输入书签标题" autofocus>
        </div>
        <div class="form-group">
            <label class="form-label">网址</label>
            <input type="text" class="form-input" id="bookmarkUrlInput" placeholder="请输入书签链接">
        </div>
    `;
    
    showModal('添加书签', content, [
        {
            text: '取消',
            type: 'secondary',
            callback: () => {}
        },
        {
            text: '保存',
            type: 'primary',
            callback: () => {
                const titleInput = document.getElementById('bookmarkTitleInput');
                const urlInput = document.getElementById('bookmarkUrlInput');
                const title = titleInput ? titleInput.value.trim() : '';
                const url = urlInput ? urlInput.value.trim() : '';
                if (!title || !url) return;
                const res = findFolderById(bookmarksTree, parentId);
                if (!res) return;
                res.folder.bookmarks = res.folder.bookmarks || [];
                res.folder.bookmarks.push({
                    title: title,
                    url: url,
                    favicon: '🔗'
                });
                renderContent(currentFolder);
                saveBookmarks();
            }
        }
    ]);
}

// 辅助函数：通过ID查找文件夹
function findFolderById(folder, id, parent = null) {
    if (folder.id === id) return { folder, parent };
    if (folder.children) {
        for (const child of folder.children) {
            const res = findFolderById(child, id, folder);
            if (res) return res;
        }
    }
    return null;
}

// 重命名文件夹
function renameFolder(id) {
    const res = findFolderById(bookmarksTree, id);
    if (!res) return;
    const newName = prompt('请输入新的文件夹名称', res.folder.name);
    if (newName && newName.trim()) {
        res.folder.name = newName.trim();
        renderTree();
        renderContent(currentFolder.id === id ? res.folder : currentFolder);
    }
}

// 删除文件夹
function deleteFolder(id) {
    if (id === 'root') return;
    const res = findFolderById(bookmarksTree, id);
    if (!res || !res.parent) return;
    if (confirm('确定要删除该文件夹及其内容吗？')) {
        res.parent.children = res.parent.children.filter(child => child.id !== id);
        if (currentFolder.id === id) {
            currentFolder = res.parent;
        }
        renderTree();
        renderContent(currentFolder);
    }
}

// 转义 HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 弹窗DOM元素
let currentModal = null;
let currentModalCallback = null;

// 创建弹窗
function createModal(title, content, buttons) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    
    // 头部
    const header = document.createElement('div');
    header.className = 'modal-header';
    const h3 = document.createElement('h3');
    h3.className = 'modal-title';
    h3.textContent = title;
    header.appendChild(h3);
    
    // 内容
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.innerHTML = content;
    
    // 底部按钮
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    buttons.forEach(btn => {
        const button = document.createElement('button');
        button.className = `btn ${btn.type === 'primary' ? 'btn-primary' : 'btn-secondary'}`;
        button.textContent = btn.text;
        button.addEventListener('click', () => {
            btn.callback && btn.callback();
            closeModal();
        });
        footer.appendChild(button);
    });
    
    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    
    return overlay;
}

// 显示弹窗
function showModal(title, content, buttons) {
    hideContextMenu();
    closeModal();
    currentModal = createModal(title, content, buttons);
    document.body.appendChild(currentModal);
}

// 关闭弹窗
function closeModal() {
    if (currentModal) {
        currentModal.remove();
        currentModal = null;
    }
}

// 初始化
init();
