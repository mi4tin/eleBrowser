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

const body = document.querySelector('body');
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

    // 监听从主窗口发送的添加书签消息
    // ipcRenderer.on('add-bookmark-from-drag', (event, url) => {
    //     console.log('收到从主窗口拖动的URL:', url);
    //     addBookmarkFromDrag(url);
    // });
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

    // 拖拽事件监听
    setupDragEvents();
}

// 设置拖拽事件
function setupDragEvents() {
    //清理计数器，防止延迟前的拖拽事件
    body.addEventListener('dragover', (e) => {
        e.preventDefault();
        clearTimeout(lastDragTimeOut)//清理上次计时器
        // console.log('body.dragover')
    })

    // 侧边栏文件夹拖拽事件
    sidebar.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation(); //防止冒泡到父级事件上
        const treeItem = e.target.closest('.tree-item');
        if (treeItem) {

            // document.querySelectorAll('.tree-item').forEach(item => {
            //     item.style.backgroundColor = '';
            // });
            treeItem.style.backgroundColor = '#e8f4ff';


            const folderId = treeItem.dataset.id;
            if (folderId == lastDragFolderId) {
                // console.log("相同的文件夹")
                return
            }
            clearTimeout(lastDragTimeOut)//清理上次计时器
            lastDragFolderId = folderId
            const res = findFolderById(bookmarksTree, folderId);

            console.log("treeItem.dragover", folderId)
            lastDragTimeOut = setTimeout(() => {
                if (res && res.folder) {
                    if (lastDragFolderId != res.folder.id) {
                        console.log('文件夹已切换')
                        return
                    }
                    selectFolder(res.folder);
                    toggleFolder(folderId)
                    // addBookmarkToFolder(res.folder, url);
                }
            }, 1500)

        }

    });

    sidebar.addEventListener('dragleave', (e) => {
        const treeItem = e.target.closest('.tree-item');
        if (treeItem) {
            treeItem.style.backgroundColor = '';
        }
    });

    sidebar.addEventListener('drop', (e) => {
        return
    });

    function resetDrag(){
        lastDragFolderId = ''
        clearTimeout(lastDragTimeOut)//清理上次计时器
    }

    let lastDragFolderId = ''
    let lastDragTimeOut = 0;
    // 内容区域拖拽事件 - 合并文件夹导航和插入功能
    contentGrid.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // 移除所有之前的拖拽样式
        document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        // 获取所有卡片
        const allCards = Array.from(contentGrid.querySelectorAll('.folder-card, .bookmark-card'));
        if (allCards.length === 0) return;

        const mouseY = e.clientY;
        const zoneRatio = 1 / 6;
        
        // 检查是否在第一个卡片上方
        // const firstCard = allCards[0];
        // const firstCardRect = firstCard.getBoundingClientRect();
        // if (mouseY < firstCardRect.top) {
        //     firstCard.classList.add('drag-over-top');
        //     resetDrag()

        //     console.log("在第一个卡片上方")

        //     return;
        // }

        // 检查是否在两个卡片之间
        // for (let i = 0; i < allCards.length - 1; i++) {
        //     const currentCard = allCards[i];
        //     const nextCard = allCards[i + 1];
        //     const currentRect = currentCard.getBoundingClientRect();
        //     const nextRect = nextCard.getBoundingClientRect();
            
        //     const currentZone = currentRect.height * zoneRatio;
        //     const nextZone = nextRect.height * zoneRatio;
            
        //     // 在当前卡片下方1/6区域 且 在下一个卡片上方1/6区域
        //     if (mouseY > currentRect.bottom - currentZone && mouseY < nextRect.top + nextZone) {
        //         nextCard.classList.add('drag-over-top');
        //         console.log("两个卡片之间")
        //         return;
        //     }
        // }

        // 检查是否拖拽到了书签或文件夹卡片内部
        const card = e.target.closest('.folder-card, .bookmark-card');
        if (card) {
            // 显示插入位置的横线 - 只在上下1/6区域内显示
            const rect = card.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const zone = rect.height / 6;
            console.log("contentGrid.dragover", y, zone)

            // 处理文件夹导航
            if (card.classList.contains('folder-card')) {
                // 根据鼠标位置决定是在上方还是下方显示横线
                if (y < zone) {
                    clearTimeout(lastDragTimeOut)//清理上次计时器
                    lastDragFolderId = ''//重置
                    console.log("文件夹上")
                    card.classList.add('drag-over-top');
                } else if (y > rect.height - zone) {
                    clearTimeout(lastDragTimeOut)//清理上次计时器
                    lastDragFolderId = ''//重置
                    console.log("文件夹下")
                    card.classList.add('drag-over-bottom');
                } else {
                    card.style.backgroundColor = '#e8f4ff';

                    const folderId = card.dataset.id;
                    if (folderId == lastDragFolderId) {
                        console.log("相同的文件夹")
                    } else {
                        clearTimeout(lastDragTimeOut)//清理上次计时器
                        lastDragFolderId = folderId
                        const res = findFolderById(bookmarksTree, folderId);

                        console.log("folderCard.dragover", folderId)
                        lastDragTimeOut = setTimeout(() => {
                            if (res && res.folder) {
                                if (lastDragFolderId != res.folder.id) {
                                    console.log('文件夹已切换2')
                                    return
                                }
                                selectFolder(res.folder);
                                toggleFolder(folderId)
                                // addBookmarkToFolder(res.folder, url);
                            }
                        }, 1500)
                    }
                }
            } else {
                // 书签处理
                if (y < rect.height / 6) {
                    card.classList.add('drag-over-top');
                } else if (y > rect.height - zone) {
                    card.classList.add('drag-over-bottom');
                }
            }
        }
    });

    contentGrid.addEventListener('dragleave', (e) => {
        // 移除拖拽样式
        document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        // 移除文件夹的背景色
        const folderCard = e.target.closest('.folder-card');
        if (folderCard) {
            folderCard.style.backgroundColor = '';
        }
    });

    contentGrid.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const url = e.dataTransfer.getData('text/plain');
        if (!url) return;

        const mouseY = e.clientY;
        const allCards = Array.from(contentGrid.querySelectorAll('.folder-card, .bookmark-card'));
        const zoneRatio = 1 / 6;
        
        // 找到被拖拽到的卡片
        const card = e.target.closest('.folder-card, .bookmark-card');
        if (card) {
            console.log("contentGrid.drop", card)  
            // 确定插入位置
            const rect = card.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const zone = rect.height / 6;
            const isTop = y < zone;

            // 插入书签
            insertBookmarkAtPosition(url, card, isTop);
        } else {
            // 如果拖拽到空白区域，直接添加到当前文件夹
            addBookmarkToFolder(currentFolder, url);
        }

        clearDragStyles();
    });

    function clearDragStyles() {
        // 移除所有拖拽样式
        document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        // 移除文件夹的背景色
        document.querySelectorAll('.folder-card').forEach(card => {
            card.style.backgroundColor = '';
        });
    }
}

// 在指定位置插入书签
function insertBookmarkAtPosition(url, card, isTop) {
    // 从URL中提取标题
    let title = url;
    try {
        const urlObj = new URL(url);
        title = urlObj.hostname;
    } catch (e) {
        // URL解析失败，使用原始URL作为标题
    }

    const newBookmark = {
        title: title,
        url: url,
        favicon: '🔗'
    };

    // 确保当前文件夹有bookmarks数组
    currentFolder.bookmarks = currentFolder.bookmarks || [];

    // 获取contentGrid中所有子元素（文件夹卡片和书签卡片）
    const allCards = Array.from(contentGrid.children);
    const targetIndex = allCards.indexOf(card);

    if (targetIndex === -1) {
        // 如果找不到目标卡片，添加到末尾
        currentFolder.bookmarks.push(newBookmark);
    } else {
        // 计算在bookmarks数组中的插入位置
        // 需要统计目标卡片前面有多少个书签卡片
        let bookmarkInsertIndex = 0;
        const endIndex = isTop ? targetIndex : targetIndex + 1;

        for (let i = 0; i < endIndex; i++) {
            if (allCards[i].classList.contains('bookmark-card')) {
                bookmarkInsertIndex++;
            }
        }

        // 在计算出的位置插入新书签
        currentFolder.bookmarks.splice(bookmarkInsertIndex, 0, newBookmark);
    }

    // 重新渲染内容
    renderContent(currentFolder);
    // 保存书签
    saveBookmarks();

    showNotification('书签添加成功');
}

// 添加书签到指定文件夹
function addBookmarkToFolder(folder, url) {
    if (!url) return;

    let title = url;
    try {
        const urlObj = new URL(url);
        title = urlObj.hostname;
    } catch (e) {
        // URL解析失败，使用原始URL作为标题
    }

    folder.bookmarks = folder.bookmarks || [];
    folder.bookmarks.push({
        title: title,
        url: url,
        favicon: '🔗'
    });

    renderContent(currentFolder);
    saveBookmarks();

    showNotification('书签添加成功');
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

// 切换树形文件夹展开/折叠
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
    console.trace("selectFolder")
    console.log("selectFolder", folder)
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
    console.log('删除文件夹11:', res);
    if (!res || !res.parent) return;
    if (confirm('确定要删除该文件夹及其内容吗？')) {
        console.log('删除文件夹:', res.folder);
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
            callback: () => { }
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
    // if (confirm('确定要删除该书签吗？')) {
    removeFromFolder(bookmarksTree);
    renderContent(currentFolder);
    saveBookmarks();
    // }
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
            callback: () => { }
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
            callback: () => { }
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

// 从主窗口拖动添加书签
function addBookmarkFromDrag(url) {
    if (!url) return;

    // 从URL中提取标题
    let title = url;
    try {
        const urlObj = new URL(url);
        title = urlObj.hostname;
    } catch (e) {
        // URL解析失败，使用原始URL作为标题
    }

    // 添加到当前文件夹
    currentFolder.bookmarks = currentFolder.bookmarks || [];
    currentFolder.bookmarks.push({
        title: title,
        url: url,
        favicon: '🔗'
    });

    // 重新渲染内容
    renderContent(currentFolder);
    // 保存书签
    saveBookmarks();

    showNotification('书签添加成功');
}

// 显示通知
function showNotification(message) {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 10px 20px;
        border-radius: 4px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        z-index: 10000;
        transition: opacity 0.3s ease;
    `;
    document.body.appendChild(notification);

    // 3秒后自动消失
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

// 初始化
init();
