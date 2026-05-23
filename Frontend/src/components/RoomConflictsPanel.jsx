import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Building2, ChevronDown, ChevronRight, X, AlertTriangle, Clock } from 'lucide-react';

const PEER_ID_FIELD = {
  offering: 'conflicting_offering_id',
  subject: 'conflicting_subject_id',
};

const DAY_SHORT = { MON: 'Mon', TUE: 'Tue', THU: 'Thu', FRI: 'Fri', SAT: 'Sat' };
const ROOM_TYPE_ORDER = ['Laboratory', 'Lecture'];

function formatDays(days) {
  if (!Array.isArray(days) || days.length === 0) return '';
  return days.map((d) => DAY_SHORT[d] || d).join(', ');
}

// Extract a human-readable time range from a raw schedule string.
// e.g. "MT 9:00-10:30 Lec" → "9:00 – 10:30"
// e.g. "10:30-1:30 M Lab, Th Lec" → "10:30 – 1:30"
function extractTimeRange(scheduleStr) {
  if (!scheduleStr) return null;
  const match = String(scheduleStr).match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
  if (!match) return null;
  return `${match[1]} – ${match[2]}`;
}

function buildConflictPairs(items, peerIdField) {
  const seen = new Set();
  const pairs = [];
  // Normalise keys to numbers so string/number type mismatches don't break lookups.
  const itemById = new Map(items.map((i) => [Number(i.entity_id), i]));

  for (const item of items) {
    for (const issue of (item.issues || [])) {
      if (issue.field !== 'schedule_conflict') continue;

      const primaryId = Number(item.entity_id);
      const rawPeerId = issue.details?.[peerIdField];
      if (!rawPeerId) continue;
      const peerId = Number(rawPeerId);
      if (!peerId || Number.isNaN(peerId)) continue;

      const roomId = issue.details?.conflict_room_id || null;
      const key = [Math.min(primaryId, peerId), Math.max(primaryId, peerId), roomId || ''].join(':');
      if (seen.has(key)) continue;
      seen.add(key);

      const peerItem =
        item.conflictPeer && Number(item.conflictPeer.entity_id) === peerId
          ? item.conflictPeer
          : itemById.get(peerId) || null;

      // Best peer title: title from the peer item, or the conflicting code stored in details.
      const peerTitle =
        peerItem?.title ||
        issue.details?.conflicting_code ||
        `#${peerId}`;

      pairs.push({
        key,
        primaryId,
        primaryTitle: item.title,
        primaryItem: item,
        peerId,
        peerTitle,
        peerItem,
        roomId,
        scheduleType: issue.details?.conflict_schedule_type || null,
        conflictDays: issue.details?.conflict_days || null,
        // Entity A's own schedule string for the conflicting slot.
        entitySchedule: issue.details?.conflict_entity_schedule || null,
      });
    }
  }

  return pairs;
}

function groupPairsByRoomType(pairs, roomMap) {
  const groups = new Map();

  for (const pair of pairs) {
    const roomId = pair.roomId ? String(pair.roomId) : null;
    const room = roomId ? roomMap.get(roomId) : null;
    const roomType = room?.room_type || 'Other';
    const roomName = room?.room_name || (roomId ? `Room ${roomId}` : 'Unknown Room');
    const roomKey = roomId || '__unknown__';

    if (!groups.has(roomType)) groups.set(roomType, new Map());
    const typeMap = groups.get(roomType);

    if (!typeMap.has(roomKey)) {
      typeMap.set(roomKey, { roomId, roomName, room, pairs: [] });
    }
    typeMap.get(roomKey).pairs.push(pair);
  }

  return groups;
}

function EntityCard({ title, scheduleStr, item, onJump, onEdit, onClose, flex }) {
  return (
    <div className={`rounded-xl bg-white border border-red-100 px-4 py-3${flex ? ' flex-1 min-w-0' : ''}`}>
      <p className="text-sm font-bold text-slate-800 truncate">{title}</p>
      {scheduleStr && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
          <Clock size={11} className="shrink-0 text-slate-400" />
          {scheduleStr}
        </p>
      )}
      {item && (
        <div className="flex gap-2 mt-2.5">
          <button
            type="button"
            onClick={() => { onJump?.(item); onClose?.(); }}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          >
            Jump
          </button>
          <button
            type="button"
            onClick={() => { onEdit?.(item); onClose?.(); }}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

export default function RoomConflictsPanel({
  items = [],
  rooms = [],
  entityType = 'offering',
  onItemJump,
  onItemEdit,
  onCompare,
}) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const [expandedTypes, setExpandedTypes] = useState(new Set());
  const [expandedRooms, setExpandedRooms] = useState(new Set());
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const peerIdField = PEER_ID_FIELD[entityType] || 'conflicting_offering_id';

  const roomMap = useMemo(() => {
    const map = new Map();
    for (const r of rooms) {
      if (!r) continue;
      const id = r.room_id ?? r.id;
      if (id != null) map.set(String(id), r);
    }
    return map;
  }, [rooms]);

  const allPairs = useMemo(() => buildConflictPairs(items, peerIdField), [items, peerIdField]);
  const grouped = useMemo(() => groupPairsByRoomType(allPairs, roomMap), [allPairs, roomMap]);
  const hasMissingRoomData = allPairs.some((p) => !p.roomId);
  const totalPairs = allPairs.length;

  const sortedTypes = useMemo(
    () =>
      [...grouped.keys()].sort((a, b) => {
        const oi = ROOM_TYPE_ORDER.indexOf(a);
        const oj = ROOM_TYPE_ORDER.indexOf(b);
        if (oi !== -1 && oj !== -1) return oi - oj;
        if (oi !== -1) return -1;
        if (oj !== -1) return 1;
        return a.localeCompare(b);
      }),
    [grouped]
  );

  // Panel positioning — anchored below the button, right-aligned.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (!btnRef.current) return;
      const rect = btnRef.current.getBoundingClientRect();
      const panelWidth = 660;
      setPanelPos({
        top: rect.bottom + 8,
        left: Math.max(8, rect.right - panelWidth),
      });
    };
    update();
    window.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggleType = (type) =>
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });

  const toggleRoom = (roomKey) =>
    setExpandedRooms((prev) => {
      const next = new Set(prev);
      next.has(roomKey) ? next.delete(roomKey) : next.add(roomKey);
      return next;
    });

  const closePanel = () => setOpen(false);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="View schedule conflicts grouped by room type"
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors min-h-[40px] min-w-max bg-slate-700 hover:bg-slate-800 text-white"
      >
        <Building2 size={14} />
        <span>Room Conflicts</span>
        {totalPairs > 0 && (
          <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none">
            {totalPairs}
          </span>
        )}
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: 'fixed',
              top: panelPos.top,
              left: panelPos.left,
              zIndex: 9998,
              width: 660,
              maxHeight: 'calc(100vh - 80px)',
            }}
            className="rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between bg-slate-800 px-6 py-4 text-white flex-shrink-0">
              <div className="flex items-center gap-3">
                <Building2 size={20} />
                <span className="font-bold text-lg">Room Conflicts</span>
                {totalPairs > 0 && (
                  <span className="rounded-full bg-red-500 px-2.5 py-0.5 text-sm font-bold">
                    {totalPairs} pair{totalPairs !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={closePanel}
                aria-label="Close panel"
                className="rounded-lg p-1.5 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Hint banner */}
            {hasMissingRoomData && (
              <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-100 px-5 py-2.5 text-sm text-amber-700 flex-shrink-0">
                <AlertTriangle size={14} className="shrink-0" />
                Some conflicts are missing room data — run Rescan to refresh.
              </div>
            )}

            {/* Body */}
            <div className="overflow-y-auto flex-1 p-4 space-y-3">
              {totalPairs === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <Building2 size={40} className="mb-4 text-slate-200" />
                  <p className="font-semibold text-slate-500 text-base">No room conflicts detected.</p>
                  <p className="mt-1.5 text-sm text-slate-400">Run Rescan to check for schedule conflicts.</p>
                </div>
              ) : (
                sortedTypes.map((roomType) => {
                  const typeRooms = grouped.get(roomType);
                  const typeTotal = [...typeRooms.values()].reduce(
                    (s, r) => s + r.pairs.length,
                    0
                  );
                  const typeOpen = expandedTypes.has(roomType);

                  return (
                    <div key={roomType} className="rounded-xl border border-slate-200 overflow-hidden">
                      {/* Room type header */}
                      <button
                        type="button"
                        onClick={() => toggleType(roomType)}
                        className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                      >
                        <div className="flex items-center gap-2.5">
                          {typeOpen ? (
                            <ChevronDown size={16} className="text-slate-500" />
                          ) : (
                            <ChevronRight size={16} className="text-slate-500" />
                          )}
                          <span className="font-bold text-base text-slate-700">
                            {roomType}
                          </span>
                        </div>
                        <span className="text-sm font-bold text-slate-500 bg-slate-200 rounded-full px-3 py-0.5">
                          {typeTotal} conflict{typeTotal !== 1 ? 's' : ''}
                        </span>
                      </button>

                      {typeOpen && (
                        <div className="divide-y divide-slate-100">
                          {[...typeRooms.entries()].map(([roomKey, roomData]) => {
                            const roomOpen = expandedRooms.has(roomKey);

                            return (
                              <div key={roomKey} className="bg-white">
                                {/* Room sub-header */}
                                <button
                                  type="button"
                                  onClick={() => toggleRoom(roomKey)}
                                  className="w-full flex items-center justify-between px-6 py-3 hover:bg-slate-50 transition-colors text-left"
                                >
                                  <div className="flex items-center gap-2">
                                    {roomOpen ? (
                                      <ChevronDown size={14} className="text-slate-400" />
                                    ) : (
                                      <ChevronRight size={14} className="text-slate-400" />
                                    )}
                                    <span className="text-sm font-semibold text-slate-700">
                                      {roomData.roomName}
                                    </span>
                                  </div>
                                  <span className="text-sm text-slate-400 font-medium">
                                    {roomData.pairs.length} conflict{roomData.pairs.length !== 1 ? 's' : ''}
                                  </span>
                                </button>

                                {roomOpen && (
                                  <div className="px-5 pb-4 space-y-4">
                                    {roomData.pairs.map((pair) => {
                                      const timeRange = extractTimeRange(pair.entitySchedule);
                                      // For the peer's schedule: look in peerItem's issues for the reverse conflict to get its schedule string.
                                      // If unavailable, we display the same time range (they overlap at the same slot).
                                      const peerScheduleStr = pair.peerItem
                                        ? (() => {
                                            const reverseIssue = (pair.peerItem.issues || []).find(
                                              (i) =>
                                                i.field === 'schedule_conflict' &&
                                                Number(i.details?.[peerIdField]) === pair.primaryId
                                            );
                                            return reverseIssue?.details?.conflict_entity_schedule || null;
                                          })()
                                        : null;
                                      const peerTimeRange = extractTimeRange(peerScheduleStr || pair.entitySchedule);

                                      return (
                                        <div
                                          key={pair.key}
                                          className="rounded-xl border border-red-200 bg-red-50/70 overflow-hidden"
                                        >
                                          {/* Conflict header: schedule type + days + time + Compare button */}
                                          <div className="flex flex-wrap items-center gap-2.5 px-4 py-2.5 bg-red-100/60 border-b border-red-200">
                                            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
                                              {pair.scheduleType && (
                                                <span className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-white">
                                                  {pair.scheduleType}
                                                </span>
                                              )}
                                              {pair.conflictDays && pair.conflictDays.length > 0 && (
                                                <span className="text-sm font-semibold text-red-700">
                                                  {formatDays(pair.conflictDays)}
                                                </span>
                                              )}
                                              {timeRange && (
                                                <span className="flex items-center gap-1 text-sm font-semibold text-red-700">
                                                  <Clock size={13} className="text-red-500" />
                                                  {timeRange}
                                                </span>
                                              )}
                                              {!pair.scheduleType && !pair.conflictDays && !timeRange && (
                                                <span className="text-sm text-slate-400 italic">
                                                  Rescan for time details
                                                </span>
                                              )}
                                            </div>
                                            {onCompare && (
                                              <button
                                                type="button"
                                                onClick={() => { onCompare(pair.primaryId, pair.peerId); closePanel(); }}
                                                className="shrink-0 rounded-lg px-3 py-1 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                                              >
                                                Compare
                                              </button>
                                            )}
                                          </div>

                                          {/* Entity pair — inline side-by-side */}
                                          <div className="p-3 flex gap-2 items-stretch">
                                            <EntityCard
                                              title={pair.primaryTitle}
                                              scheduleStr={pair.entitySchedule}
                                              item={pair.primaryItem}
                                              onJump={onItemJump}
                                              onEdit={onItemEdit}
                                              onClose={closePanel}
                                              flex
                                            />

                                            <div className="flex items-center justify-center shrink-0 px-1">
                                              <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">vs</span>
                                            </div>

                                            <EntityCard
                                              title={pair.peerTitle}
                                              scheduleStr={peerScheduleStr}
                                              item={pair.peerItem}
                                              onJump={onItemJump}
                                              onEdit={onItemEdit}
                                              onClose={closePanel}
                                              flex
                                            />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
