-- Migration 033: Audit log for project ownership transfers and leave-related notifications.

CREATE TABLE IF NOT EXISTS project_audit_log (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  project_id CHAR(36) NOT NULL,
  action VARCHAR(64) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  target_user_id CHAR(36) DEFAULT NULL,
  metadata JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT project_audit_log_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT project_audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES users(id),
  CONSTRAINT project_audit_log_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES users(id)
);

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
    'ownership_transferred'
  ) NOT NULL;
