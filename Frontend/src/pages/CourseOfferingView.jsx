import { useEffect, useMemo, useState } from 'react';
import {
  BookMarked,
  Layers,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Eye,
  EyeOff,
  ChevronDown,
  Edit3,
  X,
} from 'lucide-react';
import { fetchCourseOfferingsPage } from '../services/courseOfferingsApi';

const PAGE_SIZE = 50;

export default function CourseOfferingView() {
  const [offerings, setOfferings] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [editingId, setEditingId] = useState(null);

  const totalPages = useMemo(() => {
    if (!totalRows) return 1;
    return Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  }, [totalRows]);

  useEffect(() => {
    let active = true;

    async function loadOfferings() {
      setLoading(true);
      setError('');

      try {
        const { rows: data, total: count } = await fetchCourseOfferingsPage(page, PAGE_SIZE);

        if (!active) return;
        setOfferings(data);
        setTotalRows(count);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load course offerings.');
        setOfferings([]);
        setTotalRows(0);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadOfferings();
    return () => {
      active = false;
    };
  }, [page]);

  const startRow = totalRows === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endRow = Math.min(page * PAGE_SIZE, totalRows);

  const toggleRowExpand = (id) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  // Column groups for organized display
  const columnGroups = [
    {
      title: 'Course Info',
      columns: [
        { key: 'code', label: 'Code', width: 'w-20' },
        { key: 'course_no', label: 'Course #', width: 'w-16' },
        { key: 'descriptive_title', label: 'Title', width: 'w-56' },
      ],
    },
    {
      title: 'Curriculum',
      columns: [
        { key: 'curr_id', label: 'Curriculum ID', width: 'w-20' },
        { key: 'section', label: 'Section', width: 'w-16' },
        { key: 'units', label: 'Units', width: 'w-12' },
        { key: 'lec_hrs', label: 'Lecture Hrs', width: 'w-16' },
        { key: 'lab_hrs', label: 'Lab Hrs', width: 'w-14' },
      ],
    },
    {
      title: 'Schedule',
      columns: [
        { key: 'mth_schedule', label: 'MTH Schedule', width: 'w-24' },
        { key: 'mth_room_id', label: 'MTH Room', width: 'w-16' },
        { key: 'tfs_schedule', label: 'TFS Schedule', width: 'w-24' },
        { key: 'tfs_room_id', label: 'TFS Room', width: 'w-16' },
      ],
    },
  ];

  const allColumns = columnGroups.flatMap(g => g.columns);

  const renderCellValue = (value) => {
    if (value === null || value === undefined) return <span className="text-slate-400">—</span>;
    return String(value);
  };

  return (
    <div className="space-y-gutter animate-in slide-in-from-right-4 duration-500">
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-12">
        <div className="glass-panel col-span-1 flex items-center justify-between p-8 lg:col-span-8">
          <div className="space-y-1">
            <h2 className="text-headline-xl font-headline-xl text-on-surface">Course Offering</h2>
            <p className="text-body-md text-on-surface-variant">
              Live view of `course_offerings` from Supabase with server-side pagination.
            </p>
          </div>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={() => setPage(1)}
            type="button"
          >
            <RefreshCw size={18} />
            <span>Reload</span>
          </button>
        </div>

        <div className="glass-panel flex flex-col items-center justify-center p-6 text-center">
          <BookMarked size={24} className="text-primary" />
          <span className="mt-3 text-3xl font-bold text-on-surface">{totalRows}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">
            Total Rows
          </span>
        </div>

        <div className="glass-panel flex flex-col items-center justify-center p-6 text-center">
          <span className="text-3xl font-bold text-on-surface">{page}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">
            Current Page
          </span>
        </div>
      </div>

      {/* Data Table */}
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              {columnGroups.map((group, groupIdx) => (
                <tr key={groupIdx} className="border-b border-white/30 bg-white/40">
                  {groupIdx === 0 && (
                    <th className="w-16 px-6 py-3 text-center">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                  <th
                    colSpan={group.columns.length}
                    className="px-6 py-3 text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/70"
                  >
                    {group.title}
                  </th>
                </tr>
              ))}
              <tr className="border-b border-white/50 bg-white/50">
                <th className="w-16 px-6 py-4 text-center">
                  <span className="sr-only">Actions</span>
                </th>
                {columnGroups.map((group) =>
                  group.columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-6 py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/80 ${col.width}`}
                    >
                      {col.label}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/40">
              {loading && (
                <tr>
                  <td
                    className="px-6 py-12 text-center text-sm text-on-surface-variant"
                    colSpan={1 + allColumns.length}
                  >
                    Loading course offerings...
                  </td>
                </tr>
              )}

              {!loading && error && (
                <tr>
                  <td
                    className="px-6 py-12 text-center text-sm text-error"
                    colSpan={1 + allColumns.length}
                  >
                    {error}
                  </td>
                </tr>
              )}

              {!loading && !error && offerings.length === 0 && (
                <tr>
                  <td
                    className="px-6 py-12 text-center text-sm text-on-surface-variant"
                    colSpan={1 + allColumns.length}
                  >
                    No course offerings found.
                  </td>
                </tr>
              )}

              {!loading && !error && offerings.map((offering) => (
                <tr key={offering.id} className="transition-colors hover:bg-white/30 group">
                  <td className="w-16 px-6 py-5 text-center">
                    <button
                      onClick={() => setEditingId(offering.id)}
                      className="rounded p-1.5 text-slate-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-white/60 hover:text-primary"
                      type="button"
                      title="Edit"
                    >
                      <Edit3 size={18} />
                    </button>
                  </td>
                  {allColumns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-6 py-5 text-sm text-on-surface-variant ${col.width}`}
                    >
                      {col.key === 'descriptive_title' ? (
                        <div className="max-w-lg line-clamp-2 font-medium text-on-surface">
                          {renderCellValue(offering[col.key])}
                        </div>
                      ) : col.key === 'units' ? (
                        <span className="font-semibold text-on-surface">
                          {renderCellValue(offering[col.key])}
                        </span>
                      ) : (
                        <span className="text-xs">{renderCellValue(offering[col.key])}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between rounded-xl border border-white/50 bg-white/60 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-on-surface-variant/80">
          Showing {startRow}-{endRow} of {totalRows}
        </p>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1 rounded-md border border-white/60 bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-50"
            disabled={page <= 1 || loading}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            type="button"
          >
            <ChevronLeft size={14} />
            Prev
          </button>
          <span className="text-xs font-semibold text-on-surface-variant">
            Page {page} of {totalPages}
          </span>
          <button
            className="inline-flex items-center gap-1 rounded-md border border-white/60 bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-50"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            type="button"
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Edit Modal */}
      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-8">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-xl font-bold text-on-surface">Edit Course Offering</h3>
              <button
                onClick={() => setEditingId(null)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/60 hover:text-on-surface"
              >
                <X size={20} />
              </button>
            </div>

            {editingId && offerings.find(o => o.id === editingId) && (
              <div className="space-y-6">
                {columnGroups.map((group) => (
                  <div key={group.title} className="space-y-4 rounded-xl bg-white/40 p-4">
                    <h4 className="text-sm font-bold uppercase tracking-[0.2em] text-on-surface-variant/80">
                      {group.title}
                    </h4>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {group.columns.map((col) => {
                        const value = offerings.find(o => o.id === editingId)?.[col.key];
                        return (
                          <div key={col.key}>
                            <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/70">
                              {col.label}
                            </label>
                            <input
                              type="text"
                              disabled
                              value={value ?? ''}
                              className="w-full rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm text-on-surface-variant opacity-70 cursor-not-allowed"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="flex gap-3 pt-6">
                  <button
                    onClick={() => setEditingId(null)}
                    className="flex-1 rounded-lg border border-white/60 bg-white px-4 py-2.5 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
                  >
                    Close
                  </button>
                  <button
                    disabled
                    className="flex-1 rounded-lg bg-primary/50 px-4 py-2.5 font-semibold text-white/60 cursor-not-allowed"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
