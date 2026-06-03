const eventsService = require('./events.service');

async function listEvents(req, res) {
  const events = await eventsService.getEventsForInstitution(req.institution.id);
  return res.json(events);
}

async function createEvent(req, res) {
  const result = await eventsService.createInstitutionEvent(
    req.institution.id,
    req.user.id,
    req.body || {}
  );

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.status(201).json(result.data);
}

async function updateEvent(req, res) {
  const result = await eventsService.updateInstitutionEvent(
    req.params.eventId,
    req.institution.id,
    req.user.id,
    req.body || {}
  );

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function completeEvent(req, res) {
  const result = await eventsService.completeInstitutionEvent(
    req.params.eventId,
    req.institution.id,
    req.user.id
  );

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function cancelEvent(req, res) {
  const result = await eventsService.cancelInstitutionEvent(
    req.params.eventId,
    req.institution.id,
    req.user.id
  );

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function revertEvent(req, res) {
  const result = await eventsService.revertInstitutionEventStatus(
    req.params.eventId,
    req.institution.id
  );

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

module.exports = {
  listEvents,
  createEvent,
  updateEvent,
  completeEvent,
  cancelEvent,
  revertEvent,
};
