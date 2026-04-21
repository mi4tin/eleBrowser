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

// 获取 DOM 元素
const profileStatus = document.querySelector('.profile-status');

// 侧边栏组件
let sidebar;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化侧边栏
    sidebar = new SidebarComponent('profile');
    await sidebar.loadSidebar();
    
    // 重写 switchSection 方法以支持内容切换
    sidebar.switchSection = function(sectionId) {
        const menuItems = document.querySelectorAll('.sidebar .menu-item');
        const contentSections = document.querySelectorAll('.content-section');
        
        // 更新菜单项状态
        menuItems.forEach(item => {
            item.classList.remove('active');
            if (item.dataset.section === sectionId) {
                item.classList.add('active');
            }
        });

        // 更新内容区域
        if (contentSections && contentSections.length > 0) {
            contentSections.forEach(section => {
                section.classList.remove('active');
                if (section.id === `${sectionId}-section`) {
                    section.classList.add('active');
                }
            });
        }
    };
});

// 绑定登录按钮点击事件
if (profileStatus) {
    profileStatus.addEventListener('click', () => {
        ipcRenderer.send('open-login-window');
    });
}

// 绑定设置项点击事件
const settingItems = document.querySelectorAll('.setting-item');
settingItems.forEach(item => {
    item.addEventListener('click', () => {
        const settingName = item.querySelector('.setting-name')?.textContent;
        console.log('点击设置项:', settingName);
        
        // 处理云同步点击
        if (item.id === 'cloud-sync-item') {
            window.location.href = 'sync.html';
        }
    });
});
