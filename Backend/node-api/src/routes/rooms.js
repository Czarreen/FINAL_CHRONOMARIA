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
      .from('rooms')
      .select('room_id, room_name, room_type, room_status', { count: 'exact' })
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

    return res.json({
      page,
      limit,
      total: count ?? 0,
      rows: data ?? [],
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

export default router;
