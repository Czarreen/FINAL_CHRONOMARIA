import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, PlusCircle, Edit2, Trash2, Clock, Layers, LibraryBig, RefreshCw } from 'lucide-react';
import { fetchSubjectsPage } from '../services/subjectsApi';

const PAGE_SIZE = 9999; // Load all subjects at once

export default function SubjectsView() {
  const [subjects, setSubjects] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');

  const stats = useMemo(() => {
    const totalSubjects = subjects.length;
    const totalUnits = subjects.reduce((sum, s) => sum + (s.subject_units || 0), 0);
    return { totalSubjects, totalUnits };
  }, [subjects]);

  const filteredSubjects = useMemo(() => {
    if (filterCategory === 'all') {
      return subjects;
    }
    return subjects.filter((s) => s.subject_status === filterCategory);
  }, [subjects, filterCategory]);

  useEffect(() => {
    let active = true;

    async function loadSubjects() {
      setLoading(true);
      setError('');

      try {
        const { rows: data, total: count } = await fetchSubjectsPage(1, PAGE_SIZE);

        if (!active) return;
        console.log('Subjects data loaded:', data);
        setSubjects(data);
        setTotalRows(count);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load subjects data.');
        setSubjects([]);
        setTotalRows(0);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadSubjects();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-gutter animate-in slide-in-from-right-4 duration-500">
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-12">
        <div className="glass-panel col-span-1 flex items-center justify-between p-8 lg:col-span-8">
          <div className="space-y-1">
            <h2 className="text-headline-xl font-headline-xl text-on-surface">Curriculum Repository</h2>
            <p className="text-body-md text-on-surface-variant">Manage subjects, credit units, and classifications from Supabase.</p>
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
          <LibraryBig size={24} className="text-primary" />
          <span className="mt-3 text-3xl font-bold text-on-surface">{stats.totalSubjects}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Total Subjects</span>
        </div>
        <div className="glass-panel flex flex-col items-center justify-center p-6 text-center">
          <span className="text-3xl font-bold text-on-surface">{stats.totalUnits.toFixed(1)}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Total Units</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 py-1">
        <button 
          onClick={() => setFilterCategory('all')}
          className={`rounded-md px-5 py-2 text-xs font-bold shadow-md transition-all ${
            filterCategory === 'all'
              ? 'bg-primary text-white shadow-primary/20'
              : 'border border-white/60 bg-white text-on-surface-variant hover:bg-slate-50'
          }`}
        >
          All Courses
        </button>
        {['active', 'on-leave', 'inactive'].map((status) => (
          <button
            key={status}
            onClick={() => setFilterCategory(status)}
            className={`rounded-md px-5 py-2 text-xs font-bold transition-all ${
              filterCategory === status
                ? 'bg-primary text-white shadow-md shadow-primary/20'
                : 'border border-white/60 bg-white text-on-surface-variant hover:bg-slate-50'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ')}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 px-6 py-4 text-sm text-red-700 rounded-lg">
          Error: {error}
        </div>
      )}

      {loading ? (
        <div className="px-6 py-8 text-center text-on-surface-variant">
          Loading subjects data...
        </div>
      ) : filteredSubjects.length === 0 ? (
        <div className="px-6 py-8 text-center text-on-surface-variant">
          No subjects found.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {filteredSubjects.map((subject) => (
            <div key={subject.subject_code} className="glass-panel group relative space-y-6 p-6 transition-all hover:-translate-y-0.5 hover:shadow-xl">
              <div className="flex items-start justify-between">
                <span className="badge badge-success px-3 py-1 text-xs font-bold">{subject.subject_code}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button className="rounded-md p-2 text-slate-400 transition-colors hover:bg-white hover:text-primary">
                    <Edit2 size={16} />
                  </button>
                  <button className="rounded-md p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div>
                <h3 className="mb-3 text-xl font-bold text-on-surface transition-colors group-hover:text-primary">{subject.subject_descriptive_title || subject.subject_name}</h3>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2 text-sm font-medium text-on-surface-variant">
                    <Clock size={16} className="text-slate-400" />
                    {(subject.subject_units || 0).toFixed(1)} Units
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium text-on-surface-variant">
                    <Layers size={16} className="text-slate-400" />
                    {subject.subject_status ? subject.subject_status.charAt(0).toUpperCase() + subject.subject_status.slice(1) : 'N/A'}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-white/50 pt-6">
                <div>
                  <p className="text-xs font-medium text-on-surface-variant">{subject.departments?.department_name || 'N/A'}</p>
                  <p className="text-[10px] text-on-surface-variant/60">Section: {subject.subject_section || 'N/A'}</p>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">{subject.subject_course_no || 'N/A'}</span>
              </div>
            </div>
          ))}

          <button className="flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-slate-300 p-8 transition-all hover:border-primary hover:bg-indigo-50/30 group">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition-all group-hover:scale-110 group-hover:bg-primary group-hover:text-white">
              <PlusCircle size={28} />
            </div>
            <div className="text-center">
              <span className="block text-lg font-bold text-on-surface-variant">Add New Subject</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Expand Curriculum</span>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
