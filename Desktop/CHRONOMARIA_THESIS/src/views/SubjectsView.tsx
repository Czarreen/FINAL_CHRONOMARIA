import { BookOpen, PlusCircle, Edit2, Trash2, Clock, Layers, LibraryBig } from 'lucide-react';
import { Subject } from '../types';

const MOCK_SUBJECTS: Subject[] = [
  { id: '1', code: 'CS-301', title: 'Advanced Algorithm Design', units: 3.0, category: 'major', lastUpdate: '2h ago' },
  { id: '2', code: 'ENG-102', title: 'Technical Report Writing', units: 2.0, category: 'minor', lastUpdate: 'Oct 12' },
  { id: '3', code: 'MATH-204', title: 'Differential Equations', units: 3.0, category: 'major', lastUpdate: 'Yesterday' },
  { id: '4', code: 'CS-402', title: 'Human-Computer Interaction', units: 3.0, category: 'major', lastUpdate: 'Yesterday' },
];

export default function SubjectsView() {
  return (
    <div className="space-y-gutter animate-in slide-in-from-right-4 duration-500">
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-12">
        <div className="glass-panel col-span-1 flex items-center justify-between p-8 lg:col-span-8">
          <div className="space-y-1">
            <h2 className="text-headline-xl font-headline-xl text-on-surface">Curriculum Repository</h2>
            <p className="text-body-md text-on-surface-variant">Manage subjects, credit units, and classifications.</p>
          </div>
          <button className="btn-primary flex items-center gap-2">
            <PlusCircle size={18} />
            <span>Add Subject</span>
          </button>
        </div>
        <div className="glass-panel flex flex-col items-center justify-center p-6 text-center">
          <LibraryBig size={24} className="text-primary" />
          <span className="mt-3 text-3xl font-bold text-on-surface">124</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Total Subjects</span>
        </div>
        <div className="glass-panel flex flex-col items-center justify-center p-6 text-center">
          <span className="text-3xl font-bold text-on-surface">368</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Total Units</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 py-1">
        <button className="rounded-md bg-primary px-5 py-2 text-xs font-bold text-white shadow-md shadow-primary/20">All Courses</button>
        <button className="rounded-md border border-white/60 bg-white px-5 py-2 text-xs font-bold text-on-surface-variant transition-all hover:bg-slate-50">Major</button>
        <button className="rounded-md border border-white/60 bg-white px-5 py-2 text-xs font-bold text-on-surface-variant transition-all hover:bg-slate-50">Minor</button>
        <button className="rounded-md border border-white/60 bg-white px-5 py-2 text-xs font-bold text-on-surface-variant transition-all hover:bg-slate-50">Electives</button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {MOCK_SUBJECTS.map((subject) => (
          <div key={subject.id} className="glass-panel group relative space-y-6 p-6 transition-all hover:-translate-y-0.5 hover:shadow-xl">
            <div className="flex items-start justify-between">
              <span className="badge badge-success px-3 py-1 text-xs font-bold">{subject.code}</span>
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
              <h3 className="mb-3 text-xl font-bold text-on-surface transition-colors group-hover:text-primary">{subject.title}</h3>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2 text-sm font-medium text-on-surface-variant">
                  <Clock size={16} className="text-slate-400" />
                  {subject.units.toFixed(1)} Units
                </div>
                <div className="flex items-center gap-2 text-sm font-medium text-on-surface-variant">
                  <Layers size={16} className="text-slate-400" />
                  {subject.category.charAt(0).toUpperCase() + subject.category.slice(1)}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-white/50 pt-6">
              <div className="flex -space-x-2">
                {[1, 2].map((i) => (
                  <div key={i} className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                    S{i}
                  </div>
                ))}
              </div>
              <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Update: {subject.lastUpdate}</span>
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
    </div>
  );
}
