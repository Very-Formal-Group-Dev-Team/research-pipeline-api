-- Migration 013: Split legacy defenses into meetings and create a new defenses table
-- Goal:
--   1) Rename existing defenses table to meetings (legacy adviser flow)
--   2) Create a fresh defenses table (coordinator booking flow)
--   3) Re-point defense_id foreign keys to the new defenses table

-- 1) Rename defenses -> meetings only when needed
SET @has_defenses = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
);

SET @has_meetings = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'meetings'
);

SET @sql = IF(
  @has_defenses = 1 AND @has_meetings = 0,
  'RENAME TABLE defenses TO meetings',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Refresh table-existence variables after potential rename
SET @has_defenses = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
);

SET @has_meetings = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'meetings'
);

-- 2) Create a new defenses table based on meetings shape
SET @sql = IF(
  @has_defenses = 0 AND @has_meetings = 1,
  'CREATE TABLE defenses LIKE meetings',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Refresh after potential create
SET @has_defenses = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
);

-- If defenses is newly created and empty, backfill existing historical records
-- so related tables can continue to resolve defense_id values.
SET @defenses_rows = 0;

SET @sql = IF(
  @has_defenses = 1,
  'SELECT COUNT(*) INTO @defenses_rows FROM defenses',
  'SELECT 0 INTO @defenses_rows'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  @has_meetings = 1 AND @has_defenses = 1 AND @defenses_rows = 0,
  'INSERT INTO defenses SELECT * FROM meetings',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) Ensure key foreign keys for defense_id now reference the new defenses table

-- 3a) defense_results.defense_id
SET @tbl_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defense_results'
);

SET @fk_name = IF(
  @tbl_exists = 1,
  (
    SELECT kcu.CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE kcu
    WHERE kcu.TABLE_SCHEMA = DATABASE()
      AND kcu.TABLE_NAME = 'defense_results'
      AND kcu.COLUMN_NAME = 'defense_id'
      AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      AND kcu.REFERENCED_TABLE_NAME <> 'defenses'
    LIMIT 1
  ),
  NULL
);

SET @sql = IF(
  @fk_name IS NOT NULL,
  CONCAT('ALTER TABLE defense_results DROP FOREIGN KEY ', @fk_name),
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists = IF(
  @tbl_exists = 1,
  (
    SELECT COUNT(*)
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'defense_results'
      AND COLUMN_NAME = 'defense_id'
      AND REFERENCED_TABLE_NAME = 'defenses'
  ),
  1
);

SET @sql = IF(
  @tbl_exists = 1 AND @fk_exists = 0,
  'ALTER TABLE defense_results ADD CONSTRAINT defense_results_defense_id_fkey FOREIGN KEY (defense_id) REFERENCES defenses(id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3b) evaluations.defense_id
SET @tbl_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'evaluations'
);

SET @fk_name = IF(
  @tbl_exists = 1,
  (
    SELECT kcu.CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE kcu
    WHERE kcu.TABLE_SCHEMA = DATABASE()
      AND kcu.TABLE_NAME = 'evaluations'
      AND kcu.COLUMN_NAME = 'defense_id'
      AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      AND kcu.REFERENCED_TABLE_NAME <> 'defenses'
    LIMIT 1
  ),
  NULL
);

SET @sql = IF(
  @fk_name IS NOT NULL,
  CONCAT('ALTER TABLE evaluations DROP FOREIGN KEY ', @fk_name),
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists = IF(
  @tbl_exists = 1,
  (
    SELECT COUNT(*)
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'evaluations'
      AND COLUMN_NAME = 'defense_id'
      AND REFERENCED_TABLE_NAME = 'defenses'
  ),
  1
);

SET @sql = IF(
  @tbl_exists = 1 AND @fk_exists = 0,
  'ALTER TABLE evaluations ADD CONSTRAINT evaluations_defense_id_fkey FOREIGN KEY (defense_id) REFERENCES defenses(id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3c) defense_verifications.defense_id
SET @tbl_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defense_verifications'
);

SET @fk_name = IF(
  @tbl_exists = 1,
  (
    SELECT kcu.CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE kcu
    WHERE kcu.TABLE_SCHEMA = DATABASE()
      AND kcu.TABLE_NAME = 'defense_verifications'
      AND kcu.COLUMN_NAME = 'defense_id'
      AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      AND kcu.REFERENCED_TABLE_NAME <> 'defenses'
    LIMIT 1
  ),
  NULL
);

SET @sql = IF(
  @fk_name IS NOT NULL,
  CONCAT('ALTER TABLE defense_verifications DROP FOREIGN KEY ', @fk_name),
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists = IF(
  @tbl_exists = 1,
  (
    SELECT COUNT(*)
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'defense_verifications'
      AND COLUMN_NAME = 'defense_id'
      AND REFERENCED_TABLE_NAME = 'defenses'
  ),
  1
);

SET @sql = IF(
  @tbl_exists = 1 AND @fk_exists = 0,
  'ALTER TABLE defense_verifications ADD CONSTRAINT fk_defense_verifications_defense_id FOREIGN KEY (defense_id) REFERENCES defenses(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
