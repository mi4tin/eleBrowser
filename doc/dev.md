==待实现(主)==
+判断是否显示关闭菜单

==待实现==
+增加标签标题显示设置
+增加文心搜索



+每个标签网站的搜索是独立的
+文件下载
+http、socket5代理
+移除webview相关（所有功能重构完执行）




==完成==
+F12快捷键无用
+关闭其它标签
+index.js运行的一些报错处理
+搜索上一个无用
+underlineNameIndex 、occurrenceIndex即matchindex等处理
+同一网页内，多个地方有相同内容划线的问题

+将ds或test-underline里下添加下划线方法替换main.js里添加下划线

+搜索选中文本
+index.js 全局快捷键：F12
+开发者工具
+将main.copy2的loadAndRestoreUnderline换进main.js
+将webview换成browserview，以解决webview开发者工具不能停靠的问题（搜索使用browserview已证可行见elebrowser2）
+搜索词变化，搜索效果没变
+搜索即时性
+取消划线
+快捷键，只针对本应用。目前使用菜单快捷键，在网页中点个链接，打开新页卡时，马上ctrl+f 无用
+将webview改为BrowserView(经测试效果不太好，未采用)
+相同内容划线重复加载问题