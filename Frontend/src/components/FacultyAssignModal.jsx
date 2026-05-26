import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Search,
  UserX,
  X,
} from 'lucide-react';
import { fetchFaculty } from '../services/facultyApi.js';
import { fetchAllFacultySubjectPreferences } from '../services/facultySubjectPreferencesApi.js';
import { getScheduleTimeRange, timesOverlap, formatScheduleTimeDisplay } from '../utils/scheduleUtils.js';

// ─── Module-level helpers ────────────────────────────────────────────────────

function getStatusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'active') return 'bg-green-100 text-green-700';
  if (s === 'on-leave') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-500';
}

function getDepartmentBadgeClass(departmentName) {
  const normalized = String(departmentName || '').toLowerCase();
  if (normalized.includes('architecture')) return 'bg-fuchsia-100 text-fuchsia-800';
  if (normalized.includes('information technology') || normalized.includes(' it ') || normalized === 'it') return 'bg-sky-100 text-sky-800';
  if (normalized.includes('civil engineering')) return 'bg-emerald-100 text-emerald-800';
  if (normalized.includes('electrical engineering')) return 'bg-amber-100 text-amber-800';
  if (normalized.includes('computer engineering')) return 'bg-violet-100 text-violet-800';
  if (normalized.includes('mechanical engineering')) return 'bg-slate-100 text-slate-700';
  if (normalized.includes('data') || normalized.includes('science')) return 'bg-cyan-100 text-cyan-800';
  if (normalized.includes('mathematics')) return 'bg-indigo-100 text-indigo-800';
  return 'bg-slate-100 text-slate-700';
}

function parseSpecializations(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const TABS = [
  { key: 'faculty', label: 'Assign Faculty' },
  { key: 'details', label: 'Row Details' },
];

const PREF_STYLE = {
  1: 'bg-amber-100 text-amber-700',
  2: 'bg-sky-100 text-sky-700',
  3: 'bg-slate-100 text-slate-500',
};
const PREF_LABEL = { 1: 'P1', 2: 'P2', 3: 'P3' };

// ─── Component ───────────────────────────────────────────────────────────────

export default function FacultyAssignModal({ row, allRows, onClose, onSave, orderedColumns }) {
  const [activeTab, setActiveTab] = useState('faculty');
  const [facultyList, setFacultyList] = useState([]);
  const [prefsMap, setPrefsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [searchText, setSearchText] = useState('');
  const [activeDeptTab, setActiveDeptTab] = useState('all');
  // Local editable copy for Tab 2
  const [detailDraft, setDetailDraft] = useState(() => ({ ...row }));

  // ── Data loading ────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setFetchError('');

    Promise.all([
      fetchFaculty({ page: 1, limit: 10000 }),
      fetchAllFacultySubjectPreferences().catch(() => ({})),
    ])
      .then(([{ rows: facultyRows }, prefs]) => {
        if (!mounted) return;
        setFacultyList(facultyRows || []);
        setPrefsMap(prefs || {});
      })
      .catch((err) => {
        if (!mounted) return;
        setFetchError(err?.message || 'Failed to load faculty list.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, []);

  // ── Derived: used units per faculty (excludes current row) ─────────────────
  const usedUnitsMap = useMemo(() => {
    const map = new Map();
    for (const f of facultyList) {
      const fid = f.faculty_id;
      let used = 0;
      for (const r of allRows) {
        if (r.id === row.id) continue;
        const byId   = fid != null && r.faculty_id === fid;
        const byName = !byId && r.faculty_name === f.faculty_name;
        if (byId || byName) used += toNumber(r.units);
      }
      map.set(fid, used);
    }
    return map;
  }, [facultyList, allRows, row.id]);

  // ── Derived: schedule conflicts per faculty (excludes current row) ──────────
  const conflictMap = useMemo(() => {
    const map = new Map();
    const rowMthRange = getScheduleTimeRange(row.mth_schedule);
    const rowTfsRange = getScheduleTimeRange(row.tfs_schedule);

    // If this row has no schedule, no conflicts possible
    if (!rowMthRange && !rowTfsRange) return map;

    for (const f of facultyList) {
      const fid = f.faculty_id;
      if (map.has(fid)) continue;

      for (const r of allRows) {
        if (r.id === row.id) continue;
        const byId   = fid != null && r.faculty_id === fid;
        const byName = !byId && r.faculty_name === f.faculty_name;
        if (!byId && !byName) continue;

        // MTH vs MTH
        if (rowMthRange && r.mth_schedule) {
          const other = getScheduleTimeRange(r.mth_schedule);
          if (other && timesOverlap(rowMthRange.start, rowMthRange.end, other.start, other.end)) {
            map.set(fid, {
              type: 'MTH',
              conflictWith: r.descriptive_title || r.code || 'another subject',
            });
            break;
          }
        }

        // TFS vs TFS
        if (!map.has(fid) && rowTfsRange && r.tfs_schedule) {
          const other = getScheduleTimeRange(r.tfs_schedule);
          if (other && timesOverlap(rowTfsRange.start, rowTfsRange.end, other.start, other.end)) {
            map.set(fid, {
              type: 'TFS',
              conflictWith: r.descriptive_title || r.code || 'another subject',
            });
            break;
          }
        }
      }
    }

    return map;
  }, [facultyList, allRows, row]);

  // ── Derived: department sub-tabs ────────────────────────────────────────────
  const deptTabs = useMemo(() => {
    const names = [
      ...new Set(facultyList.map((f) => f.departments?.department_name || '').filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return names;
  }, [facultyList]);

  // ── Derived: filtered faculty for the card grid ─────────────────────────────
  const displayedFaculty = useMemo(() => {
    let list = facultyList;

    if (activeDeptTab !== 'all') {
      list = list.filter((f) => (f.departments?.department_name || '') === activeDeptTab);
    }

    const q = searchText.trim().toLowerCase();
    if (q) {
      list = list.filter((f) => {
        const specs = parseSpecializations(f.faculty_specialization).join(' ');
        return (
          (f.faculty_name || '').toLowerCase().includes(q) ||
          (f.faculty_role || '').toLowerCase().includes(q) ||
          specs.toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [facultyList, activeDeptTab, searchText]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleCardClick(f) {
    const status = String(f.faculty_status || '').toLowerCase();
    const isInactive = status === 'inactive' || status === 'on-leave';
    const hasConflict = conflictMap.has(f.faculty_id);
    if (isInactive || hasConflict) return;
    onSave({ faculty_name: f.faculty_name, faculty_id: f.faculty_id });
  }

  function handleClearAssignment() {
    onSave({ faculty_name: '', faculty_id: null });
  }

  function handleApplyDetails() {
    onSave(detailDraft);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/35 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex w-full max-w-4xl flex-col rounded-2xl border border-white/60 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.18)] overflow-hidden"
        style={{ maxHeight: '90vh' }}
      >

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="shrink-0 flex items-start justify-between gap-3 border-b border-white/50 px-5 py-4">
          <div className="min-w-0">
            {/* Current assignment label — top-left prominent label */}
            <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-slate-50 px-3 py-1 text-xs">
              <span className="font-semibold uppercase tracking-[0.16em] text-on-surface-variant">Assigned:</span>
              {row.faculty_name ? (
                <span className="font-bold text-primary">{row.faculty_name}</span>
              ) : (
                <span className="font-semibold italic text-on-surface-variant/60">Unassigned</span>
              )}
            </div>
            <h4 className="text-lg font-bold text-on-surface truncate">
              {row.descriptive_title || row.code || 'Subject'}
            </h4>
            <p className="mt-0.5 text-sm text-on-surface-variant">
              {[
                row.section ? `Section ${row.section}` : null,
                row.department_name || null,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="shrink-0 rounded-lg border border-outline-variant bg-white p-1.5 text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Tab bar ────────────────────────────────────────────────────────── */}
        <div className="shrink-0 flex items-end gap-0.5 border-b border-slate-200 bg-white px-4 pt-3 overflow-x-auto">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border border-b-0 -mb-px whitespace-nowrap transition-colors shrink-0 ${
                  isActive
                    ? 'bg-white border-slate-200 text-on-surface relative z-10'
                    : 'bg-slate-50/50 border-transparent text-on-surface-variant hover:bg-white/60 hover:text-on-surface'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ── Body (scrollable) ─────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto">

          {/* ══ Tab 1: Assign Faculty ══════════════════════════════════════════ */}
          {activeTab === 'faculty' && (
            <div className="p-5 space-y-4">

              {/* Loading state */}
              {loading && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
                  <p className="mt-4 text-sm text-on-surface-variant">Loading faculty…</p>
                </div>
              )}

              {/* Error state */}
              {!loading && fetchError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{fetchError}</span>
                </div>
              )}

              {/* Main content */}
              {!loading && !fetchError && (
                <>
                  {/* Search + Clear row */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Search by name, role, or specialization…"
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        className="w-full rounded-lg border border-white/40 bg-white/70 py-2 pl-9 pr-8 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none transition hover:bg-white focus:border-primary focus:bg-white"
                      />
                      {searchText && (
                        <button
                          type="button"
                          onClick={() => setSearchText('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface transition-colors"
                          aria-label="Clear search"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {row.faculty_name && (
                      <button
                        type="button"
                        onClick={handleClearAssignment}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 shrink-0"
                      >
                        <UserX size={13} />
                        Clear Assignment
                      </button>
                    )}
                  </div>

                  {/* Department sub-tabs (only when multiple departments) */}
                  {deptTabs.length > 1 && (
                    <div className="flex items-end gap-0.5 overflow-x-auto border-b border-slate-200 -mx-5 px-5">
                      <button
                        type="button"
                        onClick={() => setActiveDeptTab('all')}
                        className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border border-b-0 -mb-px whitespace-nowrap transition-colors shrink-0 ${
                          activeDeptTab === 'all'
                            ? 'bg-white border-slate-200 text-on-surface relative z-10'
                            : 'bg-slate-50/50 border-transparent text-on-surface-variant hover:bg-white/60 hover:text-on-surface'
                        }`}
                      >
                        All
                        <span className={`inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[9px] font-bold ${
                          activeDeptTab === 'all' ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-400'
                        }`}>{facultyList.length}</span>
                      </button>
                      {deptTabs.map((dept) => {
                        const isActive = activeDeptTab === dept;
                        const count = facultyList.filter((f) => (f.departments?.department_name || '') === dept).length;
                        return (
                          <button
                            key={dept}
                            type="button"
                            onClick={() => setActiveDeptTab(dept)}
                            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border border-b-0 -mb-px whitespace-nowrap transition-colors shrink-0 ${
                              isActive
                                ? 'bg-white border-slate-200 text-on-surface relative z-10'
                                : 'bg-slate-50/50 border-transparent text-on-surface-variant hover:bg-white/60 hover:text-on-surface'
                            }`}
                          >
                            {dept}
                            <span className={`inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[9px] font-bold ${
                              isActive ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-400'
                            }`}>{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Empty state */}
                  {displayedFaculty.length === 0 && (
                    <div className="rounded-xl border border-dashed border-outline-variant/60 bg-white/60 p-8 text-center">
                      <p className="text-sm font-semibold text-on-surface-variant">No faculty found</p>
                      {searchText && (
                        <button
                          type="button"
                          onClick={() => setSearchText('')}
                          className="mt-2 text-xs text-primary hover:underline"
                        >
                          Clear search
                        </button>
                      )}
                    </div>
                  )}

                  {/* Faculty card grid */}
                  {displayedFaculty.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {displayedFaculty.map((f) => {
                        const status       = String(f.faculty_status || '').toLowerCase();
                        const isInactive   = status === 'inactive' || status === 'on-leave';
                        const conflict     = conflictMap.get(f.faculty_id) ?? null;
                        const isDisabled   = isInactive || conflict !== null;
                        const isSelected   = row.faculty_id != null
                          ? f.faculty_id === row.faculty_id
                          : f.faculty_name === row.faculty_name;

                        const usedUnits    = usedUnitsMap.get(f.faculty_id) ?? 0;
                        const maxUnits     = toNumber(f.faculty_max_units);
                        const pct          = maxUnits > 0
                          ? Math.min(100, Math.round((usedUnits / maxUnits) * 100))
                          : 0;

                        const specs        = parseSpecializations(f.faculty_specialization);
                        const visibleSpecs = specs.slice(0, 2);
                        const hiddenCount  = Math.max(0, specs.length - visibleSpecs.length);

                        const prefs        = prefsMap[String(f.faculty_id)] ?? [];
                        const visiblePrefs = prefs.slice(0, 3);

                        const deptName     = f.departments?.department_name || '';

                        // Card border/bg logic
                        let cardClass = 'rounded-xl border p-3.5 transition-all duration-150 ';
                        if (isDisabled && conflict) {
                          cardClass += 'border-amber-300 bg-amber-50/40 opacity-75 cursor-not-allowed';
                        } else if (isDisabled) {
                          cardClass += 'border-white/60 bg-white/60 opacity-50 cursor-not-allowed';
                        } else if (isSelected) {
                          cardClass += 'border-primary/50 bg-primary/5 ring-1 ring-primary/20 cursor-pointer';
                        } else {
                          cardClass += 'border-white/60 bg-white cursor-pointer hover:border-primary/30 hover:shadow-md';
                        }

                        return (
                          <div
                            key={f.faculty_id}
                            className={cardClass}
                            onClick={() => handleCardClick(f)}
                            role={isDisabled ? undefined : 'button'}
                            tabIndex={isDisabled ? -1 : 0}
                            onKeyDown={(e) => {
                              if (!isDisabled && (e.key === 'Enter' || e.key === ' ')) {
                                e.preventDefault();
                                handleCardClick(f);
                              }
                            }}
                            aria-disabled={isDisabled}
                          >
                            {/* Card top row: name + status + selected indicator */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="text-sm font-semibold text-on-surface leading-5">
                                    {f.faculty_name || `Faculty ${f.faculty_id}`}
                                  </p>
                                  {isSelected && !isDisabled && (
                                    <CheckCircle2 size={14} className="text-primary shrink-0" />
                                  )}
                                </div>
                                <p className="mt-0.5 text-[11px] uppercase tracking-[0.16em] text-on-surface-variant truncate">
                                  {f.faculty_role || 'N/A'}
                                </p>
                              </div>
                              <div className="shrink-0 flex flex-col items-end gap-1">
                                {/* Status badge */}
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${getStatusBadgeClass(f.faculty_status)}`}>
                                  {String(f.faculty_status || 'inactive').replace('-', ' ')}
                                </span>
                              </div>
                            </div>

                            {/* Department badge */}
                            {deptName && (
                              <div className="mt-2">
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${getDepartmentBadgeClass(deptName)}`}>
                                  {deptName}
                                </span>
                              </div>
                            )}

                            {/* Units bar */}
                            <div className="mt-2.5">
                              <div className="flex items-center justify-between gap-1 mb-1">
                                <span className="text-[11px] text-on-surface-variant">
                                  Load: <span className="font-semibold text-on-surface">{usedUnits}</span> / {maxUnits || '—'} units
                                </span>
                                {maxUnits > 0 && (
                                  <span className="text-[10px] text-on-surface-variant">{pct}%</span>
                                )}
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 border border-white/40">
                                <div
                                  className={`h-full rounded-full transition-all ${pct >= 90 ? 'bg-rose-400' : pct >= 70 ? 'bg-amber-400' : 'bg-primary/70'}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>

                            {/* Specializations */}
                            {specs.length > 0 && (
                              <div className="mt-2 flex flex-wrap items-center gap-1">
                                {visibleSpecs.map((spec) => (
                                  <span
                                    key={spec}
                                    className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
                                  >
                                    {spec}
                                  </span>
                                ))}
                                {hiddenCount > 0 && (
                                  <span
                                    title={specs.join(', ')}
                                    className="cursor-help rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500"
                                  >
                                    +{hiddenCount} more
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Subject preference tags */}
                            {visiblePrefs.length > 0 && (
                              <div className="mt-2 flex flex-wrap items-center gap-1">
                                {visiblePrefs.map((pref) => (
                                  <span
                                    key={pref.subject_tag}
                                    title={`Priority: ${PREF_LABEL[pref.priority_level] ?? pref.priority_level}`}
                                    className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${PREF_STYLE[pref.priority_level] ?? PREF_STYLE[3]}`}
                                  >
                                    {pref.subject_tag}
                                    <span className="opacity-60">{PREF_LABEL[pref.priority_level] ?? 'P?'}</span>
                                  </span>
                                ))}
                                {prefs.length > 3 && (
                                  <span className="text-[10px] text-on-surface-variant">+{prefs.length - 3} more</span>
                                )}
                              </div>
                            )}

                            {/* Conflict warning */}
                            {conflict && (
                              <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-amber-100/80 border border-amber-200 px-2.5 py-1.5 text-xs text-amber-800">
                                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-600" />
                                <span>
                                  <span className="font-bold">{conflict.type} conflict</span>: {conflict.conflictWith}
                                </span>
                              </div>
                            )}

                            {/* Selected indicator hint */}
                            {isSelected && !isDisabled && (
                              <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/70">
                                Currently assigned
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ══ Tab 2: Row Details ════════════════════════════════════════════ */}
          {activeTab === 'details' && (
            <div className="p-5">
              {/* Schedule preview strip */}
              {(row.mth_schedule || row.tfs_schedule) && (
                <div className="mb-4 flex flex-wrap gap-3 rounded-xl border border-white/60 bg-slate-50 px-4 py-3">
                  {row.mth_schedule && (
                    <div className="text-xs">
                      <span className="font-bold uppercase tracking-[0.18em] text-on-surface-variant">MTH </span>
                      <span className="text-on-surface">{formatScheduleTimeDisplay(row.mth_schedule) || row.mth_schedule}</span>
                    </div>
                  )}
                  {row.tfs_schedule && (
                    <div className="text-xs">
                      <span className="font-bold uppercase tracking-[0.18em] text-on-surface-variant">TFS </span>
                      <span className="text-on-surface">{formatScheduleTimeDisplay(row.tfs_schedule) || row.tfs_schedule}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                {(orderedColumns || [])
                  .filter((col) => col.key !== 'faculty_name' && col.key !== 'faculty_id')
                  .map((col) => (
                    <label key={`detail-${col.key}`} className="block text-sm">
                      <span className="mb-1 block font-semibold text-on-surface">{col.label}</span>
                      {col.type === 'boolean' ? (
                        <select
                          value={detailDraft[col.key] ? 'yes' : 'no'}
                          onChange={(e) =>
                            setDetailDraft((d) => ({ ...d, [col.key]: e.target.value === 'yes' }))
                          }
                          className="w-full rounded-lg border border-outline-variant bg-white px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary"
                        >
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      ) : (
                        <input
                          type={col.type === 'number' ? 'number' : 'text'}
                          value={detailDraft[col.key] ?? ''}
                          onChange={(e) =>
                            setDetailDraft((d) => ({ ...d, [col.key]: e.target.value }))
                          }
                          className="w-full rounded-lg border border-outline-variant bg-white px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary"
                        />
                      )}
                    </label>
                  ))}
              </div>

              {/* Tab 2 footer */}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-outline-variant bg-white px-4 py-2.5 text-sm font-semibold text-on-surface transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyDetails}
                  className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary transition-colors hover:bg-primary/90"
                >
                  Apply Row Details
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
