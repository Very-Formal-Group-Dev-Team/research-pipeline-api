-- Migration 051: Platform-wide audit log for admin visibility (NFR-05).

CREATE TABLE IF NOT EXISTS system_audit_log (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  action VARCHAR(64) NOT NULL,
  actor_user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  target_type VARCHAR(32) DEFAULT NULL,
  target_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  institution_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  metadata JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_system_audit_log_created_at (created_at DESC),
  INDEX idx_system_audit_log_action (action),
  INDEX idx_system_audit_log_actor (actor_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
