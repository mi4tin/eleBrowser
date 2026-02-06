# Data Export Skill

数据导出技能。

## 功能说明
- 导出浏览器各种数据
- 支持多种导出格式
- 批量数据处理

## 使用方法
在聊天中输入：
- `/export-data` - 导出所有数据
- `/export-bookmarks-html` - 导出书签为HTML
- `/export-history-csv` - 导出历史记录为CSV
- `/export-underline-json` - 导出划线数据为JSON

## 导出选项
- `/export-format json` - 设置导出格式
- `/export-location path` - 设置导出位置
- `/export-selected` - 导出选中数据
- `/export-compressed` - 压缩导出文件

## 数据处理
- `/backup-all` - 备份所有用户数据
- `/sync-data` - 同步数据到云端
- `/migrate-data` - 迁移数据到其他设备
- `/clear-exported` - 清理已导出文件

## 实现原理
通过序列化用户数据并按照指定格式生成可移植的数据文件。