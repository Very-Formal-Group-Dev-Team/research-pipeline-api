-- Migration 039: Edited/annotated transcriptions with speaker assignments.

CREATE TABLE IF NOT EXISTS meeting_transcription_edits (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  recording_id CHAR(36) NOT NULL,
  edited_by CHAR(36) NOT NULL,
  content JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meeting_transcription_edits_recording (recording_id),
  CONSTRAINT meeting_transcription_edits_recording_fkey
    FOREIGN KEY (recording_id) REFERENCES meeting_recordings(id) ON DELETE CASCADE,
  CONSTRAINT meeting_transcription_edits_edited_by_fkey
    FOREIGN KEY (edited_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
