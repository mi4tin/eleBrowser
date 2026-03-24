# 书签栏功能说明

## 功能概述
在浏览器地址栏下方添加了一个横向的书签栏，用于快速访问常用书签和文件夹。

## 位置
- 位于地址栏下方
- 占据浏览器整个宽度
- 高度为 50px

## 技术架构（重要）
**书签栏采用独立的 WebContentsView 实现**，而不是直接嵌入主页面中。这样做的原因是：
- **避免遮挡问题**：如果使用 HTML 元素直接放在 index.html 中，会被 BrowserView 遮挡
- **独立渲染**：书签栏作为独立的视图层，不会被网页内容覆盖
- **统一管理**：与其他 WebContentsView（如搜索面板、历史记录）保持一致的架构

### 组件结构
```
主窗口 (BrowserWindow)
├── 主页面 (index.html) - 地址栏、标签栏
├── 书签栏 View (WebContentsView) ← 独立视图层
│   └── bookmark-bar.html
└── 浏览器 View (WebContentsView) - 网页内容
    └── 各种网站页面
```

## 展示内容
书签栏以横向滚动的方式展示所有书签和文件夹：

### 文件夹
- 使用 📁 图标
- 渐变背景（灰蓝色）
- 点击打开书签管理页面
- 显示文件夹名称

### 书签
- 使用自定义 favicon 图标（如 🛒、🔵、🟢 等）
- 白色渐变背景
- 点击直接在当前标签页打开网址
- 显示书签标题

## 样式特点
- **横向滚动**：当书签数量过多时，可以左右滚动查看
- **悬停效果**：鼠标悬停时卡片会上浮并显示阴影
- **响应式**：每个书签卡片最大宽度 200px，最小宽度根据内容自适应
- **美观性**：采用与书签管理页面一致的设计风格

## 数据来源
- 从本地书签数据文件加载
- 与书签管理页面共享同一数据源
- 支持默认书签数据（包含生活、世界消息、天气等分类）

## 交互说明

### 点击书签
直接在当前浏览器窗口打开该网址

### 点击文件夹
打开书签管理页面（未来可支持直接展开子文件夹）

### 右键菜单
预留了右键菜单接口，未来可扩展编辑、删除等功能

## 技术实现

### 文件结构
```
html/bookmark-bar/
├── bookmark-bar.html      # 书签栏页面
├── bookmark-bar.css       # 书签栏样式
└── bookmark-bar.js        # 书签栏逻辑
```

### HTML 结构（bookmark-bar.html）
```html
<div class="bookmark-bar" id="bookmarkBar">
    <div class="bookmark-bar-scroll">
        <div class="bookmark-bar-content" id="bookmarkBarContent"></div>
    </div>
</div>
```

### CSS 关键样式（bookmark-bar.css）
- `.bookmark-bar`：容器，高度 50px
- `.bookmark-bar-scroll`：可横向滚动区域
- `.bookmark-bar-content`：flex 布局，横向排列所有书签项
- `.bookmark-bar-item`：单个书签/文件夹卡片

### JavaScript 逻辑（bookmark-bar.js）
1. `loadBookmarkBarData()`：从 IPC 加载书签数据
2. `collectAllItems()`：扁平化收集所有书签和文件夹
3. `renderBookmarkBar()`：渲染书签栏 UI
4. 事件监听：点击、右键等交互处理

### 主进程集成（main.js）
1. **创建函数**：`createBookmarkBarView(window)` - 创建书签栏 WebContentsView
2. **更新函数**：`updateBookmarkBarBounds(window)` - 窗口大小改变时更新位置
3. **IPC 处理器**：
   - `open-bookmark-url`：处理书签点击打开 URL
   - `open-bookmarks-manager`：处理文件夹点击打开书签管理器

### 渲染进程集成（index.js）
- 监听 `open-bookmarks-manager` 事件，打开书签管理标签页

## 默认书签数据
- 生活 > 美食
- 生活 > 购物 > 淘宝
- 世界消息 > 彭博社（2 条新闻）
- 世界消息 > 路透社
- 天气/气象 > 中国天气网
- 出行工具
- 家庭卫生

## 未来扩展
1. 支持拖拽排序
2. 右键菜单（编辑、删除、重命名）
3. 文件夹展开功能（无需跳转到书签管理页面）
4. 添加书签到收藏夹
5. 书签导入/导出
6. 自定义书签栏显示/隐藏
