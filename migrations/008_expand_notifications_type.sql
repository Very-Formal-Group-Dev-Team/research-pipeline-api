ALTER TABLE notifications
  MODIFY COLUMN type ENUM('invitation', 'schedule') NOT NULL;
