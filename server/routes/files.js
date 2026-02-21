const express = require('express');
const fileController = require('../controllers/fileController');

const router = express.Router();

router.get('/config', (req, res) => fileController.getUploadConfig(req, res));
router.post('/upload', (req, res) => fileController.uploadFile(req, res));
router.post('/transfer', (req, res) => fileController.transferFile(req, res));
router.get('/transfer/:fileId', (req, res) => fileController.downloadTransferredFile(req, res));
router.get('/list', (req, res) => fileController.getFiles(req, res));
router.get('/download/:filename', (req, res) => fileController.downloadFile(req, res));
router.get('/:filename', (req, res) => fileController.getFileInfo(req, res));
router.delete('/:filename', (req, res) => fileController.deleteFile(req, res));

module.exports = router;
