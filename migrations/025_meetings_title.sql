-- Migration 025: optional custom title for adviser-booked meetings

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings' AND COLUMN_NAME = 'meeting_title'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE meetings ADD COLUMN meeting_title VARCHAR(255) NULL AFTER defense_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
