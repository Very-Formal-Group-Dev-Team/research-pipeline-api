-- Migration 053: Institution-wide sections catalog and project section FK

CREATE TABLE IF NOT EXISTS institution_sections (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    institution_id CHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
    UNIQUE KEY uq_institution_sections_name (institution_id, name),
    INDEX idx_institution_sections_institution (institution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'section_id'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE projects ADD COLUMN section_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER section',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'projects'
    AND CONSTRAINT_NAME = 'fk_projects_section'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql = IF(
  @fk_exists = 0,
  'ALTER TABLE projects ADD CONSTRAINT fk_projects_section FOREIGN KEY (section_id) REFERENCES institution_sections(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND INDEX_NAME = 'idx_projects_section'
);
SET @sql = IF(
  @idx_exists = 0,
  'ALTER TABLE projects ADD INDEX idx_projects_section (section_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill catalog entries from distinct legacy free-text section values
INSERT IGNORE INTO institution_sections (id, institution_id, name, code, is_active, created_at, updated_at)
SELECT UUID(), p.institution_id, TRIM(p.section), NULL, 1, NOW(), NOW()
FROM projects p
WHERE p.institution_id IS NOT NULL
  AND TRIM(IFNULL(p.section, '')) != ''
GROUP BY p.institution_id, LOWER(TRIM(p.section));

-- Link projects to catalog rows where names match
UPDATE projects p
INNER JOIN institution_sections s
  ON s.institution_id = p.institution_id
 AND LOWER(TRIM(s.name)) COLLATE utf8mb4_unicode_ci = LOWER(TRIM(p.section)) COLLATE utf8mb4_unicode_ci
SET p.section_id = s.id
WHERE p.section_id IS NULL
  AND TRIM(IFNULL(p.section, '')) != '';
