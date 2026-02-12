==待实现==
+将main.copy2的loadAndRestoreUnderline换进main.js


+同一网页内，多个地方有相同内容划线的问题
+每个标签网站的搜索是独立的
+文件下载
+http、socket5代理
+移除webview相关（所有功能重构完执行）




==完成==
+将webview换成browserview，以解决webview开发者工具不能停靠的问题（搜索使用browserview已证可行见elebrowser2）
+搜索词变化，搜索效果没变
+搜索即时性
+取消划线
+快捷键，只针对本应用。目前使用菜单快捷键，在网页中点个链接，打开新页卡时，马上ctrl+f 无用
+将webview改为BrowserView(经测试效果不太好，未采用)
+相同内容划线重复加载问题