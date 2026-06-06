-- Migration 031: Track whether a pending member was invited or requested via project code.

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_members'
    AND COLUMN_NAME = 'join_source'
);
SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE project_members ADD COLUMN join_source ENUM('invite', 'code_request') NULL DEFAULT NULL AFTER contributor_role",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Existing pending rows were created by leader invitations.
UPDATE project_members
SET join_source = 'invite'
WHERE join_source IS NULL AND status = 'pending';
