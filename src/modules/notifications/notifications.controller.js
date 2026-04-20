const notificationsService = require('./notifications.service');

async function list(req, res) {
  try {
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const notifications = await notificationsService.getNotificationsForUser(req.user.id, {
      limit: Number.isNaN(parsedLimit) ? 50 : parsedLimit,
    });
    return res.json(notifications);
  } catch (err) {
    console.error('notifications.controller – list error:', err);
    return res.status(500).json({ error: 'Failed to fetch notifications' });
  }
}

async function markRead(req, res) {
  try {
    const result = await notificationsService.markNotificationAsRead(req.params.id, req.user.id);
    if (!result || result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('notifications.controller – markRead error:', err);
    return res.status(500).json({ error: 'Failed to update notification' });
  }
}

async function markAllRead(req, res) {
  try {
    const result = await notificationsService.markAllNotificationsAsRead(req.user.id);
    return res.json({
      success: true,
      updated: result?.affectedRows || 0,
    });
  } catch (err) {
    console.error('notifications.controller – markAllRead error:', err);
    return res.status(500).json({ error: 'Failed to update notifications' });
  }
}

module.exports = {
  list,
  markRead,
  markAllRead,
};
