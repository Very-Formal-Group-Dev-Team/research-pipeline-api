-- Migration 012: Add defenses.end_time for interval-based schedule overlap checks

SET @has_end_time = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
    AND COLUMN_NAME = 'end_time'
);

SET @sql_add_end_time = IF(
  @has_end_time = 0,
  'ALTER TABLE defenses ADD COLUMN end_time DATETIME NULL AFTER scheduled_at',
  'SELECT 1'
);

PREPARE stmt FROM @sql_add_end_time;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill existing rows so every defense has a valid interval end.
UPDATE defenses
SET end_time = scheduled_at
WHERE end_time IS NULL;
