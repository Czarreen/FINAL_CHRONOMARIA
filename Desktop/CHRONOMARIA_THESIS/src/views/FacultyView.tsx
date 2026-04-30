import { Users, Edit2, Trash2, Mail, Building2, BadgeCheck } from 'lucide-react';
import { FacultyMember } from '../types';

const MOCK_FACULTY: FacultyMember[] = [
  { id: '1', name: 'Dr. Helena Vance', email: 'helena.v@chronomaria.edu', department: 'Computer Science', role: 'Associate Professor', status: 'active' },
  { id: '2', name: 'Prof. Robert Jenkins', email: 'robert.j@chronomaria.edu', department: 'Pure Mathematics', role: 'Department Head', status: 'on-leave' },
  { id: '3', name: 'Marcus Sterling', email: 'm.sterling@chronomaria.edu', department: 'Digital Arts', role: 'Lecturer', status: 'active' },
  { id: '4', name: 'Dr. Sarah Thompson', email: 's.thompson@chronomaria.edu', department: 'Literature & Philology', role: 'Senior Faculty', status: 'inactive' },
];

export default function FacultyView() {
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
              { label: 'Active', value: '18', icon: BadgeCheck },
              { label: 'On Leave', value: '4', icon: Users },
              { label: 'Departments', value: '6', icon: Building2 },
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
              {MOCK_FACULTY.map((member) => (
                <tr key={member.id} className="group transition-colors hover:bg-white/45">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/60 bg-primary/10 font-bold text-primary shadow-sm">
                        {member.name.split(' ').map((n) => n[0]).join('')}
                      </div>
                      <div>
                        <p className="font-bold text-on-surface">{member.name}</p>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-on-surface-variant/70">
                          <Mail size={12} />
                          <span>{member.email}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-on-surface-variant">{member.department}</td>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">{member.role}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`badge ${
                        member.status === 'active'
                          ? 'badge-success'
                          : member.status === 'on-leave'
                          ? 'badge-warning'
                          : 'badge-error'
                      }`}
                    >
                      {member.status.replace('-', ' ')}
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
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-white/50 bg-white/35 px-6 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Showing 4 of 124 Faculty Members</p>
          <div className="flex items-center gap-1">
            <button className="h-8 w-8 rounded-md bg-primary text-xs font-bold text-white shadow-sm">1</button>
            <button className="h-8 w-8 rounded-md border border-white/60 bg-white text-xs font-bold text-on-surface-variant transition-colors hover:bg-slate-50">2</button>
            <button className="h-8 w-8 rounded-md border border-white/60 bg-white text-xs font-bold text-on-surface-variant transition-colors hover:bg-slate-50">3</button>
          </div>
        </div>
      </div>
    </div>
  );
}
