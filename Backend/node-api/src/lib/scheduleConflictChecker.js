const DAY_ALIASES = new Map([
  ['M', 'MON'],
  ['MON', 'MON'],
  ['MONDAY', 'MON'],
  ['T', 'TUE'],
  ['TU', 'TUE'],
  ['TUE', 'TUE'],
  ['TUES', 'TUE'],
  ['TUESDAY', 'TUE'],
  ['W', 'WED'],
  ['WED', 'WED'],
  ['WEDNESDAY', 'WED'],
  ['TH', 'THU'],
  ['THU', 'THU'],
  ['THUR', 'THU'],
  ['THURS', 'THU'],
  ['THURSDAY', 'THU'],
  ['F', 'FRI'],
  ['FRI', 'FRI'],
  ['FRIDAY', 'FRI'],
  ['SAT', 'SAT'],
  ['SATURDAY', 'SAT'],
  ['S', 'SAT'],
]);

function normalizeUpper(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function parseScheduleString(scheduleText) {
  if (!scheduleText || scheduleText.trim() === '') {
    return null;
  }

  const text = normalizeUpper(scheduleText);
  const compact = text.replace(/[^A-Z:0-9]/g, ' ').trim();
  const parts = compact.split(/\s+/);

  const days = new Set();
  let timeRange = null;

  for (const part of parts) {
    if (part === 'MTH') {
      days.add('MON');
      days.add('THU');
      continue;
    }
    if (part === 'TFS') {
      days.add('TUE');
      days.add('FRI');
      days.add('SAT');
      continue;
    }

    if (DAY_ALIASES.has(part)) {
      days.add(DAY_ALIASES.get(part));
      continue;
    }

    if (part.match(/^\d{1,2}:\d{2}$/)) {
      if (!timeRange) {
        timeRange = { startTime: part };
      } else if (!timeRange.endTime) {
        timeRange.endTime = part;
      }
      continue;
    }
  }

  if (days.size === 0) {
    return null;
  }

  return {
    days: Array.from(days).sort(),
    startTime: timeRange?.startTime || null,
    endTime: timeRange?.endTime || null,
  };
}

export function timeToMinutes(timeStr) {
  if (!timeStr || !timeStr.includes(':')) {
    return null;
  }
  const [hours, minutes] = timeStr.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}

export function timeRangesOverlap(time1Start, time1End, time2Start, time2End) {
  const t1Start = timeToMinutes(time1Start);
  const t1End = timeToMinutes(time1End);
  const t2Start = timeToMinutes(time2Start);
  const t2End = timeToMinutes(time2End);

  if (t1Start === null || t1End === null || t2Start === null || t2End === null) {
    return false;
  }

  return t1Start < t2End && t2Start < t1End;
}

export function schedulesConflict(schedule1, schedule2) {
  if (!schedule1 || !schedule2) {
    return { conflicts: false, conflictingDays: [] };
  }

  if (!schedule1.startTime || !schedule1.endTime || !schedule2.startTime || !schedule2.endTime) {
    return { conflicts: false, conflictingDays: [] };
  }

  if (!timeRangesOverlap(schedule1.startTime, schedule1.endTime, schedule2.startTime, schedule2.endTime)) {
    return { conflicts: false, conflictingDays: [] };
  }

  const conflictingDays = schedule1.days.filter(day => schedule2.days.includes(day));

  return {
    conflicts: conflictingDays.length > 0,
    conflictingDays: conflictingDays,
  };
}

export function findConflictingSchedules(entity, allEntities, isEntityGym) {
  if (isEntityGym) {
    return [];
  }

  const conflictingEntities = [];

  const mthSchedule = parseScheduleString(entity.mth_schedule);
  const tfsSchedule = parseScheduleString(entity.tfs_schedule);
  const mthRoom = entity.mth_room_id || entity.mth_room;
  const tfsRoom = entity.tfs_room_id || entity.tfs_room;

  for (const other of allEntities) {
    if (other.id === entity.id || other.subject_id === entity.subject_id) {
      continue;
    }

    const isOtherGym = isRoomGym(other.mth_room_id || other.mth_room) || isRoomGym(other.tfs_room_id || other.tfs_room);
    if (isOtherGym) {
      continue;
    }

    if (mthRoom && mthRoom === (other.mth_room_id || other.mth_room)) {
      const otherMthSchedule = parseScheduleString(other.mth_schedule);
      const conflict = schedulesConflict(mthSchedule, otherMthSchedule);
      if (conflict.conflicts) {
        conflictingEntities.push({
          entityId: other.id || other.subject_id,
          entityCode: other.code || other.subject_code,
          schedule: 'MTH',
          conflictingDays: conflict.conflictingDays,
          room: mthRoom,
        });
      }
    }

    if (tfsRoom && tfsRoom === (other.tfs_room_id || other.tfs_room)) {
      const otherTfsSchedule = parseScheduleString(other.tfs_schedule);
      const conflict = schedulesConflict(tfsSchedule, otherTfsSchedule);
      if (conflict.conflicts) {
        conflictingEntities.push({
          entityId: other.id || other.subject_id,
          entityCode: other.code || other.subject_code,
          schedule: 'TFS',
          conflictingDays: conflict.conflictingDays,
          room: tfsRoom,
        });
      }
    }
  }

  return conflictingEntities;
}

export function isRoomGym(roomName) {
  if (!roomName) return false;
  return normalizeUpper(roomName).includes('GYM');
}
