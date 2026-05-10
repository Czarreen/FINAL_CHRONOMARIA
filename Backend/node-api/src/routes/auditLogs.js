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
    const user = req.query.user?.trim() || '';
    const role = req.query.role?.trim() || '';
    const module = req.query.module?.trim() || '';
    const status = req.query.status?.trim() || '';
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';

    let query = supabaseAdmin
      .from('audit_logs')
      .select(
        'id, timestamp, username, role, action, module, status, ip_address, description, changes_before, changes_after, user_agent',
        { count: 'exact' }
      );

    if (search) {
      query = query.or(`username.ilike.%${search}%,action.ilike.%${search}%,module.ilike.%${search}%`);
    }

    if (user) {
      query = query.eq('username', user);
    }

    if (role) {
      query = query.eq('role', role);
    }

    if (module) {
      query = query.eq('module', module);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (startDate) {
      query = query.gte('timestamp', `${startDate}T00:00:00`);
    }

    if (endDate) {
      query = query.lte('timestamp', `${endDate}T23:59:59`);
    }

    const { data, error, count } = await query
      .order('timestamp', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('Audit logs query error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      page,
      limit,
      total: count ?? 0,
      rows: data ?? [],
    });
  } catch (err) {
    console.error('Audit logs route error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const { username, role, action, module, status, description, changes_before, changes_after } = req.body;

    if (!action || !module) {
      return res.status(400).json({ error: 'action and module are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('audit_logs')
      .insert({
        username: username || 'unknown',
        role: role || 'staff',
        action,
        module,
        status: status || 'success',
        description: description || null,
        changes_before: changes_before || null,
        changes_after: changes_after || null,
        ip_address: req.ip || null,
        user_agent: req.headers['user-agent'] || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Audit log insert error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error('Audit log create route error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const logId = String(req.params.id);

    if (!logId) {
      return res.status(400).json({ error: 'Invalid log ID' });
    }

    const { data, error } = await supabaseAdmin
      .from('audit_logs')
      .select('*')
      .eq('id', logId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Log not found' });
      }
      console.error('Audit log fetch error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  } catch (err) {
    console.error('Audit log fetch route error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.get('/export', async (req, res) => {
  try {
    const format = req.query.format || 'csv';
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';

    let query = supabaseAdmin
      .from('audit_logs')
      .select('timestamp, username, role, action, module, status, ip_address, description');

    if (startDate) {
      query = query.gte('timestamp', `${startDate}T00:00:00`);
    }

    if (endDate) {
      query = query.lte('timestamp', `${endDate}T23:59:59`);
    }

    const { data, error } = await query.order('timestamp', { ascending: false });

    if (error) {
      console.error('Audit logs export error:', error);
      return res.status(500).json({ error: error.message });
    }

    if (format === 'csv') {
      // Convert to CSV
      const headers = ['Timestamp', 'Username', 'Role', 'Action', 'Module', 'Status', 'IP Address', 'Description'];
      const rows = (data || []).map((log) => [
        log.timestamp,
        log.username,
        log.role,
        log.action,
        log.module,
        log.status,
        log.ip_address,
        log.description || '',
      ]);

      const csv = [
        headers.join(','),
        ...rows.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send(csv);
    }

    return res.json(data);
  } catch (err) {
    console.error('Audit logs export route error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

router.delete('/clear', async (req, res) => {
  try {
    const daysOld = Number(req.body.daysOld || 90);

    if (daysOld < 1) {
      return res.status(400).json({ error: 'daysOld must be at least 1' });
    }

    // Calculate date 'daysOld' days ago
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffISO = cutoffDate.toISOString();

    const { data, error: deleteError, count } = await supabaseAdmin
      .from('audit_logs')
      .delete()
      .lt('timestamp', cutoffISO);

    if (deleteError) {
      console.error('Audit logs clear error:', deleteError);
      return res.status(500).json({ error: deleteError.message });
    }

    return res.json({
      message: `Deleted logs older than ${daysOld} days`,
      deletedCount: count ?? 0,
    });
  } catch (err) {
    console.error('Audit logs clear route error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

export default router;
