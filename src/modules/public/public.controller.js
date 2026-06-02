const publicService = require('./public.service');

async function getStats(_req, res) {
  const stats = await publicService.getPublicStats();
  res.status(200).json(stats);
}

module.exports = {
  getStats,
};

