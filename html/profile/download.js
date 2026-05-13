// 下载设置页面（设置持久化在主进程 userData/download-settings.json，读写封装见 ipcTool.js）

let ipcRenderer;
if (typeof window !== 'undefined' && window.electronAPI) {
    ipcRenderer = window.electronAPI;
} else {
    try {
        const electron = require('electron');
        ipcRenderer = electron.ipcRenderer;
    } catch (e) {
        ipcRenderer = {
            invoke: () => Promise.resolve(null)
        };
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const sidebar = new SidebarComponent('download');
    await sidebar.loadSidebar();
    initDownloadSettings();
});

function initDownloadSettings() {
    void loadSettings();
    bindEvents();
}

async function loadSettings() {
    try {
        const settings = await ipcRenderer.invoke('download-settings-get');
        if (!settings) return;

        const pathEl = document.getElementById('downloadPathDisplay');
        if (pathEl) {
            pathEl.textContent = settings.downloadDirDisplay || '—';
        }

        const ask = document.getElementById('askBeforeDownload');
        if (ask) ask.checked = settings.askBeforeDownload !== false;

        const openAfter = document.getElementById('openAfterDownload');
        if (openAfter) openAfter.checked = Boolean(settings.openAfterDownload);

        const notif = document.getElementById('showDownloadNotification');
        if (notif) notif.checked = settings.showDownloadNotification !== false;

        const sound = document.getElementById('playNotificationSound');
        if (sound) sound.checked = Boolean(settings.playNotificationSound);

        const maxEl = document.getElementById('maxConcurrentDownloads');
        if (maxEl) maxEl.value = settings.maxConcurrentDownloads || '4';

        const dangerEl = document.getElementById('dangerousFileAction');
        if (dangerEl) dangerEl.value = settings.dangerousFileAction || 'ask';

        const keepEl = document.getElementById('keepHistoryDuration');
        if (keepEl) keepEl.value = settings.keepHistoryDuration || '30';
    } catch (e) {
        console.error('加载下载设置失败:', e);
    }
}

function collectSettingsPayload() {
    return {
        askBeforeDownload: document.getElementById('askBeforeDownload')?.checked ?? true,
        openAfterDownload: document.getElementById('openAfterDownload')?.checked ?? false,
        showDownloadNotification: document.getElementById('showDownloadNotification')?.checked ?? true,
        playNotificationSound: document.getElementById('playNotificationSound')?.checked ?? false,
        maxConcurrentDownloads: document.getElementById('maxConcurrentDownloads')?.value || '4',
        dangerousFileAction: document.getElementById('dangerousFileAction')?.value || 'ask',
        keepHistoryDuration: document.getElementById('keepHistoryDuration')?.value || '30'
    };
}

async function saveSettings() {
    try {
        const res = await ipcRenderer.invoke('download-settings-set', collectSettingsPayload());
        if (!res || !res.ok) {
            console.error('保存下载设置失败', res);
        }
    } catch (e) {
        console.error('保存设置失败:', e);
    }
}

function bindEvents() {
    document.getElementById('selectPathBtn')?.addEventListener('click', async () => {
        try {
            const pick = await ipcRenderer.invoke('download-settings-pick-directory');
            if (pick && !pick.canceled && pick.path) {
                const res = await ipcRenderer.invoke('download-settings-set', { downloadDir: pick.path });
                if (res && res.ok) {
                    await loadSettings();
                }
            }
        } catch (e) {
            console.error('选择下载目录失败:', e);
        }
    });

    document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
        if (confirm('确定要清除下载历史记录吗？这不会删除已下载的文件。')) {
            alert('下载历史已清除（演示）');
        }
    });

    const settingElements = [
        'askBeforeDownload',
        'openAfterDownload',
        'showDownloadNotification',
        'playNotificationSound',
        'maxConcurrentDownloads',
        'dangerousFileAction',
        'keepHistoryDuration'
    ];

    settingElements.forEach((id) => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', () => {
                void saveSettings();
            });
        }
    });
}
