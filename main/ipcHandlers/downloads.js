const { shell, clipboard, Menu, dialog } = require('electron');
const ipcTool = require('./ipcTool');

const MAX_ITEMS = 40;
const PANEL_W = 384;
const PANEL_H = 420;
const STORE_VERSION = 1;
const SAVE_DEBOUNCE_MS = 400;
/**
 * 是否「下载前询问保存位置」由 profile 下载设置页写入的 download-settings.json（askBeforeDownload）控制。
 */
const USE_CRDOWNLOAD_PLACEHOLDER = true;//这个不要修改

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

    ipcTool.initUserDataPath(app);

    /** @type {BrowserWindow | null} */
    let downloadsPanelWindow = null;
    /** @type {Array<object>} */
    const recentDownloads = [];
    let willDownloadAttached = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let saveDebounceTimer = null;
    /**
     * 「另存为 + .crdownload」：用户在 showSaveDialog 确认后进队，紧随其后的同 URL 的 will-download 消费。
     * @type {{ url: string, finalPath: string, initiatorTabId: number | null }[]}
     */
    const saveAsCrPassQueue = [];

    /**
     * 弹窗的正在下载的记录 key：record.id,value：_pendingRenameTo
     */ 
    const dialogDownloadingMap = new Map();

    function getStorePath() {
        return path.join(app.getPath('userData'), 'downloads-history.json');
    }

    function loadDownloadsHistory() {
        console.log('download.loadDownloadsHistory');
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

    function tryFlushPendingCloseInitiatorTab(record) {
        if (!record || !record._pendingCloseInitiatorTab) return;
        const mw = getMainWindow();
        if (mw && !mw.isDestroyed() && mw.isFocused()) {
            record._pendingCloseInitiatorTab = false;
            closeDownloadInitiatorTab(record);
        }
    }

    function requestCloseInitiatorTabAfterUserDisposition(record) {
        if (record._initiatorTabId == null) return;
        if (record._initiatorTabId!=null) {
            record._pendingCloseInitiatorTab = true;
            console.log('download.close.tab.2');
            tryFlushPendingCloseInitiatorTab(record);
            return;
        }
        console.log('download.close.tab.1');
        closeDownloadInitiatorTab(record);
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

    /** 候选路径是否不可用：磁盘已存在，或另存为双阶段队列已预定的 finalPath */
    function isAllocateSavePathTaken(candidate) {
        try {
            if (fs.existsSync(candidate)) return true;
        } catch (_e) {
            return true;
        }
        let norm;
        try {
            norm = path.normalize(candidate);
        } catch (_e) {
            return true;
        }

        console.log('download.isAllocateSavePathTaken.1',saveAsCrPassQueue);
        for (const [key, finalPath] of dialogDownloadingMap) {
            if (!finalPath) continue;
            try {
                if (path.normalize(finalPath) === norm) return true;
            } catch (_e) {
                /* ignore */
            }
        }
        return false;
    }

    /** 在配置的默认下载目录内生成不冲突的绝对保存路径 */
    function allocateUniqueSavePath(rawFilename) {
        console.log('download.allocateUniqueSavePath.1',ipcTool.getEffectiveDownloadDir(),app.getPath('downloads'));
        const downloadsDir = ipcTool.getEffectiveDownloadDir() || app.getPath('downloads');
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
        }
        let base = typeof rawFilename === 'string' ? path.basename(rawFilename) : '';
        if (!base || base === '.' || base === '..') base = 'download';
        const ext = path.extname(base);
        const stem = ext ? base.slice(0, -ext.length) : base;
        let candidate = path.join(downloadsDir, base);
        if (!isAllocateSavePathTaken(candidate)) return candidate;
        for (let n = 1; n < 10000; n++) {
            candidate = path.join(downloadsDir, `${stem} (${n})${ext}`);
            if (!isAllocateSavePathTaken(candidate)) return candidate;
        }
        for (let k = 0; k < 100; k++) {
            candidate = path.join(downloadsDir, `${stem}-${Date.now()}-${k}${ext}`);
            if (!isAllocateSavePathTaken(candidate)) return candidate;
        }
        return path.join(downloadsDir, `${stem}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`);
    }

    /** 与 Chrome 类似的进行中占位名：未确认 <随机数>.crdownload（中文系统与资源管理器展示一致） */
    function allocateUniqueTempCrdownloadPath(targetDir) {
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        for (let k = 0; k < 10000; k++) {
            const n = Math.floor(Math.random() * 1e9);
            const p = path.join(targetDir, `未确认 ${n}.crdownload`);
            if (!fs.existsSync(p)) return p;
        }
        return path.join(targetDir, `未确认 ${Date.now()}.crdownload`);
    }

    /**
     * 根据完成态处理 savePath：若曾用 .crdownload 占位则 completed 时 rename 到 _pendingRenameTo；
     * cancelled 删除占位文件；interrupted 保留占位文件（便于内核续传）。
     */
    function assignFinalSavePathAfterTerminal(record, item, terminal) {
        let tmpPath = null;
        try {
            tmpPath = item.getSavePath() || null;
        } catch (_e) {
            tmpPath = null;
        }
        const pendingFinal = record._pendingRenameTo;
        if (!pendingFinal) {
            record.savePath = tmpPath != null ? tmpPath : record.savePath;
            return;
        }

        if (terminal === 'completed' && tmpPath && fs.existsSync(tmpPath)) {
            try {
                fs.renameSync(tmpPath, pendingFinal);
                record.savePath = pendingFinal;
            } catch (e) {
                console.error('下载完成后重命名为最终文件失败:', e);
                record.savePath = tmpPath;
            }

            dialogDownloadingMap.delete(record.id);//删除弹窗下载中记录
            record._pendingRenameTo = null;
            return;
        }

        if (terminal === 'cancelled' && tmpPath && fs.existsSync(tmpPath)) {
            try {
                fs.unlinkSync(tmpPath);
            } catch (_e) {
                /* ignore */
            }
            record.savePath = null;
            record._pendingRenameTo = null;

            dialogDownloadingMap.delete(record.id);//删除弹窗下载中记录
            return;
        }

        dialogDownloadingMap.delete(record.id);//删除弹窗下载中记录

        record.savePath = tmpPath != null ? tmpPath : record.savePath;
        record._pendingRenameTo = null;
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
        if (willDownloadAttached) {console.log('download.attachWillDownload.1');return};
        willDownloadAttached = true;
        session.defaultSession.on('will-download', (event, item, webContents) => {
            const url = item.getURL() || '';
            let initiatorTabId = webContents ? findTabIdForWebContents(webContents) : null;
            const dlRead = ipcTool.readDownloadSettingsFile();
            const dlData = dlRead.success && dlRead.data ? dlRead.data : ipcTool.defaultDownloadSettings();
            const askNative = dlData.askBeforeDownload !== false;
            const wantSaveAsCr = askNative && USE_CRDOWNLOAD_PLACEHOLDER;

            let secondPass = false;
            let useNativeSaveDialog = askNative;
            /** 另存为+.crdownload 第二阶段 record 的初始 _dialogPhase（继承第一阶段 blur 结果） */
            let secondPassDialogPhase = 'after_will';
            let presetSavePath = null;
            /** 完成后 rename 到此最终绝对路径（静默或另存为双阶段） */
            let pendingRenameTo = null;
            let diskWritePath = null;

            if (wantSaveAsCr && saveAsCrPassQueue.length > 0) {
                const head = saveAsCrPassQueue[0];
                if (head.url === url) {
                    saveAsCrPassQueue.shift();
                    secondPass = true;
                    useNativeSaveDialog = false;
                    secondPassDialogPhase = 'after_will';
                    if (head.initiatorTabId != null) initiatorTabId = head.initiatorTabId;
                    pendingRenameTo = head.finalPath;
                    try {
                        diskWritePath = allocateUniqueTempCrdownloadPath(path.dirname(head.finalPath));
                        item.setSavePath(diskWritePath);
                    } catch (e) {
                        console.error('另存为第二阶段 setSavePath(.crdownload) 失败:', e);
                        pendingRenameTo = null;
                        diskWritePath = null;
                    }
                    if (secondPass && !diskWritePath) {
                        try {
                            item.cancel();
                        } catch (_e) {
                            /* ignore */
                        }
                        return;
                    }
                }
            }

            if (wantSaveAsCr && !secondPass) {
                event.preventDefault();
                const filename = item.getFilename() || 'download';
                const wc = webContents;
                const initTab = initiatorTabId;
                setImmediate(() => {
                    void (async () => {
                        try {
                            const suggested = allocateUniqueSavePath(filename);
                            const mw = getMainWindow();
                            const opts = { defaultPath: suggested, title: '另存为' };//设置对话弹窗的默认路径和标题
                            if (mw && !mw.isDestroyed()) opts.window = mw;
                            const { canceled, filePath } = await dialog.showSaveDialog(opts);
                            if (canceled || !filePath) {
                                
                                console.log('download.downloadURL.2 取消',canceled,filePath);
                                if (initTab != null) {
                                    const stub = { _initiatorTabId: initTab, url };
                                    closeDownloadInitiatorTab(stub);
                                }
                                return;
                            }

                            console.log('download.downloadURL.3 保存',filePath);
                            
                            saveAsCrPassQueue.push({
                                url,
                                finalPath: filePath,
                                initiatorTabId: initTab,
                            });
                            
                            console.log('download.downloadURL.1',wc.isDestroyed());
                            if (wc && !wc.isDestroyed()) {
                                console.log('download.downloadURL',url);
                                wc.downloadURL(url);
                            }
                        } catch (e) {
                            console.error('另存为对话框失败:', e);
                        }
                    })();
                });
                return;
            }

            if (!secondPass && !askNative) {
                try {
                    presetSavePath = allocateUniqueSavePath(item.getFilename());
                    diskWritePath = presetSavePath;
                    if (USE_CRDOWNLOAD_PLACEHOLDER) {
                        pendingRenameTo = presetSavePath;
                        diskWritePath = allocateUniqueTempCrdownloadPath(path.dirname(presetSavePath));
                    }
                    item.setSavePath(diskWritePath);
                } catch (e) {
                    console.error('预设下载保存路径失败:', e);
                    presetSavePath = null;
                    diskWritePath = null;
                    pendingRenameTo = null;
                }
            } else if (!secondPass && askNative) {
                try {
                    const suggestedPath = allocateUniqueSavePath(item.getFilename());
                    item.setSaveDialogOptions({ defaultPath: suggestedPath });
                } catch (e) {
                    console.error('设置另存为默认路径失败:', e);
                }
            }
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
                savePath: useNativeSaveDialog ? null : diskWritePath || presetSavePath,
                etaSeconds: null,
                /** 静默 + 占位下载时：完成后 rename 到该绝对路径 */
                _pendingRenameTo: pendingRenameTo,
                /** 不落盘，仅进行中有效 */
                _downloadItem: item,
                /** 有保存路径或开始传输后再写入列表 */
                _listedInHistory: false,
                /** 发起下载的标签页（多为 target=_blank 新标签），结束后尝试关闭 */
                _initiatorTabId: initiatorTabId,
                /**
                 * 为 true：仍由 Chromium 处理「下载另存为」（未 setSavePath），配合主窗口 blur 推断对话框。
                 * 另存为 + .crdownload 双阶段时，第二阶段已 setSavePath 到 .crdownload，故为 false（不是 bug）。
                 */
                _usesNativeSaveDialog: useNativeSaveDialog,
                /** 另存为 + .crdownload：用户已在 showSaveDialog 选过路径，当前为第二次 will-download */
                _saveAsCrSecondPhase: secondPass,
                /**
                 * idle | after_will | after_blur | dialog_opened
                 * 另存为推断：will-download → 主窗口 blur → 本条 item 的 updated；
                 * 另存为+.crdownload 第二阶段继承第一阶段 stub 上的阶段。
                 */
                _dialogPhase: useNativeSaveDialog
                    ? 'after_will'
                    : wantSaveAsCr && secondPass
                      ? secondPassDialogPhase
                      : 'idle',
                _pendingCloseInitiatorTab: false,
                _mainWindowFocusedAfterNativeDialog: false
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

                dialogDownloadingMap.set(record.id,record._pendingRenameTo);
                const removedIds = pushRecent(record);
                notifyPanelItemUpdated(record);
                for (const rid of removedIds) {
                    notifyPanelItemRemoved(rid);
                }
            }

            //一阶段，不会触发该事件
            item.on('updated', (_e, state) => {
                console.log('download.item.on updated',state,record.url,record.id,record._pendingRenameTo);
                if (record._dialogPhase === 'after_blur') {
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
                
                if(record._pendingCloseInitiatorTab==false){
                    requestCloseInitiatorTabAfterUserDisposition(record);//关闭标签
                }
            });

            //一阶段，不会触发该事件
            item.once('done', (_e, state) => {
                console.log('download.item.once done',state,record.url,record.id);

                const terminal = state === 'completed' ? 'completed' : state;
                
                if (!record._listedInHistory) {
                    if (terminal === 'cancelled' || terminal === 'interrupted') {
                        assignFinalSavePathAfterTerminal(record, item, terminal);
                        record._downloadItem = null;
                        requestCloseInitiatorTabAfterUserDisposition(record);
                        return;
                    }
                    record.receivedBytes = item.getReceivedBytes();
                    record.totalBytes = item.getTotalBytes() || record.receivedBytes;
                    record.endTime = Date.now();
                    assignFinalSavePathAfterTerminal(record, item, terminal);
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
                    assignFinalSavePathAfterTerminal(record, item, terminal);
                    record._downloadItem = null;
                    requestCloseInitiatorTabAfterUserDisposition(record);
                    return;
                }
                record.receivedBytes = item.getReceivedBytes();
                record.totalBytes = item.getTotalBytes() || record.receivedBytes;
                record.endTime = Date.now();
                assignFinalSavePathAfterTerminal(record, item, terminal);
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

    ipcMain.handle('download-settings-get', () => {
        const r = ipcTool.readDownloadSettingsFile();
        const data = r.success && r.data ? r.data : ipcTool.defaultDownloadSettings();
        const effective = ipcTool.getEffectiveDownloadDir() || app.getPath('downloads');
        const rawDir = data.downloadDir && String(data.downloadDir).trim();
        const downloadDirDisplay = rawDir ? effective : `${app.getPath('downloads')}（系统默认）`;
        return { ...data, downloadDirDisplay };
    });

    ipcMain.handle('download-settings-set', (_event, patch) => {
        if (!patch || typeof patch !== 'object') return { ok: false };
        const allowed = {};
        if (typeof patch.downloadDir === 'string') allowed.downloadDir = patch.downloadDir;
        if (typeof patch.askBeforeDownload === 'boolean') allowed.askBeforeDownload = patch.askBeforeDownload;
        if (typeof patch.openAfterDownload === 'boolean') allowed.openAfterDownload = patch.openAfterDownload;
        if (typeof patch.showDownloadNotification === 'boolean') {
            allowed.showDownloadNotification = patch.showDownloadNotification;
        }
        if (typeof patch.playNotificationSound === 'boolean') {
            allowed.playNotificationSound = patch.playNotificationSound;
        }
        if (patch.maxConcurrentDownloads != null) allowed.maxConcurrentDownloads = String(patch.maxConcurrentDownloads);
        if (typeof patch.dangerousFileAction === 'string') allowed.dangerousFileAction = patch.dangerousFileAction;
        if (patch.keepHistoryDuration != null) allowed.keepHistoryDuration = String(patch.keepHistoryDuration);
        const res = ipcTool.patchDownloadSettingsFile(allowed);
        return { ok: res.success, data: res.data };
    });

    ipcMain.handle('download-settings-pick-directory', async (event) => {
        const senderWin = BrowserWindow.fromWebContents(event.sender);
        const mw = senderWin && !senderWin.isDestroyed() ? senderWin : getMainWindow();
        const res = await dialog.showOpenDialog(mw && !mw.isDestroyed() ? mw : undefined, {
            title: '选择默认下载文件夹',
            properties: ['openDirectory', 'createDirectory']
        });
        if (res.canceled || !res.filePaths || !res.filePaths[0]) {
            return { canceled: true };
        }
        return { canceled: false, path: res.filePaths[0] };
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
        const p = ipcTool.getEffectiveDownloadDir() || app.getPath('downloads');
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
        console.log('download.downloads-item-cancel',id);
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
