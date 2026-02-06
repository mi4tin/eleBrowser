# Download Manager Skill

下载管理技能。

## 功能说明
- 管理浏览器下载任务
- 查看下载历史和进度
- 控制下载暂停、恢复、取消

## 使用方法
在聊天中输入：
- `/downloads` - 打开下载管理器
- `/download url` - 下载指定文件
- `/pause` - 暂停所有下载
- `/resume` - 恢复下载
- `/clear-downloads` - 清空下载历史

## 高级功能
- `/download-folder` - 打开下载文件夹
- `/download-speed` - 显示下载速度统计
- `/auto-download` - 设置自动下载规则

## 实现原理
通过Electron的session.download API管理和监控下载任务状态。