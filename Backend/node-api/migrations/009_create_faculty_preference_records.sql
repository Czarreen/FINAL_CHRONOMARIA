-- Migration: create faculty_preference_records table
-- Stores append-only archive rows each time a faculty subject tag is saved.

CREATE TABLE IF NOT EXISTS faculty_preference_records (
  id BIGSERIAL PRIMARY KEY,
  faculty_id INTEGER NOT NULL,
  subject_tag TEXT NOT NULL,
  priority_level INTEGER NOT NULL DEFAULT 2,
  source_table TEXT NOT NULL DEFAULT 'faculty_subject_tags',
  record_action TEXT NOT NULL DEFAULT 'upsert',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF to_regclass('public.faculty_subject_tags') IS NOT NULL THEN
    INSERT INTO faculty_preference_records (
      faculty_id,
      subject_tag,
      priority_level,
      source_table,
      record_action,
      created_at
    )
    SELECT
      fst.faculty_id,
      fst.subject_tag,
      fst.priority_level,
      'faculty_subject_tags' AS source_table,
      'backfill' AS record_action,
      COALESCE(fst.created_at, NOW()) AS created_at
    FROM public.faculty_subject_tags fst
    WHERE NOT EXISTS (
      SELECT 1
      FROM faculty_preference_records fpr
      WHERE fpr.faculty_id = fst.faculty_id
        AND fpr.subject_tag = fst.subject_tag
        AND fpr.priority_level = fst.priority_level
        AND fpr.source_table = 'faculty_subject_tags'
    );
  END IF;
END $$;

DO $$
BEGIN
  DELETE FROM faculty_preference_records fpr
  USING faculty_preference_records keep_row
  WHERE fpr.faculty_id = keep_row.faculty_id
    AND fpr.subject_tag = keep_row.subject_tag
    AND (
      fpr.created_at < keep_row.created_at
      OR (fpr.created_at = keep_row.created_at AND fpr.id < keep_row.id)
    );
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS faculty_preference_records_faculty_subject_tag_uidx
  ON faculty_preference_records (faculty_id, subject_tag);

CREATE INDEX IF NOT EXISTS faculty_preference_records_faculty_id_idx
  ON faculty_preference_records (faculty_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS faculty_preference_records_subject_tag_idx
  ON faculty_preference_records (subject_tag);
