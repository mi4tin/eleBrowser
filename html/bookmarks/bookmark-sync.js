// ipcRenderer依赖外部其它js

// 书签同步模块
class BookmarkSync {
    constructor(bookmarksTreeRef) {
        this.bookmarksTreeRef = bookmarksTreeRef;
        this.syncVersion = 0;
        this.lastSyncTime = 0;
        this.isSyncing = false;
        this.deviceId = null; // 设备ID现在从主进程获取
        this.changes = []; // 变更记录现在主要在主进程管理
        this.lastSyncSnapshot = null;
        
        // 从主进程加载初始状态
        this.loadSyncStateFromMain();
    }
    
    //重载数据与状态
    reloadData(bookmarksTreeRef) {
        this.bookmarksTreeRef = bookmarksTreeRef;
        this.loadSyncStateFromMain();
    }

    // 从主进程加载同步状态
    async loadSyncStateFromMain() {
        try {
            const result = await ipcRenderer.invoke('get-sync-state');
            if (result && result.success) {
                this.syncVersion = result.data.syncVersion || 0;
                this.lastSyncTime = result.data.lastSyncTime || 0;
                this.deviceId = result.data.deviceId;
            }
        } catch (error) {
            console.error('从主进程加载同步状态失败:', error);
        }
    }

    mergeBookmarks(localList, cloudList) {
        const itemMap = new Map();
        
        // 第一步：先处理本地数据
        for (const item of localList) {
            itemMap.set(item.parentId+'-'+item.localId, { ...item });
        }
        
        // 第二步：处理云端数据，根据合并策略
        for (const item of cloudList) {
            const existing = itemMap.get(item.parentId+'-'+item.localId);
            
            if (existing) {
                // 同一书签存在，比较版本
                // 策略：保留最新版本，相同版本保留本地的
                const localVersion = existing.syncVersion || 0;
                const cloudVersion = item.syncVersion || 0;
                
                if (cloudVersion > localVersion) {
                    // 云端版本更新，替换本地
                    itemMap.set(item.parentId+'-'+item.localId, { ...item });
                }
                // 否则保留本地的，不需要操作
            } else {
                // 云端新增的项目，直接添加
                itemMap.set(item.parentId+'-'+item.localId, { ...item });
            }
        }
        
        // 第三步：转换为合并后的扁平数组
        const mergeFlat = Array.from(itemMap.values());
        
        // 第四步：重建树结构
        const mergeTree = this.unflattenTree(mergeFlat);
        
        return {
            flat: mergeFlat,
            tree: mergeTree,
        };
    }
    
    // 扁平化树结构用于上传（不上传root节点）
    flattenTree(tree, parentId = null, result = [], parentIndex = 0) {
        // 如果是root节点，跳过不上传，直接处理子节点
        if (tree.id === 'root') {
            // 处理子项目
            if (tree.items && tree.items.length > 0) {
                tree.items.forEach((child, index) => {
                    child.orderIndex = index;
                    this.flattenTree(child, 'root', result, index);
                });
            }
            return result;
        }
        
        // 确保每个项目都有本地ID
        const localId = tree.id || this.generateBookmarkId(tree.url||tree.title);//文件夹只有title
        
        const item = {
            localId: localId,
            parentId: parentId,
            type: tree.type,
            title: tree.title,
            url: tree.url || '',
            favicon: tree.favicon || '',
            orderIndex: tree.orderIndex !== undefined ? tree.orderIndex : parentIndex,
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
        const rootItems = []; // 直接挂载到 root 下的项目

        // 先把所有节点放入map
        flatList.forEach(item => {
            map[item.localId] = {
                id: item.localId,
                type: item.type,
                // 对于文件夹，同时设置 title 和 name 字段
                title: item.title,
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
            if (item.parentId && item.parentId !== '' && map[item.parentId]) {
                // 有有效的父节点，挂载到父节点下
                map[item.parentId].items.push(map[item.localId]);
            } else if (item.localId !== 'root') {
                // parentId 为空或无效，且不是 root 本身，挂载到 root 下
                rootItems.push(map[item.localId]);
            }
        });

        // 按orderIndex排序
        const sortItems = (node) => {
            if (node.items && node.items.length > 0) {
                node.items.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
                node.items.forEach(sortItems);
            }
        };
        Object.values(map).forEach(sortItems);
        rootItems.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));

        // 创建或获取 root 节点
        let root = map['root'] || {
            id: 'root',
            type: 'folder',
            title: '书签',
            items: []
        };
        
        // 将 rootItems 挂载到 root 下
        root.items = rootItems;
        
        return root;
    }

    // 生成书签ID
    generateBookmarkId(url) {
        return this.murmur3(url);
    }

    //生成一个长度低于32位的字符串，但速度比md5快很多，见https://chat.deepseek.com/a/chat/s/6bdfbb63-2851-49b3-9114-86ee43f54304
    murmur3(str, seed = 0) {
        let h1 = seed | 0;
        const c1 = 0xcc9e2d51, c2 = 0x1b873593;
        
        for (let i = 0; i < str.length; i++) {
            let k1 = str.charCodeAt(i);
            k1 = Math.imul(k1, c1);
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 = Math.imul(k1, c2);
            h1 ^= k1;
            h1 = (h1 << 13) | (h1 >>> 19);
            h1 = Math.imul(h1, 5) + 0xe6546b64 | 0;
        }
        
        h1 ^= str.length;
        h1 ^= h1 >>> 16;
        h1 = Math.imul(h1, 0x85ebca6b);
        h1 ^= h1 >>> 13;
        h1 = Math.imul(h1, 0xc2b2ae35);
        h1 ^= h1 >>> 16;
        
        return (h1 >>> 0).toString(36);
    }

    // 记录变更（在书签修改时调用）
    async recordChange(operation, item, parentId = null, token = null) {
        console.log('记录变更（渲染进程）:', operation, item, parentId);
        
        // 调用主进程记录变更
        ipcRenderer.send('record-bookmark-change', operation, item, parentId);
        
        // 监听一次回复（非阻塞）
        ipcRenderer.once('record-bookmark-change-reply', () => {
            console.log('主进程已记录变更');
        });
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
            // 从主进程获取扁平化的书签数据
            const flatResult = await ipcRenderer.invoke('get-flat-bookmarks');
            const flatList = flatResult?.data || [];
            
            const result = await ipcRenderer.invoke('upload-bookmarks', {
                token: token,
                bookmarks: flatList,
                syncVersion: this.syncVersion,
                deviceId: this.deviceId
            });
            
            if (result && result.success) {
                console.log('上传成功');
                // 更新主进程版本和清空变更
                await ipcRenderer.invoke('update-sync-version', this.syncVersion);
                await ipcRenderer.invoke('clear-bookmark-changes');
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

    // 加载用户数据
async  getUserData() {
    try {
        const result = await ipcRenderer.invoke('load-user-data');
        console.log('加载用户数据结果:', result);
        if (result && result.success) {
            let currentUser = null;
            if (result.data) {
                // 旧格式：直接返回用户数据
                console.log('加载用户数据成功:', result.data);
                currentUser = result.data;
            } else if (result.user) {
                // 新格式：在 user 字段中
                console.log('加载用户数据成功:', result.user);
                currentUser = result.user;
            }
            return currentUser;
        }
    } catch (error) {
        console.error('加载用户数据失败:', error);
    }
     return null;
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
                
                // 更新主进程状态
                await ipcRenderer.invoke('update-sync-version', this.syncVersion);
                await ipcRenderer.invoke('clear-bookmark-changes');
                
                // 刷新本地状态
                await this.loadSyncStateFromMain();
                
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
// let ipcRenderer;
// if (typeof window !== 'undefined' && window.electronAPI) {
//     ipcRenderer = window.electronAPI;
// } else {
//     try {
//         const electron = require('electron');
//         ipcRenderer = electron.ipcRenderer;
//     } catch (e) {
//         console.error('无法加载 electron 模块:', e);
//         ipcRenderer = {
//             invoke: function () { return Promise.resolve(null); }
//         };
//     }
// }

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BookmarkSync;
}
