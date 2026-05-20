-- Enhance faculty_subject_tags table: convert subject_id to subject_tag (text)
-- This preserves historical data when subjects table is cleared/rebuilt during semester updates
-- Uses subject code as the tag for history and audit trail purposes

-- Create or replace the function for updating the updated_at timestamp
CREATE OR REPLACE FUNCTION update_faculty_subject_tags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 1: Drop the trigger first to avoid conflicts
DROP TRIGGER IF EXISTS faculty_subject_tags_updated_at_trigger ON public.faculty_subject_tags;

-- Step 2: Drop old constraints and indexes if they exist
ALTER TABLE public.faculty_subject_tags
DROP CONSTRAINT IF EXISTS faculty_subject_tags_faculty_id_fkey;

ALTER TABLE public.faculty_subject_tags
DROP CONSTRAINT IF EXISTS faculty_subject_tags_subject_id_fkey;

ALTER TABLE public.faculty_subject_tags
DROP CONSTRAINT IF EXISTS faculty_subject_tags_priority_level_check;

DROP INDEX IF EXISTS public.idx_faculty_subject_tags_subject_id;

-- Step 3: Drop old primary key if it exists
ALTER TABLE public.faculty_subject_tags
DROP CONSTRAINT IF EXISTS faculty_subject_tags_pkey;

-- Step 4: Drop the subject_id column if it exists
ALTER TABLE public.faculty_subject_tags
DROP COLUMN IF EXISTS subject_id;

-- Step 5: Add subject_tag column (text) if not exists
ALTER TABLE public.faculty_subject_tags
ADD COLUMN IF NOT EXISTS subject_tag TEXT NOT NULL DEFAULT '';

-- Step 6: Set new primary key on (faculty_id, subject_tag)
ALTER TABLE public.faculty_subject_tags
ADD CONSTRAINT faculty_subject_tags_pkey PRIMARY KEY (faculty_id, subject_tag);

-- Step 7: Add foreign key constraint for faculty_id
ALTER TABLE public.faculty_subject_tags
ADD CONSTRAINT faculty_subject_tags_faculty_id_fkey 
  FOREIGN KEY (faculty_id) REFERENCES public.faculty(faculty_id) ON DELETE CASCADE;

-- Step 8: Add check constraint for priority_level (1, 2, or 3)
ALTER TABLE public.faculty_subject_tags
ADD CONSTRAINT faculty_subject_tags_priority_level_check 
  CHECK ((priority_level = ANY (ARRAY[1, 2, 3])));

-- Step 9: Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_faculty_subject_tags_faculty_id 
  ON public.faculty_subject_tags USING BTREE (faculty_id) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_faculty_subject_tags_subject_tag 
  ON public.faculty_subject_tags USING BTREE (subject_tag) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_faculty_subject_tags_priority 
  ON public.faculty_subject_tags USING BTREE (priority_level) TABLESPACE pg_default;

-- Step 10: Create or replace trigger for updated_at
CREATE TRIGGER faculty_subject_tags_updated_at_trigger 
BEFORE UPDATE ON public.faculty_subject_tags 
FOR EACH ROW 
EXECUTE FUNCTION update_faculty_subject_tags_updated_at();
