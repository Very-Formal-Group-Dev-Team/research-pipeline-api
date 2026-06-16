-- Migration 042: Notification type for new paper version commits.

ALTER TABLE notifications
  MODIFY COLUMN type ENUM(
    'invitation',
    'schedule',
    'defense_approved',
    'defense_rejected',
    'defense_moved',
    'event',
    'project_stage_updated',
    'join_request',
    'member_left',
    'ownership_transferred',
    'paper_version_committed'
  ) NOT NULL;
