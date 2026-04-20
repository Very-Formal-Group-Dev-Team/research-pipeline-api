const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const controller = require('./coordinator.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// All routes require auth + coordinator role
router.use(requireAuth);
router.use(asyncHandler(controller.requireCoordinator));

// Dashboard
router.get('/dashboard', asyncHandler(controller.getDashboard));

// Institution management
router.get('/institution', asyncHandler(controller.getInstitution));
router.get('/institution/advisers', asyncHandler(controller.getAdvisers));
router.post('/institution/advisers', asyncHandler(controller.addAdviser));
router.delete('/institution/advisers/:adviserId', asyncHandler(controller.removeAdviser));

// Course management
router.get('/courses', asyncHandler(controller.listCourses));
router.post('/courses', asyncHandler(controller.createCourse));
router.put('/courses/:courseId', asyncHandler(controller.updateCourse));
router.delete('/courses/:courseId', asyncHandler(controller.deleteCourse));

// Defense verification
router.get('/defenses', asyncHandler(controller.listAllDefenses));
router.get('/defenses/pending', asyncHandler(controller.listPendingDefenses));
router.post('/defenses/book', asyncHandler(controller.bookDefenseSchedule));
router.post('/defenses/:defenseId/verify', asyncHandler(controller.verifyDefense));
router.post('/defenses/:defenseId/reject', asyncHandler(controller.rejectDefense));
router.patch('/defenses/:defenseId/venue', asyncHandler(controller.setVenue));

// Create defenses for entire course
router.post('/courses/:courseId/defenses', asyncHandler(controller.createDefenseForCourse));

// Projects
router.get('/projects', asyncHandler(controller.getInstitutionProjects));
router.get('/projects/by-adviser', asyncHandler(controller.getProjectsByAdviser));

module.exports = router;
