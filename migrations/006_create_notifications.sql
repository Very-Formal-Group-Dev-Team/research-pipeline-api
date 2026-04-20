CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  user_id CHAR(36) NOT NULL,
  type ENUM('invitation') NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  metadata JSON,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  read_at DATETIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_user_created_at (user_id, created_at),
  KEY idx_notifications_user_is_read (user_id, is_read),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id)
);
