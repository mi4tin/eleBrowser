// 书签同步模块
class BookmarkSync {
    constructor(bookmarksTreeRef) {
        this.bookmarksTreeRef = bookmarksTreeRef;
        this.syncVersion = 0;
        this.lastSyncTime = 0;
        this.isSyncing = false;
        this.deviceId = this.generateDeviceId();
        this.changes = []; // 本地变更记录
        this.lastSyncSnapshot = null; // 上次同步时的快照
        
        // 加载同步状态
        this.loadSyncState();
    }

    // 生成设备ID
    generateDeviceId() {
        let id = localStorage.getItem('deviceId');
        if (!id) {
            id = 'device-' + Math.random().toString(36).slice(2, 10);
            localStorage.setItem('deviceId', id);
        }
        return id;
    }

    // 加载同步状态
    loadSyncState() {
        try {
            const state = localStorage.getItem('bookmarkSyncState');
            if (state) {
                const parsed = JSON.parse(state);
                this.syncVersion = parsed.syncVersion || 0;
                this.lastSyncTime = parsed.lastSyncTime || 0;
                this.lastSyncSnapshot = parsed.snapshot || null;
            }
        } catch (error) {
            console.error('加载同步状态失败:', error);
        }
    }

    // 保存同步状态
    saveSyncState() {
        try {
            const state = {
                syncVersion: this.syncVersion,
                lastSyncTime: this.lastSyncTime,
                snapshot: this.lastSyncSnapshot
            };
            localStorage.setItem('bookmarkSyncState', JSON.stringify(state));
        } catch (error) {
            console.error('保存同步状态失败:', error);
        }
    }

    // 扁平化树结构用于上传
    flattenTree(tree, parentId = null, result = []) {
        // 确保每个项目都有本地ID
        const localId = tree.id || this.generateLocalId();
        
        const item = {
            localId: localId,
            parentId: parentId,
            type: tree.type,
            title: tree.type === 'folder' ? tree.name : tree.title,
            url: tree.url || '',
            favicon: tree.favicon || '',
            orderIndex: 0, // 后续会根据位置设置
            syncVersion: this.syncVersion,
            isDeleted: false
        };
        
        // 确保树结构中有id
        if (!tree.id) {
            tree.id = localId;
        }
        
        result.push(item);
        
        // 处理子项目
        if (tree.items && tree.items.length > 0) {
            tree.items.forEach((child, index) => {
                child.orderIndex = index;
                this.flattenTree(child, localId, result);
            });
        }
        
        return result;
    }

    // 从扁平化列表重建树结构
    unflattenTree(flatList) {
        const map = {};
        const roots = [];

        // 先把所有节点放入map
        flatList.forEach(item => {
            map[item.localId] = {
                id: item.localId,
                type: item.type,
                name: item.type === 'folder' ? item.title : undefined,
                title: item.type === 'bookmark' ? item.title : undefined,
                url: item.url,
                favicon: item.favicon,
                syncVersion: item.syncVersion,
                lastModified: Date.now(),
                isDeleted: item.isDeleted,
                orderIndex: item.orderIndex,
                items: []
            };
        });

        // 构建树形关系
        flatList.forEach(item => {
            if (item.parentId && map[item.parentId]) {
                map[item.parentId].items.push(map[item.localId]);
            } else {
                roots.push(map[item.localId]);
            }
        });

        // 按orderIndex排序
        const sortItems = (node) => {
            if (node.items && node.items.length > 0) {
                node.items.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
                node.items.forEach(sortItems);
            }
        };
        roots.forEach(sortItems);

        // 返回第一个根节点（应该是root）
        return roots.find(r => r.id === 'root') || roots[0] || {
            id: 'root',
            type: 'folder',
            name: '书签',
            items: []
        };
    }

    // 生成本地ID
    generateLocalId() {
        return 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    }

    // 记录变更（在书签修改时调用）
    recordChange(operation, item, parentId = null) {
        const change = {
            localId: item.id || this.generateLocalId(),
            parentId: parentId,
            type: item.type,
            title: item.type === 'folder' ? item.name : item.title,
            url: item.url || '',
            favicon: item.favicon || '',
            operation: operation, // 'add', 'update', 'delete'
            timestamp: Date.now()
        };
        
        this.changes.push(change);
        
        // 确保item有id
        if (!item.id) {
            item.id = change.localId;
        }
    }

    // 计算与上次同步的差异
    calculateChanges() {
        if (!this.lastSyncSnapshot) {
            // 第一次同步，全量上传
            return {
                type: 'full',
                data: this.flattenTree(this.bookmarksTreeRef)
            };
        }
        
        // 对比差异
        const changes = [];
        const findChanges = (current, old, parentId = null) => {
            // 实现差异比较逻辑
            // 这部分比较复杂，暂时简化处理
        };
        
        return {
            type: 'incremental',
            data: this.changes
        };
    }

    // 完整上传书签
    async uploadBookmarks(token) {
        try {
            const flatList = this.flattenTree(this.bookmarksTreeRef);
            
            const result = await ipcRenderer.invoke('upload-bookmarks', {
                token: token,
                bookmarks: flatList,
                syncVersion: this.syncVersion,
                deviceId: this.deviceId
            });
            
            if (result && result.success) {
                console.log('上传成功');
                // 更新快照
                this.lastSyncSnapshot = JSON.parse(JSON.stringify(this.bookmarksTreeRef));
                this.changes = [];
                this.saveSyncState();
                return true;
            } else {
                console.error('上传失败:', result);
                return false;
            }
        } catch (error) {
            console.error('上传书签失败:', error);
            return false;
        }
    }

    // 增量同步
    async syncBookmarks(token) {
        if (this.isSyncing) {
            console.log('同步已在进行中');
            return false;
        }
        
        this.isSyncing = true;
        
        try {
            // 收集本地变更
            const localChanges = this.changes.length > 0 ? this.changes.map(c => ({
                localId: c.localId,
                parentId: c.parentId,
                type: c.type,
                title: c.title,
                url: c.url,
                favicon: c.favicon,
                syncVersion: this.syncVersion,
                isDeleted: c.operation === 'delete'
            })) : [];
            
            // 调用同步接口
            const result = await ipcRenderer.invoke('sync-bookmarks', {
                token: token,
                localVersion: this.syncVersion,
                changes: localChanges,
                deviceId: this.deviceId
            });
            
            if (result && result.success) {
                const data = result.data;
                
                // 更新服务器版本
                if (data.serverVersion !== undefined) {
                    this.syncVersion = data.serverVersion;
                }
                
                // 应用服务器变更
                if (data.hasChanges && data.changes) {
                    this.applyServerChanges(data.changes);
                }
                
                // 清空本地变更
                this.changes = [];
                
                // 更新快照
                this.lastSyncSnapshot = JSON.parse(JSON.stringify(this.bookmarksTreeRef));
                this.lastSyncTime = Date.now();
                
                // 保存状态
                this.saveSyncState();
                
                console.log('同步成功');
                return true;
            } else {
                console.error('同步失败:', result);
                return false;
            }
        } catch (error) {
            console.error('同步书签失败:', error);
            return false;
        } finally {
            this.isSyncing = false;
        }
    }

    // 应用服务器变更
    applyServerChanges(serverChanges) {
        // 这里需要实现合并逻辑
        // 简单起见，我们先下载完整数据
        console.log('应用服务器变更:', serverChanges);
    }

    // 下载书签
    async downloadBookmarks(token) {
        try {
            const result = await ipcRenderer.invoke('download-bookmarks', {
                token: token
            });
            
            if (result && result.success) {
                const data = result.data;
                
                // 更新版本
                if (data.version !== undefined) {
                    this.syncVersion = data.version;
                }
                
                // 重建树结构
                if (data.bookmarks && data.bookmarks.length > 0) {
                    const newTree = this.unflattenTree(data.bookmarks);
                    
                    // 替换当前树
                    Object.assign(this.bookmarksTreeRef, newTree);
                }
                
                // 更新快照
                this.lastSyncSnapshot = JSON.parse(JSON.stringify(this.bookmarksTreeRef));
                this.lastSyncTime = Date.now();
                this.changes = [];
                
                // 保存状态
                this.saveSyncState();
                
                console.log('下载成功');
                return true;
            } else {
                console.error('下载失败:', result);
                return false;
            }
        } catch (error) {
            console.error('下载书签失败:', error);
            return false;
        }
    }

    // 获取最新版本
    async getLatestVersion(token) {
        try {
            const result = await ipcRenderer.invoke('get-bookmarks-version', {
                token: token
            });
            
            if (result && result.success) {
                return result.data.version || 0;
            }
            return 0;
        } catch (error) {
            console.error('获取版本失败:', error);
            return 0;
        }
    }

    // 检查是否有新的同步数据
    async checkForUpdates(token) {
        const latestVersion = await this.getLatestVersion(token);
        return latestVersion > this.syncVersion;
    }
}

// 安全地获取 electron API
let ipcRenderer;
if (typeof window !== 'undefined' && window.electronAPI) {
    ipcRenderer = window.electronAPI;
} else {
    try {
        const electron = require('electron');
        ipcRenderer = electron.ipcRenderer;
    } catch (e) {
        console.error('无法加载 electron 模块:', e);
        ipcRenderer = {
            invoke: function () { return Promise.resolve(null); }
        };
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BookmarkSync;
}
