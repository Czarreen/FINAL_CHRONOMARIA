import { useEffect, useMemo, useState } from 'react';
import {
  BookMarked,
  Layers,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { fetchCourseOfferingsPage } from '../services/courseOfferingsApi';

const PAGE_SIZE = 50;

export default function CourseOfferingView() {
  const [offerings, setOfferings] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

      <div className="glass-panel overflow-x-auto p-0">
        <table className="min-w-full text-left">
          <thead className="border-b border-white/50 bg-white/50">
            <tr className="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/80">
              <th className="px-6 py-4">Course</th>
              <th className="px-6 py-4">Curriculum ID</th>
              <th className="px-6 py-4">Section</th>
              <th className="px-6 py-4">Units</th>
              <th className="px-6 py-4">MTH Schedule / Room</th>
              <th className="px-6 py-4">TFS Schedule / Room</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="px-6 py-10 text-center text-sm text-on-surface-variant" colSpan={6}>
                  Loading course offerings...
                </td>
              </tr>
            )}

            {!loading && error && (
              <tr>
                <td className="px-6 py-10 text-center text-sm text-error" colSpan={6}>
                  {error}
                </td>
              </tr>
            )}

            {!loading && !error && offerings.length === 0 && (
              <tr>
                <td className="px-6 py-10 text-center text-sm text-on-surface-variant" colSpan={6}>
                  No course offerings found.
                </td>
              </tr>
            )}

            {!loading && !error && offerings.map((offering) => (
              <tr key={offering.id} className="border-b border-white/40 last:border-b-0">
                <td className="px-6 py-4">
                  <div className="font-semibold text-on-surface">
                    {offering.code || '-'} {offering.course_no || ''}
                  </div>
                  <div className="text-sm text-on-surface-variant">{offering.descriptive_title || '-'}</div>
                </td>
                <td className="px-6 py-4 text-sm text-on-surface-variant">{offering.curr_id ?? '-'}</td>
                <td className="px-6 py-4 text-sm text-on-surface-variant">
                  <span className="inline-flex items-center gap-2">
                    <Layers size={14} className="text-slate-400" />
                    {offering.section || '-'}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm font-semibold text-on-surface">{offering.units ?? '-'}</td>
                <td className="px-6 py-4 text-sm text-on-surface-variant">
                  <span className="inline-flex items-center gap-2">
                    <CalendarDays size={14} className="text-slate-400" />
                    {(offering.mth_schedule || '-') + ' / ' + (offering.mth_room_id || '-')}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-on-surface-variant">
                  <span className="inline-flex items-center gap-2">
                    <Building2 size={14} className="text-slate-400" />
                    {(offering.tfs_schedule || '-') + ' / ' + (offering.tfs_room_id || '-')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
    </div>
  );
}
