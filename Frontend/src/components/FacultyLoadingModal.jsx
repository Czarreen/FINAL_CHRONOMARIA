import { useState, useMemo, useEffect } from 'react';
import { BookOpen, X, AlertCircle, Lock, Unlock } from 'lucide-react';
import { fetchFacultyLoading, updateFacultyLoadingLock } from '../services/facultyApi.js';

const TABS = [
  { key: 'mth', label: 'MTh' },
  { key: 'tfs', label: 'TFs' },
];

/**
 * FacultyLoadingModal
 *
 * Reusable modal that shows a faculty member's assigned subjects,
 * split into MTh / TFs tabs, with per-subject lock/unlock controls.
 *
 * Props:
 *   faculty  — { faculty_id: number, faculty_name: string }
 *   onClose  — () => void
 */
export default function FacultyLoadingModal({ faculty, onClose }) {
  const [data, setData]           = useState([]);
  const [tab, setTab]             = useState('mth');
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [lockingId, setLockingId] = useState(null);

  /* ── Fetch on mount (or when faculty changes) ── */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData([]);
    fetchFacultyLoading(faculty.faculty_id)
      .then((rows) => { if (!cancelled) setData(rows); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load faculty assignments'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [faculty.faculty_id]);

  /* ── Derived tab rows ── */
  const mthRows = useMemo(
    () => data.filter((r) => r.mth_schedule != null && r.mth_schedule !== ''),
    [data]
  );
  const tfsRows = useMemo(
    () => data.filter((r) => r.tfs_schedule != null && r.tfs_schedule !== ''),
    [data]
  );
  const activeTabRows = tab === 'mth' ? mthRows : tfsRows;

  /* ── Lock toggle with optimistic update ── */
  async function handleToggleLock(facloadingId, currentLocked) {
    if (lockingId === facloadingId) return;
    const newLocked = !currentLocked;
    setData((prev) =>
      prev.map((r) => r.facloading_id === facloadingId ? { ...r, locked: newLocked } : r)
    );
    setLockingId(facloadingId);
    try {
      await updateFacultyLoadingLock(facloadingId, newLocked);
    } catch {
      // Revert on failure
      setData((prev) =>
        prev.map((r) => r.facloading_id === facloadingId ? { ...r, locked: currentLocked } : r)
      );
    } finally {
      setLockingId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-5xl rounded-2xl bg-white shadow-xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-white/20 bg-primary px-6 py-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <BookOpen size={20} className="text-white shrink-0" />
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-white truncate">{faculty.faculty_name}</h3>
              <p className="text-xs text-white/70">Faculty Loading — Assigned Subjects</p>
            </div>
            {!loading && (
              <span className="ml-2 inline-flex items-center justify-center rounded-full bg-white/20 px-2.5 py-1 text-xs font-bold text-white shrink-0">
                {data.length} subject{data.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            aria-label="Close faculty loading modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── Tab Bar ── */}
        <div className="flex items-end gap-0.5 px-4 pt-3 border-b border-slate-200 overflow-x-auto shrink-0 bg-white">
          {TABS.map((t) => {
            const count = t.key === 'mth' ? mthRows.length : tfsRows.length;
            const isActive = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg border border-b-0 -mb-px whitespace-nowrap transition-colors shrink-0 ${
                  isActive
                    ? 'bg-white border-slate-200 text-on-surface relative z-10'
                    : 'bg-slate-50/50 border-transparent text-on-surface-variant hover:bg-white/60 hover:text-on-surface'
                }`}
              >
                {t.label}
                <span className={`inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[9px] font-bold ${
                  count > 0 ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-400'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
              <p className="mt-4 text-sm text-on-surface-variant">Loading assignments...</p>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="flex items-center gap-3 rounded-lg bg-red-50 p-3 text-red-700">
              <AlertCircle size={16} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && activeTabRows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <BookOpen size={36} className="text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-on-surface-variant">
                No {tab === 'mth' ? 'MTh' : 'TFs'} subjects assigned
              </p>
              <p className="mt-1 text-xs text-on-surface-variant/70">
                This faculty member has no {tab === 'mth' ? 'Monday–Thursday' : 'Tuesday–Friday/Saturday'} subjects in the loading table.
              </p>
            </div>
          )}

          {/* Subject card grid */}
          {!loading && !error && activeTabRows.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeTabRows.map((row) => {
                const isLocked = Boolean(row.locked);
                const isBeingToggled = lockingId === row.facloading_id;
                const schedule = tab === 'mth' ? row.mth_schedule : row.tfs_schedule;
                const roomName = tab === 'mth' ? row.mth_room_name : row.tfs_room_name;

                return (
                  <div
                    key={row.facloading_id}
                    className={`relative rounded-xl border-2 p-4 transition-all duration-200 hover:shadow-md ${
                      isLocked
                        ? 'border-amber-300 bg-amber-50/60'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {/* Padlock toggle — top-right */}
                    <button
                      type="button"
                      onClick={() => handleToggleLock(row.facloading_id, row.locked)}
                      disabled={isBeingToggled}
                      aria-label={isLocked ? `Unlock ${row.code}` : `Lock ${row.code}`}
                      title={isLocked ? 'Locked — click to unlock' : 'Unlocked — click to lock'}
                      className={`absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${
                        isLocked
                          ? 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                          : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                      }`}
                    >
                      {isBeingToggled ? (
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : isLocked ? (
                        <Lock size={14} />
                      ) : (
                        <Unlock size={14} />
                      )}
                    </button>

                    {/* Card content — padded right to clear lock button */}
                    <div className="pr-9">

                      {/* Subject Code + Course No */}
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-base font-bold text-on-surface leading-tight">
                          {row.code || '—'}
                        </span>
                        {row.course_no && (
                          <span className="text-[11px] font-semibold text-on-surface-variant bg-slate-100 rounded-full px-2 py-0.5">
                            {row.course_no}
                          </span>
                        )}
                      </div>

                      {/* Descriptive Title */}
                      <p className="mt-1.5 text-sm font-semibold text-on-surface leading-snug line-clamp-2">
                        {row.descriptive_title || 'Untitled Subject'}
                      </p>

                      {/* Section + Units + Hours */}
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {row.section && (
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                            {row.section}
                          </span>
                        )}
                        {row.units != null && (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                            {row.units} unit{Number(row.units) !== 1 ? 's' : ''}
                          </span>
                        )}
                        {row.lec_hrs != null && (
                          <span className="text-[10px] text-on-surface-variant">Lec {row.lec_hrs}h</span>
                        )}
                        {row.lab_hrs != null && Number(row.lab_hrs) > 0 && (
                          <span className="text-[10px] text-on-surface-variant">Lab {row.lab_hrs}h</span>
                        )}
                      </div>

                      {/* Divider */}
                      <div className="mt-3 border-t border-slate-100" />

                      {/* Schedule + Room */}
                      <div className="mt-2.5 space-y-1.5">
                        {schedule ? (
                          <div className="flex items-start gap-2 text-xs">
                            <span className="font-bold uppercase tracking-wide text-[10px] text-on-surface-variant/60 w-12 shrink-0 pt-0.5">
                              Sched
                            </span>
                            <span className="font-medium text-on-surface leading-snug">{schedule}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-on-surface-variant/50">
                            <span className="font-bold uppercase tracking-wide text-[10px] w-12 shrink-0">Sched</span>
                            <span>—</span>
                          </div>
                        )}
                        {roomName ? (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-bold uppercase tracking-wide text-[10px] text-on-surface-variant/60 w-12 shrink-0">
                              Room
                            </span>
                            <span className="font-medium text-on-surface">{roomName}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-on-surface-variant/50">
                            <span className="font-bold uppercase tracking-wide text-[10px] w-12 shrink-0">Room</span>
                            <span>—</span>
                          </div>
                        )}
                      </div>

                      {/* Locked badge */}
                      {isLocked && (
                        <div className="mt-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-600">
                          <Lock size={10} />
                          <span>Locked</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 border-t border-slate-200 bg-white/70 px-6 py-3 flex items-center justify-between">
          <p className="text-xs text-on-surface-variant">
            {!loading && (
              <>{mthRows.length} MTh · {tfsRows.length} TFs · {data.length} total</>
            )}
          </p>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
