-- Migration 018: Distinguish coordinator vs adviser rubrics

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'rubrics'
    AND COLUMN_NAME = 'role'
);

SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE rubrics
     ADD COLUMN role ENUM('coordinator', 'adviser') NOT NULL DEFAULT 'coordinator'
     AFTER defense_type",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE rubrics SET role = 'coordinator' WHERE role IS NULL OR role = '';
