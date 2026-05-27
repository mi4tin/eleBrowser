const { ipcRenderer } = require('electron');

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function maskPassword(password) {
    if (!password) return '';
    return '••••••••';
}

ipcRenderer.on('dialog-init', (event, data) => {
    const { 
        title, 
        message, 
        confirmText, 
        cancelText, 
        type = 'default',
        username = '',
        password = '',
        savedPasswords = []
    } = data;
    
    const titleEl = document.getElementById('dialog-title');
    titleEl.innerHTML = title;

    const messageEl = document.getElementById('dialog-message');
    messageEl.innerHTML = message;
    
    const saveUserPwdEl = document.getElementById('dialog-save-user-pwd');
    const savedPasswordsEl = document.getElementById('dialog-saved-passwords');
    let usernameInput = null;
    let passwordInput = null;
    
    if (type === 'save-password') {
        saveUserPwdEl.classList.add('show');
        savedPasswordsEl.classList.remove('show');
        
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
    } else if (type === 'show-saved-passwords') {
        saveUserPwdEl.classList.remove('show');
        savedPasswordsEl.classList.add('show');
        
        const savedPasswordsList = document.getElementById('saved-passwords-list');
        savedPasswordsList.innerHTML = '';
        
        savedPasswords.forEach((pwd, index) => {
            const item = document.createElement('div');
            item.className = 'saved-password-item';
            item.innerHTML = `
                <div class="saved-password-icon">🔑</div>
                <div class="saved-password-info">
                    <div class="saved-password-username">${escapeHtml(pwd.username)}</div>
                    <div class="saved-password-password">${maskPassword(pwd.password)}</div>
                </div>
            `;
            item.addEventListener('click', () => {
                ipcRenderer.send('dialog-result', {
                    confirmed: true,
                    action: 'fill',
                    username: pwd.username,
                    password: pwd.password
                });
            });
            savedPasswordsList.appendChild(item);
        });
        
        const manageItem = document.getElementById('manage-passwords-item');
        manageItem.addEventListener('click', () => {
            ipcRenderer.send('dialog-result', {
                confirmed: true,
                action: 'manage'
            });
        });
    } else {
        saveUserPwdEl.classList.remove('show');
        savedPasswordsEl.classList.remove('show');
    }
    
    const footerEl = document.getElementById('dialog-footer');
    let buttonsHtml = '';
    
    if (type !== 'show-saved-passwords') {
        if (cancelText) {
            buttonsHtml += `<button type="button" class="dialog-btn dialog-btn-cancel" id="btn-cancel">${escapeHtml(cancelText)}</button>`;
        }
        if (confirmText) {
            buttonsHtml += `<button type="button" class="dialog-btn dialog-btn-confirm" id="btn-confirm">${escapeHtml(confirmText)}</button>`;
        }
    }
    
    footerEl.innerHTML = buttonsHtml;
    
    if (type !== 'show-saved-passwords') {
        const confirmBtn = document.getElementById('btn-confirm');
        if (confirmBtn) {
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
        }
        
        if (cancelText) {
            const cancelBtn = document.getElementById('btn-cancel');
            if (cancelBtn) {
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
        }
    }
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (type === 'show-saved-passwords') {
                ipcRenderer.send('dialog-result', {
                    confirmed: false,
                    action: 'cancel'
                });
            } else if (cancelText) {
                if (type === 'save-password') {
                    ipcRenderer.send('dialog-result', {
                        confirmed: false
                    });
                } else {
                    ipcRenderer.send('dialog-result', false);
                }
            }
        } else if (e.key === 'Enter' && e.target.tagName !== 'INPUT' && type !== 'show-saved-passwords') {
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
