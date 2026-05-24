-- Migration: add soft-delete fields to faculty_teaching_history
-- Supports removing a history entry without losing the audit trail.

ALTER TABLE IF EXISTS faculty_teaching_history
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS faculty_teaching_history
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS faculty_teaching_history
  ADD COLUMN IF NOT EXISTS deleted_by TEXT;

CREATE INDEX IF NOT EXISTS faculty_teaching_history_is_deleted_idx
  ON faculty_teaching_history (is_deleted, created_at DESC, id DESC);
