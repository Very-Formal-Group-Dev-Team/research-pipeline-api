const {
  completeProfile,
  getProfileByUserId,
  getRoleByUserId,
  profileExists,
  searchUsersByEmail,
  updateMyProfile,
} = require('./users.service');

async function getMe(req, res) {
  const profile = await getProfileByUserId(req.user.id);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  return res.json(profile);
}

async function getUserById(req, res) {
  const { userId } = req.params;
  if (userId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const profile = await getProfileByUserId(userId);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }

  return res.json(profile);
}

async function getMyProfileExists(req, res) {
  const exists = await profileExists(req.user.id);
  const role = exists ? await getRoleByUserId(req.user.id) : null;
  return res.json({ exists, role: role || undefined });
}

async function patchMe(req, res) {
  const result = await updateMyProfile(req.user.id, req.body || {});
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function postCompleteProfile(req, res) {
  const result = await completeProfile(req.user.id, req.body || {});
  if (result.error) {
    return res.status(400).json({ error: result.error, success: false });
  }
  return res.status(200).json(result.data);
}

async function getMyRole(req, res) {
  const role = await getRoleByUserId(req.user.id);
  if (!role) {
    return res.status(404).json({ error: 'Role not found' });
  }
  return res.json({ role });
}

async function searchUsers(req, res) {
  const { email, role, limit } = req.query;
  if (!email || typeof email !== 'string' || email.trim().length < 2) {
    return res.status(400).json({ error: 'email query must be at least 2 characters' });
  }
  const allowedRoles = ['student', 'adviser'];
  const filteredRole = role && allowedRoles.includes(role) ? role : null;
  try {
    const maxResults = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 20);
    const results = await searchUsersByEmail(email.trim(), filteredRole, maxResults, req.user.id);
    return res.json(results);
  } catch (err) {
    console.error('searchUsers error:', err);
    return res.status(500).json({ error: 'Failed to search users' });
  }
}

module.exports = {
  getMe,
  getMyProfileExists,
  getMyRole,
  getUserById,
  patchMe,
  postCompleteProfile,
  searchUsers,
};
