# 书签栏多级下拉菜单功能实现

## 功能概述

实现了书签栏文件夹的多级级联下拉菜单功能，支持无限层级嵌套。当用户鼠标悬停在文件夹上时，会显示该文件夹的内容；如果内容中包含子文件夹，继续悬停时会显示下一级菜单。

## 核心特性

### 1. 级联显示
- **一级菜单**：点击书签栏文件夹时显示
- **二级菜单**：在一级菜单中悬停子文件夹时显示
- **三级及以上**：递归显示更深层次的文件夹

### 2. 智能清理
- 只显示当前路径上的菜单（父级 → 当前级 → 子级）
- 自动关闭非直接上级的同级菜单
- 避免菜单层级过多导致的混乱

### 3. 交互优化
- **100ms 延迟显示**：避免快速移动时的闪烁
- **激活状态样式**：当前悬停的文件夹项高亮显示
- **箭头指示器**：有子菜单的文件夹显示右箭头 `›`

## 技术实现

### 架构设计

```
主窗口 (index.js)
    ↓ IPC: show-folder-dropdown
主菜单 WebContentsView (bookmarkDropdownView)
    ↓ IPC: show-folder-dropdown-next
子菜单 WebContentsView (subDropdownViews[])
    ↓ IPC: show-folder-dropdown-next
孙菜单 WebContentsView ...
```

### 关键文件

#### 1. `main.js` - 主进程处理

**核心变量：**
```javascript
let bookmarkDropdownView = null;  // 主下拉菜单视图
let subDropdownViews = [];        // 子菜单视图数组
let dropdownFolderId = null;      // 当前显示的文件夹 ID
```

**IPC 处理器：**

1. **`show-folder-dropdown`** - 显示主菜单
   - 创建 `bookmarkDropdownView`
   - 发送文件夹数据到下拉菜单页面

2. **`show-folder-dropdown-next`** - 显示子菜单
   - 检查子菜单是否已存在
   - 创建新的 `WebContentsView` 实例
   - 计算并设置菜单位置（在父菜单右侧）
   - 清理同级旧菜单

3. **`hide-folder-dropdown`** - 隐藏所有菜单
   - 关闭主菜单视图
   - 遍历关闭所有子菜单视图
   - 清空引用数组

#### 2. `dropdown-menu.js` - 下拉菜单页面逻辑

**渲染逻辑：**
```javascript
items.forEach(item => {
    if (item.type === 'folder') {
        // 子文件夹：添加箭头图标和悬停事件
        itemEl.innerHTML = `
            <span class="icon folder-icon">📁</span>
            <span class="label">${escapeHtml(item.name)}</span>
            <span class="arrow">›</span>
        `;
        
        // mouseenter 事件：延迟显示子菜单
        itemEl.addEventListener('mouseenter', () => {
            hoverTimeout = setTimeout(() => {
                ipcRenderer.send('show-folder-dropdown-next', bounds, item);
            }, 100);
            itemEl.classList.add('active');
        });
        
        // mouseleave 事件：清除延时器和激活状态
        itemEl.addEventListener('mouseleave', () => {
            clearTimeout(hoverTimeout);
            itemEl.classList.remove('active');
        });
    }
});
```

#### 3. `dropdown-menu.css` - 样式定义

**新增样式：**
```css
.folder-dropdown-item .arrow {
    font-size: 18px;
    color: #999;
    margin-left: auto;
    transition: all 0.2s;
}

.folder-dropdown-item.active {
    background: #e8f0fe;  /* 浅蓝色背景 */
}

.folder-dropdown-item.active .arrow {
    color: #1a73e8;  /* 蓝色箭头 */
}
```

## 交互流程示例

### 场景：三级文件夹导航

```
书签栏
└── 世界消息 (点击)
    └── 彭博社 (悬停)
        └── 特朗普访华 (点击打开)
```

**步骤分解：**

1. **第一步**：用户点击"世界消息"文件夹
   - 触发：`ipcRenderer.send('show-folder-dropdown', folderData, folderBounds)`
   - 结果：创建 `bookmarkDropdownView`，显示一级菜单

2. **第二步**：鼠标悬停在"彭博社"子文件夹上
   - 触发：`ipcRenderer.send('show-folder-dropdown-next', bounds, item)`
   - 结果：创建第一个 `subDropdownView`，显示二级菜单

3. **第三步**：鼠标移动到"特朗普访华"书签
   - 触发：`click` 事件
   - 结果：`ipcRenderer.send('open-bookmark-url', url)`，打开网页

4. **第四步**：鼠标移到其他同级文件夹（如"路透社"）
   - 触发：清理机制
   - 结果：关闭"彭博社"子菜单，准备显示"路透社"子菜单

## 位置计算

### 主菜单位置
```javascript
const folderBounds = {
    x: rect.left,           // 文件夹元素左侧对齐
    y: rect.bottom,         // 出现在书签栏下方
    width: 300,
    height: 41 * items.length + 16 + 2
};
```

### 子菜单位置
```javascript
const bounds = { 
    x: rect.right,          // 父菜单右侧
    y: rect.top,            // 与悬停项顶部对齐
    width: 300,
    height: Math.max(200, 41 * items.length + 16 + 2)
};
```

## 内存管理

### 销毁机制
```javascript
function hideFolderDropdown(window) {
    // 关闭主菜单
    if (bookmarkDropdownView) {
        window.contentView.removeChildView(bookmarkDropdownView);
        bookmarkDropdownView.webContents.destroy();
        bookmarkDropdownView = null;
    }

    // 关闭所有子菜单
    for (const subMenu of subDropdownViews) {
        window.contentView.removeChildView(subMenu.view);
        subMenu.view.webContents.destroy();
    }
    subDropdownViews = [];
    
    dropdownFolderId = null;
}
```

## 性能优化

1. **延迟显示**：100ms 延迟避免频繁创建/销毁视图
2. **视图复用**：如果子菜单已存在，只更新位置不重新创建
3. **及时清理**：只保留必要层级的菜单视图
4. **透明背景**：使用 `setBackgroundColor('#00000000')` 避免白板闪烁

## 已知问题与改进方向

### 当前限制
- 所有子菜单都使用相同的 HTML 页面 (`dropdown-menu.html`)
- 位置计算未考虑屏幕边界，可能超出可视区域

### 未来优化
1. **屏幕边界检测**：当菜单超出屏幕时自动调整位置
2. **键盘导航**：支持方向键在多级菜单中导航
3. **动画效果**：添加淡入淡出和滑动动画
4. **懒加载**：只在需要时加载子菜单数据

## 测试建议

### 测试用例
1. ✅ 点击一级文件夹，显示菜单
2. ✅ 悬停二级文件夹，显示子菜单
3. ✅ 悬停三级文件夹，显示孙菜单
4. ✅ 移动到同级文件夹，关闭之前的子菜单
5. ✅ 点击书签，打开网址并关闭所有菜单
6. ✅ 点击其他地方，关闭所有菜单
7. ✅ 窗口 resize，关闭所有菜单

### 调试技巧
在主进程中启用详细日志：
```javascript
console.log('显示子文件夹菜单:', item.name, nextBounds);
console.log('当前子菜单数量:', subDropdownViews.length);
```

## 相关文件

- `/html/index.js` - 书签栏渲染和主菜单触发
- `/html/dropdown-menu/dropdown-menu.js` - 下拉菜单页面逻辑
- `/html/dropdown-menu/dropdown-menu.css` - 下拉菜单样式
- `/main.js` - 主进程 IPC 处理和视图管理

## 总结

该实现通过 WebContentsView 的动态创建和销毁，实现了灵活的多级下拉菜单系统。核心设计原则是：
1. **按需创建**：只在需要时创建视图
2. **智能清理**：自动关闭不必要的菜单
3. **流畅交互**：延迟显示和视觉反馈提升用户体验
4. **层级管理**：通过数组维护菜单层级关系
