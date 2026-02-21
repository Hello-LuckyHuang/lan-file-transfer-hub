const fs = require('fs');
const path = require('path');
const config = require('../config');

class FileService {
  constructor() {
    this.uploadDir = path.resolve(config.UPLOAD_DIR);
    this.uploadValidation = config.UPLOAD_VALIDATION || {};

    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async saveFile(file, filename) {
    const filePath = path.join(this.uploadDir, filename);

    return new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(filePath);
      file.pipe(stream);

      stream.on('finish', () => {
        resolve({
          filename,
          path: filePath,
          size: fs.statSync(filePath).size,
          uploadedAt: new Date()
        });
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  getFileInfo(filename) {
    const filePath = path.join(this.uploadDir, filename);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const stats = fs.statSync(filePath);
    return {
      filename,
      size: stats.size,
      mtime: stats.mtime,
      ctime: stats.ctime
    };
  }

  getFileStream(filename) {
    const filePath = path.join(this.uploadDir, filename);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    return fs.createReadStream(filePath);
  }

  getAllFiles() {
    try {
      const files = fs.readdirSync(this.uploadDir);
      return files
        .filter((filename) => !filename.endsWith('.uploading'))
        .map((filename) => this.getFileInfo(filename))
        .filter(Boolean);
    } catch (error) {
      console.error('Error getting files:', error);
      return [];
    }
  }

  deleteFile(filename) {
    const filePath = path.join(this.uploadDir, filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }

    return false;
  }

  isValidFileType(mimeType) {
    const allowedTypes = this.uploadValidation.ALLOWED_MIME_TYPES || config.ALLOWED_FILE_TYPES || [];
    return allowedTypes.includes(mimeType);
  }

  isValidFileSize(size) {
    const maxFileSize = this.uploadValidation.MAX_FILE_SIZE || config.MAX_FILE_SIZE;
    return size <= maxFileSize;
  }
}

module.exports = new FileService();
