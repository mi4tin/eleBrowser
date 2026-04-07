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
const folderDropdownContainer = document.getElementById('folderDropdownContainer');

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
function showFolderDropdown() {
    const items = folderData.items;
 // 清空并重新渲染下拉菜单内容
    folderDropdownContent.innerHTML = '';

    if (items.length === 0) {
        // 空文件夹，不显示下拉菜单
        folderDropdownContent.innerHTML = '<div class="folder-dropdown-empty">空文件夹</div>';
        return;
    }

   

    // 渲染每个项目
    items.forEach((item, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'folder-dropdown-item';
        itemEl.dataset.itemType = item.type;
        itemEl.dataset.index = index;
        if (item.type === 'folder') {
            itemEl.dataset.id = item.id;
            itemEl.dataset.itemCount = (item.items && item.items.length) || 0;
        } else {
            itemEl.dataset.id = item.id || item.url;
        }
        itemEl.draggable = true;

         // 鼠标悬停在子文件夹上：显示下级菜单
            let hoverTimeout = null;
        if (item.type === 'folder') {
            // 子文件夹
            itemEl.innerHTML = `
                <span class="icon folder-icon">📁</span>
                <span class="label">${escapeHtml(item.name)}</span>
                <span class="arrow">❯</span>
            `;
            
            itemEl.addEventListener('mouseenter', () => {
                const rect = itemEl.getBoundingClientRect();
                console.log('鼠标进入子文件夹:', item.name, rect);

                // 延迟显示子菜单，避免快速移动时闪烁
                if (hoverTimeout) {
                    clearTimeout(hoverTimeout);
                }

                hoverTimeout = setTimeout(() => {
                    // 计算子菜单位置（在当前菜单右侧）
                    const bounds = {
                        x: rect.right,
                        y: rect.top,
                        width: 300,
                        height: 41*(item.items.length || 1) +16+2//如果没有保留一行
                    };
                    console.log('发送子菜单显示请求:', bounds, item);
                    ipcRenderer.send('show-folder-dropdown-next', bounds, item, folderData.id);
                }, 100); // 100ms 延迟

                // 添加激活状态样式
                itemEl.classList.add('active');
            });

            itemEl.addEventListener('mouseleave', () => {
                // 鼠标离开时移除激活状态
                itemEl.classList.remove('active');

                // 清除延时器
                if (hoverTimeout) {
                    clearTimeout(hoverTimeout);
                    hoverTimeout = null;
                }
            });

        } else {
            // 书签
            itemEl.innerHTML = `
                <span class="icon">${item.favicon || '🔗'}</span>
                <span class="label">${escapeHtml(item.title)}</span>
            `;

            itemEl.addEventListener('mouseenter', () => {
                const rect = itemEl.getBoundingClientRect();
                console.log('鼠标进入书签:', item.title, rect);

                // 延迟显示子菜单，避免快速移动时闪烁
                if (hoverTimeout) {
                    clearTimeout(hoverTimeout);
                }

                hoverTimeout = setTimeout(() => {
                    console.log('发送子菜单显示请求1:');
                    ipcRenderer.send('show-folder-dropdown-next', null, item, folderData.id);
                }, 100); // 100ms 延迟

                // 添加激活状态样式
                itemEl.classList.add('active');
            });

            itemEl.addEventListener('mouseleave', () => {
                // 鼠标离开时移除激活状态
                itemEl.classList.remove('active');

                // 清除延时器
                if (hoverTimeout) {
                    clearTimeout(hoverTimeout);
                    hoverTimeout = null;
                }
            });

            // 点击书签：直接打开网址
            itemEl.addEventListener('click', () => {
                console.log('点击了书签:', item.title);
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

        // 添加拖拽事件
        addDragEventsToItem(itemEl, item, index);

        folderDropdownContent.appendChild(itemEl);
    });

    // 设置下拉菜单位置（从主页面接收的 bounds）
    // folderDropdown.style.left = `${folderBounds.x}px`;
    // folderDropdown.style.top = `${folderBounds.y}px`;

    // 显示下拉菜单
    folderDropdown.classList.add('show');
}

// 隐藏文件夹下拉菜单
function hideFolderDropdown() {
    folderDropdown.classList.remove('show');
}

// 为项目添加拖拽事件
function addDragEventsToItem(itemEl, item, index) {
    // 拖拽开始
    itemEl.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        let dragData;
        if (item.type === 'folder') {
            dragData = {
                type: 'internal',
                itemType: 'folder',
                id: item.id,
                name: item.name
            };
        } else {
            dragData = {
                type: 'internal',
                itemType: 'bookmark',
                id: item.id || item.url,
                title: item.title,
                url: item.url,
                favicon: item.favicon
            };
        }
        e.dataTransfer.setData('application/x-bookmark-item', JSON.stringify(dragData));
        e.dataTransfer.effectAllowed = 'move';
        itemEl.classList.add('dragging');
    });

    // 拖拽结束
    itemEl.addEventListener('dragend', () => {
        itemEl.classList.remove('dragging');
        document.querySelectorAll('.folder-dropdown-item').forEach(el => {
            el.classList.remove('drag-over-folder', 'drag-over-top', 'drag-over-bottom');
        });
        folderDropdownContent.classList.remove('drag-over-empty');
        clearTimeout(dragSubMenuTimeout);
        dragSubMenuTimeout = null;
        currentDragHoverItem = null;
    });
}

// 书签数据（从主进程接收）
let folderData = null;

// 加载书签数据
function loadBookmarksData(folderId) {
    return new Promise((resolve) => {
        console.log('加载书签数据.1:', folderId);
        ipcRenderer.send('load-bookmarks', folderId);
        ipcRenderer.once('load-bookmarks-reply', (event, bookmarks) => {
            console.log('收到书签数据:', bookmarks);
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

// 监听主页面的消息
ipcRenderer.on('show-folder-dropdown', async (event, receivedFolderData, folderBounds) => {
    console.log('收到显示文件夹下拉菜单请求:', receivedFolderData, folderBounds);

    folderData = receivedFolderData

    showFolderDropdown();
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

folderDropdownContainer.addEventListener('focus', () => {
    console.log('书签栏鼠标移入',new Date());
    // hideFolderDropdown();
    // canMouseenter = false;
});

folderDropdownContainer.addEventListener('blur', () => {
    console.log('书签栏鼠标移出',new Date());
    // hideFolderDropdown();
    // canMouseenter = false;
});


// ========== 下拉菜单拖拽功能 ==========

// 拖拽时显示子菜单的计时器
let dragSubMenuTimeout = null;
let currentDragHoverItem = null;

// dragover 事件
folderDropdownContent.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const targetItem = e.target.closest('.folder-dropdown-item');
    
    // 清除所有样式
    document.querySelectorAll('.folder-dropdown-item').forEach(el => {
        el.classList.remove('drag-over-folder', 'drag-over-top', 'drag-over-bottom');
    });
    folderDropdownContent.classList.remove('drag-over-empty');

    if (targetItem) {
        const targetItemType = targetItem.dataset.itemType;
        const rect = targetItem.getBoundingClientRect();
        const mouseY = e.clientY - rect.top;

        if (targetItemType === 'folder') {
            // 文件夹：上1/6显示上方横线，下1/6显示下方横线，中间显示拖入样式
            const zone = rect.height / 6;
            if (mouseY < zone) {
                targetItem.classList.add('drag-over-top');
            } else if (mouseY > rect.height - zone) {
                targetItem.classList.add('drag-over-bottom');
            } else {
                targetItem.classList.add('drag-over-folder');
            }
            
            // 只有在中间区域才延时显示子菜单
            if (mouseY >= zone && mouseY <= rect.height - zone) {
                if (currentDragHoverItem !== targetItem) {
                    currentDragHoverItem = targetItem;
                    clearTimeout(dragSubMenuTimeout);
                    dragSubMenuTimeout = setTimeout(() => {
                        const bounds = {
                            x: rect.right,
                            y: rect.top,
                            width: 300,
                            height: 41 * ((targetItem.dataset.itemCount || 0) || 1) + 16 + 2
                        };
                        
                        const itemIndex = Array.from(folderDropdownContent.children).indexOf(targetItem);
                        if (folderData.items && folderData.items[itemIndex]) {
                            const item = folderData.items[itemIndex];
                            ipcRenderer.send('show-folder-dropdown-next', bounds, item, folderData.id);
                        }
                    }, 500);
                }
            } else {
                currentDragHoverItem = null;
                clearTimeout(dragSubMenuTimeout);
            }
        } else {
            // 书签：按高度的1/2划分
            if (mouseY < rect.height / 2) {
                targetItem.classList.add('drag-over-top');
            } else {
                targetItem.classList.add('drag-over-bottom');
            }
            currentDragHoverItem = null;
            clearTimeout(dragSubMenuTimeout);
        }
    } else if (!targetItem) {
        folderDropdownContent.classList.add('drag-over-empty');
        currentDragHoverItem = null;
        clearTimeout(dragSubMenuTimeout);
    } else {
        currentDragHoverItem = null;
        clearTimeout(dragSubMenuTimeout);
    }
});

// dragleave 事件
folderDropdownContent.addEventListener('dragleave', (e) => {
    if (!folderDropdownContent.contains(e.relatedTarget)) {
        document.querySelectorAll('.folder-dropdown-item').forEach(el => {
            el.classList.remove('drag-over-folder', 'drag-over-top', 'drag-over-bottom');
        });
        folderDropdownContent.classList.remove('drag-over-empty');
        // 清除计时器
        clearTimeout(dragSubMenuTimeout);
        dragSubMenuTimeout = null;
        currentDragHoverItem = null;
    }
});

// drop 事件
folderDropdownContent.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const internalData = e.dataTransfer.getData('application/x-bookmark-bar-item');
    if (internalData) {
        try {
            const data = JSON.parse(internalData);
            const targetItem = e.target.closest('.folder-dropdown-item');
            
            if (targetItem) {
                const targetItemType = targetItem.dataset.itemType;
                const rect = targetItem.getBoundingClientRect();
                const mouseY = e.clientY - rect.top;
                const allItems = Array.from(folderDropdownContent.children);
                const targetIndexInList = allItems.indexOf(targetItem);
                
                if (targetItemType === 'folder') {
                    const zone = rect.height / 6;
                    if (mouseY >= zone && mouseY <= rect.height - zone) {
                        // 中间区域：移动到该文件夹内
                        const targetFolderId = targetItem.dataset.id;
                        console.log('移动项目到文件夹:', data, '目标文件夹:', targetFolderId);
                        ipcRenderer.send('move-bookmark-to-folder', data, targetFolderId);
                    } else {
                        // 上/下边缘：在同一文件夹内排序
                        const isTop = mouseY < zone;
                        let finalTargetIndex = isTop ? targetIndexInList : targetIndexInList + 1;
                        console.log('同一文件夹内排序1:', data, '目标索引:', finalTargetIndex);
                        ipcRenderer.send('reorder-bookmark-in-folder', data, folderData.id, finalTargetIndex);
                    }
                } else {
                    // 书签的上/下边缘：在同一文件夹内排序
                    const isTop = mouseY < rect.height / 2;
                    let finalTargetIndex = isTop ? targetIndexInList : targetIndexInList + 1;
                    console.log('同一文件夹内排序2:', data, '目标索引:', finalTargetIndex);
                    ipcRenderer.send('reorder-bookmark-in-folder', data, folderData.id, finalTargetIndex);
                }
            } else {
                // 拖到空白区域：添加到当前文件夹
                console.log('添加到当前文件夹:', data, folderData.id);
                ipcRenderer.send('move-bookmark-to-folder', data, folderData.id);
            }

            // 清除样式
            document.querySelectorAll('.folder-dropdown-item').forEach(el => {
                el.classList.remove('drag-over-folder', 'drag-over-top', 'drag-over-bottom');
            });
            folderDropdownContent.classList.remove('drag-over-empty');
            // 清除计时器
            clearTimeout(dragSubMenuTimeout);
            dragSubMenuTimeout = null;
            currentDragHoverItem = null;
            
        } catch (err) {
            console.error('解析拖拽数据失败:', err);
        }
    }
});

// 拖拽结束事件
document.addEventListener('dragend', () => {
    // 清除计时器
    clearTimeout(dragSubMenuTimeout);
    dragSubMenuTimeout = null;
    currentDragHoverItem = null;
    // 清除样式
    document.querySelectorAll('.folder-dropdown-item').forEach(el => {
        el.classList.remove('drag-over-folder', 'drag-over-top', 'drag-over-bottom');
    });
    folderDropdownContent.classList.remove('drag-over-empty');
});

// 窗口大小改变时关闭下拉菜单
window.addEventListener('resize', hideFolderDropdown);

console.log('下拉菜单页面初始化完成');
