const { shell } = require('electron');

const MAX_ITEMS = 40;
const PANEL_W = 384;
const PANEL_H = 420;
const STORE_VERSION = 1;
const SAVE_DEBOUNCE_MS = 400;

module.exports = function registerDownloadsIpcHandlers(deps) {
    const { ipcMain, BrowserWindow, session, getPreloadPath, appRootDir, app, fs, path } = deps;

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

    function attachWillDownload() {
        if (willDownloadAttached) return;
        willDownloadAttached = true;
        session.defaultSession.on('will-download', (_event, item) => {
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
                _downloadItem: item
            };
            const removedIds = pushRecent(record);
            notifyPanelItemUpdated(record);
            for (const rid of removedIds) {
                notifyPanelItemRemoved(rid);
            }

            item.on('updated', (_e, state) => {
                record.receivedBytes = item.getReceivedBytes();
                record.totalBytes = item.getTotalBytes() || record.totalBytes;
                if (state === 'interrupted') record.state = 'interrupted';
                updateEta(record);
                notifyPanelItemUpdated(record);
                schedulePersist(false);
            });

            item.once('done', (_e, state) => {
                record.receivedBytes = item.getReceivedBytes();
                record.totalBytes = item.getTotalBytes() || record.receivedBytes;
                record.endTime = Date.now();
                record.savePath = item.getSavePath() || null;
                record.state = state === 'completed' ? 'completed' : state;
                record.etaSeconds = null;
                record._downloadItem = null;
                notifyPanelItemUpdated(record);
                schedulePersist(true);
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

    return { hideDownloadsPanel };
};
