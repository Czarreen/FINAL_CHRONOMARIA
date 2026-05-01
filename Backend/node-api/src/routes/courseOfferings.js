import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabaseAdmin
      .from('course_offerings')
      .select(
        'id,curr_id,code,course_no,department_id,section,descriptive_title,units,lec_hrs,lab_hrs,mth_schedule,mth_room_id,tfs_schedule,tfs_room_id,departments!course_offerings_department_id_fkey(department_id,department_name)',
        { count: 'exact' }
      )
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      page,
      limit,
      total: count ?? 0,
      rows: data ?? [],
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
