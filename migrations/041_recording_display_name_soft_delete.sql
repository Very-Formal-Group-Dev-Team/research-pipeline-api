-- Migration 041: User-facing recording labels and soft delete for undo restore.

ALTER TABLE meeting_recordings
  ADD COLUMN display_name VARCHAR(255) NULL AFTER mime_type,
  ADD COLUMN deleted_at TIMESTAMP NULL AFTER updated_at,
  ADD KEY idx_meeting_recordings_deleted (deleted_at);
