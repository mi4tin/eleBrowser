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
    const underlineMode = 1;// 划线模式，1、只加载指定出现次数的文本划线(即选中处文本的划线)，2、加载所有匹配文本的划线
    let resetUnerlineNameIndexMap = {};//用于同一页面的不同下划线的命名标识重置映射，key为url,value为underlineNameIndex
    let underlineNameIndex = 1;//用于同一页面的不同下划线的命名标识，即同一命名标识表示同一划线。而occurrenceIndex表示同一划线内容的不同匹配的位置

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

    /**
 * 在BrowserView中恢复划线信息
 * @param {BrowserView} view - BrowserView实例
 * @param {object} underlineInfo - 划线信息
 * @param {number} underlineNameIndexP - 下划线命名索引，用于同一页面的不同下划线的命名标识,默认值为underlineNameIndex，默认不传，只有划线信息没获取到重试才传
 * @returns {number} 恢复的划线数量,-1表示划线失败,暂时无用（2026-3-3）
 */
    async function restoreUnderlineInBrowserView(contents, underlineInfo, underlineNameIndexP) {
        try {
            underlineInfo.mode = underlineInfo.mode || 1;
            underlineInfo.occurrenceIndex = underlineInfo.occurrenceIndex || 0;

            const hasUnderlineNameIndexP = !!underlineNameIndexP;
            if (!hasUnderlineNameIndexP) {
                underlineNameIndexP = underlineNameIndex;
            }

            console.log('划线信息.aa:', underlineInfo);

            var underlineCount = await contents.executeJavaScript(
            `(function(text, mode, occurrenceIndex) {

                console.log('划线信息:', text, mode, occurrenceIndex);

                // 检查并注入划线样式
                if (!document.getElementById('underline-styles')) {
                    const style = document.createElement('style');
                    style.id = 'underline-styles';
                    style.textContent = '.underline-fb3b780f { text-decoration: underline; text-decoration-color: green; text-decoration-style: solid; text-decoration-thickness: 2px; text-underline-offset: 3px; }';
                    document.head.appendChild(style);
                }


                /**
                 * 在容器中，根据全局字符偏移量查找所在的文本节点及内部偏移
                 * @param {HTMLElement} container 
                 * @param {number} offset - 从容器文本开头计算的字符偏移（0-based）
                 * @returns {{ node: Text, offset: number }} 文本节点和内部偏移
                 */
                function getTextNodeAtPosition(container, offset) {
                const walker = document.createTreeWalker(
                    container,
                    NodeFilter.SHOW_TEXT,
                    null,
                    false
                );

                let currentPos = 0;
                let node;
                while ((node = walker.nextNode())) {
                    if (/^\\s+$/.test(node.textContent)) continue;
                    const nodeLength = node.textContent.length;
                    if (offset < currentPos + nodeLength) {
                    return {
                        node: node,
                        offset: offset - currentPos
                    };
                    }
                    currentPos += nodeLength;
                }
                throw new Error('Offset  out of range');
                }

                /**
                 * 包裹单个文本节点中的一段
                 */
                function wrapTextNodeSegment(node, start, end) {
                const parent = node.parentNode;
                if (!parent) return;
                if (parent.classList && parent.classList.contains('underline-fb3b780f')) return;

                const content = node.textContent;
                const fragment = document.createDocumentFragment();

                if (start > 0) {
                    fragment.appendChild(document.createTextNode(content.substring(0, start)));
                }

                const span = document.createElement('span');
                span.className = 'underline-fb3b780f';
                span.setAttribute('name', 'underline-fb3b780f-name${underlineNameIndexP}');
                span.setAttribute('data-occurrence-index', ${underlineInfo.occurrenceIndex});
                
                span.textContent = content.substring(start, end);
                fragment.appendChild(span);

                if (end < content.length) {
                    fragment.appendChild(document.createTextNode(content.substring(end)));
                }

                parent.replaceChild(fragment, node);
                }


                /**
                 * 处理跨文本节点的范围
                 */
                function handleMultiNodeRange(startNode, startOffset, endNode, endOffset) {
                // 1. 处理起始节点（保留后半部分）
                const startParent = startNode.parentNode;
                if (startParent) {
                    const startContent = startNode.textContent;
                    const startFrag = document.createDocumentFragment();
                    
                    // 从 startOffset 到末尾的内容加上下划线
                    const underlineSpan = document.createElement('span');
                    underlineSpan.className = 'underline-fb3b780f';
                    underlineSpan.setAttribute('name', 'underline-fb3b780f-name${underlineNameIndexP}');
                    underlineSpan.setAttribute('data-occurrence-index', ${underlineInfo.occurrenceIndex});
                    underlineSpan.textContent = startContent.substring(startOffset);
                    startFrag.appendChild(underlineSpan);
                    
                    // 前半部分保留为纯文本（如果存在）
                    if (startOffset > 0) {
                    const beforeText = document.createTextNode(startContent.substring(0, startOffset));
                    startFrag.insertBefore(beforeText, underlineSpan);
                    }
                    
                    startParent.replaceChild(startFrag, startNode);
                }

                // 2. 处理结束节点（保留前半部分）
                const endParent = endNode.parentNode;
                if (endParent) {
                    const endContent = endNode.textContent;
                    const endFrag = document.createDocumentFragment();
                    
                    // 从开头到 endOffset 的内容加上下划线
                    const underlineSpan = document.createElement('span');
                    underlineSpan.className = 'underline-fb3b780f';
                    underlineSpan.setAttribute('name', 'underline-fb3b780f-name${underlineNameIndexP}');
                    underlineSpan.setAttribute('data-occurrence-index',  ${underlineInfo.occurrenceIndex});
                    underlineSpan.textContent = endContent.substring(0, endOffset);
                    endFrag.appendChild(underlineSpan);
                    
                    // 后半部分保留为纯文本（如果存在）
                    if (endOffset < endContent.length) {
                    const afterText = document.createTextNode(endContent.substring(endOffset));
                    endFrag.appendChild(afterText);
                    }
                    
                    endParent.replaceChild(endFrag, endNode);
                }

                // 3. 处理中间的所有文本节点（整个包裹）
                let currentNode = startNode.nextSibling;
                while (currentNode && currentNode !== endNode) {
                    if (currentNode.nodeType === Node.TEXT_NODE && currentNode.parentNode) {
                    const parent = currentNode.parentNode;
                    const content = currentNode.textContent;
                    if (content.length > 0) {
                        const span = document.createElement('span');
                        span.className = 'underline-fb3b780f';
                        span.setAttribute('name', 'underline-fb3b780f-name${underlineNameIndexP}');
                        span.setAttribute('data-occurrence-index',  ${underlineInfo.occurrenceIndex});
                        span.textContent = content;
                        parent.replaceChild(span, currentNode);
                    }
                    }
                    currentNode = currentNode.nextSibling;
                }
                }


                 /**
                 * 跨标签添加下划线，支持指定第几个匹配
                 * @param {HTMLElement} container - 容器元素
                 * @param {string} text - 要添加下划线的文本
                 * @param {number} [matchIndex=null] - 匹配索引（0-based）
                 * @returns {number} 实际处理的匹配数量
                 */
                function underlineAllMatches(container, text,mode, matchIndex) {
                if (!container || !text) return 0;

                // 1. 基于当前实时文本查找所有匹配位置（跳过纯空白文本节点，避免标签换行导致匹配失败）
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

                // 2. 确定要处理的匹配列表
                let matchesToProcess = [];
                if (mode === 1 && matchIndex >= 0) {
                    // 校验索引合法性
                    if (matchIndex >= 0 && matchIndex < matches.length) {
                    matchesToProcess = [matches[matchIndex]];
                    } else {
                    console.warn("❌ 匹配索引 " + matchIndex + " 超出范围，共有 " + matches.length + " 个匹配");
                    return 0;
                    }
                } else {
                    matchesToProcess = matches.slice(); // 处理全部
                }

                // 3. 按结束位置降序排序（从后往前处理，保证节点定位正确）
                matchesToProcess.sort((a, b) => b.end - a.end);


                var index = 0;
                // 4. 处理每个匹配（依赖辅助函数）
                matchesToProcess.forEach(match => {
                    try {
                    index++;
                    console.log('处理匹配aa:', match, '索引:', index);
                    const startInfo = getTextNodeAtPosition(container, match.start);
                    const endInfo = getTextNodeAtPosition(container, match.end - 1);
                    
                    if (startInfo.node === endInfo.node) {
                        wrapTextNodeSegment(startInfo.node, startInfo.offset, endInfo.offset + 1);
                    } else {
                        handleMultiNodeRange(
                        startInfo.node, startInfo.offset,
                        endInfo.node, endInfo.offset + 1
                        );
                    }
                    } catch (e) {
                    console.warn('⚠️ 处理匹配失败:', match, e);
                    }
                });

                return matchesToProcess.length;
                }

                
                let underlineCount=0;
                // 确保DOM完全加载后再应用划线
                if (false) {//document.readyState === 'loading'
                    document.addEventListener('DOMContentLoaded', function() {
                        console.log('DOMContentLoaded事件触发，开始应用划线');
                        underlineAllMatches(document.body, text, mode, occurrenceIndex);
                    });
                } else {
                    console.log('DOMContentLoaded事件未触发，立即应用划线');
                    underlineCount=underlineAllMatches(document.body, text, mode, occurrenceIndex);
                }

                return underlineCount;

                console.log('划线应用完成');
            })('${underlineInfo.text}', ${underlineInfo.mode}, ${underlineInfo.occurrenceIndex})`
        );

        console.log('恢复划线完成数量:', underlineCount);

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
                : contents.executeJavaScript( // 只给当前选中的添加下划线
                    `(function(selectedText, mode) {
                // 检查并注入划线样式
                if (!document.getElementById('underline-styles')) {
                    const style = document.createElement('style');
                    style.id = 'underline-styles';
                    style.textContent = '.underline-fb3b780f { text-decoration: underline; text-decoration-color: green; text-decoration-style: solid; text-decoration-thickness: 2px; text-underline-offset: 3px; }';
                    document.head.appendChild(style);
                }
                
                // 计算文本在文档中的出现次数
                function getTextOccurrenceIndex(text, node) {
                    let count = 0;
                    let currentNode = node;
                    
                    // 向上查找直到文档根节点
                    while (currentNode && currentNode !== document.body) {
                        currentNode = currentNode.parentNode;
                    }
                    
                    // 遍历文档，计算文本出现次数
                    function traverseNodes(node) {
                        if (node.nodeType === 3) { // 文本节点
                            const textContent = node.textContent;
                            let index = 0;
                            while ((index = textContent.indexOf(text, index)) !== -1) {
                                // 检查是否是当前选中的文本
                                if (node === window.getSelection().anchorNode && 
                                    index <= window.getSelection().anchorOffset && 
                                    index + text.length >= window.getSelection().focusOffset) {
                                    return true; // 找到当前选中的文本
                                }
                                index += text.length;
                                count++;
                            }
                        } else if (node.nodeType === 1) { // 元素节点
                            for (let i = 0; i < node.childNodes.length; i++) {
                                if (traverseNodes(node.childNodes[i])) {
                                    return true;
                                }
                            }
                        }
                        return false;
                    }
                    
                    traverseNodes(document.body);
                    return count;
                }
                
                // 为指定范围添加下划线
                function addUnderlineToRange(range) {
                console.log('addUnderlineToRange.a1:', range);
                    
                    // 检查是否跨越多个元素节点
                    const startContainer = range.startContainer;
                    const endContainer = range.endContainer;
                    
                    // 如果选中的范围跨越多个元素节点，分别处理每个节点内的选中部分
                    if (startContainer !== endContainer || 
                        (startContainer.nodeType === 3 && endContainer.nodeType === 3 && 
                         startContainer.parentNode !== endContainer.parentNode)) {
                        
                        console.log('addUnderlineToRange.a0:', '检测到跨标签选中，分别处理');
                        
                        // 获取选中的所有文本节点
                        const textNodes = [];
                        const walker = document.createTreeWalker(
                            range.commonAncestorContainer,
                            NodeFilter.SHOW_TEXT,
                            {
                                acceptNode: function(node) {
                                    // 检查节点是否在选中范围内
                                    const nodeRange = document.createRange();
                                    nodeRange.selectNode(node);
                                    const isIntersecting = range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0 && 
                                                         range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0;
                                    return isIntersecting ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                                }
                            }
                        );
                        
                        let currentNode;
                        while (currentNode = walker.nextNode()) {
                            textNodes.push(currentNode);
                        }
                        
                        const spans = [];
                        
                        // 为每个文本节点内的选中部分创建下划线
                        textNodes.forEach((textNode, index) => {
                            const span = document.createElement('span');
                            span.className = 'underline-fb3b780f';
                            
                            // 计算当前文本节点内的选中范围
                            const nodeRange = document.createRange();
                            
                            if (index === 0) {
                                // 第一个节点：从选中开始位置到节点结束
                                nodeRange.setStart(textNode, range.startOffset);
                                nodeRange.setEnd(textNode, textNode.textContent.length);
                            } else if (index === textNodes.length - 1) {
                                // 最后一个节点：从节点开始到选中结束位置
                                nodeRange.setStart(textNode, 0);
                                nodeRange.setEnd(textNode, range.endOffset);
                            } else {
                                // 中间节点：选中整个节点
                                nodeRange.selectNode(textNode);
                            }
                            
                            // 为当前节点内的选中部分添加下划线
                            try {
                                nodeRange.surroundContents(span);
                                spans.push(span);
                            } catch (e) {
                                console.log('addUnderlineToRange.a0:', '单个节点内下划线添加失败，使用备用方法');
                                const contents = nodeRange.extractContents();
                                span.appendChild(contents);
                                nodeRange.insertNode(span);
                                spans.push(span);
                            }
                        });
                        
                        console.log('addUnderlineToRange.a0:', '跨标签下划线添加成功，共添加', spans.length, '个下划线');
                        return spans; // 返回spans用于后续处理
                    }
                    
                    // 单个节点内的选中，使用原有逻辑
                    const span = document.createElement('span');
                    span.className = 'underline-fb3b780f';
                    
                    // 将选中的内容包装在span中
                    try {
                        range.surroundContents(span);
                        console.log('addUnderlineToRange.a0:', '添加下划线成功');
                    } catch (e) {
                        // 如果surroundContents失败（例如跨越多个节点），则使用extractContents方法
                        const contents = range.extractContents();
                        span.appendChild(contents);
                        range.insertNode(span);

                        // 清理 extractContents 拆分产生的空残余标签
                        const prev = span.previousElementSibling;
                        console.log('addUnderlineToRange.a0:', '清理空残余标签开始.前面');
                        console.log('addUnderlineToRange.a0.残余:', prev,prev.tagName,span.firstElementChild.tagName);
                        if (prev&&prev.tagName===span.firstElementChild.tagName&&prev.textContent==='') {
                            // prev.remove();
                            console.log('addUnderlineToRange.a0:', '清理空残余标签成功.前面');
                        }

                        const next = span.nextElementSibling;
                        console.log('addUnderlineToRange.a0:', '清理空残余标签开始.后面');
                        console.log('addUnderlineToRange.a0.残余:', next,next.tagName,span.lastElementChild.tagName);
                        if (next&&next.tagName===span.lastElementChild.tagName&&next.textContent==='') {
                            // next.remove();
                            console.log('addUnderlineToRange.a0:', '清理空残余标签成功2');

                        }
                        console.log('addUnderlineToRange.a0:', '添加跨节点下划线成功');
                    }
                    return [span];
                }
                
                const result = { spans: [], occurrenceIndex: 0 };
                
                // 获取用户选择的范围
                const selectedTextObj = window.getSelection();
                if (selectedTextObj.rangeCount > 0) {
                    const range = selectedTextObj.getRangeAt(0);
                    
                    if (mode === 1) {
                        // 模式1: 只为当前选中的文本添加下划线，并记录出现次数
                        const occurrenceIndex = getTextOccurrenceIndex(selectedText, range.commonAncestorContainer);
                        result.occurrenceIndex = occurrenceIndex;

                        console.log('当前选中的文本occurrenceIndex:', occurrenceIndex);
                        
                        const spans = addUnderlineToRange(range);
                        spans.forEach(span => {
                            span.dataset.occurrenceIndex = occurrenceIndex;
                            span.setAttribute('name', 'underline-fb3b780f-name${underlineNameIndex}');
                            result.spans.push(span);
                        });
                    } else if (mode === 2) {
                        console.error('不应在此有模式2。当前选中的文本:', selectedText);
                    }
                }

                console.log('添加下划线结果666:', result);
                
                return { occurrenceIndex: result.occurrenceIndex, spansCount: result.spans.length };
            })('${selectedText}', ${mode})`
                )

            underlineNameIndex++;
            addUnderlinePromise.then((result) => {
                if (mode === 1) {
                    console.log('添加下划线成功:', result);
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

    // 处理取消下划线的函数
    function handleRemoveUnderline(contents, underlineText = null) {
        // 如果提供了划线文本，直接使用；否则尝试获取选中文本
        const getTextPromise = underlineText ?
            Promise.resolve(underlineText) :
            contents.executeJavaScript('window.getSelection().toString()');
    
        getTextPromise.then((selectedText) => {
            console.log('开始取消划线selectedText:', selectedText)
            // 取消划线
            contents.executeJavaScript(
                `(function() {
                    // 检查并注入划线样式（确保样式定义存在）
                    if (!document.getElementById('underline-styles')) {
                        const style = document.createElement('style');
                        style.id = 'underline-styles';
                        style.textContent = '.underline-fb3b780f { text-decoration: underline; text-decoration-color: green; text-decoration-style: solid; text-decoration-thickness: 2px; text-underline-offset: 3px; }';
                        document.head.appendChild(style);
                    }
                    
                    // 获取用户选择的范围
                    const selectedTextObj = window.getSelection();
                    let underlineNodes = [];
                     let underlineText = '';
                    
                    // 方案1: 如果有选中文本，按照原有逻辑处理
                    if (selectedTextObj.rangeCount > 0 ) {
                        console.log("开始取消划线 - 有选中文本");
                        // 检查选中的内容是否在划线元素中
                        let currentNode = selectedTextObj.anchorNode;
                        let underlineNode = null;
    
                        // 向上查找划线元素
                        while (currentNode && currentNode !== document.body) {
                            console.log("检查节点:", currentNode, "类名:", currentNode.className);
                            if (currentNode.classList && currentNode.classList.contains('underline-fb3b780f')) {
                                underlineNode = currentNode;
                                console.log("找到划线元素:", underlineNode);
                                
                                //获取关联节点
                                const name=underlineNode.getAttribute('name');
                                const dataOccurrenceIndex=underlineNode.getAttribute('data-occurrence-index');
                                console.log("关联节点名称:", name);
                                if (name) {
                                    console.log("关联节点名称存在，尝试查找关联节点");
                                    
                                    const multiNodes =document.querySelectorAll('[name="'+name+'"][data-occurrence-index="'+dataOccurrenceIndex+'"]');//跨文本节点
                                    const associatedNodes = document.getElementsByName(name);// 根据名称查找关联节点
                                    if (associatedNodes.length > 0){
                                        underlineNodes=[...associatedNodes]//name获取的包含有currentNode节点，直接赋值associatedNodes没有map方法,只能将其转换为数组
                                    }
                                    console.log("划线关联节点:", associatedNodes, underlineNodes,underlineNodes.map);
    
                                    underlineText = Array.from(multiNodes).map(node => node.textContent|| node.innerText || '').join('');
                                }else{
                                    console.log("关联节点名称不存在");//这种情况基本不存，因为现在都设置有name属性
                                    underlineNodes.push(underlineNode);
                                    underlineText = underlineNode.textContent|| underlineNode.innerText || '';
                                }
    
                                break;
                            }
                            currentNode = currentNode.parentNode;
                        }
                            
                        // 如果未找到划线元素
                        if (underlineNodes.length == 0) {
                            console.log("未找到划线，尝试查找选中范围内的划线元素");
                            // 如果没有找到包含下划线的父元素，检查选中范围内的所有元素
                            const range = selectedTextObj.getRangeAt(0);
                            const commonAncestor = range.commonAncestorContainer;
                            console.log("共同祖先节点:", commonAncestor);
                            
                            // 查找选中范围内的所有带下划线的元素
                            const walker = document.createTreeWalker(
                                commonAncestor,
                                NodeFilter.SHOW_ELEMENT,
                                null,
                                false
                            );
                            
                            let node;
                            
                            while (node = walker.nextNode()) {
                                console.log("遍历节点:", node, "类名:", node.className);
                                if (node.classList && node.classList.contains('underline-fb3b780f')) {
                                    underlineNodes.push(node);
                                    console.log("找到带下划线的节点:", node);
                                }
                            }
                        }
                        
                        if (underlineNodes.length > 0) {
                         // 移除找到的划线元素的类名
                            underlineNodes.forEach(node => {
                                console.log("移除划线节点类名:", node);
                                node.classList.remove('underline-fb3b780f');
                                node.removeAttribute('name');//移除name属性
                                console.log("已移除划线节点类名");
                            });
                        }else{
                            console.log("未找到划线元素1");
                        }
                       
                    } else {
                        // 方案2: 没有选中文本时，查找页面上所有的划线元素
                        console.log("开始取消划线 - 无选中文本，查找所有划线元素");
                        const allUnderlineElements = document.querySelectorAll('.underline-fb3b780f');
                        console.log("找到划线元素数量:", allUnderlineElements.length);
                        
                        // 如果只有一个划线元素，直接移除
                        if (allUnderlineElements.length === 1) {
                            const element = allUnderlineElements[0];
                            console.log("移除唯一划线元素:", element);
                            element.classList.remove('underline-fb3b780f');
                            underlineNodes.push(element);
                        } else if (allUnderlineElements.length > 1) {
                            // 如果有多个划线元素，需要用户确认或者提供更多信息
                            console.log("发现多个划线元素，需要进一步处理");
                            // 这里可以添加更复杂的逻辑来确定要删除哪个元素
                            // 暂时移除第一个元素作为示例
                            const firstElement = allUnderlineElements[0];
                            console.log("移除第一个划线元素:", firstElement);
                            firstElement.classList.remove('underline-fb3b780f');
                            underlineNodes.push(firstElement);
                        }
                    }
    
                    console.log("找到划线元素数量2:",underlineNodes, underlineNodes.map);

                    let occurrenceIndex = -1;
                    //目前mode=1时，underlineNodes.length只会等于1
                    if (${underlineMode} == 1&&underlineNodes.length > 0) {
                        console.log("删除划线underlineMode:",${underlineMode});
                        occurrenceIndex = underlineNodes[0].getAttribute('data-occurrence-index');
                    }
                    
                    return {
                        success: underlineNodes.length > 0,
                        removedCount: underlineNodes.length,
                        removedTexts: underlineNodes.map(node => node.textContent || node.innerText || ''),
                        underlineText: underlineText,
                        occurrenceIndex: occurrenceIndex
                    };
                })()`
            ).then((result) => {
                console.log("删除划线执行结果:", result);
                // 成功取消下划线后，从划线数据中删除对应的记录
                const url = contents.getURL();
                selectedText = result.underlineText;
                if (url && selectedText && selectedText.trim()) {
                    // 从划线数据中删除
                    try {
                        let underlineData = {};
                        if (fs.existsSync(underlineFilePath)) {
                            const data = fs.readFileSync(underlineFilePath, 'utf8');
                            underlineData = JSON.parse(data);
                        }
    
                        if (underlineData[url]) {
                            // 查找并删除匹配的划线记录
                            // 支持精确匹配和模糊匹配
                            const originalLength = underlineData[url].length;
                            underlineData[url] = underlineData[url].filter(item => {
                                // 精确匹配
                                if (item.text === selectedText ) {
                                    if(result.occurrenceIndex==-1||item.occurrenceIndex == result.occurrenceIndex){
                                        console.log("删除匹配记录:", item);//todo:多个匹配加载的occurrenceIndex都一样了
                                        return false;//返回false，表示不要该记录，即删除
                                    }else{
                                        return true;
                                    }
                                }
                                // 模糊匹配（去除空白字符后比较）
                                const cleanItemText = item.text.replace(/\s+/g, '');
                                const cleanSelectedText = selectedText.replace(/\s+/g, '');
                                if (cleanItemText === cleanSelectedText) {
                                    if(result.occurrenceIndex==-1||item.occurrenceIndex == result.occurrenceIndex){
                                        console.log("删除匹配记录2:", item);
                                        return false;
                                    }
                                }
                                return true;
                            });
    
                            console.log(`从 ${originalLength} 条记录中删除了 ${originalLength - underlineData[url].length} 条`);
    
                            // 如果该URL没有划线记录了，删除该URL的条目
                            if (underlineData[url].length === 0) {
                                delete underlineData[url];
                            }
    
                            // 保存更新后的数据
                            fs.writeFileSync(underlineFilePath, JSON.stringify(underlineData, null, 2), 'utf8');
                            console.log('已删除划线信息1:', url, selectedText);
                        }
                    } catch (e) {
                        console.error('删除划线失败:', e);
                    }
                } else if (url && result.removedTexts && result.removedTexts.length > 0) {
                    //正常都不会执行
                    // 如果没有选中文本但成功移除了划线元素，使用移除的文本进行删除
                    try {
                        let underlineData = {};
                        if (fs.existsSync(underlineFilePath)) {
                            const data = fs.readFileSync(underlineFilePath, 'utf8');
                            underlineData = JSON.parse(data);
                        }
    
                        if (underlineData[url]) {
                            const originalLength = underlineData[url].length;
                            // 根据移除的文本内容删除对应的记录
                            result.removedTexts.forEach(removedText => {
                                underlineData[url] = underlineData[url].filter(item => {
                                    // 精确匹配
                                    if (item.text === removedText) {
                                        return false;
                                    }
                                    // 模糊匹配
                                    const cleanItemText = item.text.replace(/\s+/g, '');
                                    const cleanRemovedText = removedText.replace(/\s+/g, '');
                                    if (cleanItemText === cleanRemovedText) {
                                        return false;
                                    }
                                    return true;
                                });
                            });
    
                            console.log(`从 ${originalLength} 条记录中删除了相关记录`);
    
                            // 如果该URL没有划线记录了，删除该URL的条目
                            if (underlineData[url].length === 0) {
                                delete underlineData[url];
                            }
    
                            // 保存更新后的数据
                            fs.writeFileSync(underlineFilePath, JSON.stringify(underlineData, null, 2), 'utf8');
                            console.log('已删除划线信息2:', url, result.removedTexts);
                        }
                    } catch (e) {
                        console.error('删除划线失败:', e);
                    }
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

    function copyImageToClipboard(contents, imageUrl, x, y) {
        const { clipboard, nativeImage } = require('electron');

        console.log("复制图片.a", imageUrl, x, y);
        
        contents.executeJavaScript(`
            (function() {
                return new Promise((resolve, reject) => {
                    const element = document.elementFromPoint(${x}, ${y});
                    let img = null;
                    
                    console.log('找到的元素:', element, element.tagName);
                    
                    if (element.tagName === 'IMG') {
                        img = element;
                    } else if (element.style && element.style.backgroundImage) {
                        const match = element.style.backgroundImage.match(/url\\(['"]?([^'"]+)['"]?\\)/);
                        if (match) {
                            resolve({ src: match[1], isBackground: true });
                            return;
                        }
                    }
                    
                    if (img) {
                        console.log('找到 IMG 元素, src:', img.src, 'complete:', img.complete);
                        
                        const tryConvertWithCrossOrigin = () => {
                            const newImg = new Image();
                            newImg.crossOrigin = 'anonymous';
                            
                            newImg.onload = () => {
                                console.log('重新加载图片成功（使用 crossOrigin）');
                                const canvas = document.createElement('canvas');
                                canvas.width = newImg.naturalWidth || newImg.width;
                                canvas.height = newImg.naturalHeight || newImg.height;
                                console.log('Canvas 尺寸:', canvas.width, 'x', canvas.height);
                                
                                const ctx = canvas.getContext('2d');
                                ctx.drawImage(newImg, 0, 0);
                                
                                try {
                                    const dataUrl = canvas.toDataURL('image/png');
                                    console.log('Canvas 转换成功（使用 crossOrigin）, 数据长度:', dataUrl.length);
                                    resolve({ src: dataUrl, isBackground: false });
                                } catch (e) {
                                    console.error('Canvas 转换失败（使用 crossOrigin）:', e);
                                    resolve({ src: '${imageUrl}', isBackground: false, useDirect: true });
                                }
                            };
                            
                            newImg.onerror = () => {
                                console.error('重新加载图片失败（使用 crossOrigin）');
                                resolve({ src: '${imageUrl}', isBackground: false, useDirect: true });
                            };
                            
                            newImg.src = img.src;
                        };
                        
                        const isCrossOrigin = (() => {
                            try {
                                const imgUrl = new URL(img.src);
                                const pageUrl = new URL(window.location.href);
                                return imgUrl.origin !== pageUrl.origin;
                            } catch (e) {
                                return false;
                            }
                        })();
                        
                        console.log('是否跨域:', isCrossOrigin);
                        
                        if (isCrossOrigin) {
                            console.log('检测到跨域图片，尝试使用 crossOrigin 重新加载');
                            tryConvertWithCrossOrigin();
                            return;
                        }
                        
                        const convertImage = () => {
                            const canvas = document.createElement('canvas');
                            canvas.width = img.naturalWidth || img.width;
                            canvas.height = img.naturalHeight || img.height;
                            console.log('Canvas 尺寸:', canvas.width, 'x', canvas.height);
                            
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0);
                            
                            try {
                                const dataUrl = canvas.toDataURL('image/png');
                                console.log('Canvas 转换成功, 数据长度:', dataUrl.length);
                                resolve({ src: dataUrl, isBackground: false });
                            } catch (e) {
                                console.error('Canvas 转换失败:', e);
                                tryConvertWithCrossOrigin();
                            }
                        };
                        
                        if (img.complete) {
                            convertImage();
                        } else {
                            img.onload = convertImage;
                            img.onerror = () => {
                                console.error('图片加载失败');
                                tryConvertWithCrossOrigin();
                            };
                        }
                    } else {
                        resolve({ src: '${imageUrl}', isBackground: false, useDirect: true });
                    }
                });
            })()
        `).then((result) => {
            // console.log('获取图片数据:', result);
            // console.log("复制图片.b", result.src);
            
            if (result.src.startsWith('data:image')) {
                console.log('使用 Canvas 方法');
                try {
                    const base64Data = result.src.replace(/^data:image\/(png|jpeg|jpg|gif|webp);base64,/, '');
                    console.log('Base64 数据长度:', base64Data.length);
                    const buffer = Buffer.from(base64Data, 'base64');
                    console.log('Buffer 长度:', buffer.length);
                    const image = nativeImage.createFromBuffer(buffer);
                    // console.log('Image 对象:', image);
                    console.log('Image 是否为空:', image.isEmpty());
                    if (!image.isEmpty()) {
                        console.log('Image 尺寸:', image.getSize());
                        clipboard.writeImage(image);
                        console.log('已执行 writeImage');
                        
                        const availableFormats = clipboard.availableFormats();
                        console.log('剪贴板可用格式:', availableFormats);
                        
                        console.log('复制图片成功（通过 canvas）');
                    } else {
                        console.error('创建的 Image 对象为空，无法复制');
                    }
                } catch (error) {
                    console.error('处理图片数据失败:', error);
                    console.error('错误堆栈:', error.stack);
                }
            } else {
                console.log('使用网络请求方法');
                const https = require('https');
                const http = require('http');
                const url = require('url');
                
                const parsedUrl = url.parse(result.src);
                const protocol = parsedUrl.protocol === 'https:' ? https : http;
                
                console.log('发起请求:', result.src);
                
                protocol.get(result.src, (response) => {
                    console.log('响应状态码:', response.statusCode);
                    
                    if (response.statusCode !== 200) {
                        console.error('获取图片失败:', response.statusCode);
                        return;
                    }
                    
                    const chunks = [];
                    let totalLength = 0;
                    
                    response.on('data', (chunk) => {
                        chunks.push(chunk);
                        totalLength += chunk.length;
                        console.log('收到数据块:', chunk.length, '总长度:', totalLength);
                    });
                    
                    response.on('end', () => {
                        console.log('数据接收完成，总长度:', totalLength);
                        try {
                            const buffer = Buffer.concat(chunks);
                            console.log('Buffer 长度:', buffer.length);
                            
                            let image = nativeImage.createFromBuffer(buffer);
                            console.log('Image 对象:', image);
                            console.log('Image 是否为空:', image.isEmpty());
                            
                            if (image.isEmpty()) {
                                console.error('nativeImage.createFromBuffer 失败，尝试其他方法');
                                image = nativeImage.createFromDataURL('data:image/png;base64,' + buffer.toString('base64'));
                                console.log('第二次尝试，Image 是否为空:', image.isEmpty());
                            }
                            
                            if (!image.isEmpty()) {
                                console.log('Image 尺寸:', image.getSize());
                                clipboard.writeImage(image);
                                console.log('已执行 writeImage');
                                
                                const availableFormats = clipboard.availableFormats();
                                console.log('剪贴板可用格式:', availableFormats);
                                
                                console.log('复制图片成功（通过网络请求）');
                            } else {
                                console.error('创建的 Image 对象为空，无法复制');
                            }
                        } catch (error) {
                            console.error('处理图片数据失败:', error);
                            console.error('错误堆栈:', error.stack);
                        }
                    });
                }).on('error', (error) => {
                    console.error('请求图片失败:', error);
                    console.error('错误堆栈:', error.stack);
                });
            }
        }).catch((error) => {
            console.error('执行 JavaScript 获取图片失败:', error);
            console.error('错误堆栈:', error.stack);
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
                    let imageMenu = [];

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
                        if (!element) return { hasUnderline: false, underlineText: '', isTab: false, hasLeftTab: false, hasRightTab: false, isImage: false, imageSrc: '' };
                        if (element.classList && element.classList.contains('underline-fb3b780f')) {
                            return { hasUnderline: true, underlineText: element.textContent || element.innerText || '', isTab: false, hasLeftTab: false, hasRightTab: false, isImage: false, imageSrc: '' };
                        }
                        let hasLeftTab = false, hasRightTab = false;
                        if ((element.previousElementSibling && element.previousElementSibling.classList.contains('tab')) ||
                            (element.parentElement && element.parentElement.previousElementSibling && element.parentElement.previousElementSibling.classList.contains('tab'))) hasLeftTab = true;
                        if ((element.nextElementSibling && element.nextElementSibling.classList.contains('tab')) ||
                            (element.parentElement && element.parentElement.nextElementSibling && element.parentElement.nextElementSibling.classList.contains('tab'))) hasRightTab = true;
                        const isTab = !!(element.classList.contains('tab-text') || element.classList.contains('tab'));
                        let isImage = false;
                        let imageSrc = '';
                        if (element.tagName === 'IMG') {
                            isImage = true;
                            imageSrc = element.src;
                        } else if (element.style && element.style.backgroundImage) {
                            isImage = true;
                            const bgImage = element.style.backgroundImage;
                            const match = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/);
                            if (match) {
                                imageSrc = match[1];
                            }
                        }
                        return { hasUnderline: false, underlineText: '', isTab, hasLeftTab, hasRightTab, isImage, imageSrc };
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
                        if (elementCheckResult.isImage && elementCheckResult.imageSrc) {
                            imageMenu = [{
                                label: '在新标签页打开图片',
                                click: () => {
                                    const mainWindow = getMainWindow();
                                    if (mainWindow && !mainWindow.isDestroyed()) {
                                        mainWindow.webContents.send('open-url-in-new-tab', elementCheckResult.imageSrc);
                                    }
                                }
                            }, {
                                label: '复制图片',
                                click: () => {
                                    copyImageToClipboard(contents, elementCheckResult.imageSrc, params.x, params.y);
                                }
                            }, {
                                label: '图片另存为',
                                click: () => {
                                    const { dialog } = require('electron');
                                    const path = require('path');
                                    const https = require('https');
                                    const http = require('http');
                                    const fs = require('fs');
                                    const url = require('url');
                                    
                                    let filename = 'image';
                                    try {
                                        const parsedUrl = new URL(elementCheckResult.imageSrc);
                                        const pathname = parsedUrl.pathname;
                                        let baseName = path.basename(pathname);
                                        
                                        if (baseName && baseName !== '/') {
                                            filename = baseName;
                                        }
                                    } catch (e) {
                                        console.error('解析 URL 失败:', e);
                                    }
                                    
                                    const sanitizeFilename = (name) => {
                                        const invalidChars = /[<>:"/\\|?*~]/g;
                                        let sanitized = name.replace(invalidChars, '_');
                                        
                                        if (!sanitized || sanitized === '.') {
                                            return 'image';
                                        }
                                        
                                        const ext = path.extname(sanitized).toLowerCase();
                                        const validExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
                                        if (!validExts.includes(ext)) {
                                            sanitized = sanitized + '.png';
                                        }
                                        
                                        return sanitized;
                                    };
                                    
                                    const safeFilename = sanitizeFilename(filename);
                                    console.log('保存图片，原始文件名:', filename, '安全文件名:', safeFilename);
                                    
                                    dialog.showSaveDialog({
                                        defaultPath: safeFilename,
                                        filters: [{
                                            name: 'Images',
                                            extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']
                                        }]
                                    }).then((result) => {
                                        if (!result.canceled && result.filePath) {
                                            console.log('保存到:', result.filePath);
                                            
                                            const parsedUrl = url.parse(elementCheckResult.imageSrc);
                                            const protocol = parsedUrl.protocol === 'https:' ? https : http;
                                            
                                            const file = fs.createWriteStream(result.filePath);
                                            protocol.get(elementCheckResult.imageSrc, (response) => {
                                                console.log('下载响应状态码:', response.statusCode);
                                                response.pipe(file);
                                                file.on('finish', () => {
                                                    file.close();
                                                    console.log('图片保存成功');
                                                });
                                            }).on('error', (err) => {
                                                console.error('保存图片失败:', err);
                                                try {
                                                    fs.unlink(result.filePath, () => {});
                                                } catch (unlinkErr) {
                                                    console.error('删除临时文件失败:', unlinkErr);
                                                }
                                            });
                                        }
                                    });
                                }
                            }, {
                                label: '复制图片链接',
                                click: () => {
                                    const { clipboard } = require('electron');
                                    clipboard.writeText(elementCheckResult.imageSrc);
                                }
                            }, { type: 'separator' }];
                        }

                        const menu = Menu.buildFromTemplate([...imageMenu, ...underlineMenu, ...selectedMenu, ...baseMenu, ...closeTabMenu]);
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
