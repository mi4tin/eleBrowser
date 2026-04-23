# 书签云同步功能实现说明

## 概述

本文档说明书签云同步功能的实现，包括 beta 后端 API 接口和 eleBrowser 前端功能。

## 目录结构

### Beta 后端

```
beta/src/bll/auth/
├── models/auth.go       # 数据模型定义
├── store/store.go       # 数据存储操作
├── bll/bll.go           # 业务逻辑
└── handlers/handlers.go # HTTP接口处理器
beta/
└── init_auth.sql        # 数据库初始化脚本
```

### eleBrowser 前端

```
eleBrowser/
├── main/ipcHandlers/
│   └── login.js         # IPC处理器（含书签同步）
└── html/
    ├── profile/
    │   └── sync.js      # 同步界面逻辑
    └── bookmarks/
        └── bookmark-sync.js # 书签同步模块（可扩展）
```

## 数据库设计

### 1. 书签表 (bookmarks)

| 字段            | 类型       | 说明                 |
| ------------- | -------- | ------------------ |
| id            | bigint   | 主键                 |
| user\_id      | bigint   | 用户ID               |
| local\_id     | varchar  | 本地ID               |
| parent\_id    | varchar  | 父文件夹ID             |
| type          | varchar  | 类型：folder/bookmark |
| title         | varchar  | 标题                 |
| url           | varchar  | URL（仅书签）           |
| favicon       | varchar  | 图标                 |
| order\_index  | int      | 排序                 |
| sync\_version | bigint   | 同步版本               |
| is\_deleted   | tinyint  | 软删除标记              |
| created\_at   | datetime | 创建时间               |
| updated\_at   | datetime | 更新时间               |

### 2. 同步记录表 (sync\_records)

| 字段            | 类型       | 说明   |
| ------------- | -------- | ---- |
| id            | bigint   | 主键   |
| user\_id      | bigint   | 用户ID |
| data\_type    | varchar  | 数据类型 |
| sync\_version | bigint   | 同步版本 |
| sync\_time    | datetime | 同步时间 |
| operation     | varchar  | 操作类型 |
| device\_id    | varchar  | 设备ID |
| change\_count | int      | 变更数量 |

## API 接口

### 1. 上传书签 (POST /api/bookmarks/upload)

请求参数：

```json
{
    "token": "用户token",
    "bookmarks": [
        {
            "local_id": "唯一标识",
            "parent_id": "父文件夹ID",
            "type": "folder",
            "title": "文件夹名称",
            "sync_version": 1
        }
    ],
    "sync_version": 1,
    "device_id": "设备ID"
}
```

### 2. 同步书签 (POST /api/bookmarks/sync)

请求参数：

```json
{
    "token": "用户token",
    "localVersion": 1,
    "changes": [],
    "device_id": "设备ID"
}
```

响应：

```json
{
    "serverVersion": 2,
    "hasChanges": true,
    "changes": []
}
```

### 3. 下载书签 (POST /api/bookmarks/download)

请求参数：

```json
{
    "token": "用户token"
}
```

响应：

```json
{
    "version": 2,
    "bookmarks": []
}
```

### 4. 获取版本 (POST /api/bookmarks/getVersion)

请求参数：

```json
{
    "token": "用户token"
}
```

响应：

```json
{
    "version": 2
}
```

## 前端功能

### 1. IPC 通信 (login.js)

功能列表：

- `upload-bookmarks` - 上传书签
- `sync-bookmarks` - 同步书签
- `download-bookmarks` - 下载书签
- `get-bookmarks-version` - 获取版本
- `request-bookmarks-data` - 请求书签数据
- `save-bookmarks-data` - 保存书签数据

**自动同步机制：**

- 浏览器启动时自动检查是否有已登录用户并启动自动同步
- 用户登录成功后自动启动同步
- 每30分钟自动同步一次
- 书签变更后10秒内自动同步一次
- 静默同步，不打扰用户

### 2. 同步界面 (sync.js & sync.html)

功能列表：

- 用户登录状态检测
- 立即同步按钮
- 同步设置（书签、历史、密码、设置、备份）
- 显示最后同步时间
- 通知提示

**智能同步流程：**

1. 获取服务器版本号
2. 如果服务器版本号是0，说明是首次同步，需要上传本地完整书签
3. 如果服务器版本号大于本地版本号，说明有差异，提供用户界面选择：
   - 合并：合并云端和本地变更
   - 云端优先：使用云端数据覆盖本地
   - 本地优先：使用本地数据覆盖云端
   - 暂不同步：不进行任何操作
4. 如果服务器版本号等于本地版本号，则增量同步

**冲突解决界面：

提供美观的模态框，让用户选择同步策略

### 3. 书签同步模块 (bookmark-sync.js)

包含 BookmarkSync 类，功能：

- 扁平化/树结构转换
- 变更跟踪
- 上传/下载/同步操作

## 使用流程

### 首次使用

1. 用户在 eleBrowser 中登录
2. 进入「个人中心 - 云同步」页面
3. 点击「立即同步」
4. 系统检测为首次同步，自动上传本地完整书签
5. 同步完成后显示成功提示

### 日常使用

1. 用户在 eleBrowser 中登录后，系统自动启动同步机制
2. 每30分钟或书签变更后10秒内，系统自动静默同步
3. 用户也可以随时点击「立即同步」手动触发
4. 如果发现云端有更新，系统会弹出冲突解决界面供用户选择

### 冲突解决

当发现云端数据有更新时，系统会弹出模态框，提供以下选项：

- **合并**：合并云端和本地变更（云端优先，同时保留本地新增内容）
- **云端优先**：使用云端数据完全覆盖本地
- **本地优先**：使用本地数据完全覆盖云端
- **暂不同步**：取消同步操作

## 部署说明

### Beta 后端

1. 执行 `init_auth.sql` 创建数据库表
2. 确保 beta 服务运行在 `http://localhost:8011`
3. 确保 MySQL 数据库正常运行

### eleBrowser 前端

1. 确保 beta 服务正常运行
2. 用户登录后即可使用云同步功能

## 已实现功能

- ✅ 完整的 API 接口（上传、下载、同步、获取版本）
- ✅ 首次同步检测
- ✅ 增量同步机制
- ✅ 冲突解决界面
- ✅ 自动同步（浏览器启动、定时、变更触发）
- ✅ 扁平化/树结构数据转换
- ✅ 版本管理和同步记录
- ✅ 用户友好的通知提示

## 后续扩展

### 待实现功能

- 📋 历史记录同步
- 📋 密码同步（需加密处理）
- 📋 设置同步
- 📋 更完善的冲突检测和解决
- 📋 同步状态更详细的显示
- 📋 同步历史记录查看
