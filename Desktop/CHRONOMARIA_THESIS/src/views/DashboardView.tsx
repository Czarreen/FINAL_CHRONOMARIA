import { Calendar, CheckCircle2, DoorOpen, BookOpen, Users, UserPlus } from 'lucide-react';
import { motion } from 'motion/react';

export default function DashboardView() {
  const statCards = [
    { label: 'Total Faculty', value: '24', icon: Users },
    { label: 'Total Subjects', value: '29', icon: BookOpen },
    { label: 'Total Rooms', value: '19', icon: DoorOpen },
    { label: 'Schedules Generated', value: '0', icon: Calendar },
  ];

  return (
    <div className="space-y-gutter animate-in fade-in duration-500">
      <div className="mb-2 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2 className="text-headline-xl font-headline-xl text-on-surface">Dashboard</h2>
          <p className="mt-1 text-body-md text-on-surface-variant">Overview of the faculty loading system</p>
        </div>
        <button className="flex w-fit items-center gap-2 rounded-lg bg-primary px-6 py-2.5 font-label-bold text-label-bold text-on-primary shadow-sm transition-colors hover:bg-primary/90">
          <Calendar size={18} />
          Generate Schedules
        </button>
      </div>

      <div className="grid grid-cols-1 gap-gutter md:grid-cols-12">
        <div className="glass-panel col-span-1 flex min-h-[180px] flex-col justify-between rounded-xl p-container-padding md:col-span-4">
          <div className="flex items-start justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary-container/50 text-secondary">
              <CheckCircle2 size={24} />
            </div>
            <span className="rounded-md bg-secondary-container/30 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-secondary">
              Status
            </span>
          </div>
          <div className="mt-4">
            <p className="text-numeric-lg font-numeric-lg text-on-surface">100%</p>
            <p className="mt-1 text-body-sm font-medium text-on-surface-variant">System Readiness</p>
          </div>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-variant">
            <div className="h-full w-full rounded-full bg-secondary" />
          </div>
        </div>

        <div className="col-span-1 grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:col-span-8 lg:grid-cols-4">
          {statCards.map((card) => (
            <div key={card.label} className="glass-panel flex flex-col justify-center rounded-xl p-5">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-variant/50 text-tertiary">
                  <card.icon size={18} />
                </div>
                <h3 className="text-label-bold font-label-bold text-on-surface-variant">{card.label}</h3>
              </div>
              <p className="text-numeric-lg font-numeric-lg text-on-surface">{card.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <h3 className="mb-4 text-[18px] font-headline-lg text-on-surface">Quick Actions</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <button className="glass-panel group flex items-center gap-4 rounded-xl p-4 text-left transition-colors hover:bg-white/80">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-variant/50 text-primary transition-colors group-hover:bg-primary-container/30">
              <UserPlus size={20} />
            </div>
            <div>
              <p className="text-label-bold font-label-bold text-on-surface">Manage Faculty</p>
              <p className="mt-0.5 text-[11px] text-on-surface-variant">Add or edit instructors</p>
            </div>
          </button>

          <button className="glass-panel group flex items-center gap-4 rounded-xl p-4 text-left transition-colors hover:bg-white/80">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-variant/50 text-primary transition-colors group-hover:bg-primary-container/30">
              <BookOpen size={20} />
            </div>
            <div>
              <p className="text-label-bold font-label-bold text-on-surface">Manage Subjects</p>
              <p className="mt-0.5 text-[11px] text-on-surface-variant">Update course offerings</p>
            </div>
          </button>

          <button className="glass-panel group flex items-center gap-4 rounded-xl p-4 text-left transition-colors hover:bg-white/80">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-variant/50 text-primary transition-colors group-hover:bg-primary-container/30">
              <DoorOpen size={20} />
            </div>
            <div>
              <p className="text-label-bold font-label-bold text-on-surface">Manage Rooms</p>
              <p className="mt-0.5 text-[11px] text-on-surface-variant">Configure facilities</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
