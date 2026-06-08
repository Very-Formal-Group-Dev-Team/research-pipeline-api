-- Migration 037: Meeting/defense recordings and archived transcriptions with video sync.

CREATE TABLE IF NOT EXISTS meeting_recordings (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  schedule_id CHAR(36) NOT NULL,
  schedule_source ENUM('defense', 'meeting') NOT NULL,
  file_url VARCHAR(512) NULL,
  file_size BIGINT NULL,
  duration_ms INT NULL,
  mime_type VARCHAR(128) NOT NULL DEFAULT 'video/webm',
  recorded_by CHAR(36) NOT NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  status ENUM('recording', 'completed', 'failed') NOT NULL DEFAULT 'recording',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_meeting_recordings_schedule (schedule_id, schedule_source, recorded_at),
  CONSTRAINT meeting_recordings_recorded_by_fkey
    FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS meeting_transcription_archives (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  recording_id CHAR(36) NOT NULL,
  schedule_id CHAR(36) NOT NULL,
  schedule_source ENUM('defense', 'meeting') NOT NULL,
  full_text TEXT NOT NULL,
  language VARCHAR(16) NULL,
  transcribed_by CHAR(36) NULL,
  transcribed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meeting_transcription_archives_recording (recording_id),
  CONSTRAINT meeting_transcription_archives_recording_fkey
    FOREIGN KEY (recording_id) REFERENCES meeting_recordings(id) ON DELETE CASCADE,
  CONSTRAINT meeting_transcription_archives_transcribed_by_fkey
    FOREIGN KEY (transcribed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

ALTER TABLE meeting_transcription_segments
  ADD COLUMN recording_id CHAR(36) NULL AFTER schedule_source,
  ADD KEY idx_meeting_transcription_segments_recording (recording_id);

ALTER TABLE defenses
  ADD COLUMN recording_id CHAR(36) NULL,
  ADD COLUMN transcription_id CHAR(36) NULL,
  ADD COLUMN recorded_at TIMESTAMP NULL;

ALTER TABLE meetings
  ADD COLUMN recording_id CHAR(36) NULL,
  ADD COLUMN transcription_id CHAR(36) NULL,
  ADD COLUMN recorded_at TIMESTAMP NULL;
