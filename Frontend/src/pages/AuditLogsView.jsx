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
  X,
} from 'lucide-react';
import { deleteAuditLogsOlderThan30Days, fetchAuditLogs } from '../services/auditLogsApi.js';
import { fetchDepartments } from '../services/departmentsApi.js';

const PAGE_SIZE = 25;
const DESCRIPTION_PREVIEW_LENGTH = 120;
const AUDIT_COLUMNS = [
  { key: 'timestamp', label: 'Timestamp' },
  { key: 'username', label: 'User' },
  { key: 'action', label: 'Action' },
  { key: 'module', label: 'Module' },
  { key: 'description', label: 'Description' },
  { key: 'status', label: 'Status' },
];

const BASE_ACTIONS_BY_MODULE = {
  authentication: ['login', 'logout'],
  users: [
    'user_created',
    'user_updated',
    'user_deleted',
    'role_changed',
    'account_activated',
    'account_deactivated',
  ],
  course_offerings: [
    'course_offering_created',
    'course_offering_updated',
    'course_offering_deleted',
    'course_offerings_imported',
    'course_offerings_exported',
    'course_offering_notification_resolved',
    'course_offering_notifications_rescanned',
  ],
  rooms: [
    'room_created',
    'room_updated',
    'room_deleted',
    'room_notification_resolved',
    'room_notifications_rescanned',
  ],
};

const BASE_ACTIONS = Object.values(BASE_ACTIONS_BY_MODULE).flat();

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
  if (row.room_name) return row.room_name;
  if (row.room_id) return `Room #${row.room_id}`;
  return null;
}

const FIELD_LABELS = {
  created_at: 'Created At',
  updated_at: 'Updated At',
  user_id: 'User ID',
  username: 'Username',
  email: 'Email',
  role: 'Role',
  status: 'Status',
  room_id: 'Room ID',
  room_name: 'Room Name',
  room_type: 'Room Type',
  room_status: 'Room Status',
  room_department_id: 'Primary Department',
  room_department_ids: 'Departments',
  room_department_names: 'Departments',
  department_id: 'Department',
};

const DEPARTMENT_FIELD_KEYS = new Set(['department_id', 'room_department_id', 'room_department_ids', 'room_department_names']);
const HIDDEN_AUDIT_DETAIL_KEYS = new Set([
  'id',
  'user_id',
  'room_id',
  'entity_id',
  'subject_id',
  'faculty_id',
  'offering_id',
  'course_offering_id',
  'facloading_id',
]);

function shouldHideAuditDetailKey(key, source = {}) {
  if (HIDDEN_AUDIT_DETAIL_KEYS.has(key)) return true;
  if (key === 'curr_id') return true;
  if (['room_department_id', 'room_department_ids'].includes(key) && source?.room_department_names !== undefined) return true;
  return false;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatFieldLabel(key) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return String(key || 'Field')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function normalizeDetailValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDetailValue(item));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, normalizeDetailValue(nestedValue)])
    );
  }
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.trim() || null;
  return value;
}

function areDetailValuesEqual(beforeValue, afterValue) {
  return JSON.stringify(normalizeDetailValue(beforeValue)) === JSON.stringify(normalizeDetailValue(afterValue));
}

function formatDetailValue(value) {
  const normalized = normalizeDetailValue(value);
  if (normalized === null) return 'none';
  if (Array.isArray(normalized)) {
    if (normalized.length === 0) return 'none';
    if (normalized.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      return normalized.map((item) => (item === null ? 'none' : String(item))).join(', ');
    }
    return JSON.stringify(normalized, null, 2);
  }
  if (isPlainObject(normalized)) return JSON.stringify(normalized, null, 2);
  return String(normalized);
}

function isBooleanDetailValue(value) {
  return typeof normalizeDetailValue(value) === 'boolean';
}

function hasRenderableDetailValue(value) {
  const normalized = normalizeDetailValue(value);
  if (typeof normalized === 'boolean') return false;
  if (Array.isArray(normalized)) return normalized.some(hasRenderableDetailValue);
  if (isPlainObject(normalized)) {
    return Object.values(normalized).some(hasRenderableDetailValue);
  }
  return true;
}

function getDescriptionParts(description) {
  const text = String(description || '').trim();
  if (!text) return ['No description provided.'];
  return text.split(/\s*;\s*/).map((part) => part.trim()).filter(Boolean);
}

function getDescriptionPreview(description) {
  return getDescriptionParts(description).join(', ');
}

function getAuditChangeItems(log) {
  const before = log?.changes_before;
  const after = log?.changes_after;
  const action = String(log?.action || '').toLowerCase();

  if (before === undefined && after === undefined) return [];

  if (!isPlainObject(before) || !isPlainObject(after)) {
    if (isPlainObject(before) || isPlainObject(after)) {
      const source = isPlainObject(after) ? after : before;
      const mode = !isPlainObject(before) && isPlainObject(after)
        ? 'created'
        : isPlainObject(before) && !isPlainObject(after)
          ? 'deleted'
          : 'changed';
      return Object.keys(source || {})
        .filter((key) => !shouldHideAuditDetailKey(key, source))
        .sort()
        .filter((key) => !isBooleanDetailValue(source?.[key]))
        .map((key) => ({
          key,
          label: formatFieldLabel(key),
          beforeValue: isPlainObject(before) ? before[key] : undefined,
          afterValue: isPlainObject(after) ? after[key] : undefined,
          mode,
        }));
    }

    return [{
      key: 'details',
      label: 'Details',
      beforeValue: before,
      afterValue: after,
      mode: before === undefined ? 'created' : after === undefined ? 'deleted' : 'changed',
    }];
  }

  const mode = action.includes('created')
    ? 'created'
    : action.includes('deleted')
      ? 'deleted'
      : 'changed';

  const hasDepartmentNames = before.room_department_names !== undefined || after.room_department_names !== undefined;

  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((key) => {
      const source = before[key] !== undefined ? before : after;
      if (hasDepartmentNames && ['room_department_id', 'room_department_ids'].includes(key)) return false;
      return !shouldHideAuditDetailKey(key, source);
    })
    .sort()
    .map((key) => ({
      key,
      label: formatFieldLabel(key),
      beforeValue: before[key],
      afterValue: after[key],
      mode,
    }))
    .filter((item) => {
      if (isBooleanDetailValue(item.beforeValue) || isBooleanDetailValue(item.afterValue)) return false;
      if (!hasRenderableDetailValue(item.beforeValue) && !hasRenderableDetailValue(item.afterValue)) return false;
      return item.mode !== 'changed' || !areDetailValuesEqual(item.beforeValue, item.afterValue);
    });
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
  const [selectedAuditLog, setSelectedAuditLog] = useState(null);
  const [departmentNameById, setDepartmentNameById] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isSuperAdmin = currentUser?.role === 'super-admin';
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const moduleOptions = useMemo(() => {
    return [...new Set(['authentication', 'users', 'course_offerings', 'rooms', ...(options.modules || [])])].filter(Boolean).sort();
  }, [options.modules]);

  const actionOptions = useMemo(() => {
    const moduleActions = moduleFilter ? BASE_ACTIONS_BY_MODULE[moduleFilter] || [] : BASE_ACTIONS;
    return [...new Set([...moduleActions, ...(options.actions || [])])].filter(Boolean).sort();
  }, [moduleFilter, options.actions]);

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

  useEffect(() => {
    if (!isSuperAdmin) return undefined;

    let isMounted = true;
    fetchDepartments()
      .then((rows) => {
        if (!isMounted) return;
        setDepartmentNameById(
          new Map(
            (rows || []).map((department) => [
              Number(department.department_id),
              department.department_name || `Department #${department.department_id}`,
            ])
          )
        );
      })
      .catch((err) => {
        if (isMounted) setDepartmentNameById(new Map());
      });

    return () => {
      isMounted = false;
    };
  }, [isSuperAdmin]);

  useEffect(() => {
    if (!selectedAuditLog) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSelectedAuditLog(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAuditLog]);

  const resetPage = (setter) => (value) => {
    setPage(1);
    setter(value);
  };

  function handleModuleFilterChange(value) {
    setPage(1);
    setModuleFilter(value);
    setActionFilter('');
  }

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

  function renderDescription(log) {
    const description = getDescriptionPreview(log.description || '-');
    const hasDetails = getAuditChangeItems(log).length > 0;
    const visibleDescription = hasDetails && description.length > DESCRIPTION_PREVIEW_LENGTH
      ? `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trimEnd()}...`
      : description;

    return (
      <>
        {visibleDescription}{' '}
        {hasDetails && (
          <button
            type="button"
            onClick={() => setSelectedAuditLog(log)}
            className="font-semibold text-primary underline-offset-2 hover:underline"
          >
            Show More
          </button>
        )}
      </>
    );
  }

  function getDepartmentName(value) {
    const normalized = normalizeDetailValue(value);
    if (normalized === null) return 'none';
    const departmentId = Number(normalized);
    if (Number.isInteger(departmentId) && departmentNameById.has(departmentId)) {
      return departmentNameById.get(departmentId);
    }
    if (!Number.isInteger(departmentId)) {
      return String(normalized);
    }
    return `Department #${normalized}`;
  }

  function getDepartmentDetailItems(value) {
    const normalized = normalizeDetailValue(value);
    if (normalized === null) return [];
    const values = Array.isArray(normalized) ? normalized : [normalized];
    return values.map(getDepartmentName).filter((name) => name && name !== 'none');
  }

  function renderNestedDetailValue(value, depth = 0) {
    const normalized = normalizeDetailValue(value);
    if (typeof normalized === 'boolean') return null;
    if (normalized === null) return <span className="text-sm text-on-surface">none</span>;

    if (Array.isArray(normalized)) {
      const items = normalized.filter(hasRenderableDetailValue);
      if (items.length === 0) return <span className="text-sm text-on-surface">none</span>;

      return (
        <ul className={`${depth === 0 ? 'mt-1' : 'mt-2'} list-disc space-y-1 pl-5 text-sm text-on-surface`}>
          {items.map((item, index) => (
            <li key={`${index}-${formatDetailValue(item).slice(0, 32)}`}>
              {renderNestedDetailValue(item, depth + 1)}
            </li>
          ))}
        </ul>
      );
    }

    if (isPlainObject(normalized)) {
      const entries = Object.entries(normalized)
        .filter(([, nestedValue]) => hasRenderableDetailValue(nestedValue));

      if (entries.length === 0) return <span className="text-sm text-on-surface">none</span>;

      return (
        <div className={`${depth === 0 ? 'mt-1' : 'mt-2'} space-y-2 text-sm text-on-surface`}>
          {entries.map(([key, nestedValue]) => (
            <div key={key}>
              <span className="font-semibold text-on-surface">{formatFieldLabel(key)}: </span>
              {renderNestedDetailValue(nestedValue, depth + 1)}
            </div>
          ))}
        </div>
      );
    }

    return <span className="text-sm text-on-surface">{String(normalized)}</span>;
  }

  function renderSummaryDetailValue(value) {
    const summary = normalizeDetailValue(value);
    if (!isPlainObject(summary)) return renderNestedDetailValue(value);

    const metricEntries = Object.entries(summary)
      .filter(([key, nestedValue]) => {
        if (['errors', 'warnings', 'fileName', 'replaceMode'].includes(key)) return false;
        if (!hasRenderableDetailValue(nestedValue)) return false;
        return !Array.isArray(nestedValue) && !isPlainObject(nestedValue);
      });
    const errors = Array.isArray(summary.errors) ? summary.errors : [];
    const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];

    if (metricEntries.length === 0 && errors.length === 0 && warnings.length === 0) {
      return <span className="text-sm text-on-surface">none</span>;
    }

    return (
      <div className="mt-1 space-y-4 text-sm text-on-surface">
        {metricEntries.length > 0 && (
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface-variant/60">Counts</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {metricEntries.map(([key, nestedValue]) => (
                <li key={key}>
                  <span className="font-semibold">{formatFieldLabel(key)}:</span> {formatDetailValue(nestedValue)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {errors.length > 0 && (
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface-variant/60">Errors</div>
            <ul className="mt-2 list-disc space-y-3 pl-5">
              {errors.map((errorItem, index) => {
                const rowLabel = errorItem?.row ? `Row ${errorItem.row}` : `Error ${index + 1}`;
                const messages = Array.isArray(errorItem?.messages) ? errorItem.messages : [];

                return (
                  <li key={`${rowLabel}-${index}`}>
                    <span className="font-semibold">{rowLabel}</span>
                    {messages.length > 0 ? (
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {messages.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-1">{renderNestedDetailValue(errorItem, 1)}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {warnings.length > 0 && (
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface-variant/60">Warnings</div>
            {renderNestedDetailValue(warnings)}
          </div>
        )}
      </div>
    );
  }

  function renderDetailValue(value, fieldKey = '') {
    const isDepartmentField = DEPARTMENT_FIELD_KEYS.has(fieldKey);
    if (isDepartmentField) {
      const departmentItems = getDepartmentDetailItems(value);
      if (departmentItems.length > 1) {
        return (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-on-surface">
            {departmentItems.map((departmentName) => (
              <li key={departmentName}>{departmentName}</li>
            ))}
          </ul>
        );
      }

      return <span className="text-sm text-on-surface">{departmentItems[0] || 'none'}</span>;
    }

    if (fieldKey === 'summary') {
      return renderSummaryDetailValue(value);
    }

    return renderNestedDetailValue(value);
  }

  function renderChangeItem(item) {
    if (item.mode === 'created') {
      return (
        <div key={item.key} className="grid grid-cols-[minmax(110px,0.75fr)_minmax(0,1.5fr)] gap-4 border-t border-slate-100 px-4 py-3 first:border-t-0">
          <div className="break-words text-sm font-semibold text-on-surface">{item.label}</div>
          <div className="min-w-0">{renderDetailValue(item.afterValue, item.key)}</div>
        </div>
      );
    }

    if (item.mode === 'deleted') {
      return (
        <div key={item.key} className="grid grid-cols-[minmax(110px,0.75fr)_minmax(0,1.5fr)] gap-4 border-t border-slate-100 px-4 py-3 first:border-t-0">
          <div className="break-words text-sm font-semibold text-on-surface">{item.label}</div>
          <div className="min-w-0">{renderDetailValue(item.beforeValue, item.key)}</div>
        </div>
      );
    }

    return (
      <div key={item.key} className="grid grid-cols-[minmax(110px,0.75fr)_minmax(0,1.5fr)] gap-4 border-t border-slate-100 px-4 py-3 first:border-t-0">
        <div className="break-words text-sm font-semibold text-on-surface">{item.label}</div>
        <div className="min-w-0 grid gap-3 md:grid-cols-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface-variant/60">Before</div>
            {renderDetailValue(item.beforeValue, item.key)}
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface-variant/60">After</div>
            {renderDetailValue(item.afterValue, item.key)}
          </div>
        </div>
      </div>
    );
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
              Review authentication, administration, course offering, and room activity from the existing audit log.
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
              onChange={(event) => handleModuleFilterChange(event.target.value)}
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
              disabled={!moduleFilter}
              className="w-full rounded-2xl border border-outline-variant bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-on-surface-variant/50"
            >
              <option value="">{moduleFilter ? 'All actions' : 'Select a module first'}</option>
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
                          <div>{renderDescription(log)}</div>
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

      {selectedAuditLog && (() => {
        const changeItems = getAuditChangeItems(selectedAuditLog);
        const descriptionParts = getDescriptionParts(selectedAuditLog.description);
        const affectedRecord = getAffectedRecord(selectedAuditLog);

        return (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setSelectedAuditLog(null);
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Audit log details"
              className="my-8 w-full max-w-4xl rounded-3xl border border-white/70 bg-white p-6 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">
                    Audit Details
                  </p>
                  <h3 className="mt-2 text-2xl font-bold text-on-surface">
                    {formatAction(selectedAuditLog.action)}
                  </h3>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    {formatTimestamp(selectedAuditLog.timestamp || selectedAuditLog.created_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedAuditLog(null)}
                  aria-label="Close audit details"
                  className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-slate-100 hover:text-on-surface"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface-variant/60">User</div>
                  <div className="mt-1 font-semibold text-on-surface">{selectedAuditLog.username || 'system'}</div>
                  <div className="text-xs text-on-surface-variant">{selectedAuditLog.role || '-'}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface-variant/60">Module</div>
                  <div className="mt-1 font-semibold text-on-surface">{formatAction(selectedAuditLog.module)}</div>
                  <div className="text-xs text-on-surface-variant">{selectedAuditLog.status || 'success'}</div>
                </div>
                {affectedRecord && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface-variant/60">Affected Record</div>
                    <div className="mt-1 font-semibold text-on-surface">{affectedRecord}</div>
                  </div>
                )}
                {selectedAuditLog.ip_address && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-on-surface-variant/60">IP Address</div>
                    <div className="mt-1 font-semibold text-on-surface">{selectedAuditLog.ip_address}</div>
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-slate-200 p-5">
                <h4 className="text-sm font-bold uppercase tracking-[0.18em] text-on-surface-variant">Summary</h4>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-on-surface-variant">
                  {descriptionParts.map((part) => (
                    <li key={part}>{part}</li>
                  ))}
                </ul>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 p-5">
                <h4 className="text-sm font-bold uppercase tracking-[0.18em] text-on-surface-variant">Change Details</h4>
                {changeItems.length > 0 ? (
                  <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 text-sm text-on-surface-variant">
                    <div className="grid grid-cols-[minmax(110px,0.75fr)_minmax(0,1.5fr)] gap-4 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-on-surface-variant/70">
                      <div>Title</div>
                      <div>Value</div>
                    </div>
                    {changeItems.map(renderChangeItem)}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-on-surface-variant">
                    No before or after values were saved for this audit log.
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
