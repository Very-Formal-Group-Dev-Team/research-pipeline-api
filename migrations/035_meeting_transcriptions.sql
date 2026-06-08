-- Migration 035: Meeting/defense transcription segments (USB serial mic gate on room PC).

CREATE TABLE IF NOT EXISTS meeting_transcription_segments (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  schedule_id CHAR(36) NOT NULL,
  schedule_source ENUM('defense', 'meeting') NOT NULL,
  device_key VARCHAR(64) NULL,
  text TEXT NOT NULL,
  start_ms INT NULL,
  end_ms INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_meeting_transcription_segments_schedule (schedule_id, schedule_source, created_at)
) ENGINE=InnoDB;
