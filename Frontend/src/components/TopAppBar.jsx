import { Bell, Settings as SettingsIcon } from 'lucide-react';

export default function TopAppBar({ title, onLogout, onSettingsClick }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const userRole = user.role || 'staff';
  const canAccessSettings = userRole !== 'staff';

  return (
    <header className="fixed top-0 right-0 z-40 ml-[260px] flex h-16 w-[calc(100%-260px)] items-center justify-between border-b border-white/40 bg-white/70 px-8 shadow-sm backdrop-blur-[20px]">
      <div className="hidden text-xl font-bold text-indigo-600 md:block">Chronomaria</div>

      <div className="flex items-center gap-4">
        <button className="flex items-center justify-center rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
          <Bell size={20} />
        </button>
        {canAccessSettings && (
          <button
            onClick={onSettingsClick}
            className="flex items-center justify-center rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          >
            <SettingsIcon size={20} />
          </button>
        )}
        <div className="mx-2 h-8 w-px bg-outline-variant/50" />
        <button
          onClick={onLogout}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium text-error transition-colors hover:bg-error-container/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        >
          <span className="material-symbols-outlined text-[20px]">logout</span>
          <span className="text-label-bold">Logout</span>
        </button>
      </div>
    </header>
  );
}
