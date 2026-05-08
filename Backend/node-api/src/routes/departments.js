import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('departments')
      .select('department_id, department_name')
      .order('department_name', { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ rows: data ?? [] });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
