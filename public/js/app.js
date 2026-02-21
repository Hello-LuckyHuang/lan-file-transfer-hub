class App {
  constructor() {
    this.socket = null;
    this.deviceManager = null;
    this.fileManager = null;
    this.p2pClient = null;
    this.isConnected = false;

    this.init();
  }

  init() {
    this.initSocket();
    this.deviceManager = new DeviceManager(this);
    this.fileManager = new FileManager(this);
    this.initTheme();
    this.bindEvents();
    this.initDeviceName();
    this.showStatus('正在连接到服务器...', 'info');
  }

  initSocket() {
    this.socket = io();

    this.socket.on('connect', () => {
      this.isConnected = true;
      this.showStatus('已连接到服务器', 'success');
      this.registerDevice();
    });

    this.socket.on('disconnect', () => {
      this.isConnected = false;
      this.showStatus('与服务器断开连接', 'danger');
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      this.showStatus('连接服务器失败', 'danger');
    });
  }

  registerDevice() {
    const deviceInfo = {
      name: this.getDeviceName(),
      type: this.getDeviceType()
    };

    this.socket.emit('register-device', deviceInfo);
  }

  getDeviceName() {
    let deviceName = localStorage.getItem('deviceName');

    if (!deviceName) {
      deviceName = `设备-${Math.random().toString(36).slice(2, 9)}`;
      localStorage.setItem('deviceName', deviceName);
    }

    return deviceName;
  }

  getDeviceType() {
    const userAgent = navigator.userAgent;

    if (/mobile/i.test(userAgent)) return 'mobile';
    if (/tablet/i.test(userAgent)) return 'tablet';
    return 'desktop';
  }

  bindEvents() {
    const uploadBtn = document.getElementById('upload-btn');
    uploadBtn.addEventListener('click', () => {
      this.fileManager.uploadFiles();
    });

    const fileInput = document.getElementById('file-input');
    fileInput.addEventListener('change', (e) => {
      uploadBtn.disabled = e.target.files.length === 0;
    });

    const refreshBtn = document.getElementById('refresh-files');
    refreshBtn.addEventListener('click', () => {
      this.fileManager.loadFiles({ clearFailedAndCancelled: true });
    });

    const saveDeviceNameBtn = document.getElementById('save-device-name');
    saveDeviceNameBtn.addEventListener('click', () => {
      this.saveDeviceName();
    });

    const deviceNameInput = document.getElementById('device-name-input');
    deviceNameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.saveDeviceName();
      }
    });

    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        this.toggleTheme();
      });
    }
  }

  initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
    this.setTheme(initialTheme);
  }

  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    this.setTheme(currentTheme === 'dark' ? 'light' : 'dark');
  }

  setTheme(theme) {
    const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', normalizedTheme);
    localStorage.setItem('theme', normalizedTheme);
    this.updateThemeToggle(normalizedTheme);
  }

  updateThemeToggle(theme) {
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (!themeToggleBtn) return;

    const isDark = theme === 'dark';
    themeToggleBtn.classList.toggle('is-dark', isDark);
    themeToggleBtn.setAttribute('aria-checked', isDark ? 'true' : 'false');
    themeToggleBtn.setAttribute('title', isDark ? '切换到亮色模式' : '切换到暗色模式');
  }

  initDeviceName() {
    const deviceNameInput = document.getElementById('device-name-input');
    deviceNameInput.value = this.getDeviceName();
    this.displayDeviceName();
  }

  saveDeviceName() {
    const deviceNameInput = document.getElementById('device-name-input');
    const newName = deviceNameInput.value.trim();

    if (!newName) {
      this.showStatus('设备名称不能为空', 'warning');
      return;
    }

    localStorage.setItem('deviceName', newName);
    this.registerDevice();
    this.showStatus('设备名称已更新', 'success');
    this.displayDeviceName();
  }

  displayDeviceName() {
    const deviceInfo = document.getElementById('device-info');
    const deviceName = this.getDeviceName();
    const deviceType = this.getDeviceType();
    const typeLabelMap = {
      mobile: '手机',
      tablet: '平板',
      desktop: '电脑'
    };

    deviceInfo.innerHTML = `<strong>${deviceName}</strong> · ${typeLabelMap[deviceType] || deviceType}`;
  }

  showStatus(message, type = 'info') {
    const alert = document.getElementById('status-alert');
    const messageEl = document.getElementById('status-message');

    messageEl.textContent = message;
    alert.className = `alert alert-${type} alert-dismissible fade show`;

    setTimeout(() => {
      alert.classList.add('d-none');
    }, 3000);
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  getSocket() {
    return this.socket;
  }

  getDeviceManager() {
    return this.deviceManager;
  }

  getFileManager() {
    return this.fileManager;
  }

  getP2PClient() {
    return this.p2pClient;
  }

  isServerConnected() {
    return this.isConnected;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});

