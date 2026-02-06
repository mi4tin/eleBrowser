# RSS Reader Skill

RSS订阅阅读技能。

## 功能说明
- 管理RSS订阅源
- 聚合和阅读订阅内容
- 智能内容推荐

## 使用方法
在聊天中输入：
- `/rss` - 打开RSS阅读器
- `/subscribe url` - 订阅RSS源
- `/unsubscribe feed-id` - 取消订阅
- `/refresh-feeds` - 刷新所有订阅

## 内容管理
- `/unread` - 显示未读文章
- `/mark-read` - 标记为已读
- `/star-article` - 收藏文章
- `/share-article` - 分享文章

## 智能功能
- `/recommend-feeds` - 推荐相关RSS源
- `/search-feeds keyword` - 搜索RSS源
- `/export-feeds` - 导出订阅列表
- `/import-feeds file` - 导入订阅列表

## 实现原理
通过RSS解析器获取和聚合订阅源内容，提供统一的阅读界面。