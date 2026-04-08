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
                            title: '特朗普: 将于明年4月访华',
                            url: 'https://baijiahao.baidu.com/s?id=123456789',
                            favicon: '🔵'
                        },
                        {
                            type: 'bookmark',
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

    // 监听书签保存事件，刷新显示
    ipcRenderer.on('bookmarks-saved', async () => {
        console.log('收到书签保存通知，刷新显示');
        bookmarksTree = await loadBookmarks();
        // 保持当前选中的文件夹，如果不存在则回到根目录
        const currentFolderCheck = findFolderById(bookmarksTree, currentFolder.id);
        if (currentFolderCheck) {
            currentFolder = currentFolderCheck.folder;
        } else {
            currentFolder = bookmarksTree;
        }
        renderTree();
        renderContent(currentFolder);
    });

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
                    console.log('文件夹已切换.1')
                    // return
                    selectFolder(res.folder);
                    toggleFolder(folderId, true)
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
                    card.style.backgroundColor = ''
                    clearTimeout(lastDragTimeOut)//清理上次计时器
                    lastDragFolderId = ''//重置
                    console.log("文件夹上")
                    card.classList.add('drag-over-top');
                    console.log("文件夹上",card)
                } else if (y > rect.height - zone) {
                    card.style.backgroundColor = ''
                    clearTimeout(lastDragTimeOut)//清理上次计时器
                    lastDragFolderId = ''//重置
                    console.log("文件夹下")
                    card.classList.add('drag-over-bottom');
                    console.log("文件夹下",card)
                } else {
                    card.style.backgroundColor ='#e8f4ff';
                    console.log("文件夹中间",card)

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

    content.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        

        // 检查是否是内部拖拽（支持多种数据格式）
        let internalData = e.dataTransfer.getData('application/x-bookmark-item');
        let data = null;
        let isBookmarkBarItem = false;
        
        // 如果没有找到，尝试书签栏格式
        if (!internalData) {
            internalData = e.dataTransfer.getData('application/x-bookmark-bar-item');
            isBookmarkBarItem = true;
        }
        
        console.log("contentGrid.drop.internalData", internalData, isBookmarkBarItem);
        console.log("contentGrid.drop.internalData1", e.dataTransfer.types);
        
        if (internalData) {
            try {
                data = JSON.parse(internalData);
                
                // 处理书签栏项目
                if (isBookmarkBarItem) {
                    // 构建标准的内部数据格式
                    const bookmarkBarData = data;
                    data = {
                        type: 'internal',
                        itemType: bookmarkBarData.itemType,
                        id: bookmarkBarData.id,
                        sourceFolderId: 'root' // 书签栏项目默认在根目录
                    };
                }
                
                if (data.type === 'internal' || isBookmarkBarItem) {
                    // 找到被拖拽到的卡片
                    const card = e.target.closest('.folder-card, .bookmark-card');
                    if (card) {
                        // 确定插入位置
                        const rect = card.getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        const zone = rect.height / 6;
                        const isTop = y < zone;

                        // 移动项目到新位置
                        moveItemToPosition(data, card, isTop, e);
                        console.log("拖拽到文件夹",data,card,isTop);
                    } else {
                        console.log("拖拽到空白区域.1");
                        // 拖拽到空白区域，移动项目到当前文件夹
                        // 找到源文件夹
                        const sourceFolderId = data.sourceFolderId || 'root';
                        const sourceRes = findFolderById(bookmarksTree, sourceFolderId);
                        if (sourceRes) {
                            const sourceItems = sourceRes.folder.items || [];
                            
                            // 找到被拖拽的项目在源文件夹中的索引
                            let sourceIndex = -1;
                            if (data.itemType === 'folder') {
                                sourceIndex = sourceItems.findIndex(item => item.type === 'folder' && item.id === data.id);
                            } else if (data.itemType === 'bookmark') {
                                sourceIndex = sourceItems.findIndex(item => item.type === 'bookmark' && (item.id === data.id || item.url === data.id));
                            }

                            if (sourceIndex !== -1) {

                                // 检查是否是拖到自己身上或自己的子文件夹中,currentFolder相当于目标文件夹
                                const isSelfDrag = data.id === currentFolder.id;
                                const isChildDrag = isDescendantFolder(sourceItems[sourceIndex],currentFolder.id);
                                
                                console.log("isSelfDrag.3", isSelfDrag, "isChildDrag", isChildDrag,data,currentFolder)
                                if (isSelfDrag || isChildDrag) {
                                    showNotification('不能将文件夹拖到自身或其子文件夹中');
                                    return;
                                }

                                // 从源位置移除项目
                                const [movedItem] = sourceItems.splice(sourceIndex, 1);
                                
                                // 添加到当前文件夹
                                if (!currentFolder.items) {
                                    currentFolder.items = [];
                                }
                                currentFolder.items.push(movedItem);
                                
                                // 重新渲染内容
                                renderContent(currentFolder);
                                // 如果源文件夹和当前文件夹不同，需要重新渲染树形结构
                                if (sourceRes.folder.id !== currentFolder.id) {
                                    renderTree();
                                }
                                // 保存书签
                                saveBookmarks();
                                showNotification('已移动到当前文件夹');
                            }
                        }
                    }
                    clearDragStyles();
                    return;
                }
            } catch (err) {
                console.error('解析内部拖拽数据失败.1:', err);
            }
        }

        // 外部链接拖拽
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
}

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
        type: 'bookmark',
        title: title,
        url: url,
        favicon: '🔗'
    };

    // 确保当前文件夹有items数组
    currentFolder.items = currentFolder.items || [];

    // 获取contentGrid中所有子元素（文件夹卡片和书签卡片）
    const allCards = Array.from(contentGrid.children);
    const targetIndex = allCards.indexOf(card);

    if (targetIndex === -1) {
        // 如果找不到目标卡片，添加到末尾
        currentFolder.items.push(newBookmark);
    } else {
        // 直接在目标位置插入
        const insertIndex = isTop ? targetIndex : targetIndex + 1;
        currentFolder.items.splice(insertIndex, 0, newBookmark);
    }

    // 重新渲染内容
    renderContent(currentFolder);
    // 保存书签
    saveBookmarks();

    showNotification('书签添加成功');
}

// 移动项目到新位置（内部拖拽排序或跨文件夹移动）
function moveItemToPosition(data, card, isTop, e) {
    const allCards = Array.from(contentGrid.children);
    const targetIndex = allCards.indexOf(card);

    if (targetIndex === -1) return;

    // 找到源文件夹
    const sourceFolderId = data.sourceFolderId || 'root';
    const sourceRes = findFolderById(bookmarksTree, sourceFolderId);
    if (!sourceRes) return;

    const sourceItems = sourceRes.folder.items || [];
    
    // 找到被拖拽的项目在源文件夹中的索引
    let sourceIndex = -1;
    if (data.itemType === 'folder') {
        sourceIndex = sourceItems.findIndex(item => item.type === 'folder' && item.id === data.id);
    } else if (data.itemType === 'bookmark') {
        sourceIndex = sourceItems.findIndex(item => item.type === 'bookmark' && (item.id === data.id || item.url === data.id));
    }

    console.log("contentGrid.drop", data, card, sourceIndex, targetIndex);

    if (sourceIndex === -1) return;

    // 检查是否是拖到自己身上或自己的子文件夹中
    const targetCardType = card.dataset.type;
    const targetFolderId = targetCardType === 'folder' ? card.dataset.id : null;
    
    const isSelfDrag = data.itemType === 'folder' && targetFolderId === data.id;
    let isChildDrag = false;
    
    if (data.itemType === 'folder' && targetFolderId) {
        const targetFolderRes = findFolderById(bookmarksTree, targetFolderId);
        if (targetFolderRes) {
            isChildDrag = isDescendantFolder(data.id,targetFolderRes.folder);
        }
    }
    
    if (isSelfDrag || isChildDrag) {
        console.log("isSelfDrag.2", isSelfDrag, "isChildDrag", isChildDrag)
        showNotification('不能将文件夹拖到自身或其子文件夹中');
        return;
    }

    // 从源位置移除项目
    const [movedItem] = sourceItems.splice(sourceIndex, 1);

    // 检查目标卡片是否是文件夹
    targetCardType = card.dataset.type;
    if (targetCardType === 'folder') {
        // 检查是拖到文件夹的哪个位置
        const rect = card.getBoundingClientRect();
        const y = e ? e.clientY - rect.top : 0;
        const zone = rect.height / 6;
        
        if (y < zone || y > rect.height - zone) {
            // 拖到文件夹上方或下方，在当前文件夹内插入
            const targetItems = currentFolder.items || [];
            let targetInsertIndex = isTop ? targetIndex : targetIndex + 1;
            
            // 如果是同一文件夹内的拖拽，需要调整索引（因为已经从原位置移除了）
            if (sourceRes.folder.id === currentFolder.id && sourceIndex < targetInsertIndex) {
                targetInsertIndex--;
            }

            // 插入到目标位置
            targetItems.splice(targetInsertIndex, 0, movedItem);

            // 重新渲染内容
            renderContent(currentFolder);
        } else {
            // 拖到文件夹中间，将项目移动到该文件夹内
            const targetFolderId = card.dataset.id;
            const targetFolderRes = findFolderById(bookmarksTree, targetFolderId);
            if (targetFolderRes) {
                const targetFolder = targetFolderRes.folder;
                if (!targetFolder.items) {
                    targetFolder.items = [];
                }
                targetFolder.items.push(movedItem);
                
                // 重新渲染内容（如果当前显示的是目标文件夹，就渲染它）
                if (currentFolder.id === targetFolderId) {
                    renderContent(targetFolder);
                } else {
                    renderContent(currentFolder);
                }
            }
        }
    } else {
        // 拖到了书签上，在当前文件夹内排序
        
        // 计算目标文件夹的插入索引
        const targetItems = currentFolder.items || [];
        let targetInsertIndex = isTop ? targetIndex : targetIndex + 1;
        
        // 如果是同一文件夹内的拖拽，需要调整索引（因为已经从原位置移除了）
        if (sourceRes.folder.id === currentFolder.id && sourceIndex < targetInsertIndex) {
            targetInsertIndex--;
        }

        // 插入到目标位置
        targetItems.splice(targetInsertIndex, 0, movedItem);

        // 重新渲染内容
        renderContent(currentFolder);
    }
    
    // 如果源文件夹和目标文件夹不同，需要重新渲染树形结构
    if (sourceRes.folder.id !== (targetCardType === 'folder' ? card.dataset.id : currentFolder.id)) {
        renderTree();
    }
    // 保存书签
    saveBookmarks();

    showNotification('位置已调整');
}

// 添加书签到指定文件夹
function addBookmarkToFolder(folder, url) {
    if (!url) return;

    let title = url;
    try {
        const urlObj = new URL(url);
        title = urlObj.hostname;
    } catch (e) {
        // URL 解析失败，使用原始 URL 作为标题
    }

    folder.items = folder.items || [];
    folder.items.push({
        type: 'bookmark',
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
    // 只显示文件夹在树形结构中
    const childFolders = item.items ? item.items.filter(child => child.type === 'folder') : [];
    const hasChildren = childFolders.length > 0;
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
        <div class="tree-item-content" style="margin-left: ${indent}px;">
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

    // 使文件夹可拖动
    treeItem.draggable = true;
    
    // 拖拽开始事件
    treeItem.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        e.dataTransfer.setData('application/x-bookmark-item', JSON.stringify({
            type: 'internal',
            itemType: 'folder',
            id: item.id,
            sourceFolderId: findParentFolderId(bookmarksTree, item.id)
        }));
        e.dataTransfer.effectAllowed = 'move';
        treeItem.classList.add('dragging');
    });
    
    // 拖拽结束事件
    treeItem.addEventListener('dragend', (e) => {
        e.stopPropagation();
        treeItem.classList.remove('dragging');
    });

    // 拖拽事件：允许拖入文件夹
    contentEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        contentEl.classList.add('drag-over');
    });

    contentEl.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        contentEl.classList.remove('drag-over');
    });

    contentEl.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        contentEl.classList.remove('drag-over');

        // 检查是否是内部拖拽（支持多种数据格式）
        let internalData = e.dataTransfer.getData('application/x-bookmark-item');
        let data = null;
        let isBookmarkBarItem = false;
        
        // 如果没有找到，尝试书签栏格式
        if (!internalData) {
            internalData = e.dataTransfer.getData('application/x-bookmark-bar-item');
            isBookmarkBarItem = true;
        }

        if (internalData) {
            try {
                data = JSON.parse(internalData);
                
                // 处理书签栏项目
                if (isBookmarkBarItem) {
                    // 构建标准的内部数据格式
                    const bookmarkBarData = data;
                    data = {
                        type: 'internal',
                        itemType: bookmarkBarData.itemType,
                        id: bookmarkBarData.id,
                        sourceFolderId: 'root' // 书签栏项目默认在根目录
                    };
                }
                
                if (data.type === 'internal' || isBookmarkBarItem) {
                    // 找到源文件夹
                    const sourceFolderId = data.sourceFolderId || 'root';
                    const sourceRes = findFolderById(bookmarksTree, sourceFolderId);
                    if (!sourceRes) return;

                    const sourceItems = sourceRes.folder.items || [];
                    
                    // 找到被拖拽的项目在源文件夹中的索引
                    let sourceIndex = -1;
                    if (data.itemType === 'folder') {
                        sourceIndex = sourceItems.findIndex(item => item.type === 'folder' && item.id === data.id);
                    } else if (data.itemType === 'bookmark') {
                        sourceIndex = sourceItems.findIndex(item => item.type === 'bookmark' && (item.id === data.id || item.url === data.id));
                    }

                    console.log("contentGrid.drop.1", data,sourceItems[sourceIndex], sourceIndex);
                    if (sourceIndex !== -1) {
                        // 检查是否是拖到自己身上或自己的子文件夹中,item是目标文件夹
                        const isSelfDrag = data.id === item.id;
                        const isChildDrag = isDescendantFolder(sourceItems[sourceIndex],item.id);
                        
                        console.log("isSelfDrag.1", isSelfDrag, "isChildDrag", isChildDrag,data,item)
                        if (isSelfDrag || isChildDrag) {
                            showNotification('不能将文件夹拖到自身或其子文件夹中');
                            return;
                        }
                        
                        // 从源位置移除项目
                        const [movedItem] = sourceItems.splice(sourceIndex, 1);

                        // 检查拖拽位置，决定是移到文件夹内还是插入到文件夹上下方
                        const rect = contentEl.getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        const zone = rect.height / 6;

                        if (y < zone || y > rect.height - zone) {
                            // 拖到文件夹上方或下方，插入到父文件夹中
                            const folderRes = findFolderById(bookmarksTree, item.id);
                            if (folderRes && folderRes.parent) {
                                const parentFolder = folderRes.parent;
                                const parentItems = parentFolder.items || [];
                                const targetIndex = parentItems.findIndex(child => child.id === item.id);
                                
                                if (targetIndex !== -1) {
                                    // 计算插入位置
                                    const insertIndex = y < zone ? targetIndex : targetIndex + 1;
                                    parentItems.splice(insertIndex, 0, movedItem);
                                }
                            }
                        } else {
                            // 拖到文件夹中间，添加到目标文件夹
                            if (!item.items) {
                                item.items = [];
                            }
                            item.items.push(movedItem);
                        }

                        // 重新渲染树形结构和内容
                        renderTree();
                        renderContent(currentFolder);
                        
                        // 保存书签
                        saveBookmarks();
                        showNotification('已移动到文件夹');
                    }
                }
            } catch (err) {
                console.error('解析内部拖拽数据失败.2:', err);
            }
        }
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
        childFolders.forEach(child => {
            renderTreeItem(child, level + 1);
        });
    }
}

// 切换树形文件夹展开/折叠
// onlyOpen: 是否只展开, 默认自行判断是否展开
function toggleFolder(folderId, onlyOpen=false) {
    if (expandedFolders.has(folderId)) {
        if (onlyOpen) {
            return
        }
        expandedFolders.delete(folderId);
        console.log('文件夹已折叠')
    } else {
        expandedFolders.add(folderId);
        console.log('文件夹已展开')
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

    const hasItems = folder.items && folder.items.length > 0;

    if (!hasItems) {
        contentGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1;">
                <div class="empty-state-icon">📂</div>
                <div>此文件夹为空</div>
            </div>
        `;
        return;
    }

    // 渲染所有项目（文件夹和书签）
    folder.items.forEach(item => {
        if (item.type === 'folder') {
            const folderCard = createFolderCard(item);
            contentGrid.appendChild(folderCard);
        } else if (item.type === 'bookmark') {
            const bookmarkCard = createBookmarkCard(item);
            contentGrid.appendChild(bookmarkCard);
        }
    });
}

// 创建文件夹卡片
function createFolderCard(folder) {
    const card = document.createElement('div');
    card.className = 'folder-card';
    card.dataset.id = folder.id;
    card.dataset.type = 'folder';
    card.draggable = true;

    // 计算文件夹中的项目数量
    const items = folder.items || [];
    const totalCount = items.length;

    card.innerHTML = `
        <div class="folder-card-icon">📁</div>
        <div class="folder-card-name">${escapeHtml(folder.name)}</div>
        <div class="folder-card-meta">${totalCount} 项</div>
    `;

    card.addEventListener('click', () => {
        selectFolder(folder);
    });

    // 拖拽事件
    card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-bookmark-item', JSON.stringify({
            type: 'internal',
            itemType: 'folder',
            id: folder.id,
            name: folder.name,
            sourceFolderId: currentFolder.id
        }));
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        clearDragStyles();
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
    card.dataset.id = bookmark.id || bookmark.url;
    card.dataset.type = 'bookmark';
    card.draggable = true;

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

    // 拖拽事件
    card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-bookmark-item', JSON.stringify({
            type: 'internal',
            itemType: 'bookmark',
            id: bookmark.id || bookmark.url,
            title: bookmark.title,
            url: bookmark.url,
            favicon: bookmark.favicon,
            sourceFolderId: currentFolder.id
        }));
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        clearDragStyles();
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
        // 搜索项目
        if (folder.items) {
            folder.items.forEach(item => {
                if (item.type === 'bookmark') {
                    // 搜索书签
                    if (item.title.toLowerCase().includes(query) ||
                        item.url.toLowerCase().includes(query)) {
                        results.push(item);
                    }
                } else if (item.type === 'folder') {
                    // 递归搜索子文件夹
                    searchInFolder(item);
                }
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
        res.parent.items = res.parent.items.filter(item => item.id !== id);
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
        if (folder.items) {
            const before = folder.items.length;
            folder.items = folder.items.filter(item => {
                if (item.type === 'bookmark' && item === targetBookmark) {
                    return false;
                } else if (item.type === 'folder' && removeFromFolder(item)) {
                    return false;
                }
                return true;
            });
            if (before !== folder.items.length) return true;
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
                res.folder.items = res.folder.items || [];
                res.folder.items.push({
                    id: newId,
                    name: name,
                    type: 'folder',
                    items: []
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
                res.folder.items = res.folder.items || [];
                res.folder.items.push({
                    type: 'bookmark',
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
    if (folder.items) {
        for (const item of folder.items) {
            if (item.type === 'folder') {
                const res = findFolderById(item, id, folder);
                if (res) return res;
            }
        }
    }
    return null;
}

// 辅助函数：获取文件夹的父文件夹ID
function findParentFolderId(tree, folderId) {
    const result = findFolderById(tree, folderId);
    return result && result.parent ? result.parent.id : 'root';
}

// 辅助函数：检查文件夹是否是另一个文件夹的子文件夹
function isDescendantFolder(parentFolder, childFolderId) {
    if (!parentFolder.items) return false;
    
    for (const item of parentFolder.items) {
        if (item.type === 'folder') {
            if (item.id === childFolderId) return true;
            if (isDescendantFolder(item, childFolderId)) return true;
        }
    }
    
    return false;
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
    currentFolder.items = currentFolder.items || [];
    currentFolder.items.push({
        type: 'bookmark',
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
