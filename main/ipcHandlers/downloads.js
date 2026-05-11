const { shell, clipboard, Menu } = require('electron');

const MAX_ITEMS = 40;
const PANEL_W = 384;
const PANEL_H = 420;
const STORE_VERSION = 1;
const SAVE_DEBOUNCE_MS = 400;
/** true：走系统另存为；false：静默保存到下载目录（提前 setSavePath） */
const USE_NATIVE_SAVE_DIALOG = true;

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
    /**
     * 当前 will-download 里本条 DownloadItem 对应的 record。
     * 主窗口 blur 只推进该条目的 _dialogPhase，避免与事件里的 item 脱节（不用 recentDownloads 猜 latest）。
     */
    let nativeSaveDialogBlurTargetRecord = null;

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
        if (tabId == null) return;
        record._initiatorTabId = null;
        if (!shouldAutoCloseDownloadTab(tabId, record.url)) return;
        const mw = getMainWindow();
        if (!mw || mw.isDestroyed()) return;
        try {
            mw.webContents.send('close-tab', tabId);
        } catch (_e) {
            /* ignore */
        }
    }

    /**
     * 已识别为「另存为已出现」的流程：在 done 后等主窗口重新拿到焦点再关发起页，
     * 避免在系统对话框尚未完全关闭时关页。
     */
    function shouldDeferCloseInitiatorTabUntilMainFocus(record) {
        return Boolean(
            record._usesNativeSaveDialog &&
                record._dialogPhase === 'dialog_opened' &&
                record._initiatorTabId != null
        );
    }

    function tryFlushPendingCloseInitiatorTab(record) {
        if (!record || !record._pendingCloseInitiatorTab) return;
        const mw = getMainWindow();
        if (mw && !mw.isDestroyed() && mw.isFocused()) {
            record._pendingCloseInitiatorTab = false;
            closeDownloadInitiatorTab(record);
        }
    }

    function requestCloseInitiatorTabAfterUserDisposition(record) {
        if(record._initiatorTabId==null) {
            console.log('download.close.tab.3');
            return;
        };

        if (shouldDeferCloseInitiatorTabUntilMainFocus(record)) {
            record._pendingCloseInitiatorTab = true;
            console.log('download.close.tab.2');
            tryFlushPendingCloseInitiatorTab(record);
            return;
        }
        console.log('download.close.tab.1');
        closeDownloadInitiatorTab(record);
    }

    /** 主窗口 blur：只推进「当前 will-download 对应」的那条 record，与事件里的 item 一致 */
    function onMainWindowBlur() {
        const t = nativeSaveDialogBlurTargetRecord;
        if (
            t &&
            t._usesNativeSaveDialog &&
            t._dialogPhase === 'after_will' &&
            t.state === 'progressing'
        ) {
            t._dialogPhase = 'after_blur';
        }
    }

    /** 主窗口 focus：取消/保存后窗口回到前台时再尝试执行推迟的关标签 */
    function onMainWindowFocus() {
        for (const r of recentDownloads) {
            if (r._usesNativeSaveDialog && r._dialogPhase === 'dialog_opened') {
                r._mainWindowFocusedAfterNativeDialog = true;
            }
            tryFlushPendingCloseInitiatorTab(r);
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

    /** 在系统「下载」目录内生成不冲突的绝对保存路径 */
    function allocateUniqueSavePath(rawFilename) {
        const downloadsDir = app.getPath('downloads');
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
        }
        let base = typeof rawFilename === 'string' ? path.basename(rawFilename) : '';
        if (!base || base === '.' || base === '..') base = 'download';
        const ext = path.extname(base);
        const stem = ext ? base.slice(0, -ext.length) : base;
        let candidate = path.join(downloadsDir, base);
        if (!fs.existsSync(candidate)) return candidate;
        for (let n = 1; n < 10000; n++) {
            candidate = path.join(downloadsDir, `${stem} (${n})${ext}`);
            if (!fs.existsSync(candidate)) return candidate;
        }
        return path.join(downloadsDir, `${stem}-${Date.now()}${ext}`);
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
            console.log('will-download', item.getFilename(), item.getURL(), webContents);
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            const initiatorTabId = webContents ? findTabIdForWebContents(webContents) : null;
            const useNativeSaveDialog = USE_NATIVE_SAVE_DIALOG;
            let presetSavePath = null;
            if (!useNativeSaveDialog) {
                try {
                    presetSavePath = allocateUniqueSavePath(item.getFilename());
                    item.setSavePath(presetSavePath);
                } catch (e) {
                    console.error('预设下载保存路径失败:', e);
                }
            }
            const record = {
                id,
                filename: item.getFilename() || 'download',
                url: item.getURL() || '',
                totalBytes: item.getTotalBytes() || 0,
                receivedBytes: 0,
                state: 'progressing',
                startTime: Date.now(),
                endTime: null,
                savePath: useNativeSaveDialog ? null : presetSavePath,
                etaSeconds: null,
                /** 不落盘，仅进行中有效 */
                _downloadItem: item,
                /** 有保存路径或开始传输后再写入列表 */
                _listedInHistory: false,
                /** 发起下载的标签页（多为 target=_blank 新标签），结束后尝试关闭 */
                _initiatorTabId: initiatorTabId,
                /** 走系统另存为（未 setSavePath）时为 true */
                _usesNativeSaveDialog: useNativeSaveDialog,
                /**
                 * idle | after_will | after_blur | dialog_opened
                 * 另存为推断：will-download → 主窗口 blur → 本条 item 的 updated
                 */
                _dialogPhase: useNativeSaveDialog ? 'after_will' : 'idle',
                _pendingCloseInitiatorTab: false,
                _mainWindowFocusedAfterNativeDialog: false
            };
            if (useNativeSaveDialog) {
                nativeSaveDialogBlurTargetRecord = record;
            }

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
                console.log('download.item.on updated', state, record._usesNativeSaveDialog,record._dialogPhase);
                if (record._usesNativeSaveDialog && record._dialogPhase === 'after_blur') {
                    record._dialogPhase = 'dialog_opened';
                }
                record.receivedBytes = item.getReceivedBytes();
                record.totalBytes = item.getTotalBytes() || record.totalBytes;
                if (state === 'interrupted') record.state = 'interrupted';
                updateEta(record);
                tryListOnProgress();
                if (record._listedInHistory) {
                    notifyPanelItemUpdated(record);
                    schedulePersist(false);
                }

                //点了保存
                if(record._mainWindowFocusedAfterNativeDialog){
                    requestCloseInitiatorTabAfterUserDisposition(record);
                }
            });

            item.once('done', (_e, state) => {
                if (nativeSaveDialogBlurTargetRecord === record) {
                    nativeSaveDialogBlurTargetRecord = null;
                }
                const terminal = state === 'completed' ? 'completed' : state;

                if (!record._listedInHistory) {
                    if (terminal === 'cancelled' || terminal === 'interrupted') {
                        record._downloadItem = null;
                        requestCloseInitiatorTabAfterUserDisposition(record);
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
                    requestCloseInitiatorTabAfterUserDisposition(record);
                    return;
                }

                if (!recentDownloads.some((r) => r.id === record.id)) {
                    record._downloadItem = null;
                    requestCloseInitiatorTabAfterUserDisposition(record);
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
                requestCloseInitiatorTabAfterUserDisposition(record);
            });

            tryListOnProgress();
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

    return { hideDownloadsPanel, onMainWindowBlur, onMainWindowFocus };
};
