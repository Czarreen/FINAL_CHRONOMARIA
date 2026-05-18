import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

function normalizeDepartmentIds(input) {
  if (input === undefined) return undefined;
  if (input === null) return null;

  let rawValues = [];
  if (Array.isArray(input)) {
    rawValues = input;
  } else if (typeof input === 'string') {
    rawValues = input.split(/[\/,]/);
  } else {
    rawValues = [input];
  }

  const ids = rawValues
    .map((value) => Number(String(value).trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return [];
  return uniqueIds;
}

async function validateDepartmentIds(departmentIds) {
  if (departmentIds === null || departmentIds === undefined) {
    return { isValid: true, invalidIds: [] };
  }

  const ids = Array.isArray(departmentIds)
    ? departmentIds
    : normalizeDepartmentIds(departmentIds);

  if (!Array.isArray(ids) || ids.length === 0) {
    return { isValid: true, invalidIds: [] };
  }

  const { data, error } = await supabaseAdmin
    .from('departments')
    .select('department_id')
    .in('department_id', ids);

  if (error) {
    return {
      isValid: false,
      invalidIds: ids,
      error,
    };
  }

  const valid = new Set((data ?? []).map((row) => Number(row.department_id)));
  const invalidIds = ids.filter((id) => !valid.has(id));

  return {
    isValid: invalidIds.length === 0,
    invalidIds,
  };
}

async function fetchRoomDepartmentMap(roomIds = []) {
  if (!Array.isArray(roomIds) || roomIds.length === 0) {
    return new Map();
  }

  const map = new Map();
  roomIds.forEach((id) => map.set(Number(id), []));

  const { data, error } = await supabaseAdmin
    .from('room_departments')
    .select('room_id, department_id')
    .in('room_id', roomIds);

  if (error) {
    if (error.code !== '42P01') {
      console.error('Room departments query error:', error);
    }
    return map;
  }

  (data ?? []).forEach((row) => {
    const roomId = Number(row.room_id);
    const departmentId = Number(row.department_id);
    if (!Number.isInteger(roomId) || !Number.isInteger(departmentId)) return;

    const existing = map.get(roomId) || [];
    existing.push(departmentId);
    map.set(roomId, existing);
  });

  return map;
}

async function ensureRoomDepartmentsTableExists() {
  const { error } = await supabaseAdmin
    .from('room_departments')
    .select('room_id')
    .limit(1);

  if (!error) return true;
  if (error.code === '42P01') return false;
  throw new Error(error.message || 'Failed to verify room_departments table');
}

async function replaceRoomDepartments(roomId, departmentIds) {
  const roomIdNum = Number(roomId);
  const ids = Array.isArray(departmentIds) ? departmentIds : [];

  const { error: deleteError } = await supabaseAdmin
    .from('room_departments')
    .delete()
    .eq('room_id', roomIdNum);

  if (deleteError) {
    throw new Error(deleteError.message || 'Failed to clear room departments');
  }

  if (ids.length === 0) {
    return;
  }

  const rows = ids.map((departmentId) => ({
    room_id: roomIdNum,
    department_id: departmentId,
  }));

  const { error: insertError } = await supabaseAdmin
    .from('room_departments')
    .insert(rows);

  if (insertError) {
    throw new Error(insertError.message || 'Failed to save room departments');
  }
}

// GET - Fetch rooms with pagination
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabaseAdmin
      .from('rooms')
      .select('room_id, room_name, room_type, room_status, room_department_id', { count: 'exact' })
      .order('room_id', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('Rooms query error:', error);
      return res.json({
        page,
        limit,
        total: 0,
        rows: [],
      });
    }

    const roomIds = (data ?? []).map((room) => Number(room.room_id)).filter((id) => Number.isInteger(id));
    const departmentMap = await fetchRoomDepartmentMap(roomIds);
    const rows = (data ?? []).map((room) => {
      const mappedIds = departmentMap.get(Number(room.room_id)) || [];
      const fallbackId = Number(room.room_department_id);
      const roomDepartmentIds = mappedIds.length > 0
        ? Array.from(new Set(mappedIds))
        : (Number.isInteger(fallbackId) && fallbackId > 0 ? [fallbackId] : []);

      return {
        ...room,
        room_department_ids: roomDepartmentIds,
      };
    });

    return res.json({
      page,
      limit,
      total: count ?? 0,
      rows,
    });
  } catch (err) {
    console.error('Rooms route error:', err);
    return res.json({
      page: 1,
      limit: 50,
      total: 0,
      rows: [],
    });
  }
});

// POST - Create a new room
router.post('/', async (req, res) => {
  try {
    const { room_name, room_type, room_status, room_department_id, room_departmnet_id, department_id } = req.body;

    if (!room_name) {
      return res.status(400).json({ error: 'room_name is required' });
    }

    const incomingDepartmentIds = room_department_id ?? room_departmnet_id ?? department_id;
    const normalizedDepartmentIds = normalizeDepartmentIds(incomingDepartmentIds);
    const validation = await validateDepartmentIds(normalizedDepartmentIds);
    if (!validation.isValid) {
      if (validation.error) {
        console.error('Department validation error:', validation.error);
      }
      return res.status(400).json({ error: `Unknown department id(s): ${validation.invalidIds.join(', ')}` });
    }

    const roomDepartmentsTableExists = await ensureRoomDepartmentsTableExists();
    if (!roomDepartmentsTableExists) {
      return res.status(500).json({
        error: 'Missing table: room_departments. Run migration 005_add_room_departments_junction.sql first.',
      });
    }

    const primaryDepartmentId = normalizedDepartmentIds.length > 0 ? normalizedDepartmentIds[0] : null;

    const { data, error } = await supabaseAdmin
      .from('rooms')
      .insert([
        {
          room_name,
          room_type: room_type || null,
          room_status: room_status || 'available',
          room_department_id: primaryDepartmentId,
        },
      ])
      .select();

    if (error) {
      console.error('Room creation error:', error);
      return res.status(400).json({ error: error.message });
    }

    if (data && data.length > 0) {
      try {
        await replaceRoomDepartments(data[0].room_id, normalizedDepartmentIds);
        await supabaseAdmin.rpc('refresh_room_notifications', { p_room_id: data[0].room_id });
      } catch (syncErr) {
        console.error('Failed to sync room notifications:', syncErr);
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Room created successfully',
      data: {
        ...data[0],
        room_department_ids: normalizedDepartmentIds,
      },
    });
  } catch (err) {
    console.error('Room creation route error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// PUT - Update a room
router.put('/:room_id', async (req, res) => {
  try {
    const { room_id } = req.params;
    const { room_name, room_type, room_status, room_department_id, room_departmnet_id, department_id } = req.body;

    if (!room_id) {
      return res.status(400).json({ error: 'room_id is required' });
    }

    const updateData = {};
    if (room_name !== undefined) updateData.room_name = room_name;
    if (room_type !== undefined) updateData.room_type = room_type;
    if (room_status !== undefined) updateData.room_status = room_status;
    let normalizedDepartmentIds;
    let shouldUpdateRoomDepartments = false;

    const incomingDepartmentIds = room_department_id ?? room_departmnet_id ?? department_id;
    if (incomingDepartmentIds !== undefined) {
      normalizedDepartmentIds = normalizeDepartmentIds(incomingDepartmentIds);
      const validation = await validateDepartmentIds(normalizedDepartmentIds);
      if (!validation.isValid) {
        if (validation.error) {
          console.error('Department validation error:', validation.error);
        }
        return res.status(400).json({ error: `Unknown department id(s): ${validation.invalidIds.join(', ')}` });
      }

      const roomDepartmentsTableExists = await ensureRoomDepartmentsTableExists();
      if (!roomDepartmentsTableExists) {
        return res.status(500).json({
          error: 'Missing table: room_departments. Run migration 005_add_room_departments_junction.sql first.',
        });
      }

      updateData.room_department_id = normalizedDepartmentIds.length > 0 ? normalizedDepartmentIds[0] : null;
      shouldUpdateRoomDepartments = true;
    }

    const { data, error } = await supabaseAdmin
      .from('rooms')
      .update(updateData)
      .eq('room_id', room_id)
      .select();

    if (error) {
      console.error('Room update error:', error);
      return res.status(400).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    try {
      if (shouldUpdateRoomDepartments) {
        await replaceRoomDepartments(room_id, normalizedDepartmentIds);
      }
      await supabaseAdmin.rpc('refresh_room_notifications', { p_room_id: Number(room_id) });
    } catch (syncErr) {
      console.error('Failed to sync room notifications:', syncErr);
    }

    return res.json({
      success: true,
      message: 'Room updated successfully',
      data: {
        ...data[0],
        room_department_ids: shouldUpdateRoomDepartments
          ? normalizedDepartmentIds
          : undefined,
      },
    });
  } catch (err) {
    console.error('Room update route error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE - Delete a room
router.delete('/:room_id', async (req, res) => {
  try {
    const { room_id } = req.params;

    if (!room_id) {
      return res.status(400).json({ error: 'room_id is required' });
    }

    const { error } = await supabaseAdmin
      .from('rooms')
      .delete()
      .eq('room_id', room_id);

    if (error) {
      console.error('Room deletion error:', error);
      return res.status(400).json({ error: error.message });
    }

    try {
      await supabaseAdmin.rpc('refresh_room_notifications', { p_room_id: Number(room_id) });
    } catch (deleteErr) {
      console.error('Failed to delete room notifications:', deleteErr);
    }

    return res.json({
      success: true,
      message: 'Room deleted successfully',
    });
  } catch (err) {
    console.error('Room deletion route error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET - Fetch all course offerings for a specific room
router.get('/:room_id/offerings', async (req, res) => {
  try {
    const rid = String(req.params.room_id);

    // Match room_id in mth_room_id or tfs_room_id (handles "1/5" slash-separated values)
    const orFilter = [
      `mth_room_id.eq.${rid}`,
      `mth_room_id.like.${rid}/%`,
      `mth_room_id.like.%/${rid}`,
      `mth_room_id.like.%/${rid}/%`,
      `tfs_room_id.eq.${rid}`,
      `tfs_room_id.like.${rid}/%`,
      `tfs_room_id.like.%/${rid}`,
      `tfs_room_id.like.%/${rid}/%`,
    ].join(',');

    const { data, error } = await supabaseAdmin
      .from('course_offerings')
      .select('id, code, course_no, descriptive_title, section, lab_hrs, mth_schedule, tfs_schedule, mth_room_id, tfs_room_id')
      .or(orFilter);

    if (error) {
      console.error('Room offerings query error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ rows: data ?? [] });
  } catch (err) {
    console.error('Room offerings route error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
