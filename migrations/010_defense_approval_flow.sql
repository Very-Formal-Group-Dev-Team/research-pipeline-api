-- Migration 010: Defense approval flow — add modality, expand status enum, expand notification types

-- 1. Expand defense status enum to support approval workflow
ALTER TABLE defenses
MODIFY COLUMN status ENUM('scheduled', 'completed', 'cancelled', 'rescheduled', 'pending', 'approved', 'moved', 'rejected') NOT NULL DEFAULT 'scheduled';

-- 2. Add modality column (Online / Face-to-Face)
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'defenses' AND COLUMN_NAME = 'modality');
SET @sql = IF(@col_exists = 0, "ALTER TABLE defenses ADD COLUMN modality VARCHAR(50) DEFAULT 'Online'", 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3. Expand notification type enum to include defense_approved, defense_rejected, defense_moved
ALTER TABLE notifications
MODIFY COLUMN type ENUM('invitation', 'schedule', 'defense_approved', 'defense_rejected', 'defense_moved') NOT NULL;
