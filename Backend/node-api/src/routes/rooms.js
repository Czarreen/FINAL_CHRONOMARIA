import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { recordAuditLog } from '../lib/auditLogger.js';

const router = Router();
const ROOMS_AUDIT_MODULE = 'rooms';
const ROOM_SELECT_FIELDS = 'room_id, room_name, room_type, room_status, room_department_id';
const ROOM_AUDIT_FIELDS = [
  { key: 'room_name', label: 'Name' },
  { key: 'room_type', label: 'Type' },
  { key: 'room_status', label: 'Status' },
  { key: 'room_department_names', label: 'Departments' },
];

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

async function fetchDepartmentNameMap(departmentIds = []) {
  const ids = Array.from(
    new Set(
      (departmentIds ?? [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );

  if (ids.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from('departments')
    .select('department_id, department_name')
    .in('department_id', ids);

  if (error) {
    console.error('Department names query error:', error.message);
    return new Map();
  }

  return new Map(
    (data ?? []).map((department) => [
      Number(department.department_id),
      department.department_name || `Department #${department.department_id}`,
    ])
  );
}

async function attachRoomDepartmentIds(rooms = []) {
  const roomIds = (rooms ?? [])
    .map((room) => Number(room.room_id))
    .filter((id) => Number.isInteger(id));
  const departmentMap = await fetchRoomDepartmentMap(roomIds);
  const rowsWithDepartmentIds = (rooms ?? []).map((room) => {
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

  const departmentNameMap = await fetchDepartmentNameMap(
    rowsWithDepartmentIds.flatMap((room) => room.room_department_ids || [])
  );

  return rowsWithDepartmentIds.map((room) => ({
    ...room,
    room_department_names: (room.room_department_ids || [])
      .map((departmentId) => departmentNameMap.get(Number(departmentId)) || `Department #${departmentId}`),
  }));
}

async function fetchRoomForAudit(roomId) {
  const { data, error } = await supabaseAdmin
    .from('rooms')
    .select(ROOM_SELECT_FIELDS)
    .eq('room_id', roomId)
    .limit(1);

  if (error) throw new Error(error.message || 'Failed to fetch room');

  const [room] = await attachRoomDepartmentIds(data ?? []);
  return room || null;
}

function formatRoomAuditLabel(room = {}, fallbackId = null) {
  const roomId = room?.room_id ?? fallbackId;
  const roomName = String(room?.room_name || '').trim();
  if (roomName && roomId) return `${roomName} (#${roomId})`;
  if (roomName) return roomName;
  return `Room #${roomId || 'unknown'}`;
}

function normalizeAuditValue(value) {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => String(item ?? '').trim())
          .filter(Boolean)
      )
    ).sort((left, right) => {
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber - rightNumber;
      }
      return left.localeCompare(right);
    });
  }

  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function areAuditValuesEqual(beforeValue, afterValue) {
  return JSON.stringify(normalizeAuditValue(beforeValue)) === JSON.stringify(normalizeAuditValue(afterValue));
}

function formatAuditValue(value) {
  const normalized = normalizeAuditValue(value);
  if (Array.isArray(normalized)) return normalized.length > 0 ? normalized.join(', ') : 'none';
  return normalized || 'none';
}

function buildRoomCreatedAuditDescription(room = {}) {
  const details = ROOM_AUDIT_FIELDS
    .filter(({ key }) => key !== 'room_name')
    .map(({ key, label }) => `${label}: ${formatAuditValue(room[key])}`);

  return `Created room ${formatRoomAuditLabel(room)} with ${details.join(', ')}`;
}

function buildRoomUpdatedAuditDescription(before = {}, after = {}, fallbackId = null) {
  const changes = ROOM_AUDIT_FIELDS
    .filter(({ key }) => !areAuditValuesEqual(before[key], after[key]))
    .map(({ key, label }) => `${label} from ${formatAuditValue(before[key])} to ${formatAuditValue(after[key])}`);

  if (changes.length === 0) {
    return `Updated room ${formatRoomAuditLabel(after, fallbackId)} with no field changes detected`;
  }

  return `Updated room ${formatRoomAuditLabel(after, fallbackId)}: ${changes.join(', ')}`;
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

// GET - All room bookings (course_offerings + subjects) for client-side conflict detection
router.get('/bookings', async (_req, res) => {
  try {
    function splitRoomIds(val) {
      if (!val) return [];
      return String(val).split('/').map((s) => s.trim()).filter(Boolean);
    }

    const [{ data: cos, error: coError }, { data: subs, error: subError }] = await Promise.all([
      supabaseAdmin
        .from('course_offerings')
        .select('id, code, mth_schedule, tfs_schedule, mth_room_id, tfs_room_id')
        .or('mth_room_id.not.is.null,tfs_room_id.not.is.null'),
      supabaseAdmin
        .from('subjects')
        .select('subject_id, subject_code, mth_schedule, tfs_schedule, mth_room, tfs_room, mth_room_id, tfs_room_id')
        .or('mth_room.not.is.null,tfs_room.not.is.null,mth_room_id.not.is.null,tfs_room_id.not.is.null'),
    ]);

    if (coError) console.error('Bookings CO query error:', coError);
    if (subError) console.error('Bookings subjects query error:', subError);

    const rows = [];

    for (const co of cos ?? []) {
      for (const roomId of splitRoomIds(co.mth_room_id)) {
        rows.push({ id: co.id, code: co.code, mth_schedule: co.mth_schedule, tfs_schedule: null, room_id: roomId, slot: 'mth' });
      }
      for (const roomId of splitRoomIds(co.tfs_room_id)) {
        rows.push({ id: co.id, code: co.code, mth_schedule: null, tfs_schedule: co.tfs_schedule, room_id: roomId, slot: 'tfs' });
      }
    }

    for (const sub of subs ?? []) {
      const mthRoom = sub.mth_room || sub.mth_room_id;
      const tfsRoom = sub.tfs_room || sub.tfs_room_id;
      for (const roomId of splitRoomIds(mthRoom)) {
        rows.push({ subject_id: sub.subject_id, subject_code: sub.subject_code, mth_schedule: sub.mth_schedule, tfs_schedule: null, room_id: roomId, slot: 'mth' });
      }
      for (const roomId of splitRoomIds(tfsRoom)) {
        rows.push({ subject_id: sub.subject_id, subject_code: sub.subject_code, mth_schedule: null, tfs_schedule: sub.tfs_schedule, room_id: roomId, slot: 'tfs' });
      }
    }

    return res.json({ rows });
  } catch (err) {
    console.error('Room bookings route error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET - Fetch rooms with pagination
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabaseAdmin
      .from('rooms')
      .select(ROOM_SELECT_FIELDS, { count: 'exact' })
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

    const rows = await attachRoomDepartmentIds(data ?? []);

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
    const normalizedDepartmentIds = normalizeDepartmentIds(incomingDepartmentIds) ?? [];
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

    const [insertedRoom] = await attachRoomDepartmentIds([data[0]]);

    await recordAuditLog(req, {
      action: 'room_created',
      module: ROOMS_AUDIT_MODULE,
      description: buildRoomCreatedAuditDescription(insertedRoom),
      changes_after: insertedRoom,
    });

    return res.status(201).json({
      success: true,
      message: 'Room created successfully',
      data: insertedRoom,
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
      normalizedDepartmentIds = normalizeDepartmentIds(incomingDepartmentIds) ?? [];
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

    const existingRoom = await fetchRoomForAudit(room_id);
    if (!existingRoom) {
      return res.status(404).json({ error: 'Room not found' });
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

    const [updatedRoom] = await attachRoomDepartmentIds([data[0]]);

    await recordAuditLog(req, {
      action: 'room_updated',
      module: ROOMS_AUDIT_MODULE,
      description: buildRoomUpdatedAuditDescription(existingRoom, updatedRoom, room_id),
      changes_before: existingRoom,
      changes_after: updatedRoom,
    });

    return res.json({
      success: true,
      message: 'Room updated successfully',
      data: updatedRoom,
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

    const targetRoom = await fetchRoomForAudit(room_id);
    if (!targetRoom) {
      return res.status(404).json({ error: 'Room not found' });
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

    await recordAuditLog(req, {
      action: 'room_deleted',
      module: ROOMS_AUDIT_MODULE,
      description: `Deleted room ${formatRoomAuditLabel(targetRoom, room_id)}`,
      changes_before: targetRoom,
    });

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
