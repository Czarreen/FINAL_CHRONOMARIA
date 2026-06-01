-- Migration: mark subjects that are general / out of SEAIT scope

BEGIN;

ALTER TABLE public.subjects
ADD COLUMN IF NOT EXISTS is_general BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;