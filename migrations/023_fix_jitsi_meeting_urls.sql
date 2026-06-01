-- Normalize legacy local Jitsi URLs (http://localhost:8000 → https://localhost:8443)

SET @has_defenses_url = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND COLUMN_NAME = 'meeting_url'
);

SET @sql = IF(
  @has_defenses_url > 0,
  "UPDATE defenses
   SET meeting_url = REPLACE(meeting_url, 'http://localhost:8000', 'https://localhost:8443')
   WHERE meeting_url LIKE 'http://localhost:8000%'",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_meetings_url = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings' AND COLUMN_NAME = 'meeting_url'
);

SET @sql = IF(
  @has_meetings_url > 0,
  "UPDATE meetings
   SET meeting_url = REPLACE(meeting_url, 'http://localhost:8000', 'https://localhost:8443')
   WHERE meeting_url LIKE 'http://localhost:8000%'",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
