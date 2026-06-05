-- Migration 030: Panelist notes for defense video meetings

CREATE TABLE IF NOT EXISTS defense_panelist_notes (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  defense_id CHAR(36) NOT NULL,
  panelist_id CHAR(36) NOT NULL,
  notes TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_defense_panelist_notes_defense_panelist (defense_id, panelist_id),
  CONSTRAINT defense_panelist_notes_defense_id_fkey FOREIGN KEY (defense_id) REFERENCES defenses(id) ON DELETE CASCADE,
  CONSTRAINT defense_panelist_notes_panelist_id_fkey FOREIGN KEY (panelist_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defense_panelist_notes' AND INDEX_NAME = 'idx_defense_panelist_notes_panelist'
);
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_defense_panelist_notes_panelist ON defense_panelist_notes (panelist_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
