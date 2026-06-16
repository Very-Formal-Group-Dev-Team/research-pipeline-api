-- Migration 043: Paper review requests and related notification types.

CREATE TABLE IF NOT EXISTS paper_review_requests (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  project_id CHAR(36) NOT NULL,
  paper_version_id CHAR(36) NOT NULL,
  requested_by CHAR(36) NOT NULL,
  note TEXT DEFAULT NULL,
  status ENUM('pending', 'reviewed', 'withdrawn', 'superseded') NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by CHAR(36) DEFAULT NULL,
  reviewed_at DATETIME DEFAULT NULL,
  withdrawn_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_paper_review_requests_project_status (project_id, status),
  KEY idx_paper_review_requests_version (paper_version_id),
  CONSTRAINT paper_review_requests_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT paper_review_requests_paper_version_id_fkey
    FOREIGN KEY (paper_version_id) REFERENCES paper_versions(id) ON DELETE CASCADE,
  CONSTRAINT paper_review_requests_requested_by_fkey
    FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT paper_review_requests_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
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
    'ownership_transferred',
    'paper_version_committed',
    'review_requested',
    'review_completed'
  ) NOT NULL;
