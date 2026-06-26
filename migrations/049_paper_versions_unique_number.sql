-- Prevent duplicate version numbers per project when uploads happen concurrently.
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'paper_versions'
    AND index_name = 'uq_paper_versions_project_version'
);
SET @ddl := IF(
  @idx_exists = 0,
  'ALTER TABLE paper_versions ADD UNIQUE KEY uq_paper_versions_project_version (project_id, version_number)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
