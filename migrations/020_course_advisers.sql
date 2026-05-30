-- Migration 020: Direct course–adviser assignments (independent of project_members)
-- Do NOT ALTER users.id — existing FKs (e.g. project_members) use the server default collation.
-- courses.id uses utf8mb4_unicode_ci (migration 009); users.id typically uses utf8mb4_0900_ai_ci on MySQL 8.

CREATE TABLE IF NOT EXISTS course_advisers (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  course_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_course_advisers_course_user (course_id, user_id),
  CONSTRAINT course_advisers_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  CONSTRAINT course_advisers_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'course_advisers' AND INDEX_NAME = 'idx_course_advisers_course'
);
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_course_advisers_course ON course_advisers (course_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'course_advisers' AND INDEX_NAME = 'idx_course_advisers_user'
);
SET @sql = IF(@idx_exists = 0, 'CREATE INDEX idx_course_advisers_user ON course_advisers (user_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
