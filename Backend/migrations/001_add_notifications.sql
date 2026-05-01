-- Migration: Add data_quality_notifications and helpers for course offerings
-- Creates a cached notifications table, view for course_offering notifications,
-- a refresh function, triggers, and a backfill function.

BEGIN;

-- 1) Notifications table
CREATE TABLE IF NOT EXISTS public.data_quality_notifications (
    id BIGSERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id BIGINT NOT NULL,
    field_name TEXT,
    issue_type TEXT, -- e.g. "missing", "invalid", "mismatch"
    severity TEXT, -- e.g. "low", "medium", "high"
    message TEXT,
    details JSONB,
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dqn_entity ON public.data_quality_notifications(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_dqn_resolved ON public.data_quality_notifications(is_resolved);

-- 2) Convenience view: course_offering notifications
CREATE OR REPLACE VIEW public.course_offering_notifications AS
SELECT * FROM public.data_quality_notifications WHERE entity_type = 'course_offering';

-- 3) Refresh function (idempotent): recompute notifications for a single offering
CREATE OR REPLACE FUNCTION public.refresh_course_offering_notifications(p_offering_id BIGINT)
RETURNS VOID LANGUAGE plpgsql AS
$$
DECLARE
    v_mth_count INT := 0;
    v_tfs_count INT := 0;
    has_faculty BOOLEAN := FALSE;
    has_subject BOOLEAN := FALSE;
    has_mth_field BOOLEAN := FALSE;
    has_tfs_field BOOLEAN := FALSE;
    has_start_end BOOLEAN := FALSE;
    v_faculty TEXT;
    v_subject TEXT;
    v_mth_room TEXT;
    v_tfs_room TEXT;
    has_start BOOLEAN := FALSE;
    has_end BOOLEAN := FALSE;
    v_start_time_text TEXT;
    v_end_time_text TEXT;
BEGIN
    -- Remove existing cached notifications for this offering
    DELETE FROM public.data_quality_notifications
    WHERE entity_type = 'course_offering' AND entity_id = p_offering_id;

    -- Detect presence of optional columns to avoid runtime errors
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='course_offerings' AND column_name='faculty_id') INTO has_faculty;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='course_offerings' AND column_name='subject_id') INTO has_subject;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='course_offerings' AND column_name='mth_room_id') INTO has_mth_field;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='course_offerings' AND column_name='tfs_room_id') INTO has_tfs_field;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='course_offerings' AND column_name='start_time') INTO has_start;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='course_offerings' AND column_name='end_time') INTO has_end;
    has_start_end := (has_start AND has_end);

    -- Load optional scalar fields safely using dynamic SQL when present
    IF has_faculty THEN
        EXECUTE 'SELECT faculty_id::text FROM public.course_offerings WHERE id = $1' INTO v_faculty USING p_offering_id;
    END IF;
    IF has_subject THEN
        EXECUTE 'SELECT subject_id::text FROM public.course_offerings WHERE id = $1' INTO v_subject USING p_offering_id;
    END IF;
    IF has_mth_field THEN
        EXECUTE 'SELECT mth_room_id::text FROM public.course_offerings WHERE id = $1' INTO v_mth_room USING p_offering_id;
    END IF;
    IF has_tfs_field THEN
        EXECUTE 'SELECT tfs_room_id::text FROM public.course_offerings WHERE id = $1' INTO v_tfs_room USING p_offering_id;
    END IF;
    IF has_start_end THEN
        EXECUTE 'SELECT start_time::text FROM public.course_offerings WHERE id = $1' INTO v_start_time_text USING p_offering_id;
        EXECUTE 'SELECT end_time::text FROM public.course_offerings WHERE id = $1' INTO v_end_time_text USING p_offering_id;
    END IF;

    -- 3a) Check missing foreign keys: faculty_id, subject_id (only if columns exist)
    IF has_faculty AND (v_faculty IS NULL OR trim(coalesce(v_faculty, '')) = '') THEN
        INSERT INTO public.data_quality_notifications(entity_type, entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES('course_offering', p_offering_id, 'faculty_id', 'missing', 'high', 'Faculty not assigned', jsonb_build_object('offering_id', p_offering_id), now(), now());
    END IF;

    IF has_subject AND (v_subject IS NULL OR trim(coalesce(v_subject, '')) = '') THEN
        INSERT INTO public.data_quality_notifications(entity_type, entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES('course_offering', p_offering_id, 'subject_id', 'missing', 'high', 'Subject not assigned', jsonb_build_object('offering_id', p_offering_id), now(), now());
    END IF;

    -- 3b) Check room assignments. Support both legacy single-field and junction tables.
    -- Determine mth junction table and FK column dynamically to avoid schema differences
    DECLARE
        mth_table_exists BOOLEAN := FALSE;
        tfs_table_exists BOOLEAN := FALSE;
        mth_fk_col TEXT := NULL;
        tfs_fk_col TEXT := NULL;
        candidate_cols TEXT[] := ARRAY['course_offering_id','offering_id','course_offering','course_offeringid','courseoffering_id'];
        colname TEXT;
    BEGIN
        SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='course_offering_mth_rooms') INTO mth_table_exists;
        IF mth_table_exists THEN
            FOR colname IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='course_offering_mth_rooms' LOOP
                IF colname = ANY(candidate_cols) THEN
                    mth_fk_col := colname;
                    EXIT;
                END IF;
            END LOOP;
        END IF;

        IF mth_table_exists AND mth_fk_col IS NOT NULL THEN
            EXECUTE format('SELECT COUNT(*) FROM public.course_offering_mth_rooms WHERE %I = $1', mth_fk_col) INTO v_mth_count USING p_offering_id;
        ELSE
            v_mth_count := 0;
        END IF;

        IF v_mth_count = 0 THEN
            IF (NOT has_mth_field) OR (v_mth_room IS NULL OR trim(coalesce(v_mth_room, '')) = '') THEN
                INSERT INTO public.data_quality_notifications(entity_type, entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
                VALUES('course_offering', p_offering_id, 'mth_rooms', 'missing', 'medium', 'No monthly rooms assigned (neither legacy nor junction entries)', jsonb_build_object('mth_room_id', v_mth_room, 'mth_room_ids_count', v_mth_count), now(), now());
            END IF;
        END IF;

        -- Determine tfs junction table and FK column dynamically
        SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='course_offering_tfs_rooms') INTO tfs_table_exists;
        IF tfs_table_exists THEN
            FOR colname IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='course_offering_tfs_rooms' LOOP
                IF colname = ANY(candidate_cols) THEN
                    tfs_fk_col := colname;
                    EXIT;
                END IF;
            END LOOP;
        END IF;

        IF tfs_table_exists AND tfs_fk_col IS NOT NULL THEN
            EXECUTE format('SELECT COUNT(*) FROM public.course_offering_tfs_rooms WHERE %I = $1', tfs_fk_col) INTO v_tfs_count USING p_offering_id;
        ELSE
            v_tfs_count := 0;
        END IF;

        IF v_tfs_count = 0 THEN
            IF (NOT has_tfs_field) OR (v_tfs_room IS NULL OR trim(coalesce(v_tfs_room, '')) = '') THEN
                INSERT INTO public.data_quality_notifications(entity_type, entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
                VALUES('course_offering', p_offering_id, 'tfs_rooms', 'missing', 'medium', 'No TFS rooms assigned (neither legacy nor junction entries)', jsonb_build_object('tfs_room_id', v_tfs_room, 'tfs_room_ids_count', v_tfs_count), now(), now());
            END IF;
        END IF;
    END;

    -- 3c) Example: check a couple of other common fields if present (graceful: NULL columns will be ignored)
    IF has_start_end THEN
        IF (v_start_time_text IS NULL OR v_end_time_text IS NULL) THEN
            INSERT INTO public.data_quality_notifications(entity_type, entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
            VALUES('course_offering', p_offering_id, 'time_window', 'missing', 'low', 'Start or end time missing', jsonb_build_object('start_time', v_start_time_text, 'end_time', v_end_time_text), now(), now());
        END IF;
    END IF;

    -- 3d) Additional checks can be added here (credits, capacity, faculty conflicts, etc.).

END;
$$;

-- 4) Trigger wrapper to call refresh_course_offering_notifications for a single row
CREATE OR REPLACE FUNCTION public.trg_refresh_course_offering_notifications()
RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
    PERFORM public.refresh_course_offering_notifications(COALESCE(NEW.id, OLD.id));
    RETURN NULL;
END;
$$;

-- Attach triggers: when course_offerings changes, recompute notifications
DROP TRIGGER IF EXISTS trg_refresh_co_off ON public.course_offerings;
CREATE TRIGGER trg_refresh_co_off
AFTER INSERT OR UPDATE OR DELETE ON public.course_offerings
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_course_offering_notifications();

-- When junction tables change, recompute for the related offering
-- monthly rooms
DROP TRIGGER IF EXISTS trg_refresh_co_mth_rooms ON public.course_offering_mth_rooms;
CREATE TRIGGER trg_refresh_co_mth_rooms
AFTER INSERT OR UPDATE OR DELETE ON public.course_offering_mth_rooms
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_course_offering_notifications();

-- tfs rooms
DROP TRIGGER IF EXISTS trg_refresh_co_tfs_rooms ON public.course_offering_tfs_rooms;
CREATE TRIGGER trg_refresh_co_tfs_rooms
AFTER INSERT OR UPDATE OR DELETE ON public.course_offering_tfs_rooms
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_course_offering_notifications();

-- 5) Backfill function to refresh all offerings (run once after migration)
CREATE OR REPLACE FUNCTION public.refresh_all_course_offering_notifications()
RETURNS void LANGUAGE plpgsql AS
$$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.course_offerings LOOP
        PERFORM public.refresh_course_offering_notifications(r.id);
    END LOOP;
END;
$$;

COMMIT;

-- Usage notes (run after migration):
-- SELECT public.refresh_all_course_offering_notifications();

-- To inspect notifications: SELECT * FROM public.course_offering_notifications ORDER BY created_at DESC LIMIT 100;
