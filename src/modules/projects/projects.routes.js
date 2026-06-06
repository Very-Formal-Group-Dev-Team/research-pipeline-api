const express = require('express');
const { requireAuth, requireDashboardRole } = require('../../middleware/auth');
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
router.get('/code/:code', asyncHandler(controller.getByCode));
router.get('/invitations', asyncHandler(controller.getMyInvitations));
router.post('/invitations/:invitationId/respond', asyncHandler(controller.respondInvitation));
router.get('/', asyncHandler(controller.list));
router.get('/advised/stats', requireDashboardRole('adviser'), asyncHandler(controller.getAdvisedStats));
router.get('/advised', requireDashboardRole('adviser'), asyncHandler(controller.listAdvised));
router.get('/:id', asyncHandler(controller.getOne));
router.get('/:id/members', asyncHandler(controller.getMembers));
router.get('/:id/meetings', asyncHandler(controller.getMeetings));
router.get('/:id/files', asyncHandler(controller.getFiles));
router.get('/:id/invitations', asyncHandler(controller.getInvitations));
router.delete('/:id/members/:memberId', asyncHandler(controller.removeMember));
router.post('/:id/invite', asyncHandler(controller.invite));
router.post('/:id/join-requests/:memberId/respond', asyncHandler(controller.respondJoinRequest));
router.post('/:id/find-related-studies', asyncHandler(controller.findRelatedStudies));
router.get('/:id/cross-reference', asyncHandler(controller.crossReferenceStudies));
router.patch('/:id/keywords', asyncHandler(controller.updateKeywords));
router.post('/:id/schedule', asyncHandler(controller.scheduleDefense));
router.patch('/:id/status', asyncHandler(controller.updateStatus));
router.patch('/:id/details', asyncHandler(controller.updateDetails));
router.patch('/:id/abstract', asyncHandler(controller.updateAbstract));
router.post('/:id/leave', asyncHandler(controller.leaveProject));
router.post('/:id/transfer-leadership', asyncHandler(controller.transferLeadership));
router.post('/:id/transfer-leadership/revert', asyncHandler(controller.revertLeadershipTransfer));
router.post('/:id/transfer-main-adviser', asyncHandler(controller.transferMainAdviser));
router.post('/:id/transfer-main-adviser/revert', asyncHandler(controller.revertMainAdviserTransfer));
router.delete('/:id', asyncHandler(controller.deleteProject));
router.use('/:id/paper-versions', paperVersionsRouter);

module.exports = router;
