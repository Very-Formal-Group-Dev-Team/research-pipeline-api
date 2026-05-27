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

module.exports = {
  listEvents,
  createEvent,
  cancelEvent,
};
