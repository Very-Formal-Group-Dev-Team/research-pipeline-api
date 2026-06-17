function createRateLimiter({ windowMs, max, message = 'Too many requests. Please try again later.' }) {
  const hits = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now > entry.resetAt) {
        hits.delete(key);
      }
    }
  }, windowMs);

  if (typeof cleanup.unref === 'function') {
    cleanup.unref();
  }

  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      return res.status(429).json({ error: message });
    }

    return next();
  };
}

const authEmailRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many requests. Please try again in an hour.',
});

module.exports = {
  createRateLimiter,
  authEmailRateLimit,
};
