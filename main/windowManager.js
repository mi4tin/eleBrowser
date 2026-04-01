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
        const iconPath = appRootDir + '/assets/icon.ico';
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

        myWindow.on('resize', () => {
            console.log('窗口大小改变，调整BrowserView尺寸');
            resizeBrowserViews(myWindow);
        });

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

        myWindow.on('focus', () => {
            console.log('窗口获得焦点，注册快捷键');
            registerAppShortcuts();
        });

        myWindow.on('blur', () => {
            console.log('窗口失去焦点，注销快捷键');
            unregisterAppShortcuts();
            myWindow.webContents.send('show-folder-dropdown-mouseenter', false);
            hideFolderDropdown(myWindow);
        });

        myWindow.on('closed', () => {
            setMainWindow(null);
            unregisterAppShortcuts();
            clearBrowserViews();
            resetTabIdCounter();
        });

        myWindow.webContents.on('before-input-event', () => {
            // 保留事件监听入口，当前无处理逻辑
        });

        registerAppShortcuts();
    }

    return { newWindow };
};
