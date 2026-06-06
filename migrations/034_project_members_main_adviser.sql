-- Migration 034: Distinguish main adviser from co-advisers on project teams.

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_members'
    AND COLUMN_NAME = 'is_main_adviser'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE project_members ADD COLUMN is_main_adviser TINYINT(1) NULL DEFAULT NULL AFTER role',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE project_members pm
INNER JOIN (
  SELECT
    project_id,
    SUBSTRING_INDEX(GROUP_CONCAT(id ORDER BY invited_at ASC, id ASC), ',', 1) AS main_member_id
  FROM project_members
  WHERE role = 'adviser' AND status = 'accepted'
  GROUP BY project_id
) ranked ON ranked.main_member_id = pm.id
SET pm.is_main_adviser = 1
WHERE pm.role = 'adviser' AND pm.status = 'accepted';

UPDATE project_members
SET is_main_adviser = 0
WHERE role = 'adviser'
  AND status = 'accepted'
  AND is_main_adviser IS NULL;
