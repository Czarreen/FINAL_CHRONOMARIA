import { motion } from 'motion/react';
import { Check, X } from 'lucide-react';

/**
 * Success toast notification. Slides in from the top-right, drains a progress
 * bar, then dismisses itself. Parent controls the duration via the auto-dismiss
 * effect on its state; this component renders purely based on that state being
 * truthy. The X button calls onClose early if the user wants to dismiss it.
 *
 * @param {string}   message   The description line shown below "Saved!"
 * @param {Function} onClose   Called when the user clicks X or the parent
 *                             auto-dismisses (sets the parent state to null)
 * @param {number}   duration  Progress bar drain duration in ms (match parent timer)
 */
export default function Toast({ message, onClose, duration = 3000 }) {
  return (
    <motion.div
      initial={{ x: 96, opacity: 0, scale: 0.94 }}
      animate={{ x: 0, opacity: 1, scale: 1 }}
      exit={{ x: 96, opacity: 0, scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
      className="fixed top-5 right-5 z-[300] w-80 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/6"
    >
      <div className="flex items-start gap-3 p-4">
        {/* Icon */}
        <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
          <Check size={18} className="text-emerald-600" strokeWidth={2.5} />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-sm font-bold text-slate-800">Saved successfully</p>
          <p className="mt-0.5 text-sm text-slate-500 break-words">{message}</p>
        </div>

        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          aria-label="Dismiss"
        >
          <X size={15} />
        </button>
      </div>

      {/* Draining progress bar */}
      <motion.div
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: duration / 1000, ease: 'linear' }}
        style={{ transformOrigin: 'left' }}
        className="h-1 w-full bg-emerald-400"
      />
    </motion.div>
  );
}
