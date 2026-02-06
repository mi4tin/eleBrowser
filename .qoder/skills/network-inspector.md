# Network Inspector Skill

网络请求监控技能。

## 功能说明
- 监控网页网络请求
- 分析请求性能
- 调试网络问题

## 使用方法
在聊天中输入：
- `/network` - 打开网络监控面板
- `/monitor-requests` - 开始监控网络请求
- `/stop-monitor` - 停止监控
- `/clear-network-log` - 清空网络日志

## 请求分析
- `/slow-requests` - 显示慢速请求
- `/failed-requests` - 显示失败请求
- `/request-details id` - 查看请求详情
- `/block-domain example.com` - 阻止特定域名请求

## 性能优化
- `/performance-tips` - 显示性能优化建议
- `/cache-stats` - 显示缓存统计
- `/bandwidth-usage` - 显示带宽使用情况
- `/dns-lookup` - DNS查询时间分析

## 实现原理
通过拦截和记录webContents的网络请求事件来监控和分析网络活动。