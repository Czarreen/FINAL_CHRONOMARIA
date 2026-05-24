// Day aliases — Wednesday intentionally excluded (not a scheduling day).
const DAY_ALIASES = new Map([
  ['M',        'MON'],
  ['MON',      'MON'],
  ['MONDAY',   'MON'],
  ['T',        'TUE'],
  ['TU',       'TUE'],
  ['TUE',      'TUE'],
  ['TUES',     'TUE'],
  ['TUESDAY',  'TUE'],
  ['TH',       'THU'],
  ['THU',      'THU'],
  ['THUR',     'THU'],
  ['THURS',    'THU'],
  ['THURSDAY', 'THU'],
  ['F',        'FRI'],
  ['FRI',      'FRI'],
  ['FRIDAY',   'FRI'],
  ['SAT',      'SAT'],
  ['SATURDAY', 'SAT'],
  ['S',        'SAT'],
]);

// Sorted canonical day order (used to keep outputs deterministic).
const DAY_ORDER = ['MON', 'TUE', 'THU', 'FRI', 'SAT'];

// Saturday conflict window: only SAT schedule overlaps within 2:00–4:30 PM generate conflicts.
// 2:00 PM = 840 min, 4:30 PM = 990 min. Covers both defined Saturday slots (2:00–3:30, 3:00–4:30).
const SAT_CONFLICT_WINDOW_START = 14 * 60;      // 840
const SAT_CONFLICT_WINDOW_END   = 16 * 60 + 30; // 990

function normalizeUpper(value) {
  return String(value ?? '').trim().toUpperCase();
}

// Convert "4:30 PM" → "16:30", "12:30 AM" → "00:30". Leaves 24-hour strings unchanged.
function normalizeAmPm(str) {
  return String(str ?? '').replace(/(\d{1,2}):(\d{2})\s*(AM|PM)/gi, (_, h, m, meridiem) => {
    let hours = Number(h);
    if (/pm/i.test(meridiem) && hours !== 12) hours += 12;
    if (/am/i.test(meridiem) && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${m}`;
  });
}

// Convert "HH:MM" to minutes since midnight, applying the 1–5 PM heuristic
// (hours 1–5 without an explicit meridiem must be PM — no class starts at 1–5 AM).
export function timeToMinutes(timeStr) {
  if (!timeStr || !timeStr.includes(':')) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  let hours = h;
  if (hours >= 1 && hours <= 5) hours += 12;
  return hours * 60 + m;
}

// Parse a single schedule block string (no commas) into { days, startMin, endMin }.
// scheduleType ('mth'|'tfs') is used as fallback when no day token is found.
function parseTimeBlock(blockStr, scheduleType) {
  const withAmPm = normalizeAmPm(blockStr);
  // Strip everything except letters, digits, colons, spaces
  const compact = withAmPm.toUpperCase().replace(/[^A-Z:0-9]/g, ' ').trim();
  const parts = compact.split(/\s+/);

  const days = new Set();
  let startMin = null;
  let endMin = null;

  for (const part of parts) {
    if (part === 'MTH') { days.add('MON'); days.add('THU'); continue; }
    if (part === 'TFS') { days.add('TUE'); days.add('FRI'); days.add('SAT'); continue; }
    if (DAY_ALIASES.has(part)) { days.add(DAY_ALIASES.get(part)); continue; }

    if (/^\d{1,2}:\d{2}$/.test(part)) {
      const mins = timeToMinutes(part);
      if (startMin === null) { startMin = mins; }
      else if (endMin === null) { endMin = mins; }
      continue;
    }
  }

  if (days.size === 0) {
    if (scheduleType === 'mth') { days.add('MON'); days.add('THU'); }
    else if (scheduleType === 'tfs') { days.add('TUE'); days.add('FRI'); }
  }

  if (days.size === 0 || startMin === null || endMin === null) return null;
  return {
    days: [...days].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)),
    startMin,
    endMin,
  };
}

// Split room text on "/" and return non-empty trimmed tokens.
function parseRoomsFromText(roomText) {
  if (!roomText) return [];
  return String(roomText).split('/').map((r) => r.trim()).filter(Boolean);
}

// Detect Variant B: "HH:MM-HH:MM DAY Lec/HH:MM-HH:MM DAY Lab" aligned-pair format.
// Both halves separated by "/" must independently look like schedule strings.
// Returns [halfA, halfB] if detected, null otherwise.
function detectVariantB(blockStr) {
  const slashIdx = blockStr.indexOf('/');
  if (slashIdx === -1) return null;
  const halfA = blockStr.slice(0, slashIdx).trim();
  const halfB = blockStr.slice(slashIdx + 1).trim();
  // Both halves must contain a time range pattern (HH:MM-HH:MM or HH:MM–HH:MM)
  const timePattern = /\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/;
  if (timePattern.test(halfA) && timePattern.test(halfB)) return [halfA, halfB];
  return null;
}

// Expand a single schedule entry (text + room string) into atomic records.
// Returns Array<{ day, startMin, endMin, room }>.
// scheduleType ('mth'|'tfs') provides day-pair fallback when no day is in the text.
function toAtomicRecords(scheduleText, roomText, scheduleType) {
  if (!scheduleText) return [];

  const rooms = parseRoomsFromText(roomText);
  const records = [];

  // Split on "," to handle multiple time blocks in a single column value.
  const rawBlocks = String(scheduleText).split(',');

  for (const rawBlock of rawBlocks) {
    const block = rawBlock.trim();
    if (!block) continue;

    // Check for Variant B: two schedule halves zipped with two rooms.
    const variantB = detectVariantB(block);
    if (variantB) {
      const [halfA, halfB] = variantB;
      const parsedA = parseTimeBlock(halfA, scheduleType);
      const parsedB = parseTimeBlock(halfB, scheduleType);
      // Zip days and rooms by index (not cartesian product).
      // halfA days → rooms[0], halfB days → rooms[1] (if rooms list is provided separately).
      // When rooms are embedded in the schedule halves they will appear as single-element.
      // Fall back to cartesian if room count doesn't match segment count.
      const roomsA = rooms.length >= 1 ? [rooms[0]] : [];
      const roomsB = rooms.length >= 2 ? [rooms[1]] : (rooms.length === 1 ? [rooms[0]] : []);
      if (parsedA) {
        const effectiveRoomsA = roomsA.length > 0 ? roomsA : [''];
        for (const day of parsedA.days) {
          for (const room of effectiveRoomsA) {
            records.push({ day, startMin: parsedA.startMin, endMin: parsedA.endMin, room });
          }
        }
      }
      if (parsedB) {
        const effectiveRoomsB = roomsB.length > 0 ? roomsB : [''];
        for (const day of parsedB.days) {
          for (const room of effectiveRoomsB) {
            records.push({ day, startMin: parsedB.startMin, endMin: parsedB.endMin, room });
          }
        }
      }
      continue;
    }

    // Variant A (default): cartesian product of days × rooms.
    const parsed = parseTimeBlock(block, scheduleType);
    if (!parsed) continue;
    const effectiveRooms = rooms.length > 0 ? rooms : [''];
    for (const day of parsed.days) {
      for (const room of effectiveRooms) {
        records.push({ day, startMin: parsed.startMin, endMin: parsed.endMin, room });
      }
    }
  }

  // Deduplicate identical records.
  const seen = new Set();
  return records.filter(({ day, startMin, endMin, room }) => {
    const key = `${day}|${startMin}|${endMin}|${room}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Expand an entity's mth and tfs slots into a flat list of atomic records,
// filtering out any records whose room is a gym room.
function expandEntityToRecords(entity, gymRoomIds) {
  const mthRecords = toAtomicRecords(
    entity.mth_schedule,
    entity.mth_room_id ?? entity.mth_room,
    'mth'
  );
  const tfsRecords = toAtomicRecords(
    entity.tfs_schedule,
    entity.tfs_room_id ?? entity.tfs_room,
    'tfs'
  );
  return [...mthRecords, ...tfsRecords].filter(
    ({ room }) => room && !isGymRoomValue(room, gymRoomIds)
  );
}

export function isRoomGym(roomName) {
  if (!roomName) return false;
  return normalizeUpper(roomName).includes('GYM');
}

function isGymRoomValue(roomValue, gymRoomIds) {
  if (gymRoomIds && gymRoomIds.size > 0) {
    const tokens = String(roomValue).split('/').map((r) => r.trim());
    if (tokens.some((id) => gymRoomIds.has(id))) return true;
  }
  return isRoomGym(roomValue);
}

function isMergedSubject(entity, other) {
  const norm = (s) => String(s || '').trim().toUpperCase();
  const mthA = norm(entity.mth_schedule);
  const mthB = norm(other.mth_schedule);
  const tfsA = norm(entity.tfs_schedule);
  const tfsB = norm(other.tfs_schedule);
  if (!mthA && !tfsA) return false;
  if (mthA !== mthB || tfsA !== tfsB) return false;

  const mthRoomEntity = entity.mth_room_id ?? entity.mth_room;
  const mthRoomOther  = other.mth_room_id  ?? other.mth_room;
  const tfsRoomEntity = entity.tfs_room_id ?? entity.tfs_room;
  const tfsRoomOther  = other.tfs_room_id  ?? other.tfs_room;

  const sharesRoom = (r1, r2) => {
    if (!r1 || !r2) return false;
    const s1 = new Set(String(r1).split('/').map((r) => r.trim()));
    const s2 = new Set(String(r2).split('/').map((r) => r.trim()));
    for (const id of s1) { if (s2.has(id)) return true; }
    return false;
  };

  if (mthRoomEntity && !sharesRoom(mthRoomEntity, mthRoomOther)) return false;
  if (tfsRoomEntity && !sharesRoom(tfsRoomEntity, tfsRoomOther)) return false;

  // Same schedule + shared room is only a non-conflict if explicitly flagged merged
  // OR if they share the same course_no AND same descriptive_title (mirrors Python
  // merge_detector.py: title match is a required gating signal for any merge verdict).
  // Two different courses in the same room at the same time is always a conflict.
  const courseNo = entity.course_no || entity.subject_course_no;
  const otherCourseNo = other.course_no || other.subject_course_no;
  const title = entity.descriptive_title || entity.subject_descriptive_title;
  const otherTitle = other.descriptive_title || other.subject_descriptive_title;

  const sameCourse = courseNo && otherCourseNo &&
    normalizeUpper(courseNo) === normalizeUpper(otherCourseNo);
  const sameTitle = title && otherTitle &&
    normalizeUpper(title) === normalizeUpper(otherTitle);
  const explicitlyMerged = entity.merged === true || other.merged === true;
  return explicitlyMerged || (sameCourse && sameTitle);
}

function isSameCourseSection(entity, other) {
  if (!entity.curr_id || !entity.department_id) return false;
  const courseNo = entity.course_no || entity.subject_course_no;
  const otherCourseNo = other.course_no || other.subject_course_no;
  if (!courseNo) return false;
  return (
    String(entity.curr_id) === String(other.curr_id) &&
    String(entity.department_id) === String(other.department_id) &&
    String(courseNo).trim().toUpperCase() === String(otherCourseNo || '').trim().toUpperCase()
  );
}

export function findConflictingSchedules(entity, allEntities, isEntityGym, gymRoomIds = new Set()) {
  if (isEntityGym) return [];

  const entityRecords = expandEntityToRecords(entity, gymRoomIds);
  if (entityRecords.length === 0) return [];

  const conflictingEntities = [];

  for (const other of allEntities) {
    if (entity.id !== undefined) {
      if (other.id === entity.id) continue;
    } else if (entity.subject_id !== undefined) {
      if (other.subject_id === entity.subject_id) continue;
    }

    if (isMergedSubject(entity, other) || isSameCourseSection(entity, other)) continue;

    const otherRecords = expandEntityToRecords(other, gymRoomIds);
    if (otherRecords.length === 0) continue;

    const conflictingDaysSet = new Set();
    let conflictRoom = null;

    for (const eRec of entityRecords) {
      for (const oRec of otherRecords) {
        if (
          eRec.day === oRec.day &&
          eRec.room === oRec.room &&
          eRec.room !== '' &&
          eRec.startMin < oRec.endMin &&
          oRec.startMin < eRec.endMin
        ) {
          // SAT conflicts are only valid when the overlapping period starts within
          // the defined Saturday window (2:00–4:30 PM). A bare TFS schedule without
          // day prefix defaults to TUE+FRI only, so SAT is isolated to explicit S/Sat entries.
          if (eRec.day === 'SAT') {
            const overlapStart = Math.max(eRec.startMin, oRec.startMin);
            const overlapEnd   = Math.min(eRec.endMin,   oRec.endMin);
            if (overlapStart < SAT_CONFLICT_WINDOW_START || overlapEnd > SAT_CONFLICT_WINDOW_END) continue;
          }
          conflictingDaysSet.add(eRec.day);
          conflictRoom = eRec.room;
        }
      }
    }

    if (conflictingDaysSet.size > 0) {
      const conflictingDays = [...conflictingDaysSet].sort(
        (a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)
      );
      // Determine which slot (MTH or TFS) the conflict falls in for the message.
      const firstConflictDay = conflictingDays[0];
      const schedule = ['MON', 'THU'].includes(firstConflictDay) ? 'MTH' : 'TFS';

      conflictingEntities.push({
        entityId: other.id ?? other.subject_id,
        entityCode: other.code ?? other.subject_code,
        schedule,
        conflictingDays,
        room: conflictRoom,
      });
    }
  }

  return conflictingEntities;
}

// --- Legacy-compatible exports (keep existing callers working) ---

// Kept for any callers that use the old string-based parse.
// Returns a simplified object; use toAtomicRecords for full atomic expansion.
export function parseScheduleString(scheduleText, scheduleType = null) {
  if (!scheduleText || String(scheduleText).trim() === '') return null;
  const records = toAtomicRecords(scheduleText, '', scheduleType);
  if (records.length === 0) return null;
  const days = [...new Set(records.map((r) => r.day))].sort(
    (a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)
  );
  const startMins = Math.min(...records.map((r) => r.startMin));
  const endMins   = Math.max(...records.map((r) => r.endMin));
  const pad = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  return { days, startTime: pad(startMins), endTime: pad(endMins) };
}

export function timeRangesOverlap(time1Start, time1End, time2Start, time2End) {
  const t1s = timeToMinutes(time1Start);
  const t1e = timeToMinutes(time1End);
  const t2s = timeToMinutes(time2Start);
  const t2e = timeToMinutes(time2End);
  if (t1s === null || t1e === null || t2s === null || t2e === null) return false;
  return t1s < t2e && t2s < t1e;
}

export function schedulesConflict(schedule1, schedule2) {
  if (!schedule1 || !schedule2) return { conflicts: false, conflictingDays: [] };
  if (!schedule1.startTime || !schedule1.endTime || !schedule2.startTime || !schedule2.endTime) {
    return { conflicts: false, conflictingDays: [] };
  }
  if (!timeRangesOverlap(schedule1.startTime, schedule1.endTime, schedule2.startTime, schedule2.endTime)) {
    return { conflicts: false, conflictingDays: [] };
  }
  const conflictingDays = (schedule1.days || []).filter((d) => (schedule2.days || []).includes(d));
  return { conflicts: conflictingDays.length > 0, conflictingDays };
}
