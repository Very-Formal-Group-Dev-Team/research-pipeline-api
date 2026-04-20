const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { createDocumentUpload } = require('../../middleware/multer');
const controller = require('./paper_versions.controller');

const router = express.Router({ mergeParams: true });

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function handleDocumentUpload(req, res, next) {
  const upload = createDocumentUpload();
  upload(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.message || 'File upload failed' });
    }
    next();
  });
}

router.use(requireAuth);

router.get('/', asyncHandler(controller.list));
router.post('/', handleDocumentUpload, asyncHandler(controller.upload));
router.post('/generate', asyncHandler(controller.generate));
router.get('/:versionId/download', asyncHandler(controller.download));
router.get('/:versionId/diff', asyncHandler(controller.diff));

module.exports = router;
