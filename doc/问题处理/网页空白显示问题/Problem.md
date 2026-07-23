我来分析"关闭右侧标签"导致激活标签变空白的问题。首先我需要查看相关的代码。
Now let me look at how BrowserView bounds are managed after activation:
Let me check how the right-click context menu determines element info and which tab is right-clicked:
让我查看标签页的 HTML 结构以及 `closeRightTabs` 中的处理逻辑，重点关注 DOM 操作和 BrowserView 的交互。
经过对代码的深入分析，我找到了问题的根源。让我总结一下分析结果：

## 问题根源分析

**核心问题**在 `main.js` 的 `closeBrowserView` 函数（第575行起）中：

```575:694:main.js
async function closeBrowserView(window, tabId) {
    // ...
    wc.loadURL('about:blank')  // ← 导航到 about:blank
    // ...
    cleanup()  // ← 之后才销毁
}
```

当执行"关闭右侧标签"时，如果**当前激活的标签页**恰好位于要关闭的右侧范围内，会发生以下时序问题：

### 具体场景举例

标签页：**[TabA(id=1), TabB(id=2, 激活), TabC(id=3)]**
用户右键点击 **TabA** → "关闭右侧标签"

1. **`closeRightTabs(1)`** 开始执行，从右向左循环关闭
2. **`closeTab(3)`** → 关闭 TabC（非激活，没问题）
3. **`closeTab(2)`** → 关闭 **TabB（当前激活的！）**
   - `closeBrowserView(window, 2)` → **`wc.loadURL('about:blank')`** → 激活标签页显示空白！
   - 300ms后 `cleanup()` → 从 `contentView` 移除 → 窗口空白
4. `closeTab(2)` 的自动激活逻辑 → 激活最后一个剩余标签 TabA
5. 但此时**菜单处理器的 `activate-tab(1)` 可能已先行执行**（因为 IPC 是异步的，`activateTab` 改变了 `currentTabId`）
6. 由于 `currentTabId` 已被改成 TabA 的 ID，`closeTab` 中的**自动激活判断被跳过**！

### 根本原因有两点

| # | 问题 | 位置 |
|---|------|------|
| 1 | `closeBrowserView` 先 `loadURL('about:blank')` 再清理，导致激活标签短暂显示空白 | `main.js:640` |
| 2 | `closeRightTabs` 的 IPC 处理未 `await`，`activate-tab` 与关闭操作存在**竞态条件**，导致自动激活被跳过 | `html/index.js:1418-1421` |

第一点造成空白闪现，第二点导致自动激活失败 → 永久空白。

### 修复方案

需要**两处修改**：

**方案A（推荐）— 修复 `closeRightTabs` 的激活逻辑：**
在关闭右侧标签之前，如果激活标签在右侧范围内，**先激活右键点击的标签**，然后再执行关闭。

**方案B — 修复 `closeBrowserView`：**
如果是激活标签正在被关闭，跳过 `loadURL('about:blank')` 直接清理。

**方案C — 修复竞态条件：**
让 `close-right-tab` 的 IPC 处理 `await closeRightTabs()`，并且在 `closeRightTabs` 内部最后一个关闭操作完成后，确保激活正确的标签。

---

要开始实施修复吗？切换到 Craft Mode 后我可以执行修改。建议采用**方案A + 方案C**的组合修复。




