// 划线记录管理类
class UnderlineManager {
    constructor() {
        this.underlineData = {};
        this.allUnderlines = []; // 扁平化的所有划线数据
        this.currentPage = 1;
        this.itemsPerPage = 15;
        
        this.initElements();
        this.bindEvents();
        this.loadUnderlinesAsync(); // 异步加载划线记录
    }
    
    initElements() {
        this.searchInput = document.getElementById('searchInput');
        this.refreshBtn = document.getElementById('refreshBtn');
        this.clearAllBtn = document.getElementById('clearAllBtn');
        this.underlineList = document.getElementById('underlineList');
        this.stats = document.getElementById('stats');
        this.pagination = document.getElementById('pagination');
    }
    
    bindEvents() {
        this.searchInput.addEventListener('input', this.debounce(() => {
            this.currentPage = 1;
            this.render();
        }, 300));
        
        this.refreshBtn.addEventListener('click', () => {
            this.loadUnderlinesAsync();
        });
        
        this.clearAllBtn.addEventListener('click', () => {
            if (confirm('确定要清空所有划线记录吗？此操作不可撤销。')) {
                this.clearAllUnderlines();
            }
        });
    }
    
    // 防抖函数
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    // 异步加载划线记录（从主进程）
    async loadUnderlinesAsync() {
        try {
            // 尝试从主进程加载划线记录，优先使用 preload 暴露的 window.electronAPI
            let ipcRenderer;
            if (typeof window !== 'undefined' && window.electronAPI) {
                ipcRenderer = window.electronAPI;
            } else {
                try { ipcRenderer = require('electron').ipcRenderer; } catch (e) { ipcRenderer = null; }
            }

            if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
                try {
                    const underlineData = await ipcRenderer.invoke('get-all-underlines');
                    if (typeof underlineData === 'object' && underlineData !== null) {
                        this.underlineData = underlineData;

                        // 将嵌套结构扁平化为数组
                        this.allUnderlines = [];
                        for (const [url, records] of Object.entries(underlineData)) {
                            if (Array.isArray(records)) {
                                records.forEach(record => {
                                    this.allUnderlines.push({
                                        ...record,
                                        url: url
                                    });
                                });
                            }
                        }

                        // 按时间戳倒序排列（最新的在前）
                        this.allUnderlines.sort((a, b) => b.timestamp - a.timestamp);
                    } else {
                        this.allUnderlines = [];
                    }
                } catch (e) {
                    console.error('从主进程获取划线记录失败:', e);
                    this.allUnderlines = [];
                }
            } else {
                // 非Electron环境，使用空数组
                this.allUnderlines = [];
            }
        } catch (e) {
            console.error('加载划线记录失败:', e);
            this.allUnderlines = [];
        }
        
        this.render();
    }
    
    // 清空所有划线记录
    async clearAllUnderlines() {
        try {
            let ipcRenderer;
            if (typeof window !== 'undefined' && window.electronAPI) {
                ipcRenderer = window.electronAPI;
            } else {
                try { ipcRenderer = require('electron').ipcRenderer; } catch (e) { ipcRenderer = null; }
            }
            if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
                // 清空主进程中的划线数据
                await ipcRenderer.invoke('update-underline-data', '', []);
                this.underlineData = {};
                this.allUnderlines = [];
            } else {
                this.allUnderlines = [];
            }
            
            this.render();
        } catch (e) {
            console.error('清空划线记录失败:', e);
        }
    }
    
    // 删除单个划线记录
    async deleteUnderline(url, timestamp) {
        try {
            let ipcRenderer;
            if (typeof window !== 'undefined' && window.electronAPI) {
                ipcRenderer = window.electronAPI;
            } else {
                try { ipcRenderer = require('electron').ipcRenderer; } catch (e) { ipcRenderer = null; }
            }
            if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
                // 获取当前URL的所有划线记录
                let urlRecords = this.underlineData[url] || [];

                // 根据时间戳移除指定的记录
                urlRecords = urlRecords.filter(record => record.timestamp !== timestamp);

                // 更新主进程中的数据
                await ipcRenderer.invoke('update-underline-data', url, urlRecords);

                // 更新本地数据
                if (urlRecords.length === 0) {
                    delete this.underlineData[url];
                } else {
                    this.underlineData[url] = urlRecords;
                }

                // 重新加载数据
                this.loadUnderlinesAsync();
            }
        } catch (e) {
            console.error('删除划线记录失败:', e);
        }
    }
    
    // 搜索划线记录
    searchUnderlines(keyword) {
        if (!keyword) return this.allUnderlines;
        
        const lowerKeyword = keyword.toLowerCase();
        return this.allUnderlines.filter(item => 
            item.text.toLowerCase().includes(lowerKeyword) || 
            item.url.toLowerCase().includes(lowerKeyword)
        );
    }
    
    // 获取分页数据
    getPagedUnderlines(searchResults) {
        const totalItems = searchResults.length;
        const totalPages = Math.ceil(totalItems / this.itemsPerPage);
        
        // 确保当前页在有效范围内
        if (this.currentPage > totalPages && totalPages > 0) {
            this.currentPage = totalPages;
        }
        
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const pagedData = searchResults.slice(startIndex, endIndex);
        
        return {
            items: pagedData,
            totalItems: totalItems,
            totalPages: totalPages,
            currentPage: this.currentPage,
            startIndex: startIndex
        };
    }
    
    // 渲染划线记录列表
    render() {
        const keyword = this.searchInput.value.trim();
        const searchResults = this.searchUnderlines(keyword);
        const pagedData = this.getPagedUnderlines(searchResults);
        
        // 更新统计信息
        this.stats.textContent = `总计: ${searchResults.length} 条划线记录 (共 ${this.allUnderlines.length} 条)`;
        
        if (pagedData.items.length === 0) {
            this.underlineList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">✏️</div>
                    <div>${keyword ? '未找到匹配的划线记录' : '暂无划线记录'}</div>
                    ${keyword ? `<div style="margin-top: 8px; font-size: 14px; color: #999;">搜索词："${keyword}"</div>` : '<div style="margin-top: 8px; font-size: 14px; color: #999;">在网页上划线后，记录将自动保存在这里</div>'}
                </div>
            `;
            this.pagination.innerHTML = '';
            return;
        }
        
        const underlineHTML = pagedData.items.map((item, index) => {
            // 查找在原URL数组中的实际索引
            const urlRecords = this.underlineData[item.url] || [];
            const actualIndex = urlRecords.findIndex(record => 
                record.text === item.text && record.timestamp === item.timestamp
            );
            
            return `
                <div class="underline-item" data-url="${encodeURIComponent(item.url)}" data-timestamp="${item.timestamp}">
                    <div class="item-info view-btn">
                        <div class="item-text">${this.escapeHtml(item.text)}</div>
                        <div class="item-url">${this.escapeHtml(item.url)}</div>
                    </div>
                    <div class="item-time">${new Date(item.timestamp).toLocaleString()}</div>
                    <div class="item-actions">
                        <button class="action-btn view-btn" title="在原网页查看">查看</button>
                        <button class="action-btn delete-btn" title="删除记录">删除</button>
                    </div>
                </div>
            `;
        }).join('');
        
        this.underlineList.innerHTML = underlineHTML;
        
        // 绑定项目事件
        this.bindItemEvents();
        
        // 渲染分页
        this.renderPagination(pagedData.totalPages, pagedData.currentPage);
    }
    
    // 绑定项目事件
    bindItemEvents() {
        // 查看按钮事件 - 在新标签页打开原网页
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const item = e.target.closest('.underline-item');
                const encodedUrl = item.dataset.url;
                const url = decodeURIComponent(encodedUrl);
                
                if (url) {
                    // 通知父窗口打开链接
                    let ipcRenderer;
                    if (typeof window !== 'undefined' && window.electronAPI) {
                        ipcRenderer = window.electronAPI;
                    } else {
                        try { ipcRenderer = require('electron').ipcRenderer; } catch (e) { ipcRenderer = null; }
                    }
                    if (ipcRenderer && typeof ipcRenderer.send === 'function') {
                        ipcRenderer.send('open-bookmark', url);
                    } else {
                        window.open(url, '_blank');
                    }
                }
            });
        });
        
        // 删除记录事件
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const item = e.target.closest('.underline-item');
                const encodedUrl = item.dataset.url;
                const url = decodeURIComponent(encodedUrl);
                const timestamp = parseInt(item.dataset.timestamp);
                
                // if (confirm('确定要删除这条划线记录吗？')) {
                    this.deleteUnderline(url, timestamp);
                // }
            });
        });
    }
    
    // 渲染分页控件
    renderPagination(totalPages, currentPage) {
        if (totalPages <= 1) {
            this.pagination.innerHTML = '';
            return;
        }
        
        let paginationHTML = '';
        
        // 上一页
        paginationHTML += `
            <button class="page-btn" ${currentPage <= 1 ? 'disabled' : ''} data-page="${currentPage - 1}">
                上一页
            </button>
        `;
        
        // 页码
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, currentPage + 2);
        
        if (startPage > 1) {
            paginationHTML += `<button class="page-btn" data-page="1">1</button>`;
            if (startPage > 2) {
                paginationHTML += `<span class="page-ellipsis">...</span>`;
            }
        }
        
        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `
                <button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">
                    ${i}
                </button>
            `;
        }
        
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                paginationHTML += `<span class="page-ellipsis">...</span>`;
            }
            paginationHTML += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
        }
        
        // 下一页
        paginationHTML += `
            <button class="page-btn" ${currentPage >= totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">
                下一页
            </button>
        `;
        
        this.pagination.innerHTML = paginationHTML;
        
        // 绑定分页按钮事件
        document.querySelectorAll('.page-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const page = parseInt(e.target.dataset.page);
                if (page && page !== this.currentPage) {
                    this.currentPage = page;
                    this.render();
                    
                    // 滚动到顶部
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
        });
    }
    
    // HTML转义
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 初始化划线记录管理器
document.addEventListener('DOMContentLoaded', () => {
    new UnderlineManager();
});