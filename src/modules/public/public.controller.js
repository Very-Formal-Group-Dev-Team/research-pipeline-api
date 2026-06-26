const publicService = require('./public.service');

async function getStats(_req, res) {
  const stats = await publicService.getPublicStats();
  res.status(200).json(stats);
}

async function getConfig(_req, res) {
  const config = await publicService.getPublicConfig();
  res.status(200).json(config);
}

module.exports = {
  getStats,
  getConfig,
};

