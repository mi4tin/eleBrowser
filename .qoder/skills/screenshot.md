# Screenshot Skill

网页截图技能。

## 功能说明
- 对当前网页进行截图
- 支持全页面截图和可见区域截图
- 提供多种截图格式和质量选项

## 使用方法
在聊天中输入：
- `/screenshot` - 截取当前可见区域
- `/fullshot` - 截取整个网页
- `/screenshot png` - 指定PNG格式
- `/screenshot jpg high` - 指定JPG格式高质量

## 保存选项
- 自动保存到下载目录
- 复制到剪贴板
- 保存到指定文件夹
- 分享到社交媒体

## 实现原理
使用Electron的webContents.capturePage() API捕获网页内容并保存为图片文件。