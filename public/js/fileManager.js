class FileManager {
  constructor(app) {
    this.app = app;
    this.socket = app.socket;
    this.files = [];
    this.transferringFiles = new Set();
    this.validationConfig = null;
    this.validationConfigPromise = null;
    this.transferItems = new Map();
    this.uploadRequests = new Map();
    this.uploadFileStates = new Map();
    this.suppressedTransferUpdates = new Set();
    this.init();
  }

  init() {
    this.loadValidationConfig();
    this.loadFiles();
    this.bindEvents();
    this.requestActiveTransfers();
  }

  bindEvents() {
    const clearBtn = document.getElementById('clear-files');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearFiles());
    }

    const clearTransferBtn = document.getElementById('clear-transfer-list');
    if (clearTransferBtn) {
      clearTransferBtn.addEventListener('click', () => this.clearFinishedTransferItems());
    }

    this.socket.on('connect', () => {
      this.requestActiveTransfers();
    });

    this.socket.on('files-updated', (data) => {
      this.handleFilesUpdated(data);
    });

    this.socket.on('transfer-status-update', (payload) => {
      this.handleTransferStatusUpdate(payload);
    });

    this.socket.on('active-transfers', (payload) => {
      this.handleActiveTransfers(payload);
    });

    this.socket.on('transfer-status-remove', (payload) => {
      this.handleTransferStatusRemove(payload);
    });

    window.addEventListener('beforeunload', (event) => {
      if (!this.hasActiveUploads()) {
        return;
      }

      event.preventDefault();
      // Modern browsers ignore custom text but require returnValue to trigger prompt.
      event.returnValue = '有文件正在上传，离开页面会中断上传。';
    });
  }

  hasActiveUploads() {
    return this.uploadRequests.size > 0;
  }

  async loadValidationConfig() {
    if (this.validationConfig) return this.validationConfig;
    if (this.validationConfigPromise) return this.validationConfigPromise;

    this.validationConfigPromise = fetch('/api/files/config')
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load upload config');
        return response.json();
      })
      .then((config) => {
        this.validationConfig = config;
        return config;
      })
      .catch((error) => {
        console.error('Load upload config error:', error);
        this.app.showStatus('加载上传配置失败，已跳过前端校验', 'warning');
        this.validationConfig = {
          maxFileSize: Number.MAX_SAFE_INTEGER,
          allowedMimeTypes: [],
          mimeExtensionMap: {},
          blockedExtensions: [],
          fileNameMaxLength: 255,
          fileNameInvalidPattern: "[<>:/\\\\|?*\"']",
          allowedTypeDescription: ''
        };
        return this.validationConfig;
      })
      .finally(() => {
        this.validationConfigPromise = null;
      });

    return this.validationConfigPromise;
  }

  requestActiveTransfers() {
    if (this.socket && this.socket.connected) {
      this.socket.emit('request-active-transfers');
    }
  }

  handleActiveTransfers(payload) {
    if (!Array.isArray(payload)) return;

    payload.forEach((item) => {
      this.syncFileStateFromTransfer({
        transferId: item.transferId,
        fileName: item.fileName,
        status: item.status,
        progress: item.progress || 0,
        speedText: item.speedText || '--',
        fileSize: Number.isFinite(item.fileSize) ? item.fileSize : 0
      });

      this.upsertTransferItem({
        transferId: item.transferId,
        fileName: item.fileName,
        status: item.status,
        progress: item.progress || 0,
        deviceId: item.deviceId,
        deviceName: item.deviceName || '未知设备',
        isLocal: item.deviceId === this.socket.id
      });
    });
  }

  handleTransferStatusUpdate(payload) {
    if (!payload || !payload.transferId) return;

    if (
      payload.deviceId === this.socket.id &&
      payload.status === 'cancelled' &&
      this.suppressedTransferUpdates.has(payload.transferId)
    ) {
      this.suppressedTransferUpdates.delete(payload.transferId);
      return;
    }

    this.syncFileStateFromTransfer(payload);

    this.upsertTransferItem({
      transferId: payload.transferId,
      fileName: payload.fileName,
      status: payload.status,
      progress: payload.progress || 0,
      deviceId: payload.deviceId,
      deviceName: payload.deviceName || '未知设备',
      isLocal: payload.deviceId === this.socket.id
    });
  }

  handleTransferStatusRemove(payload) {
    if (!payload || !Array.isArray(payload.transferIds)) return;

    payload.transferIds.forEach((transferId) => {
      this.removeUploadFileState(transferId);
      const item = this.transferItems.get(transferId);
      if (!item || item.isLocal) return;
      this.transferItems.delete(transferId);
      const node = document.getElementById(`transfer-${transferId}`);
      if (node) node.remove();
    });
  }

  emitTransferStatus(transfer) {
    if (!this.socket || !this.socket.connected) return;

    this.socket.emit('transfer-status-update', {
      transferId: transfer.transferId,
      fileName: transfer.fileName,
      status: transfer.status,
      progress: transfer.progress,
      speedText: typeof transfer.speedText === 'string' ? transfer.speedText : undefined,
      fileSize: Number.isFinite(transfer.fileSize) ? transfer.fileSize : undefined
    });
  }

  normalizeProgress(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Number(n.toFixed(2))));
  }

  formatProgress(value) {
    return `${this.normalizeProgress(value).toFixed(2)}%`;
  }

  formatTransferSpeed(bytesPerSecond) {
    const speed = Number(bytesPerSecond);
    if (!Number.isFinite(speed) || speed <= 0) {
      return '--';
    }

    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let value = speed;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return `${value.toFixed(2)} ${units[unitIndex]}`;
  }

  upsertTransferItem(transfer) {
    if (!transfer || !transfer.transferId) return;

    const current = this.transferItems.get(transfer.transferId) || {};
    const merged = {
      transferId: transfer.transferId,
      fileName: transfer.fileName || current.fileName || '未知文件',
      status: transfer.status || current.status || 'pending',
      progress: Number.isFinite(transfer.progress) ? this.normalizeProgress(transfer.progress) : (current.progress || 0),
      deviceId: transfer.deviceId || current.deviceId || '',
      deviceName: transfer.deviceName || current.deviceName || '未知设备',
      isLocal: typeof transfer.isLocal === 'boolean' ? transfer.isLocal : !!current.isLocal
    };

    this.transferItems.set(transfer.transferId, merged);
    this.renderTransferItem(merged);
  }

  renderTransferItem(transfer) {
    const transferList = document.getElementById('transfer-list');
    if (!transferList) return;

    let item = document.getElementById(`transfer-${transfer.transferId}`);
    if (!item) {
      item = document.createElement('div');
      item.id = `transfer-${transfer.transferId}`;
      item.className = `list-group-item transfer-item ${transfer.status}`;
      item.innerHTML = `
        <div class="mb-1 d-flex justify-content-between align-items-center">
          <div class="d-flex align-items-center gap-2">
            <button class="btn btn-sm btn-danger btn-delete-transfer" data-transfer-id="${transfer.transferId}">
              <img src="icon/close.svg" alt="关闭" class="btn-delete-transfer-icon">
            </button>
            <small class="font-weight-medium transfer-filename"></small>
          </div>
          <div class="d-flex gap-2">
            <small class="transfer-status"></small>
          </div>
        </div>
        <small class="text-muted transfer-device d-block mb-1"></small>
        <small class="text-muted transfer-progress">0%</small>
      `;

      const deleteBtn = item.querySelector('.btn-delete-transfer');
      deleteBtn.addEventListener('click', () => {
        this.deleteTransferItem(transfer.transferId);
      });

      transferList.appendChild(item);
    }

    item.className = `list-group-item transfer-item ${transfer.status}`;
    item.querySelector('.transfer-filename').textContent = transfer.fileName;
    item.querySelector('.transfer-device').textContent = `设备：${transfer.deviceName}`;

    const statusEl = item.querySelector('.transfer-status');
    statusEl.className = `transfer-status text-${this.getStatusColor(transfer.status)}`;
    statusEl.textContent = this.getStatusText(transfer.status);

    const progress = this.normalizeProgress(transfer.progress);
    const progressText = item.querySelector('.transfer-progress');
    if (progressText) {
      progressText.textContent = this.formatProgress(progress);
    }

    const deleteBtn = item.querySelector('.btn-delete-transfer');
    if (transfer.status === 'uploading' && transfer.isLocal) {
      deleteBtn.title = '取消上传';
    } else if (this.isInProgressStatus(transfer.status)) {
      deleteBtn.title = '传输中不可清除';
    } else {
      deleteBtn.title = '清除记录';
    }
  }

  isInProgressStatus(status) {
    return status === 'uploading' || status === 'downloading' || status === 'pending';
  }

  isRemovableStatus(status) {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
  }

  clearUploadStatesByStatuses(statuses = []) {
    if (!Array.isArray(statuses) || statuses.length === 0) return;

    const statusSet = new Set(statuses);
    let changed = false;
    this.uploadFileStates.forEach((state, id) => {
      if (state && statusSet.has(state.status)) {
        this.uploadFileStates.delete(id);
        changed = true;
      }
    });

    if (changed) {
      this.renderFileList();
    }
  }

  async loadFiles(options = {}) {
    const { clearFailedAndCancelled = false } = options;
    try {
      const response = await fetch('/api/files/list');
      if (!response.ok) throw new Error('Failed to load files');
      this.files = await response.json();
      if (clearFailedAndCancelled) {
        this.clearUploadStatesByStatuses(['failed', 'cancelled']);
      }
      this.renderFileList();
    } catch (error) {
      console.error('Error loading files:', error);
      this.app.showStatus('加载文件失败', 'danger');
    }
  }

  handleFilesUpdated(data) {
    this.loadFiles();

    if (data.action === 'upload' && data.fileInfo) {
      this.cleanupUploadStatesByName(data.fileInfo.originalName);
      this.app.showStatus(`文件 ${data.fileInfo.originalName} 已上传，列表已更新`, 'success');
    }

    if (data.action === 'delete' && data.filename) {
      this.app.showStatus(`文件 ${data.filename} 已删除，列表已更新`, 'info');
    }
  }

  syncFileStateFromTransfer(transfer) {
    if (!transfer || !transfer.transferId) return;

    const status = transfer.status;
    const progress = Number.isFinite(transfer.progress) ? transfer.progress : 0;

    if (status === 'uploading') {
      this.upsertUploadFileState({
        id: transfer.transferId,
        fileName: transfer.fileName,
        fileSize: Number.isFinite(transfer.fileSize) ? transfer.fileSize : 0,
        status: 'uploading',
        progress,
        speedText: transfer.speedText || '--',
        updatedAt: new Date().toISOString()
      });
      return;
    }

    if (status === 'failed' || status === 'cancelled') {
      this.upsertUploadFileState({
        id: transfer.transferId,
        fileName: transfer.fileName,
        fileSize: Number.isFinite(transfer.fileSize) ? transfer.fileSize : 0,
        status,
        progress: 0,
        speedText: '--',
        updatedAt: new Date().toISOString()
      });
      return;
    }

    if (status === 'completed') {
      this.removeUploadFileState(transfer.transferId);
    }
  }

  cleanupUploadStatesByName(fileName) {
    if (!fileName) return;

    let changed = false;
    this.uploadFileStates.forEach((state, id) => {
      if (state.fileName === fileName && (state.status === 'uploading' || state.status === 'completed')) {
        this.uploadFileStates.delete(id);
        changed = true;
      }
    });

    if (changed) {
      this.renderFileList();
    }
  }

  renderFileList() {
    const fileTableBody = document.getElementById('file-table-body');
    const fileCount = document.getElementById('file-count');
    const emptyFiles = document.getElementById('empty-files');

    const stateRows = Array.from(this.uploadFileStates.values());
    const totalCount = this.files.length + stateRows.length;
    fileCount.textContent = totalCount;
    fileTableBody.innerHTML = '';

    if (totalCount === 0) {
      emptyFiles.classList.remove('d-none');
    } else {
      emptyFiles.classList.add('d-none');
    }

    stateRows.forEach((state) => {
      const tr = document.createElement('tr');
      tr.className = 'fade-in';
      tr.id = this.getUploadStateRowId(state.id);

      let actionHtml = '';
      if (state.status === 'uploading') {
        actionHtml = `
          <div class="progress upload-state-progress" style="min-width: 140px;">
            <div class="progress-bar bg-primary upload-state-progress-bar" role="progressbar" style="width: ${this.normalizeProgress(state.progress)}%" aria-valuenow="${this.normalizeProgress(state.progress)}" aria-valuemin="0" aria-valuemax="100"></div>
            <span class="upload-state-progress-text">${this.formatProgress(state.progress)}</span>
          </div>
          <div class="upload-state-speed">${state.speedText || '--'}</div>
        `;
      } else if (state.status === 'failed') {
        actionHtml = `
          <div class="d-flex align-items-center gap-2">
            <span class="badge bg-danger">失败</span>
            <button class="btn btn-sm btn-outline-danger delete-upload-state-btn" data-state-id="${state.id}">
              <i class="fa fa-trash"></i> 删除
            </button>
          </div>
        `;
      } else {
        actionHtml = `
          <div class="d-flex align-items-center gap-2">
            <span class="badge bg-secondary">已取消</span>
            <button class="btn btn-sm btn-outline-danger delete-upload-state-btn" data-state-id="${state.id}">
              <i class="fa fa-trash"></i> 删除
            </button>
          </div>
        `;
      }

      tr.innerHTML = `
        <td>
          <i class="fa fa-file-o file-icon"></i>
          ${state.fileName}
        </td>
        <td class="file-size">${this.app.formatFileSize(state.fileSize || 0)}</td>
        <td>${state.updatedAt ? this.app.formatDateTime(state.updatedAt) : '--'}</td>
        <td>${actionHtml}</td>
      `;

      const deleteStateBtn = tr.querySelector('.delete-upload-state-btn');
      if (deleteStateBtn) {
        deleteStateBtn.addEventListener('click', () => {
          this.deleteUploadStateItem(state.id);
        });
      }

      fileTableBody.appendChild(tr);
    });

    this.files.forEach((file) => {
      const tr = document.createElement('tr');
      tr.className = 'fade-in';
      tr.innerHTML = `
        <td>
          <i class="fa fa-file-o file-icon"></i>
          ${file.filename}
        </td>
        <td class="file-size">${this.app.formatFileSize(file.size)}</td>
        <td>${this.app.formatDateTime(file.mtime)}</td>
        <td>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-primary file-list-action-btn download-btn" data-filename="${file.filename}">
              <i class="fa fa-download"></i> 下载
            </button>
            <button class="btn btn-sm btn-danger file-list-action-btn delete-btn" data-filename="${file.filename}">
              <i class="fa fa-trash"></i> 删除
            </button>
          </div>
        </td>
      `;

      const downloadBtn = tr.querySelector('.download-btn');
      downloadBtn.addEventListener('click', () => this.downloadFile(file.filename));

      const deleteBtn = tr.querySelector('.delete-btn');
      deleteBtn.addEventListener('click', () => this.deleteFile(file.filename));

      fileTableBody.appendChild(tr);
    });
  }

  upsertUploadFileState(state) {
    if (!state || !state.id) return;

    const current = this.uploadFileStates.get(state.id) || {};
    const next = {
      id: state.id,
      fileName: state.fileName || current.fileName || '未知文件',
      fileSize: Number.isFinite(state.fileSize) ? state.fileSize : (current.fileSize || 0),
      status: state.status || current.status || 'uploading',
      progress: Number.isFinite(state.progress) ? this.normalizeProgress(state.progress) : (current.progress || 0),
      speedText: typeof state.speedText === 'string' ? state.speedText : (current.speedText || '--'),
      updatedAt: state.updatedAt || new Date().toISOString()
    };

    // For upload progress ticks, update only the corresponding row progress UI.
    if (
      current.id &&
      current.status === 'uploading' &&
      next.status === 'uploading' &&
      current.fileName === next.fileName &&
      current.fileSize === next.fileSize
    ) {
      this.uploadFileStates.set(state.id, next);
      this.updateUploadStateProgressOnly(state.id, next.progress, next.speedText);
      return;
    }

    this.uploadFileStates.set(state.id, {
      ...next
    });
    this.renderFileList();
  }

  getUploadStateRowId(id) {
    return `upload-state-row-${encodeURIComponent(id)}`;
  }

  updateUploadStateProgressOnly(id, progress, speedText = '--') {
    const row = document.getElementById(this.getUploadStateRowId(id));
    if (!row) {
      return;
    }

    const progressBar = row.querySelector('.upload-state-progress-bar');
    const progressText = row.querySelector('.upload-state-progress-text');
    const speedTextEl = row.querySelector('.upload-state-speed');
    if (!progressBar || !progressText || !speedTextEl) {
      return;
    }

    const normalized = this.normalizeProgress(progress);
    progressBar.style.width = `${normalized}%`;
    progressBar.setAttribute('aria-valuenow', String(normalized));
    progressText.textContent = this.formatProgress(normalized);
    speedTextEl.textContent = speedText || '--';
  }

  removeUploadFileState(id) {
    if (!id) return;
    if (this.uploadFileStates.delete(id)) {
      this.renderFileList();
    }
  }

  deleteUploadStateItem(id) {
    const state = this.uploadFileStates.get(id);
    if (!state) return;
    if (state.status === 'uploading') {
      this.app.showStatus('上传中的文件不能从文件列表删除，请在传输进度栏取消上传', 'warning');
      return;
    }
    this.uploadFileStates.delete(id);
    this.renderFileList();
  }

  async deleteFile(filename) {
    if (this.transferringFiles.has(filename)) {
      this.app.showStatus(`文件 ${filename} 正在传输，暂时无法删除`, 'warning');
      return;
    }

    if (!confirm(`确定要删除文件 "${filename}" 吗？`)) return;

    try {
      const response = await fetch(`/api/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed');
      this.app.showStatus(`文件 ${filename} 删除成功`, 'success');
      this.loadFiles();
    } catch (error) {
      console.error('Delete file error:', error);
      this.app.showStatus('删除文件失败', 'danger');
    }
  }

  async clearFiles() {
    if (this.files.length === 0) {
      this.app.showStatus('文件列表为空', 'info');
      return;
    }

    const filesToDelete = this.files.filter((file) => !this.transferringFiles.has(file.filename));
    if (filesToDelete.length === 0) {
      this.app.showStatus('当前文件都在传输中，无法清空', 'warning');
      return;
    }

    const confirmMessage = filesToDelete.length === this.files.length
      ? `确定要清空全部 ${this.files.length} 个文件吗？此操作不可恢复。`
      : `确定要清空 ${filesToDelete.length} 个文件吗？有 ${this.files.length - filesToDelete.length} 个文件正在传输，将被跳过。`;

    if (!confirm(confirmMessage)) return;

    try {
      for (const file of filesToDelete) {
        await fetch(`/api/files/${encodeURIComponent(file.filename)}`, { method: 'DELETE' });
      }
      this.app.showStatus(`成功清空 ${filesToDelete.length} 个文件`, 'success');
      this.loadFiles();
    } catch (error) {
      console.error('Clear files error:', error);
      this.app.showStatus('清空文件失败', 'danger');
    }
  }

  clearFinishedTransferItems() {
    let removed = 0;
    this.transferItems.forEach((item, transferId) => {
      if (this.isRemovableStatus(item.status)) {
        this.transferItems.delete(transferId);
        const node = document.getElementById(`transfer-${transferId}`);
        if (node) node.remove();
        removed += 1;
      }
    });

    if (removed === 0) {
      this.app.showStatus('没有可清除的已结束传输项', 'info');
      return;
    }
    this.app.showStatus(`已清除 ${removed} 个已结束传输项`, 'success');
  }

  async uploadFiles() {
    const fileInput = document.getElementById('file-input');
    const files = fileInput.files;
    if (!files || files.length === 0) {
      this.app.showStatus('请选择要上传的文件', 'warning');
      return;
    }

    await this.loadValidationConfig();

    const validFiles = [];
    Array.from(files).forEach((file) => {
      if (this.performFullFileCheck(file)) validFiles.push(file);
    });

    if (validFiles.length === 0) return;

    validFiles.forEach((file) => this.uploadSingleFile(file));
    fileInput.value = '';
    document.getElementById('upload-btn').disabled = true;
  }

  performFullFileCheck(file) {
    if (!this.checkFileSize(file)) return false;
    if (!this.checkFileFormat(file)) return false;
    if (!this.checkFileExtension(file)) return false;
    if (!this.checkFileName(file)) return false;
    if (!this.checkFileSecurity(file)) return false;
    return true;
  }

  checkFileSize(file) {
    const maxSize = this.validationConfig.maxFileSize;
    if (file.size > maxSize) {
      this.showTransferError(
        `文件 ${file.name} 大小超出限制`,
        `当前文件大小为 ${this.app.formatFileSize(file.size)}，最大允许 ${this.app.formatFileSize(maxSize)}。`
      );
      return false;
    }
    return true;
  }

  checkFileFormat(file) {
    const allowedTypes = this.validationConfig.allowedMimeTypes || [];
    if (allowedTypes.length === 0) return true;
    if (!allowedTypes.includes(file.type)) {
      this.showTransferError(
        `文件 ${file.name} 类型不允许`,
        this.validationConfig.allowedTypeDescription || '当前文件类型不在允许列表中。'
      );
      return false;
    }
    return true;
  }

  checkFileExtension(file) {
    const fileName = file.name.toLowerCase();
    const ext = fileName.substring(fileName.lastIndexOf('.') + 1);
    const mimeToExt = this.validationConfig.mimeExtensionMap || {};
    const allowedExts = mimeToExt[file.type];

    if (allowedExts && !allowedExts.includes(ext)) {
      this.showTransferError(
        `文件 ${file.name} 扩展名与类型不匹配`,
        `扩展名 .${ext} 与 MIME 类型 ${file.type} 不一致，请确认文件格式。`
      );
      return false;
    }
    return true;
  }

  checkFileName(file) {
    const fileName = file.name;
    const maxLength = this.validationConfig.fileNameMaxLength || 255;
    if (fileName.length > maxLength) {
      this.showTransferError(`文件 ${fileName} 名称过长`, `文件名长度不能超过 ${maxLength} 个字符。`);
      return false;
    }

    const pattern = this.validationConfig.fileNameInvalidPattern || "[<>:/\\\\|?*\"']";
    const invalidChars = new RegExp(pattern);
    if (invalidChars.test(fileName)) {
      this.showTransferError(`文件 ${fileName} 名称包含非法字符`, '文件名不能包含 < > : / \\ | ? * " \'。');
      return false;
    }
    return true;
  }

  checkFileSecurity(file) {
    const fileName = file.name.toLowerCase();
    const suspiciousExtensions = this.validationConfig.blockedExtensions || [];
    const ext = fileName.substring(fileName.lastIndexOf('.') + 1);
    if (suspiciousExtensions.includes(ext)) {
      this.showTransferError(`文件 ${file.name} 存在安全风险`, '不允许上传可执行文件或脚本文件。');
      return false;
    }

    const hasSuspiciousSuffix = suspiciousExtensions.some((x) => fileName.endsWith(`.${x}`));
    if (fileName.includes('.') && hasSuspiciousSuffix) {
      this.showTransferError(`文件 ${file.name} 可能是伪装文件`, '检测到可疑双扩展名，请确认文件来源后再上传。');
      return false;
    }
    return true;
  }

  createTransferId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  uploadSingleFile(file) {
    const transferId = this.createTransferId('upload');
    const deviceName = this.app.getDeviceName();

    this.transferringFiles.add(file.name);
    this.upsertUploadFileState({
      id: transferId,
      fileName: file.name,
      fileSize: file.size,
      status: 'uploading',
      progress: 0,
      updatedAt: new Date().toISOString()
    });

    this.upsertTransferItem({
      transferId,
      fileName: file.name,
      status: 'uploading',
      progress: 0,
      deviceId: this.socket.id,
      deviceName,
      isLocal: true
    });

    this.emitTransferStatus({
      transferId,
      fileName: file.name,
      status: 'uploading',
      progress: 0,
      fileSize: file.size
    });

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    this.registerUploadRequest(transferId, xhr, file.name);

    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      const progress = this.normalizeProgress((e.loaded / e.total) * 100);
      const request = this.uploadRequests.get(transferId);
      const now = Date.now();
      let speedText = '--';

      if (request) {
        if (request.lastTimestamp > 0 && e.loaded >= request.lastLoaded) {
          const deltaBytes = e.loaded - request.lastLoaded;
          const deltaSeconds = (now - request.lastTimestamp) / 1000;
          if (deltaSeconds > 0) {
            const currentBps = deltaBytes / deltaSeconds;
            request.smoothedBps = request.smoothedBps > 0
              ? request.smoothedBps * 0.7 + currentBps * 0.3
              : currentBps;
          }
        }
        request.lastLoaded = e.loaded;
        request.lastTimestamp = now;
        speedText = this.formatTransferSpeed(request.smoothedBps);
      }

      this.upsertUploadFileState({
        id: transferId,
        fileName: file.name,
        fileSize: file.size,
        status: 'uploading',
        progress,
        speedText,
        updatedAt: new Date().toISOString()
      });

      this.upsertTransferItem({
        transferId,
        fileName: file.name,
        status: 'uploading',
        progress,
        deviceId: this.socket.id,
        deviceName,
        isLocal: true
      });

      this.emitTransferStatus({
        transferId,
        fileName: file.name,
        status: 'uploading',
        progress,
        speedText,
        fileSize: file.size
      });
    });

    xhr.addEventListener('load', () => {
      this.finishUploadRequest(transferId, file.name);

      if (xhr.status === 200) {
        this.removeUploadFileState(transferId);
        this.upsertTransferItem({
          transferId,
          fileName: file.name,
          status: 'completed',
          progress: 100,
          deviceId: this.socket.id,
          deviceName,
          isLocal: true
        });
        this.emitTransferStatus({
          transferId,
          fileName: file.name,
          status: 'completed',
          progress: 100,
          fileSize: file.size
        });
        this.app.showStatus(`文件 ${file.name} 上传成功`, 'success');
        this.loadFiles();
        return;
      }

      let errorMessage = `文件 ${file.name} 上传失败`;
      let details = '';
      try {
        const response = JSON.parse(xhr.responseText);
        errorMessage = response.error || errorMessage;
        if (errorMessage.includes('File size exceeds limit')) {
          details = `文件大小超限，当前上限为 ${this.app.formatFileSize(this.validationConfig.maxFileSize)}。`;
        } else if (errorMessage.includes('Invalid file type')) {
          details = this.validationConfig.allowedTypeDescription || '文件类型不允许，请检查文件格式。';
        }
      } catch (_) {
        details = `HTTP 状态码：${xhr.status}`;
      }

      this.upsertTransferItem({
        transferId,
        fileName: file.name,
        status: 'failed',
        progress: 0,
        deviceId: this.socket.id,
        deviceName,
        isLocal: true
      });

      this.emitTransferStatus({
        transferId,
        fileName: file.name,
        status: 'failed',
        progress: 0,
        fileSize: file.size
      });

      this.upsertUploadFileState({
        id: transferId,
        fileName: file.name,
        fileSize: file.size,
        status: 'failed',
        progress: 0,
        updatedAt: new Date().toISOString()
      });

      this.app.showStatus(errorMessage, 'danger');
      this.showTransferError(errorMessage, details);
    });

    xhr.addEventListener('abort', () => {
      const request = this.uploadRequests.get(transferId);
      const cancelledByUser = !!(request && request.cancelledByUser);
      this.finishUploadRequest(transferId, file.name);

      if (!cancelledByUser) {
        this.upsertTransferItem({
          transferId,
          fileName: file.name,
          status: 'cancelled',
          progress: 0,
          deviceId: this.socket.id,
          deviceName,
          isLocal: true
        });
      }

      this.emitTransferStatus({
        transferId,
        fileName: file.name,
        status: 'cancelled',
        progress: 0,
        fileSize: file.size
      });

      this.upsertUploadFileState({
        id: transferId,
        fileName: file.name,
        fileSize: file.size,
        status: 'cancelled',
        progress: 0,
        updatedAt: new Date().toISOString()
      });

      this.app.showStatus(`文件 ${file.name} 已取消上传`, 'info');
    });

    xhr.addEventListener('error', () => {
      this.finishUploadRequest(transferId, file.name);

      this.upsertTransferItem({
        transferId,
        fileName: file.name,
        status: 'failed',
        progress: 0,
        deviceId: this.socket.id,
        deviceName,
        isLocal: true
      });

      this.emitTransferStatus({
        transferId,
        fileName: file.name,
        status: 'failed',
        progress: 0,
        fileSize: file.size
      });

      this.upsertUploadFileState({
        id: transferId,
        fileName: file.name,
        fileSize: file.size,
        status: 'failed',
        progress: 0,
        updatedAt: new Date().toISOString()
      });

      const errorMessage = `文件 ${file.name} 上传失败`;
      const details = '网络异常或服务器不可用，请稍后重试。';
      this.app.showStatus(errorMessage, 'danger');
      this.showTransferError(errorMessage, details);
    });

    xhr.open('POST', '/api/files/upload');
    xhr.send(formData);
  }

  finishUploadRequest(transferId, fileName) {
    this.transferringFiles.delete(fileName);
    this.uploadRequests.delete(transferId);
  }

  registerUploadRequest(transferId, xhr, fileName) {
    if (!transferId || !xhr) return;
    this.uploadRequests.set(transferId, {
      xhr,
      fileName: fileName || '',
      finished: false,
      cancelledByUser: false,
      lastLoaded: 0,
      lastTimestamp: 0,
      smoothedBps: 0
    });
  }

  downloadFile(filename) {
    const transferId = this.createTransferId('download');
    const deviceName = this.app.getDeviceName();

    this.transferringFiles.add(filename);
    this.upsertTransferItem({
      transferId,
      fileName: filename,
      status: 'downloading',
      progress: 0,
      deviceId: this.socket.id,
      deviceName,
      isLocal: true
    });

    this.emitTransferStatus({
      transferId,
      fileName: filename,
      status: 'downloading',
      progress: 0
    });

    const link = document.createElement('a');
    link.href = `/api/files/download/${encodeURIComponent(filename)}`;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      this.transferringFiles.delete(filename);
      this.upsertTransferItem({
        transferId,
        fileName: filename,
        status: 'completed',
        progress: 100,
        deviceId: this.socket.id,
        deviceName,
        isLocal: true
      });
      this.emitTransferStatus({
        transferId,
        fileName: filename,
        status: 'completed',
        progress: 100
      });
      this.app.showStatus(`文件 ${filename} 已开始下载`, 'success');
    }, 1000);
  }

  deleteTransferItem(id) {
    const transfer = this.transferItems.get(id);
    if (!transfer) return;

    if (transfer.status === 'uploading' && transfer.isLocal) {
      if (!confirm(`文件 "${transfer.fileName}" 正在上传，确定要取消吗？`)) {
        return;
      }

      const request = this.uploadRequests.get(id);
      if (request && request.xhr) {
        request.cancelledByUser = true;
        this.suppressedTransferUpdates.add(id);
        request.xhr.abort();
        if (request.fileName) {
          this.transferringFiles.delete(request.fileName);
        }
      }
      this.uploadRequests.delete(id);
      this.transferItems.delete(id);
      const item = document.getElementById(`transfer-${id}`);
      if (item) item.remove();
      return;
    }

    if (this.isInProgressStatus(transfer.status)) {
      this.app.showStatus('正在传输的项目不能清除', 'warning');
      return;
    }

    this.transferItems.delete(id);
    const item = document.getElementById(`transfer-${id}`);
    if (item) item.remove();
  }

  // Compatibility API for existing p2p client calls
  addTransferItem(id, filename, status, progress) {
    this.upsertTransferItem({
      transferId: id,
      fileName: filename,
      status,
      progress,
      deviceId: this.socket.id,
      deviceName: this.app.getDeviceName(),
      isLocal: true
    });
  }

  updateTransferProgress(id, progress) {
    const current = this.transferItems.get(id);
    if (!current) return;
    this.upsertTransferItem({
      transferId: id,
      fileName: current.fileName,
      status: current.status,
      progress,
      deviceId: current.deviceId,
      deviceName: current.deviceName,
      isLocal: current.isLocal
    });
  }

  updateTransferItem(id, status, progress) {
    const current = this.transferItems.get(id);
    if (!current) return;
    this.upsertTransferItem({
      transferId: id,
      fileName: current.fileName,
      status,
      progress,
      deviceId: current.deviceId,
      deviceName: current.deviceName,
      isLocal: current.isLocal
    });
  }

  showTransferError(errorMessage, details = '') {
    const modalHtml = `
      <div class="modal fade show d-block" tabindex="-1" style="background-color: rgba(0,0,0,0.5);">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header bg-danger text-white">
              <h5 class="modal-title"><i class="fa fa-exclamation-circle"></i> 传输失败</h5>
            </div>
            <div class="modal-body">
              <p class="mb-3">${errorMessage}</p>
              ${details ? `<p class="text-muted small">${details}</p>` : ''}
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-primary" id="error-modal-close">确定</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHtml;
    modalContainer.id = 'transfer-error-modal';
    document.body.appendChild(modalContainer);

    const closeBtn = modalContainer.querySelector('#error-modal-close');
    closeBtn.addEventListener('click', () => {
      modalContainer.remove();
    });

    modalContainer.addEventListener('click', (e) => {
      if (e.target === modalContainer) {
        modalContainer.remove();
      }
    });
  }

  getStatusColor(status) {
    const colors = {
      uploading: 'primary',
      downloading: 'info',
      completed: 'success',
      failed: 'danger',
      pending: 'warning',
      cancelled: 'secondary'
    };
    return colors[status] || 'secondary';
  }

  getStatusText(status) {
    const texts = {
      uploading: '上传中',
      downloading: '下载中',
      completed: '已完成',
      failed: '失败',
      pending: '等待中',
      cancelled: '已取消'
    };
    return texts[status] || '未知';
  }
}

