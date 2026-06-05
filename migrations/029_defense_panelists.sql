-- Migration 029: Assign advisers as defense panelists

CREATE TABLE IF NOT EXISTS defense_panelists (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  defense_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_defense_panelists_defense_user (defense_id, user_id),
  CONSTRAINT defense_panelists_defense_id_fkey FOREIGN KEY (defense_id) REFERENCES defenses(id) ON DELETE CASCADE,
  CONSTRAINT defense_panelists_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defense_panelists' AND INDEX_NAME = 'idx_defense_panelists_defense'
);
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_defense_panelists_defense ON defense_panelists (defense_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defense_panelists' AND INDEX_NAME = 'idx_defense_panelists_user'
);
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_defense_panelists_user ON defense_panelists (user_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
