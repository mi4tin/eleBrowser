// 历史记录管理类
class HistoryManager {
    constructor() {
        this.historyData = [];
        this.currentPage = 1;
        this.itemsPerPage = 20;
        
        this.initElements();
        this.bindEvents();
        this.loadHistoryAsync(); // 异步加载历史记录
    }
    
    initElements() {
        this.searchInput = document.getElementById('searchInput');
        this.clearHistoryBtn = document.getElementById('clearHistoryBtn');
        this.refreshBtn = document.getElementById('refreshBtn');
        this.historyList = document.getElementById('historyList');
        this.pagination = document.getElementById('pagination');
    }
    
    bindEvents() {
        this.searchInput.addEventListener('input', this.debounce(() => {
            this.currentPage = 1;
            this.render();
        }, 300));
        
        this.clearHistoryBtn.addEventListener('click', () => {
            if (confirm('确定要清空所有历史记录吗？此操作不可撤销。')) {
                this.clearHistory();
            }
        });
        
        this.refreshBtn.addEventListener('click', () => {
            this.loadHistoryAsync();
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
    
    // 异步加载历史记录（从主进程或本地存储）
    async loadHistoryAsync() {
        try {
            // 尝试从主进程加载历史记录，优先使用 preload 暴露的 window.electronAPI
            let ipcRenderer;
            if (typeof window !== 'undefined' && window.electronAPI) {
                ipcRenderer = window.electronAPI;
            } else {
                try { ipcRenderer = require('electron').ipcRenderer; } catch (e) { ipcRenderer = null; }
            }

            if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
                try {
                    const historyData = await ipcRenderer.invoke('get-history');
                    if (Array.isArray(historyData)) {
                        this.historyData = historyData;
                    } else {
                        this.historyData = this.loadHistoryFromLocalStorage();
                    }
                } catch (fileErr) {
                    console.warn('从主进程获取历史记录失败:', fileErr);
                    this.historyData = this.loadHistoryFromLocalStorage();
                }
            } else {
                // 回退到localStorage
                this.historyData = this.loadHistoryFromLocalStorage();
            }
        } catch (e) {
            console.error('加载历史记录失败:', e);
            this.historyData = [];
        }
        
        this.render();
    }
    
    // 从localStorage加载历史记录
    loadHistoryFromLocalStorage() {
        try {
            const stored = localStorage.getItem('browser_history');
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.error('从localStorage加载历史记录失败:', e);
            return [];
        }
    }
    
    // 保存历史记录到localStorage
    saveHistory() {
        try {
            localStorage.setItem('browser_history', JSON.stringify(this.historyData));
        } catch (e) {
            console.error('保存历史记录失败:', e);
        }
    }
    
    // 添加历史记录
    addHistory(title, url) {
        const now = new Date();
        const historyItem = {
            id: Date.now() + Math.random(), // 生成唯一ID
            title: title || url,
            url: url,
            timestamp: now.getTime(),
            date: now.toLocaleDateString(),
            time: now.toLocaleTimeString()
        };
        
        // 检查是否已存在相同的URL（避免重复）
        const existingIndex = this.historyData.findIndex(item => item.url === url);
        if (existingIndex !== -1) {
            // 如果存在，则移除旧记录（将其移到最前面）
            this.historyData.splice(existingIndex, 1);
        }
        
        // 将新记录添加到开头
        this.historyData.unshift(historyItem);
        
        // 只保留最近的1000条记录
        if (this.historyData.length > 1000) {
            this.historyData = this.historyData.slice(0, 1000);
        }
        
        this.saveHistory();
        return historyItem;
    }
    
    // 删除历史记录
    removeHistory(id) {
        this.historyData = this.historyData.filter(item => item.id !== id);
        this.saveHistory();
        
        // 如果在Electron环境中，也要通知主进程同步删除
        let ipcRenderer;
        if (typeof window !== 'undefined' && window.electronAPI) {
            ipcRenderer = window.electronAPI;
        } else {
            try { ipcRenderer = require('electron').ipcRenderer; } catch (e) { ipcRenderer = null; }
        }
        if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
            ipcRenderer.invoke('remove-history-item', id).catch(err => console.error('通知主进程删除历史记录失败:', err));
        }
    }
    
    // 清空历史记录
    async clearHistory() {
        this.historyData = [];
        this.saveHistory();
        
        // 如果在Electron环境中，也要清空主进程的记录
        let ipcRenderer;
        if (typeof window !== 'undefined' && window.electronAPI) {
            ipcRenderer = window.electronAPI;
        } else {
            try { ipcRenderer = require('electron').ipcRenderer; } catch (e) { ipcRenderer = null; }
        }
        if (ipcRenderer && typeof ipcRenderer.invoke === 'function') {
            try {
                await ipcRenderer.invoke('clear-history');
            } catch (e) {
                console.error('清空主进程历史记录失败:', e);
            }
        }
        
        this.render();
    }
    
    // 搜索历史记录
    searchHistory(keyword) {
        if (!keyword) return this.historyData;
        
        const lowerKeyword = keyword.toLowerCase();
        return this.historyData.filter(item => 
            item.title.toLowerCase().includes(lowerKeyword) || 
            item.url.toLowerCase().includes(lowerKeyword)
        );
    }
    
    // 获取分页数据
    getPagedHistory(searchResults) {
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
    
    // 渲染历史记录列表
    render() {
        const keyword = this.searchInput.value.trim();
        const searchResults = this.searchHistory(keyword);
        const pagedData = this.getPagedHistory(searchResults);
        
        if (pagedData.items.length === 0) {
            this.historyList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">⏱️</div>
                    <div>${keyword ? '未找到匹配的历史记录' : '暂无历史记录'}</div>
                    ${keyword ? `<div style="margin-top: 8px; font-size: 14px; color: #999;">搜索词："${keyword}"</div>` : ''}
                </div>
            `;
            this.pagination.innerHTML = '';
            return;
        }
        
        const historyHTML = pagedData.items.map((item, index) => `
            <div class="history-item" data-id="${item.id}">
                <div class="item-favicon">
                    <img src="${this.getFaviconUrl(item.url)}" alt="" onerror="this.style.display='none';" />
                </div>
                <div class="item-info open-btn">
                    <div class="item-title">${this.escapeHtml(item.title)}</div>
                    <div class="item-url">${this.escapeHtml(item.url)}</div>
                </div>
                <div class="item-time">
                    <div>${item.date}</div>
                    <div>${item.time}</div>
                </div>
                <div class="item-actions">
                    <button class="action-btn open-btn" title="在新标签页打开">打开</button>
                    <button class="action-btn delete-btn" title="删除记录">删除</button>
                </div>
            </div>
        `).join('');
        
        this.historyList.innerHTML = historyHTML;
        
        // 绑定项目事件
        this.bindItemEvents();
        
        // 渲染分页
        this.renderPagination(pagedData.totalPages, pagedData.currentPage);
    }
    
    // 绑定项目事件
    bindItemEvents() {
        // 打开链接事件
        document.querySelectorAll('.open-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                console.log('Opening link...');
                const item = e.target.closest('.history-item');
                const id = item.dataset.id;
                const historyItem = this.historyData.find(h => h.id == id);
                
                if (historyItem) {
                    // 通知父窗口打开链接
                    // 优先使用 preload 暴露的 API
                    let ipcRenderer;
                    if (typeof window !== 'undefined' && window.electronAPI) {
                        ipcRenderer = window.electronAPI;
                    } else {
                        try { ipcRenderer = require('electron').ipcRenderer; } catch (e) { ipcRenderer = null; }
                    }
                    if (ipcRenderer && typeof ipcRenderer.send === 'function') {
                        ipcRenderer.send('open-url-in-new-tab', historyItem.url);
                    } else {
                        window.open(historyItem.url, '_blank');
                    }
                }
            });
        });
        
        // 删除记录事件
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const item = e.target.closest('.history-item');
                const id = item.dataset.id;
                
                if (confirm('确定要删除这条历史记录吗？')) {
                    this.removeHistory(parseFloat(id));
                    this.render();
                }
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
    
    // 获取网站favicon URL
    getFaviconUrl(url) {
        try {
            const urlObj = new URL(url);
            return `${urlObj.origin}/favicon.ico`;
        } catch (e) {
            // 如果URL解析失败，返回一个默认的favicon
            return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23ccc"/><text x="8" y="12" font-size="10" text-anchor="middle" fill="%23666">🌐</text></svg>';
        }
    }

    // HTML转义
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 初始化历史记录管理器
document.addEventListener('DOMContentLoaded', () => {
    new HistoryManager();
});