const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../../../config/db');
const { sendVerificationEmail } = require('./email.service');

const SALT_ROUNDS = 12;
const VERIFICATION_EXPIRY_HOURS = 24;

function getVerificationEmailErrorMessage(err) {
  if (err && err.code === 'SMTP_CONFIG_MISSING') {
    return err.message;
  }

  return 'Failed to send verification email. Please try again later.';
}

function generateToken(user, { rememberMe = true } = {}) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: rememberMe ? '7d' : '1d' }
  );
}

async function createVerificationToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO email_verification_tokens (id, user_id, token, expires_at) VALUES (UUID(), ?, ?, ?)`,
    [userId, token, expiresAt]
  );

  return token;
}

async function registerWithEmail(email, password, fullName) {
  const { rows } = await db.query('SELECT id, email_verified FROM users WHERE email = ? LIMIT 1', [email]);

  if (rows.length > 0) {
    const existing = rows[0];
    if (!existing.email_verified) {
      const token = await createVerificationToken(existing.id);
      try {
        await sendVerificationEmail(email, token);
      } catch (err) {
        console.error('[auth] failed to resend verification email', err.message);
        return { error: getVerificationEmailErrorMessage(err) };
      }
      return { pending: true, message: 'We sent another verification email. Check your inbox.' };
    }
    return { error: 'An account with this email already exists. Try signing in instead.' };
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const id = crypto.randomUUID();

  await db.query(
    `INSERT INTO users (id, email, password_hash, full_name, auth_provider, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'email', 1, 0, NOW(), NOW())`,
    [id, email, passwordHash, fullName || null]
  );

  console.log('[auth] registered email user (pending verification)', { id, email });

  const token = await createVerificationToken(id);

  try {
    await sendVerificationEmail(email, token);
  } catch (err) {
    console.error('[auth] failed to send verification email', err.message);
    return { error: getVerificationEmailErrorMessage(err) };
  }

  return { pending: true, message: 'Please check your email to verify your account.' };
}

async function verifyEmailToken(token) {
  const { rows } = await db.query(
    `SELECT t.id AS token_id, t.user_id, t.expires_at, t.used_at, u.email, u.full_name, u.avatar_url, u.email_verified
     FROM email_verification_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token = ?
     LIMIT 1`,
    [token]
  );

  if (rows.length === 0) {
    return { error: 'Invalid or expired verification link.' };
  }

  const record = rows[0];

  if (record.used_at) {
    if (record.email_verified) {
      const user = { id: record.user_id, email: record.email, full_name: record.full_name, avatar_url: record.avatar_url };
      const jwt = generateToken(user);
      return { user, token: jwt, alreadyVerified: true };
    }
    return { error: 'This verification link has already been used.' };
  }

  if (new Date(record.expires_at) < new Date()) {
    return { error: 'This verification link has expired. Please register again to receive a new one.' };
  }

  await db.query('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = ?', [record.token_id]);
  await db.query('UPDATE users SET email_verified = 1, updated_at = NOW() WHERE id = ?', [record.user_id]);

  console.log('[auth] email verified', { userId: record.user_id, email: record.email });

  const user = { id: record.user_id, email: record.email, full_name: record.full_name, avatar_url: record.avatar_url };
  const jwt = generateToken(user);

  return { user, token: jwt };
}

async function resendVerification(email) {
  const { rows } = await db.query(
    'SELECT id, email_verified FROM users WHERE email = ? AND auth_provider = ? LIMIT 1',
    [email, 'email']
  );

  if (rows.length === 0) {
    return { error: 'No account found with that email.' };
  }

  if (rows[0].email_verified) {
    return { error: 'This email is already verified. Please log in.' };
  }

  const token = await createVerificationToken(rows[0].id);

  try {
    await sendVerificationEmail(email, token);
  } catch (err) {
    console.error('[auth] failed to resend verification email', err.message);
    return { error: getVerificationEmailErrorMessage(err) };
  }

  return { success: true, message: 'We sent a verification email. Check your inbox.' };
}

async function loginWithEmail(email, password, { rememberMe = false } = {}) {
  const { rows } = await db.query(
    'SELECT id, email, full_name, avatar_url, password_hash, auth_provider, email_verified FROM users WHERE email = ? LIMIT 1',
    [email]
  );

  if (rows.length === 0) {
    return { error: 'Invalid email or password' };
  }

  const user = rows[0];

  if (user.auth_provider !== 'email' || !user.password_hash) {
    return { error: 'This account uses Google sign-in' };
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return { error: 'Invalid email or password' };
  }

  if (!user.email_verified) {
    return { error: 'Please verify your email before logging in. Check your inbox for the verification link.' };
  }

  console.log('[auth] email login success', { id: user.id, email: user.email });

  const token = generateToken(user, { rememberMe });

  return {
    user: { id: user.id, email: user.email, full_name: user.full_name, avatar_url: user.avatar_url },
    token,
  };
}

async function findOrCreateGoogleUser(profile) {
  const { rows } = await db.query('SELECT id, email, full_name, avatar_url, auth_provider FROM users WHERE email = ? LIMIT 1', [profile.email]);

  if (rows.length > 0) {
    const user = rows[0];
    if (user.auth_provider !== 'google') {
      await db.query(
        'UPDATE users SET auth_provider = ?, avatar_url = COALESCE(avatar_url, ?), updated_at = NOW() WHERE id = ?',
        ['google', profile.picture || null, user.id]
      );
      console.log('[auth] linked existing user to google', { id: user.id });
    } else {
      console.log('[auth] google user already exists', { id: user.id });
    }
    return { id: user.id, email: user.email, full_name: user.full_name || profile.name, avatar_url: user.avatar_url || profile.picture };
  }

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO users (id, email, full_name, avatar_url, auth_provider, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'google', 1, NOW(), NOW())`,
    [id, profile.email, profile.name || null, profile.picture || null]
  );

  console.log('[auth] created new google user', { id, email: profile.email });

  return { id, email: profile.email, full_name: profile.name || null, avatar_url: profile.picture || null };
}

async function getUserById(userId) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.full_name, u.avatar_url, u.auth_provider, u.status, u.email_verified, ur.role
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     WHERE u.id = ?
     ORDER BY ur.created_at DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function createPasswordResetToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (UUID(), ?, ?, ?)`,
    [userId, token, expiresAt],
  );

  return token;
}

async function requestPasswordReset(email) {
  if (!email || typeof email !== 'string') {
    return { error: 'Email is required' };
  }

  const normalizedEmail = email.trim().toLowerCase();
  const { rows } = await db.query(
    'SELECT id, email, auth_provider FROM users WHERE LOWER(email) = ? LIMIT 1',
    [normalizedEmail],
  );

  if (rows.length === 0 || rows[0].auth_provider !== 'email') {
    return {
      success: true,
      message: 'If an account exists for that email, we sent password reset instructions.',
    };
  }

  const token = await createPasswordResetToken(rows[0].id);

  try {
    const { sendPasswordResetEmail } = require('./email.service');
    await sendPasswordResetEmail(rows[0].email, token);
  } catch (err) {
    console.error('[auth] failed to send password reset email', err.message);
    return { error: getVerificationEmailErrorMessage(err) };
  }

  return {
    success: true,
    message: 'If an account exists for that email, we sent password reset instructions.',
  };
}

async function resetPasswordWithToken(token, newPassword) {
  if (!token || typeof token !== 'string') {
    return { error: 'Reset token is required' };
  }

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    return { error: 'Password must be at least 6 characters' };
  }

  const { rows } = await db.query(
    `SELECT t.id AS token_id, t.user_id, t.expires_at, t.used_at, u.auth_provider
     FROM password_reset_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token = ?
     LIMIT 1`,
    [token],
  );

  if (rows.length === 0) {
    return { error: 'Invalid or expired reset link.' };
  }

  const record = rows[0];

  if (record.used_at) {
    return { error: 'This reset link has already been used.' };
  }

  if (new Date(record.expires_at) < new Date()) {
    return { error: 'This reset link has expired. Please request a new one.' };
  }

  if (record.auth_provider !== 'email') {
    return { error: 'This account uses Google sign-in.' };
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await db.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [record.token_id]);
  await db.query(
    'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
    [passwordHash, record.user_id],
  );

  return { success: true, message: 'Password reset successfully. You can now sign in.' };
}

async function changePassword(userId, currentPassword, newPassword) {
  const { rows } = await db.query(
    'SELECT id, password_hash, auth_provider FROM users WHERE id = ? LIMIT 1',
    [userId],
  );

  if (rows.length === 0) {
    return { error: 'User not found', status: 404 };
  }

  const user = rows[0];

  if (user.auth_provider !== 'email' || !user.password_hash) {
    return { error: 'Password changes are only available for email sign-in accounts' };
  }

  if (!currentPassword || !newPassword) {
    return { error: 'Current password and new password are required' };
  }

  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return { error: 'New password must be at least 6 characters' };
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    return { error: 'Current password is incorrect', status: 401 };
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await db.query(
    'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
    [passwordHash, userId],
  );

  return { success: true, message: 'Password updated successfully' };
}

module.exports = {
  generateToken,
  registerWithEmail,
  loginWithEmail,
  findOrCreateGoogleUser,
  getUserById,
  verifyEmailToken,
  resendVerification,
  changePassword,
  requestPasswordReset,
  resetPasswordWithToken,
};
