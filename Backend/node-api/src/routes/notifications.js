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

export default router;

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
    // Delete all unresolved notifications from both tables
    const [facultyResp, courseOfferingResp] = await Promise.all([
      supabaseAdmin
        .from('faculty_notifications')
        .delete()
        .eq('is_resolved', false),
      supabaseAdmin
        .from('data_quality_notifications')
        .delete()
        .eq('is_resolved', false),
    ]);

    if (facultyResp.error) return res.status(500).json({ error: facultyResp.error.message });
    if (courseOfferingResp.error) return res.status(500).json({ error: courseOfferingResp.error.message });

    const clearedCount = (facultyResp.count ?? 0) + (courseOfferingResp.count ?? 0);
    return res.json({ cleared: clearedCount, message: `Cleared ${clearedCount} unresolved notifications` });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
