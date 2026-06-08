-- Migration 036: Remove WiFi/device-token gate table (gate is now USB serial on room PC).

DROP TABLE IF EXISTS meeting_transcription_devices;
