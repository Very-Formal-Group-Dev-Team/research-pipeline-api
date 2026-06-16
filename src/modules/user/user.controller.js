const {
  getProfileByUserId,
  updateMyProfile,
  getDisplayPreferences,
  updateDisplayPreferences,
} = require('../users/users.service');
const {
  getNotificationPreferencesForUser,
  updateNotificationPreferencesForUser,
} = require('../notifications/notifications.service');

async function getProfile(req, res) {
  const profile = await getProfileByUserId(req.user.id);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  return res.json(profile);
}

async function patchProfile(req, res) {
  const result = await updateMyProfile(req.user.id, req.body || {});
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function uploadAvatar(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const publicUrl = `/uploads/avatars/${req.file.filename}`;

  const result = await updateMyProfile(req.user.id, { avatar_url: publicUrl });
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.json({ publicUrl, profile: result.data });
}

async function uploadAvatarSafe(req, res) {
  try {
    return await uploadAvatar(req, res);
  } catch (err) {
    if (['EACCES', 'EPERM', 'EROFS', 'ENOSPC'].includes(err?.code)) {
      return res.status(500).json({ error: 'Failed to write uploaded file to disk' });
    }
    throw err;
  }
}

async function getNotificationPreferences(req, res) {
  const preferences = await getNotificationPreferencesForUser(req.user.id);
  return res.json({ preferences });
}

async function patchNotificationPreferences(req, res) {
  const { preferences } = req.body || {};
  const result = await updateNotificationPreferencesForUser(req.user.id, preferences);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({ preferences: result.data });
}

async function getDisplayPrefs(req, res) {
  const result = await getDisplayPreferences(req.user.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function patchDisplayPrefs(req, res) {
  const result = await updateDisplayPreferences(req.user.id, req.body || {});
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

module.exports = {
  getProfile,
  patchProfile,
  uploadAvatar: uploadAvatarSafe,
  getNotificationPreferences,
  patchNotificationPreferences,
  getDisplayPrefs,
  patchDisplayPrefs,
};
