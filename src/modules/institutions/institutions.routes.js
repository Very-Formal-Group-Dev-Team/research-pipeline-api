const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const controller = require('./institutions.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.get('/search', asyncHandler(controller.searchInstitutions));
router.get('/me/courses', requireAuth, asyncHandler(controller.getMyInstitutionCourses));
router.get('/me/programs', requireAuth, asyncHandler(controller.getMyInstitutionPrograms));
router.get('/me/sections', requireAuth, asyncHandler(controller.getMyInstitutionSections));

module.exports = router;
