# Collaboration Skill

协作功能技能。

## 功能说明
- 多人协作浏览
- 实时共享浏览会话
- 协作标注和讨论

## 使用方法
在聊天中输入：
- `/collaborate` - 开始协作会话
- `/share-session` - 分享当前浏览会话
- `/join-session code` - 加入协作会话
- `/leave-session` - 离开协作会话

## 协作工具
- `/annotate` - 添加协作标注
- `/highlight` - 高亮重要内容
- `/chat` - 打开协作聊天
- `/cursor-sharing` - 共享鼠标光标

## 会话管理
- `/session-code` - 获取会话代码
- `/participants` - 显示参与者列表
- `/kick-user username` - 踢出用户
- `/end-session` - 结束协作会话

## 实现原理
通过WebSocket实现实时通信，在多个用户间同步浏览状态和交互操作。