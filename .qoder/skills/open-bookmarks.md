# Open Bookmarks Skill

快速打开书签管理页面的技能。

## 功能说明
- 通过快捷键或命令快速访问书签管理界面
- 支持在新标签页中打开书签管理器

## 使用方法
在聊天中输入以下任意一种方式：
- `/bookmarks`
- `/bm`
- "打开书签"
- "查看书签"

## 实现原理
向主窗口发送 'open-bookmarks-tab' 消息，在新标签页中加载 bookmarks.html 页面。