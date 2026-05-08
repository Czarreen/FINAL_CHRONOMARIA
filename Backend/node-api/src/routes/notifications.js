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

      // low-severity: no specializations or max units
      if (!f.faculty_specialization || String(f.faculty_specialization).trim() === '') {
        issues.push({ message: 'No specializations provided' });
      }

      if (!f.faculty_max_units) {
        issues.push({ message: 'Max units not set' });
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
