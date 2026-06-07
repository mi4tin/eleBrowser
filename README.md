## 项目介绍
这是一个浏览器，具有常用的浏览器功能。

## 环境要求

- **Node.js**: 推荐 v20.x LTS 或更高版本
- **包管理器**: npm 或 pnpm（推荐 npm）

> **注意**: 
> - 如果使用 pnpm，请确保版本与 Node.js 兼容
> - pnpm 7.x 不支持 Node.js 24+
> - pnpm 11.x 需要 Node.js 22+
> - 推荐使用 npm 以避免兼容性问题

## 开发相关

### 安装依赖

**方式一：使用 npm（推荐）**
```bash
npm install --legacy-peer-deps
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

**使用 pnpm：**
```bash
pnpm start
```

### 打包项目

#### 打包所有平台
```bash
pnpm dist
```

#### 打包 Windows 版本
```bash
pnpm dist:win
```

#### 打包 Mac 版本
```bash
pnpm dist:mac
```

#### 打包 Linux 版本
```bash
pnpm dist:linux
```

#### 构建并打包到目录（不打包成安装包）
```bash
pnpm build:unpack
```
