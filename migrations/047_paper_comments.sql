-- Migration 047: Inline manuscript comments on paper versions.

CREATE TABLE IF NOT EXISTS paper_comments (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  project_id CHAR(36) NOT NULL,
  anchor_version_id CHAR(36) NOT NULL,
  review_request_id CHAR(36) DEFAULT NULL,
  parent_id CHAR(36) DEFAULT NULL,
  author_id CHAR(36) NOT NULL,
  body TEXT NOT NULL,
  anchor_json JSON NOT NULL,
  plain_text_hash VARCHAR(64) DEFAULT NULL,
  status ENUM('open', 'resolved', 'needs_revision') NOT NULL DEFAULT 'open',
  resolved_by CHAR(36) DEFAULT NULL,
  resolved_at DATETIME DEFAULT NULL,
  revision_requested_by CHAR(36) DEFAULT NULL,
  revision_requested_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_paper_comments_project_status (project_id, status),
  KEY idx_paper_comments_anchor_version (anchor_version_id),
  KEY idx_paper_comments_review_request (review_request_id),
  KEY idx_paper_comments_parent (parent_id),
  CONSTRAINT paper_comments_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT paper_comments_anchor_version_id_fkey
    FOREIGN KEY (anchor_version_id) REFERENCES paper_versions(id) ON DELETE CASCADE,
  CONSTRAINT paper_comments_review_request_id_fkey
    FOREIGN KEY (review_request_id) REFERENCES paper_review_requests(id) ON DELETE SET NULL,
  CONSTRAINT paper_comments_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES paper_comments(id) ON DELETE CASCADE,
  CONSTRAINT paper_comments_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES users(id),
  CONSTRAINT paper_comments_resolved_by_fkey
    FOREIGN KEY (resolved_by) REFERENCES users(id),
  CONSTRAINT paper_comments_revision_requested_by_fkey
    FOREIGN KEY (revision_requested_by) REFERENCES users(id)
);
