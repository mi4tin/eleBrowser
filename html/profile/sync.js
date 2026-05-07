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
            invoke: function () { return Promise.resolve(null); },
            on: function () {},
            once: function (channel, listener) {
                if (channel === 'bookmarks-data-response') {
                    setTimeout(() => listener(null, null), 0);
                } else {
                    setTimeout(() => listener(null), 0);
                }
            }
        };
    }
}

// DOM Elements
const syncBtn = document.getElementById('syncBtn');
const syncBookmarks = document.getElementById('syncBookmarks');
const syncHistory = document.getElementById('syncHistory');
const syncPasswords = document.getElementById('syncPasswords');
const syncSettings = document.getElementById('syncSettings');
const syncBackup = document.getElementById('syncBackup');
const syncConflictModal = document.getElementById('syncConflictModal');
const cancelSyncBtn = document.getElementById('cancelSyncBtn');
const conflictOptions = document.querySelectorAll('.conflict-option');

// 侧边栏组件
let sidebar;
let currentUser = null;
let isSyncing = false;
let selectedConflictOption = null;
let pendingSyncData = null;
let bookmarkSync = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化侧边栏
    sidebar = new SidebarComponent('sync');
    await sidebar.loadSidebar();
    
    // 加载用户数据
    await loadUserData();
    
    // 加载同步设置
    loadSyncSettings();
    
    // 更新UI状态
    updateSyncUI();
    
    // 绑定冲突解决事件
    bindConflictEvents();
});

// 加载用户数据
async function loadUserData() {
    try {
        const result = await ipcRenderer.invoke('load-user-data');
        console.log('加载用户数据结果:', result);
        if (result && result.success) {
            if (result.data) {
                // 旧格式：直接返回用户数据
                console.log('加载用户数据成功:', result.data);
                currentUser = result.data;
            } else if (result.user) {
                // 新格式：在 user 字段中
                console.log('加载用户数据成功:', result.user);
                currentUser = result.user;
            }
        }
    } catch (error) {
        console.error('加载用户数据失败:', error);
    }
}

// 更新同步UI
function updateSyncUI() {
    const syncStatusIcon = document.querySelector('.sync-status-icon');
    const syncStatusTitle = document.querySelector('.sync-status-title');
    const syncStatusDesc = document.querySelector('.sync-status-desc');
    
    console.log('currentUser', currentUser);
    if (currentUser && currentUser.token) {
        // 已登录
        syncStatusIcon.textContent = '☁️';
        syncStatusTitle.textContent = `已登录: ${currentUser.nickname || currentUser.email}`;
        
        // 显示最后同步时间
        const lastSyncTime = localStorage.getItem('lastSyncTime');
        if (lastSyncTime) {
            const date = new Date(parseInt(lastSyncTime));
            syncStatusDesc.textContent = `最后同步: ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        } else {
            syncStatusDesc.textContent = '尚未同步';
        }
        
        // 启用按钮
        syncBtn.disabled = false;
    } else {
        // 未登录
        syncStatusIcon.textContent = '🔒';
        syncStatusTitle.textContent = '请先登录';
        syncStatusDesc.textContent = '登录后可使用云同步功能';
        
        // 禁用按钮
        syncBtn.disabled = true;
    }
}

// 显示通知
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#4CAF50' : '#f44336'};
        color: white;
        padding: 12px 24px;
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 10000;
        transition: opacity 0.3s ease;
        font-size: 14px;
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

// 绑定冲突解决事件
function bindConflictEvents() {
    // 冲突选项点击
    conflictOptions.forEach(option => {
        option.addEventListener('click', () => {
            // 移除所有选中状态
            conflictOptions.forEach(o => o.classList.remove('active'));
            // 添加当前选中状态
            option.classList.add('active');
            selectedConflictOption = option.dataset.option;
        });
    });
    
    // 取消按钮
    cancelSyncBtn.addEventListener('click', () => {
        hideConflictModal();
    });
}

// 显示冲突模态框
function showConflictModal() {
    selectedConflictOption = null;
    conflictOptions.forEach(o => o.classList.remove('active'));
    syncConflictModal.style.display = 'flex';
}

// 隐藏冲突模态框
function hideConflictModal() {
    syncConflictModal.style.display = 'none';
    pendingSyncData = null;
}

// 获取本地书签数据,root不保留
async function getLocalBookmarks() {
    return new Promise((resolve) => {
        let resolved = false;
        
        // 使用 once 监听单次响应
        ipcRenderer.once('load-bookmarks-reply', (event, data) => {
            if (resolved) return;
            resolved = true;
            console.log('获取本地书签数据:', data);
            resolve(data);
        });
        
        ipcRenderer.send('load-bookmarks');
        
        // 超时处理，3秒后返回默认数据
        setTimeout(() => {
            if (resolved) return;
            resolved = true;
            resolve({
                id: 'root',
                title: '书签',
                type: 'folder',
                items: []
            });
        }, 3000);
    });
}

// 将树结构转换为扁平列表
function flattenBookmarks(tree, parentId = null, result = []) {
    const item = {
        localId: tree.id,
        parentId: parentId,
        type: tree.type || 'folder',
        title: tree.name || tree.title || '',
        url: tree.url || '',
        favicon: tree.favicon || '',
        orderIndex: tree.orderIndex || 0,
        syncVersion: tree.syncVersion || 0,
        isDeleted: tree.isDeleted || false
    };
    result.push(item);
    
    if (tree.items && tree.items.length > 0) {
        tree.items.forEach(child => {
            flattenBookmarks(child, tree.id, result);
        });
    }
    
    return result;
}

// 将扁平列表转换为树结构
function buildBookmarkTree(flatList) {
    const map = {};
    const roots = [];
    
    // 创建映射
    flatList.forEach(item => {
        map[item.localId] = {
            id: item.localId,
            name: item.title,
            title: item.title,
            type: item.type,
            url: item.url,
            favicon: item.favicon,
            orderIndex: item.orderIndex,
            syncVersion: item.syncVersion,
            isDeleted: item.isDeleted,
            items: []
        };
    });
    
    // 构建树
    flatList.forEach(item => {
        if (item.parentId === null || item.parentId === 'root' || !map[item.parentId]) {
            roots.push(map[item.localId]);
        } else {
            map[item.parentId].items.push(map[item.localId]);
        }
    });
    
    // 排序
    function sortItems(items) {
        items.sort((a, b) => a.orderIndex - b.orderIndex);
        items.forEach(item => {
            if (item.items && item.items.length > 0) {
                sortItems(item.items);
            }
        });
    }
    sortItems(roots);
    
    // 如果只有一个根节点且是 root，直接返回
    if (roots.length === 1 && roots[0].id === 'root') {
        return roots[0];
    }
    
    // 否则包装在 root 下
    return {
        id: 'root',
        title: '书签',
        type: 'folder',
        items: roots
    };
}

// 合并书签（简单合并策略）
function mergeBookmarks(localTree, cloudTree) {
    const localMap = {};
    const cloudMap = {};
    
    // 构建本地映射
    function buildMap(tree, map) {
        map[tree.id] = tree;
        if (tree.items) {
            tree.items.forEach(child => buildMap(child, map));
        }
    }
    buildMap(localTree, localMap);
    buildMap(cloudTree, cloudMap);
    
    // 合并策略：云端优先，但保留本地新增的
    const mergedMap = {};
    
    // 先添加所有云端书签
    Object.keys(cloudMap).forEach(id => {
        mergedMap[id] = { ...cloudMap[id], items: [] };
    });
    
    // 添加本地新增的（云端没有的）
    Object.keys(localMap).forEach(id => {
        if (!cloudMap[id]) {
            mergedMap[id] = { ...localMap[id], items: [] };
        }
    });
    
    // 重建树结构
    const result = buildBookmarkTree(Object.values(mergedMap).map(item => ({
        localId: item.id,
        parentId: item.parentId || null,
        type: item.type,
        title: item.name,
        url: item.url,
        favicon: item.favicon,
        orderIndex: item.orderIndex,
        syncVersion: item.syncVersion,
        isDeleted: item.isDeleted
    })));
    
    return result;
}

// 执行同步
async function performSync() {
    if (isSyncing) return;
    if (!currentUser || !currentUser.token) {
        showNotification('请先登录', 'error');
        return;
    }
    
    isSyncing = true;
    syncBtn.textContent = '同步中...';
    syncBtn.style.opacity = '0.7';
    syncBtn.style.cursor = 'wait';
    
    try {
        if (!bookmarkSync) {
            bookmarkSync = new BookmarkSync([]);
        }

        const syncResult = await bookmarkSync.checkAndAutoSync();
        if (syncResult && syncResult.success) {
            showNotification('同步成功', 'success');
        } else {
            showNotification('同步失败', 'error');
        }
    } catch (error) {
        console.error('同步失败:', error);
        showNotification('同步失败: ' + error.message, 'error');
    } finally {
        isSyncing = false;
        syncBtn.textContent = '立即同步';
        syncBtn.style.opacity = '1';
        syncBtn.style.cursor = 'pointer';
    }
}

// Save sync settings
function saveSyncSettings() {
    const settings = {
        bookmarks: syncBookmarks.checked,
        history: syncHistory.checked,
        passwords: syncPasswords.checked,
        settings: syncSettings.checked,
        backup: syncBackup.checked
    };
    
    try {
        localStorage.setItem('syncSettings', JSON.stringify(settings));
        console.log('同步设置已保存:', settings);
    } catch (error) {
        console.error('保存同步设置失败:', error);
    }
}

// Load sync settings
function loadSyncSettings() {
    try {
        const savedSettings = localStorage.getItem('syncSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            syncBookmarks.checked = settings.bookmarks ?? true;
            syncHistory.checked = settings.history ?? false;
            syncPasswords.checked = settings.passwords ?? false;
            syncSettings.checked = settings.settings ?? true;
            syncBackup.checked = settings.backup ?? false;
        }
    } catch (error) {
        console.error('加载同步设置失败:', error);
    }
}

// 绑定按钮事件
syncBtn.addEventListener('click', performSync);

// Event listeners for switches
[syncBookmarks, syncHistory, syncPasswords, syncSettings, syncBackup].forEach(switchEl => {
    if (switchEl) {
        switchEl.addEventListener('change', saveSyncSettings);
    }
});
