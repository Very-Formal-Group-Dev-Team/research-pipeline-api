-- Migration 039: Institution activation, programs catalog, project program FK

-- 1. Soft-enable institutions
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'institutions' AND COLUMN_NAME = 'is_active'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE institutions ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER code',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Programs per institution
CREATE TABLE IF NOT EXISTS programs (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    institution_id CHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    description TEXT,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
    UNIQUE KEY uq_programs_institution_code (institution_id, code),
    INDEX idx_programs_institution (institution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Link projects to programs (keep legacy program text column)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'program_id'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE projects ADD COLUMN program_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER program',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'projects'
    AND CONSTRAINT_NAME = 'fk_projects_program'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql = IF(
  @fk_exists = 0,
  'ALTER TABLE projects ADD CONSTRAINT fk_projects_program FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND INDEX_NAME = 'idx_projects_program'
);
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE projects ADD INDEX idx_projects_program (program_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
