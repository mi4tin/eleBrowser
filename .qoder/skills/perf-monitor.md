# Performance Monitor Skill

性能监控技能。

## 功能说明
- 监控浏览器性能指标
- 显示内存使用、CPU占用等信息
- 提供性能优化建议

## 使用方法
在聊天中输入：
- `/performance` - 显示当前性能状态
- `/memory` - 显示内存使用情况
- `/cpu` - 显示CPU使用率
- `/resources` - 显示资源使用统计

## 监控指标
- 内存占用（RAM）
- CPU使用率
- 网络流量
- 标签页资源消耗
- 渲染进程状态

## 优化建议
- `/optimize` - 执行性能优化
- `/cleanup` - 清理系统资源
- `/restart` - 重启浏览器释放资源

## 实现原理
通过Electron的process和system API收集系统和应用性能数据。