-- Migration 009: Institutions, courses, coordinator role, defense verification
-- All conditional DDL uses information_schema + PREPARE/EXECUTE for MySQL 8.0 compatibility
-- (MySQL 8.0 does NOT support ADD COLUMN IF NOT EXISTS or ADD INDEX IF NOT EXISTS)

-- 1. Add coordinator role to user_roles enum
ALTER TABLE user_roles
MODIFY COLUMN role ENUM('student', 'adviser', 'panelist', 'admin', 'coordinator') NOT NULL;

-- 2. Create institutions table
CREATE TABLE IF NOT EXISTS institutions (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Create courses table
CREATE TABLE IF NOT EXISTS courses (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    institution_id CHAR(36) NOT NULL,
    course_name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE,
    INDEX idx_courses_institution (institution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Ensure institution_id column on user_roles has matching charset/collation
ALTER TABLE user_roles
MODIFY COLUMN institution_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 5. FK: user_roles → institutions (conditional)
SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'user_roles' AND CONSTRAINT_NAME = 'fk_user_roles_institution' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @sql = IF(@fk_exists = 0, 'ALTER TABLE user_roles ADD CONSTRAINT fk_user_roles_institution FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. Add institution_id column to projects (conditional)
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'institution_id');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE projects ADD COLUMN institution_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 7. Add course_id column to projects (conditional)
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'course_id');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE projects ADD COLUMN course_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 7a. Ensure projects.institution_id and course_id have matching charset/collation
ALTER TABLE projects
MODIFY COLUMN institution_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE projects
MODIFY COLUMN course_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 8. FK: projects.institution_id → institutions (conditional)
SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND CONSTRAINT_NAME = 'fk_projects_institution' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @sql = IF(@fk_exists = 0, 'ALTER TABLE projects ADD CONSTRAINT fk_projects_institution FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 9. FK: projects.course_id → courses (conditional)
SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND CONSTRAINT_NAME = 'fk_projects_course' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @sql = IF(@fk_exists = 0, 'ALTER TABLE projects ADD CONSTRAINT fk_projects_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 10. Index: projects.institution_id (conditional)
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND INDEX_NAME = 'idx_projects_institution');
SET @sql = IF(@idx_exists = 0, 'ALTER TABLE projects ADD INDEX idx_projects_institution (institution_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 11. Index: projects.course_id (conditional)
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND INDEX_NAME = 'idx_projects_course');
SET @sql = IF(@idx_exists = 0, 'ALTER TABLE projects ADD INDEX idx_projects_course (course_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 12. Add verified_by column to defenses (conditional)
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND COLUMN_NAME = 'verified_by');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE defenses ADD COLUMN verified_by CHAR(36)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 13. Add verified_at column to defenses (conditional)
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND COLUMN_NAME = 'verified_at');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE defenses ADD COLUMN verified_at DATETIME', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 14. Add venue column to defenses (conditional)
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND COLUMN_NAME = 'venue');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE defenses ADD COLUMN venue VARCHAR(255)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 15. Add proposed_schedule column to defenses (conditional)
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND COLUMN_NAME = 'proposed_schedule');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE defenses ADD COLUMN proposed_schedule DATETIME', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 16. Add verified_schedule column to defenses (conditional)
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND COLUMN_NAME = 'verified_schedule');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE defenses ADD COLUMN verified_schedule DATETIME', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 17. FK: defenses.verified_by → users (conditional)
SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND CONSTRAINT_NAME = 'fk_defenses_verified_by' AND CONSTRAINT_TYPE = 'FOREIGN KEY');
SET @sql = IF(@fk_exists = 0, 'ALTER TABLE defenses ADD CONSTRAINT fk_defenses_verified_by FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 18. Index: defenses.verified_by (conditional)
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND INDEX_NAME = 'idx_defenses_verified_by');
SET @sql = IF(@idx_exists = 0, 'ALTER TABLE defenses ADD INDEX idx_defenses_verified_by (verified_by)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 19. Create defense_verifications table
-- NOTE: No explicit CHARSET here — inherits database default to match defenses/users tables
CREATE TABLE IF NOT EXISTS defense_verifications (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    defense_id CHAR(36) NOT NULL,
    verified_by CHAR(36) NOT NULL,
    previous_schedule DATETIME,
    new_schedule DATETIME,
    previous_venue VARCHAR(255),
    new_venue VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (defense_id) REFERENCES defenses(id) ON DELETE CASCADE,
    FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_defense_verifications_defense (defense_id),
    INDEX idx_defense_verifications_verified_by (verified_by),
    INDEX idx_defense_verifications_created_at (created_at)
);