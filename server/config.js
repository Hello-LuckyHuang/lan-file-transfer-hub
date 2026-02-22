const uploadValidation = {
  MAX_FILE_SIZE: 10000 * 1024 * 1024, // 10GB
  ALLOWED_MIME_TYPES: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/x-rar-compressed',
    'text/plain',
    'audio/mpeg',
    'video/mp4'
  ],
  MIME_EXTENSION_MAP: {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/gif': ['gif'],
    'application/pdf': ['pdf'],
    'application/msword': ['doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'application/vnd.ms-excel': ['xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
    'application/zip': ['zip'],
    'application/x-rar-compressed': ['rar'],
    'text/plain': ['txt'],
    'audio/mpeg': ['mp3'],
    'video/mp4': ['mp4']
  },
  BLOCKED_EXTENSIONS: ['exe', 'bat', 'cmd', 'sh', 'php', 'jsp', 'asp', 'aspx', 'js', 'vbs', 'ps1', 'py'],
  FILE_NAME_MAX_LENGTH: 255,
  FILE_NAME_INVALID_PATTERN: "[<>:/\\\\|?*\"']",
  ALLOWED_TYPE_DESCRIPTION: ''
};

module.exports = {
  PORT: process.env.PORT || 3000,
  UPLOAD_DIR: './uploads',
  UPLOAD_VALIDATION: uploadValidation,
  // Backward-compatible aliases
  MAX_FILE_SIZE: uploadValidation.MAX_FILE_SIZE,
  ALLOWED_FILE_TYPES: uploadValidation.ALLOWED_MIME_TYPES,
  DEVICE_DISCOVERY_INTERVAL: 5000, // 5 seconds
  P2P_CONFIG: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  }
};
