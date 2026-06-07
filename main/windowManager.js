const { dialog } = require('electron');
const { createShowDialog, closeDialog } = require('./dialog');

module.exports = function createWindowManager(deps) {
    const {
        BrowserWindow,
        appRootDir,
        setupProtocolBlocking,
        resizeBrowserViews,
        registerAppShortcuts,
        unregisterAppShortcuts,
        hideFolderDropdown,
        hideDownloadsPanel,
        getDownloadsApi,
        clearBrowserViews,
        resetTabIdCounter,
        setMainWindow,
        getMainWindow,
    } = deps;

    const showDialog = createShowDialog(getMainWindow);

    function newWindow(initialUrl) {
        const iconPath = appRootDir + '/assets/ico1.png';
        console.log('icon', iconPath);

        const myWindow = new BrowserWindow({
            width: 1000,
            height: 700,
            frame: false,//标题栏设置
            titleBarStyle: 'hidden',//标题栏设置，这个起决定作用
            titleBarOverlay: {
                color: '#f3f3f3',
                symbolColor: '#333333',
                height: 39
            },
            // roundedCorners: false,
            // x: 0,
            // y: 100,
            icon: iconPath,
// thickFrame: false,
// roundedCorners: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                webviewTag: true,
                disableDialogs: false,
                disableBlinkFeatures: 'Autofill'
            }
        });

        setMainWindow(myWindow);
        console.log('crt');
        setupProtocolBlocking(myWindow.webContents);
        myWindow.loadFile('html/index.html');

        // 如果传入了初始URL，在窗口加载完成后打开该URL
        if (initialUrl) {
            myWindow.webContents.once('did-finish-load', () => {
                console.log('主窗口加载完成，打开初始URL:', initialUrl);
                myWindow.webContents.send('open-url-in-new-tab', initialUrl);
            });
        } else {
            myWindow.webContents.once('did-finish-load', () => {
                console.log('主窗口加载完成，创建书签栏下拉菜单');
            });
        }

        // 监听窗口关闭事件，检查下载
        myWindow.on('close', async (event) => {
            // 获取最新的 downloads API
            const downloadsApi = getDownloadsApi ? getDownloadsApi() : null;
            if (downloadsApi && downloadsApi.hasActiveDownloads && downloadsApi.hasActiveDownloads()) {
                event.preventDefault(); // 阻止默认关闭行为
                
                const activeDownloads = downloadsApi.getActiveDownloads ? downloadsApi.getActiveDownloads() : [];
                const count = activeDownloads.length;
                const filenames = activeDownloads.map(r => r.filename).join('、');
                
                const result = await showDialog({
                    message: `当前有 ${count} 个文件正在下载\n文件：${filenames}\n\n关闭应用后需要重新下载这些文件。`,
                    confirmText: '继续下载',
                    cancelText: '关闭',
                    parentWindow: myWindow
                });
                
                if (!result) {
                    // 用户选择关闭应用，强制销毁窗口
                    myWindow.destroy();
                }
            }
        });

        // 监听窗口最大化/还原状态变化
        myWindow.on('maximize', () => {
            myWindow.webContents.send('window-maximized');
        });
        myWindow.on('unmaximize', () => {
            myWindow.webContents.send('window-unmaximized');
        });

        const handleResize = () => {
            resizeBrowserViews(myWindow);
        };
        myWindow.on('resize', handleResize);

        const shouldOpenTestPage = process.argv.includes('--test-search');
        if (shouldOpenTestPage) {
            setTimeout(() => {
                if (myWindow && !myWindow.isDestroyed()) {
                    const testPagePath = 'file://' + appRootDir.replace(/\\/g, '/') + '/search-demo.html';
                    console.log('打开测试页面:', testPagePath);
                    myWindow.webContents.send('open-url-in-new-tab', testPagePath);
                }
            }, 1000);
        }

        const handleFocus = () => {
            try {
                if (typeof onMainWindowFocus === 'function') onMainWindowFocus();
            } catch (_e) {
                /* ignore */
            }
            console.log('窗口获得焦点，注册快捷键');
            registerAppShortcuts();
            
            const clipboardText = require('electron').clipboard.readText();
            if (clipboardText) {
                // console.log('粘贴板内容:', clipboardText);
                // 可以在这里处理粘贴板内容，例如自动填充到地址栏等
                myWindow.webContents.send('clipboard-updated', clipboardText);
            }
        };
        myWindow.on('focus', handleFocus);

        const handleBlur = () => {
            console.log('窗口失去焦点，注销快捷键');
            unregisterAppShortcuts();
            

            //测试专用时，可注释
            hideFolderDropdown(myWindow);
            hideDownloadsPanel(myWindow);
            // 关闭密码列表
            closeDialog();
        };
        myWindow.on('blur', handleBlur);

        const handleClosed = () => {
            setMainWindow(null);
            unregisterAppShortcuts();
            clearBrowserViews();
            resetTabIdCounter();
            
            myWindow.removeListener('resize', handleResize);
            myWindow.removeListener('focus', handleFocus);
            myWindow.removeListener('blur', handleBlur);
        };
        myWindow.once('closed', handleClosed);

        myWindow.webContents.on('before-input-event', () => {
            // 保留事件监听入口，当前无处理逻辑
        });

        registerAppShortcuts();
    }

    return { newWindow };
};
