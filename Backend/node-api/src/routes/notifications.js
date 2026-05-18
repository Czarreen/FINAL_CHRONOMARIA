import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { recordAuditLog } from '../lib/auditLogger.js';
import { buildSubjectNotificationIssues, buildSubjectNotificationRows, rescanAllSubjectNotifications } from '../lib/subjectNotifications.js';
import { buildOfferingNotificationIssues, upsertOfferingNotificationCache, rescanAllOfferingNotifications } from '../lib/courseOfferingNotifications.js';
import { findConflictingSchedules, isRoomGym, parseScheduleString, timeRangesOverlap } from '../lib/scheduleConflictChecker.js';

const router = Router();
const COURSE_OFFERING_AUDIT_MODULE = 'course_offerings';

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

    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from('data_quality_notifications')
      .select('id, entity_type, entity_id, field_name, issue_type, severity, message, details, is_resolved, created_at, updated_at')
      .eq('id', id)
      .eq('entity_type', 'course_offering')
      .limit(1);

    if (existingError) return res.status(500).json({ error: existingError.message });
    if (!existingRows || existingRows.length === 0) return res.status(404).json({ error: 'Notification not found' });

    const existing = existingRows[0];
    const resp = await supabaseAdmin
      .from('data_quality_notifications')
      .update({ is_resolved: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('entity_type', 'course_offering')
      .select('id, entity_type, entity_id, field_name, issue_type, severity, message, details, is_resolved, created_at, updated_at')
      .single();

    if (resp.error) return res.status(500).json({ error: resp.error.message });

    await recordAuditLog(req, {
      action: 'course_offering_notification_resolved',
      module: COURSE_OFFERING_AUDIT_MODULE,
      description: `Resolved course offering notification for ${existing.details?.code || `#${existing.entity_id}`}`,
      changes_before: existing,
      changes_after: resp.data,
    });

    return res.json({ updated: resp.data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/notifications/course-offerings/sync
// Re-computes notifications for a single offering after a save
router.post('/course-offerings/sync', async (req, res) => {
  try {
    const offeringId = Number(req.body?.offering_id);
    if (!offeringId) return res.status(400).json({ error: 'offering_id required' });

    const result = await upsertOfferingNotificationCache(offeringId);
    return res.json({ synced: result.updated, issues: result.issues });
  } catch (err) {
    if (String(err.message || '').includes('Offering not found')) {
      return res.status(404).json({ error: err.message });
    }
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/notifications/course-offerings/rescan-all
// Scans ALL course offerings and rebuilds the notification table.
// Only runs when the table is empty; otherwise returns { skipped: true }.
router.post('/course-offerings/rescan-all', async (req, res) => {
  try {
    const force = req.body?.force === true || req.query?.force === 'true';
    const result = await rescanAllOfferingNotifications({ force });

    if (result.skipped) {
      return res.json({ skipped: true, count: result.count, message: 'Table already has data — use force=true to rescan.' });
    }

    if (force) {
      await recordAuditLog(req, {
        action: 'course_offering_notifications_rescanned',
        module: COURSE_OFFERING_AUDIT_MODULE,
        description: `Rescanned course offering notifications (${result.scanned} scanned, ${result.inserted} issue(s) found)`,
        changes_after: { force, scanned: result.scanned, inserted: result.inserted },
      });
    }

    return res.json({ skipped: false, scanned: result.scanned, inserted: result.inserted });
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

// Debug endpoint: test conflict detection between two offerings
router.get('/course-offerings/test-conflict/:id1/:id2', async (req, res) => {
  try {
    const id1 = Number(req.params.id1);
    const id2 = Number(req.params.id2);
    if (!id1 || !id2) return res.status(400).json({ error: 'Both id1 and id2 required' });

    const { data: offerings, error: fetchErr } = await supabaseAdmin
      .from('course_offerings')
      .select('id, code, course_no, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id')
      .in('id', [id1, id2]);

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    const offering1 = offerings?.find(o => o.id === id1);
    const offering2 = offerings?.find(o => o.id === id2);

    if (!offering1 || !offering2) {
      return res.status(404).json({ error: `One or both offerings not found (${id1}, ${id2})` });
    }

    const helper = (roomValue) => (roomValue === null || roomValue === undefined || String(roomValue).trim() === '' ? null : String(roomValue).trim());
    const parseRoomIds = (roomStr) => {
      if (!roomStr) return [];
      return String(roomStr).split('/').map(r => r.trim()).filter(r => r !== '');
    };
    const roomsShareId = (rooms1, rooms2) => {
      const ids1 = new Set(parseRoomIds(rooms1));
      const ids2 = new Set(parseRoomIds(rooms2));
      for (const id of ids1) {
        if (ids2.has(id)) return true;
      }
      return false;
    };

    const mthParsed1 = parseScheduleString(offering1.mth_schedule);
    const tfsParsed1 = parseScheduleString(offering1.tfs_schedule);
    const mthParsed2 = parseScheduleString(offering2.mth_schedule);
    const tfsParsed2 = parseScheduleString(offering2.tfs_schedule);

    const mthRoom1 = helper(offering1.mth_room_id);
    const tfsRoom1 = helper(offering1.tfs_room_id);
    const mthRoom2 = helper(offering2.mth_room_id);
    const tfsRoom2 = helper(offering2.tfs_room_id);

    const analysis = {
      mth: {
        rooms_share_id: mthRoom1 && mthRoom2 ? roomsShareId(mthRoom1, mthRoom2) : false,
        times_overlap: mthParsed1 && mthParsed2 ? timeRangesOverlap(mthParsed1.startTime, mthParsed1.endTime, mthParsed2.startTime, mthParsed2.endTime) : false,
        days_overlap: (mthParsed1 && mthParsed2) ? mthParsed1.days.filter(d => mthParsed2.days.includes(d)) : [],
      },
      tfs: {
        rooms_share_id: tfsRoom1 && tfsRoom2 ? roomsShareId(tfsRoom1, tfsRoom2) : false,
        times_overlap: tfsParsed1 && tfsParsed2 ? timeRangesOverlap(tfsParsed1.startTime, tfsParsed1.endTime, tfsParsed2.startTime, tfsParsed2.endTime) : false,
        days_overlap: (tfsParsed1 && tfsParsed2) ? tfsParsed1.days.filter(d => tfsParsed2.days.includes(d)) : [],
      },
    };

    const conflicts = findConflictingSchedules(offering1, [offering1, offering2], false);

    return res.json({
      offering1: {
        id: offering1.id,
        code: offering1.code,
        course_no: offering1.course_no,
        mth_schedule: offering1.mth_schedule,
        mth_room_id: mthRoom1,
        tfs_schedule: offering1.tfs_schedule,
        tfs_room_id: tfsRoom1,
        parsed_mth: mthParsed1,
        parsed_tfs: tfsParsed1,
      },
      offering2: {
        id: offering2.id,
        code: offering2.code,
        course_no: offering2.course_no,
        mth_schedule: offering2.mth_schedule,
        mth_room_id: mthRoom2,
        tfs_schedule: offering2.tfs_schedule,
        tfs_room_id: tfsRoom2,
        parsed_mth: mthParsed2,
        parsed_tfs: tfsParsed2,
      },
      analysis,
      conflicts_found: conflicts,
      conflict_detected: conflicts.length > 0,
    });
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
      const issues = buildSubjectNotificationIssues(s);

      return issues.map(({ field_name, issue_type, severity: issueSeverity, message }) => ({
        id: `subject-${s.subject_id}-${field_name}`,
        title: s.subject_descriptive_title || `Subject #${s.subject_id}`,
        description: s.subject_code || null,
        severity: issueSeverity,
        missingFields: [field_name],
        issues: [{
          field: field_name,
          field_name,
          issue_type,
          severity: issueSeverity,
          message,
        }],
        rowId: s.subject_id,
        subject: s,
      }));
    });

    const filtered = rows.flat().filter((r) => (r.missingFields && r.missingFields.length > 0) || (r.issues && r.issues.length > 0));

    return res.json({ page, limit, total: filtered.length, rows: filtered });
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

// Persisted subject notifications — enriched with subject data in a single batch query
// This avoids the N+1 problem where the frontend had to call fetchSubjectById for each notification
router.get('/subjects/persisted', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 50)));
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

    const { data: rows, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const notifRows = rows ?? [];

    // Batch-fetch subject info for all unique entity_ids in one query
    const uniqueSubjectIds = [...new Set(notifRows.map((r) => r.entity_id).filter(Boolean))];
    let subjectById = {};
    if (uniqueSubjectIds.length > 0) {
      const { data: subjects } = await supabaseAdmin
        .from('subjects')
        .select('subject_id, subject_code, subject_descriptive_title, subject_units, subject_lec_hrs, subject_lab_hrs, mth_schedule, tfs_schedule, mth_room, tfs_room, subject_status, curr_id, department_id')
        .in('subject_id', uniqueSubjectIds);
      for (const s of (subjects || [])) {
        subjectById[s.subject_id] = s;
      }
    }

    // Merge subject data into each notification row
    const enrichedRows = notifRows.map((r) => ({
      ...r,
      subject: subjectById[r.entity_id] ?? null,
      subject_code: subjectById[r.entity_id]?.subject_code ?? null,
      subject_descriptive_title: subjectById[r.entity_id]?.subject_descriptive_title ?? null,
    }));

    return res.json({ page, limit, total: count ?? 0, rows: enrichedRows });
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

router.post('/subjects/sync', async (req, res) => {
  try {
    const subjectId = Number(req.body?.subject_id);
    if (!subjectId) return res.status(400).json({ error: 'subject_id required' });

    const { data, error } = await supabaseAdmin
      .from('subjects')
      .select('subject_id, subject_code, subject_descriptive_title, subject_units, mth_schedule, tfs_schedule, mth_room, tfs_room, curr_id, department_id, subject_course_no')
      .eq('subject_id', subjectId)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Subject not found' });

    const { data: allSubjects, error: allError } = await supabaseAdmin
      .from('subjects')
      .select('subject_id, subject_code, mth_schedule, tfs_schedule, mth_room, tfs_room, curr_id, department_id, subject_course_no');

    if (allError) return res.status(500).json({ error: allError.message });

    const rows = buildSubjectNotificationRows(data, allSubjects || []);
    await supabaseAdmin.from('subject_notifications').delete().eq('entity_id', subjectId);

    if (rows.length === 0) {
      return res.json({ synced: 0, issues: [] });
    }

    const now = new Date().toISOString();
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('subject_notifications')
      .insert(rows.map((row) => ({
        ...row,
        is_resolved: false,
        created_at: now,
        updated_at: now,
      })))
      .select();

    if (insertError) return res.status(500).json({ error: insertError.message });
    return res.json({ synced: inserted?.length ?? 0, issues: inserted ?? [] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.post('/subjects/rescan-all', async (_req, res) => {
  try {
    const result = await rescanAllSubjectNotifications();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/notifications/rescan-all-entities
// Rescans both course offering and subject notifications in one call.
router.post('/rescan-all-entities', async (req, res) => {
  try {
    const force = req.body?.force === true || req.query?.force === 'true';
    const [coResult, subjectResult] = await Promise.all([
      rescanAllOfferingNotifications({ force }),
      rescanAllSubjectNotifications(),
    ]);
    return res.json({
      courseOfferings: { skipped: coResult.skipped ?? false, scanned: coResult.scanned ?? 0, inserted: coResult.inserted ?? 0 },
      subjects: { scanned: subjectResult.scanned, inserted: subjectResult.inserted },
    });
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

// POST /api/notifications/faculty/sync
// Re-computes notifications for a single faculty member after a save
router.post('/faculty/sync', async (req, res) => {
  try {
    const facultyId = Number(req.body?.faculty_id || req.body?.id);
    if (!facultyId) return res.status(400).json({ error: 'faculty_id required' });

    const { data: f, error: fetchErr } = await supabaseAdmin
      .from('faculty')
      .select('faculty_id, faculty_name, department_id, faculty_email, faculty_role, faculty_specialization, faculty_max_units, faculty_status, departments(department_id, department_name)')
      .eq('faculty_id', facultyId)
      .single();

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!f) return res.status(404).json({ error: 'Faculty not found' });

    // Compute missing fields / issues similar to faculty PATCH logic
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
      const { error: updErr } = await supabaseAdmin
        .from('faculty_notifications')
        .update({ is_resolved: true, updated_at: new Date().toISOString() })
        .eq('faculty_id', f.faculty_id);
      if (updErr) return res.status(500).json({ error: updErr.message });
      return res.json({ synced: 0, resolved: true });
    }

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

    const { data: upserted, error: upsertErr } = await supabaseAdmin
      .from('faculty_notifications')
      .upsert(payload, { onConflict: 'faculty_id' })
      .select();

    if (upsertErr) return res.status(500).json({ error: upsertErr.message });
    return res.json({ synced: (upserted?.length ?? 0) || 1, issues: upserted ?? [payload] });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;

