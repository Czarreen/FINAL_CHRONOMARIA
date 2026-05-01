import { useEffect, useMemo, useState } from 'react';
import { Users, Edit2, Trash2, Mail, Building2, BadgeCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchFacultyPage } from '../services/facultyApi.js';

export default function FacultyView() {
  const [faculty, setFaculty] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentDeptIndex, setCurrentDeptIndex] = useState(0);
  const PAGE_SIZE = 500;

  useEffect(() => {
    setLoading(true);
    fetchFacultyPage(1, PAGE_SIZE)
      .then((data) => {
        setFaculty(data.rows || []);
        setError(null);
        setCurrentDeptIndex(0);
      })
      .catch((err) => {
        console.error('Failed to fetch faculty:', err);
        setError(err.message);
        setFaculty([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const { stats, departments, currentDepartment, currentFaculty } = useMemo(() => {
    const activeCount = faculty.filter((f) => f.faculty_status === 'active').length;
    const onLeaveCount = faculty.filter((f) => f.faculty_status === 'on-leave').length;
    
    // Group by department
    const deptMap = {};
    faculty.forEach((f) => {
      const deptName = f.departments?.department_name || 'Unassigned';
      if (!deptMap[deptName]) {
        deptMap[deptName] = [];
      }
      deptMap[deptName].push(f);
    });
    
    const depts = Object.keys(deptMap).sort();
    const departmentCount = depts.length;
    
    const current = depts[currentDeptIndex] || null;
    const members = current ? deptMap[current] : [];

    return {
      stats: { activeCount, onLeaveCount, departmentCount },
      departments: depts,
      currentDepartment: current,
      currentFaculty: members,
    };
  }, [faculty, currentDeptIndex]);

  const handlePrevDept = () => {
    setCurrentDeptIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextDept = () => {
    setCurrentDeptIndex((prev) => Math.min(departments.length - 1, prev + 1));
  };

  return (
    <div className="space-y-gutter animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2 className="text-headline-xl font-headline-xl text-on-surface">Faculty Directory</h2>
          <p className="mt-1 text-body-md text-on-surface-variant">Manage and track academic teaching staff.</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Users size={18} />
          <span>Add New Faculty</span>
        </button>
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="border-b border-white/50 px-6 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { label: 'Active', value: String(stats.activeCount), icon: BadgeCheck },
              { label: 'On Leave', value: String(stats.onLeaveCount), icon: Users },
              { label: 'Departments', value: String(stats.departmentCount), icon: Building2 },
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
              {loading ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-on-surface-variant">
                    Loading faculty data...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-red-500">
                    Error: {error}
                  </td>
                </tr>
              ) : faculty.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-on-surface-variant">
                    No faculty members found.
                  </td>
                </tr>
              ) : currentFaculty.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-on-surface-variant">
                    No faculty in this department.
                  </td>
                </tr>
              ) : (
                currentFaculty.map((member) => (
                  <tr key={member.faculty_id} className="group transition-colors hover:bg-white/45">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/60 bg-primary/10 font-bold text-primary shadow-sm">
                          {member.faculty_name.split(' ').map((n) => n[0]).join('')}
                        </div>
                        <div>
                          <p className="font-bold text-on-surface">{member.faculty_name}</p>
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-on-surface-variant/70">
                            <Mail size={12} />
                            <span>{member.faculty_name.toLowerCase().replace(/\s+/g, '.')}@chronomaria.edu</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-on-surface-variant">
                      {member.departments?.department_name || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">{member.faculty_role}</td>
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
                        {member.faculty_status?.replace('-', ' ')}
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
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-white/50 bg-white/35 px-6 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">
            {currentDepartment ? `${currentDepartment} (${currentFaculty.length} members)` : 'No departments'}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevDept}
              disabled={currentDeptIndex === 0}
              className="h-8 w-8 rounded-md border border-white/60 bg-white text-xs font-bold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex items-center gap-1">
              {departments.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentDeptIndex(idx)}
                  className={`h-8 w-8 rounded-md text-xs font-bold transition-colors ${
                    idx === currentDeptIndex
                      ? 'bg-primary text-white shadow-sm'
                      : 'border border-white/60 bg-white text-on-surface-variant hover:bg-slate-50'
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
            <button
              onClick={handleNextDept}
              disabled={currentDeptIndex === departments.length - 1}
              className="h-8 w-8 rounded-md border border-white/60 bg-white text-xs font-bold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

