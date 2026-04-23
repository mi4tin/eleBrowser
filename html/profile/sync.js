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

// 获取本地书签数据
async function getLocalBookmarks() {
    return new Promise((resolve) => {
        let resolved = false;
        
        // 使用 once 监听单次响应
        ipcRenderer.once('bookmarks-data-response', (event, data) => {
            if (resolved) return;
            resolved = true;
            resolve(data);
        });
        
        ipcRenderer.send('request-bookmarks-data');
        
        // 超时处理，3秒后返回默认数据
        setTimeout(() => {
            if (resolved) return;
            resolved = true;
            resolve({
                id: 'root',
                name: '书签',
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
        name: '书签',
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
        // 步骤1：获取服务器版本号
        console.log('获取服务器版本号...');
        const versionResult = await ipcRenderer.invoke('get-bookmarks-version', {
            token: currentUser.token
        });

        console.log('获取服务器版本号结果:', versionResult);
        
        if (!versionResult || !versionResult.success) {
            throw new Error(versionResult?.error || '获取版本号失败');
        }
        
        const serverVersion = versionResult.data?.version || 0;
        const localVersion = parseInt(localStorage.getItem('bookmarkSyncVersion') || 0);
        
        console.log('版本比较 - 本地:', localVersion, '云端:', serverVersion);
        
        // 步骤2：处理不同情况
        if (serverVersion === 0) {
            // 首次同步，上传本地完整书签
            await performUploadFirst();
        } else if (serverVersion > localVersion) {
            // 有差异，显示冲突解决界面
            pendingSyncData = { serverVersion, localVersion };
            showConflictModal();
            
            // 等待用户选择
            const selectedOption = await waitForConflictOption();
            
            if (selectedOption) {
                await performSyncWithOption(selectedOption, serverVersion);
            }
        } else {
            // 版本相同，增量同步
            await performIncrementalSync();
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

// 等待用户选择冲突解决选项
function waitForConflictOption() {
    return new Promise((resolve) => {
        // 检查选项的定时器
        const checkInterval = setInterval(() => {
            if (selectedConflictOption) {
                clearInterval(checkInterval);
                hideConflictModal();
                resolve(selectedConflictOption);
            }
            if (syncConflictModal.style.display === 'none') {
                clearInterval(checkInterval);
                resolve(null);
            }
        }, 100);
        
        // 选项点击事件
        conflictOptions.forEach(option => {
            option.addEventListener('click', () => {
                // 如果有选中的选项，添加确认按钮
                if (!document.getElementById('confirmSyncBtn')) {
                    const footer = syncConflictModal.querySelector('.modal-footer');
                    const confirmBtn = document.createElement('button');
                    confirmBtn.id = 'confirmSyncBtn';
                    confirmBtn.className = 'modal-btn confirm-btn';
                    confirmBtn.textContent = '确认';
                    footer.insertBefore(confirmBtn, cancelSyncBtn);
                    
                    confirmBtn.addEventListener('click', () => {
                        selectedConflictOption = option.dataset.option;
                    });
                }
            }, { once: true });
        });
    });
}

// 首次上传
async function performUploadFirst() {
    console.log('首次同步，上传本地完整书签...');
    
    // 获取本地书签
    const localBookmarks = await getLocalBookmarks();
    
    // 转换为扁平列表
    const flatBookmarks = flattenBookmarks(localBookmarks);
    
    // 上传
    const result = await ipcRenderer.invoke('upload-bookmarks', {
        token: currentUser.token,
        bookmarks: flatBookmarks,
        syncVersion: 1,
        deviceId: localStorage.getItem('deviceId') || 'browser-device'
    });
    
    if (result && result.success) {
        // 从服务器返回的结果中获取版本号
        const newVersion = result.data?.version || 1;
        
        // 更新同步版本
        localStorage.setItem('bookmarkSyncVersion', newVersion);
        localStorage.setItem('lastSyncTime', Date.now());
        
        updateSyncUI();
        showNotification('首次同步成功！');
        console.log('首次同步完成，版本:', newVersion);
    } else {
        throw new Error(result?.error || '上传失败');
    }
}

// 根据用户选择执行同步
async function performSyncWithOption(option, serverVersion) {
    console.log('执行同步，选项:', option);
    
    const localBookmarks = await getLocalBookmarks();
    
    if (option === 'merge') {
        // 合并：先下载云端数据，合并后上传
        const downloadResult = await ipcRenderer.invoke('download-bookmarks', {
            token: currentUser.token
        });
        
        if (downloadResult && downloadResult.success) {
            const cloudFlatList = downloadResult.data?.bookmarks || [];
            const cloudTree = buildBookmarkTree(cloudFlatList);
            
            // 合并
            const mergedTree = mergeBookmarks(localBookmarks, cloudTree);
            
            // 保存到本地
            ipcRenderer.send('save-bookmarks-data', mergedTree);
            
            // 上传合并后的结果
            const flatBookmarks = flattenBookmarks(mergedTree);
            const uploadResult = await ipcRenderer.invoke('upload-bookmarks', {
                token: currentUser.token,
                bookmarks: flatBookmarks,
                syncVersion: serverVersion + 1,
                deviceId: localStorage.getItem('deviceId') || 'browser-device'
            });
            
            // 从返回结果中获取版本号
            const newVersion = uploadResult?.data?.version || (serverVersion + 1);
            localStorage.setItem('bookmarkSyncVersion', newVersion);
            showNotification('合并同步成功！');
        }
    } else if (option === 'cloud') {
        // 云端优先：下载覆盖本地
        const downloadResult = await ipcRenderer.invoke('download-bookmarks', {
            token: currentUser.token
        });
        
        if (downloadResult && downloadResult.success) {
            const cloudFlatList = downloadResult.data?.bookmarks || [];
            const cloudTree = buildBookmarkTree(cloudFlatList);
            
            // 保存到本地
            ipcRenderer.send('save-bookmarks-data', cloudTree);
            
            localStorage.setItem('bookmarkSyncVersion', serverVersion);
            showNotification('云端同步成功！');
        }
    } else if (option === 'local') {
        // 本地优先：上传覆盖云端
        const flatBookmarks = flattenBookmarks(localBookmarks);
        
        const uploadResult = await ipcRenderer.invoke('upload-bookmarks', {
            token: currentUser.token,
            bookmarks: flatBookmarks,
            syncVersion: serverVersion + 1,
            deviceId: localStorage.getItem('deviceId') || 'browser-device'
        });
        
        // 从返回结果中获取版本号
        const newVersion = uploadResult?.data?.version || (serverVersion + 1);
        localStorage.setItem('bookmarkSyncVersion', newVersion);
        showNotification('本地同步成功！');
    }
    
    // 更新最后同步时间
    localStorage.setItem('lastSyncTime', Date.now());
    updateSyncUI();
    ipcRenderer.send('refresh-bookmarks');
}

// 增量同步
async function performIncrementalSync() {
    console.log('执行增量同步...');
    
    const result = await ipcRenderer.invoke('sync-bookmarks', {
        token: currentUser.token,
        localVersion: parseInt(localStorage.getItem('bookmarkSyncVersion') || 0),
        changes: [],
        deviceId: localStorage.getItem('deviceId') || 'browser-device'
    });
    
    if (result && result.success) {
        // 应用云端变更
        if (result.data && result.data.changes && result.data.changes.length > 0) {
            const localBookmarks = await getLocalBookmarks();
            const localFlatList = flattenBookmarks(localBookmarks);
            
            // 简单的变更应用策略
            const changeMap = {};
            result.data.changes.forEach(change => {
                changeMap[change.localId] = change;
            });
            
            const mergedList = localFlatList.map(item => {
                if (changeMap[item.localId]) {
                    return { ...item, ...changeMap[item.localId] };
                }
                return item;
            });
            
            // 添加新的项
            result.data.changes.forEach(change => {
                if (!localFlatList.find(item => item.localId === change.localId)) {
                    mergedList.push(change);
                }
            });
            
            const mergedTree = buildBookmarkTree(mergedList);
            ipcRenderer.send('save-bookmarks-data', mergedTree);
        }
        
        // 更新版本
        if (result.data && result.data.serverVersion !== undefined) {
            localStorage.setItem('bookmarkSyncVersion', result.data.serverVersion);
        }
        
        localStorage.setItem('lastSyncTime', Date.now());
        updateSyncUI();
        ipcRenderer.send('refresh-bookmarks');
        
        showNotification('同步成功！');
        console.log('同步完成');
    } else {
        throw new Error(result?.error || '同步失败');
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
