// Day abbreviations for single-day modes (pair mode emits no day prefix)
const SINGLE_DAY_ABBREV = { mon: 'M', thu: 'Th', tue: 'T', fri: 'F', sat: 'Sat' };

// Full day names per slot for block labels in the UI
export const PAIR_DAY_NAMES = {
  mth: { block1: 'Monday', block2: 'Thursday' },
  tfs: { block1: 'Tuesday', block2: 'Friday' },
};

/**
 * Build a schedule string from structured card values.
 *
 * Single block (hasSec = false):
 *   Pair mode  → "HH:MM-HH:MM Lec/Lab"
 *   Single day → "HH:MM-HH:MM DAY Lec/Lab"
 *
 * Double block (hasSec = true):
 *   Pair mode, same time → "HH:MM-HH:MM Day1 Type1, Day2 Type2"
 *   Pair mode, diff time → "HH:MM-HH:MM Day1 Type1, HH:MM-HH:MM Day2 Type2"
 *   Single day, same type → "HH:MM-HH:MM, HH:MM-HH:MM Day Type"
 *   Single day, diff type → "HH:MM-HH:MM Day Type1, HH:MM-HH:MM Day Type2"
 */
export function buildScheduleString(
  slot, mode, startH, startM, endH, endM, type,
  hasSec = false, startH2, startM2, endH2, endM2, type2
) {
  if (!slot || !mode || !startH || !endH) return '';
  const pad = (v) => String(v || '00').padStart(2, '0');
  const start1 = `${pad(startH)}:${pad(startM)}`;
  const end1   = `${pad(endH)}:${pad(endM)}`;
  const suf1   = type === 'both' ? '' : (type === 'lab' ? 'Lab' : 'Lec');

  if (!hasSec) {
    if (mode === 'pair') {
      return suf1 ? `${start1}-${end1} ${suf1}` : `${start1}-${end1}`;
    }
    const day = SINGLE_DAY_ABBREV[mode] || '';
    return [start1 + '-' + end1, day, suf1].filter(Boolean).join(' ');
  }

  // Double block
  const start2 = `${pad(startH2)}:${pad(startM2)}`;
  const end2   = `${pad(endH2)}:${pad(endM2)}`;
  const suf2   = type2 === 'both' ? '' : (type2 === 'lab' ? 'Lab' : 'Lec');
  const time1  = `${start1}-${end1}`;
  const time2  = `${start2}-${end2}`;

  if (mode === 'pair') {
    const [day1, day2] = slot === 'mth' ? ['M', 'Th'] : ['T', 'F'];
    const block1 = [time1, day1, suf1].filter(Boolean).join(' ');
    const block2Parts = time1 === time2 ? [day2, suf2] : [time2, day2, suf2];
    const block2 = block2Parts.filter(Boolean).join(' ');
    return `${block1}, ${block2}`;
  }

  // Single day with two time blocks
  const day = SINGLE_DAY_ABBREV[mode] || '';
  const dayPart = day ? ` ${day}` : '';
  if (suf1 === suf2) {
    return [`${time1},`, time2, day, suf1].filter(Boolean).join(' ');
  }
  return [time1 + dayPart, suf1].filter(Boolean).join(' ') + ', ' + [time2 + dayPart, suf2].filter(Boolean).join(' ');
}

/**
 * Parse a schedule string into structured card state.
 *
 * Always returns the full shape including block-2 defaults so callers can
 * spread the result directly: `{ enabled: true, ...parsed }`.
 *
 * Handles:
 *   "7:30-9:00"                   → pair mode (slot must be supplied)
 *   "1:00-3:00 M"                 → mth/mon
 *   "1:30-4:30 Sat"               → tfs/sat
 *   "10:30-1:30 M Lab, Th Lec"    → pair, hasSec=true (same time, diff types)
 *   "10:30-1:30 M Lab, 14:00-16:00 Th Lec" → pair, hasSec=true (diff time)
 *   "1:00-4:00, 4:30-6:30 Th Lec" → single day, hasSec=true (two blocks)
 *   "9:00-12:00,1:00-3:00 Sat"   → sat, hasSec=true
 *   "1:00-4:00 F, 1:00-4:00 T Lec" → pair TFS (same time both days)
 *
 * @param {string} str
 * @param {string|null} slot
 * @returns {{ slot, mode, startH, startM, endH, endM, type, hasSec, startH2, startM2, endH2, endM2, type2 } | null}
 */
export function parseScheduleString(str, slot = null) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed) return null;

  const SEC_DEFAULTS = { hasSec: false, startH2: '13', startM2: '00', endH2: '16', endM2: '00', type2: 'lec' };

  const normMeridiem = (s) => s.replace(/(\d{1,2}:\d{2})\s*(AM|PM)/gi, (_, time, mer) => {
    const [h, m] = time.split(':').map(Number);
    let hours = h;
    if (/pm/i.test(mer) && hours !== 12) hours += 12;
    if (/am/i.test(mer) && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  });

  const normPm = (h) => {
    const n = parseInt(h, 10);
    if (n >= 1 && n <= 6) return n + 12;  // 6:00 = 6 PM — no 6 AM slots exist
    return n;
  };

  const padH = (n) => String(n).padStart(2, '0');

  const DAY_MAP = {
    M:       { slot: 'mth', mode: 'mon' },
    Th:      { slot: 'mth', mode: 'thu' },
    T:       { slot: 'tfs', mode: 'tue' },
    F:       { slot: 'tfs', mode: 'fri' },
    Sat:     { slot: 'tfs', mode: 'sat' },
    S:       { slot: 'tfs', mode: 'sat' },
    Saturday:{ slot: 'tfs', mode: 'sat' },
  };

  const normalized = normMeridiem(trimmed);

  // --- Primary format: first time range at start ---
  const timeRx = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})(.*)?$/s;
  const timeMatch = normalized.match(timeRx);

  if (timeMatch) {
    const [, sh, sm, eh, em, rawRest = ''] = timeMatch;
    const startH24 = normPm(sh);
    const endH24   = normPm(eh);

    // Split rawRest on the first comma to check for second block
    const commaIdx = rawRest.indexOf(',');
    let firstPart = rawRest;
    let secondPart = '';
    if (commaIdx !== -1) {
      firstPart  = rawRest.slice(0, commaIdx);
      secondPart = rawRest.slice(commaIdx + 1).trim();
    }

    // Parse tokens from firstPart (day, type)
    const parseTokens = (part) => {
      const tokens = part.trim().split(/\s+/).filter(Boolean);
      let resolvedSlot = slot;
      let mode = 'pair';
      let type = 'both';
      for (const token of tokens) {
        if (/^lec$/i.test(token)) { type = 'lec'; continue; }
        if (/^lab$/i.test(token)) { type = 'lab'; continue; }
        const dm = DAY_MAP[token] || DAY_MAP[token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()];
        if (dm) { resolvedSlot = dm.slot; mode = dm.mode; }
      }
      return { resolvedSlot, mode, type };
    };

    const { resolvedSlot, mode, type } = parseTokens(firstPart);
    if (!resolvedSlot) return null;

    // Check if secondPart contains another time range → two-block single-day schedule
    const secTimeRx = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})(.*)?$/s;
    const secTimeMatch = secondPart.match(secTimeRx);

    if (secTimeMatch) {
      // Two distinct time ranges
      const [, sh2, sm2, eh2, em2, rest2 = ''] = secTimeMatch;
      const startH2_24 = normPm(sh2);
      const endH2_24   = normPm(eh2);
      // Pick day/type from rest2 or fall back to firstPart's info
      const { mode: mode2, type: type2 } = parseTokens(rest2 || firstPart);
      // Resolve final mode: if mode2 gives a more specific day use it
      const finalMode = mode2 !== 'pair' ? mode2 : mode;
      return {
        slot: resolvedSlot, mode: finalMode,
        startH: padH(startH24), startM: String(sm).padStart(2, '0'),
        endH:   padH(endH24),   endM:   String(em).padStart(2, '0'),
        type,
        hasSec: true,
        startH2: padH(startH2_24), startM2: String(sm2).padStart(2, '0'),
        endH2:   padH(endH2_24),   endM2:   String(em2).padStart(2, '0'),
        type2,
      };
    }

    if (secondPart) {
      // secondPart has no time range — could be "Th Lec" (pair diff-type) or "1:00-4:00 T Lec" (pair same-time already handled above)
      const secTokens = secondPart.trim().split(/\s+/).filter(Boolean);
      let secType = 'both';
      let secDaySlot = resolvedSlot;
      let secMode = mode;
      for (const token of secTokens) {
        if (/^lec$/i.test(token)) { secType = 'lec'; continue; }
        if (/^lab$/i.test(token)) { secType = 'lab'; continue; }
        const dm = DAY_MAP[token] || DAY_MAP[token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()];
        if (dm) { secDaySlot = dm.slot; secMode = dm.mode; }
      }

      // Determine if both days together form a pair (M+Th or T+F)
      const isPairMth = (mode === 'mon' && secMode === 'thu') || (mode === 'thu' && secMode === 'mon');
      const isPairTfs = (mode === 'tue' && secMode === 'fri') || (mode === 'fri' && secMode === 'tue');
      const formsPair = isPairMth || isPairTfs;

      if (formsPair) {
        // Block1 = day1, Block2 = day2 (same time)
        const finalSlot = isPairMth ? 'mth' : 'tfs';
        const block1Mode = isPairMth
          ? (mode === 'mon' ? 'mon' : 'thu')
          : (mode === 'tue' ? 'tue' : 'fri');
        const block2Mode = isPairMth
          ? (block1Mode === 'mon' ? 'thu' : 'mon')
          : (block1Mode === 'tue' ? 'fri' : 'tue');

        // Determine if user wrote "M Lab, Th Lec" → hasSec=true with pair mode
        // but since block1 and block2 are the two days, use pair mode for the card
        return {
          slot: finalSlot, mode: 'pair',
          startH: padH(startH24), startM: String(sm).padStart(2, '0'),
          endH:   padH(endH24),   endM:   String(em).padStart(2, '0'),
          type,
          hasSec: secType !== type, // only hasSec if types differ; otherwise it's a plain pair
          startH2: padH(startH24), startM2: String(sm).padStart(2, '0'),
          endH2:   padH(endH24),   endM2:   String(em).padStart(2, '0'),
          type2: secType,
        };
      }

      // Not a standard pair — treat as pair mode with different types anyway
      return {
        slot: resolvedSlot, mode: 'pair',
        startH: padH(startH24), startM: String(sm).padStart(2, '0'),
        endH:   padH(endH24),   endM:   String(em).padStart(2, '0'),
        type,
        hasSec: true,
        startH2: padH(startH24), startM2: String(sm).padStart(2, '0'),
        endH2:   padH(endH24),   endM2:   String(em).padStart(2, '0'),
        type2: secType,
      };
    }

    // Single block
    return {
      slot: resolvedSlot, mode,
      startH: padH(startH24), startM: String(sm).padStart(2, '0'),
      endH:   padH(endH24),   endM:   String(em).padStart(2, '0'),
      type,
      ...SEC_DEFAULTS,
    };
  }

  // --- Legacy format: DAYS HH:MM-HH:MM [Type] ---
  const legacy = normalized.match(/^([A-Za-z]+)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})(?:\s+(Lec|Lab))?/i);
  if (legacy) {
    const [, rawDays, sh, sm, eh, em, rawType] = legacy;
    const LEGACY_MAP = {
      MT: { slot: 'mth', mode: 'pair' }, M: { slot: 'mth', mode: 'mon' }, Th: { slot: 'mth', mode: 'thu' },
      TF: { slot: 'tfs', mode: 'pair' }, T: { slot: 'tfs', mode: 'tue' }, F: { slot: 'tfs', mode: 'fri' },
      S: { slot: 'tfs', mode: 'sat' }, Sat: { slot: 'tfs', mode: 'sat' },
      MWF: { slot: 'mth', mode: 'pair' }, MTH: { slot: 'mth', mode: 'pair' },
      TTH: { slot: 'tfs', mode: 'pair' }, TTHS: { slot: 'tfs', mode: 'pair' },
      TTh: { slot: 'tfs', mode: 'pair' }, TFS: { slot: 'tfs', mode: 'pair' }, MW: { slot: 'mth', mode: 'pair' },
    };
    const sm2 = LEGACY_MAP[rawDays] || LEGACY_MAP[rawDays.toUpperCase()];
    if (!sm2) return null;
    const startH24 = normPm(sh);
    const endH24   = normPm(eh);
    return {
      slot: sm2.slot, mode: sm2.mode,
      startH: padH(startH24), startM: String(sm).padStart(2, '0'),
      endH:   padH(endH24),   endM:   String(em).padStart(2, '0'),
      type: rawType ? rawType.toLowerCase() : 'both',
      ...SEC_DEFAULTS,
    };
  }

  return null;
}

/**
 * Convert "HH:MM" to minutes since midnight.
 */
export function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const match = String(timeStr).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Detect whether two time ranges overlap. Ranges are [start, end).
 */
export function timesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

/**
 * Derive AM/PM from a schedule string based on the start hour of the first block.
 * Returns null for complex (multi-block) strings — use isSimpleSchedule() to guard.
 */
export function getScheduleAmPm(scheduleStr) {
  if (!scheduleStr) return null;
  const s = String(scheduleStr);
  const meridiemMatch = s.match(/\d{1,2}:\d{2}\s*(AM|PM)\s*[-–]/i);
  if (meridiemMatch) return meridiemMatch[1].toUpperCase();
  const hourMatch = s.match(/(\d{1,2}):\d{2}\s*-/);
  if (!hourMatch) return null;
  const hour = Number(hourMatch[1]);
  if (hour >= 12) return 'PM';
  if (hour >= 1 && hour <= 6) return 'PM';  // 6:00 = 6 PM — no 6 AM slots exist
  return 'AM';
}

/**
 * Returns true when the schedule string is a single block (no comma).
 * Used to decide whether to show the AM/PM badge.
 */
export function isSimpleSchedule(scheduleStr) {
  if (!scheduleStr) return true;
  return !String(scheduleStr).includes(',');
}

/**
 * Extract the start/end time (in minutes) from a schedule string (first block only).
 */
export function getScheduleTimeRange(scheduleStr) {
  if (!scheduleStr) return null;
  const normalized = String(scheduleStr).replace(
    /(\d{1,2}:\d{2})\s*(AM|PM)/gi,
    (_, time, meridiem) => {
      const [h, m] = time.split(':').map(Number);
      let hours = h;
      if (/pm/i.test(meridiem) && hours !== 12) hours += 12;
      if (/am/i.test(meridiem) && hours === 12) hours = 0;
      return `${String(hours).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  );
  const match = normalized.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  let startH = Number(match[1]);
  let endH   = Number(match[3]);
  if (startH >= 1 && startH <= 6) startH += 12;  // 6:00 = 6 PM — no 6 AM slots exist
  if (endH   >= 1 && endH   <= 6) endH   += 12;
  const start = startH * 60 + Number(match[2]);
  const end   = endH   * 60 + Number(match[4]);
  if (end <= start) return null;
  return { start, end };
}

/**
 * Format a single time range block for display.
 * Strips leading zeros: "07:30-10:00" → "7:30-10:00".
 */
function formatSingleBlock(str) {
  if (!str) return str;
  const match = String(str).match(/(\d{1,2}:\d{2})\s*(?:AM|PM)?\s*[-–]\s*(\d{1,2}:\d{2})\s*(?:AM|PM)?(.*)/is);
  if (!match) return str.trim();
  const stripZero = (t) => t.replace(/^0(\d)/, '$1');
  const timeRange = `${stripZero(match[1])}-${stripZero(match[2])}`;
  const suffix = (match[3] || '').trim();
  return suffix ? `${timeRange} ${suffix}` : timeRange;
}

/**
 * Format a full schedule string for table display.
 * Handles multi-block strings by splitting on commas and joining with " | ".
 * For single-block strings the output matches the previous formatScheduleTimeDisplay.
 */
export function formatScheduleDisplay(scheduleStr) {
  if (!scheduleStr) return null;
  const s = String(scheduleStr);
  // Split on commas that separate blocks (not within a time range like "12:00-1:00")
  // Strategy: split on comma, recombine parts that look like they were inside a range
  const rawParts = s.split(',');
  const blocks = [];
  let carry = '';
  for (const part of rawParts) {
    const combined = carry ? `${carry},${part}` : part;
    // A part that starts with a digit right after the comma is a new time block
    const trimmed = part.trim();
    if (carry && /^\d/.test(trimmed)) {
      // New block: flush carry as its own block
      blocks.push(carry.trim());
      carry = part;
    } else if (!carry) {
      carry = part;
    } else {
      // Continuation of carry (e.g. day/type suffix after comma that has no time)
      blocks.push(combined.trim());
      carry = '';
    }
  }
  if (carry) blocks.push(carry.trim());

  if (blocks.length <= 1) return formatSingleBlock(s);
  return blocks.map(formatSingleBlock).join(' | ');
}

/**
 * @deprecated Use formatScheduleDisplay instead. Kept for backward compatibility.
 */
export function formatScheduleTimeDisplay(scheduleStr) {
  return formatScheduleDisplay(scheduleStr);
}

/**
 * Default empty card state for a given slot.
 * Includes block-2 fields (hasSec = false by default).
 */
export function emptyCardState(slot) {
  return {
    enabled: false,
    mode: 'pair',
    startH: '07', startM: '30', endH: '10', endM: '00', type: 'lec',
    hasSec: false,
    startH2: '13', startM2: '00', endH2: '16', endM2: '00', type2: 'lec',
  };
}
