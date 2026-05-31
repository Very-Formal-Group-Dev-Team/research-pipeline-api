-- Migration 022: Jitsi meeting fields on defenses (coordinator) and meetings (adviser)

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND COLUMN_NAME = 'meeting_room'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE defenses ADD COLUMN meeting_room VARCHAR(255) NULL, ADD COLUMN meeting_url TEXT NULL, ADD COLUMN meeting_provider VARCHAR(50) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings' AND COLUMN_NAME = 'meeting_room'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE meetings ADD COLUMN meeting_room VARCHAR(255) NULL, ADD COLUMN meeting_url TEXT NULL, ADD COLUMN meeting_provider VARCHAR(50) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
