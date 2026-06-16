-- Migration 044: Per-user in-app notification preferences.

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  type VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_notification_pref (user_id, type),
  CONSTRAINT fk_user_notification_pref_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
