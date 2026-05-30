const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const controller = require('./coordinator.controller');
const eventsController = require('../events/events.controller');

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
router.delete(
  '/courses/:courseId/advisers/:adviserId',
  asyncHandler(controller.removeAdviserFromCourse)
);

// Defense verification
router.get('/defenses', asyncHandler(controller.listAllDefenses));
router.get('/defenses/pending', asyncHandler(controller.listPendingDefenses));
router.post('/defenses/book', asyncHandler(controller.bookDefenseSchedule));
router.post('/defenses/:defenseId/verify', asyncHandler(controller.verifyDefense));
router.post('/defenses/:defenseId/reject', asyncHandler(controller.rejectDefense));
router.patch('/defenses/:defenseId/venue', asyncHandler(controller.setVenue));
router.delete('/defenses/:defenseId', asyncHandler(controller.deleteDefense));

// Create defenses for entire course
router.post('/courses/:courseId/defenses', asyncHandler(controller.createDefenseForCourse));

// Projects
router.get('/projects', asyncHandler(controller.getInstitutionProjects));
router.get('/projects/by-adviser', asyncHandler(controller.getProjectsByAdviser));
router.get('/rubrics', asyncHandler(controller.listRubrics));
router.get('/rubrics/:rubricId', asyncHandler(controller.getRubric));
router.post('/rubrics', asyncHandler(controller.createRubric));
router.put('/rubrics/:rubricId', asyncHandler(controller.updateRubric));
router.delete('/rubrics/:rubricId', asyncHandler(controller.deleteRubric));

// Institution calendar events
router.get('/events', asyncHandler(eventsController.listEvents));
router.post('/events', asyncHandler(eventsController.createEvent));
router.patch('/events/:eventId/cancel', asyncHandler(eventsController.cancelEvent));

module.exports = router;
