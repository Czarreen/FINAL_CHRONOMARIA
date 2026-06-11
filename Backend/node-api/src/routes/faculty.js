import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const search = req.query.search?.trim() || '';
    const status = req.query.status || '';
    let query = supabaseAdmin
      .from('faculty')
      .select(
        'faculty_id, faculty_name, department_id, faculty_email, faculty_specialization, faculty_max_units, faculty_role, faculty_status, departments(department_id, department_name)',
        { count: 'exact' }
      );

    if (search) {
      query = query.or(
        `faculty_name.ilike.%${search}%,faculty_email.ilike.%${search}%,faculty_role.ilike.%${search}%,faculty_specialization.ilike.%${search}%`
      );
    }

    if (status) {
      query = query.ilike('faculty_status', status);
    }

    const { data, error, count } = await query
      .order('faculty_id', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('Faculty query error:', error);
      return res.status(500).json({ error: error.message });
    }

    const { count: activeCount } = await supabaseAdmin
      .from('faculty')
      .select('*', { count: 'exact', head: true })
      .ilike('faculty_status', 'active');

    return res.json({
      page,
      limit,
      total: count ?? 0,
      activeCount: activeCount ?? 0,
      rows: data ?? [],
    });
  } catch (err) {
    console.error('Faculty route error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const facultyData = req.body;
    const allowedFields = [
      'faculty_name',
      'department_id',
      'faculty_email',
      'faculty_specialization',
      'faculty_max_units',
      'faculty_role',
      'faculty_status',
    ];

    const sanitizedData = {};
    for (const field of allowedFields) {
      if (field in facultyData) {
        sanitizedData[field] = facultyData[field];
      }
    }

    if (!sanitizedData.faculty_name) {
      return res.status(400).json({ error: 'faculty_name is required' });
    }

    if (!sanitizedData.faculty_status) {
      sanitizedData.faculty_status = 'active';
    }

    const { data, error } = await supabaseAdmin
      .from('faculty')
      .insert(sanitizedData)
      .select('faculty_id, faculty_name, department_id, faculty_email, faculty_specialization, faculty_max_units, faculty_role, faculty_status, departments(department_id, department_name)')
      .single();

    if (error) {
      console.error('Create faculty error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('faculty')
      .select('faculty_id, faculty_name, department_id, faculty_email, faculty_specialization, faculty_max_units, faculty_role, faculty_status, departments(department_id, department_name)')
      .eq('faculty_id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Faculty member not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = [
      'faculty_name',
      'department_id',
      'faculty_email',
      'faculty_specialization',
      'faculty_max_units',
      'faculty_role',
      'faculty_status',
    ];

    const sanitizedUpdates = {};
    for (const field of allowedFields) {
      if (field in updates) {
        sanitizedUpdates[field] = updates[field];
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabaseAdmin
      .from('faculty')
      .update(sanitizedUpdates)
      .eq('faculty_id', id)
      .select('faculty_id, faculty_name, department_id, faculty_email, faculty_specialization, faculty_max_units, faculty_role, faculty_status, departments(department_id, department_name)')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Faculty member not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    // After updating faculty, recompute notification state
    try {
      const f = data;
      const missingFields = [];
      const issues = [];

      if (!f.faculty_name || String(f.faculty_name).trim() === '') {
        missingFields.push('faculty_name');
        issues.push({ message: 'Missing faculty name' });
      }

      if (!f.department_id) {
        missingFields.push('department_id');
        issues.push({ message: 'No department assigned' });
      }

      if (!f.faculty_role || String(f.faculty_role).trim() === '') {
        missingFields.push('faculty_role');
        issues.push({ message: 'Missing role/title' });
      }

      if (!f.faculty_status || String(f.faculty_status).trim() === '') {
        missingFields.push('faculty_status');
        issues.push({ message: 'Missing status (active/inactive/on-leave)' });
      }

      if (!f.faculty_specialization || String(f.faculty_specialization).trim() === '') {
        issues.push({ message: 'No specializations provided' });
      }

      if (!f.faculty_max_units) {
        issues.push({ message: 'Max units not set' });
      }

      const severity = missingFields.length > 0 ? 'critical' : issues.length > 0 ? 'medium' : 'low';

      if (missingFields.length === 0 && issues.length === 0) {
        // mark any existing notification as resolved
        await supabaseAdmin
          .from('faculty_notifications')
          .update({ is_resolved: true, updated_at: new Date().toISOString() })
          .eq('faculty_id', f.faculty_id);
      } else {
        // upsert the notification with latest content and mark unresolved
        const payload = {
          faculty_id: f.faculty_id,
          title: f.faculty_name || `Faculty #${f.faculty_id}`,
          description: f.departments?.department_name || null,
          severity,
          missing_fields: JSON.stringify(missingFields),
          issues: JSON.stringify(issues),
          is_resolved: false,
          metadata: JSON.stringify({}),
          updated_at: new Date().toISOString(),
        };
        await supabaseAdmin.from('faculty_notifications').upsert(payload, { onConflict: 'faculty_id' });
      }
    } catch (notifErr) {
      console.error('Failed to update faculty_notifications after faculty PATCH:', notifErr);
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET /api/faculty/:id/loading — fetch all faculty_loading rows for a faculty member
router.get('/:id/loading', async (req, res) => {
  try {
    const { id } = req.params;

    // First, fetch the loading rows
    const { data, error } = await supabaseAdmin
      .from('faculty_loading')
      .select(
        'facloading_id, faculty_id, code, course_no, descriptive_title, section, units, lec_hrs, lab_hrs, mth_schedule, tfs_schedule, locked, mth_room_id, tfs_room_id'
      )
      .eq('faculty_id', id)
      .order('facloading_id', { ascending: true });

    if (error) {
      console.error('Faculty loading query error:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.json({ rows: [] });
    }

    // Resolve room names in a second query
    const roomIds = new Set();
    data.forEach((row) => {
      if (row.mth_room_id) roomIds.add(Number(row.mth_room_id));
      if (row.tfs_room_id) roomIds.add(Number(row.tfs_room_id));
    });

    let roomMap = {};
    if (roomIds.size > 0) {
      const { data: rooms, error: roomError } = await supabaseAdmin
        .from('rooms')
        .select('room_id, room_name')
        .in('room_id', Array.from(roomIds));

      if (!roomError && rooms) {
        rooms.forEach((r) => { roomMap[r.room_id] = r.room_name; });
      }
    }

    const rows = data.map((row) => ({
      ...row,
      locked: Boolean(row.locked),
      mth_room_name: row.mth_room_id ? (roomMap[Number(row.mth_room_id)] ?? null) : null,
      tfs_room_name: row.tfs_room_id ? (roomMap[Number(row.tfs_room_id)] ?? null) : null,
    }));

    return res.json({ rows });
  } catch (err) {
    console.error('Faculty loading route error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// PATCH /api/faculty/loading/:facloadingId/lock — toggle locked field
router.patch('/loading/:facloadingId/lock', async (req, res) => {
  try {
    const { facloadingId } = req.params;
    const { locked } = req.body;

    if (typeof locked !== 'boolean') {
      return res.status(400).json({ error: '`locked` must be a boolean' });
    }

    const { data, error } = await supabaseAdmin
      .from('faculty_loading')
      .update({ locked })
      .eq('facloading_id', facloadingId)
      .select('facloading_id, locked')
      .single();

    if (error) {
      console.error('Faculty loading lock update error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ facloading_id: data.facloading_id, locked: Boolean(data.locked) });
  } catch (err) {
    console.error('Faculty loading lock route error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('faculty')
      .delete()
      .eq('faculty_id', id)
      .select('faculty_id')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Faculty member not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      success: true,
      deletedFacultyId: data?.faculty_id ?? Number(id),
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
