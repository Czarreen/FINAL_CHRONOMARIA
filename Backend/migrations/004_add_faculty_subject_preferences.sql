CREATE TABLE IF NOT EXISTS public.faculty_subject_tags (
  faculty_id INTEGER NOT NULL REFERENCES public.faculty(faculty_id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES public.subjects(subject_id) ON DELETE CASCADE,
  priority_level SMALLINT NOT NULL DEFAULT 2 CHECK (priority_level BETWEEN 1 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT faculty_subject_tags_pkey PRIMARY KEY (faculty_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_faculty_subject_tags_faculty_id
  ON public.faculty_subject_tags (faculty_id);

CREATE INDEX IF NOT EXISTS idx_faculty_subject_tags_subject_id
  ON public.faculty_subject_tags (subject_id);