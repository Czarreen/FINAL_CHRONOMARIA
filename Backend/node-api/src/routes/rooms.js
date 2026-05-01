import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

// GET - Fetch rooms with pagination
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

// POST - Create a new room
router.post('/', async (req, res) => {
  try {
    const { room_name, room_type, room_status } = req.body;

    if (!room_name) {
      return res.status(400).json({ error: 'room_name is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('rooms')
      .insert([
        {
          room_name,
          room_type: room_type || null,
          room_status: room_status || 'available',
        },
      ])
      .select();

    if (error) {
      console.error('Room creation error:', error);
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json({
      success: true,
      message: 'Room created successfully',
      data: data[0],
    });
  } catch (err) {
    console.error('Room creation route error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// PUT - Update a room
router.put('/:room_id', async (req, res) => {
  try {
    const { room_id } = req.params;
    const { room_name, room_type, room_status } = req.body;

    if (!room_id) {
      return res.status(400).json({ error: 'room_id is required' });
    }

    const updateData = {};
    if (room_name !== undefined) updateData.room_name = room_name;
    if (room_type !== undefined) updateData.room_type = room_type;
    if (room_status !== undefined) updateData.room_status = room_status;

    const { data, error } = await supabaseAdmin
      .from('rooms')
      .update(updateData)
      .eq('room_id', room_id)
      .select();

    if (error) {
      console.error('Room update error:', error);
      return res.status(400).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    return res.json({
      success: true,
      message: 'Room updated successfully',
      data: data[0],
    });
  } catch (err) {
    console.error('Room update route error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE - Delete a room
router.delete('/:room_id', async (req, res) => {
  try {
    const { room_id } = req.params;

    if (!room_id) {
      return res.status(400).json({ error: 'room_id is required' });
    }

    const { error } = await supabaseAdmin
      .from('rooms')
      .delete()
      .eq('room_id', room_id);

    if (error) {
      console.error('Room deletion error:', error);
      return res.status(400).json({ error: error.message });
    }

    return res.json({
      success: true,
      message: 'Room deleted successfully',
    });
  } catch (err) {
    console.error('Room deletion route error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
