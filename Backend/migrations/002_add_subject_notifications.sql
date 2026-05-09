-- Migration: Add subject notifications view, refresh function, triggers, and backfill

BEGIN;

-- Create convenience view selecting subject notifications from the global table
CREATE OR REPLACE VIEW public.subject_notifications AS
SELECT * FROM public.data_quality_notifications WHERE entity_type = 'subject';

-- Refresh function: recompute notifications for a single subject
CREATE OR REPLACE FUNCTION public.refresh_subject_notifications(p_subject_id BIGINT)
RETURNS VOID LANGUAGE plpgsql AS
$$
DECLARE
    s_rec RECORD;
    missingFields TEXT[] := ARRAY[]::TEXT[];
    issues JSONB := '[]'::JSONB;
BEGIN
    -- remove existing cached notifications for this subject
    DELETE FROM public.data_quality_notifications
    WHERE entity_type = 'subject' AND entity_id = p_subject_id;

    SELECT * INTO s_rec FROM public.subjects WHERE subject_id = p_subject_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- missing code
    IF s_rec.subject_code IS NULL OR trim(coalesce(s_rec.subject_code, '')) = '' THEN
        INSERT INTO public.data_quality_notifications(entity_type, entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES('subject', p_subject_id, 'subject_code', 'missing', 'high', 'Missing subject code', jsonb_build_object('subject_id', p_subject_id), now(), now());
    END IF;

    -- missing title
    IF s_rec.subject_descriptive_title IS NULL OR trim(coalesce(s_rec.subject_descriptive_title, '')) = '' THEN
        INSERT INTO public.data_quality_notifications(entity_type, entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES('subject', p_subject_id, 'subject_descriptive_title', 'missing', 'high', 'Missing descriptive title', jsonb_build_object('subject_id', p_subject_id), now(), now());
    END IF;

    -- units
    IF s_rec.subject_units IS NULL OR s_rec.subject_units <= 0 THEN
        INSERT INTO public.data_quality_notifications(entity_type, entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES('subject', p_subject_id, 'subject_units', 'missing', 'high', 'Units not set or zero', jsonb_build_object('subject_id', p_subject_id), now(), now());
    END IF;

    -- schedule/room checks
    IF (s_rec.mth_schedule IS NULL OR trim(coalesce(s_rec.mth_schedule, '')) = '') AND (s_rec.tfs_schedule IS NULL OR trim(coalesce(s_rec.tfs_schedule, '')) = '') THEN
        INSERT INTO public.data_quality_notifications(entity_type, entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES('subject', p_subject_id, 'schedule', 'missing', 'medium', 'No schedule set (MTH/TFS)', jsonb_build_object('subject_id', p_subject_id), now(), now());
    END IF;

    IF (s_rec.mth_schedule IS NOT NULL AND trim(coalesce(s_rec.mth_schedule, '')) <> '') AND (s_rec.mth_room IS NULL OR trim(coalesce(s_rec.mth_room, '')) = '') THEN
        INSERT INTO public.data_quality_notifications(entity_type, entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES('subject', p_subject_id, 'mth_room', 'missing', 'medium', 'Missing room assignment for MTH schedule', jsonb_build_object('subject_id', p_subject_id), now(), now());
    END IF;

    IF (s_rec.tfs_schedule IS NOT NULL AND trim(coalesce(s_rec.tfs_schedule, '')) <> '') AND (s_rec.tfs_room IS NULL OR trim(coalesce(s_rec.tfs_room, '')) = '') THEN
        INSERT INTO public.data_quality_notifications(entity_type, entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES('subject', p_subject_id, 'tfs_room', 'missing', 'medium', 'Missing room assignment for TFS schedule', jsonb_build_object('subject_id', p_subject_id), now(), now());
    END IF;

END;
$$;

-- Trigger wrapper
CREATE OR REPLACE FUNCTION public.trg_refresh_subject_notifications()
RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
    PERFORM public.refresh_subject_notifications(COALESCE(NEW.subject_id, OLD.subject_id));
    RETURN NULL;
END;
$$;

-- Attach trigger to subjects table
DROP TRIGGER IF EXISTS trg_refresh_subjects ON public.subjects;
CREATE TRIGGER trg_refresh_subjects
AFTER INSERT OR UPDATE OR DELETE ON public.subjects
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_subject_notifications();

-- Backfill helper
CREATE OR REPLACE FUNCTION public.refresh_all_subject_notifications()
RETURNS void LANGUAGE plpgsql AS
$$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT subject_id FROM public.subjects LOOP
        PERFORM public.refresh_subject_notifications(r.subject_id);
    END LOOP;
END;
$$;

COMMIT;

-- Usage: SELECT public.refresh_all_subject_notifications();
