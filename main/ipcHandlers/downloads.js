const { shell, clipboard, Menu } = require('electron');

const MAX_ITEMS = 40;
const PANEL_W = 384;
const PANEL_H = 420;
const STORE_VERSION = 1;
const SAVE_DEBOUNCE_MS = 400;

module.exports = function registerDownloadsIpcHandlers(deps) {
    const {
        ipcMain,
        BrowserWindow,
        session,
        getPreloadPath,
        appRootDir,
        app,
        fs,
        path,
        getBrowserViews,
        getMainWindow
    } = deps;

    /** @type {BrowserWindow | null} */
    let downloadsPanelWindow = null;
    /** @type {Array<object>} */
    const recentDownloads = [];
    let willDownloadAttached = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let saveDebounceTimer = null;

    function getStorePath() {
        return path.join(app.getPath('userData'), 'downloads-history.json');
    }

    function loadDownloadsHistory() {
        const storePath = getStorePath();
        try {
            if (!fs.existsSync(storePath)) return;
            const raw = fs.readFileSync(storePath, 'utf8');
            const parsed = JSON.parse(raw);
            const items = Array.isArray(parsed) ? parsed : parsed.items;
            if (!Array.isArray(items)) return;
            recentDownloads.length = 0;
            for (const row of items.slice(0, MAX_ITEMS)) {
                if (!row || typeof row.id !== 'string') continue;
                const state =
                    row.state === 'progressing'
                        ? 'interrupted'
                        : row.state === 'completed' ||
                            row.state === 'cancelled' ||
                            row.state === 'interrupted'
                          ? row.state
                          : 'interrupted';
                recentDownloads.push({
                    id: row.id,
                    filename: row.filename || 'download',
                    url: typeof row.url === 'string' ? row.url : '',
                    receivedBytes: Number(row.receivedBytes) || 0,
                    totalBytes: Number(row.totalBytes) || 0,
                    state,
                    startTime: Number(row.startTime) || Date.now(),
                    endTime: row.endTime != null ? Number(row.endTime) : null,
                    savePath: typeof row.savePath === 'string' ? row.savePath : null,
                    etaSeconds: null
                });
            }
        } catch (e) {
            console.error('加载下载记录失败:', e);
        }
    }

    function persistToDisk() {
        const storePath = getStorePath();
        try {
            const payload = {
                version: STORE_VERSION,
                items: recentDownloads.map((r) => ({
                    id: r.id,
                    filename: r.filename,
                    url: r.url,
                    receivedBytes: r.receivedBytes,
                    totalBytes: r.totalBytes,
                    state: r.state,
                    startTime: r.startTime,
                    endTime: r.endTime,
                    savePath: r.savePath
                }))
            };
            fs.writeFileSync(storePath, JSON.stringify(payload), 'utf8');
        } catch (e) {
            console.error('保存下载记录失败:', e);
        }
    }

    /** @param {boolean} immediate 为 true 时立即写入（新任务、完成、取消等） */
    function schedulePersist(immediate) {
        if (immediate) {
            if (saveDebounceTimer) {
                clearTimeout(saveDebounceTimer);
                saveDebounceTimer = null;
            }
            persistToDisk();
            return;
        }
        if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
        saveDebounceTimer = setTimeout(() => {
            saveDebounceTimer = null;
            persistToDisk();
        }, SAVE_DEBOUNCE_MS);
    }

    function serializeRecord(r) {
        const base = {
            id: r.id,
            filename: r.filename,
            url: r.url,
            receivedBytes: r.receivedBytes,
            totalBytes: r.totalBytes,
            state: r.state,
            startTime: r.startTime,
            endTime: r.endTime,
            etaSeconds: r.etaSeconds,
            hasSavePath: Boolean(r.savePath && typeof r.savePath === 'string')
        };
        if (r.state === 'progressing' && r._downloadItem) {
            try {
                const di = r._downloadItem;
                base.paused = typeof di.isPaused === 'function' ? di.isPaused() : false;
                base.canResume = typeof di.canResume === 'function' ? di.canResume() : false;
            } catch (_e) {
                base.paused = false;
                base.canResume = false;
            }
        }
        return base;
    }

    function isDownloadsPanelWebContents(wc) {
        return (
            downloadsPanelWindow &&
            !downloadsPanelWindow.isDestroyed() &&
            wc &&
            wc.id === downloadsPanelWindow.webContents.id
        );
    }

    function findTabIdForWebContents(wc) {
        if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return null;
        const views = getBrowserViews();
        for (const [tabId, view] of views) {
            if (view.webContents && !view.webContents.isDestroyed() && view.webContents.id === wc.id) {
                return tabId;
            }
        }
        return null;
    }

    /**
     * 仅关闭「多标签下、仍停在下载链接触发页」的标签，避免误关用户正在浏览的当前页。
     */
    function shouldAutoCloseDownloadTab(tabId, itemUrl) {
        const views = getBrowserViews();
        if (views.size <= 1) return false;
        const view = views.get(tabId);
        if (!view || view.webContents.isDestroyed()) return false;
        const pageUrl = view.webContents.getURL() || '';
        if (!itemUrl || typeof itemUrl !== 'string') return false;
        const isHttpItem = /^https?:\/\//i.test(itemUrl);
        if (
            isHttpItem &&
            (!pageUrl || pageUrl === 'about:blank' || /^about:blank/i.test(pageUrl))
        ) {
            return true;
        }
        try {
            const a = pageUrl.split('#')[0];
            const b = itemUrl.split('#')[0];
            if (a === b) return true;
            const base = b.split('?')[0];
            if (a === base) return true;
        } catch (_e) {
            /* ignore */
        }
        return false;
    }

    function closeDownloadInitiatorTab(record) {
        const tabId = record._initiatorTabId;
        // console.log('closeDownloadInitiatorTab', tabId);
        if (tabId == null) return;
        record._initiatorTabId = null;
        if (!shouldAutoCloseDownloadTab(tabId, record.url)) return;
        const mw = getMainWindow();
        if (!mw || mw.isDestroyed()) return;
        try {
            console.log('close-tab', tabId);
            mw.webContents.send('close-tab', tabId);
        } catch (_e) {
            /* ignore */
        }
    }

    /** @returns {string[]} 因超出条数上限被移出列表的 id */
    function pushRecent(record) {
        recentDownloads.unshift(record);
        const removedIds = [];
        while (recentDownloads.length > MAX_ITEMS) {
            const dropped = recentDownloads.pop();
            if (dropped) removedIds.push(dropped.id);
        }
        schedulePersist(true);
        return removedIds;
    }

    function updateEta(record) {
        if (record.state !== 'progressing') return;
        try {
            if (record._downloadItem && record._downloadItem.isPaused && record._downloadItem.isPaused()) {
                record.etaSeconds = null;
                return;
            }
        } catch (_e) {
            /* ignore */
        }
        const total = record.totalBytes;
        const rec = record.receivedBytes;
        if (!total || total <= 0 || !rec || rec <= 0 || !record.startTime) {
            record.etaSeconds = null;
            return;
        }
        const elapsedSec = (Date.now() - record.startTime) / 1000;
        if (elapsedSec < 0.2) {
            record.etaSeconds = null;
            return;
        }
        const rate = rec / elapsedSec;
        if (rate <= 0) {
            record.etaSeconds = null;
            return;
        }
        record.etaSeconds = (total - rec) / rate;
    }

    function panelWebContents() {
        if (!downloadsPanelWindow || downloadsPanelWindow.isDestroyed()) return null;
        return downloadsPanelWindow.webContents;
    }

    /** 面板打开后同步当前完整列表（仅全量） */
    function notifyPanelListInit() {
        const wc = panelWebContents();
        if (!wc) return;
        try {
            wc.send('downloads-list-init', recentDownloads.map(serializeRecord));
        } catch (_e) {
            /* ignore */
        }
    }

    /** 单条下载的进度或状态变化 */
    function notifyPanelItemUpdated(record) {
        const wc = panelWebContents();
        if (!wc) return;
        try {
            wc.send('downloads-item-updated', serializeRecord(record));
        } catch (_e) {
            /* ignore */
        }
    }

    /** 从列表中移除一条（例如超出条数上限） */
    function notifyPanelItemRemoved(id) {
        const wc = panelWebContents();
        if (!wc) return;
        try {
            wc.send('downloads-item-removed', id);
        } catch (_e) {
            /* ignore */
        }
    }

    function removeDownloadRecordById(id) {
        const i = recentDownloads.findIndex((r) => r.id === id);
        if (i === -1) return false;
        const rec = recentDownloads[i];
        let activeItem = null;
        if (rec.state === 'progressing' && rec._downloadItem) {
            activeItem = rec._downloadItem;
        }
        recentDownloads.splice(i, 1);
        notifyPanelItemRemoved(id);
        schedulePersist(true);
        if (activeItem) {
            try {
                activeItem.cancel();
            } catch (_e) {
                /* ignore */
            }
        }
        return true;
    }

    function deleteFileAndDownloadRecord(id) {
        const idx = recentDownloads.findIndex((r) => r.id === id);
        if (idx === -1) return;
        const rec = recentDownloads[idx];
        let pathToDelete = rec.savePath || null;
        if (!pathToDelete && rec._downloadItem) {
            try {
                pathToDelete = rec._downloadItem.getSavePath() || null;
            } catch (_e) {
                pathToDelete = null;
            }
        }
        if (rec.state === 'progressing' && rec._downloadItem) {
            try {
                rec._downloadItem.cancel();
            } catch (_e) {
                /* ignore */
            }
        }
        recentDownloads.splice(idx, 1);
        notifyPanelItemRemoved(id);
        schedulePersist(true);
        if (pathToDelete) {
            try {
                if (fs.existsSync(pathToDelete)) {
                    fs.unlinkSync(pathToDelete);
                }
            } catch (e) {
                console.error('删除下载文件失败:', e);
            }
        }
    }

    function attachWillDownload() {
        if (willDownloadAttached) return;
        willDownloadAttached = true;
        session.defaultSession.on('will-download', (_event, item, webContents) => {
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            const initiatorTabId = webContents ? findTabIdForWebContents(webContents) : null;
            console.log('attachWillDownload', initiatorTabId);
            const record = {
                id,
                filename: item.getFilename() || 'download',
                url: item.getURL() || '',
                totalBytes: item.getTotalBytes() || 0,
                receivedBytes: 0,
                state: 'progressing',
                startTime: Date.now(),
                endTime: null,
                savePath: null,
                etaSeconds: null,
                /** 不落盘，仅进行中有效 */
                _downloadItem: item,
                /** 用户确认保存且开始传输后再写入列表，取消「另存为」则不记录 */
                _listedInHistory: false,
                /** 发起下载的标签页（多为 target=_blank 新标签），结束后尝试关闭 */
                _initiatorTabId: initiatorTabId
            };

            function tryListOnProgress() {
                if (record._listedInHistory) return;
                let shouldList = false;
                try {
                    if (item.getReceivedBytes() > 0) shouldList = true;
                    else if (item.getSavePath && item.getSavePath()) shouldList = true;
                } catch (_e) {
                    /* ignore */
                }
                if (!shouldList) return;
                record._listedInHistory = true;
                const removedIds = pushRecent(record);
                notifyPanelItemUpdated(record);
                for (const rid of removedIds) {
                    notifyPanelItemRemoved(rid);
                }
            }

            item.on('updated', (_e, state) => {
                record.receivedBytes = item.getReceivedBytes();
                record.totalBytes = item.getTotalBytes() || record.totalBytes;
                if (state === 'interrupted') record.state = 'interrupted';
                updateEta(record);
                tryListOnProgress();
                if (record._listedInHistory) {
                    notifyPanelItemUpdated(record);
                    schedulePersist(false);
                }

                console.log('item.on updated', state,record.receivedBytes);

                closeDownloadInitiatorTab(record);
            });

            item.once('done', (_e, state) => {
                console.log('item.once done', state);
                const terminal = state === 'completed' ? 'completed' : state;

                if (!record._listedInHistory) {
                    if (terminal === 'cancelled' || terminal === 'interrupted') {
                        record._downloadItem = null;
                        closeDownloadInitiatorTab(record);
                        return;
                    }
                    record.receivedBytes = item.getReceivedBytes();
                    record.totalBytes = item.getTotalBytes() || record.receivedBytes;
                    record.endTime = Date.now();
                    record.savePath = item.getSavePath() || null;
                    record.state = terminal;
                    record.etaSeconds = null;
                    record._downloadItem = null;
                    record._listedInHistory = true;
                    const removedIds = pushRecent(record);
                    notifyPanelItemUpdated(record);
                    for (const rid of removedIds) {
                        notifyPanelItemRemoved(rid);
                    }
                    schedulePersist(true);
                    closeDownloadInitiatorTab(record);
                    return;
                }

                if (!recentDownloads.some((r) => r.id === record.id)) {
                    record._downloadItem = null;
                    closeDownloadInitiatorTab(record);
                    return;
                }
                record.receivedBytes = item.getReceivedBytes();
                record.totalBytes = item.getTotalBytes() || record.receivedBytes;
                record.endTime = Date.now();
                record.savePath = item.getSavePath() || null;
                record.state = terminal;
                record.etaSeconds = null;
                record._downloadItem = null;
                notifyPanelItemUpdated(record);
                schedulePersist(true);
                closeDownloadInitiatorTab(record);
            });
        });
    }

    function getPanelUrl() {
        return 'file:///' + appRootDir.replace(/\\/g, '/') + '/html/downloads-panel/downloads-panel.html';
    }

    function hideDownloadsPanel() {
        if (downloadsPanelWindow && !downloadsPanelWindow.isDestroyed()) {
            try {
                downloadsPanelWindow.close();
            } catch (_e) {
                /* ignore */
            }
        }
        downloadsPanelWindow = null;
    }

    function showDownloadsPanel(mainWin, anchor) {
        const contentBounds = mainWin.getContentBounds();
        const cx = contentBounds.x + anchor.x + anchor.width;
        const panelX = Math.max(contentBounds.x + 8, Math.round(cx - PANEL_W));
        const panelY = Math.round(contentBounds.y + anchor.y + anchor.height + 4);

        const win = new BrowserWindow({
            width: PANEL_W,
            height: PANEL_H,
            x: panelX,
            y: panelY,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            focusable: false,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: getPreloadPath('preload-downloads-panel.js')
            }
        });
        win.setAlwaysOnTop(true, 'screen-saver');
        downloadsPanelWindow = win;

        win.loadURL(getPanelUrl());

        win.once('ready-to-show', () => {
            if (win.isDestroyed()) return;
            win.setBounds({
                x: panelX,
                y: panelY,
                width: PANEL_W,
                height: PANEL_H
            });
            win.show();
        });

        win.webContents.once('did-finish-load', () => {
            notifyPanelListInit();
        });

        win.on('closed', () => {
            if (downloadsPanelWindow === win) downloadsPanelWindow = null;
        });
    }

    // session.defaultSession 仅在 app ready 后才可用；先加载本地记录再监听下载
    void app.whenReady().then(() => {
        loadDownloadsHistory();
        attachWillDownload();
        app.on('before-quit', () => {
            if (saveDebounceTimer) {
                clearTimeout(saveDebounceTimer);
                saveDebounceTimer = null;
            }
            persistToDisk();
        });
    });

    ipcMain.handle('toggle-downloads-panel', async (event, anchor) => {
        const mainWin = BrowserWindow.fromWebContents(event.sender);
        if (!mainWin) return { visible: false };
        if (downloadsPanelWindow && !downloadsPanelWindow.isDestroyed()) {
            hideDownloadsPanel();
            return { visible: false };
        }
        if (!anchor || typeof anchor.x !== 'number') {
            return { visible: false };
        }
        showDownloadsPanel(mainWin, anchor);
        return { visible: true };
    });

    ipcMain.handle('hide-downloads-panel', () => {
        hideDownloadsPanel();
        return true;
    });

    ipcMain.on('downloads-panel-close', () => {
        hideDownloadsPanel();
    });

    ipcMain.handle('downloads-panel-open-user-dir', async () => {
        const p = app.getPath('downloads');
        await shell.openPath(p);
        return true;
    });

    ipcMain.handle('downloads-panel-reveal', async (_event, id) => {
        const rec = recentDownloads.find((r) => r.id === id);
        if (rec && rec.savePath) {
            shell.showItemInFolder(rec.savePath);
        }
        return true;
    });

    ipcMain.handle('downloads-panel-open-file', async (_event, id) => {
        const rec = recentDownloads.find((r) => r.id === id);
        if (!rec || !rec.savePath) return { ok: false };
        try {
            if (fs.existsSync(rec.savePath)) {
                const err = await shell.openPath(rec.savePath);
                return { ok: !err };
            }
        } catch (e) {
            console.error('downloads-panel-open-file:', e);
        }
        return { ok: false };
    });

    ipcMain.handle('downloads-item-toggle-pause', async (event, id) => {
        if (!isDownloadsPanelWebContents(event.sender)) return { ok: false };
        const rec = recentDownloads.find((r) => r.id === id);
        if (!rec || rec.state !== 'progressing' || !rec._downloadItem) return { ok: false };
        try {
            const di = rec._downloadItem;
            if (di.isPaused()) {
                di.resume();
            } else {
                di.pause();
            }
            notifyPanelItemUpdated(rec);
            return { ok: true };
        } catch (e) {
            console.error('downloads-item-toggle-pause:', e);
            return { ok: false };
        }
    });

    ipcMain.handle('downloads-item-cancel', async (event, id) => {
        if (!isDownloadsPanelWebContents(event.sender)) return { ok: false };
        const rec = recentDownloads.find((r) => r.id === id);
        if (!rec || rec.state !== 'progressing' || !rec._downloadItem) return { ok: false };
        try {
            rec._downloadItem.cancel();
            return { ok: true };
        } catch (e) {
            console.error('downloads-item-cancel:', e);
            return { ok: false };
        }
    });

    ipcMain.handle('downloads-item-context-menu', async (event, payload) => {
        if (!isDownloadsPanelWebContents(event.sender)) return;
        const id = payload && payload.id;
        if (!id || typeof id !== 'string') return;
        const rec = recentDownloads.find((r) => r.id === id);
        if (!rec) return;
        const win = downloadsPanelWindow;
        if (!win || win.isDestroyed()) return;

        let livePath = rec.savePath || '';
        if (!livePath && rec._downloadItem) {
            try {
                livePath = rec._downloadItem.getSavePath() || '';
            } catch (_e) {
                livePath = '';
            }
        }
        const fileExists = Boolean(livePath && fs.existsSync(livePath));
        const hasUrl = Boolean(rec.url && String(rec.url).trim().length);
        const isProgressing = rec.state === 'progressing';

        function resolvePathForId(targetId) {
            const r = recentDownloads.find((x) => x.id === targetId);
            if (!r) return '';
            let p = r.savePath || '';
            if (!p && r._downloadItem) {
                try {
                    p = r._downloadItem.getSavePath() || '';
                } catch (_e) {
                    p = '';
                }
            }
            return p;
        }

        const template = [
            {
                label: '打开文件',
                enabled: fileExists,
                click: () => {
                    const p = resolvePathForId(id);
                    if (p && fs.existsSync(p)) {
                        void shell.openPath(p);
                    }
                }
            },
            {
                label: '打开文件所在目录',
                enabled: Boolean(livePath),
                click: () => {
                    const p = resolvePathForId(id);
                    if (p) {
                        shell.showItemInFolder(p);
                    }
                }
            },
            {
                label: '复制下载链接',
                enabled: hasUrl,
                click: () => {
                    const r = recentDownloads.find((x) => x.id === id);
                    if (r && r.url) {
                        clipboard.writeText(String(r.url));
                    }
                }
            },
            { type: 'separator' },
            {
                label: '删除文件及下载记录',
                click: () => {
                    deleteFileAndDownloadRecord(id);
                }
            },
            {
                label: '仅删除下载记录',
                visible: !isProgressing,
                click: () => {
                    removeDownloadRecordById(id);
                }
            }
        ];
        const menu = Menu.buildFromTemplate(template);
        const opts = { window: win };
        const x = payload && payload.x;
        const y = payload && payload.y;
        if (typeof x === 'number' && typeof y === 'number') {
            opts.x = Math.round(x);
            opts.y = Math.round(y);
        }
        menu.popup(opts);
    });

    return { hideDownloadsPanel };
};
