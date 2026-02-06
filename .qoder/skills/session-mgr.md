# Session Manager Skill

会话管理技能。

## 功能说明
- 管理浏览器会话状态
- 保存和恢复浏览会话
- 创建会话快照和备份

## 使用方法
在聊天中输入：
- `/sessions` - 显示会话列表
- `/save-session` - 保存当前会话
- `/restore-session` - 恢复会话
- `/new-session` - 创建新会话

## 会话操作
- `/session-name MyWork` - 为当前会话命名
- `/close-session` - 关闭当前会话
- `/export-session` - 导出会话数据
- `/import-session file` - 导入会话数据

## 自动管理
- `/auto-save on` - 启用自动会话保存
- `/session-limit 10` - 设置会话保存数量限制
- `/clear-sessions` - 清空所有会话

## 实现原理
通过序列化标签页状态和URL信息来保存和恢复完整的浏览会话。