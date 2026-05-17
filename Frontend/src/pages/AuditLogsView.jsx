import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Clock3,
  FileClock,
  Layers3,
  RefreshCcw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { deleteAuditLogsOlderThan30Days, fetchAuditLogs } from '../services/auditLogsApi.js';

const PAGE_SIZE = 25;
const AUDIT_COLUMNS = [
  { key: 'timestamp', label: 'Timestamp' },
  { key: 'username', label: 'User' },
  { key: 'action', label: 'Action' },
  { key: 'module', label: 'Module' },
  { key: 'description', label: 'Description' },
  { key: 'status', label: 'Status' },
];

const BASE_ACTIONS = [
  'login',
  'logout',
  'user_created',
  'user_updated',
  'user_deleted',
  'role_changed',
  'account_activated',
  'account_deactivated',
];

function formatAction(action) {
  return String(action || 'unknown')
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatTimestamp(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function getStatusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'failed' || normalized === 'error') {
    return 'bg-red-100 text-red-700';
  }
  return 'bg-emerald-100 text-emerald-700';
}

function getActionClass(action) {
  const normalized = String(action || '').toLowerCase();
  if (normalized.includes('delete') || normalized.includes('deactivated')) {
    return 'bg-red-50 text-red-700 ring-1 ring-red-100';
  }
  if (normalized.includes('role') || normalized.includes('activated')) {
    return 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100';
  }
  if (normalized.includes('login') || normalized.includes('logout')) {
    return 'bg-sky-50 text-sky-700 ring-1 ring-sky-100';
  }
  return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
}

function getAffectedRecord(log) {
  const row = log?.changes_after || log?.changes_before || {};
  if (row.username) return row.username;
  if (row.user_id) return `User #${row.user_id}`;
  return null;
}

export default function AuditLogsView({ currentUser, embedded = false }) {
  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState({});
  const [options, setOptions] = useState({ modules: [], actions: [] });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'timestamp', direction: 'desc' });
  const [loading, setLoading] = useState(true);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isSuperAdmin = currentUser?.role === 'super-admin';
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const moduleOptions = useMemo(() => {
    return [...new Set(['authentication', 'users', ...(options.modules || [])])].filter(Boolean).sort();
  }, [options.modules]);

  const actionOptions = useMemo(() => {
    return [...new Set([...BASE_ACTIONS, ...(options.actions || [])])].filter(Boolean).sort();
  }, [options.actions]);

  const loadLogs = async () => {
    if (!isSuperAdmin) return;

    try {
      setLoading(true);
      setError('');
      const response = await fetchAuditLogs({
        page,
        limit: PAGE_SIZE,
        search,
        module: moduleFilter,
        action: actionFilter,
        status: statusFilter,
        sortBy: sortConfig.key,
        sortOrder: sortConfig.direction,
      });
      setLogs(response.rows);
      setTotal(response.total);
      setSummary(response.summary || {});
      setOptions(response.options || { modules: [], actions: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs.');
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOldLogs = async () => {
    if (!isSuperAdmin || cleanupLoading) return;

    try {
      setCleanupLoading(true);
      setError('');
      setSuccess('');
      const result = await deleteAuditLogsOlderThan30Days();
      setSuccess(`Deleted ${result.deleted ?? 0} audit log record(s) older than 30 days.`);
      setPage(1);
      await loadLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete old audit logs.');
    } finally {
      setCleanupLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [isSuperAdmin, page, search, moduleFilter, actionFilter, statusFilter, sortConfig]);

  const resetPage = (setter) => (value) => {
    setPage(1);
    setter(value);
  };

  function handleSort(columnKey) {
    setPage(1);
    setSortConfig((currentSort) => ({
      key: columnKey,
      direction: currentSort.key === columnKey && currentSort.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  function sortHeaderClass(columnKey) {
    return `inline-flex w-full items-center justify-start gap-2 text-xs font-bold uppercase tracking-[0.22em] transition-colors ${
      sortConfig.key === columnKey ? 'text-primary' : 'text-slate-500 hover:text-on-surface'
    }`;
  }

  function renderSortIcon(columnKey) {
    if (sortConfig.key !== columnKey) {
      return <ArrowUpDown size={12} className="shrink-0" />;
    }

    return sortConfig.direction === 'asc'
      ? <ArrowUp size={12} className="shrink-0" />
      : <ArrowDown size={12} className="shrink-0" />;
  }

  if (!isSuperAdmin) {
    return (
      <div className={`space-y-6 ${embedded ? '' : 'animate-in fade-in duration-500'}`}>
        <div className="glass-panel flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">
          <ShieldCheck size={20} />
          <span className="text-sm font-semibold">Super-admin access required.</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${embedded ? '' : 'animate-in fade-in duration-500'}`}>
      {!embedded && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.32em] text-on-surface-variant/60">Security</p>
            <h2 className="mt-2 text-headline-xl font-headline-xl text-on-surface">Audit Logs</h2>
            <p className="mt-1 max-w-2xl text-body-md text-on-surface-variant">
              Review authentication and user administration activity from the existing audit log.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadLogs}
              className="flex items-center gap-2 rounded-xl border border-outline-variant bg-white px-5 py-3 text-sm font-semibold text-on-surface-variant shadow-sm transition-colors hover:bg-slate-50"
            >
              <RefreshCcw size={18} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleDeleteOldLogs}
              disabled={cleanupLoading}
              className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700 shadow-sm transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 size={18} />
              {cleanupLoading ? 'Deleting...' : 'Delete 30+ Days'}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center gap-3 text-on-surface-variant">
            <FileClock size={18} />
            <span className="text-xs font-bold uppercase tracking-[0.22em]">Total Logs</span>
          </div>
          <p className="mt-3 text-numeric-lg font-numeric-lg text-on-surface">{summary.total ?? total}</p>
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center gap-3 text-on-surface-variant">
            <Clock3 size={18} />
            <span className="text-xs font-bold uppercase tracking-[0.22em]">Today</span>
          </div>
          <p className="mt-3 text-numeric-lg font-numeric-lg text-on-surface">{summary.today ?? 0}</p>
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center gap-3 text-on-surface-variant">
            <AlertCircle size={18} />
            <span className="text-xs font-bold uppercase tracking-[0.22em]">Failed</span>
          </div>
          <p className="mt-3 text-numeric-lg font-numeric-lg text-on-surface">{summary.failed ?? 0}</p>
        </div>
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center gap-3 text-on-surface-variant">
            <UserRound size={18} />
            <span className="text-xs font-bold uppercase tracking-[0.22em]">Users</span>
          </div>
          <p className="mt-3 text-numeric-lg font-numeric-lg text-on-surface">{summary.users ?? 0}</p>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-5">
        {embedded && (
          <div className="mb-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={loadLogs}
              className="flex items-center gap-2 rounded-xl border border-outline-variant bg-white px-4 py-2.5 text-sm font-semibold text-on-surface-variant shadow-sm transition-colors hover:bg-slate-50"
            >
              <RefreshCcw size={16} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleDeleteOldLogs}
              disabled={cleanupLoading}
              className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 shadow-sm transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 size={16} />
              {cleanupLoading ? 'Deleting...' : 'Delete 30+ Days'}
            </button>
          </div>
        )}

        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full xl:max-w-md">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              value={search}
              onChange={(event) => resetPage(setSearch)(event.target.value)}
              placeholder="Search user, action, module, or description"
              className="w-full rounded-2xl border border-outline-variant bg-white/80 py-3 pl-11 pr-4 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {['', 'success', 'failed'].map((status) => (
              <button
                type="button"
                key={status || 'all'}
                onClick={() => resetPage(setStatusFilter)(status)}
                className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] transition-colors ${
                  statusFilter === status ? 'bg-primary text-white' : 'bg-white/80 text-on-surface-variant hover:bg-white'
                }`}
              >
                {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'All'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-2">
            <span className="block text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">Module</span>
            <select
              value={moduleFilter}
              onChange={(event) => resetPage(setModuleFilter)(event.target.value)}
              className="w-full rounded-2xl border border-outline-variant bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            >
              <option value="">All modules</option>
              {moduleOptions.map((moduleName) => (
                <option key={moduleName} value={moduleName}>
                  {formatAction(moduleName)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="block text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">Action</span>
            <select
              value={actionFilter}
              onChange={(event) => resetPage(setActionFilter)(event.target.value)}
              className="w-full rounded-2xl border border-outline-variant bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            >
              <option value="">All actions</option>
              {actionOptions.map((actionName) => (
                <option key={actionName} value={actionName}>
                  {formatAction(actionName)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <FileClock size={18} />
            <span>{success}</span>
          </div>
        )}

        <div className="mt-6 overflow-hidden rounded-2xl border border-white/60 bg-white/80">
          <div className="max-h-[560px] overflow-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50/95 text-xs font-bold uppercase tracking-[0.22em] text-slate-500 backdrop-blur">
                <tr>
                  {AUDIT_COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className="px-4 py-3"
                      aria-sort={
                        sortConfig.key === column.key
                          ? sortConfig.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={() => handleSort(column.key)}
                        className={sortHeaderClass(column.key)}
                      >
                        <span>{column.label}</span>
                        {renderSortIcon(column.key)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white/70">
                {loading ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-on-surface-variant" colSpan={6}>
                      Loading audit logs...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-on-surface-variant" colSpan={6}>
                      No audit logs found.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => {
                    const affectedRecord = getAffectedRecord(log);
                    return (
                      <tr key={log.id} className="transition-colors hover:bg-slate-50/80">
                        <td className="whitespace-nowrap px-4 py-4 text-xs text-on-surface-variant">
                          {formatTimestamp(log.timestamp || log.created_at)}
                        </td>
                        <td className="px-4 py-4">
                          <div className="font-semibold text-on-surface">{log.username || 'system'}</div>
                          <div className="text-xs text-on-surface-variant">{log.role || '-'}</div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${getActionClass(log.action)}`}>
                            {formatAction(log.action)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600">
                            <Layers3 size={12} />
                            {formatAction(log.module)}
                          </span>
                        </td>
                        <td className="min-w-[260px] px-4 py-4 text-on-surface-variant">
                          <div>{log.description || '-'}</div>
                          {affectedRecord && (
                            <div className="mt-1 text-xs text-on-surface-variant/70">Affected: {affectedRecord}</div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.2em] ${getStatusClass(log.status)}`}>
                            {log.status || 'success'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 text-sm text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
          <span>
            Page {page} of {totalPages} - {total} log{total === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={page <= 1 || loading}
              className="rounded-xl border border-outline-variant bg-white px-4 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              disabled={page >= totalPages || loading}
              className="rounded-xl border border-outline-variant bg-white px-4 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
