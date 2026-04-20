-- Migration 004: Add project_files table for uploaded documents attached to projects.

CREATE TABLE IF NOT EXISTS project_files (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  project_id CHAR(36) NOT NULL,
  file_url TEXT NOT NULL,
  file_name VARCHAR(512) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  mime_type VARCHAR(255) DEFAULT NULL,
  uploaded_by CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT project_files_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT project_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
