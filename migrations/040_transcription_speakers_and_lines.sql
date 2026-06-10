-- Migration 040: Normalized speakers and edited transcript lines per recording.

CREATE TABLE IF NOT EXISTS meeting_transcription_speakers (
  id CHAR(36) NOT NULL,
  recording_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  color VARCHAR(16) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mt_speakers_recording (recording_id, sort_order),
  CONSTRAINT mt_speakers_recording_fkey
    FOREIGN KEY (recording_id) REFERENCES meeting_recordings(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS meeting_transcription_edit_lines (
  id CHAR(36) NOT NULL,
  recording_id CHAR(36) NOT NULL,
  text TEXT NOT NULL,
  speaker_id CHAR(36) NULL,
  start_ms INT NULL,
  end_ms INT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  source_segment_id CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mt_edit_lines_recording (recording_id, sort_order),
  CONSTRAINT mt_edit_lines_recording_fkey
    FOREIGN KEY (recording_id) REFERENCES meeting_recordings(id) ON DELETE CASCADE,
  CONSTRAINT mt_edit_lines_speaker_fkey
    FOREIGN KEY (speaker_id) REFERENCES meeting_transcription_speakers(id) ON DELETE SET NULL
) ENGINE=InnoDB;
