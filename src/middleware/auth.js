const jwt = require('jsonwebtoken');

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

  if (/^[0-9a-fA-F-]{16,}$/.test(token)) {
    return { id: token };
  }

  return null;
}

function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req) || getSessionToken(req);

    if (token) {
      const user = extractUserFromToken(token);
      if (user) {
        req.user = user;
        return next();
      }
    }

    if (process.env.NODE_ENV !== 'production') {
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
}

module.exports = {
  requireAuth,
};
