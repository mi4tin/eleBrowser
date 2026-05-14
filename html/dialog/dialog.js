const { ipcRenderer } = require('electron');

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

ipcRenderer.on('dialog-init', (event, data) => {
    const { message, confirmText, cancelText } = data;
    
    const messageEl = document.getElementById('dialog-message');
    messageEl.textContent = message;
    
    const footerEl = document.getElementById('dialog-footer');
    let buttonsHtml = '';
    
    if (cancelText) {
        buttonsHtml += `<button type="button" class="dialog-btn dialog-btn-cancel" id="btn-cancel">${escapeHtml(cancelText)}</button>`;
    }
    buttonsHtml += `<button type="button" class="dialog-btn dialog-btn-confirm" id="btn-confirm">${escapeHtml(confirmText)}</button>`;
    
    footerEl.innerHTML = buttonsHtml;
    
    const confirmBtn = document.getElementById('btn-confirm');
    confirmBtn.addEventListener('click', () => {
        ipcRenderer.send('dialog-result', true);
    });
    
    if (cancelText) {
        const cancelBtn = document.getElementById('btn-cancel');
        cancelBtn.addEventListener('click', () => {
            ipcRenderer.send('dialog-result', false);
        });
    }
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && cancelText) {
            ipcRenderer.send('dialog-result', false);
        } else if (e.key === 'Enter') {
            ipcRenderer.send('dialog-result', true);
        }
    });
});
