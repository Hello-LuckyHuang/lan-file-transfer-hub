const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const config = require('./config');

const app = express();

app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.set('io', io);

const onlineDevices = new Map();
const activeTransfers = new Map();

function isActiveTransferStatus(status) {
  return status === 'uploading' || status === 'downloading' || status === 'pending';
}

io.on('connection', (socket) => {
  console.log('New device connected:', socket.id);

  socket.on('register-device', (deviceInfo) => {
    const device = {
      id: socket.id,
      name: deviceInfo.name || `Device-${Math.random().toString(36).substr(2, 9)}`,
      ip: socket.handshake.address,
      type: deviceInfo.type || 'unknown',
      connectedAt: new Date()
    };

    const existingDevice = onlineDevices.get(socket.id);
    onlineDevices.set(socket.id, device);

    if (existingDevice) {
      io.emit('device-updated', device);
      activeTransfers.forEach((transfer, transferId) => {
        if (transfer.deviceId === socket.id) {
          transfer.deviceName = device.name;
          activeTransfers.set(transferId, transfer);
        }
      });
    } else {
      io.emit('device-connected', device);
      socket.emit('online-devices', Array.from(onlineDevices.values()));
    }
  });

  socket.on('transfer-status-update', (data) => {
    if (!data || !data.transferId || !data.fileName || !data.status) {
      return;
    }

    const device = onlineDevices.get(socket.id);
    const payload = {
      transferId: data.transferId,
      fileName: data.fileName,
      status: data.status,
      progress: Math.max(0, Math.min(100, Number(data.progress) || 0)),
      speedText: typeof data.speedText === 'string' ? data.speedText.slice(0, 32) : '--',
      fileSize: Math.max(0, Number(data.fileSize) || 0),
      deviceId: socket.id,
      deviceName: device ? device.name : `Device-${socket.id.slice(0, 6)}`,
      updatedAt: new Date().toISOString()
    };

    if (isActiveTransferStatus(payload.status)) {
      activeTransfers.set(payload.transferId, payload);
    } else {
      activeTransfers.delete(payload.transferId);
    }

    io.emit('transfer-status-update', payload);
  });

  socket.on('request-active-transfers', () => {
    socket.emit('active-transfers', Array.from(activeTransfers.values()));
  });

  socket.on('disconnect', () => {
    console.log('Device disconnected:', socket.id);

    const removedTransferIds = [];
    activeTransfers.forEach((transfer, transferId) => {
      if (transfer.deviceId === socket.id) {
        activeTransfers.delete(transferId);
        removedTransferIds.push(transferId);
      }
    });

    if (removedTransferIds.length > 0) {
      io.emit('transfer-status-remove', { transferIds: removedTransferIds });
    }

    onlineDevices.delete(socket.id);
    io.emit('device-disconnected', socket.id);
  });
});

const fileRoutes = require('./routes/files');

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.get('/api/devices', (req, res) => {
  res.json(Array.from(onlineDevices.values()));
});

app.use('/api/files', fileRoutes);

server.listen(config.PORT, () => {
  console.log(`Server running on port ${config.PORT}`);
  console.log(`Access URL: http://localhost:${config.PORT}`);
  console.log('Waiting for devices to connect...');
});

module.exports = { app, io };
