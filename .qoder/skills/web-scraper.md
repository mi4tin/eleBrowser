# Web Scraper Skill

网页抓取技能。

## 功能说明
- 抓取网页特定内容
- 提取结构化数据
- 导出为抓取结果

## 使用方法
在聊天中输入：
- `/scrape` - 开始网页抓取
- `/scrape-selector .class` - 使用CSS选择器抓取
- `/scrape-xpath //div` - 使用XPath抓取
- `/scrape-table` - 抓取表格数据

## 数据导出
- `/export-json` - 导出JSON格式
- `/export-csv` - 导出CSV格式
- `/export-excel` - 导出Excel格式
- `/export-html` - 导出HTML格式

## 高级抓取
- `/scrape-images` - 抓取页面图片
- `/scrape-links` - 抓取页面链接
- `/scrape-emails` - 抓取邮箱地址
- `/schedule-scrape` - 定时抓取任务

## 实现原理
使用Cheerio或Puppeteer等工具解析网页DOM结构，提取指定内容。