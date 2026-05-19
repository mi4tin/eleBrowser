const { ipcRenderer } = require('electron');

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

ipcRenderer.on('dialog-init', (event, data) => {
    const { 
        title, 
        message, 
        confirmText, 
        cancelText, 
        type = 'default',
        username = '',
        password = ''
    } = data;
    
    const titleEl = document.getElementById('dialog-title');
    titleEl.innerHTML = title;

    const messageEl = document.getElementById('dialog-message');
    messageEl.innerHTML = message;
    
    const saveUserPwdEl = document.getElementById('dialog-save-user-pwd');
    let usernameInput = null;
    let passwordInput = null;
    
    if (type === 'save-password') {
        saveUserPwdEl.classList.add('show');
        
        usernameInput = document.getElementById('save-pwd-username');
        passwordInput = document.getElementById('save-pwd-password');
        const pwdToggleBtn = document.getElementById('save-pwd-toggle');
        
        usernameInput.value = username;
        passwordInput.value = password;
        
        pwdToggleBtn.addEventListener('click', () => {
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                pwdToggleBtn.classList.add('show');
            } else {
                passwordInput.type = 'password';
                pwdToggleBtn.classList.remove('show');
            }
        });
    } else {
        saveUserPwdEl.classList.remove('show');
    }
    
    const footerEl = document.getElementById('dialog-footer');
    let buttonsHtml = '';
    
    if (cancelText) {
        buttonsHtml += `<button type="button" class="dialog-btn dialog-btn-cancel" id="btn-cancel">${escapeHtml(cancelText)}</button>`;
    }
    buttonsHtml += `<button type="button" class="dialog-btn dialog-btn-confirm" id="btn-confirm">${escapeHtml(confirmText)}</button>`;
    
    footerEl.innerHTML = buttonsHtml;
    
    const confirmBtn = document.getElementById('btn-confirm');
    confirmBtn.addEventListener('click', () => {
        if (type === 'save-password') {
            ipcRenderer.send('dialog-result', {
                confirmed: true,
                username: usernameInput ? usernameInput.value : '',
                password: passwordInput ? passwordInput.value : ''
            });
        } else {
            ipcRenderer.send('dialog-result', true);
        }
    });
    
    if (cancelText) {
        const cancelBtn = document.getElementById('btn-cancel');
        cancelBtn.addEventListener('click', () => {
            if (type === 'save-password') {
                ipcRenderer.send('dialog-result', {
                    confirmed: false
                });
            } else {
                ipcRenderer.send('dialog-result', false);
            }
        });
    }
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && cancelText) {
            if (type === 'save-password') {
                ipcRenderer.send('dialog-result', {
                    confirmed: false
                });
            } else {
                ipcRenderer.send('dialog-result', false);
            }
        } else if (e.key === 'Enter' && e.target.tagName !== 'INPUT') {
            if (type === 'save-password') {
                ipcRenderer.send('dialog-result', {
                    confirmed: true,
                    username: usernameInput ? usernameInput.value : '',
                    password: passwordInput ? passwordInput.value : ''
                });
            } else {
                ipcRenderer.send('dialog-result', true);
            }
        }
    });
});
