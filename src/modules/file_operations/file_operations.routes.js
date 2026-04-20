const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const controller = require('./file_operations.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// POST /api/file-operations/upload - Accept filename and content, write to volume
router.post('/upload', requireAuth, asyncHandler(controller.uploadFile));

// GET /api/file-operations/file/:filename - Read and return file contents
router.get('/file/:filename', requireAuth, asyncHandler(controller.getFile));

// GET /api/file-operations/files - List all files in the volume
router.get('/files', requireAuth, asyncHandler(controller.listFiles));

module.exports = router;
