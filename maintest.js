/**
 * 最小复现：Windows + frame:false + titleBarStyle:hidden + titleBarOverlay
 * 下 DevTools 以 right 打开是否先停靠再退回 detach。
 *
 * 运行：npm run test:overlay-devtools
 * 或：npx electron maintest.js
 *
 * 使用菜单「DevTools 测试」选择不同停靠方式；观察 right 与 left/bottom/detach 的差异。
 */

const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

/** @type {BrowserWindow | null} */
let overlayWin = null;
/** @type {BrowserWindow | null} */
let plainWin = null;

function createOverlayWindow() {
    if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.focus();
        return overlayWin;
    }
    overlayWin = new BrowserWindow({
        width: 960,
        height: 640,
        show: false,
        frame: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#f3f3f3',
            symbolColor: '#333333',
            height: 39
        },
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    overlayWin.once('ready-to-show', () => overlayWin.show());
    overlayWin.loadFile(path.join(__dirname, 'html', 'maintest-page.html'));
    overlayWin.on('closed', () => {
        overlayWin = null;
    });
    return overlayWin;
}

/** 无 titleBarOverlay，用于对照（程序化 right 通常更稳定） */
function createPlainFramelessWindow() {
    if (plainWin && !plainWin.isDestroyed()) {
        plainWin.focus();
        return plainWin;
    }
    plainWin = new BrowserWindow({
        width: 960,
        height: 640,
        show: false,
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    plainWin.once('ready-to-show', () => plainWin.show());
    plainWin.loadFile(path.join(__dirname, 'html', 'maintest-page.html'));
    plainWin.on('closed', () => {
        plainWin = null;
    });
    return plainWin;
}

function openDevTools(win, mode) {
    if (!win || win.isDestroyed()) return;
    console.log('[maintest] openDevTools mode=', mode, 'window id=', win.id);
    win.webContents.openDevTools({ mode });
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
                        if (w && !w.isDestroyed()) w.webContents.closeDevTools();
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
