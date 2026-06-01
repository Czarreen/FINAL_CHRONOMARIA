-- Migration: replace subject_notifications view with an editable cache table

BEGIN;

DROP VIEW IF EXISTS public.subject_notifications;

CREATE TABLE IF NOT EXISTS public.subject_notifications (
    id BIGSERIAL PRIMARY KEY,
    entity_id BIGINT NOT NULL,
    field_name TEXT,
    issue_type TEXT,
    severity TEXT,
    message TEXT,
    details JSONB,
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subject_notifications_entity_id ON public.subject_notifications(entity_id);
CREATE INDEX IF NOT EXISTS idx_subject_notifications_resolved ON public.subject_notifications(is_resolved);

CREATE OR REPLACE FUNCTION public.refresh_subject_notifications(p_subject_id BIGINT)
RETURNS VOID LANGUAGE plpgsql AS
$$
DECLARE
    s_rec RECORD;
BEGIN
    DELETE FROM public.subject_notifications
    WHERE entity_id = p_subject_id;

    SELECT * INTO s_rec FROM public.subjects WHERE subject_id = p_subject_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF s_rec.subject_code IS NULL OR trim(coalesce(s_rec.subject_code, '')) = '' THEN
        INSERT INTO public.subject_notifications(entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES(p_subject_id, 'subject_code', 'missing', 'high', 'Missing subject code', jsonb_build_object('subject_id', p_subject_id), now(), now());
    END IF;

    IF s_rec.subject_descriptive_title IS NULL OR trim(coalesce(s_rec.subject_descriptive_title, '')) = '' THEN
        INSERT INTO public.subject_notifications(entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES(p_subject_id, 'subject_descriptive_title', 'missing', 'high', 'Missing descriptive title', jsonb_build_object('subject_id', p_subject_id), now(), now());
    END IF;

    IF s_rec.subject_units IS NULL OR s_rec.subject_units <= 0 THEN
        INSERT INTO public.subject_notifications(entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES(p_subject_id, 'subject_units', 'missing', 'high', 'Units not set or zero', jsonb_build_object('subject_id', p_subject_id), now(), now());
    END IF;

    IF (s_rec.mth_schedule IS NULL OR trim(coalesce(s_rec.mth_schedule, '')) = '') AND (s_rec.tfs_schedule IS NULL OR trim(coalesce(s_rec.tfs_schedule, '')) = '') THEN
        INSERT INTO public.subject_notifications(entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES(p_subject_id, 'schedule', 'missing', 'medium', 'No schedule set (MTH/TFS)', jsonb_build_object('subject_id', p_subject_id), now(), now());
    END IF;

    IF (s_rec.mth_schedule IS NOT NULL AND trim(coalesce(s_rec.mth_schedule, '')) <> '') AND (s_rec.mth_room IS NULL OR trim(coalesce(s_rec.mth_room, '')) = '') THEN
        INSERT INTO public.subject_notifications(entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES(p_subject_id, 'mth_room', 'missing', 'medium', 'Missing room assignment for MTH schedule', jsonb_build_object('subject_id', p_subject_id), now(), now());
    END IF;

    IF (s_rec.tfs_schedule IS NOT NULL AND trim(coalesce(s_rec.tfs_schedule, '')) <> '') AND (s_rec.tfs_room IS NULL OR trim(coalesce(s_rec.tfs_room, '')) = '') THEN
        INSERT INTO public.subject_notifications(entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES(p_subject_id, 'tfs_room', 'missing', 'medium', 'Missing room assignment for TFS schedule', jsonb_build_object('subject_id', p_subject_id), now(), now());
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_subject_notifications()
RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
    PERFORM public.refresh_subject_notifications(COALESCE(NEW.subject_id, OLD.subject_id));
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_subjects ON public.subjects;
CREATE TRIGGER trg_refresh_subjects
AFTER INSERT OR UPDATE OR DELETE ON public.subjects
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_subject_notifications();

CREATE OR REPLACE FUNCTION public.refresh_all_subject_notifications()
RETURNS void LANGUAGE plpgsql AS
$$
DECLARE
    r RECORD;
BEGIN
    DELETE FROM public.subject_notifications;
    FOR r IN SELECT subject_id FROM public.subjects LOOP
        PERFORM public.refresh_subject_notifications(r.subject_id);
    END LOOP;
END;
$$;

-- Backfill current rows into the new table.
SELECT public.refresh_all_subject_notifications();

COMMIT;
