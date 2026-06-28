const crypto = require('crypto');
const authService = require('./auth.service');
const { validatePassword } = require('../../lib/passwordPolicy');
const { logAuditEntry } = require('../audit/audit.service');

function getCookieOptions(rememberMe = true) {
  const isProduction = process.env.NODE_ENV === 'production';
  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  };

  if (rememberMe) {
    options.maxAge = 7 * 24 * 60 * 60 * 1000;
  }

  return options;
}

async function register(req, res) {
  const { email, password, full_name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Enter your email and password to continue.' });
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  const result = await authService.registerWithEmail(email, password, full_name);

  if (result.error) {
    return res.status(409).json({ error: result.error });
  }

  if (result.pending) {
    return res.status(201).json({
      pending: true,
      message: result.message,
    });
  }

  res.cookie('session_token', result.token, getCookieOptions());
  return res.status(201).json({
    user: result.user,
    token: result.token,
    message: 'Registration successful',
  });
}

async function verifyEmail(req, res) {
  const { token } = req.body;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Verification token is required' });
  }

  const result = await authService.verifyEmailToken(token);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.cookie('session_token', result.token, getCookieOptions());
  return res.json({
    user: result.user,
    token: result.token,
    message: result.alreadyVerified ? 'Email already verified.' : 'Email verified successfully.',
  });
}

async function resendVerification(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const result = await authService.resendVerification(email);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({ message: result.message });
}

async function login(req, res) {
  const { email, password, remember_me } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Enter your email and password to continue.' });
  }

  const rememberMe = remember_me === true;
  const result = await authService.loginWithEmail(email, password, { rememberMe });

  if (result.error) {
    return res.status(401).json({ error: result.error });
  }

  res.cookie('session_token', result.token, getCookieOptions(rememberMe));
  return res.json({
    user: result.user,
    token: result.token,
    message: 'Login successful',
  });
}

async function getMe(req, res) {
  const user = await authService.getUserById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json(user);
}

async function logout(req, res) {
  res.clearCookie('session_token', { path: '/' });
  return res.json({ success: true });
}

async function changePassword(req, res) {
  const { current_password: currentPassword, new_password: newPassword } = req.body || {};

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  const result = await authService.changePassword(req.user.id, currentPassword, newPassword);

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.json({ success: true, message: result.message });
}

async function forgotPassword(req, res) {
  const { email } = req.body || {};
  const result = await authService.requestPasswordReset(email);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({ success: true, message: result.message });
}

async function resetPassword(req, res) {
  const { token, new_password: newPassword } = req.body || {};

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  const result = await authService.resetPasswordWithToken(token, newPassword);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({ success: true, message: result.message });
}

function oAuthRedirect(req, res) {
  const { provider, redirectTo } = req.body;

  if (provider !== 'google') {
    return res.status(400).json({ error: 'Unsupported OAuth provider' });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'Google OAuth is not configured' });
  }

  const callbackUri = `${process.env.API_ORIGIN || 'http://localhost:4000'}/api/auth/google/callback`;
  const state = Buffer.from(JSON.stringify({
    csrf: crypto.randomBytes(16).toString('hex'),
    redirectTo: redirectTo || '/onboarding',
  })).toString('base64url');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    state,
    prompt: 'consent',
  });

  return res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
}

async function googleCallback(req, res) {
  const { code, state } = req.query;
  const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:3000';

  let redirectTo = '/onboarding';
  try {
    const stateData = JSON.parse(Buffer.from(state || '', 'base64url').toString());
    redirectTo = stateData.redirectTo || '/onboarding';
  } catch {}

  if (!code) {
    return res.redirect(`${webOrigin}/login?error=missing_code`);
  }

  try {
    const callbackUri = `${process.env.API_ORIGIN || 'http://localhost:4000'}/api/auth/google/callback`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: callbackUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      return res.redirect(`${webOrigin}/login?error=token_exchange_failed`);
    }

    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const profile = await userinfoRes.json();

    if (!profile.email) {
      return res.redirect(`${webOrigin}/login?error=no_email`);
    }

    const oauthResult = await authService.findOrCreateGoogleUser(profile);
    if (oauthResult.error) {
      if (oauthResult.error.toLowerCase().includes('deactivated')) {
        return res.redirect(`${webOrigin}/login?error=account_deactivated`);
      }
      return res.redirect(`${webOrigin}/login?error=account_exists`);
    }
    const token = authService.generateToken(oauthResult.user);

    await logAuditEntry({
      action: 'user.login',
      actorUserId: oauthResult.user.id,
      targetType: 'user',
      targetId: oauthResult.user.id,
      metadata: { method: 'google' },
    });

    res.cookie('session_token', token, getCookieOptions());
    return res.redirect(`${webOrigin}/auth/continue?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error(err);
    return res.redirect(`${webOrigin}/login?error=oauth_failed`);
  }
}

module.exports = {
  register,
  login,
  getMe,
  logout,
  verifyEmail,
  resendVerification,
  changePassword,
  forgotPassword,
  resetPassword,
  oAuthRedirect,
  googleCallback,
};
