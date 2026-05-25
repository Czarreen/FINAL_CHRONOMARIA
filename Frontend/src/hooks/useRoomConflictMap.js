import { useMemo } from 'react';
import { getScheduleTimeRange, timesOverlap } from '../utils/scheduleUtils';

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

function isBookingMerged(a, b) {
  const norm = (s) => String(s || '').trim().toUpperCase();

  if (a.id != null && b.id != null) {
    // Same curr+dept+course → intentional split-section merge
    if (a.curr_id && b.curr_id &&
        String(a.curr_id) === String(b.curr_id) &&
        String(a.department_id) === String(b.department_id) &&
        norm(a.course_no) !== '' &&
        norm(a.course_no) === norm(b.course_no)) return true;
    if (a.merged === true || b.merged === true) return true;
    const sameCourse = norm(a.course_no) !== '' && norm(a.course_no) === norm(b.course_no);
    const sameTitle = norm(a.descriptive_title) !== '' && norm(a.descriptive_title) === norm(b.descriptive_title);
    return sameCourse && sameTitle;
  }

  if (a.subject_id != null && b.subject_id != null) {
    const sameCourse = norm(a.subject_course_no) !== '' && norm(a.subject_course_no) === norm(b.subject_course_no);
    const sameTitle = norm(a.subject_descriptive_title) !== '' && norm(a.subject_descriptive_title) === norm(b.subject_descriptive_title);
    return sameCourse && sameTitle;
  }

  return false;
}

export function useConflictingIdSets(bookings) {
  return useMemo(() => {
    const offeringIds = new Set();
    const subjectIds = new Set();

    if (!Array.isArray(bookings) || !bookings.length) {
      return { conflictingOfferingIds: offeringIds, conflictingSubjectIds: subjectIds };
    }

    const groups = new Map();
    for (const b of bookings) {
      if (!b.room_id || !b.slot) continue;
      const key = `${String(b.room_id).trim()}:${b.slot}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    }

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          const schedA = a.slot === 'mth' ? a.mth_schedule : a.tfs_schedule;
          const schedB = b.slot === 'mth' ? b.mth_schedule : b.tfs_schedule;
          const rangeA = getScheduleTimeRange(schedA);
          const rangeB = getScheduleTimeRange(schedB);
          if (!rangeA || !rangeB) continue;
          if (!timesOverlap(rangeA.start, rangeA.end, rangeB.start, rangeB.end)) continue;
          if (isBookingMerged(a, b)) continue;
          if (a.id != null) offeringIds.add(Number(a.id));
          if (b.id != null) offeringIds.add(Number(b.id));
          if (a.subject_id != null) subjectIds.add(Number(a.subject_id));
          if (b.subject_id != null) subjectIds.add(Number(b.subject_id));
        }
      }
    }

    return { conflictingOfferingIds: offeringIds, conflictingSubjectIds: subjectIds };
  }, [bookings]);
}
