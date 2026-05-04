-- Migration 015: Align legacy project member and notification table shapes with the current API.
-- This keeps older development databases compatible with the routes that read invitations,
-- membership state, and notification history.

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_members'
    AND COLUMN_NAME = 'role'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE project_members ADD COLUMN role ENUM('leader', 'member', 'adviser') NOT NULL DEFAULT 'member' AFTER user_id",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_members'
    AND COLUMN_NAME = 'status'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE project_members ADD COLUMN status ENUM('pending', 'accepted', 'declined') NOT NULL DEFAULT 'pending' AFTER role",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_members'
    AND COLUMN_NAME = 'invited_at'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE project_members ADD COLUMN invited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_members'
    AND COLUMN_NAME = 'responded_at'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE project_members ADD COLUMN responded_at DATETIME NULL AFTER invited_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'type'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE notifications ADD COLUMN type ENUM('invitation', 'schedule', 'defense_approved', 'defense_rejected', 'defense_moved') NOT NULL DEFAULT 'invitation' AFTER user_id",
  "ALTER TABLE notifications MODIFY COLUMN type ENUM('invitation', 'schedule', 'defense_approved', 'defense_rejected', 'defense_moved') NOT NULL"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'metadata'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE notifications ADD COLUMN metadata JSON AFTER message',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'is_read'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE notifications ADD COLUMN is_read TINYINT(1) NOT NULL DEFAULT 0 AFTER metadata',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'read_at'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE notifications ADD COLUMN read_at DATETIME NULL AFTER is_read',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
