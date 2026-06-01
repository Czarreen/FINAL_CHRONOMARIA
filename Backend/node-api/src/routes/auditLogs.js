import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { pruneAuditLogsToLimit, recordAuditLog, requireSuperAdmin } from '../lib/auditLogger.js';

const router = Router();
const AUDIT_SORT_COLUMNS = new Set(['timestamp', 'username', 'action', 'module', 'description', 'status']);

function cleanFilterValue(value) {
  return String(value || '').trim();
}

function cleanSearchValue(value) {
  return cleanFilterValue(value).replace(/[,%]/g, ' ');
}

function applyAuditFilters(query, { search, moduleFilter, actionFilter, statusFilter } = {}) {
  const safeSearch = cleanSearchValue(search);

  if (safeSearch) {
    query = query.or(
      [
        `username.ilike.%${safeSearch}%`,
        `role.ilike.%${safeSearch}%`,
        `action.ilike.%${safeSearch}%`,
        `module.ilike.%${safeSearch}%`,
        `status.ilike.%${safeSearch}%`,
        `description.ilike.%${safeSearch}%`,
      ].join(',')
    );
  }

  if (moduleFilter) {
    query = query.ilike('module', moduleFilter);
  }

  if (actionFilter) {
    query = query.ilike('action', actionFilter);
  }

  if (statusFilter) {
    query = query.ilike('status', statusFilter);
  }

  return query;
}

async function countLogs(filters = {}, configure = (query) => query) {
  let query = supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true });

  query = applyAuditFilters(query, filters);
  query = configure(query);

  const { count, error } = await query;
  if (error) throw error;
  return Number(count ?? 0);
}

router.post('/logout', async (req, res) => {
  await recordAuditLog(req, {
    action: 'logout',
    module: 'authentication',
    description: 'User logged out',
  });

  return res.json({ success: true });
});

router.delete('/older-than-30-days', requireSuperAdmin, async (req, res) => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const { data, error } = await supabaseAdmin
      .from('audit_logs')
      .delete()
      .lt('timestamp', cutoff.toISOString())
      .select('id');

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const deletedCount = data?.length ?? 0;

    await recordAuditLog(req, {
      action: 'audit_logs_deleted',
      module: 'audit_logs',
      description: `Deleted ${deletedCount} audit log record(s) older than 30 days`,
      changes_after: {
        cutoff: cutoff.toISOString(),
        deleted_count: deletedCount,
      },
    });

    return res.json({
      success: true,
      deleted: deletedCount,
      cutoff: cutoff.toISOString(),
    });
  } catch (err) {
    console.error('Audit log cleanup error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.get('/', requireSuperAdmin, async (req, res) => {
  try {
    await pruneAuditLogsToLimit();

    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 25)));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const requestedSortBy = cleanFilterValue(req.query.sortBy);
    const sortBy = AUDIT_SORT_COLUMNS.has(requestedSortBy) ? requestedSortBy : 'timestamp';
    const sortOrder = String(req.query.sortOrder || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const filters = {
      search: cleanFilterValue(req.query.search),
      moduleFilter: cleanFilterValue(req.query.module),
      actionFilter: cleanFilterValue(req.query.action),
      statusFilter: cleanFilterValue(req.query.status),
    };

    let query = supabaseAdmin
      .from('audit_logs')
      .select(
        'id, timestamp, username, role, action, module, status, ip_address, description, changes_before, changes_after, user_agent, created_at',
        { count: 'exact' }
      );

    query = applyAuditFilters(query, filters);

    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    if (sortBy !== 'timestamp') {
      query = query.order('timestamp', { ascending: false });
    }

    const { data, error, count } = await query.range(from, to);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [todayCount, failedCount] = await Promise.all([
      countLogs(filters, (summaryQuery) => summaryQuery.gte('timestamp', startOfToday.toISOString())),
      filters.statusFilter
        ? Promise.resolve(String(filters.statusFilter).toLowerCase() === 'failed' ? Number(count ?? 0) : 0)
        : countLogs(filters, (summaryQuery) => summaryQuery.ilike('status', 'failed')),
    ]);

    const moduleOptionQuery = applyAuditFilters(
      supabaseAdmin
        .from('audit_logs')
        .select('module, username')
        .order('timestamp', { ascending: false })
        .range(0, 499),
      { ...filters, moduleFilter: '', actionFilter: '' }
    );

    const actionOptionQuery = applyAuditFilters(
      supabaseAdmin
        .from('audit_logs')
        .select('action')
        .order('timestamp', { ascending: false })
        .range(0, 499),
      { ...filters, actionFilter: '' }
    );

    const [
      { data: moduleOptionRows, error: moduleOptionError },
      { data: actionOptionRows, error: actionOptionError },
    ] = await Promise.all([moduleOptionQuery, actionOptionQuery]);

    if (moduleOptionError) {
      console.error('Audit module option query error:', moduleOptionError.message);
    }
    if (actionOptionError) {
      console.error('Audit action option query error:', actionOptionError.message);
    }

    const modules = [...new Set((moduleOptionRows || []).map((row) => row.module).filter(Boolean))].sort();
    const actions = [...new Set((actionOptionRows || []).map((row) => row.action).filter(Boolean))].sort();
    const uniqueUsers = new Set((moduleOptionRows || []).map((row) => row.username).filter(Boolean)).size;

    return res.json({
      page,
      limit,
      sortBy,
      sortOrder,
      total: Number(count ?? 0),
      rows: data || [],
      summary: {
        total: Number(count ?? 0),
        today: todayCount,
        failed: failedCount,
        users: uniqueUsers,
        modules: modules.length,
      },
      options: {
        modules,
        actions,
      },
    });
  } catch (err) {
    console.error('Audit logs route error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
