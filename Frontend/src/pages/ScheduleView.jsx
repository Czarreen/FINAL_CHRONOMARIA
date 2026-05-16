cuimport { Calendar, ChevronLeft, ChevronRight, CalendarOff, BrainCircuit, Clock3, LayoutGrid, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';

export default function ScheduleView() {
  return (
    <div className="space-y-gutter animate-in zoom-in-95 duration-500">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-headline-xl font-headline-xl text-on-surface">Schedule Preview</h2>
          <p className="mt-1 text-body-md text-on-surface-variant">Review the generated faculty load distribution.</p>
        </div>
        <div className="flex items-center gap-3">
           <button className="rounded-md p-2.5 btn-secondary">
            <ChevronLeft size={18} />
          </button>
          <button className="rounded-md p-2.5 btn-secondary">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="glass-panel flex min-h-[600px] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/50 bg-white/35 p-6">
          <div className="flex items-center gap-2">
             <button className="rounded-md bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm">
               Week View
             </button>
             <button className="rounded-md border border-white/60 bg-white px-4 py-2 text-xs font-bold text-on-surface-variant transition-all hover:bg-slate-50">
               Faculty Load View
             </button>
          </div>
          <div className="flex items-center gap-4">
             <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Select Semester:</span>
             <select className="cursor-pointer rounded-md border border-white/60 bg-white px-4 py-2 text-xs font-bold text-on-surface-variant outline-none focus:ring-2 focus:ring-primary/20">
               <option>1st Semester, 2024-2025</option>
               <option>2nd Semester, 2024-2025</option>
             </select>
          </div>
        </div>

        <div className="relative flex flex-1 flex-col items-center justify-center p-12 text-center">
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#4F46E5 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
          
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="relative z-10 max-w-lg"
          >
            <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl border border-white/60 bg-white/80 shadow-sm">
              <CalendarOff size={40} className="text-slate-400" />
            </div>
            <h4 className="mb-4 text-2xl font-bold text-on-surface">No Active Schedule Found</h4>
            <p className="mb-8 text-sm font-medium leading-relaxed text-on-surface-variant">
              The scheduling workspace is currently empty. The optimized <span className="font-bold text-primary">Genetic Algorithm Engine</span> is ready to process your constraints and generate a plan.
            </p>
            <button className="btn-primary mx-auto flex items-center gap-3 rounded-md px-8 py-4 text-base font-bold shadow-xl shadow-primary/20 transition-all hover:scale-105 active:scale-95">
              <BrainCircuit size={20} />
              <span>Launch Optimizer</span>
            </button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
