module.exports = function createUnderlineContextMenu(deps) {
    const {
        app,
        ipcMain,
        BrowserWindow,
        Menu,
        fs,
        path,
        setupProtocolBlocking,
        getMainWindow,
        getLastActiveTabId
    } = deps;

    const underlineFilePath = path.join(app.getPath('userData'), 'underline.json');
    const webviewContentsMap = new Map();
    const underlineMode = 1;
    let resetUnerlineNameIndexMap = {};
    let underlineNameIndex = 1;

    function ensureUserDataDir() {
        const userDataPath = app.getPath('userData');
        if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
        }
    }

    const saveUnderlineDirect = async (url, underlineInfo) => {
        try {
            console.log('开始保存划线数据:', url, underlineInfo);
            ensureUserDataDir();

            let underlineData = {};
            if (fs.existsSync(underlineFilePath)) {
                try {
                    const data = fs.readFileSync(underlineFilePath, 'utf8');
                    underlineData = JSON.parse(data);
                } catch (readError) {
                    console.error('读取划线数据文件失败:', readError);
                    underlineData = {};
                }
            }

            if (!underlineData[url]) {
                underlineData[url] = [];
            }
            underlineData[url].push(underlineInfo);
            fs.writeFileSync(underlineFilePath, JSON.stringify(underlineData, null, 2), 'utf8');
            console.log('成功保存划线数据:', url, underlineInfo.text);
        } catch (e) {
            console.error('保存划线数据失败:', e);
            console.error('错误详情:', e.stack);
        }
    };

    async function restoreUnderlineInBrowserView(contents, underlineInfo, underlineNameIndexP) {
        try {
            underlineInfo.mode = underlineInfo.mode || 1;
            underlineInfo.occurrenceIndex = underlineInfo.occurrenceIndex || 0;

            const hasUnderlineNameIndexP = !!underlineNameIndexP;
            if (!hasUnderlineNameIndexP) {
                underlineNameIndexP = underlineNameIndex;
            }

            const underlineCount = await contents.executeJavaScript(
                `(function(text, mode, occurrenceIndex) {
                if (!document.getElementById('underline-styles')) {
                    const style = document.createElement('style');
                    style.id = 'underline-styles';
                    style.textContent = '.underline-fb3b780f { text-decoration: underline; text-decoration-color: green; text-decoration-style: solid; text-decoration-thickness: 2px; text-underline-offset: 3px; }';
                    document.head.appendChild(style);
                }

                function getTextNodeAtPosition(container, offset) {
                    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
                    let currentPos = 0;
                    let node;
                    while ((node = walker.nextNode())) {
                        if (/^\\s+$/.test(node.textContent)) continue;
                        const nodeLength = node.textContent.length;
                        if (offset < currentPos + nodeLength) {
                            return { node: node, offset: offset - currentPos };
                        }
                        currentPos += nodeLength;
                    }
                    throw new Error('Offset  out of range');
                }

                function wrapTextNodeSegment(node, start, end, index) {
                    const parent = node.parentNode;
                    if (!parent) return;
                    if (parent.classList && parent.classList.contains('underline-fb3b780f')) return;
                    const content = node.textContent;
                    const fragment = document.createDocumentFragment();
                    if (start > 0) fragment.appendChild(document.createTextNode(content.substring(0, start)));
                    const span = document.createElement('span');
                    span.className = 'underline-fb3b780f';
                    span.setAttribute('name', 'underline-fb3b780f-name${underlineNameIndexP}');
                    span.setAttribute('data-occurrence-index', index);
                    span.textContent = content.substring(start, end);
                    fragment.appendChild(span);
                    if (end < content.length) fragment.appendChild(document.createTextNode(content.substring(end)));
                    parent.replaceChild(fragment, node);
                }

                function handleMultiNodeRange(startNode, startOffset, endNode, endOffset, index) {
                    const startParent = startNode.parentNode;
                    if (startParent) {
                        const startContent = startNode.textContent;
                        const startFrag = document.createDocumentFragment();
                        const underlineSpan = document.createElement('span');
                        underlineSpan.className = 'underline-fb3b780f';
                        underlineSpan.setAttribute('name', 'underline-fb3b780f-name${underlineNameIndexP}');
                        underlineSpan.setAttribute('data-occurrence-index', index);
                        underlineSpan.textContent = startContent.substring(startOffset);
                        startFrag.appendChild(underlineSpan);
                        if (startOffset > 0) {
                            const beforeText = document.createTextNode(startContent.substring(0, startOffset));
                            startFrag.insertBefore(beforeText, underlineSpan);
                        }
                        startParent.replaceChild(startFrag, startNode);
                    }

                    const endParent = endNode.parentNode;
                    if (endParent) {
                        const endContent = endNode.textContent;
                        const endFrag = document.createDocumentFragment();
                        const underlineSpan = document.createElement('span');
                        underlineSpan.className = 'underline-fb3b780f';
                        underlineSpan.setAttribute('name', 'underline-fb3b780f-name${underlineNameIndexP}');
                        underlineSpan.setAttribute('data-occurrence-index', index);
                        underlineSpan.textContent = endContent.substring(0, endOffset);
                        endFrag.appendChild(underlineSpan);
                        if (endOffset < endContent.length) {
                            const afterText = document.createTextNode(endContent.substring(endOffset));
                            endFrag.appendChild(afterText);
                        }
                        endParent.replaceChild(endFrag, endNode);
                    }

                    let currentNode = startNode.nextSibling;
                    while (currentNode && currentNode !== endNode) {
                        if (currentNode.nodeType === Node.TEXT_NODE && currentNode.parentNode) {
                            const parent = currentNode.parentNode;
                            const content = currentNode.textContent;
                            if (content.length > 0) {
                                const span = document.createElement('span');
                                span.className = 'underline-fb3b780f';
                                span.setAttribute('name', 'underline-fb3b780f-name${underlineNameIndexP}');
                                span.setAttribute('data-occurrence-index', index);
                                span.textContent = content;
                                parent.replaceChild(span, currentNode);
                            }
                        }
                        currentNode = currentNode.nextSibling;
                    }
                }

                function underlineAllMatches(container, text, mode, matchIndex) {
                    if (!container || !text) return 0;
                    let fullText = '';
                    const tw = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
                    let tn;
                    while ((tn = tw.nextNode())) {
                        if (!/^\\s+$/.test(tn.textContent)) fullText += tn.textContent;
                    }
                    const matches = [];
                    let pos = 0;
                    while ((pos = fullText.indexOf(text, pos)) !== -1) {
                        matches.push({ start: pos, end: pos + text.length });
                        pos += text.length;
                    }
                    if (matches.length === 0) return 0;

                    let matchesToProcess = [];
                    if (mode === 1 && matchIndex >= 0) {
                        if (matchIndex >= 0 && matchIndex < matches.length) {
                            matchesToProcess = [matches[matchIndex]];
                        } else {
                            return 0;
                        }
                    } else {
                        matchesToProcess = matches.slice();
                    }

                    matchesToProcess.sort((a, b) => b.end - a.end);
                    let index = 0;
                    matchesToProcess.forEach(match => {
                        try {
                            index++;
                            const startInfo = getTextNodeAtPosition(container, match.start);
                            const endInfo = getTextNodeAtPosition(container, match.end - 1);
                            if (startInfo.node === endInfo.node) {
                                wrapTextNodeSegment(startInfo.node, startInfo.offset, endInfo.offset + 1, index);
                            } else {
                                handleMultiNodeRange(startInfo.node, startInfo.offset, endInfo.node, endInfo.offset + 1, index);
                            }
                        } catch (e) {
                            console.warn('⚠️ 处理匹配失败:', match, e);
                        }
                    });
                    return matchesToProcess.length;
                }

                return underlineAllMatches(document.body, text, mode, occurrenceIndex);
            })('${underlineInfo.text}', ${underlineInfo.mode}, ${underlineInfo.occurrenceIndex})`
            );

            if (underlineCount === 0) {
                setTimeout(() => {
                    if (resetUnerlineNameIndexMap[underlineNameIndexP]) return;
                    resetUnerlineNameIndexMap[underlineNameIndexP] = 1;
                    restoreUnderlineInBrowserView(contents, underlineInfo, underlineNameIndexP);
                }, 1000);
            }

            if (!hasUnderlineNameIndexP) {
                underlineNameIndex++;
            }
            return underlineCount;
        } catch (error) {
            console.error('恢复划线失败:', error);
            return -1;
        }
    }

    async function loadAndRestoreUnderline(url, contents) {
        try {
            console.log('加载划线数据请求:', url);
            let underlineData = {};
            if (fs.existsSync(underlineFilePath)) {
                const data = fs.readFileSync(underlineFilePath, 'utf8');
                underlineData = JSON.parse(data);
            }
            const underlines = underlineData[url] || [];
            if (underlines && underlines.length > 0) {
                underlineNameIndex = 1;
                resetUnerlineNameIndexMap = {};
                for (const underlineInfo of underlines) {
                    await restoreUnderlineInBrowserView(contents, underlineInfo);
                }
            }
        } catch (error) {
            console.error('加载划线数据失败:', error);
        }
    }

    function handleAddUnderline(contents, mode = underlineMode) {
        contents.executeJavaScript('window.getSelection().toString()').then((selectedText) => {
            const url = contents.getURL();
            if (!url || !selectedText || !selectedText.trim()) return;

            selectedText = selectedText.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '').replace(/\r/g, '');
            const underlineInfo = {
                text: selectedText,
                timestamp: Date.now(),
                url,
                mode,
                occurrenceIndex: 0
            };

            const addUnderlinePromise = (mode === 2)
                ? restoreUnderlineInBrowserView(contents, underlineInfo)
                : contents.executeJavaScript(
                    `(function(selectedText, mode) {
                    if (!document.getElementById('underline-styles')) {
                        const style = document.createElement('style');
                        style.id = 'underline-styles';
                        style.textContent = '.underline-fb3b780f { text-decoration: underline; text-decoration-color: green; text-decoration-style: solid; text-decoration-thickness: 2px; text-underline-offset: 3px; }';
                        document.head.appendChild(style);
                    }
                    const result = { spans: [], occurrenceIndex: 0 };
                    const selectedTextObj = window.getSelection();
                    if (selectedTextObj.rangeCount > 0) {
                        const range = selectedTextObj.getRangeAt(0);
                        const span = document.createElement('span');
                        span.className = 'underline-fb3b780f';
                        try {
                            range.surroundContents(span);
                        } catch (e) {
                            const contents = range.extractContents();
                            span.appendChild(contents);
                            range.insertNode(span);
                        }
                        result.spans.push(span);
                    }
                    return { occurrenceIndex: 0, spansCount: result.spans.length };
                })('${selectedText}', ${mode})`
                );

            underlineNameIndex++;
            addUnderlinePromise.then((result) => {
                if (mode === 1) {
                    underlineInfo.occurrenceIndex = result.occurrenceIndex;
                }
                saveUnderlineDirect(url, underlineInfo);
            }).catch((err) => {
                console.log('添加下划线失败:', err);
            });
        }).catch((err) => {
            console.log('获取选中文本失败:', err);
        });
    }

    function handleRemoveUnderline(contents, underlineText = null) {
        const getTextPromise = underlineText ? Promise.resolve(underlineText) : contents.executeJavaScript('window.getSelection().toString()');
        getTextPromise.then((selectedText) => {
            contents.executeJavaScript(
                `(function() {
                const selectedTextObj = window.getSelection();
                let underlineNodes = [];
                let underlineText = '';
                if (selectedTextObj.rangeCount > 0) {
                    let currentNode = selectedTextObj.anchorNode;
                    while (currentNode && currentNode !== document.body) {
                        if (currentNode.classList && currentNode.classList.contains('underline-fb3b780f')) {
                            underlineNodes.push(currentNode);
                            underlineText = currentNode.textContent || currentNode.innerText || '';
                            break;
                        }
                        currentNode = currentNode.parentNode;
                    }
                } else {
                    const allUnderlineElements = document.querySelectorAll('.underline-fb3b780f');
                    if (allUnderlineElements.length > 0) underlineNodes.push(allUnderlineElements[0]);
                }
                underlineNodes.forEach(node => {
                    node.classList.remove('underline-fb3b780f');
                    node.removeAttribute('name');
                });
                return {
                    success: underlineNodes.length > 0,
                    removedCount: underlineNodes.length,
                    removedTexts: underlineNodes.map(node => node.textContent || node.innerText || ''),
                    underlineText
                };
            })()`
            ).then((result) => {
                const url = contents.getURL();
                selectedText = result.underlineText;
                if (!url) return;
                try {
                    let underlineData = {};
                    if (fs.existsSync(underlineFilePath)) {
                        const data = fs.readFileSync(underlineFilePath, 'utf8');
                        underlineData = JSON.parse(data);
                    }
                    if (!underlineData[url]) return;
                    if (selectedText && selectedText.trim()) {
                        underlineData[url] = underlineData[url].filter(item => item.text !== selectedText);
                    } else if (result.removedTexts && result.removedTexts.length > 0) {
                        result.removedTexts.forEach(removedText => {
                            underlineData[url] = underlineData[url].filter(item => item.text !== removedText);
                        });
                    }
                    if (underlineData[url].length === 0) {
                        delete underlineData[url];
                    }
                    fs.writeFileSync(underlineFilePath, JSON.stringify(underlineData, null, 2), 'utf8');
                } catch (e) {
                    console.error('删除划线失败:', e);
                }
            }).catch((err) => {
                console.log('取消下划线失败:', err);
            });
        }).catch((err) => {
            console.log('获取划线文本失败:', err);
        });
    }

    function handleViewSource(contents) {
        contents.executeJavaScript(`(function() {
            try { return document.documentElement.outerHTML; }
            catch(e) { return '<html><body>无法获取源码</body></html>'; }
        })()`).then((html) => {
            if (!html) html = '<html><body>无法获取源码</body></html>';
            const sourceWindow = new BrowserWindow({
                width: 1000,
                height: 700,
                title: '网页源码 - ' + (contents.getURL() || '未知页面'),
                webPreferences: { nodeIntegration: false, contextIsolation: true }
            });
            const escapedHtml = html
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
            const sourceHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>网页源码</title></head><body><pre>${escapedHtml}</pre></body></html>`;
            sourceWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(sourceHtml));
        }).catch((err) => {
            console.error('获取源码失败:', err);
        });
    }

    function registerUnderlineIpcHandlers() {
        ipcMain.handle('load-underline-data', async (event, url) => {
            try {
                let underlineData = {};
                if (fs.existsSync(underlineFilePath)) {
                    const data = fs.readFileSync(underlineFilePath, 'utf8');
                    underlineData = JSON.parse(data);
                }
                return underlineData[url] || [];
            } catch (e) {
                console.error('加载划线数据失败:', e);
                return [];
            }
        });

        ipcMain.handle('save-underline-data', async (event, url, underlineInfo) => {
            try {
                let underlineData = {};
                if (fs.existsSync(underlineFilePath)) {
                    const data = fs.readFileSync(underlineFilePath, 'utf8');
                    underlineData = JSON.parse(data);
                }
                if (!underlineData[url]) underlineData[url] = [];
                underlineData[url].push(underlineInfo);
                fs.writeFileSync(underlineFilePath, JSON.stringify(underlineData, null, 2), 'utf8');
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('update-underline-data', async (event, url, underlineArray) => {
            try {
                let underlineData = {};
                if (fs.existsSync(underlineFilePath)) {
                    const data = fs.readFileSync(underlineFilePath, 'utf8');
                    underlineData = JSON.parse(data);
                }
                underlineData[url] = underlineArray;
                fs.writeFileSync(underlineFilePath, JSON.stringify(underlineData, null, 2), 'utf8');
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        ipcMain.handle('save-underline-sync', async (event, url, underlineInfo) => {
            await saveUnderlineDirect(url, underlineInfo);
            return { success: true };
        });

        ipcMain.handle('get-all-underlines', async () => {
            try {
                if (fs.existsSync(underlineFilePath)) {
                    const data = fs.readFileSync(underlineFilePath, 'utf8');
                    return JSON.parse(data);
                }
                return {};
            } catch (e) {
                return {};
            }
        });
    }

    function registerWebContentsHandlers() {
        app.on('web-contents-created', (event, contents) => {
            setupProtocolBlocking(contents);
            contents.session.webRequest.onHeadersReceived((details, callback) => {
                const responseHeaders = details.responseHeaders || {};
                if (responseHeaders['content-security-policy']) {
                    responseHeaders['content-security-policy'] = responseHeaders['content-security-policy'].map(csp => {
                        if (csp.includes('connect-src')) return csp.replace(/connect-src ([^;]+)/g, 'connect-src $1 file:');
                        return csp;
                    });
                }
                callback({ responseHeaders });
            });

            contents.session.webRequest.onBeforeRequest({ urls: ['file://*'] }, (details, callback) => {
                if (details.url.includes('xmtls.wasm')) return callback({});
                if (details.url.includes('electron.asar') || details.url.includes('electron/dist')) {
                    callback({ cancel: false });
                } else {
                    callback({});
                }
            });

            const type = (typeof contents.getType === 'function') ? contents.getType() : 'unknown';
            const isWeb = contents.hostWebContents !== undefined;
            const shouldAttachContextMenu = isWeb || type === 'window' || type === 'browserView';

            const handleSaveUnderlineRequest = (url, underlineInfo) => saveUnderlineDirect(url, underlineInfo);
            app.removeAllListeners('save-underline-request-debug');
            app.on('save-underline-request-debug', handleSaveUnderlineRequest);

            if (shouldAttachContextMenu) {
                const url = contents.getURL();
                if (url) webviewContentsMap.set(url, contents);

                contents.on('context-menu', (event, params) => {
                    const text = params.selectionText ? params.selectionText.trim() : '';
                    const hasSelection = text.length > 0;
                    let selectedMenu = [];
                    let underlineMenu = [];
                    let closeTabMenu = [];

                    const baseMenu = [{
                        label: '查看网页源码',
                        click: () => handleViewSource(contents)
                    }, {
                        label: '打开开发者工具',
                        accelerator: 'F12',
                        click: () => {
                            try {
                                const url = contents.getURL();
                                if (url.startsWith('file://')) {
                                    contents.openDevTools({ mode: 'detach' });
                                } else {
                                    contents.openDevTools();
                                }
                            } catch (e) {
                                console.error('打开开发者工具出错:', e && e.message);
                            }
                        }
                    }, { type: 'separator' }, {
                        label: '刷新',
                        accelerator: 'F5',
                        click: () => contents.reload()
                    }, {
                        label: '强制刷新',
                        accelerator: 'Ctrl+F5',
                        click: () => contents.reloadIgnoringCache()
                    }];

                    if (hasSelection) {
                        underlineMenu = [{
                            label: '添加下划线',
                            enabled: hasSelection,
                            click: () => handleAddUnderline(contents)
                        }];
                        const preview = text && text.length > 30 ? text.slice(0, 30) + '…' : text;
                        selectedMenu = [{
                            label: text ? `在百度中搜索 "${preview}"` : '在百度中搜索',
                            enabled: hasSelection,
                            click: () => {
                                const t = params.selectionText ? params.selectionText.trim() : '';
                                const mainWindow = getMainWindow();
                                if (t && mainWindow && !mainWindow.isDestroyed()) {
                                    const targetUrl = 'https://www.baidu.com/s?wd=' + encodeURIComponent(t);
                                    mainWindow.webContents.send('open-url-in-new-tab', targetUrl);
                                }
                            }
                        }, {
                            label: '复制',
                            enabled: hasSelection,
                            accelerator: 'Ctrl+C',
                            click: () => contents.copy()
                        }, {
                            label: '在页面中搜索选中文本',
                            enabled: hasSelection,
                            click: () => {
                                const t = params.selectionText ? params.selectionText.trim() : '';
                                const mainWindow = getMainWindow();
                                if (mainWindow && !mainWindow.isDestroyed()) {
                                    mainWindow.webContents.send('show-search-panel-with-text', t);
                                }
                            }
                        }, { type: 'separator' }];
                    }

                    contents.executeJavaScript(
                        `(function() {
                        const element = document.elementFromPoint(${params.x}, ${params.y});
                        if (!element) return { hasUnderline: false, underlineText: '', isTab: false, hasLeftTab: false, hasRightTab: false };
                        if (element.classList && element.classList.contains('underline-fb3b780f')) {
                            return { hasUnderline: true, underlineText: element.textContent || element.innerText || '', isTab: false, hasLeftTab: false, hasRightTab: false };
                        }
                        let hasLeftTab = false, hasRightTab = false;
                        if ((element.previousElementSibling && element.previousElementSibling.classList.contains('tab')) ||
                            (element.parentElement && element.parentElement.previousElementSibling && element.parentElement.previousElementSibling.classList.contains('tab'))) hasLeftTab = true;
                        if ((element.nextElementSibling && element.nextElementSibling.classList.contains('tab')) ||
                            (element.parentElement && element.parentElement.nextElementSibling && element.parentElement.nextElementSibling.classList.contains('tab'))) hasRightTab = true;
                        const isTab = !!(element.classList.contains('tab-text') || element.classList.contains('tab'));
                        return { hasUnderline: false, underlineText: '', isTab, hasLeftTab, hasRightTab };
                    })()`
                    ).then((elementCheckResult) => {
                        if (elementCheckResult.hasUnderline || hasSelection) {
                            underlineMenu = [{
                                label: elementCheckResult.hasUnderline ? '取消划线' : '添加下划线',
                                enabled: true,
                                click: () => {
                                    if (elementCheckResult.hasUnderline) {
                                        handleRemoveUnderline(contents, elementCheckResult.underlineText);
                                    } else {
                                        handleAddUnderline(contents);
                                    }
                                }
                            }];
                        }
                        if (hasSelection && elementCheckResult.hasUnderline === false) {
                            underlineMenu = [...underlineMenu, { type: 'separator' }];
                        }
                        if (elementCheckResult.isTab && type === 'window') {
                            closeTabMenu = [{
                                type: 'separator'
                            }, {
                                label: '关闭标签',
                                click: () => {
                                    const mainWindow = getMainWindow();
                                    if (mainWindow && !mainWindow.isDestroyed()) {
                                        mainWindow.webContents.send('close-tab', getLastActiveTabId());
                                    }
                                }
                            }, {
                                label: '关闭其它标签',
                                enabled: elementCheckResult.hasLeftTab || elementCheckResult.hasRightTab,
                                click: () => {
                                    const mainWindow = getMainWindow();
                                    if (mainWindow && !mainWindow.isDestroyed()) {
                                        mainWindow.webContents.send('close-other-tab', getLastActiveTabId());
                                    }
                                }
                            }, {
                                label: '关闭左侧标签',
                                enabled: elementCheckResult.hasLeftTab,
                                click: () => {
                                    const mainWindow = getMainWindow();
                                    if (mainWindow && !mainWindow.isDestroyed()) {
                                        mainWindow.webContents.send('close-left-tab', getLastActiveTabId());
                                    }
                                }
                            }, {
                                label: '关闭右侧标签',
                                enabled: elementCheckResult.hasRightTab,
                                click: () => {
                                    const mainWindow = getMainWindow();
                                    if (mainWindow && !mainWindow.isDestroyed()) {
                                        mainWindow.webContents.send('close-right-tab', getLastActiveTabId());
                                    }
                                }
                            }];
                        }

                        const menu = Menu.buildFromTemplate([...underlineMenu, ...selectedMenu, ...baseMenu, ...closeTabMenu]);
                        menu.popup();
                    }).catch(() => {
                        const menu = Menu.buildFromTemplate([...selectedMenu, ...underlineMenu, ...baseMenu]);
                        menu.popup();
                    });
                });
            }

            contents.on('will-attach-webview', () => { });
        });
    }

    function init() {
        ensureUserDataDir();
        registerUnderlineIpcHandlers();
        registerWebContentsHandlers();
    }

    return {
        init,
        loadAndRestoreUnderline
    };
};
