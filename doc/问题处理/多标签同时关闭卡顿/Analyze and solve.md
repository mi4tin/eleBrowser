我来看一下当前 `closeRightTabs` 和 `closeTab` 的实现，分析卡顿原因。
现在我完全理解了卡顿的原因。分析代码发现了三个性能问题：

**根因：每个 `closeTab` 都有一个 IPC 往返 + 300ms 超时 + 逐次 DOM 操作**

1. `closeBrowserView` 中 `loadURL('about:blank')` 有 **300ms 超时等待**（第644-657行）
2. 20个标签就是 **20 × 300ms = 6秒+** 的串行阻塞
3. 每次 `closeTab` 都做 `addButton.remove()` / `appendChild(addButton)`，触发 **20 次 DOM 重排**

**优化方案**：
- 新增批量的 IPC handler `close-browser-views`，**并行**关闭所有 BrowserView（总耗时 ~300ms 而非 n×300ms）
- 新增 `batchCloseTabs` 函数，**一次批量移除 DOM** + 仅处理一次 addButton
- 重构 `closeRightTabs`/`closeLeftTabs`/`closeOtherTabs`/`closeAllTabs` 使用批量路径
我当前处于 Ask 模式，无法直接修改文件。下面是完整的优化方案，你可以确认后切到 Craft 模式让我实施。

---

## 卡顿根因分析

当关闭右侧 20 个标签时，`closeRightTabs` 逐次调用 `closeTab`，每次做：

```
┌─────────────────────────────────────────────┐
│ closeTab(id)                                │
│  1. IPC invoke('close-browser-view', id)    │ ← 每次 300ms+ 往返
│     ├─ loadURL('about:blank') + 300ms超时   │
│     └─ cleanup (removeChildView + destroy)  │
│  2. DOM: remove tabEl                       │
│  3. DOM: remove/add addButton               │ ← 20次 DOM 重排
│  4. 如果关了当前标签，再 activateTab(…)     │
└─────────────────────────────────────────────┘
```

20个标签 = **6秒以上卡顿**。

## 优化方案

### 修改 1：主进程 — 新增批量关闭 IPC (`main/ipcHandlers/app.js`)

```js
// 批量关闭 BrowserView（并行关闭，总耗时约300ms而非N×300ms）
ipcMain.handle('close-browser-views', async (event, tabIds) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error('无法获取窗口实例');
    console.log(`[诊断主进程] close-browser-views handler 开始: tabIds=[${tabIds}]`);
    const results = await Promise.allSettled(
        tabIds.map(tabId => closeBrowserView(window, tabId))
    );
    console.log(`[诊断主进程] close-browser-views handler 完成`);
    return results.map(r => r.status === 'fulfilled' ? r.value : false);
});
```

### 修改 2：渲染进程 — 新增 `batchCloseTabs` 批量函数 (`html/index.js`)

```js
/**
 * 批量关闭标签页（优化性能：一次IPC并行关闭 + 一次DOM批量移除）
 * @param {number[]} tabIds - 要关闭的标签页ID数组
 * @param {boolean} [activateNext=true] - 如果关闭了当前激活标签，是否自动激活下一个
 */
async function batchCloseTabs(tabIds, activateNext = true) {
    if (!tabIds || tabIds.length === 0) return;
    console.log(`[诊断] batchCloseTabs 开始: ids=[${tabIds}], 时间=${Date.now()}`);

    const wasCurrentActive = tabIds.includes(currentTabId);

    // 1. 暂存加号按钮（只需一次）
    const addButton = document.getElementById('add-tab');
    if (addButton) addButton.remove();

    // 2. 一次性移除所有 DOM 标签
    for (const id of tabIds) {
        const tabEl = document.querySelector(`.tab[data-id="${id}"]`);
        if (tabEl) tabEl.remove();
    }

    // 3. 重新添加加号按钮（只需一次）
    if (addButton) {
        document.getElementById('tabs').appendChild(addButton);
    }

    // 4. 并行 IPC 关闭 BrowserView（主进程用 Promise.allSettled 并行）
    try {
        await ipcRenderer.invoke('close-browser-views', tabIds);
    } catch (error) {
        console.error('[诊断] batchCloseTabs IPC 调用失败:', error);
    }

    // 5. 如果关闭了当前激活标签，激活相邻标签
    if (wasCurrentActive && activateNext) {
        const remainingTabs = document.querySelectorAll('.tab');
        if (remainingTabs.length > 0) {
            const lastTab = remainingTabs[remainingTabs.length - 1];
            console.log('[诊断] batchCloseTabs 自动激活:', lastTab.dataset.id);
            await activateTab(Number(lastTab.dataset.id));
        } else {
            currentTabId = null;
        }
    }

    console.log(`[诊断] batchCloseTabs 完成, 时间=${Date.now()}`);
}
```

### 修改 3：重构批量关闭函数 (`html/index.js`)

```js
// 关闭右侧标签 → 用批量方式
async function closeRightTabs(fromTabId) {
    const allTabs = document.querySelectorAll('.tab');
    let startIndex = -1;
    for (let i = 0; i < allTabs.length; i++) {
        if (Number(allTabs[i].dataset.id) === fromTabId) {
            startIndex = i;
            break;
        }
    }
    if (startIndex === -1) return;

    // 收集右侧标签 ID，用批量关闭
    const idsToClose = [];
    for (let i = allTabs.length - 1; i > startIndex; i--) {
        idsToClose.push(Number(allTabs[i].dataset.id));
    }
    await batchCloseTabs(idsToClose);
}

// 关闭左侧标签 → 用批量方式
async function closeLeftTabs(fromTabId) {
    const allTabs = document.querySelectorAll('.tab');
    let startIndex = -1;
    for (let i = 0; i < allTabs.length; i++) {
        if (Number(allTabs[i].dataset.id) === fromTabId) {
            startIndex = i;
            break;
        }
    }
    if (startIndex === -1) return;

    const idsToClose = [];
    for (let i = 0; i < startIndex; i++) {
        idsToClose.push(Number(allTabs[i].dataset.id));
    }
    await batchCloseTabs(idsToClose);
}

// 关闭其他标签 → 用批量方式
async function closeOtherTabs(exceptTabId) {
    const allTabs = document.querySelectorAll('.tab');
    const idsToClose = [];
    for (const tab of allTabs) {
        const tabId = Number(tab.dataset.id);
        if (tabId !== exceptTabId) {
            idsToClose.push(tabId);
        }
    }
    await batchCloseTabs(idsToClose);
}

// 关闭所有标签 → 用批量方式
async function closeAllTabs() {
    const allTabs = document.querySelectorAll('.tab');
    const idsToClose = [];
    for (const tab of allTabs) {
        idsToClose.push(Number(tab.dataset.id));
    }
    await batchCloseTabs(idsToClose, false);
}
```

## 性能对比

| 操作 | 当前行为 | 优化后 |
|------|---------|-------|
| 20个标签 | IPC 串行 20次 (≈6秒) | IPC **并行** 1次 (≈300ms) |
| DOM 操作 | 20次 addButton 移除/加回 | **1次** 移除/加回 |
| CPU 卡顿 | 持续 6 秒 UI 冻结 | ~300ms 内完成，几乎无感 |

## 数据流对比

```
优化前:                              优化后:
closeRightTabs(n=20)                closeRightTabs(n=20)
  ├─ await closeTab(id19)             ├─ 收集 ids [19,18,...,0]
  │   ├─ IPC ──→ closeBrowserView     ├─ batchCloseTabs(ids)
  │   │           └─ 300ms timeout    │   ├─ 一次性移除所有 DOM
  │   └─ DOM: remove + addButton      │   ├─ 一次 addButton 操作
  ├─ await closeTab(id18)             │   └─ IPC ──→ close-browser-views
  │   ├─ IPC ──→ closeBrowserView     │               └─ Promise.allSettled
  │   │           └─ 300ms timeout    │                   ├─ closeBrowserView(19)
  │   └─ DOM: remove + addButton      │                   ├─ closeBrowserView(18)
  ├─ ... (20次串行)                    │                   ├─ ... (并行!)
  └─ 总计: ~6秒                        └─ 总计: ~300ms
```

你觉得这个方案可以吗？如果同意，请切换到 **Craft 模式**（或告诉我切换到 Craft 模式），我就帮你应用所有修改。