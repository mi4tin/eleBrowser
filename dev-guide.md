# 开发指南

## 项目介绍
这是一个浏览器，具有常用的浏览器功能。

## 开发环境要求

- **Node.js**: 推荐 v20.x LTS (下载地址：https://nodejs.org/dist/latest-v20.x/)或更高版本
nodejs 安装里包含npm
安装参考 https://chat.deepseek.com/a/chat/s/4d169388-0700-4023-a18c-46ef4c1c7894
- 安装成功版本：
node v20.20.2
npm 10.8.2
- **包管理器**: npm 或 pnpm（推荐 npm）
npm install 依赖


> **注意[未验证]**: 
> - 如果使用 pnpm，请确保版本与 Node.js 兼容
> - pnpm 7.x 不支持 Node.js 24+
> - pnpm 11.x 需要 Node.js 22+
> - 推荐使用 npm 以避免兼容性问题

## 开发相关

### 安装依赖

**方式一：使用 npm（推荐）**
```bash
npm install --legacy-peer-deps   //--legacy-peer-deps 绕过严格的依赖检查
```

**方式二：使用 pnpm**
```bash
pnpm install
```

> 如果遇到 `Cannot read properties of null (reading 'matches')` 错误：
> - 清理缓存：`npm cache clean --force`
> - 然后重新运行 `npm install --legacy-peer-deps`

### 运行项目

**使用 npm：**
```bash
npm start
```

### 打包项目

#### 打包所有平台
```bash
npm run dist
```

#### 打包 Windows 版本
```bash
npm run dist:win
```

#### 打包 Mac 版本
```bash
npm run dist:mac
```

#### 打包 Linux 版本
```bash
npm run dist:linux
```

#### 构建并打包到目录（不打包成安装包）
```bash
npm run build:unpack
```
