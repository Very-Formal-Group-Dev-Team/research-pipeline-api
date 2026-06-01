-- Migration 024: Store display role (Author, Editor, etc.) on project invitations.

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_members'
    AND COLUMN_NAME = 'contributor_role'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE project_members ADD COLUMN contributor_role VARCHAR(64) NULL AFTER role',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
