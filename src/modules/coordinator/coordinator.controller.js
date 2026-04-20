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

// ─── Courses ────────────────────────────────────────────────────────────────

async function listCourses(req, res) {
  const courses = await coordinatorService.getCoursesByInstitution(req.institution.id);
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
  const { venue, verifiedSchedule, verifiedEndTime, notes, forceApprove } = req.body;
  const result = await coordinatorService.verifyDefense(
    req.params.defenseId,
    req.user.id,
    { venue, verifiedSchedule, verifiedEndTime, notes, forceApprove }
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

async function createDefenseForCourse(req, res) {
  const { courseId } = req.params;
  const { defenseType, scheduledAt, date, startTime, endTime, location, venue } = req.body;

  const result = await coordinatorService.createDefenseForCourse(
    req.institution.id,
    req.user.id,
    { courseId, defenseType, scheduledAt, date, startTime, endTime, location, venue }
  );

  if (result.error) {
    return res.status(400).json({ error: result.error });
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

module.exports = {
  requireCoordinator,
  getDashboard,
  getInstitution,
  getAdvisers,
  addAdviser,
  removeAdviser,
  listCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  listPendingDefenses,
  listAllDefenses,
  verifyDefense,
  rejectDefense,
  setVenue,
  createDefenseForCourse,
  bookDefenseSchedule,
  getInstitutionProjects,
  getProjectsByAdviser,
};
