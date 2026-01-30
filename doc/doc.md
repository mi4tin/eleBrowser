electron 开发的浏览器

调试启动命令：
npm start

打包命令：
npm run dist:win

屏蔽弹出打开应用：
在customProtocols处增加对应协议就行


__dirname=file:///F:/DEV/Code/gitee.com/eleBrowser/html



常用调用：
1、html里通过ipcRenderer.send('open-bookmark', historyItem.url) 调用main.js里的ipcMain.on('open-bookmark'...)注册的方法
2、main.js里通过mainWindow.webContents.send('open-bookmarks-tab') 调用html里的ipcRenderer.on('open-bookmarks-tab'..)注册的方法

