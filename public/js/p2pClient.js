// 文件传输客户端（服务器中转模式）
class P2PClient {
  constructor(app) {
    this.app = app;
    this.socket = app.socket;
    
    // 初始化文件传输客户端
    this.init();
  }

  // 初始化文件传输客户端
  init() {
    // 绑定Socket事件
    this.bindSocketEvents();
  }

  // 绑定Socket事件
  bindSocketEvents() {
    // 接收文件传输请求
    this.socket.on('file-transfer-request', (data) => {
      this.handleFileTransferRequest(data);
    });
    
    // 接收文件传输响应
    this.socket.on('file-transfer-response', (data) => {
      this.handleFileTransferResponse(data);
    });
    
    // 接收文件下载通知
    this.socket.on('file-ready-for-download', (data) => {
      this.handleFileReadyForDownload(data);
    });
  }

  // 显示发送文件模态框
  showSendModal() {
    // 填充设备下拉框
    this.populateDeviceDropdown();
    
    // 清空文件选择
    const fileInput = document.getElementById('p2p-file-input');
    fileInput.value = '';
    
    // 显示模态框
    const modal = new bootstrap.Modal(document.getElementById('p2p-transfer-modal'));
    modal.show();
  }

  // 填充设备下拉框
  populateDeviceDropdown() {
    const deviceSelect = document.getElementById('target-device');
    const devices = this.app.deviceManager.getDevices();
    
    // 清空现有选项
    deviceSelect.innerHTML = '';
    
    // 添加默认选项
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '请选择接收设备';
    defaultOption.disabled = true;
    defaultOption.selected = true;
    deviceSelect.appendChild(defaultOption);
    
    // 添加设备选项
    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = device.name;
      deviceSelect.appendChild(option);
    });
  }

  // 发送文件
  sendFiles() {
    const fileInput = document.getElementById('p2p-file-input');
    const files = fileInput.files;
    const deviceSelect = document.getElementById('target-device');
    const selectedDeviceId = deviceSelect.value;
    
    if (files.length === 0) {
      this.app.showStatus('请选择要发送的文件', 'warning');
      return;
    }
    
    if (!selectedDeviceId) {
      this.app.showStatus('请选择接收设备', 'warning');
      return;
    }
    
    // 关闭模态框
    const modal = bootstrap.Modal.getInstance(document.getElementById('p2p-transfer-modal'));
    modal.hide();
    
    // 准备文件信息
    const fileInfos = Array.from(files).map(file => ({
      name: file.name,
      size: file.size,
      type: file.type
    }));
    
    // 先发送文件传输请求，等待接收方确认
    this.sendFileTransferRequest(selectedDeviceId, Array.from(files), fileInfos);
  }

  // 发送文件传输请求
  sendFileTransferRequest(targetDeviceId, files, fileInfos) {
    // 发送文件传输请求
    this.socket.emit('file-transfer-request', {
      to: targetDeviceId,
      fileInfo: fileInfos
    });
    
    this.app.showStatus('文件传输请求已发送，等待接收方确认', 'info');
    
    // 存储待发送的文件信息，等待接收方确认
    this.pendingTransfer = {
      targetDeviceId,
      files,
      fileInfos
    };
  }

  // 处理文件传输响应
  handleFileTransferResponse(data) {
    const { from, accepted, fileInfo } = data;
    const device = this.app.deviceManager.getDeviceById(from);
    
    if (accepted) {
      this.app.showStatus(`${device.name} 已接受文件传输请求，开始上传文件`, 'success');
      
      // 如果是当前设备发起的传输请求，开始上传文件
      if (this.pendingTransfer && this.pendingTransfer.targetDeviceId === from) {
        this.uploadFilesToServer(this.pendingTransfer.targetDeviceId, this.pendingTransfer.files);
        this.pendingTransfer = null;
      }
    } else {
      this.app.showStatus(`${device.name} 已拒绝文件传输请求`, 'warning');
      this.pendingTransfer = null;
    }
  }

  // 上传文件到服务器
  uploadFilesToServer(targetDeviceId, files) {
    for (const file of files) {
      // 创建传输项
      const transferId = `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.app.fileManager.addTransferItem(transferId, file.name, 'uploading', 0);
      
      // 使用XMLHttpRequest上传文件，支持进度监控
      const xhr = new XMLHttpRequest();
      this.app.fileManager.registerUploadRequest(transferId, xhr, file.name);
      
      // 监听上传进度
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Number(((e.loaded / e.total) * 100).toFixed(2));
          this.app.fileManager.updateTransferProgress(transferId, progress);
        }
      });
      
      // 监听上传完成
      xhr.addEventListener('load', () => {
        this.app.fileManager.finishUploadRequest(transferId, file.name);
        if (xhr.status === 200) {
          this.app.fileManager.updateTransferItem(transferId, 'completed', 100);
          this.app.showStatus(`文件 ${file.name} 上传成功，正在通知接收方`, 'success');
        } else {
          this.app.fileManager.updateTransferItem(transferId, 'failed', 0);
          this.app.showStatus(`文件 ${file.name} 上传失败`, 'danger');
        }
      });
      
      // 监听上传错误
      xhr.addEventListener('error', () => {
        this.app.fileManager.finishUploadRequest(transferId, file.name);
        this.app.fileManager.updateTransferItem(transferId, 'failed', 0);
        this.app.showStatus(`文件 ${file.name} 上传失败`, 'danger');
      });
      
      // 发送请求
      xhr.open('POST', '/api/files/transfer');
      
      // 创建FormData
      const formData = new FormData();
      formData.append('file', file);
      formData.append('targetDeviceId', targetDeviceId);
      
      // 发送请求
      xhr.send(formData);
    }
  }

  // 处理文件传输请求
  handleFileTransferRequest(data) {
    const { from, fileInfo } = data;
    const device = this.app.deviceManager.getDeviceById(from);
    
    // 显示确认对话框
    const fileNames = fileInfo.map(f => f.name).join(', ');
    const confirmMessage = `${device.name} 想要发送以下文件：\n${fileNames}\n\n是否接受？`;
    
    if (confirm(confirmMessage)) {
      // 接受文件传输
      this.socket.emit('file-transfer-response', {
        to: from,
        accepted: true,
        fileInfo: fileInfo
      });
      
      this.app.showStatus('已接受文件传输请求', 'info');
    } else {
      // 拒绝文件传输
      this.socket.emit('file-transfer-response', {
        to: from,
        accepted: false
      });
    }
  }

  // 处理文件传输响应
  handleFileTransferResponse(data) {
    const { from, accepted } = data;
    const device = this.app.deviceManager.getDeviceById(from);
    
    if (accepted) {
      this.app.showStatus(`${device.name} 已接受文件传输请求`, 'success');
    } else {
      this.app.showStatus(`${device.name} 已拒绝文件传输请求`, 'warning');
    }
  }

  // 处理文件可下载通知
  handleFileReadyForDownload(data) {
    const { fileId, fileName, fileSize, fromDevice } = data;
    const device = this.app.deviceManager.getDeviceById(fromDevice);
    
    this.app.showStatus(`${device.name} 发送的文件 ${fileName} 已准备好下载`, 'info');
    
    // 自动下载文件
    this.downloadFileFromServer(fileId, fileName, fileSize);
  }

  // 从服务器下载文件
  downloadFileFromServer(fileId, fileName, fileSize) {
    // 创建传输项
    const transferId = `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.app.fileManager.addTransferItem(transferId, fileName, 'downloading', 0);
    
    // 创建下载链接
    const link = document.createElement('a');
    link.href = `/api/files/transfer/${fileId}?fileName=${encodeURIComponent(fileName)}`;
    link.download = fileName;
    link.style.display = 'none';
    
    // 添加到文档并点击
    document.body.appendChild(link);
    link.click();
    
    // 移除链接
    document.body.removeChild(link);
    
    // 更新传输进度
    setTimeout(() => {
      this.app.fileManager.updateTransferItem(transferId, 'completed', 100);
      this.app.showStatus(`文件 ${fileName} 下载成功`, 'success');
    }, 1000);
  }
}
