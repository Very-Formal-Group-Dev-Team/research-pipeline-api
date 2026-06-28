const express = require('express');
const { requireAuth, requireDashboardRole } = require('../../middleware/auth');
const controller = require('./admin.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(requireAuth);
router.use(requireDashboardRole('admin'));

router.get('/users', asyncHandler(controller.listUsers));
router.get('/users/:userId', asyncHandler(controller.getUser));
router.patch('/users/:userId', asyncHandler(controller.updateUser));
router.get('/audit-log', asyncHandler(controller.listAuditLog));

router.get('/institutions', asyncHandler(controller.listInstitutions));
router.post('/institutions', asyncHandler(controller.createInstitution));
router.patch('/institutions/:institutionId', asyncHandler(controller.updateInstitution));

router.get('/institutions/:institutionId/programs', asyncHandler(controller.listPrograms));
router.post('/institutions/:institutionId/programs', asyncHandler(controller.createProgram));
router.patch(
  '/institutions/:institutionId/programs/:programId',
  asyncHandler(controller.updateProgram),
);

module.exports = router;
