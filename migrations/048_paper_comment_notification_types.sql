-- Migration 048: Notification types for inline manuscript comments.

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
    'paper_version_committed',
    'review_requested',
    'review_completed',
    'project_updated',
    'comment_added',
    'comment_resolved',
    'revision_requested'
  ) NOT NULL;
