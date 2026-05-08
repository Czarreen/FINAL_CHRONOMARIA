import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const search = req.query.search?.trim() || '';
    const status = req.query.status || '';

    let query = supabaseAdmin
      .from('faculty')
      .select(
        'faculty_id, faculty_name, department_id, faculty_email, faculty_specialization, faculty_max_units, faculty_role, faculty_status, departments(department_id, department_name)',
        { count: 'exact' }
      );

    if (search) {
      query = query.or(
        `faculty_name.ilike.%${search}%,faculty_email.ilike.%${search}%,faculty_role.ilike.%${search}%,faculty_specialization.ilike.%${search}%`
      );
    }

    if (status) {
      query = query.ilike('faculty_status', status);
    }

    const { data, error, count } = await query
      .order('faculty_id', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('Faculty query error:', error);
      return res.status(500).json({ error: error.message });
    }

    const { data: allStatuses, error: activeCountError } = await supabaseAdmin
      .from('faculty')
      .select('faculty_status');

    if (activeCountError) {
      console.error('Faculty active count error:', activeCountError);
    }

    const activeCount = Array.isArray(allStatuses)
      ? allStatuses.filter((member) => String(member.faculty_status ?? '').trim().toLowerCase() === 'active').length
      : 0;

    return res.json({
      page,
      limit,
      total: count ?? 0,
      activeCount: activeCount ?? 0,
      rows: data ?? [],
    });
  } catch (err) {
    console.error('Faculty route error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const facultyData = req.body;
    const allowedFields = [
      'faculty_name',
      'department_id',
      'faculty_email',
      'faculty_specialization',
      'faculty_max_units',
      'faculty_role',
      'faculty_status',
    ];

    const sanitizedData = {};
    for (const field of allowedFields) {
      if (field in facultyData) {
        sanitizedData[field] = facultyData[field];
      }
    }

    if (!sanitizedData.faculty_name) {
      return res.status(400).json({ error: 'faculty_name is required' });
    }

    if (!sanitizedData.faculty_status) {
      sanitizedData.faculty_status = 'active';
    }

    const { data, error } = await supabaseAdmin
      .from('faculty')
      .insert(sanitizedData)
      .select('faculty_id, faculty_name, department_id, faculty_email, faculty_specialization, faculty_max_units, faculty_role, faculty_status, departments(department_id, department_name)')
      .single();

    if (error) {
      console.error('Create faculty error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('faculty')
      .select('faculty_id, faculty_name, department_id, faculty_email, faculty_specialization, faculty_max_units, faculty_role, faculty_status, departments(department_id, department_name)')
      .eq('faculty_id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Faculty member not found' });
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

router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = [
      'faculty_name',
      'department_id',
      'faculty_email',
      'faculty_specialization',
      'faculty_max_units',
      'faculty_role',
      'faculty_status',
    ];

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
      .from('faculty')
      .update(sanitizedUpdates)
      .eq('faculty_id', id)
      .select('faculty_id, faculty_name, department_id, faculty_email, faculty_specialization, faculty_max_units, faculty_role, faculty_status, departments(department_id, department_name)')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Faculty member not found' });
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

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('faculty')
      .delete()
      .eq('faculty_id', id)
      .select('faculty_id')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Faculty member not found' });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      success: true,
      deletedFacultyId: data?.faculty_id ?? Number(id),
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
