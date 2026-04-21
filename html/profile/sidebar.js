// 公共侧边栏模块
class SidebarComponent {
    constructor(currentSection) {
        this.currentSection = currentSection;
        this.sidebarLoaded = false;
    }

    // 加载侧边栏
    async loadSidebar() {
        try {
            const response = await fetch('sidebar.html');
            if (!response.ok) {
                throw new Error('Failed to load sidebar');
            }
            const html = await response.text();
            
            // 找到侧边栏容器并插入
            const container = document.getElementById('sidebar-container');
            if (container) {
                container.innerHTML = html;
                this.sidebarLoaded = true;
                this.initSidebarEvents();
                this.highlightCurrentSection();
            }
        } catch (error) {
            console.error('Error loading sidebar:', error);
            // 如果加载失败，使用备用方式
            this.loadFallbackSidebar();
        }
    }

    // 加载备用侧边栏
    loadFallbackSidebar() {
        const container = document.getElementById('sidebar-container');
        if (container) {
            container.innerHTML = `
                <div class="sidebar">
                    <div class="sidebar-title">设置</div>
                    <div class="sidebar-menu">
                        <div class="menu-item" data-section="profile" data-page="profile.html">
                            <span class="menu-icon">👤</span>
                            <span class="menu-text">个人中心</span>
                        </div>
                        <div class="menu-item" data-section="sync" data-page="sync.html">
                            <span class="menu-icon">☁️</span>
                            <span class="menu-text">云同步</span>
                        </div>
                        <div class="menu-item" data-section="bookmarks">
                            <span class="menu-icon">📁</span>
                            <span class="menu-text">书签同步</span>
                        </div>
                        <div class="menu-item" data-section="history">
                            <span class="menu-icon">📊</span>
                            <span class="menu-text">AI 助手</span>
                        </div>
                        <div class="menu-item" data-section="ai">
                            <span class="menu-icon">⚙️</span>
                            <span class="menu-text">实用工具</span>
                        </div>
                        <div class="menu-item" data-section="tools">
                            <span class="menu-icon">🔒</span>
                            <span class="menu-text">隐私安全</span>
                        </div>
                        <div class="menu-item" data-section="privacy">
                            <span class="menu-icon">🌐</span>
                            <span class="menu-text">网页管理</span>
                        </div>
                        <div class="menu-item" data-section="web">
                            <span class="menu-icon">✨</span>
                            <span class="menu-text">新特性</span>
                        </div>
                    </div>
                </div>
            `;
            this.sidebarLoaded = true;
            this.initSidebarEvents();
            this.highlightCurrentSection();
        }
    }

    // 初始化侧边栏事件
    initSidebarEvents() {
        const menuItems = document.querySelectorAll('.sidebar .menu-item');
        menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                const section = item.dataset.section;
                const page = item.dataset.page;
                
                if (page) {
                    // 有指定页面，导航到该页面
                    window.location.href = page;
                } else {
                    // 没有指定页面，保持在当前页面（可能是在profile.html内切换）
                    this.switchSection(section);
                }
            });
        });
    }

    // 高亮当前区域
    highlightCurrentSection() {
        const menuItems = document.querySelectorAll('.sidebar .menu-item');
        menuItems.forEach(item => {
            if (item.dataset.section === this.currentSection) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    // 切换区域（主要用于profile.html内的内容切换）
    switchSection(sectionId) {
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
    }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SidebarComponent;
}