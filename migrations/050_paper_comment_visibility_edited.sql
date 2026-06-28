-- Migration 050: Per-comment visibility and body edit timestamp.

ALTER TABLE paper_comments
  ADD COLUMN visibility ENUM('adviser', 'team') NOT NULL DEFAULT 'adviser',
  ADD COLUMN edited_at DATETIME DEFAULT NULL;
