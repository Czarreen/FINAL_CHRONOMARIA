import { useMemo } from 'react';

export function useRoomConflictMap(bookings) {
  const conflictMap = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(bookings)) return map;
    for (const b of bookings) {
      if (!b.room_id || !b.slot) continue;
      const key = `${String(b.room_id).trim()}:${b.slot}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(b);
    }
    return map;
  }, [bookings]);

  const getConflictingOfferings = (roomId, slot) => {
    if (!roomId) return [];
    return conflictMap.get(`${String(roomId).trim()}:${slot}`) || [];
  };

  return { conflictMap, getConflictingOfferings };
}
