import { motion } from 'motion/react';
import { Check, X, AlertTriangle, AlertCircle } from 'lucide-react';

const VARIANTS = {
  success: {
    icon: Check,
    iconClass: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
    barClass: 'bg-emerald-400',
    title: 'Saved successfully',
  },
  error: {
    icon: AlertCircle,
    iconClass: 'text-rose-600',
    iconBg: 'bg-rose-100',
    barClass: 'bg-rose-400',
    title: 'Something went wrong',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'text-amber-600',
    iconBg: 'bg-amber-100',
    barClass: 'bg-amber-400',
    title: 'Warning',
  },
};

export default function Toast({ message, onClose, duration = 3000, type = 'success', title }) {
  const variant = VARIANTS[type] ?? VARIANTS.success;
  const Icon = variant.icon;
  const displayTitle = title ?? variant.title;

  return (
    <motion.div
      initial={{ x: 96, opacity: 0, scale: 0.94 }}
      animate={{ x: 0, opacity: 1, scale: 1 }}
      exit={{ x: 96, opacity: 0, scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
      className="fixed top-5 right-5 z-[300] w-80 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/6"
    >
      <div className="flex items-start gap-3 p-4">
        <div className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${variant.iconBg}`}>
          <Icon size={18} className={variant.iconClass} strokeWidth={2.5} />
        </div>

        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-sm font-bold text-slate-800">{displayTitle}</p>
          {message && <p className="mt-0.5 text-sm text-slate-500 break-words">{message}</p>}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          aria-label="Dismiss"
        >
          <X size={15} />
        </button>
      </div>

      <motion.div
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: duration / 1000, ease: 'linear' }}
        style={{ transformOrigin: 'left' }}
        className={`h-1 w-full ${variant.barClass}`}
      />
    </motion.div>
  );
}
