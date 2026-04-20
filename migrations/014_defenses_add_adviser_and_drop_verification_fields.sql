-- Migration 014: Refactor defenses table for adviser ownership
-- 1) Drop no-longer-needed columns on defenses
-- 2) Add adviser_id and enforce FK to users

-- Drop FK/index tied to verified_by before dropping the column
SET @fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
    AND CONSTRAINT_NAME = 'fk_defenses_verified_by'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @sql = IF(
  @fk_exists > 0,
  'ALTER TABLE defenses DROP FOREIGN KEY fk_defenses_verified_by',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
    AND INDEX_NAME = 'idx_defenses_verified_by'
);

SET @sql = IF(
  @idx_exists > 0,
  'ALTER TABLE defenses DROP INDEX idx_defenses_verified_by',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Drop legacy/unneeded columns if they exist
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
    AND COLUMN_NAME = 'section'
);
SET @sql = IF(@col_exists > 0, 'ALTER TABLE defenses DROP COLUMN section', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
    AND COLUMN_NAME = 'verified_at'
);
SET @sql = IF(@col_exists > 0, 'ALTER TABLE defenses DROP COLUMN verified_at', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
    AND COLUMN_NAME = 'verified_by'
);
SET @sql = IF(@col_exists > 0, 'ALTER TABLE defenses DROP COLUMN verified_by', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
    AND COLUMN_NAME = 'blocked_by'
);
SET @sql = IF(@col_exists > 0, 'ALTER TABLE defenses DROP COLUMN blocked_by', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add adviser_id if missing (nullable first for backfill safety)
SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
    AND COLUMN_NAME = 'adviser_id'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE defenses ADD COLUMN adviser_id CHAR(36) NULL AFTER project_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill adviser_id from accepted adviser project member, fallback to created_by
UPDATE defenses d
LEFT JOIN (
  SELECT pm.project_id, MIN(pm.user_id) AS adviser_id
  FROM project_members pm
  WHERE pm.role = 'adviser' AND pm.status = 'accepted'
  GROUP BY pm.project_id
) pa ON pa.project_id = d.project_id
SET d.adviser_id = COALESCE(d.adviser_id, pa.adviser_id, d.created_by)
WHERE d.adviser_id IS NULL;

-- Enforce NOT NULL after backfill
ALTER TABLE defenses
MODIFY COLUMN adviser_id CHAR(36) NOT NULL;

-- Add index + FK if missing
SET @idx_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
    AND INDEX_NAME = 'idx_defenses_adviser_id'
);
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE defenses ADD INDEX idx_defenses_adviser_id (adviser_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
    AND CONSTRAINT_NAME = 'fk_defenses_adviser'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @sql = IF(
  @fk_exists = 0,
  'ALTER TABLE defenses ADD CONSTRAINT fk_defenses_adviser FOREIGN KEY (adviser_id) REFERENCES users(id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
