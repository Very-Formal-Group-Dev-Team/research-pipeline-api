const scheduleService = require('./schedule.service');

async function getMySchedule(req, res) {
  const schedule = await scheduleService.getMySchedule(req.user.id);
  return res.json(schedule);
}

module.exports = { getMySchedule };
