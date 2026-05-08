const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE_URL = 'http://localhost:8011';

// 用户数据管理
let USER_DATA_PATH = null;
let DEVICE_DATA_PATH = null;

function initUserDataPath(app) {
    USER_DATA_PATH = path.join(app.getPath('userData'), 'user-auth.json');
    DEVICE_DATA_PATH = path.join(app.getPath('userData'), 'device-info.json');
    initDeviceInfo();
}

// 读取用户信息
// {
//   "userId": 10000,
//   "email": "123@qq.com",
//   "nickname": "xx",
//   "avatar": "",
//   "token": ""
// }
function getLoginUserInfo() {
    try {
        if (USER_DATA_PATH && fs.existsSync(USER_DATA_PATH)) {
            const data = fs.readFileSync(USER_DATA_PATH, 'utf8');
            const userData = JSON.parse(data);
            return { success: true, data: userData };
        }
        return { success: true, data: null };
    } catch (error) {
        console.error('读取用户数据失败:', error);
        return { success: false, error: error.message };
    }
}

// 保存用户信息
function saveUserData(userData) {
    try {
        if (!userData) {
            if (USER_DATA_PATH && fs.existsSync(USER_DATA_PATH)) {
                fs.unlinkSync(USER_DATA_PATH);
            }
        } else {
            fs.writeFileSync(USER_DATA_PATH, JSON.stringify(userData, null, 2), 'utf8');
        }
        return { success: true };
    } catch (error) {
        console.error('保存用户数据失败:', error);
        return { success: false, error: error.message };
    }
}

// 读取设备信息
//{deviceId:"xxxx"}
function getDeviceInfo() {
    try {
        if (DEVICE_DATA_PATH && fs.existsSync(DEVICE_DATA_PATH)) {
            const data = fs.readFileSync(DEVICE_DATA_PATH, 'utf8');
            const deviceData = JSON.parse(data);
            return { success: true, data: deviceData };
        }
        return { success: true, data: null };
    } catch (error) {
        console.error('读取设备信息失败:', error);
        return { success: false, error: error.message };
    }
}

// 保存设备信息。不支持删除操作
function initDeviceInfo() {
    const deviceData =getDeviceInfo();
    if(deviceData?.data?.deviceId){
        console.log('已有设备id');
        return  { success: true}
    }
    //生成设备id
    const deviceId = 'device-' + Math.random().toString(36).slice(2, 10);
    deviceData = {deviceId:deviceId};
    try {
        if (!deviceData) {
            console.log('无有效设备信息');
        } else {
            fs.writeFileSync(DEVICE_DATA_PATH, JSON.stringify(deviceData, null, 2), 'utf8');
        }
        return { success: true };
    } catch (error) {
        console.error('保存设备信息失败:', error);
        return { success: false, error: error.message };
    }
}

function getDeviceId() {
    const deviceData =getDeviceInfo();
    return deviceData?.data?.deviceId || null;
}

// HTTP 请求工具函数
function apiRequest(endpoint, data) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(data);
        
        const url = new URL(API_BASE_URL + endpoint);
        const client = url.protocol === 'https:' ? https : http;

        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = client.request(options, (res) => {
            let responseData = '';

            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    resolve(parsed);
                } catch (e) {
                    reject(new Error('响应解析失败=>url:' + url+',postData:'+postData+',responseData:'+responseData));
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.write(postData);
        req.end();
    });
}

module.exports = {
    apiRequest,
    API_BASE_URL,
    initUserDataPath,
    getLoginUserInfo,
    saveUserData,
    getDeviceId
};