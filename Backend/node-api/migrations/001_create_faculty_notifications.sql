-- Migration: create faculty_notifications table

CREATE TABLE IF NOT EXISTS faculty_notifications (
  id SERIAL PRIMARY KEY,
  faculty_id INTEGER NOT NULL,
  title TEXT,
  description TEXT,
  severity TEXT DEFAULT 'medium',
  missing_fields JSONB,
  issues JSONB,
  is_resolved BOOLEAN DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS faculty_notifications_faculty_id_idx ON faculty_notifications(faculty_id);
CREATE INDEX IF NOT EXISTS faculty_notifications_is_resolved_idx ON faculty_notifications(is_resolved);
