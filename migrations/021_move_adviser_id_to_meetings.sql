-- Migration 021: adviser_id belongs on meetings (adviser flow), not defenses (coordinator flow)

-- 1) Add adviser_id to meetings if missing
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings' AND COLUMN_NAME = 'adviser_id'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE meetings ADD COLUMN adviser_id CHAR(36) NULL AFTER project_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Backfill meetings.adviser_id from accepted project advisers
UPDATE meetings m
LEFT JOIN (
  SELECT pm.project_id, MIN(pm.user_id) AS adviser_id
  FROM project_members pm
  WHERE pm.role = 'adviser' AND pm.status = 'accepted'
  GROUP BY pm.project_id
) pa ON pa.project_id = m.project_id
SET m.adviser_id = COALESCE(m.adviser_id, pa.adviser_id, m.created_by)
WHERE m.adviser_id IS NULL;

-- 3) Drop defenses.adviser_id FK/index/column
SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses'
    AND CONSTRAINT_NAME = 'fk_defenses_adviser' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql = IF(@fk_exists > 0, 'ALTER TABLE defenses DROP FOREIGN KEY fk_defenses_adviser', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND INDEX_NAME = 'idx_defenses_adviser_id'
);
SET @sql = IF(@idx_exists > 0, 'ALTER TABLE defenses DROP INDEX idx_defenses_adviser_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND COLUMN_NAME = 'adviser_id'
);
SET @sql = IF(@col_exists > 0, 'ALTER TABLE defenses DROP COLUMN adviser_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Meetings adviser_id FK (nullable)
SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings'
    AND CONSTRAINT_NAME = 'fk_meetings_adviser' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql = IF(
  @fk_exists = 0,
  'ALTER TABLE meetings ADD CONSTRAINT fk_meetings_adviser FOREIGN KEY (adviser_id) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
