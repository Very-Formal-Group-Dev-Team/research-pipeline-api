const {
  getProfileByUserId,
  updateMyProfile,
} = require('../users/users.service');

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

module.exports = { getProfile, patchProfile, uploadAvatar: uploadAvatarSafe };
