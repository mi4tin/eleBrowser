const { contextBridge, ipcRenderer } = require('electron');

// 标签页内点击网页时通知主进程，用于关闭书签下拉、地址栏历史浮层（主界面收不到这些点击）
window.addEventListener(
    'mousedown',
    () => {
        try {
            ipcRenderer.send('dismiss-overlays-from-browser-view');
        } catch (_e) {
            /* ignore */
        }
    },
    true
);

// 暴露一个受限的 API 给 BrowserView 中的页面，避免开启 nodeIntegration
contextBridge.exposeInMainWorld('electronAPI', {
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    once: (channel, listener) => ipcRenderer.once(channel, (event, ...args) => listener(event, ...args)),
    on: (channel, listener) => {
        const wrapped = (event, ...args) => listener(event, ...args);
        ipcRenderer.on(channel, wrapped);
        return () => ipcRenderer.removeListener(channel, wrapped);
    }
});

/**
 * 向主进程上报页面内触发的导航意图（用于区分 reload / href 自赋值 / 跳转）。
 * @param {string} type - js-reload | js-href-reload | js-navigate
 * @param {object} [extra]
 */
function notifyNavigationIntent(type, extra) {
    try {
        console.log("notifyNavigationIntent", type, extra);
        ipcRenderer.send('browser-view-navigation-intent', Object.assign({ type }, extra || {}));
    } catch (_e) {
        /* ignore */
    }
}

/**
 * 判断目标 URL 是否与当前页为同一文档地址（用于识别 location.href = location.href）。
 * @param {string} target
 */
function isSameDocumentUrl(target) {
    try {
        const current = window.location.href;
        return new URL(target, current).href === current;
    } catch (_e) {
        return false;
    }
}

const originalLocation = {
    reload: window.location.reload.bind(window.location),
    assign: window.location.assign.bind(window.location),
    replace: window.location.replace.bind(window.location)
};

window.location.reload = (...args) => {
    notifyNavigationIntent('js-reload', { via: 'reload' });
    return originalLocation.reload(...args);
};

window.location.assign = (url) => {
    if (isSameDocumentUrl(url)) {
        notifyNavigationIntent('js-href-reload', { via: 'assign', url: String(url) });
    } else {
        notifyNavigationIntent('js-navigate', { via: 'assign', url: String(url) });
    }
    return originalLocation.assign(url);
};

window.location.replace = (url) => {
    if (isSameDocumentUrl(url)) {
        notifyNavigationIntent('js-href-reload', { via: 'replace', url: String(url) });
    } else {
        notifyNavigationIntent('js-navigate', { via: 'replace', url: String(url) });
    }
    return originalLocation.replace(url);
};

// location.href = 当前 URL：尽量 hook href setter（部分站点可能失败，主进程仍有同 URL 导航兜底）
try {
    const hrefDesc =
        Object.getOwnPropertyDescriptor(Location.prototype, 'href') ||
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window.location), 'href');
    if (hrefDesc && hrefDesc.set) {
        const nativeSet = hrefDesc.set;
        Object.defineProperty(window.location, 'href', {
            configurable: true,
            enumerable: hrefDesc.enumerable,
            get: hrefDesc.get
                ? function hrefGet() {
                      return hrefDesc.get.call(this);
                  }
                : undefined,
            set(value) {
                if (isSameDocumentUrl(value)) {
                    notifyNavigationIntent('js-href-reload', { via: 'href', url: String(value) });
                } else {
                    notifyNavigationIntent('js-navigate', { via: 'href', url: String(value) });
                }
                return nativeSet.call(this, value);
            }
        });
    }
} catch (e) {
    console.warn('[preload-browserview] location.href hook failed:', e);
}
