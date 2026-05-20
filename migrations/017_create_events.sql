-- Institution calendar events (coordinator-managed, separate from defenses/meetings)
-- Note: institutions.id uses utf8mb4_unicode_ci; users.id uses the server default (often utf8mb4_0900_ai_ci).

CREATE TABLE IF NOT EXISTS events (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  institution_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  location VARCHAR(512) NOT NULL,
  modality ENUM('Online', 'In-Person', 'Hybrid') NOT NULL DEFAULT 'Online',
  status ENUM('scheduled', 'cancelled', 'completed') NOT NULL DEFAULT 'scheduled',
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_events_institution_start (institution_id, start_time),
  KEY idx_events_status (status),
  KEY idx_events_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Align columns if table already existed from a failed run
SET @events_table_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'events'
);

SET @sql_events_collation := IF(
  @events_table_exists > 0,
  'ALTER TABLE events
     MODIFY COLUMN id CHAR(36) NOT NULL DEFAULT (UUID()),
     MODIFY COLUMN institution_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
     MODIFY COLUMN created_by CHAR(36) NOT NULL',
  'SELECT 1'
);

PREPARE stmt_events_collation FROM @sql_events_collation;
EXECUTE stmt_events_collation;
DEALLOCATE PREPARE stmt_events_collation;

-- FK: events.institution_id → institutions (conditional)
SET @fk_events_institution := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'events'
    AND CONSTRAINT_NAME = 'events_institution_id_fkey'
);

SET @sql_events_institution := IF(
  @fk_events_institution = 0,
  'ALTER TABLE events ADD CONSTRAINT events_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE',
  'SELECT 1'
);

PREPARE stmt_events_institution FROM @sql_events_institution;
EXECUTE stmt_events_institution;
DEALLOCATE PREPARE stmt_events_institution;

-- FK: events.created_by → users (conditional)
SET @fk_events_created_by := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'events'
    AND CONSTRAINT_NAME = 'events_created_by_fkey'
);

SET @sql_events_created_by := IF(
  @fk_events_created_by = 0,
  'ALTER TABLE events ADD CONSTRAINT events_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE',
  'SELECT 1'
);

PREPARE stmt_events_created_by FROM @sql_events_created_by;
EXECUTE stmt_events_created_by;
DEALLOCATE PREPARE stmt_events_created_by;

-- Extend notification types for calendar events
SET @has_event_type := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'type'
    AND COLUMN_TYPE LIKE '%event%'
);

SET @sql_event_type := IF(
  @has_event_type = 0,
  "ALTER TABLE notifications MODIFY COLUMN type ENUM('invitation','schedule','defense_approved','defense_rejected','defense_moved','event') NOT NULL",
  'SELECT 1'
);

PREPARE stmt_event_type FROM @sql_event_type;
EXECUTE stmt_event_type;
DEALLOCATE PREPARE stmt_event_type;
