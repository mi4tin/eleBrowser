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
            invoke: async function (channel, data) {
                console.log('IPC invoke (模拟):', channel, data);
                return { success: true, data: null };
            }
        };
    }
}

// 获取 DOM 元素
const profileStatus = document.querySelector('.profile-status');
const profileName = document.querySelector('.profile-name');

// 侧边栏组件
let sidebar;

// 当前用户信息
let currentUser = null;

// 更新 UI 显示用户信息
function updateProfileUI(userData) {
    if (userData) {
        // 已登录
        profileName.textContent = userData.nickname || userData.email || '用户';
        profileStatus.innerHTML = `<span class="status-dot"></span>${userData.email}`;
        currentUser = userData;
    } else {
        // 未登录
        profileName.textContent = '未登录';
        profileStatus.innerHTML = `<span class="status-dot"></span>点击登录账号`;
        currentUser = null;
    }
}

// 尝试从本地文件加载用户信息并验证
async function loadAndValidateUser() {
    try {
        const result = await ipcRenderer.invoke('load-user-data');
        
        if (result.success && result.data) {
            const userData = result.data;
            
            // 如果有 token，尝试验证
            if (userData.token) {
                // TODO: 暂时只使用本地存储的用户信息，后续可添加 token 验证
                updateProfileUI(userData);
            } else {
                // 没有 token，显示未登录
                updateProfileUI(null);
            }
        } else {
            // 没有用户数据
            updateProfileUI(null);
        }
    } catch (error) {
        console.error('加载用户信息失败:', error);
        updateProfileUI(null);
    }
}

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
    
    // 加载并验证用户信息
    await loadAndValidateUser();
});

// 绑定登录按钮点击事件
if (profileStatus) {
    profileStatus.addEventListener('click', () => {
        ipcRenderer.send('open-login-window');
    });
}

// 监听登录窗口关闭事件，重新加载用户信息
// 我们需要一种方式来检测登录成功
// 这里我们通过监听页面可见性变化来重新检查
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
        await loadAndValidateUser();
    }
});

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
