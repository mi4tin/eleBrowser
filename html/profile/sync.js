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

// 侧边栏组件
let sidebar;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化侧边栏
    sidebar = new SidebarComponent('sync');
    await sidebar.loadSidebar();
    
    // 加载同步设置
    loadSyncSettings();
});

// Sync button handler
let isSyncing = false;
syncBtn.addEventListener('click', async () => {
    if (isSyncing) return;
    
    isSyncing = true;
    syncBtn.textContent = '同步中...';
    syncBtn.style.opacity = '0.7';
    syncBtn.style.cursor = 'wait';
    
    // 模拟同步过程
    try {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 更新状态
        const statusDesc = document.querySelector('.sync-status-desc');
        if (statusDesc) {
            const now = new Date();
            statusDesc.textContent = `最后同步: ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        }
        
        console.log('同步完成');
    } catch (error) {
        console.error('同步失败:', error);
    } finally {
        isSyncing = false;
        syncBtn.textContent = '立即同步';
        syncBtn.style.opacity = '1';
        syncBtn.style.cursor = 'pointer';
    }
});

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

// Event listeners for switches
[syncBookmarks, syncHistory, syncPasswords, syncSettings, syncBackup].forEach(switchEl => {
    if (switchEl) {
        switchEl.addEventListener('change', saveSyncSettings);
    }
});

// Load settings on page load
document.addEventListener('DOMContentLoaded', loadSyncSettings);