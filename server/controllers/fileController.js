const multer = require('multer');
const fs = require('fs');
const path = require('path');
const fileService = require('../services/fileService');
const config = require('../config');
const uploadValidation = config.UPLOAD_VALIDATION || {};
const uploadDirResolved = path.resolve(config.UPLOAD_DIR);

function sanitizeFilename(name) {
  const normalized = (name || '').replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').trim();
  return normalized || `file-${Date.now()}`;
}

function normalizeOriginalFilename(name) {
  if (!name) return '';
  // If already contains CJK, keep original as-is.
  if (/[\u4e00-\u9fff]/.test(name)) {
    return name;
  }

  // Common mojibake hint when UTF-8 bytes were interpreted as latin1.
  const likelyMojibake = /[ÃÂÅÆÇÐÑØÞßà-ÿ]/.test(name);
  if (!likelyMojibake) {
    return name;
  }

  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    // Accept decoded value only when it looks like meaningful unicode.
    if (/[\u4e00-\u9fff]/.test(decoded)) {
      return decoded;
    }

    const hasNonAscii = /[^\u0000-\u007f]/.test(decoded);
    const decodedStillMojibake = /[ÃÂÅÆÇÐÑØÞßà-ÿ]/.test(decoded);
    if (hasNonAscii && !decodedStillMojibake) {
      return decoded;
    }
  } catch (_) {
    // Fallback to original if decoding fails.
  }

  return name;
}

function resolveUniqueFilename(originalName) {
  const normalizedName = normalizeOriginalFilename(originalName || '');
  const safeOriginalName = sanitizeFilename(path.basename(normalizedName));
  const ext = path.extname(safeOriginalName);
  const baseName = path.basename(safeOriginalName, ext);

  let candidate = `${baseName}${ext}`;
  let index = 1;
  while (
    fs.existsSync(path.join(uploadDirResolved, candidate)) ||
    fs.existsSync(path.join(uploadDirResolved, `${candidate}.uploading`))
  ) {
    candidate = `${baseName}(${index})${ext}`;
    index += 1;
  }

  return candidate;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const normalizedOriginalName = normalizeOriginalFilename(file.originalname);
    const finalFilename = resolveUniqueFilename(normalizedOriginalName);
    const filename = `${finalFilename}.uploading`;
    if (!Array.isArray(req._pendingUploadPaths)) {
      req._pendingUploadPaths = [];
    }
    req._pendingUploadPaths.push(path.join(uploadDirResolved, filename));
    if (!req._finalFilenameMap) {
      req._finalFilenameMap = {};
    }
    req._finalFilenameMap[filename] = finalFilename;
    if (!req._originalNameMap) {
      req._originalNameMap = {};
    }
    req._originalNameMap[filename] = normalizedOriginalName;
    cb(null, filename);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = uploadValidation.ALLOWED_MIME_TYPES || config.ALLOWED_FILE_TYPES || [];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: uploadValidation.MAX_FILE_SIZE || config.MAX_FILE_SIZE
  }
});

class FileController {
  constructor() {
    this.getUploadConfig = this.getUploadConfig.bind(this);
    this.getUploadedFiles = this.getUploadedFiles.bind(this);
    this.parseUpload = this.parseUpload.bind(this);
    this.uploadFile = this.uploadFile.bind(this);
    this.transferFile = this.transferFile.bind(this);
    this.downloadTransferredFile = this.downloadTransferredFile.bind(this);
    this.downloadFile = this.downloadFile.bind(this);
    this.getFiles = this.getFiles.bind(this);
    this.deleteFile = this.deleteFile.bind(this);
    this.getFileInfo = this.getFileInfo.bind(this);
  }

  getUploadConfig(req, res) {
    const payload = {
      maxFileSize: uploadValidation.MAX_FILE_SIZE || config.MAX_FILE_SIZE,
      allowedMimeTypes: uploadValidation.ALLOWED_MIME_TYPES || config.ALLOWED_FILE_TYPES || [],
      mimeExtensionMap: uploadValidation.MIME_EXTENSION_MAP || {},
      blockedExtensions: uploadValidation.BLOCKED_EXTENSIONS || [],
      fileNameMaxLength: uploadValidation.FILE_NAME_MAX_LENGTH || 255,
      fileNameInvalidPattern: uploadValidation.FILE_NAME_INVALID_PATTERN || "[<>:/\\\\|?*\"']",
      allowedTypeDescription: uploadValidation.ALLOWED_TYPE_DESCRIPTION || ''
    };

    res.status(200).json(payload);
  }

  getUploadedFiles(req) {
    if (req.file) {
      return [req.file];
    }

    if (Array.isArray(req.files)) {
      return req.files;
    }

    if (req.files && typeof req.files === 'object') {
      const files = [];
      Object.values(req.files).forEach((group) => {
        if (Array.isArray(group)) {
          files.push(...group);
        }
      });
      return files;
    }

    return [];
  }

  cleanupUploadedFiles(req) {
    const pendingPaths = Array.isArray(req._pendingUploadPaths) ? req._pendingUploadPaths : [];
    pendingPaths.forEach((filePath) => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.error('Cleanup pending upload file error:', filePath, error.message);
      }
    });

    const uploadedFiles = this.getUploadedFiles(req);
    uploadedFiles.forEach((file) => {
      const filePath = file.path || path.join(uploadDirResolved, file.filename || '');
      if (!filePath) return;
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.error('Cleanup uploaded file error:', filePath, error.message);
      }
    });
  }

  finalizeUploadedFiles(req) {
    const uploadedFiles = this.getUploadedFiles(req);
    const finalNameMap = req._finalFilenameMap || {};
    const originalNameMap = req._originalNameMap || {};

    for (const file of uploadedFiles) {
      const currentName = file.filename;
      const finalName = finalNameMap[currentName] || (currentName.endsWith('.uploading') ? currentName.slice(0, -10) : currentName);
      const currentPath = file.path || path.join(uploadDirResolved, currentName || '');
      const finalPath = path.join(uploadDirResolved, finalName);

      if (!currentName || !currentPath) {
        throw new Error('Invalid upload file metadata');
      }

      if (currentPath === finalPath) {
        continue;
      }

      if (fs.existsSync(currentPath)) {
        fs.renameSync(currentPath, finalPath);
      }

      file.filename = finalName;
      file.path = finalPath;
      originalNameMap[finalName] = originalNameMap[currentName] || normalizeOriginalFilename(file.originalname);
    }

    req._pendingUploadPaths = [];
  }

  getDisplayOriginalName(req, file) {
    const originalNameMap = req._originalNameMap || {};
    return originalNameMap[file.filename] || normalizeOriginalFilename(file.originalname);
  }

  parseUpload(req, res, callback) {
    let callbackCalled = false;
    const done = (result) => {
      if (callbackCalled) return;
      callbackCalled = true;
      callback(result);
    };

    req.once('aborted', () => {
      this.cleanupUploadedFiles(req);
      done({ status: 499, body: { error: 'Upload aborted by client' } });
    });

    upload.fields([
      { name: 'file', maxCount: 50 },
      { name: 'files', maxCount: 50 }
    ])(req, res, (err) => {
      if (callbackCalled) {
        return;
      }

      if (!err) {
        done(null);
        return;
      }

      this.cleanupUploadedFiles(req);

      if (req.aborted || err.code === 'ECONNABORTED' || err.code === 'ECONNRESET') {
        done({ status: 499, body: { error: 'Upload aborted by client' } });
        return;
      }

      if (err.code === 'LIMIT_FILE_SIZE') {
        done({ status: 400, body: { error: 'File size exceeds limit' } });
        return;
      }

      done({ status: 400, body: { error: err.message } });
    });
  }

  uploadFile(req, res) {
    this.parseUpload(req, res, (uploadError) => {
      if (uploadError) {
        if (res.headersSent) return;
        res.status(uploadError.status).json(uploadError.body);
        return;
      }

      const uploadedFiles = this.getUploadedFiles(req);
      if (uploadedFiles.length === 0) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      try {
        this.finalizeUploadedFiles(req);
      } catch (error) {
        this.cleanupUploadedFiles(req);
        res.status(500).json({ error: 'Failed to finalize uploaded file' });
        return;
      }

      const uploadedAt = new Date();
      const fileInfos = uploadedFiles.map((file) => ({
        filename: file.filename,
        originalName: this.getDisplayOriginalName(req, file),
        size: file.size,
        mimeType: file.mimetype,
        uploadedAt
      }));
      req._pendingUploadPaths = [];

      const io = req.app.get('io');
      fileInfos.forEach((fileInfo) => {
        io.emit('files-updated', {
          action: 'upload',
          fileInfo
        });
      });

      if (fileInfos.length === 1) {
        res.status(200).json(fileInfos[0]);
        return;
      }

      res.status(200).json({
        success: true,
        files: fileInfos,
        count: fileInfos.length
      });
    });
  }

  transferFile(req, res) {
    this.parseUpload(req, res, (uploadError) => {
      if (uploadError) {
        if (res.headersSent) return;
        res.status(uploadError.status).json(uploadError.body);
        return;
      }

      const uploadedFiles = this.getUploadedFiles(req);
      if (uploadedFiles.length === 0) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      try {
        this.finalizeUploadedFiles(req);
      } catch (error) {
        this.cleanupUploadedFiles(req);
        res.status(500).json({ error: 'Failed to finalize uploaded file' });
        return;
      }

      const targetDeviceId = req.body.targetDeviceId;
      if (!targetDeviceId) {
        this.cleanupUploadedFiles(req);
        res.status(400).json({ error: 'Target device ID is required' });
        return;
      }

      const uploadedAt = new Date();
      const fileInfos = uploadedFiles.map((file) => ({
        fileId: file.filename,
        originalName: this.getDisplayOriginalName(req, file),
        size: file.size,
        mimeType: file.mimetype,
        uploadedAt
      }));
      req._pendingUploadPaths = [];

      const io = req.app.get('io');
      fileInfos.forEach((fileInfo) => {
        io.to(targetDeviceId).emit('file-ready-for-download', {
          fileId: fileInfo.fileId,
          fileName: fileInfo.originalName,
          fileSize: fileInfo.size,
          fromDevice: req.socket.id
        });
      });

      if (fileInfos.length === 1) {
        res.status(200).json({ success: true, fileInfo: fileInfos[0] });
        return;
      }

      res.status(200).json({
        success: true,
        files: fileInfos,
        count: fileInfos.length
      });
    });
  }

  downloadTransferredFile(req, res) {
    const { fileId } = req.params;
    const fileName = req.query.fileName || fileId;

    const fileInfo = fileService.getFileInfo(fileId);
    if (!fileInfo) {
      return res.status(404).json({ error: 'File not found' });
    }

    const fileStream = fileService.getFileStream(fileId);
    if (!fileStream) {
      return res.status(500).json({ error: 'Error opening file' });
    }

    const encodedFileName = encodeURIComponent(fileName);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodedFileName}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', fileInfo.size);

    fileStream.pipe(res);
  }

  downloadFile(req, res) {
    const { filename } = req.params;
    const fileInfo = fileService.getFileInfo(filename);

    if (!fileInfo) {
      return res.status(404).json({ error: 'File not found' });
    }

    const fileStream = fileService.getFileStream(filename);
    if (!fileStream) {
      return res.status(500).json({ error: 'Error opening file' });
    }

    const encodedFileName = encodeURIComponent(filename);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodedFileName}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', fileInfo.size);

    fileStream.pipe(res);
  }

  getFiles(req, res) {
    const files = fileService.getAllFiles();
    res.status(200).json(files);
  }

  deleteFile(req, res) {
    const { filename } = req.params;
    const success = fileService.deleteFile(filename);

    if (success) {
      const io = req.app.get('io');
      io.emit('files-updated', {
        action: 'delete',
        filename
      });

      res.status(200).json({ message: 'File deleted successfully' });
      return;
    }

    res.status(404).json({ error: 'File not found' });
  }

  getFileInfo(req, res) {
    const { filename } = req.params;
    const fileInfo = fileService.getFileInfo(filename);

    if (fileInfo) {
      res.status(200).json(fileInfo);
      return;
    }

    res.status(404).json({ error: 'File not found' });
  }
}

module.exports = new FileController();
