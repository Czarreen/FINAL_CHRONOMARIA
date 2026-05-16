import { Lock, Plus, X } from 'lucide-react';
import { buildScheduleString, getScheduleTimeRange, timesOverlap } from '../utils/scheduleUtils';

const MODES = {
  mth: [
    { value: 'pair', label: 'Mon + Thu', short: 'MT' },
    { value: 'mon', label: 'Mon only', short: 'M' },
    { value: 'thu', label: 'Thu only', short: 'Th' },
  ],
  tfs: [
    { value: 'pair', label: 'Tue + Fri', short: 'TF' },
    { value: 'tue', label: 'Tue only', short: 'T' },
    { value: 'fri', label: 'Fri only', short: 'F' },
    { value: 'sat', label: 'Sat only', short: 'S' },
  ],
};

// Hours 06–21
const HOURS = Array.from({ length: 16 }, (_, i) => String(i + 6).padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

const SLOT_LABELS = {
  mth: 'Monday / Thursday',
  tfs: 'Tuesday / Friday / Saturday',
};

/**
 * Structured schedule card input with day-mode selector, time pickers,
 * Lec/Lab type toggle, and a conflict-aware room dropdown.
 *
 * Props:
 *   slot              'mth' | 'tfs'
 *   value             { enabled, mode, startH, startM, endH, endM, type }
 *   onChange          (newValue) => void
 *   onToggle          () => void  — called to enable/disable this card
 *   canDisable        boolean  — false when this is the only enabled card (prevents disabling last)
 *   roomId            string | null
 *   onRoomChange      (roomId) => void
 *   rooms             Array<{ room_id, room_name, room_type? }>
 *   getConflictingOfferings  (roomId, slot) => offering[]  (optional)
 *   editingId         number | string | null
 *   isMissing         boolean  (amber highlight for notification fix mode)
 *   disabled          boolean  (lock all inputs, for notification locked fields)
 */
export default function ScheduleCardInput({
  slot,
  value,
  onChange,
  onToggle,
  canDisable = true,
  roomId,
  onRoomChange,
  rooms = [],
  getConflictingOfferings,
  editingId = null,
  isMissing = false,
  disabled = false,
}) {
  const enabled = value.enabled ?? false;
  const modes = MODES[slot] || MODES.mth;

  const update = (patch) => onChange({ ...value, ...patch });

  // Compute current card start/end in minutes for conflict detection
  const currentStart =
    value.startH != null && value.startM != null
      ? parseInt(value.startH, 10) * 60 + parseInt(value.startM, 10)
      : null;
  const currentEnd =
    value.endH != null && value.endM != null
      ? parseInt(value.endH, 10) * 60 + parseInt(value.endM, 10)
      : null;

  const timeIsSet = currentStart !== null && currentEnd !== null && currentEnd > currentStart;

  // Returns conflict info for a given room
  const getRoomConflictInfo = (rid) => {
    if (!getConflictingOfferings || !timeIsSet) return { hasConflict: false, codes: [] };
    const conflicting = getConflictingOfferings(String(rid), slot);
    const realConflicts = conflicting.filter((o) => {
      const eid = o.id ?? o.subject_id;
      if (editingId != null && eid != null && String(eid) === String(editingId)) return false;
      const schedField = slot === 'mth' ? o.mth_schedule : o.tfs_schedule;
      const range = getScheduleTimeRange(schedField);
      if (!range) return false;
      return timesOverlap(currentStart, currentEnd, range.start, range.end);
    });
    return {
      hasConflict: realConflicts.length > 0,
      codes: realConflicts
        .map((o) => o.code || o.subject_code || String(o.id || o.subject_id || ''))
        .filter(Boolean),
    };
  };

  const schedulePreview = enabled
    ? buildScheduleString(slot, value.mode || 'pair', value.startH, value.startM, value.endH, value.endM, value.type)
    : null;

  const slotLabel = SLOT_LABELS[slot] || slot.toUpperCase();

  const cardBorder = isMissing
    ? 'border-amber-300 ring-2 ring-amber-400/40'
    : enabled
    ? 'border-primary/30'
    : 'border-slate-200';

  const selectClass = `rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed`;

  // Collapsed / disabled state
  if (!enabled) {
    return (
      <div className={`rounded-xl border ${cardBorder} bg-slate-50/60 p-4 transition-all`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/50">
              {slotLabel} Schedule
            </p>
            <p className="text-xs text-on-surface-variant/40 mt-0.5">Not in use</p>
          </div>
          <button
            type="button"
            onClick={onToggle}
            disabled={disabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-white px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={13} />
            Enable
          </button>
        </div>
      </div>
    );
  }

  // Expanded / enabled state
  return (
    <div className={`rounded-xl border ${cardBorder} bg-white/90 p-4 space-y-4 transition-all`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/70">
            {slotLabel} Schedule
          </p>
          {schedulePreview && (
            <p className="text-sm font-semibold text-primary">{schedulePreview}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isMissing && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
              MISSING
            </span>
          )}
          {canDisable ? (
            <button
              type="button"
              onClick={onToggle}
              disabled={disabled}
              title="Disable this schedule slot"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X size={12} />
              Disable
            </button>
          ) : (
            <span className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-300 cursor-not-allowed" title="At least one schedule is required">
              Last active
            </span>
          )}
        </div>
      </div>

      {/* Day mode selector */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/60">
          Days
        </p>
        <div className="flex flex-wrap gap-2">
          {modes.map((m) => (
            <button
              key={m.value}
              type="button"
              disabled={disabled}
              onClick={() => update({ mode: m.value })}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                value.mode === m.value
                  ? 'bg-primary text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-on-surface-variant hover:bg-slate-50'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Time inputs */}
      <div className="grid grid-cols-2 gap-4">
        {/* Start time */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/60">
            Start Time
          </p>
          <div className="flex items-center gap-1">
            <select
              value={value.startH || '07'}
              disabled={disabled}
              onChange={(e) => update({ startH: e.target.value })}
              className={selectClass}
              aria-label="Start hour"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <span className="text-lg font-bold text-on-surface-variant">:</span>
            <select
              value={value.startM || '00'}
              disabled={disabled}
              onChange={(e) => update({ startM: e.target.value })}
              className={selectClass}
              aria-label="Start minute"
            >
              {MINUTES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* End time */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/60">
            End Time
          </p>
          <div className="flex items-center gap-1">
            <select
              value={value.endH || '10'}
              disabled={disabled}
              onChange={(e) => update({ endH: e.target.value })}
              className={selectClass}
              aria-label="End hour"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <span className="text-lg font-bold text-on-surface-variant">:</span>
            <select
              value={value.endM || '00'}
              disabled={disabled}
              onChange={(e) => update({ endM: e.target.value })}
              className={selectClass}
              aria-label="End minute"
            >
              {MINUTES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Type toggle: Lec / Lab */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/60">
          Type
        </p>
        <div className="flex gap-2">
          {['lec', 'lab'].map((t) => (
            <button
              key={t}
              type="button"
              disabled={disabled}
              onClick={() => update({ type: t })}
              className={`rounded-lg px-4 py-1.5 text-sm font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                value.type === t
                  ? t === 'lec'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-emerald-600 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-on-surface-variant hover:bg-slate-50'
              }`}
            >
              {t === 'lec' ? 'Lec' : 'Lab'}
            </button>
          ))}
        </div>
      </div>

      {/* Room dropdown */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/60">
          Room
        </p>
        {!timeIsSet && (
          <p className="text-xs text-on-surface-variant/50 italic">
            Set a valid time range first to see room availability.
          </p>
        )}
        <div className="relative">
          <select
            value={roomId || ''}
            disabled={disabled || rooms.length === 0}
            onChange={(e) => onRoomChange(e.target.value || null)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
            aria-label={`Room for ${slot.toUpperCase()} schedule`}
          >
            <option value="">— No Room —</option>
            {rooms.map((room) => {
              const rid = String(room.room_id ?? room.id ?? '');
              if (!rid) return null;
              const { hasConflict, codes } = getRoomConflictInfo(rid);
              const label = hasConflict
                ? `${room.room_name || `Room ${rid}`} — CONFLICT (${codes.slice(0, 2).join(', ')}${codes.length > 2 ? '...' : ''})`
                : `${room.room_name || `Room ${rid}`}${room.room_type ? ` (${room.room_type})` : ''}`;
              return (
                <option key={rid} value={rid} disabled={hasConflict}>
                  {hasConflict ? `[LOCKED] ${label}` : label}
                </option>
              );
            })}
          </select>
        </div>

        {/* Show selected room + inline conflict badge below the select */}
        {roomId && (() => {
          const selectedRoom = rooms.find((r) => String(r.room_id ?? r.id ?? '') === String(roomId));
          const { hasConflict, codes } = getRoomConflictInfo(roomId);
          if (!selectedRoom) return null;
          return (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${hasConflict ? 'bg-red-50 text-red-700' : 'bg-primary/5 text-primary'}`}>
              {hasConflict ? (
                <>
                  <Lock size={13} className="flex-shrink-0" />
                  <span className="font-medium">
                    {selectedRoom.room_name} conflicts with: {codes.join(', ')}
                  </span>
                </>
              ) : (
                <>
                  <span className="font-medium">{selectedRoom.room_name}</span>
                  {selectedRoom.room_type && (
                    <span className="text-primary/60">({selectedRoom.room_type})</span>
                  )}
                  <span className="ml-auto text-xs text-primary/60">Available</span>
                </>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
