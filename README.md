# lan-file-transfer-hub

> A LAN file transfer web app with multi-file upload, real-time progress tracking, and cross-device transfer status sync.

# 局域网文件传输网页

一个基于 Node.js + Express + Socket.IO 的局域网文件传输项目，支持多文件上传、实时传输进度、跨设备状态同步、文件下载与删除。

## 功能特性

- 多文件上传（`input[multiple]`）
- 文件上传进度实时显示（百分比 + 速度）
- 传输状态区分：`上传中` / `已完成` / `失败` / `已取消`
- 传输状态同步到所有在线设备
- 文件总大小同步显示到所有设备
- 上传中临时文件后缀：`.uploading`，完成后自动还原
- 文件列表自动过滤 `.uploading` 临时文件
- 上传取消/失败后自动清理服务器残留分片文件
- 文件名保留原始名称（含中文名修复）
- 支持浅色/深色主题，滚动条颜色随主题切换

## 技术栈

- 后端：`Node.js`、`Express`、`Socket.IO`、`Multer`
- 前端：原生 `HTML/CSS/JavaScript`
- 其他：`chokidar`、`uuid`、`simple-peer`（保留依赖）

## 项目结构

```text
.
├─ public/
│  ├─ css/style.css
│  ├─ js/app.js
│  ├─ js/deviceManager.js
│  ├─ js/fileManager.js
│  ├─ icon/close.svg
│  └─ index.html
├─ server/
│  ├─ config.js
│  ├─ index.js
│  ├─ routes/files.js
│  ├─ controllers/fileController.js
│  └─ services/fileService.js
├─ uploads/
├─ package.json
└─ README.md
```

## 环境要求

- Node.js `>= 16`（建议 `18+`）
- npm `>= 8`

## 安装与启动

```bash
npm install
npm start
```

开发模式（自动重启）：

```bash
npm run dev
```

启动后访问：

- 本机：`http://localhost:3000`
- 局域网其他设备：`http://<服务器局域网IP>:3000`

## 主要配置

配置文件：`server/config.js`

- `PORT`：服务端口（默认 `3000`）
- `UPLOAD_DIR`：上传目录（默认 `./uploads`）
- `UPLOAD_VALIDATION`：上传校验统一配置
  - `MAX_FILE_SIZE`：单文件大小上限（默认 `10GB`）
  - `ALLOWED_MIME_TYPES`：允许上传的 MIME 类型
  - `MIME_EXTENSION_MAP`：MIME 与扩展名映射
  - `BLOCKED_EXTENSIONS`：禁止扩展名
  - `FILE_NAME_MAX_LENGTH`：文件名最大长度
  - `FILE_NAME_INVALID_PATTERN`：非法字符规则

## API 概览

基础路径：`/api/files`

- `GET /config`：获取前端上传校验配置
- `POST /upload`：上传文件（支持 `file` 与 `files` 字段）
- `POST /transfer`：上传并中转给目标设备
- `GET /transfer/:fileId`：下载中转文件
- `GET /list`：获取文件列表
- `GET /download/:filename`：下载文件
- `GET /:filename`：获取文件信息
- `DELETE /:filename`：删除文件

## 上传与状态说明

- 上传时先落盘为 `xxx.ext.uploading`
- 上传成功后重命名为原文件名（冲突时自动追加 `(1)`, `(2)`）
- 文件列表不显示 `.uploading` 文件
- 状态说明：
  - `上传中`：显示进度条与实时速度
  - `已完成`：可下载、删除
  - `失败/已取消`：可删除记录

## 常见问题

1. 其他设备访问不到页面
- 确认设备在同一局域网
- 检查服务端机器防火墙是否放行端口 `3000`
- 用服务端局域网 IP 访问，而不是 `localhost`

2. 上传失败
- 检查文件大小和格式是否符合 `server/config.js` 配置
- 检查磁盘空间是否充足

3. 中文文件名异常
- 项目已做文件名编码兼容修复
- 若浏览器缓存旧脚本，请强制刷新（`Ctrl + F5`）

## 脚本命令

- `npm start`：生产方式启动
- `npm run dev`：开发方式启动（nodemon）

## 许可证

MIT

