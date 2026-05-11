import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

// GET /api/notifications/course-offerings
router.get('/course-offerings', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from('course_offering_notifications')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (req.query.is_resolved === 'false') {
      query = query.eq('is_resolved', false);
    } else if (req.query.is_resolved === 'true') {
      query = query.eq('is_resolved', true);
    }

    const { data, error, count } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ page, limit, total: count ?? 0, rows: data ?? [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// PATCH /api/notifications/course-offerings/:id/resolve
router.patch('/course-offerings/:id/resolve', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const resp = await supabaseAdmin
      .from('data_quality_notifications')
      .update({ is_resolved: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('entity_type', 'course_offering');

    if (resp.error) return res.status(500).json({ error: resp.error.message });
    return res.json({ updated: resp.data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Shared helper: compute issue rows for a single offering object
function computeOfferingIssues(offering) {
  const isEmptyVal = (v) => v === null || v === undefined || String(v).trim() === '' || v === 0;
  const issues = [];

  if (isEmptyVal(offering.code)) issues.push({ field_name: 'code', severity: 'high', message: 'Course code is required', issue_type: 'missing' });
  if (isEmptyVal(offering.course_no)) issues.push({ field_name: 'course_no', severity: 'high', message: 'Course number is required', issue_type: 'missing' });

  const mthSchedule = !isEmptyVal(offering.mth_schedule);
  const mthRoom = !isEmptyVal(offering.mth_room_id);
  const tfsSchedule = !isEmptyVal(offering.tfs_schedule);
  const tfsRoom = !isEmptyVal(offering.tfs_room_id);

  if (!(mthSchedule && mthRoom) && !(tfsSchedule && tfsRoom)) {
    if (!mthSchedule && !tfsSchedule) {
      issues.push({ field_name: 'mth_schedule', severity: 'high', message: 'No schedule assigned', issue_type: 'missing' });
    } else if (!mthRoom && !tfsRoom) {
      issues.push({ field_name: 'mth_room_id', severity: 'high', message: 'No classroom assigned for scheduled times', issue_type: 'missing' });
    } else {
      if (mthSchedule && !mthRoom) issues.push({ field_name: 'mth_room_id', severity: 'medium', message: 'MTH schedule is missing room assignment', issue_type: 'missing' });
      if (tfsSchedule && !tfsRoom) issues.push({ field_name: 'tfs_room_id', severity: 'medium', message: 'TFS schedule is missing room assignment', issue_type: 'missing' });
      if (!mthSchedule && mthRoom) issues.push({ field_name: 'mth_schedule', severity: 'medium', message: 'MTH room assigned but no schedule', issue_type: 'missing' });
      if (!tfsSchedule && tfsRoom) issues.push({ field_name: 'tfs_schedule', severity: 'medium', message: 'TFS room assigned but no schedule', issue_type: 'missing' });
    }
  }

  if (isEmptyVal(offering.descriptive_title)) issues.push({ field_name: 'descriptive_title', severity: 'medium', message: 'Course title is missing', issue_type: 'missing' });
  if (isEmptyVal(offering.department_id)) issues.push({ field_name: 'department_id', severity: 'medium', message: 'Department is not assigned', issue_type: 'missing' });
  if (isEmptyVal(offering.curr_id)) issues.push({ field_name: 'curr_id', severity: 'medium', message: 'Curriculum ID is missing', issue_type: 'missing' });
  if (isEmptyVal(offering.units)) issues.push({ field_name: 'units', severity: 'medium', message: 'Credit units are not specified', issue_type: 'missing' });
  if (isEmptyVal(offering.lec_hrs)) issues.push({ field_name: 'lec_hrs', severity: 'medium', message: 'Lecture hours are not specified', issue_type: 'missing' });

  // Escalate: 4+ issues with no critical → all become critical
  const hasCritical = issues.some((i) => i.severity === 'high');
  if (!hasCritical && issues.length >= 4) {
    issues.forEach((i) => { i.severity = 'high'; });
  }

  return issues;
}

// POST /api/notifications/course-offerings/sync
// Re-computes notifications for a single offering after a save
router.post('/course-offerings/sync', async (req, res) => {
  try {
    const offeringId = Number(req.body?.offering_id);
    if (!offeringId) return res.status(400).json({ error: 'offering_id required' });

    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from('course_offerings')
      .select('id, code, course_no, descriptive_title, department_id, curr_id, units, lec_hrs, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id')
      .eq('id', offeringId)
      .limit(1);

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    const offering = rows?.[0];
    if (!offering) return res.status(404).json({ error: 'Offering not found' });

    const { error: delErr } = await supabaseAdmin
      .from('data_quality_notifications')
      .delete()
      .eq('entity_type', 'course_offering')
      .eq('entity_id', offeringId)
      .eq('is_resolved', false);

    if (delErr) return res.status(500).json({ error: delErr.message });

    const issues = computeOfferingIssues(offering);
    if (issues.length === 0) return res.json({ synced: 0, issues: [] });

    const now = new Date().toISOString();
    const inserts = issues.map((issue) => ({
      entity_type: 'course_offering',
      entity_id: offeringId,
      field_name: issue.field_name,
      issue_type: issue.issue_type,
      severity: issue.severity,
      message: issue.message,
      details: { offering_id: offeringId, code: offering.code },
      is_resolved: false,
      created_at: now,
      updated_at: now,
    }));

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('data_quality_notifications')
      .insert(inserts)
      .select();

    if (insertErr) return res.status(500).json({ error: insertErr.message });
    return res.json({ synced: inserts.length, issues: inserted ?? [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/notifications/course-offerings/rescan-all
// Scans ALL course offerings and rebuilds the notification table.
// Only runs when the table is empty; otherwise returns { skipped: true }.
router.post('/course-offerings/rescan-all', async (req, res) => {
  try {
    // Check if the table already has unresolved rows
    const { count: existingCount, error: countErr } = await supabaseAdmin
      .from('data_quality_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'course_offering')
      .eq('is_resolved', false);

    if (countErr) return res.status(500).json({ error: countErr.message });

    if ((existingCount ?? 0) > 0) {
      return res.json({ skipped: true, count: existingCount, message: 'Table already has data — no rescan needed.' });
    }

    // Fetch all offerings
    const { data: offerings, error: fetchErr } = await supabaseAdmin
      .from('course_offerings')
      .select('id, code, course_no, descriptive_title, department_id, curr_id, units, lec_hrs, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id');

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    const now = new Date().toISOString();
    const inserts = [];

    for (const offering of offerings || []) {
      const issues = computeOfferingIssues(offering);
      for (const issue of issues) {
        inserts.push({
          entity_type: 'course_offering',
          entity_id: offering.id,
          field_name: issue.field_name,
          issue_type: issue.issue_type,
          severity: issue.severity,
          message: issue.message,
          details: { offering_id: offering.id, code: offering.code || null },
          is_resolved: false,
          created_at: now,
          updated_at: now,
        });
      }
    }

    if (inserts.length === 0) {
      return res.json({ skipped: false, scanned: (offerings || []).length, inserted: 0, message: 'All offerings are complete — no issues found.' });
    }

    // Insert in batches of 200
    const BATCH = 200;
    for (let i = 0; i < inserts.length; i += BATCH) {
      const { error: insertErr } = await supabaseAdmin
        .from('data_quality_notifications')
        .insert(inserts.slice(i, i + BATCH));
      if (insertErr) return res.status(500).json({ error: insertErr.message });
    }

    return res.json({ skipped: false, scanned: (offerings || []).length, inserted: inserts.length });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Debug endpoint: return count and sample rows
router.get('/course-offerings/debug', async (_req, res) => {
  try {
    const countResp = await supabaseAdmin
      .from('course_offering_notifications')
      .select('id', { count: 'exact', head: true });

    if (countResp.error) return res.status(500).json({ error: countResp.error.message });

    const sampleResp = await supabaseAdmin
      .from('course_offering_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (sampleResp.error) return res.status(500).json({ error: sampleResp.error.message });

    return res.json({ count: countResp.count ?? 0, sample: sampleResp.data ?? [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

function buildRoomNotification(room) {
  const missingFields = [];
  const issues = [];

  if (!room.room_name || String(room.room_name).trim() === '') {
    missingFields.push('room_name');
    issues.push({ message: 'Missing room name' });
  }

  if (!room.room_type || String(room.room_type).trim() === '') {
    missingFields.push('room_type');
    issues.push({ message: 'Missing room type' });
  }

  if (!room.room_status || String(room.room_status).trim() === '') {
    missingFields.push('room_status');
    issues.push({ message: 'Missing room status' });
  }

  return {
    room_id: room.room_id,
    title: room.room_name || `Room #${room.room_id}`,
    description: room.room_type || null,
    severity: missingFields.length > 0 ? 'high' : 'low',
    missing_fields: JSON.stringify(missingFields),
    issues: JSON.stringify(issues),
    metadata: JSON.stringify({}),
  };
}

// POST /api/notifications/rooms/sync
// Re-computes notifications for a single room after a save
router.post('/rooms/sync', async (req, res) => {
  try {
    const roomId = Number(req.body?.room_id);
    if (!roomId) return res.status(400).json({ error: 'room_id required' });

    const { error } = await supabaseAdmin.rpc('refresh_room_notifications', { p_room_id: roomId });
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ synced: true, room_id: roomId });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/notifications/rooms
router.get('/rooms', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from('room_notifications')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (req.query.is_resolved === 'false') {
      query = query.eq('is_resolved', false);
    } else if (req.query.is_resolved === 'true') {
      query = query.eq('is_resolved', true);
    }

    const { data, error, count } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ page, limit, total: count ?? 0, rows: data ?? [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/notifications/rooms/rescan-all
router.post('/rooms/rescan-all', async (_req, res) => {
  try {
    const { data: roomRows, error: fetchErr } = await supabaseAdmin
      .from('rooms')
      .select('room_id');

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    const { error: refreshErr } = await supabaseAdmin.rpc('refresh_all_room_notifications');
    if (refreshErr) return res.status(500).json({ error: refreshErr.message });

    return res.json({ scanned: (roomRows || []).length, refreshed: true });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Debug endpoint: return count and sample room notifications
router.get('/rooms/debug', async (_req, res) => {
  try {
    const countResp = await supabaseAdmin
      .from('room_notifications')
      .select('id', { count: 'exact', head: true });

    if (countResp.error) return res.status(500).json({ error: countResp.error.message });

    const sampleResp = await supabaseAdmin
      .from('room_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (sampleResp.error) return res.status(500).json({ error: sampleResp.error.message });

    return res.json({ count: countResp.count ?? 0, sample: sampleResp.data ?? [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Resolve a room notification
router.patch('/rooms/:id/resolve', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const resp = await supabaseAdmin
      .from('data_quality_notifications')
      .update({ is_resolved: true, updated_at: new Date().toISOString() })
      .eq('entity_type', 'room')
      .eq('entity_id', id)
      .eq('is_resolved', false);

    if (resp.error) return res.status(500).json({ error: resp.error.message });
    return res.json({ updated: resp.data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Faculty notifications (computed live)
router.get('/faculty', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 500)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabaseAdmin
      .from('faculty')
      .select('faculty_id, faculty_name, department_id, faculty_email, faculty_specialization, faculty_max_units, faculty_role, faculty_status, departments(department_id, department_name)', { count: 'exact' })
      .order('faculty_id', { ascending: true })
      .range(from, to);

    if (error) return res.status(500).json({ error: error.message });

    // Build notifications per faculty row when required fields are missing or look problematic
    const rows = (data || []).map((f) => {
      const missingFields = [];
      const issues = [];

      if (!f.faculty_name || String(f.faculty_name).trim() === '') {
        missingFields.push('faculty_name');
        issues.push({ message: 'Missing faculty name', field: 'faculty_name' });
      }

      if (!f.department_id) {
        missingFields.push('department_id');
        issues.push({ message: 'No department assigned', field: 'department_id' });
      }

      if (!f.faculty_role || String(f.faculty_role).trim() === '') {
        missingFields.push('faculty_role');
        issues.push({ message: 'Missing role/title', field: 'faculty_role' });
      }

      if (!f.faculty_status || String(f.faculty_status).trim() === '') {
        missingFields.push('faculty_status');
        issues.push({ message: 'Missing status (active/inactive/on-leave)', field: 'faculty_status' });
      }

      // low-severity: no specializations or max units
      if (!f.faculty_specialization || String(f.faculty_specialization).trim() === '') {
        issues.push({ message: 'No specializations provided', field: 'faculty_specialization' });
      }

      if (!f.faculty_max_units) {
        issues.push({ message: 'Max units not set', field: 'faculty_max_units' });
      }

      const severity = missingFields.length > 0 ? 'critical' : issues.length > 0 ? 'medium' : 'low';

      return {
        id: `faculty-${f.faculty_id}`,
        title: f.faculty_name || `Faculty #${f.faculty_id}`,
        description: f.departments?.department_name || null,
        severity,
        missingFields,
        issues,
        rowId: f.faculty_id,
        faculty: f,
      };
    });

    // filter to only items that need attention
    const filtered = rows.filter((r) => (r.missingFields && r.missingFields.length > 0) || (r.issues && r.issues.length > 0));

    return res.json({ page, limit, total: count ?? filtered.length, rows: filtered });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.get('/faculty/debug', async (_req, res) => {
  try {
    const resp = await supabaseAdmin
      .from('faculty')
      .select('faculty_id, faculty_name, faculty_email, faculty_role, faculty_status, faculty_specialization, faculty_max_units, department_id, departments(department_id, department_name)')
      .order('faculty_id', { ascending: true })
      .limit(20);

    if (resp.error) return res.status(500).json({ error: resp.error.message });
    return res.json({ sample: resp.data ?? [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Persisted faculty notifications endpoints
router.get('/faculty/persisted', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from('faculty_notifications')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (req.query.is_resolved === 'false') {
      query = query.eq('is_resolved', false);
    } else if (req.query.is_resolved === 'true') {
      query = query.eq('is_resolved', true);
    }

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ page, limit, total: count ?? 0, rows: data ?? [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.patch('/faculty/:id/resolve', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const resp = await supabaseAdmin
      .from('faculty_notifications')
      .update({ is_resolved: true, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (resp.error) return res.status(500).json({ error: resp.error.message });
    return res.json({ updated: resp.data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Subjects notifications (computed live)
router.get('/subjects', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 500)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabaseAdmin
      .from('subjects')
      .select('subject_id, subject_code, subject_descriptive_title, subject_units, subject_lec_hrs, subject_lab_hrs, mth_schedule, tfs_schedule, mth_room, tfs_room', { count: 'exact' })
      .order('subject_id', { ascending: true })
      .range(from, to);

    if (error) return res.status(500).json({ error: error.message });

    const rows = (data || []).map((s) => {
      const missingFields = [];
      const issues = [];

      if (!s.subject_code || String(s.subject_code).trim() === '') {
        missingFields.push('subject_code');
        issues.push({ message: 'Missing subject code' });
      }

      if (!s.subject_descriptive_title || String(s.subject_descriptive_title).trim() === '') {
        missingFields.push('subject_descriptive_title');
        issues.push({ message: 'Missing descriptive title' });
      }

      if (s.subject_units == null || Number(s.subject_units) <= 0) {
        missingFields.push('subject_units');
        issues.push({ message: 'Units not set or zero' });
      }

      if (!s.mth_schedule && !s.tfs_schedule) {
        issues.push({ message: 'No schedule set (MTH/TFS)' });
      }

      if (s.mth_schedule && !(s.mth_room || s.mth_room_id)) {
        missingFields.push('mth_room');
        issues.push({ message: 'Missing room assignment for MTH schedule' });
      }

      if (s.tfs_schedule && !(s.tfs_room || s.tfs_room_id)) {
        missingFields.push('tfs_room');
        issues.push({ message: 'Missing room assignment for TFS schedule' });
      }

      const severity = missingFields.length > 0 ? 'critical' : issues.length > 0 ? 'medium' : 'low';

      return {
        id: `subject-${s.subject_id}`,
        title: s.subject_descriptive_title || `Subject #${s.subject_id}`,
        description: s.subject_code || null,
        severity,
        missingFields,
        issues,
        rowId: s.subject_id,
        subject: s,
      };
    });

    const filtered = rows.filter((r) => (r.missingFields && r.missingFields.length > 0) || (r.issues && r.issues.length > 0));

    return res.json({ page, limit, total: count ?? filtered.length, rows: filtered });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.get('/subjects/debug', async (_req, res) => {
  try {
    const resp = await supabaseAdmin
      .from('subjects')
      .select('subject_id, subject_code, subject_descriptive_title, subject_units, mth_schedule, tfs_schedule, mth_room, tfs_room')
      .order('subject_id', { ascending: true })
      .limit(20);

    if (resp.error) return res.status(500).json({ error: resp.error.message });
    return res.json({ sample: resp.data ?? [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Persisted subject notifications
router.get('/subjects/persisted', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from('subject_notifications')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (req.query.is_resolved === 'false') {
      query = query.eq('is_resolved', false);
    } else if (req.query.is_resolved === 'true') {
      query = query.eq('is_resolved', true);
    }

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ page, limit, total: count ?? 0, rows: data ?? [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.patch('/subjects/:id/resolve', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const resp = await supabaseAdmin
      .from('subject_notifications')
      .update({ is_resolved: true, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (resp.error) return res.status(500).json({ error: resp.error.message });
    return res.json({ updated: resp.data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.delete('/clear-all', async (req, res) => {
  try {
    const [facultyResp, courseOfferingResp, roomResp, subjectResp] = await Promise.all([
      supabaseAdmin
        .from('faculty_notifications')
        .delete()
        .gte('id', 0)
        .select('id', { count: 'exact' }),
      supabaseAdmin
        .from('data_quality_notifications')
        .delete()
        .gte('id', 0)
        .select('id', { count: 'exact' }),
      supabaseAdmin
        .from('room_notifications')
        .delete()
        .gte('id', 0)
        .select('id', { count: 'exact' }),
      supabaseAdmin
        .from('subject_notifications')
        .delete()
        .gte('id', 0)
        .select('id', { count: 'exact' }),
    ]);

    if (facultyResp.error) return res.status(500).json({ error: facultyResp.error.message });
    if (courseOfferingResp.error) return res.status(500).json({ error: courseOfferingResp.error.message });
    if (roomResp.error) return res.status(500).json({ error: roomResp.error.message });
    if (subjectResp.error) return res.status(500).json({ error: subjectResp.error.message });

    const clearedCount =
      (facultyResp.data?.length ?? 0) +
      (courseOfferingResp.data?.length ?? 0) +
      (roomResp.data?.length ?? 0) +
      (subjectResp.data?.length ?? 0);

    return res.json({ cleared: clearedCount, message: `Cleared ${clearedCount} notifications` });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
