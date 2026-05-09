function formatBytes(n) {
    if (n == null || n <= 0 || Number.isNaN(n)) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    const d = i === 0 ? 0 : i === 1 ? 0 : 1;
    return `${v.toFixed(d)} ${units[i]}`;
}

function formatRemainSeconds(sec) {
    if (sec == null || !Number.isFinite(sec) || sec < 0) return '';
    if (sec < 1) return '即将完成';
    if (sec < 60) return `还剩 ${Math.ceil(sec)} 秒`;
    const m = Math.floor(sec / 60);
    const s = Math.ceil(sec % 60);
    return `还剩 ${m} 分 ${s} 秒`;
}

function timeAgo(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
    return `${Math.floor(s / 86400)} 天前`;
}

const svgFolder =
    '<svg class="item-action-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
const svgOpenExternal =
    '<svg class="item-action-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>';
const svgPause =
    '<svg class="item-action-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>';
const svgPlay =
    '<svg class="item-action-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7L8 5z"/></svg>';
const svgCancelDownload =
    '<svg class="item-action-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59 16.41 17 12 13.41z"/></svg>';

function renderProgressControlsHtml(item) {
    const paused = Boolean(item.paused);
    const toggleIcon = paused ? svgPlay : svgPause;
    const toggleTitle = paused ? '继续' : '暂停';
    return `<div class="item-progress-actions" role="group" aria-label="下载控制">
    <button type="button" class="item-action-btn item-progress-btn" data-action="progress-toggle" title="${toggleTitle}">${toggleIcon}</button>
    <button type="button" class="item-action-btn item-progress-btn" data-action="progress-cancel" title="取消">${svgCancelDownload}</button>
  </div>`;
}

function renderActionsHtml(hasSavePath) {
    if (!hasSavePath) return '';
    return `<div class="item-actions" role="group" aria-label="文件操作">
    <button type="button" class="item-action-btn" data-action="reveal" title="在文件夹中显示">${svgFolder}</button>
    <button type="button" class="item-action-btn" data-action="open" title="打开">${svgOpenExternal}</button>
  </div>`;
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** 生成单条列表行的 HTML（与主进程 serialize 字段一致） */
function buildRowHtml(item) {
    const name = escapeHtml(item.filename || '下载');
    const icon = '📦';
    const idAttr = escapeHtml(item.id);
    if (item.state === 'progressing') {
        const total = item.totalBytes > 0 ? item.totalBytes : null;
        const rec = item.receivedBytes || 0;
        const pct = total ? Math.min(100, (rec / total) * 100) : 0;
        const sizeLine =
            total != null ? `${formatBytes(rec)}/${formatBytes(total)}` : `${formatBytes(rec)}`;
        const remain = formatRemainSeconds(item.etaSeconds);
        const progressControls = renderProgressControlsHtml(item);
        return `<div class="item item-progressing" data-id="${idAttr}">
          <div class="item-icon">${icon}</div>
          <div class="item-body">
            <div class="item-name" title="${name}">${name}</div>
            <div class="progress-bar"><span style="width:${pct}%"></span></div>
            <div class="item-meta">${sizeLine}${remain ? ` · ${remain}` : ''}</div>
          </div>
          ${progressControls}
        </div>`;
    }
    const total = item.totalBytes > 0 ? formatBytes(item.totalBytes) : formatBytes(item.receivedBytes);
    const doneMeta = item.endTime ? `${total} · ${timeAgo(item.endTime)}` : total;
    const stateLabel =
        item.state === 'cancelled'
            ? '已取消'
            : item.state === 'interrupted'
              ? '已中断'
              : item.state === 'completed'
                ? doneMeta
                : item.state;
    const actions = renderActionsHtml(Boolean(item.hasSavePath));
    return `<div class="item item-done" data-id="${idAttr}">
        <div class="item-icon">${icon}</div>
        <div class="item-body">
          <div class="item-name" title="${name}">${name}</div>
          <div class="item-meta">${escapeHtml(String(stateLabel))}</div>
        </div>
        ${actions}
      </div>`;
}

function findRowById(listEl, id) {
    for (const row of listEl.querySelectorAll('.item')) {
        if (row.getAttribute('data-id') === id) return row;
    }
    return null;
}

function renderFullList(list) {
    const el = document.getElementById('list');
    if (!list || list.length === 0) {
        el.innerHTML = '<div class="empty">暂无下载记录</div>';
        return;
    }
    el.innerHTML = list.map((item) => buildRowHtml(item)).join('');
}

function upsertRowInList(item) {
    const el = document.getElementById('list');
    const html = buildRowHtml(item);
    const existing = findRowById(el, item.id);
    if (existing) {
        existing.outerHTML = html;
        return;
    }
    const empty = el.querySelector('.empty');
    if (empty) empty.remove();
    el.insertAdjacentHTML('afterbegin', html);
}

function removeRowById(id) {
    const el = document.getElementById('list');
    const row = findRowById(el, id);
    row?.remove();
    if (!el.querySelector('.item')) {
        el.innerHTML = '<div class="empty">暂无下载记录</div>';
    }
}

document.getElementById('close-btn').addEventListener('click', () => {
    window.downloadsPanel.close();
});

document.querySelector('.footer').addEventListener('click', () => {
    void window.downloadsPanel.openUserDownloads();
});

const listEl = document.getElementById('list');

listEl.addEventListener('click', (e) => {
    const progBtn = e.target.closest('.item-progress-btn');
    if (progBtn) {
        const row = progBtn.closest('.item');
        const id = row && row.getAttribute('data-id');
        if (!id) return;
        e.stopPropagation();
        e.preventDefault();
        const action = progBtn.getAttribute('data-action');
        if (action === 'progress-toggle') void window.downloadsPanel.togglePause(id);
        else if (action === 'progress-cancel') void window.downloadsPanel.cancelDownload(id);
        return;
    }
    const btn = e.target.closest('.item-action-btn');
    if (!btn) return;
    const row = btn.closest('.item');
    const id = row && row.getAttribute('data-id');
    if (!id) return;
    e.stopPropagation();
    e.preventDefault();
    const action = btn.getAttribute('data-action');
    if (action === 'reveal') void window.downloadsPanel.revealItem(id);
    else if (action === 'open') void window.downloadsPanel.openFile(id);
});

listEl.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.item-done');
    if (!row) return;
    const id = row.getAttribute('data-id');
    if (id) void window.downloadsPanel.revealItem(id);
});

const unsubs = [
    window.downloadsPanel.onListInit((list) => {
        renderFullList(list);
    }),
    window.downloadsPanel.onItemUpdated((item) => {
        upsertRowInList(item);
    }),
    window.downloadsPanel.onItemRemoved((id) => {
        removeRowById(id);
    })
];

window.addEventListener('beforeunload', () => {
    unsubs.forEach((fn) => {
        if (typeof fn === 'function') fn();
    });
});
