class P2PClient {
  constructor(app) {
    this.app = app;
    this.socket = app.socket;
    this.pendingTransfer = null;
    this.init();
  }

  init() {
    this.bindSocketEvents();
  }

  bindSocketEvents() {
    this.socket.on('file-transfer-request', (data) => {
      this.handleFileTransferRequest(data);
    });

    this.socket.on('file-transfer-response', (data) => {
      this.handleFileTransferResponse(data);
    });

    this.socket.on('file-ready-for-download', (data) => {
      this.handleFileReadyForDownload(data);
    });
  }

  showSendModal() {
    this.populateDeviceDropdown();
    const fileInput = document.getElementById('p2p-file-input');
    fileInput.value = '';
    const modal = new bootstrap.Modal(document.getElementById('p2p-transfer-modal'));
    modal.show();
  }

  populateDeviceDropdown() {
    const deviceSelect = document.getElementById('target-device');
    const devices = this.app.deviceManager.getDevices();
    deviceSelect.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select target device';
    defaultOption.disabled = true;
    defaultOption.selected = true;
    deviceSelect.appendChild(defaultOption);

    devices.forEach((device) => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = device.name;
      deviceSelect.appendChild(option);
    });
  }

  sendFiles() {
    const fileInput = document.getElementById('p2p-file-input');
    const files = fileInput.files;
    const deviceSelect = document.getElementById('target-device');
    const selectedDeviceId = deviceSelect.value;

    if (files.length === 0) {
      this.app.showStatus('Please select files to send', 'warning');
      return;
    }

    if (!selectedDeviceId) {
      this.app.showStatus('Please select a target device', 'warning');
      return;
    }

    const modal = bootstrap.Modal.getInstance(document.getElementById('p2p-transfer-modal'));
    modal.hide();

    const fileInfos = Array.from(files).map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type
    }));

    this.sendFileTransferRequest(selectedDeviceId, Array.from(files), fileInfos);
  }

  sendFileTransferRequest(targetDeviceId, files, fileInfos) {
    this.socket.emit('file-transfer-request', {
      to: targetDeviceId,
      fileInfo: fileInfos
    });

    this.app.showStatus('Transfer request sent. Waiting for receiver confirmation', 'info');
    this.pendingTransfer = {
      targetDeviceId,
      files,
      fileInfos
    };
  }

  handleFileTransferResponse(data) {
    const { from, accepted } = data;
    const device = this.app.deviceManager.getDeviceById(from);
    const name = device ? device.name : 'Device';

    if (accepted) {
      this.app.showStatus(`${name} accepted transfer request`, 'success');
      if (this.pendingTransfer && this.pendingTransfer.targetDeviceId === from) {
        this.uploadFilesToServer(this.pendingTransfer.targetDeviceId, this.pendingTransfer.files);
        this.pendingTransfer = null;
      }
      return;
    }

    this.app.showStatus(`${name} rejected transfer request`, 'warning');
    this.pendingTransfer = null;
  }

  uploadFilesToServer(targetDeviceId, files) {
    for (const file of files) {
      const transferId = `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.app.fileManager.addTransferItem(transferId, file.name, 'uploading', 0);
      const xhr = new XMLHttpRequest();
      this.app.fileManager.registerUploadRequest(transferId, xhr, file.name);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Number(((e.loaded / e.total) * 100).toFixed(2));
          this.app.fileManager.updateTransferProgress(transferId, progress);
        }
      });

      xhr.addEventListener('load', () => {
        this.app.fileManager.finishUploadRequest(transferId, file.name);
        if (xhr.status === 200) {
          this.app.fileManager.updateTransferItem(transferId, 'completed', 100);
          this.app.showStatus(`File ${file.name} uploaded successfully`, 'success');
        } else {
          this.app.fileManager.updateTransferItem(transferId, 'failed', 0);
          this.app.showStatus(`File ${file.name} upload failed`, 'danger');
        }
      });

      xhr.addEventListener('error', () => {
        this.app.fileManager.finishUploadRequest(transferId, file.name);
        this.app.fileManager.updateTransferItem(transferId, 'failed', 0);
        this.app.showStatus(`File ${file.name} upload failed`, 'danger');
      });

      xhr.open('POST', '/api/files/transfer');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('targetDeviceId', targetDeviceId);
      xhr.send(formData);
    }
  }

  handleFileTransferRequest(data) {
    const { from, fileInfo } = data;
    const device = this.app.deviceManager.getDeviceById(from);
    const name = device ? device.name : 'Device';
    const fileNames = fileInfo.map((f) => f.name).join(', ');
    const confirmMessage = `${name} wants to send files:\n${fileNames}\n\nAccept?`;

    if (confirm(confirmMessage)) {
      this.socket.emit('file-transfer-response', {
        to: from,
        accepted: true,
        fileInfo
      });
      this.app.showStatus('Transfer request accepted', 'info');
      return;
    }

    this.socket.emit('file-transfer-response', {
      to: from,
      accepted: false
    });
  }

  handleFileReadyForDownload(data) {
    const { fileId, fileName, fileSize, fromDevice } = data;
    const device = this.app.deviceManager.getDeviceById(fromDevice);
    const name = device ? device.name : 'Device';
    this.app.showStatus(`${name} shared file ${fileName}, download ready`, 'info');
    this.downloadFileFromServer(fileId, fileName, fileSize);
  }

  downloadFileFromServer(fileId, fileName) {
    const transferId = `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.app.fileManager.addTransferItem(transferId, fileName, 'downloading', 0);

    const link = document.createElement('a');
    link.href = `/api/files/transfer/${fileId}?fileName=${encodeURIComponent(fileName)}`;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      this.app.fileManager.updateTransferItem(transferId, 'completed', 100);
      this.app.showStatus(`File ${fileName} downloaded`, 'success');
    }, 1000);
  }
}
