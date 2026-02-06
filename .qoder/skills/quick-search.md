# Quick Search Skill

快速搜索引擎切换技能。

## 功能说明
- 快速切换不同的搜索引擎
- 支持主流搜索引擎
- 自定义搜索关键词

## 使用方法
在聊天中输入：
- `/search-engine google` - 切换到Google搜索
- `/search-engine baidu` - 切换到百度搜索
- `/search-engine duckduckgo` - 切换到DuckDuckGo
- `/engines` - 显示可用搜索引擎列表

## 搜索操作
- 直接搜索：`搜索 人工智能` (使用当前引擎)
- 指定引擎搜索：`google 机器学习`
- `/default-engine baidu` - 设置默认搜索引擎

## 支持的引擎
- Google
- 百度
- Bing
- DuckDuckGo
- Yahoo
- 自定义搜索引擎

## 实现原理
维护搜索引擎配置映射表，根据用户选择动态构建搜索URL。