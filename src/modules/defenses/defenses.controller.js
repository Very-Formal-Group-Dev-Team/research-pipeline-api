const { createDefense, getDefensesByUser, getDefensesForMember, cancelDefense, rescheduleDefense } = require('./defenses.service');

async function postDefense(req, res) {
  const body = req.body || {};
  const waitForSlotRaw = body.wait_for_slot ?? body.waitForSlot;
  const waitForSlot = waitForSlotRaw === true || waitForSlotRaw === 'true' || waitForSlotRaw === 1 || waitForSlotRaw === '1';

  const result = await createDefense(req.user.id, {
    ...body,
    wait_for_slot: waitForSlot,
    booking_side: 'adviser',
  });
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  // Return conflict info so the frontend can prompt the user
  if (result.conflict) {
    return res.status(409).json(result);
  }
  return res.status(201).json(result.data);
}

async function postDefenseProposal(req, res) {
  const body = req.body || {};
  const waitForSlotRaw = body.wait_for_slot ?? body.waitForSlot;
  const waitForSlot = waitForSlotRaw === true || waitForSlotRaw === 'true' || waitForSlotRaw === 1 || waitForSlotRaw === '1';

  const result = await createDefense(req.user.id, {
    ...body,
    wait_for_slot: waitForSlot,
    booking_side: 'adviser',
  });

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  if (result.conflict) {
    return res.status(409).json(result);
  }

  return res.status(201).json(result.data);
}

async function getMyDefenses(req, res) {
  const defenses = await getDefensesByUser(req.user.id);
  return res.json(defenses);
}

async function patchCancelDefense(req, res) {
  const result = await cancelDefense(req.user.id, req.params.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json({
    success: true,
    message: 'Meeting cancelled',
    defense: result.data,
  });
}

async function patchRescheduleDefense(req, res) {
  const result = await rescheduleDefense(req.user.id, req.params.id, req.body || {});
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  if (result.conflict) {
    return res.status(409).json(result);
  }
  return res.json({
    success: true,
    message: 'Meeting rescheduled',
    defense: result.data,
  });
}

async function getMyProjectDefenses(req, res) {
  const defenses = await getDefensesForMember(req.user.id);
  return res.json(defenses);
}

module.exports = { postDefense, postDefenseProposal, getMyDefenses, getMyProjectDefenses, patchCancelDefense, patchRescheduleDefense };