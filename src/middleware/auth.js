const jwt = require('jsonwebtoken');
const db = require('../../config/db');
const { getRoleByUserId } = require('../modules/users/users.service');

function isDevAuthBypassAllowed() {
  return (
    process.env.NODE_ENV !== 'production'
    && String(process.env.ALLOW_DEV_AUTH_BYPASS || '').trim().toLowerCase() === 'true'
  );
}

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const [key, ...rest] = pair.split('=');
      if (!key) return acc;
      acc[key] = decodeURIComponent(rest.join('='));
      return acc;
    }, {});
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim();
}

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies.session_token || null;
}

function extractUserFromToken(token) {
  const jwtSecret = process.env.JWT_SECRET;

  if (jwtSecret) {
    const decoded = jwt.verify(token, jwtSecret);
    const userId = decoded.sub || decoded.userId || decoded.id;
    if (typeof userId === 'string' && userId.length > 0) {
      return { id: userId, email: decoded.email || null };
    }
  }

  if (isDevAuthBypassAllowed() && /^[0-9a-fA-F-]{16,}$/.test(token)) {
    return { id: token };
  }

  return null;
}

function normalizeDashboardRole(role) {
  if (!role || typeof role !== 'string') return null;
  const normalized = role.trim().toLowerCase();
  if (normalized === 'teacher') return 'adviser';
  if (
    normalized === 'student'
    || normalized === 'adviser'
    || normalized === 'coordinator'
    || normalized === 'admin'
  ) {
    return normalized;
  }
  return null;
}

function requireDashboardRole(...allowedRoles) {
  const allowed = new Set(
    allowedRoles.map((role) => (role === 'teacher' ? 'adviser' : role)),
  );

  return async (req, res, next) => {
    try {
      const rawRole = await getRoleByUserId(req.user.id);
      const role = normalizeDashboardRole(rawRole);

      if (!role || !allowed.has(role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      req.userRole = role;
      return next();
    } catch (error) {
      return res.status(500).json({ error: 'Failed to verify role' });
    }
  };
}

function requireAuth(req, res, next) {
  (async () => {
    try {
      const token = getBearerToken(req) || getSessionToken(req);

      if (token) {
        const user = extractUserFromToken(token);
        if (user) {
          const { rows } = await db.query('SELECT status FROM users WHERE id = ? LIMIT 1', [user.id]);
          if (rows[0] && Number(rows[0].status) === 0) {
            return res.status(403).json({ error: 'Account deactivated. Contact your administrator.' });
          }
          req.user = user;
          return next();
        }
      }

      if (isDevAuthBypassAllowed()) {
        const devUserId = req.headers['x-user-id'];
        if (typeof devUserId === 'string' && devUserId.trim()) {
          req.user = { id: devUserId.trim() };
          return next();
        }
      }

      return res.status(401).json({ error: 'Unauthorized' });
    } catch (error) {
      return res.status(401).json({ error: 'Invalid session token' });
    }
  })();
}

module.exports = {
  requireAuth,
  requireDashboardRole,
  normalizeDashboardRole,
};
