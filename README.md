## 项目概览：eleBrowser

这是一个基于 **Electron v41** 构建的**功能完整的现代网页浏览器**，项目位于 `h:/Self/SRC/gitee.com/mistin/eleBrowser/`。

### 核心架构

采用经典 Electron 三层架构：

| 层 | 关键文件 | 职责 |
|---|---|---|
| **主进程** | `main.js` + `main/` 目录 | 窗口管理、标签页创建、IPC 处理、划线、密码管理 |
| **预加载脚本** | `preload-*.js`（6个） | 通过 `contextBridge` 暴露受限 API 给渲染进程 |
| **渲染进程** | `html/` 目录（78个文件） | 主界面、标签栏、地址栏、书签栏等 UI |

### 关键技术实现

- **多标签页**：使用 Electron 的 `WebContentsView` API（非过时的 `BrowserView`）
- **无框窗口**：`frame: false` + 自定义标题栏 + Windows `titleBarOverlay`
- **通信**：通过 `ipcMain.handle()` / `ipcMain.on()` + `ipcRenderer` 双向通信
- **技术栈**：纯原生 JavaScript（无前端框架），无打包工具依赖

### 主要功能

1. **多标签页浏览** — 创建/切换/关闭标签页，支持拖拽排序、外部 URL 拖入
2. **地址栏导航** — URL 输入、历史自动补全（独立 WebContentsView 渲染）、后退/前进/刷新
3. **书签管理** — 书签栏、文件夹下拉菜单、拖拽排序/移动、云同步
4. **划线功能** — 选中文本添加下划线标注，持久化存储，刷新后自动恢复
5. **密码管理器** — 自动检测登录表单、拦截提交、保存/自动填充密码
6. **下载管理** — 完整的下载面板，支持暂停/继续/取消
7. **页面内搜索** — Ctrl+F 触发，独立的搜索面板 WebContentsView
8. **历史记录** — 自动记录、地址栏自动补全、独立管理页面
9. **SSL/安全** — SSL 警告页面、自定义 User-Agent 伪装 Chrome、协议拦截
10. **用户系统** — 登录、个人中心、云同步

### 项目规模

- 主进程核心模块约 19 个 JS 文件
- 渲染进程 78 个文件（37 个 HTML、18 个 JS、11 个 CSS）
- 最大的模块 `main/underlineContextMenu.js` 约 80KB

