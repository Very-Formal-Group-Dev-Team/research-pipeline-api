-- Migration 038: Separate gated audio track and background transcription status.

ALTER TABLE meeting_recordings
  ADD COLUMN audio_url VARCHAR(512) NULL AFTER file_url,
  ADD COLUMN transcription_status ENUM('pending', 'processing', 'completed', 'failed', 'skipped') NOT NULL DEFAULT 'pending' AFTER status,
  ADD COLUMN transcription_error VARCHAR(512) NULL AFTER transcription_status;
