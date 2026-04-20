-- Add 'pending' to defenses status ENUM and add blocked_by column for pending tracking
ALTER TABLE defenses
  MODIFY COLUMN status ENUM('scheduled','pending','completed','cancelled','rescheduled') NOT NULL DEFAULT 'scheduled',
  ADD COLUMN blocked_by CHAR(36) DEFAULT NULL;
