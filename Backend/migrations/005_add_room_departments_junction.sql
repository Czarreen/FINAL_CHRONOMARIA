-- Create junction table for many-to-many room-department assignment.
CREATE TABLE IF NOT EXISTS public.room_departments (
  room_id integer NOT NULL,
  department_id integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT room_departments_pkey PRIMARY KEY (room_id, department_id),
  CONSTRAINT room_departments_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(room_id) ON DELETE CASCADE,
  CONSTRAINT room_departments_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(department_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_departments_department_id
  ON public.room_departments (department_id);

-- Backfill from legacy single-department column when present.
INSERT INTO public.room_departments (room_id, department_id)
SELECT r.room_id, d.department_id
FROM public.rooms r
JOIN public.departments d
  ON d.department_id = r.room_department_id::integer
WHERE r.room_department_id IS NOT NULL
ON CONFLICT (room_id, department_id) DO NOTHING;
