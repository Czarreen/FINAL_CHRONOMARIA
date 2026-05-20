-- Base table creation for faculty_subject_tags
-- Stores the subject preferences for faculty members with priority levels
-- Note: This table is referenced in the db schema. If upgrading from existing schema,
-- see migration 007_enhance_faculty_subject_tags.sql for adding constraints and indexes.

CREATE TABLE IF NOT EXISTS public.faculty_subject_tags (
  faculty_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  priority_level SMALLINT NOT NULL DEFAULT 2,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT faculty_subject_tags_pkey PRIMARY KEY (faculty_id, subject_id)
);
