# Ad Blocker Skill

广告拦截技能。

## 功能说明
- 智能拦截网页广告
- 自定义拦截规则
- 统计拦截效果

## 使用方法
在聊天中输入：
- `/adblock` - 切换广告拦截开关
- `/adblock on` - 启用广告拦截
- `/adblock off` - 禁用广告拦截
- `/ad-stats` - 显示拦截统计

## 规则管理
- `/custom-rules` - 管理自定义拦截规则
- `/subscribe-list url` - 订阅广告拦截规则列表
- `/update-rules` - 更新拦截规则
- `/test-rule selector` - 测试拦截规则

## 拦截类型
- `/block-images` - 拦截图片广告
- `/block-videos` - 拦截视频广告
- `/block-popups` - 拦截弹窗广告
- `/block-trackers` - 拦截跟踪器

## 实现原理
通过内容过滤规则和网络请求拦截技术阻止广告内容加载。