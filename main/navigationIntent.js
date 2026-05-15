/**
 * 标签页 WebContents 的「即将卸载」意图识别（beforeunload / will-prevent-unload 场景）。
 * 结合 preload 上报、主进程操作标记、did-start-navigation 与快捷键推断来源。
 */

const INTENT_TTL_MS = 8000;

/** @type {WeakMap<import('electron').WebContents, { type: string, meta?: object, at: number, expires: number }>} */
const intents = new WeakMap();

const REASON_LABELS = {
    'js-reload': 'location.reload()',
    'js-href-reload': 'location.href 同 URL（或 assign/replace 同 URL）',
    'js-navigate': 'location 跳转到其它 URL',
    'main-reload': '主进程 webContents.reload()',
    'main-reload-ignore-cache': '主进程 reloadIgnoringCache()',
    'keyboard-reload': 'F5 / Ctrl+R / Cmd+R',
    'same-url-navigation': '同 URL 导航（工具栏刷新等，preload 未细分）',
    'navigate-away': '跳转到其它页面',
    'back-forward': '前进 / 后退',
    close: '关闭标签 / 关窗口',
    unknown: '未知来源'
};

/**
 * 记录某 WebContents 即将发生的导航/卸载意图（短时有效，供 will-prevent-unload 读取）。
 * @param {import('electron').WebContents} webContents
 * @param {string} type - 见 REASON_LABELS 的键
 * @param {object} [meta] - 附加信息，如 via: 'href' | 'assign'
 */
function setNavigationIntent(webContents, type, meta) {
    if (!webContents || webContents.isDestroyed()) return;
    intents.set(webContents, {
        type,
        meta: meta || {},
        at: Date.now(),
        expires: Date.now() + INTENT_TTL_MS
    });
}

/**
 * 读取未过期的导航意图。
 * @param {import('electron').WebContents} webContents
 */
function getNavigationIntent(webContents) {
    if (!webContents || webContents.isDestroyed()) return null;
    const item = intents.get(webContents);
    if (!item || Date.now() > item.expires) {
        intents.delete(webContents);
        return null;
    }
    return item;
}

/**
 * 清除意图，避免影响下一次卸载。
 * @param {import('electron').WebContents} webContents
 */
function clearNavigationIntent(webContents) {
    if (webContents && !webContents.isDestroyed()) {
        intents.delete(webContents);
    }
}

/**
 * 将意图类型转为可读中文说明。
 * @param {string} type
 */
function getReasonLabel(type) {
    return REASON_LABELS[type] || REASON_LABELS.unknown;
}

/**
 * 解析 will-prevent-unload 时的最终原因（优先 preload/主进程显式标记）。
 * @param {import('electron').WebContents} webContents
 */
function resolveUnloadReason(webContents) {
    const intent = getNavigationIntent(webContents);
    if (intent) {
        return {
            type: intent.type,
            label: getReasonLabel(intent.type),
            meta: intent.meta,
            source: 'explicit'
        };
    }
    return {
        type: 'unknown',
        label: REASON_LABELS.unknown,
        meta: {},
        source: 'none'
    };
}

/**
 * 从 did-start-navigation 推断意图（仅在没有更具体的 preload 标记时写入）。
 * @param {import('electron').WebContents} webContents
 * @param {string} targetUrl
 * @param {boolean} isMainFrame
 * @param {boolean} [isSameDocument]
 */
function inferFromDidStartNavigation(webContents, targetUrl, isMainFrame, isSameDocument) {
    if (!isMainFrame) return;
    const existing = getNavigationIntent(webContents);
    if (existing && existing.type.startsWith('js-')) return;

    const currentUrl = webContents.getURL();
    if (targetUrl === 'about:blank') {
        setNavigationIntent(webContents, 'close');
        return;
    }
    if (isSameDocument) return;
    if (targetUrl === currentUrl) {
        if (!existing) {
            setNavigationIntent(webContents, 'same-url-navigation', { targetUrl });
        }
        return;
    }
    if (!existing) {
        setNavigationIntent(webContents, 'navigate-away', { from: currentUrl, to: targetUrl });
    }
}

/**
 * 注册 preload 上报的 IPC（browser-view-navigation-intent）。
 * @param {import('electron').IpcMain} ipcMain
 */
function registerNavigationIntentIpc(ipcMain) {
    ipcMain.on('browser-view-navigation-intent', (event, payload) => {
        const wc = event.sender;
        if (!wc || wc.isDestroyed()) return;
        const type = payload && payload.type;
        if (!type) return;
        setNavigationIntent(wc, type, {
            via: payload.via,
            url: payload.url
        });
    });
}

module.exports = {
    setNavigationIntent,
    getNavigationIntent,
    clearNavigationIntent,
    getReasonLabel,
    resolveUnloadReason,
    inferFromDidStartNavigation,
    registerNavigationIntentIpc,
    REASON_LABELS
};
