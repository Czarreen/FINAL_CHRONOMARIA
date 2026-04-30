import React, { useEffect, useMemo, useState } from 'react';
import { Users, Edit2, Trash2, Mail, Building2, BadgeCheck, RefreshCw } from 'lucide-react';
import { fetchFacultyPage } from '../services/facultyApi';

const PAGE_SIZE = 9999; // Load all faculty at once

export default function FacultyView() {
  const [faculty, setFaculty] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const totalPages = useMemo(() => {
    const grouped = {};
    faculty.forEach((member) => {
      const deptName = member.departments?.department_name || 'Unknown Department';
      if (!grouped[deptName]) {
        grouped[deptName] = [];
      }
      grouped[deptName].push(member);
    });
    return Object.keys(grouped).length;
  }, [faculty]);

  const groupedFaculty = useMemo(() => {
    const grouped = {};
    faculty.forEach((member) => {
      const deptName = member.departments?.department_name || 'Unknown Department';
      if (!grouped[deptName]) {
        grouped[deptName] = [];
      }
      grouped[deptName].push(member);
    });
    // Convert to array of departments for pagination
    return Object.entries(grouped).map(([name, members]) => ({ name, members }));
  }, [faculty]);

  const currentDeptData = groupedFaculty[page - 1] || null;

  const stats = useMemo(() => {
    const active = faculty.filter((f) => f.faculty_status === 'active').length;
    const onLeave = faculty.filter((f) => f.faculty_status === 'on-leave').length;
    return { active, onLeave, departments: totalPages };
  }, [faculty, totalPages]);

  useEffect(() => {
    let active = true;

    async function loadFaculty() {
      setLoading(true);
      setError('');

      try {
        const { rows: data, total: count } = await fetchFacultyPage(1, PAGE_SIZE);

        if (!active) return;
        console.log('Faculty data loaded:', data);
        setFaculty(data);
        setTotalRows(count);
        setPage(1); // Reset to first department page
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load faculty data.');
        setFaculty([]);
        setTotalRows(0);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadFaculty();
    return () => {
      active = false;
    };
  }, []); // Only load once on mount

  const startRow = page;
  const endRow = page;

  return (
    <div className="space-y-gutter animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2 className="text-headline-xl font-headline-xl text-on-surface">Faculty Directory</h2>
          <p className="mt-1 text-body-md text-on-surface-variant">Manage and track academic teaching staff from Supabase.</p>
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

      <div className="glass-panel overflow-hidden">
        <div className="border-b border-white/50 px-6 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { label: 'Active', value: String(stats.active), icon: BadgeCheck },
              { label: 'On Leave', value: String(stats.onLeave), icon: Users },
              { label: 'Departments', value: String(stats.departments), icon: Building2 },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white/60 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">{stat.label}</p>
                    <p className="mt-2 text-2xl font-bold text-on-surface">{stat.value}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <stat.icon size={18} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 px-6 py-4 text-sm text-red-700">
            Error: {error}
          </div>
        )}

        {loading ? (
          <div className="px-6 py-8 text-center text-on-surface-variant">
            Loading faculty data...
          </div>
        ) : faculty.length === 0 ? (
          <div className="px-6 py-8 text-center text-on-surface-variant">
            No faculty found.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/50 bg-white/50">
                    <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/70">Faculty Member</th>
                    <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/70">Department</th>
                    <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/70">Role</th>
                    <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/70">Status</th>
                    <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/70">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/50">
                  {currentDeptData ? (
                    <>
                      <tr className="bg-white/75">
                        <td colSpan="5" className="px-6 py-3">
                          <p className="text-sm font-bold text-primary">{currentDeptData.name} ({currentDeptData.members.length})</p>
                        </td>
                      </tr>
                      {currentDeptData.members.map((member) => (
                        <tr key={member.faculty_id} className="group transition-colors hover:bg-white/45">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-4">
                              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/60 bg-primary/10 font-bold text-primary shadow-sm">
                                {(member.faculty_name || 'N/A').split(' ').filter(n => n).map((n) => n[0]).join('').toUpperCase()}
                              </div>
                              <div>
                                <p className="font-bold text-on-surface">{member.faculty_name || 'N/A'}</p>
                                {member.email && (
                                  <div className="mt-1 flex items-center gap-1.5 text-xs text-on-surface-variant/70">
                                    <Mail size={12} />
                                    <span>{member.email}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-on-surface-variant">{currentDeptData.name}</td>
                          <td className="px-6 py-4 text-sm text-on-surface-variant">{member.faculty_role || 'N/A'}</td>
                          <td className="px-6 py-4">
                            <span
                              className={`badge ${
                                member.faculty_status === 'active'
                                  ? 'badge-success'
                                  : member.faculty_status === 'on-leave'
                                  ? 'badge-warning'
                                  : 'badge-error'
                              }`}
                            >
                              {(member.faculty_status || 'unknown').replace('-', ' ')}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                              <button className="rounded-lg p-2 text-slate-400 transition-all hover:bg-white hover:text-primary">
                                <Edit2 size={16} />
                              </button>
                              <button className="rounded-lg p-2 text-slate-400 transition-all hover:bg-red-50 hover:text-red-500">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </>
                  ) : (
                    <tr>
                      <td colSpan="5" className="px-6 py-4 text-center text-on-surface-variant">
                        No faculty in this department
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-white/50 bg-white/35 px-6 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">
                Department {startRow} of {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="rounded-md border border-white/60 bg-white px-2 py-1 text-xs font-bold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Previous
                </button>
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={`page-${i + 1}`}
                    onClick={() => setPage(i + 1)}
                    className={`h-8 w-8 rounded-md text-xs font-bold ${
                      page === i + 1
                        ? 'bg-primary text-white shadow-sm'
                        : 'border border-white/60 bg-white text-on-surface-variant transition-colors hover:bg-slate-50'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="rounded-md border border-white/60 bg-white px-2 py-1 text-xs font-bold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
