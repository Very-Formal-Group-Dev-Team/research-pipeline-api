const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { createDocumentUpload } = require('../../middleware/multer');
const controller = require('./projects.controller');
const paperVersionsRouter = require('../paper_versions/paper_versions.routes');

const router = express.Router();

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
router.post('/', handleDocumentUpload, asyncHandler(controller.create));
router.post('/join', asyncHandler(controller.join));
router.get('/invitations', asyncHandler(controller.getMyInvitations));
router.post('/invitations/:invitationId/respond', asyncHandler(controller.respondInvitation));
router.get('/', asyncHandler(controller.list));
router.get('/advised', asyncHandler(controller.listAdvised));
router.get('/:id', asyncHandler(controller.getOne));
router.get('/:id/members', asyncHandler(controller.getMembers));
router.get('/:id/files', asyncHandler(controller.getFiles));
router.get('/:id/invitations', asyncHandler(controller.getInvitations));
router.post('/:id/invite', asyncHandler(controller.invite));
router.post('/:id/schedule', asyncHandler(controller.scheduleDefense));
router.patch('/:id/status', asyncHandler(controller.updateStatus));
router.use('/:id/paper-versions', paperVersionsRouter);

module.exports = router;
