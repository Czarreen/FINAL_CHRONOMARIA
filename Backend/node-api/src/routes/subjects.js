import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

// GET all subjects with pagination and filtering
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const search = req.query.search?.trim() || '';
    const status = req.query.status || '';

    let query = supabaseAdmin
      .from('subjects')
      .select('*', { count: 'exact' });

// Apply search filter (search in code and descriptive title)
    if (search) {
      query = query.or(`subject_code.ilike.%${search}%,subject_descriptive_title.ilike.%${search}%`);
    }

    // Apply status filter
    if (status) {
      query = query.eq('subject_status', status);
    }

    const { data, error, count } = await query
      .order('subject_code', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    // Get count of active subjects (independent of current filters)
    const { count: activeCount, error: activeCountError } = await supabaseAdmin
      .from('subjects')
      .select('*', { count: 'exact' })
      .eq('subject_status', 'active');

    if (activeCountError) {
      console.error('Error fetching active count:', activeCountError);
    }

    return res.json({
      page,
      limit,
      total: count ?? 0,
      activeCount: activeCount ?? 0,
      rows: data ?? [],
    });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// POST create a new subject
router.post('/', async (req, res) => {
  try {
    const subjectData = req.body;

    // Define required and allowed fields
    const allowedFields = [
      'subject_code',
      'subject_course_no',
      'subject_descriptive_title',
      'subject_units',
      'subject_lec_hrs',
      'subject_lab_hrs',
      'subject_status',
    ];

    const sanitizedData = {};
    for (const field of allowedFields) {
      if (field in subjectData) {
        sanitizedData[field] = subjectData[field];
      }
    }

    // Set default status if not provided
    if (!sanitizedData.subject_status) {
      sanitizedData.subject_status = 'active';
    }

    if (!sanitizedData.subject_code) {
      return res.status(400).json({ error: 'subject_code is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('subjects')
      .insert(sanitizedData)
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// GET single subject by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('subjects')
      .select('*')
      .eq('subject_id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Subject not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// PATCH update subject (primarily for status)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Only allow certain fields to be updated
    const allowedFields = ['subject_code', 'subject_course_no', 'subject_descriptive_title', 'subject_units', 'subject_lec_hrs', 'subject_lab_hrs', 'subject_status'];
    const sanitizedUpdates = {};

    for (const field of allowedFields) {
      if (field in updates) {
        sanitizedUpdates[field] = updates[field];
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabaseAdmin
      .from('subjects')
      .update(sanitizedUpdates)
      .eq('subject_id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Subject not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// DELETE subject
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('subjects')
      .delete()
      .eq('subject_id', id)
      .select('subject_id')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Subject not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      success: true,
      deletedSubjectId: data?.subject_id ?? Number(id),
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

// POST bulk make all subjects active
router.post('/bulk/activate-all', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('subjects')
      .update({ subject_status: 'active' })
      .gte('subject_id', 0)
      .select('subject_id');

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      success: true,
      message: 'All subjects activated',
      updated: data?.length ?? 0,
    });
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
