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

// 保存检测到的登录表单信息
let detectedLoginInfo = null;
let lastNavigationUrl = null;

// 查找表单中的用户名和密码输入框
function findLoginInputs() {
    const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"]');
    let usernameInput = null;
    let passwordInput = null;
    
    for (const input of inputs) {
        const type = input.type.toLowerCase();
        const id = input.id.toLowerCase();
        const name = input.name.toLowerCase();
        const placeholder = input.placeholder.toLowerCase();
        const className = input.className.toLowerCase();
        
        // 查找用户名输入框
        if (!usernameInput && type !== 'password') {
            if (id.includes('user') || id.includes('email') || id.includes('login') || id.includes('account') ||
                name.includes('user') || name.includes('email') || name.includes('login') || name.includes('account') ||
                placeholder.includes('账户') ||placeholder.includes('手机号') ||placeholder.includes('邮箱') ||placeholder.includes('user') || placeholder.includes('email') || placeholder.includes('login') ||
                className.includes('user') || className.includes('email') || className.includes('login')) {
                usernameInput = input;
            }
        }
        
        // 查找密码输入框
        if (!passwordInput && type === 'password') {
            passwordInput = input;
        }
    }


    console.log('找到用户名输入框:', usernameInput);
    console.log('找到密码输入框:', passwordInput);
    
    return { usernameInput, passwordInput };
}

// 发送登录信息到主进程
function sendLoginInfo() {
    if (detectedLoginInfo) {
        try {
            ipcRenderer.send('login-form-submitted', detectedLoginInfo);
            console.log('发送登录信息:', detectedLoginInfo);
        } catch (e) {
            console.error('发送登录信息失败:', e);
        }
    }
}

// 更新登录信息
function updateLoginInfo() {
    const { usernameInput, passwordInput } = findLoginInputs();
    if (usernameInput && passwordInput && usernameInput.value && passwordInput.value) {
        detectedLoginInfo = {
            url: window.location.href,
            username: usernameInput.value,
            password: passwordInput.value
        };
        console.log('更新登录信息:', detectedLoginInfo);
    }
}

// 查找登录按钮
function findLoginButtons() {
    const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]');
    const loginButtons = [];
    
    for (const button of buttons) {
        const text = (button.textContent || button.value || '').toLowerCase();
        const id = (button.id || '').toLowerCase();
        const className = (button.className || '').toLowerCase();
        const name = (button.name || '').toLowerCase();
        
        if (text.includes('login') || text.includes('signin') || text.includes('登录') || text.includes('登入') ||
            text.includes('submit') || text.includes('提交') ||
            id.includes('login') || id.includes('signin') ||
            className.includes('login') || className.includes('signin') ||
            name.includes('login') || name.includes('signin')) {
            loginButtons.push(button);
        }
    }
    
    return loginButtons;
}

// 监听登录按钮点击
function setupButtonListeners() {
    const loginButtons = findLoginButtons();
    console.log('找到登录按钮数量:', loginButtons.length);
    
    loginButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            updateLoginInfo();
            if (detectedLoginInfo) {
                console.log('检测到登录按钮点击:', detectedLoginInfo);
                // 延迟发送，确保页面可能开始导航
                setTimeout(sendLoginInfo, 300);
            }
        }, { capture: true });
    });
}

// 监听键盘回车
function setupKeyboardListener() {
    document.addEventListener('keydown', (event) => {
        console.log('当前活动元素:', document.activeElement);
        if (event.key === 'Enter') {
            const { passwordInput } = findLoginInputs();
            if (passwordInput && document.activeElement === passwordInput) {
                updateLoginInfo();
                if (detectedLoginInfo) {
                    console.log('检测到密码输入框回车:', detectedLoginInfo);
                    setTimeout(sendLoginInfo, 300);
                }
            }
        }
    }, { capture: true });
}

// 监听AJAX请求 - 通过注入脚本到页面上下文
function setupAjaxListener() {
    // 注入监听代码到页面上下文
    const script = document.createElement('script');
    script.textContent = `
        (function() {
            const originalXHR = window.XMLHttpRequest;
            const originalFetch = window.fetch;
            
            // 发送消息给preload
            function notifyLoginRequest(url) {
                window.postMessage({
                    type: 'ELE_LOGIN_REQUEST',
                    url: url
                }, '*');
            }
            
            // 监听XMLHttpRequest
            window.XMLHttpRequest = function() {
                const xhr = new originalXHR();
                const originalOpen = xhr.open;
                const originalSend = xhr.send;
                
                xhr.open = function(method, url, ...args) {
                    xhr._url = url;
                    return originalOpen.apply(this, arguments);
                };
                
                xhr.send = function(...args) {
                    if (xhr._url) {
                        const urlLower = xhr._url.toLowerCase();
                        if (urlLower.includes('login') || urlLower.includes('signin') || urlLower.includes('auth')) {
                            notifyLoginRequest(xhr._url);
                        }
                    }
                    return originalSend.apply(this, arguments);
                };
                
                return xhr;
            };
            
            // 监听fetch
            window.fetch = function(input, init, ...args) {
                const url = typeof input === 'string' ? input : input.url;
                if (url) {
                    const urlLower = url.toLowerCase();
                    if (urlLower.includes('login') || urlLower.includes('signin') || urlLower.includes('auth')) {
                        notifyLoginRequest(url);
                    }
                }
                return originalFetch.apply(this, arguments);
            };
        })();
    `;
    document.documentElement.appendChild(script);
    script.remove();
    
    // 监听来自页面的消息
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'ELE_LOGIN_REQUEST') {
            updateLoginInfo();
            if (detectedLoginInfo) {
                console.log('检测到登录AJAX/fetch请求:', detectedLoginInfo);
                setTimeout(sendLoginInfo, 500);
            }
        }
    });
}

// 监听输入框变化
function setupInputListeners() {
    const { usernameInput, passwordInput } = findLoginInputs();
    
    if (usernameInput && passwordInput) {
        // 监听表单提交
        const form = passwordInput.closest('form');
        if (form) {
            form.addEventListener('submit', (event) => {
                updateLoginInfo();
                if (detectedLoginInfo) {
                    console.log('检测到登录表单提交:', detectedLoginInfo);
                    setTimeout(sendLoginInfo, 200);
                }
            }, { capture: true });
        }
        
        // 监听输入框变化
        const handleInput = () => {
            updateLoginInfo();
        };
        
        usernameInput.addEventListener('input', handleInput);
        passwordInput.addEventListener('input', handleInput);
    }
}

// 监听页面导航变化
function setupNavigationListener() {
    // 监听hash变化
    window.addEventListener('hashchange', () => {
        if (detectedLoginInfo && lastNavigationUrl !== window.location.href) {
            console.log('检测到hash变化，发送登录信息');
            lastNavigationUrl = window.location.href;
            setTimeout(sendLoginInfo, 300);
        }
    });
    
    // 监听popstate
    window.addEventListener('popstate', () => {
        if (detectedLoginInfo && lastNavigationUrl !== window.location.href) {
            console.log('检测到popstate，发送登录信息');
            lastNavigationUrl = window.location.href;
            setTimeout(sendLoginInfo, 300);
        }
    });
}

// 观察DOM变化，查找新增的登录元素
function setupMutationObserver() {
    const observer = new MutationObserver(() => {
        setupInputListeners();
        setupButtonListeners();
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// 初始化所有监听
function initializeListeners() {
    setupInputListeners();
    setupButtonListeners();
    setupKeyboardListener();
    setupAjaxListener();
    setupNavigationListener();
    setupMutationObserver();


    console.log('初始化所有监听');
}

// 页面加载完成后设置监听
document.addEventListener('DOMContentLoaded', initializeListeners);

// 页面将要导航时，发送检测到的登录信息
window.addEventListener('beforeunload', () => {
    if (detectedLoginInfo && lastNavigationUrl !== window.location.href) {
        lastNavigationUrl = window.location.href;
        sendLoginInfo();
    }
});

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
