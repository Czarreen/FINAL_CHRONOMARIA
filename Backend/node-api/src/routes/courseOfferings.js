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

// POST - Create new course offering
router.post('/', async (req, res) => {
  try {
    const { code, course_no, descriptive_title, curr_id, department_id, section, units, lec_hrs, lab_hrs, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Course code is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('course_offerings')
      .insert([{
        code,
        course_no,
        descriptive_title,
        curr_id,
        department_id,
        section,
        units,
        lec_hrs,
        lab_hrs,
        mth_schedule,
        mth_room_id,
        tfs_schedule,
        tfs_room_id,
      }])
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data?.[0] ?? {});
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// PUT - Update course offering
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { code, course_no, descriptive_title, curr_id, department_id, section, units, lec_hrs, lab_hrs, mth_schedule, mth_room_id, tfs_schedule, tfs_room_id } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Course code is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('course_offerings')
      .update({
        code,
        course_no,
        descriptive_title,
        curr_id,
        department_id,
        section,
        units,
        lec_hrs,
        lab_hrs,
        mth_schedule,
        mth_room_id,
        tfs_schedule,
        tfs_room_id,
      })
      .eq('id', id)
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Course offering not found' });
    }

    return res.json(data[0]);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// DELETE - Delete course offering
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('course_offerings')
      .delete()
      .eq('id', id)
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Course offering not found' });
    }

    return res.json({ success: true, deleted: data[0] });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
