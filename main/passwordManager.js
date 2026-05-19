const fs = require('fs');
const path = require('path');

/** @type {import('electron').App | null} */
let APP_REF = null;
let PASSWORDS_DATA_PATH = null;

// 初始化密码数据路径
function initPasswordManager(app) {
    APP_REF = app;
    PASSWORDS_DATA_PATH = path.join(app.getPath('userData'), 'saved-passwords.json');
    console.log('密码数据路径:', PASSWORDS_DATA_PATH);
}

// 读取保存的密码
function getSavedPasswords() {
    try {
        if (PASSWORDS_DATA_PATH && fs.existsSync(PASSWORDS_DATA_PATH)) {
            const data = fs.readFileSync(PASSWORDS_DATA_PATH, 'utf8');
            const passwords = JSON.parse(data);
            return { success: true, data: passwords };
        }
        return { success: true, data: [] };
    } catch (error) {
        console.error('读取密码数据失败:', error);
        return { success: false, error: error.message, data: [] };
    }
}

// 保存密码
function savePassword(passwordInfo) {
    try {
        const result = getSavedPasswords();
        let passwords = result.data || [];
        
        // 检查是否已存在相同的密码记录
        const existingIndex = passwords.findIndex(p => 
            p.url === passwordInfo.url && 
            p.username === passwordInfo.username
        );
        
        if (existingIndex >= 0) {
            // 更新已有记录
            passwords[existingIndex] = {
                ...passwords[existingIndex],
                ...passwordInfo,
                updatedAt: new Date().toISOString()
            };
        } else {
            // 添加新记录
            passwords.push({
                ...passwordInfo,
                id: Date.now().toString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        }
        
        fs.writeFileSync(PASSWORDS_DATA_PATH, JSON.stringify(passwords, null, 2), 'utf8');
        return { success: true };
    } catch (error) {
        console.error('保存密码失败:', error);
        return { success: false, error: error.message };
    }
}

// 删除密码
function deletePassword(id) {
    try {
        const result = getSavedPasswords();
        let passwords = result.data || [];
        passwords = passwords.filter(p => p.id !== id);
        fs.writeFileSync(PASSWORDS_DATA_PATH, JSON.stringify(passwords, null, 2), 'utf8');
        return { success: true };
    } catch (error) {
        console.error('删除密码失败:', error);
        return { success: false, error: error.message };
    }
}

// 根据 URL 获取保存的密码
function getPasswordsByUrl(url) {
    try {
        const result = getSavedPasswords();
        const passwords = result.data || [];
        
        // 匹配域名
        const hostname = new URL(url).hostname;
        const matched = passwords.filter(p => {
            try {
                const savedHostname = new URL(p.url).hostname;
                return savedHostname === hostname;
            } catch {
                return false;
            }
        });
        
        return { success: true, data: matched };
    } catch (error) {
        console.error('获取密码失败:', error);
        return { success: false, error: error.message, data: [] };
    }
}

module.exports = {
    initPasswordManager,
    getSavedPasswords,
    savePassword,
    deletePassword,
    getPasswordsByUrl
};
