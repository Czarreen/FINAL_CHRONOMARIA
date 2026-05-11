import {
  BarChart3,
  Users,
  BookOpen,
  DoorOpen,
  Calendar,
  NotebookTabs,
  LogOut,
  CircleUserRound,
} from 'lucide-react';

export default function Sidebar({ currentView, onViewChange, onLogout }) {
  const menuItems = [
    { id: 'dashboard', icon: BarChart3, label: 'Dashboard' },
    { id: 'course-offering', icon: NotebookTabs, label: 'Course Offering' },
    { id: 'faculty', icon: Users, label: 'Faculty' },
    { id: 'subjects', icon: BookOpen, label: 'Subjects' },
    { id: 'rooms', icon: DoorOpen, label: 'Rooms' },
    { id: 'schedule', icon: Calendar, label: 'Schedule' },
  ];

  return (
    <aside className="fixed left-0 top-0 z-50 flex h-screen w-[260px] flex-col overflow-y-auto border-r border-white/40 bg-white/70 p-6 shadow-[30px_0_40px_rgba(0,0,0,0.05)] backdrop-blur-[20px]">
      <div className="mb-4 border-b border-white/20 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-container text-on-primary-container shadow-sm">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
              schedule
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-indigo-600">Chronomaria</h1>
            <p className="text-body-sm text-on-surface-variant/70">Faculty Loading</p>
          </div>
        </div>
      </div>

      <nav className="mt-4 flex-1 space-y-2">
        {menuItems.map((item) => {
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`flex w-full scale-95 items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition-all duration-300 active:scale-90 ${
                isActive
                  ? 'bg-white/60 text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:bg-white/40 hover:text-indigo-500'
              }`}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/20 pt-6">
        <div className="mb-4 flex items-center gap-3 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/50 bg-indigo-600 text-white">
            <CircleUserRound size={16} />
          </div>
          <div>
            <p className="text-label-bold font-medium text-on-surface">Administrator</p>
            <p className="text-[10px] text-on-surface-variant">System Admin</p>
          </div>
        </div>

        <button
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-error transition-colors hover:bg-error-container/50"
        >
          <LogOut size={18} />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
