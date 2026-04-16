//最小可用测试专用

/**
 * 最小复现：Windows + frame:false + titleBarStyle:hidden + titleBarOverlay
 * 下 DevTools 以 right 打开是否先停靠再退回 detach。
 *
 * 运行：npm run test:overlay-devtools
 * 或：npx electron maintest.js
 *
 * 使用菜单「DevTools 测试」选择不同停靠方式；观察 right 与 left/bottom/detach 的差异。
 */

const { app, BrowserWindow, Menu, ipcMain, WebContentsView } = require('electron');
const path = require('path');

/** 与 html/maintest-page.html 中 .custom-titlebar 高度一致 */
const MAINTEST_TITLEBAR_HEIGHT = 39;

/** @type {BrowserWindow | null} */
let overlayWin = null;
/** @type {WebContentsView | null} */
let overlayBaiduView = null;

function layoutOverlayBaiduView() {
    if (!overlayWin || overlayWin.isDestroyed() || !overlayBaiduView) return;
    const b = overlayWin.getContentBounds();
    overlayBaiduView.setBounds({
        x: 0,
        y: MAINTEST_TITLEBAR_HEIGHT,
        width: b.width,
        height: Math.max(0, b.height - MAINTEST_TITLEBAR_HEIGHT)
    });
}
/** @type {BrowserWindow | null} */
let plainWin = null;

// 监听窗口控制事件（全局）
ipcMain.on('window-control', (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    
    switch (action) {
        case 'minimize':
            win.minimize();
            break;
        case 'maximize':
            if (win.isMaximized()) {
                win.unmaximize();
            } else {
                win.maximize();
            }
            break;
        case 'close':
            win.close();
            break;
    }
});

function createOverlayWindow() {
    if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.focus();
        return overlayWin;
    }
    console.log('[maintest] 创建 overlayWindow');
    overlayWin = new BrowserWindow({
        width: 960,
        height: 640,
        show: false,
        frame: false,
        titleBarStyle: 'hidden',
        // 移除 titleBarOverlay，使用自定义标题栏
        // titleBarOverlay: {
        //     color: '#f3f3f3',
        //     symbolColor: '#333333',
        //     height: 39
        // },
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload-custom-titlebar.js')
        }
    });

    // const winHandle = overlayWin.getNativeWindowHandle();
    // overlayWin.setTitleBarOverlay({
    //     color: '#f3f3f3',
    //     symbolColor: '#333333',
    //     height: 39
    // });
    // overlayWin.setSheetOffset(8, 8);

    overlayWin.once('ready-to-show', () => overlayWin.show());
    overlayWin.loadFile(path.join(__dirname, 'html', 'maintest-page.html'));
    overlayWin.on('closed', () => {
        overlayWin = null;
        overlayBaiduView = null;
    });

    overlayBaiduView = new WebContentsView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    overlayWin.contentView.addChildView(overlayBaiduView);
    layoutOverlayBaiduView();
    overlayBaiduView.webContents.loadURL('https://www.baidu.com/');
    overlayWin.on('resize', layoutOverlayBaiduView);

    return overlayWin;
}

/** 无 titleBarOverlay，用于对照（程序化 right 通常更稳定） */
function createPlainFramelessWindow() {
    if (plainWin && !plainWin.isDestroyed()) {
        plainWin.focus();
        return plainWin;
    }
    console.log('[maintest] 创建 plainFramelessWindow');
    plainWin = new BrowserWindow({
        width: 960,
        height: 640,
        show: false,
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload-custom-titlebar.js')
        }
    });
    plainWin.once('ready-to-show', () => plainWin.show());
    plainWin.loadFile(path.join(__dirname, 'html', 'maintest-page.html'));
    plainWin.on('closed', () => {
        plainWin = null;
    });
    return plainWin;
}

function getDevToolsTargetWebContents(win) {
    if (!win || win.isDestroyed()) return null;

    if (win === overlayWin && overlayBaiduView && !overlayBaiduView.webContents.isDestroyed()) {
        return overlayBaiduView.webContents;
    }

    return win.webContents;
}

function openDevTools(win, mode) {
    const targetWebContents = getDevToolsTargetWebContents(win);
    if (!targetWebContents || targetWebContents.isDestroyed()) return;
    console.log('[maintest] openDevTools mode=', mode, 'window id=', win.id);

    targetWebContents.openDevTools({ mode });
}

function buildMenu() {
    return Menu.buildFromTemplate([
        {
            label: '窗口',
            submenu: [
                {
                    label: '打开/聚焦：带 titleBarOverlay（与主项目一致）',
                    click: () => createOverlayWindow()
                },
                {
                    label: '打开/聚焦：无 overlay 对照窗',
                    click: () => createPlainFramelessWindow()
                },
                { type: 'separator' },
                { role: 'quit', label: '退出' }
            ]
        },
        {
            label: 'DevTools 测试（作用于当前聚焦窗口）',
            submenu: [
                {
                    label: 'openDevTools({ mode: "right" })',
                    accelerator: 'F5',
                    click: () => {
                        const w = BrowserWindow.getFocusedWindow();
                        if (w) openDevTools(w, 'right');
                    }
                },
                {
                    label: 'openDevTools({ mode: "bottom" })',
                    accelerator: 'F6',
                    click: () => {
                        const w = BrowserWindow.getFocusedWindow();
                        if (w) openDevTools(w, 'bottom');
                    }
                },
                {
                    label: 'openDevTools({ mode: "left" })',
                    accelerator: 'F7',
                    click: () => {
                        const w = BrowserWindow.getFocusedWindow();
                        if (w) openDevTools(w, 'left');
                    }
                },
                {
                    label: 'openDevTools({ mode: "detach" })',
                    accelerator: 'F8',
                    click: () => {
                        const w = BrowserWindow.getFocusedWindow();
                        if (w) openDevTools(w, 'detach');
                    }
                },
                { type: 'separator' },
                {
                    label: '关闭 DevTools（当前窗口）',
                    click: () => {
                        const w = BrowserWindow.getFocusedWindow();
                        const targetWebContents = getDevToolsTargetWebContents(w);
                        if (targetWebContents && !targetWebContents.isDestroyed()) {
                            targetWebContents.closeDevTools();
                        }
                    }
                }
            ]
        }
    ]);
}

app.whenReady().then(() => {
    Menu.setApplicationMenu(buildMenu());
    createOverlayWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});
