module.exports = function createWindowManager(deps) {
    const {
        BrowserWindow,
        appRootDir,
        setupProtocolBlocking,
        resizeBrowserViews,
        registerAppShortcuts,
        unregisterAppShortcuts,
        hideFolderDropdown,
        clearBrowserViews,
        resetTabIdCounter,
        setMainWindow
    } = deps;

    function newWindow() {
        const iconPath = appRootDir + '/assets/ico2.ico';
        console.log('icon', iconPath);

        const myWindow = new BrowserWindow({
            width: 1000,
            height: 700,
            // x: 0,
            // y: 100,
            icon: iconPath,
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

        myWindow.webContents.once('did-finish-load', () => {
            console.log('主窗口加载完成，创建书签栏下拉菜单');
        });

        const handleResize = () => {
            resizeBrowserViews(myWindow);
        };
        myWindow.on('resize', handleResize);

        const shouldOpenTestPage = process.argv.includes('--test-search');
        if (shouldOpenTestPage) {
            setTimeout(() => {
                if (myWindow && !myWindow.isDestroyed()) {
                    const testPagePath = 'file:///' + appRootDir.replace(/\\/g, '/') + '/search-demo.html';
                    console.log('打开测试页面:', testPagePath);
                    myWindow.webContents.send('open-url-in-new-tab', testPagePath);
                }
            }, 1000);
        }

        const handleFocus = () => {
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
            myWindow.webContents.send('show-folder-dropdown-mouseenter', false);
            hideFolderDropdown(myWindow);
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
