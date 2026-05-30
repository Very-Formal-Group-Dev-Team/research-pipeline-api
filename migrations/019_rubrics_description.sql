-- Migration 019: Required rubric description (criteria description already exists)

SET @col_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'rubrics'
    AND COLUMN_NAME = 'description'
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE rubrics ADD COLUMN description TEXT NULL AFTER name',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE rubrics SET description = '' WHERE description IS NULL;

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE rubrics MODIFY COLUMN description TEXT NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
