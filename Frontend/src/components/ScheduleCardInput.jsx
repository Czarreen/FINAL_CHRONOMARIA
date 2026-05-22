import { Lock, Plus } from 'lucide-react';
import { PAIR_DAY_NAMES, buildScheduleString, getScheduleTimeRange, timesOverlap } from '../utils/scheduleUtils';

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

const EARLIEST_START = 6 * 60;
const LATEST_END = 20 * 60;

const START_HOURS = Array.from({ length: 14 }, (_, i) => String(i + 6).padStart(2, '0'));
const END_HOURS = Array.from({ length: 15 }, (_, i) => String(i + 6).padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

const h24ToLabel = (h24str) => {
  const h = parseInt(h24str, 10);
  if (h === 0)  return '12 AM';
  if (h < 12)   return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
};

const SLOT_LABELS = {
  mth: 'Monday / Thursday',
  tfs: 'Tuesday / Friday / Saturday',
};

const selectClass = `rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed`;

const TYPE_OPTIONS = [
  { value: 'lec', label: 'Lec', activeClass: 'bg-blue-600 text-white shadow-sm' },
  { value: 'lab', label: 'Lab', activeClass: 'bg-emerald-600 text-white shadow-sm' },
  { value: 'both', label: 'Both', activeClass: 'bg-slate-600 text-white shadow-sm' },
];

/**
 * Structured schedule card input with day-mode selector, time pickers,
 * Lec/Lab/Both type toggle, and a conflict-aware room dropdown.
 * Always shows two columns — Block 2 can be independently enabled (hasSec).
 * Block 2 room is always selectable regardless of hasSec, enabling "1 sched / 2 rooms".
 *
 * Props:
 *   slot              'mth' | 'tfs'
 *   value             { enabled, mode, startH, startM, endH, endM, type,
 *                       hasSec, startH2, startM2, endH2, endM2, type2 }
 *   onChange          (newValue) => void
 *   onToggle          () => void  — called to enable/disable this card
 *   canDisable        boolean  — false when this is the only enabled card
 *   roomId            string | null  — block 1 room
 *   onRoomChange      (roomId) => void
 *   roomId2           string | null  — block 2 room
 *   onRoomChange2     (roomId) => void
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
  roomId2 = null,
  onRoomChange2,
  rooms = [],
  getConflictingOfferings,
  editingId = null,
  isMissing = false,
  disabled = false,
}) {
  const enabled = value.enabled ?? false;
  const hasSec = value.hasSec ?? false;
  const modes = MODES[slot] || MODES.mth;

  const update = (patch) => onChange({ ...value, ...patch });

  const currentStart =
    value.startH != null && value.startM != null
      ? parseInt(value.startH, 10) * 60 + parseInt(value.startM, 10)
      : null;
  const currentEnd =
    value.endH != null && value.endM != null
      ? parseInt(value.endH, 10) * 60 + parseInt(value.endM, 10)
      : null;
  const timeIsSet = currentStart !== null && currentEnd !== null && currentEnd > currentStart;

  const currentStart2 =
    value.startH2 != null && value.startM2 != null
      ? parseInt(value.startH2, 10) * 60 + parseInt(value.startM2, 10)
      : null;
  const currentEnd2 =
    value.endH2 != null && value.endM2 != null
      ? parseInt(value.endH2, 10) * 60 + parseInt(value.endM2, 10)
      : null;
  const timeIsSet2 = currentStart2 !== null && currentEnd2 !== null && currentEnd2 > currentStart2;

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

  const getRoomConflictInfo2 = (rid) => {
    if (!getConflictingOfferings || !timeIsSet2) return { hasConflict: false, codes: [] };
    const conflicting = getConflictingOfferings(String(rid), slot);
    const realConflicts = conflicting.filter((o) => {
      const eid = o.id ?? o.subject_id;
      if (editingId != null && eid != null && String(eid) === String(editingId)) return false;
      const schedField = slot === 'mth' ? o.mth_schedule : o.tfs_schedule;
      const range = getScheduleTimeRange(schedField);
      if (!range) return false;
      return timesOverlap(currentStart2, currentEnd2, range.start, range.end);
    });
    return {
      hasConflict: realConflicts.length > 0,
      codes: realConflicts
        .map((o) => o.code || o.subject_code || String(o.id || o.subject_id || ''))
        .filter(Boolean),
    };
  };

  const isPair = (value.mode || 'pair') === 'pair';
  const block1Label = isPair ? (PAIR_DAY_NAMES[slot]?.block1 || 'Block 1') : 'Block 1';
  const block2Label = isPair ? (PAIR_DAY_NAMES[slot]?.block2 || 'Block 2') : 'Block 2';

  const schedulePreview = enabled
    ? buildScheduleString(
        slot, value.mode || 'pair',
        value.startH, value.startM, value.endH, value.endM, value.type,
        hasSec, value.startH2, value.startM2, value.endH2, value.endM2, value.type2
      )
    : null;

  const slotLabel = SLOT_LABELS[slot] || slot.toUpperCase();

  const cardBorder = isMissing
    ? 'border-amber-300 ring-2 ring-amber-400/40'
    : enabled
    ? 'border-primary/30'
    : 'border-slate-200';

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

  const renderRoomDropdown = ({ rid, onSelect, getConflict, timeReady, label }) => (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/60">Room</p>
      {!timeReady && (
        <p className="text-xs text-on-surface-variant/50 italic">Set valid time first.</p>
      )}
      <select
        value={rid || ''}
        disabled={disabled || rooms.length === 0}
        onChange={(e) => onSelect(e.target.value || null)}
        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
        aria-label={label}
      >
        <option value="">— No Room —</option>
        {rooms.map((room) => {
          const roomIdStr = String(room.room_id ?? room.id ?? '');
          if (!roomIdStr) return null;
          const { hasConflict, codes } = getConflict(roomIdStr);
          const roomLabel = hasConflict
            ? `${room.room_name || `Room ${roomIdStr}`} — CONFLICT (${codes.slice(0, 2).join(', ')}${codes.length > 2 ? '...' : ''})`
            : `${room.room_name || `Room ${roomIdStr}`}${room.room_type ? ` (${room.room_type})` : ''}`;
          return (
            <option key={roomIdStr} value={roomIdStr} disabled={hasConflict}>
              {hasConflict ? `[LOCKED] ${roomLabel}` : roomLabel}
            </option>
          );
        })}
      </select>
      {rid && (() => {
        const selectedRoom = rooms.find((r) => String(r.room_id ?? r.id ?? '') === String(rid));
        const { hasConflict, codes } = getConflict(rid);
        if (!selectedRoom) return null;
        return (
          <div className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs ${hasConflict ? 'bg-red-50 text-red-700' : 'bg-primary/5 text-primary'}`}>
            {hasConflict ? (
              <>
                <Lock size={11} className="flex-shrink-0" />
                <span className="font-medium truncate">{selectedRoom.room_name}: {codes.join(', ')}</span>
              </>
            ) : (
              <>
                <span className="font-medium truncate">{selectedRoom.room_name}</span>
                <span className="ml-auto text-primary/60 flex-shrink-0">Available</span>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );

  const renderTypeButtons = ({ field, currentType, isDisabled }) => (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/60">Type</p>
      <div className="flex gap-1.5">
        {TYPE_OPTIONS.map((t) => (
          <button
            key={t.value}
            type="button"
            disabled={isDisabled}
            onClick={() => update({ [field]: t.value })}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              currentType === t.value
                ? t.activeClass
                : 'border border-slate-200 bg-white text-on-surface-variant hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );

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
        <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/60">Days</p>
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

      {/* Always-visible two-column block grid */}
      <div className="grid grid-cols-2 gap-3">

        {/* Block 1 */}
        <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/40 p-3">
          <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/70">
            {block1Label}
          </p>

          {/* Block 1 — Time */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/60">Start</p>
              <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/60">End</p>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <select
                value={value.startH || '07'}
                disabled={disabled}
                onChange={(e) => update({ startH: e.target.value, startM: value.startM || '00' })}
                className={selectClass}
                aria-label="Block 1 start hour"
              >
                {START_HOURS.map((h) => (
                  <option key={h} value={h}>{h24ToLabel(h)}</option>
                ))}
              </select>
              <span className="text-sm font-bold text-on-surface-variant">:</span>
              <select
                value={value.startM || '30'}
                disabled={disabled}
                onChange={(e) => update({ startM: e.target.value })}
                className={selectClass}
                aria-label="Block 1 start minute"
              >
                {MINUTES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <span className="text-on-surface-variant text-sm mx-0.5">→</span>
              <select
                value={value.endH || '10'}
                disabled={disabled}
                onChange={(e) => {
                  const h = e.target.value;
                  const m = h === '20' && parseInt(value.endM || '00', 10) > 0 ? '00' : (value.endM || '00');
                  update({ endH: h, endM: m });
                }}
                className={selectClass}
                aria-label="Block 1 end hour"
              >
                {END_HOURS.map((h) => (
                  <option key={h} value={h}>{h24ToLabel(h)}</option>
                ))}
              </select>
              <span className="text-sm font-bold text-on-surface-variant">:</span>
              <select
                value={value.endM || '00'}
                disabled={disabled}
                onChange={(e) => update({ endM: e.target.value })}
                className={selectClass}
                aria-label="Block 1 end minute"
              >
                {MINUTES.map((m) => {
                  const h = parseInt(value.endH || '10', 10);
                  return (
                    <option key={m} value={m} disabled={h === 20 && parseInt(m, 10) > 0}>{m}</option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Block 1 — Type */}
          {renderTypeButtons({ field: 'type', currentType: value.type || 'lec', isDisabled: disabled })}

          {/* Block 1 — Room */}
          {renderRoomDropdown({
            rid: roomId,
            onSelect: onRoomChange,
            getConflict: getRoomConflictInfo,
            timeReady: timeIsSet,
            label: `Block 1 room for ${slot.toUpperCase()}`,
          })}
        </div>

        {/* Block 2 */}
        <div className={`space-y-3 rounded-xl border p-3 transition-all ${hasSec ? 'border-slate-200 bg-slate-50/20' : 'border-dashed border-slate-200 bg-slate-50/10'}`}>
          <div className="flex items-center justify-between">
            <p className={`text-xs font-bold uppercase tracking-wider ${hasSec ? 'text-on-surface-variant/70' : 'text-on-surface-variant/40'}`}>
              {block2Label}
            </p>
            <button
              type="button"
              disabled={disabled}
              onClick={() => update({ hasSec: !hasSec })}
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                hasSec
                  ? 'border-slate-200 bg-white text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600'
                  : 'border-primary/30 bg-white text-primary hover:bg-primary/5'
              }`}
            >
              {hasSec ? 'Remove' : 'Enable'}
            </button>
          </div>

          {/* Block 2 — Time (disabled when !hasSec) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className={`text-xs font-semibold uppercase tracking-wider ${hasSec ? 'text-on-surface-variant/60' : 'text-on-surface-variant/30'}`}>Start</p>
              <p className={`text-xs font-semibold uppercase tracking-wider ${hasSec ? 'text-on-surface-variant/60' : 'text-on-surface-variant/30'}`}>End</p>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <select
                value={value.startH2 || '13'}
                disabled={disabled || !hasSec}
                onChange={(e) => update({ startH2: e.target.value, startM2: value.startM2 || '00' })}
                className={selectClass}
                aria-label="Block 2 start hour"
              >
                {START_HOURS.map((h) => (
                  <option key={h} value={h}>{h24ToLabel(h)}</option>
                ))}
              </select>
              <span className={`text-sm font-bold ${hasSec ? 'text-on-surface-variant' : 'text-on-surface-variant/30'}`}>:</span>
              <select
                value={value.startM2 || '00'}
                disabled={disabled || !hasSec}
                onChange={(e) => update({ startM2: e.target.value })}
                className={selectClass}
                aria-label="Block 2 start minute"
              >
                {MINUTES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <span className={`text-sm mx-0.5 ${hasSec ? 'text-on-surface-variant' : 'text-on-surface-variant/30'}`}>→</span>
              <select
                value={value.endH2 || '16'}
                disabled={disabled || !hasSec}
                onChange={(e) => {
                  const h = e.target.value;
                  const m = h === '20' && parseInt(value.endM2 || '00', 10) > 0 ? '00' : (value.endM2 || '00');
                  update({ endH2: h, endM2: m });
                }}
                className={selectClass}
                aria-label="Block 2 end hour"
              >
                {END_HOURS.map((h) => (
                  <option key={h} value={h}>{h24ToLabel(h)}</option>
                ))}
              </select>
              <span className={`text-sm font-bold ${hasSec ? 'text-on-surface-variant' : 'text-on-surface-variant/30'}`}>:</span>
              <select
                value={value.endM2 || '00'}
                disabled={disabled || !hasSec}
                onChange={(e) => update({ endM2: e.target.value })}
                className={selectClass}
                aria-label="Block 2 end minute"
              >
                {MINUTES.map((m) => {
                  const h = parseInt(value.endH2 || '16', 10);
                  return (
                    <option key={m} value={m} disabled={h === 20 && parseInt(m, 10) > 0}>{m}</option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Block 2 — Type (disabled when !hasSec) */}
          {renderTypeButtons({ field: 'type2', currentType: value.type2 || 'lec', isDisabled: disabled || !hasSec })}

          {/* Block 2 — Room (always selectable for "1 sched / 2 rooms") */}
          {renderRoomDropdown({
            rid: roomId2,
            onSelect: onRoomChange2 || (() => {}),
            getConflict: hasSec ? getRoomConflictInfo2 : getRoomConflictInfo,
            timeReady: hasSec ? timeIsSet2 : timeIsSet,
            label: `Block 2 room for ${slot.toUpperCase()}`,
          })}
        </div>

      </div>
    </div>
  );
}
