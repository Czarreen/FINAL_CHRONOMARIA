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
