# Dialog 组件

## 文件说明

| 文件名 | 作用 |
|--------|------|
| `dialog.html` | 对话框的 HTML 结构 |
| `dialog.css` | 对话框的样式文件 |
| `dialog.js` (html/dialog 目录) | 对话框渲染进程的逻辑 |
| `dialog.js` (main 目录) | 对话框主进程的逻辑，负责创建窗口、处理事件 |
| `dialog-test.html` | 对话框的测试页面 |
| `usage-example.js` | 使用示例代码 |
| `README.md` | 本文件，组件说明文档 |

## 功能要点

### 1. 三种对话框类型

- **默认对话框**：简单的提示弹窗，只有确认按钮
- **确认对话框**：带有确认和取消按钮的弹窗
- **保存密码对话框**：用于保存登录信息的对话框
- **显示已保存密码对话框**：显示已保存的密码列表，支持选择填充

### 2. 主要特性

- **位置跟随**：对话框（特别是密码列表）会跟随父窗口移动
- **非模态模式**：密码列表显示时不获取焦点，不影响输入
- **关闭场景**：
  - 点击页面其他地方自动关闭
  - 窗口失焦时关闭
  - 输入框有输入时关闭
  - 按 ESC 键关闭

### 3. 密码列表特性

- 显示已保存的账号密码
- 密码显示为掩码（••••••••）
- 点击账号自动填充到输入框
- 提供「管理密码」入口

## 使用方法

### 在主进程中使用

```javascript
const { createShowDialog } = require('./main/dialog');

const showDialog = createShowDialog(getMainWindow);

// 1. 简单提示弹窗
const result = await showDialog({
    title: '提示',
    message: '这是一条提示消息',
    confirmText: '好的'
});

// 2. 确认弹窗
const result = await showDialog({
    title: '确认',
    message: '确定要删除这个文件吗？',
    confirmText: '删除',
    cancelText: '取消'
});

// 3. 保存密码弹窗
const result = await showDialog({
    title: '要保存密码吗？',
    message: '',
    confirmText: '保存',
    cancelText: '一律不',
    username: 'testuser@example.com',
    password: 'testpassword123',
    type: 'save-password'
});

// 4. 显示已保存密码弹窗
const result = await showDialog({
    type: 'show-saved-passwords',
    savedPasswords: [
        { username: 'user1', password: 'pass1' },
        { username: 'user2', password: 'pass2' }
    ],
    inputRect: { x: 100, y: 200, width: 300, height: 40 },
    modal: false
});
```

### 在渲染进程中发送事件（密码列表场景）

```javascript
// 当输入框获得焦点时
ipcRenderer.send('input-box-focused', {
    url: window.location.href,
    inputRect: { x: 100, y: 200, width: 300, height: 40 }
});

// 监听填充密码事件
ipcRenderer.on('fill-login-form', (event, { username, password }) => {
    // 填充到输入框
});
```

## 测试方法

### 1. 使用测试页面

```bash
# 启动应用
pnpm start

# 按快捷键打开测试页面
Ctrl + Shift + D (Windows)
Cmd + Shift + D (Mac)
```

### 2. 测试页面功能

- 简单提示弹窗
- 确认弹窗
- 保存密码弹窗
- 查看返回结果


## API 文档

### `showDialog(options)`

**参数**：

- `title` (string)：对话框标题
- `message` (string)：对话框消息
- `confirmText` (string)：确认按钮文字，默认「确定」
- `cancelText` (string)：取消按钮文字，默认无
- `parentWindow` (BrowserWindow)：父窗口
- `type` (string)：对话框类型
  - `'default'`：默认对话框
  - `'save-password'`：保存密码对话框
  - `'show-saved-passwords'`：显示已保存密码
- `username` (string)：预填的用户名（保存密码时）
- `password` (string)：预填的密码（保存密码时）
- `savedPasswords` (Array)：已保存的密码列表
- `inputRect` (Object)：输入框位置信息（用于定位密码列表）
  - `x` (number)：输入框 x 坐标
  - `y` (number)：输入框 y 坐标
  - `width` (number)：输入框宽度
  - `height` (number)：输入框高度
- `modal` (boolean)：是否为模态弹窗，默认 true

**返回值**：

- 对于默认/确认对话框：返回 `true` 或 `false`
- 对于保存密码对话框：返回 `{ confirmed: boolean, username: string, password: string }`
- 对于密码列表对话框：返回 `{ confirmed: boolean, action: 'fill' | 'manage' | 'cancel', username?: string, password?: string }`
