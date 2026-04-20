-- Migration 007: Paper version control system
-- Tracks every revision of a project's research paper document (like Git commits).

CREATE TABLE IF NOT EXISTS paper_versions (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  project_id CHAR(36) NOT NULL,
  version_number INT NOT NULL DEFAULT 1,
  file_url TEXT NOT NULL,
  file_name VARCHAR(512) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  mime_type VARCHAR(255) DEFAULT NULL,
  commit_message TEXT NOT NULL,
  tag VARCHAR(255) DEFAULT NULL,
  uploaded_by CHAR(36) NOT NULL,
  is_generated TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT paper_versions_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT paper_versions_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
