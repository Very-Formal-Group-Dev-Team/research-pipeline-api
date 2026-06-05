const coordinatorService = require('./coordinator.service');

// ─── Middleware: ensure user is a coordinator ────────────────────────────────

async function requireCoordinator(req, res, next) {
  const institution = await coordinatorService.getInstitutionByCoordinator(req.user.id);
  if (!institution) {
    return res.status(403).json({ error: 'Not a coordinator or no institution assigned' });
  }
  req.institution = institution;
  next();
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

async function getDashboard(req, res) {
  const stats = await coordinatorService.getCoordinatorStats(req.institution.id);
  return res.json({ institution: req.institution, stats });
}

// ─── Institution ────────────────────────────────────────────────────────────

async function getInstitution(req, res) {
  return res.json(req.institution);
}

async function getAdvisers(req, res) {
  const advisers = await coordinatorService.getAdvisersInInstitution(req.institution.id);
  return res.json(advisers);
}

async function getPanelists(req, res) {
  const panelists = await coordinatorService.getPanelistsInInstitution(req.institution.id);
  return res.json(panelists);
}

async function addAdviser(req, res) {
  const { adviserId, courseId } = req.body;
  if (!adviserId || !courseId) {
    return res.status(400).json({ error: 'adviserId and courseId are required' });
  }

  const result = await coordinatorService.addAdviserToInstitution(
    req.institution.id,
    adviserId,
    courseId,
    req.user.id
  );

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function removeAdviser(req, res) {
  const { adviserId } = req.params;
  await coordinatorService.removeAdviserFromInstitution(req.institution.id, adviserId, req.user.id);
  return res.json({ success: true });
}

async function removeAdviserFromCourse(req, res) {
  const { courseId, adviserId } = req.params;
  const result = await coordinatorService.removeAdviserFromCourse(
    req.institution.id,
    courseId,
    adviserId
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

// ─── Courses ────────────────────────────────────────────────────────────────

async function listCourses(req, res) {
  const courses = await coordinatorService.getCoursesWithAdvisersByInstitution(req.institution.id);
  return res.json(courses);
}

async function createCourse(req, res) {
  const { courseName, code, description } = req.body;
  if (!courseName || !code) {
    return res.status(400).json({ error: 'courseName and code are required' });
  }

  const result = await coordinatorService.createCourse(req.institution.id, {
    courseName,
    code,
    description,
  });

  if (result.error) {
    return res.status(409).json({ error: result.error });
  }
  return res.status(201).json(result.data);
}

async function updateCourse(req, res) {
  const result = await coordinatorService.updateCourse(
    req.params.courseId,
    req.institution.id,
    req.body
  );

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function deleteCourse(req, res) {
  const result = await coordinatorService.deleteCourse(req.params.courseId, req.institution.id);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  return res.json(result.data);
}

// ─── Defense Verification ───────────────────────────────────────────────────

async function listPendingDefenses(req, res) {
  const defenses = await coordinatorService.getPendingDefenses(req.institution.id);
  return res.json(defenses);
}

async function listAllDefenses(req, res) {
  const defenses = await coordinatorService.getAllDefensesForInstitution(req.institution.id);
  return res.json(defenses);
}

async function verifyDefense(req, res) {
  const { venue, location, modality, verifiedSchedule, verifiedEndTime, notes, forceApprove, holdDefense } =
    req.body;
  const result = await coordinatorService.verifyDefense(
    req.params.defenseId,
    req.user.id,
    { venue, location, modality, verifiedSchedule, verifiedEndTime, notes, forceApprove, holdDefense }
  );

  if (result.error) {
    return res.status(404).json({ error: result.error });
  }
  return res.json(result.data);
}

async function rejectDefense(req, res) {
  const result = await coordinatorService.rejectDefense(
    req.params.defenseId,
    req.user.id,
    { notes: req.body.notes }
  );

  if (result.error) {
    return res.status(404).json({ error: result.error });
  }
  return res.json(result.data);
}

async function setVenue(req, res) {
  const { venue } = req.body;
  if (!venue) {
    return res.status(400).json({ error: 'venue is required' });
  }

  const result = await coordinatorService.setDefenseVenue(
    req.params.defenseId,
    req.user.id,
    venue
  );

  if (result.error) {
    return res.status(404).json({ error: result.error });
  }
  return res.json(result.data);
}

async function deleteDefense(req, res) {
  const result = await coordinatorService.cancelCoordinatorDefense(
    req.params.defenseId,
    req.institution.id
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function cancelDefense(req, res) {
  return deleteDefense(req, res);
}

async function completeDefense(req, res) {
  const result = await coordinatorService.completeCoordinatorDefense(
    req.params.defenseId,
    req.institution.id
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function revertDefense(req, res) {
  const previousStatus = req.body?.previousStatus;
  const result = await coordinatorService.revertCoordinatorDefense(
    req.params.defenseId,
    req.institution.id,
    previousStatus
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function createDefenseForCourse(req, res) {
  const { courseId } = req.params;
  const { defenseType, scheduledAt, date, startTime, endTime, location, venue, forceSchedule, holdDefense } = req.body;

  const result = await coordinatorService.createDefenseForCourse(
    req.institution.id,
    req.user.id,
    { courseId, defenseType, scheduledAt, date, startTime, endTime, location, venue, forceSchedule, holdDefense }
  );

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  if (result.conflict) {
    return res.status(409).json(result);
  }
  return res.status(201).json(result.data);
}

async function bookDefenseSchedule(req, res) {
  const result = await coordinatorService.createCoordinatorDefenseBooking(
    req.institution.id,
    req.user.id,
    req.body || {}
  );

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  if (result.data?.conflict) {
    return res.status(409).json(result.data);
  }

  return res.status(201).json(result.data);
}

async function getInstitutionProjects(req, res) {
  const projects = await coordinatorService.getProjectsByInstitution(req.institution.id);
  return res.json(projects);
}

async function getProjectsByAdviser(req, res) {
  const advisers = await coordinatorService.getProjectsByAdviserInInstitution(req.institution.id);
  return res.json(advisers);
}

async function listRubrics(req, res) {
  const rubrics = await coordinatorService.listRubrics(req.institution.id);
  return res.json(rubrics);
}

async function getRubric(req, res) {
  const result = await coordinatorService.getCoordinatorRubricById(
    req.institution.id,
    req.params.rubricId
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function createRubric(req, res) {
  const result = await coordinatorService.createCoordinatorRubric(
    req.institution.id,
    req.user.id,
    req.body
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.status(201).json(result.data);
}

async function updateRubric(req, res) {
  const result = await coordinatorService.updateCoordinatorRubric(
    req.institution.id,
    req.params.rubricId,
    req.body
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function deleteRubric(req, res) {
  const result = await coordinatorService.deleteCoordinatorRubric(
    req.institution.id,
    req.params.rubricId
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

module.exports = {
  requireCoordinator,
  getDashboard,
  getInstitution,
  getAdvisers,
  getPanelists,
  addAdviser,
  removeAdviser,
  removeAdviserFromCourse,
  listCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  listPendingDefenses,
  listAllDefenses,
  verifyDefense,
  rejectDefense,
  setVenue,
  deleteDefense,
  cancelDefense,
  completeDefense,
  revertDefense,
  createDefenseForCourse,
  bookDefenseSchedule,
  getInstitutionProjects,
  getProjectsByAdviser,
  listRubrics,
  getRubric,
  createRubric,
  updateRubric,
  deleteRubric,
};
