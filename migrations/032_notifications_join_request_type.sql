-- Migration 032: Notification type for student join requests awaiting leader approval.

ALTER TABLE notifications
  MODIFY COLUMN type ENUM(
    'invitation',
    'schedule',
    'defense_approved',
    'defense_rejected',
    'defense_moved',
    'event',
    'project_stage_updated',
    'join_request'
  ) NOT NULL;
