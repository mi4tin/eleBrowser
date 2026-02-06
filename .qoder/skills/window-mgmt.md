# Window Management Skill

窗口管理相关技能集合。

## 功能说明
- 管理浏览器窗口状态
- 支持窗口最大化、最小化、关闭等操作
- 提供窗口布局调整功能

## 使用方法
在聊天中输入：
- `/maximize` - 最大化窗口
- `/minimize` - 最小化窗口
- `/restore` - 恢复窗口大小
- `/close` - 关闭当前窗口
- `/fullscreen` - 切换全屏模式

## 高级功能
- `/windows` - 显示所有打开的窗口
- `/focus` - 聚焦到下一个窗口
- `/arrange` - 自动排列窗口布局

## 实现原理
通过Electron的BrowserWindow API控制窗口的各种状态和行为。