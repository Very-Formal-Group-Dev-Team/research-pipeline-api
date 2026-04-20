-- Migration 011: Ensure defenses.scheduled_at exists for coordinator/defense flows

SET @has_scheduled_at = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
    AND COLUMN_NAME = 'scheduled_at'
);

SET @sql = IF(
  @has_scheduled_at = 0,
  'ALTER TABLE defenses ADD COLUMN scheduled_at DATETIME NULL AFTER defense_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_verified_schedule = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
    AND COLUMN_NAME = 'verified_schedule'
);

SET @has_proposed_schedule = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'defenses'
    AND COLUMN_NAME = 'proposed_schedule'
);

SET @fill_expr = CASE
  WHEN @has_verified_schedule > 0 AND @has_proposed_schedule > 0 THEN 'COALESCE(verified_schedule, proposed_schedule, created_at)'
  WHEN @has_verified_schedule > 0 THEN 'COALESCE(verified_schedule, created_at)'
  WHEN @has_proposed_schedule > 0 THEN 'COALESCE(proposed_schedule, created_at)'
  ELSE 'created_at'
END;

SET @sql = CONCAT(
  'UPDATE defenses SET scheduled_at = ',
  @fill_expr,
  ' WHERE scheduled_at IS NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Keep shape compatible with existing service queries and inserts.
ALTER TABLE defenses
MODIFY COLUMN scheduled_at DATETIME NOT NULL;
