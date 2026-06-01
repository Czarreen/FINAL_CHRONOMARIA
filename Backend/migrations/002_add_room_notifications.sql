-- Migration: Add room data quality notifications
-- Creates a view for room notifications, a refresh function, triggers, and a backfill function.

BEGIN;

-- 1) Convenience view: room notifications
CREATE OR REPLACE VIEW public.room_notifications AS
SELECT * FROM public.data_quality_notifications WHERE entity_type = 'room';

-- 2) Refresh function (idempotent): recompute notifications for a single room
CREATE OR REPLACE FUNCTION public.refresh_room_notifications(p_room_id BIGINT)
RETURNS VOID LANGUAGE plpgsql AS
$$
DECLARE
    v_room_name TEXT;
    v_room_type TEXT;
    v_room_status TEXT;
BEGIN
    -- Remove existing cached notifications for this room
    DELETE FROM public.data_quality_notifications
    WHERE entity_type = 'room' AND entity_id = p_room_id;

    -- Load room fields
    SELECT room_name, room_type, room_status
    INTO v_room_name, v_room_type, v_room_status
    FROM public.rooms
    WHERE room_id = p_room_id;

    -- Check if room exists
    IF v_room_name IS NULL THEN
        RETURN;
    END IF;

    -- 2a) Check missing room_name (critical)
    IF v_room_name IS NULL OR trim(coalesce(v_room_name, '')) = '' THEN
        INSERT INTO public.data_quality_notifications(entity_type, entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES('room', p_room_id, 'room_name', 'missing', 'high', 'Room name is empty or missing', jsonb_build_object('room_id', p_room_id), now(), now());
    END IF;

    -- 2b) Check missing room_type (medium priority)
    IF v_room_type IS NULL OR trim(coalesce(v_room_type, '')) = '' THEN
        INSERT INTO public.data_quality_notifications(entity_type, entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES('room', p_room_id, 'room_type', 'missing', 'medium', 'Room type is not specified', jsonb_build_object('room_id', p_room_id), now(), now());
    END IF;

    -- 2c) Check missing room_status (medium priority)
    IF v_room_status IS NULL OR trim(coalesce(v_room_status, '')) = '' THEN
        INSERT INTO public.data_quality_notifications(entity_type, entity_id, field_name, issue_type, severity, message, details, created_at, updated_at)
        VALUES('room', p_room_id, 'room_status', 'missing', 'medium', 'Room status is not set', jsonb_build_object('room_id', p_room_id), now(), now());
    END IF;

END;
$$;

-- 3) Trigger wrapper to call refresh_room_notifications for a single row
CREATE OR REPLACE FUNCTION public.trg_refresh_room_notifications()
RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
    PERFORM public.refresh_room_notifications(COALESCE(NEW.room_id, OLD.room_id));
    RETURN NULL;
END;
$$;

-- Attach trigger: when rooms changes, recompute notifications
DROP TRIGGER IF EXISTS trg_refresh_room ON public.rooms;
CREATE TRIGGER trg_refresh_room
AFTER INSERT OR UPDATE OR DELETE ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_room_notifications();

-- 4) Backfill function to refresh all rooms (run once after migration)
CREATE OR REPLACE FUNCTION public.refresh_all_room_notifications()
RETURNS void LANGUAGE plpgsql AS
$$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT room_id FROM public.rooms LOOP
        PERFORM public.refresh_room_notifications(r.room_id);
    END LOOP;
END;
$$;

COMMIT;

-- Usage notes (run after migration):
-- SELECT public.refresh_all_room_notifications();

-- To inspect notifications: SELECT * FROM public.room_notifications ORDER BY created_at DESC LIMIT 100;
