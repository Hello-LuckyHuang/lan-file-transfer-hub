class DeviceManager {
  constructor(app) {
    this.app = app;
    this.socket = app.socket;
    this.devices = new Map();

    this.init();
  }

  init() {
    this.bindSocketEvents();
    this.displayDeviceInfo();
  }

  bindSocketEvents() {
    this.socket.on('online-devices', (devices) => {
      this.updateDevices(devices);
    });

    this.socket.on('device-connected', (device) => {
      this.addDevice(device);
      this.app.showStatus(this.app.t('status.device_online', { name: device.name }), 'success');
    });

    this.socket.on('device-updated', (device) => {
      this.updateDevice(device);
      this.app.showStatus(this.app.t('status.device_updated', { name: device.name }), 'info');
    });

    this.socket.on('device-disconnected', (deviceId) => {
      this.removeDevice(deviceId);
      this.app.showStatus(this.app.t('status.device_offline'), 'warning');
    });
  }

  updateDevice(device) {
    this.devices.set(device.id, device);
    this.renderDeviceList();
  }

  updateDevices(devices) {
    this.devices.clear();
    devices.forEach((device) => {
      this.devices.set(device.id, device);
    });
    this.renderDeviceList();
  }

  addDevice(device) {
    this.devices.set(device.id, device);
    this.renderDeviceList();
  }

  removeDevice(deviceId) {
    this.devices.delete(deviceId);
    this.renderDeviceList();
  }

  renderDeviceList() {
    const deviceList = document.getElementById('device-list');
    const deviceCount = document.getElementById('device-count');

    deviceCount.textContent = this.devices.size;
    deviceList.innerHTML = '';

    this.devices.forEach((device) => {
      const li = document.createElement('li');
      li.className = 'list-group-item list-group-item-action fade-in';
      li.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <div class="d-flex align-items-center">
              <span class="status-indicator status-online"></span>
              <strong>${device.name}</strong>
            </div>
            <div class="device-info">
              <small>${device.ip} · ${this.app.getDeviceTypeLabel(device.type)}</small>
            </div>
          </div>
        </div>
      `;

      deviceList.appendChild(li);
    });
  }

  displayDeviceInfo() {
    const deviceInfo = document.getElementById('device-info');
    const deviceName = this.app.getDeviceName();
    const deviceType = this.app.getDeviceType();
    deviceInfo.innerHTML = `<strong>${deviceName}</strong> · ${this.app.getDeviceTypeLabel(deviceType)}`;
  }

  getDevices() {
    return Array.from(this.devices.values());
  }

  getDeviceById(deviceId) {
    return this.devices.get(deviceId);
  }
}
