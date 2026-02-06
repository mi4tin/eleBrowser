# Extension Manager Skill

浏览器扩展管理技能。

## 功能说明
- 管理浏览器扩展插件
- 安装、卸载、启用/禁用扩展
- 查看扩展信息和权限

## 使用方法
在聊天中输入：
- `/extensions` - 打开扩展管理页面
- `/install-extension path` - 安装本地扩展
- `/enable ext-id` - 启用指定扩展
- `/disable ext-id` - 禁用指定扩展
- `/remove-extension ext-id` - 卸载扩展

## 扩展操作
- `/extension-info ext-id` - 查看扩展详细信息
- `/extension-permissions ext-id` - 查看扩展权限
- `/update-extensions` - 更新所有扩展

## 实现原理
通过Electron的扩展API管理系统扩展的生命周期和状态。