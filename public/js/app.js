class App {
  constructor(i18n) {
    this.i18n = i18n;
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
    this.applyI18n();
    this.showStatus(this.t('status.connecting_server'), 'info');
  }

  initSocket() {
    this.socket = io();

    this.socket.on('connect', () => {
      this.isConnected = true;
      this.showStatus(this.t('status.connected_server'), 'success');
      this.registerDevice();
    });

    this.socket.on('disconnect', () => {
      this.isConnected = false;
      this.showStatus(this.t('status.disconnected_server'), 'danger');
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      this.showStatus(this.t('status.connect_failed'), 'danger');
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
      deviceName = `${this.t('device.default_name_prefix')}-${Math.random().toString(36).slice(2, 9)}`;
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

  getDeviceTypeLabel(type) {
    return this.t(`device.type.${type}`) || type;
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

    const languageToggleBtn = document.getElementById('language-toggle');
    if (languageToggleBtn) {
      languageToggleBtn.addEventListener('click', () => {
        this.toggleLanguage();
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
    themeToggleBtn.setAttribute('title', isDark ? this.t('header.theme_to_light') : this.t('header.theme_to_dark'));
  }

  async toggleLanguage() {
    const current = this.i18n.getLocale();
    const next = current === 'zh_cn' ? 'en_us' : 'zh_cn';
    await this.i18n.setLocale(next);
    this.applyI18n();
  }

  updateLanguageToggle() {
    const languageToggleBtn = document.getElementById('language-toggle');
    const languageToggleLabel = document.getElementById('language-toggle-label');
    if (!languageToggleBtn || !languageToggleLabel) return;

    const isChinese = this.i18n.getLocale() === 'zh_cn';
    languageToggleLabel.textContent = isChinese
      ? this.t('header.language_label_en')
      : this.t('header.language_label_zh');
    languageToggleBtn.setAttribute('title', isChinese ? this.t('header.switch_to_english') : this.t('header.switch_to_chinese'));
  }

  applyI18n() {
    this.i18n.applyTranslations();
    this.updateThemeToggle(document.documentElement.getAttribute('data-theme') || 'light');
    this.updateLanguageToggle();
    this.displayDeviceName();

    if (this.deviceManager) {
      this.deviceManager.renderDeviceList();
    }

    if (this.fileManager) {
      this.fileManager.renderFileList();
      this.fileManager.rerenderTransferItems();
    }
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
      this.showStatus(this.t('status.device_name_required'), 'warning');
      return;
    }

    localStorage.setItem('deviceName', newName);
    this.registerDevice();
    this.showStatus(this.t('status.device_name_updated'), 'success');
    this.displayDeviceName();
  }

  displayDeviceName() {
    const deviceInfo = document.getElementById('device-info');
    const deviceName = this.getDeviceName();
    const deviceType = this.getDeviceType();
    deviceInfo.innerHTML = `<strong>${deviceName}</strong> · ${this.getDeviceTypeLabel(deviceType)}`;
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
    const locale = this.i18n.getLocale() === 'en_us' ? 'en-US' : 'zh-CN';
    return date.toLocaleString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  t(key, variables) {
    return this.i18n.t(key, variables);
  }

  getLocale() {
    return this.i18n.getLocale();
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

document.addEventListener('DOMContentLoaded', async () => {
  const i18n = new I18nManager();
  await i18n.init();
  window.app = new App(i18n);
});
