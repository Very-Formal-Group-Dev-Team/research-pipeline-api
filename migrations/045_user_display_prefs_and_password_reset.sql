-- Migration 045: User display preferences and password reset tokens.

ALTER TABLE users
  ADD COLUMN theme_preference VARCHAR(16) NULL DEFAULT NULL AFTER status_text,
  ADD COLUMN timezone VARCHAR(64) NULL DEFAULT NULL AFTER theme_preference;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token VARCHAR(128) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY prt_token_unique (token),
  CONSTRAINT prt_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
