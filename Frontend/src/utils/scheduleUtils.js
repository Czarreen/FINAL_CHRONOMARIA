// Day abbreviations for single-day modes (pair mode emits no day prefix)
const SINGLE_DAY_ABBREV = { mon: 'M', thu: 'Th', tue: 'T', fri: 'F', sat: 'Sat' };

/**
 * Build a schedule string from structured card values.
 * Pair mode  → "HH:MM-HH:MM Lec/Lab"       (no day — the column is already the day indicator)
 * Single day → "HH:MM-HH:MM DAY Lec/Lab"   (day abbreviation after the time range)
 *
 * @param {string} slot - 'mth' | 'tfs'
 * @param {string} mode - 'pair' | 'mon' | 'thu' | 'tue' | 'fri' | 'sat'
 * @param {string} startH
 * @param {string} startM
 * @param {string} endH
 * @param {string} endM
 * @param {string} type - 'lec' | 'lab'
 * @returns {string}
 */
export function buildScheduleString(slot, mode, startH, startM, endH, endM, type) {
  if (!slot || !mode || !startH || !endH) return '';
  const start = `${String(startH).padStart(2, '0')}:${String(startM || '00').padStart(2, '0')}`;
  const end = `${String(endH).padStart(2, '0')}:${String(endM || '00').padStart(2, '0')}`;
  const typeSuffix = type === 'lab' ? 'Lab' : 'Lec';
  if (mode === 'pair') return `${start}-${end} ${typeSuffix}`;
  const day = SINGLE_DAY_ABBREV[mode] || '';
  return day ? `${start}-${end} ${day} ${typeSuffix}` : `${start}-${end} ${typeSuffix}`;
}

/**
 * Parse a schedule string into structured card state.
 *
 * Handles the actual DB format:
 *   "7:30-9:00"              → pair mode (slot must be supplied by caller)
 *   "1:00-3:00 M"            → mth/mon mode
 *   "1:30-4:30 Sat"          → tfs/sat mode
 *   "1:00-4:00 T Lab, F Lec" → tfs/tue mode, lab (first component only)
 *
 * Also handles the legacy format our tool previously produced:
 *   "MT 10:00-11:30 Lec"
 *
 * @param {string} str
 * @param {string|null} slot - 'mth' | 'tfs' | null  (caller supplies column context)
 * @returns {{ slot, mode, startH, startM, endH, endM, type } | null}
 */
export function parseScheduleString(str, slot = null) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed) return null;

  // Normalize AM/PM markers to 24-hour so both regex paths can handle them
  const normalized = trimmed.replace(/(\d{1,2}:\d{2})\s*(AM|PM)/gi, (_, time, meridiem) => {
    const [h, m] = time.split(':').map(Number);
    let hours = h;
    if (/pm/i.test(meridiem) && hours !== 12) hours += 12;
    if (/am/i.test(meridiem) && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  });

  // --- Primary format: HH:MM-HH:MM [optional suffix tokens] ---
  const timeMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})(.*)?$/);
  if (timeMatch) {
    const [, sh, sm, eh, em, rawRest = ''] = timeMatch;
    // For complex entries like "T Lab, F Lec", only the first component is used
    const first = rawRest.split(',')[0].trim();
    const tokens = first.split(/\s+/).filter(Boolean);

    const DAY_MAP = {
      M:   { slot: 'mth', mode: 'mon' },
      Th:  { slot: 'mth', mode: 'thu' },
      T:   { slot: 'tfs', mode: 'tue' },
      F:   { slot: 'tfs', mode: 'fri' },
      Sat: { slot: 'tfs', mode: 'sat' },
      S:   { slot: 'tfs', mode: 'sat' },
    };

    let resolvedSlot = slot;
    let mode = 'pair';
    let type = 'lec';

    for (const token of tokens) {
      if (/^lec$/i.test(token)) { type = 'lec'; continue; }
      if (/^lab$/i.test(token)) { type = 'lab'; continue; }
      // Exact match first, then title-case normalised
      const dm = DAY_MAP[token]
        || DAY_MAP[token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()];
      if (dm) { resolvedSlot = dm.slot; mode = dm.mode; }
    }

    if (!resolvedSlot) return null;
    // Hours 1–5 without an explicit AM/PM marker must be PM (no class starts at 1–5 AM)
    let startH24 = parseInt(sh, 10);
    let endH24   = parseInt(eh, 10);
    if (startH24 >= 1 && startH24 <= 5) startH24 += 12;
    if (endH24   >= 1 && endH24   <= 5) endH24   += 12;
    return {
      slot: resolvedSlot,
      mode,
      startH: String(startH24).padStart(2, '0'),
      startM: String(sm).padStart(2, '0'),
      endH: String(endH24).padStart(2, '0'),
      endM: String(em).padStart(2, '0'),
      type,
    };
  }

  // --- Legacy format: DAYS HH:MM-HH:MM [Type] ---
  const legacy = normalized.match(/^([A-Za-z]+)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})(?:\s+(Lec|Lab))?/i);
  if (legacy) {
    const [, rawDays, sh, sm, eh, em, rawType] = legacy;
    const LEGACY_MAP = {
      MT:   { slot: 'mth', mode: 'pair' },
      M:    { slot: 'mth', mode: 'mon'  },
      Th:   { slot: 'mth', mode: 'thu'  },
      TF:   { slot: 'tfs', mode: 'pair' },
      T:    { slot: 'tfs', mode: 'tue'  },
      F:    { slot: 'tfs', mode: 'fri'  },
      S:    { slot: 'tfs', mode: 'sat'  },
      Sat:  { slot: 'tfs', mode: 'sat'  },
      MWF:  { slot: 'mth', mode: 'pair' },
      MTH:  { slot: 'mth', mode: 'pair' },
      TTH:  { slot: 'tfs', mode: 'pair' },
      TTHS: { slot: 'tfs', mode: 'pair' },
      TTh:  { slot: 'tfs', mode: 'pair' },
      TFS:  { slot: 'tfs', mode: 'pair' },
      MW:   { slot: 'mth', mode: 'pair' },
    };
    const sm2 = LEGACY_MAP[rawDays] || LEGACY_MAP[rawDays.toUpperCase()];
    if (!sm2) return null;
    let startH24 = parseInt(sh, 10);
    let endH24   = parseInt(eh, 10);
    if (startH24 >= 1 && startH24 <= 5) startH24 += 12;
    if (endH24   >= 1 && endH24   <= 5) endH24   += 12;
    return {
      slot: sm2.slot,
      mode: sm2.mode,
      startH: String(startH24).padStart(2, '0'),
      startM: String(sm).padStart(2, '0'),
      endH: String(endH24).padStart(2, '0'),
      endM: String(em).padStart(2, '0'),
      type: rawType ? rawType.toLowerCase() : 'lec',
    };
  }

  return null;
}

/**
 * Convert a "HH:MM" string to minutes since midnight.
 * @param {string} timeStr
 * @returns {number | null}
 */
export function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const match = String(timeStr).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Detect whether two time ranges overlap.
 * All values are minutes since midnight. Ranges are [start, end).
 * @param {number} startA
 * @param {number} endA
 * @param {number} startB
 * @param {number} endB
 * @returns {boolean}
 */
export function timesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

/**
 * Derive AM/PM from a schedule string based on the start hour.
 * Not stored in DB — display only.
 * Handles both "4:30 PM-6:00 PM" (explicit meridiem) and "16:30-18:00" (24-hour).
 * For ambiguous 12-hour times without meridiem, hours 1–6 are treated as PM
 * because classes cannot start before 7:30 AM.
 * @param {string} scheduleStr
 * @returns {'AM'|'PM'|null}
 */
export function getScheduleAmPm(scheduleStr) {
  if (!scheduleStr) return null;
  const s = String(scheduleStr);
  // Check for explicit AM/PM marker attached to the start time (e.g. "7:30 AM-", "4:30 PM-")
  const meridiemMatch = s.match(/\d{1,2}:\d{2}\s*(AM|PM)\s*[-–]/i);
  if (meridiemMatch) return meridiemMatch[1].toUpperCase();
  // Fall back to hour-based heuristic
  const hourMatch = s.match(/(\d{1,2}):\d{2}\s*-/);
  if (!hourMatch) return null;
  const hour = Number(hourMatch[1]);
  // Hours >= 12 are always PM (24-hour or 12-hour noon+)
  if (hour >= 12) return 'PM';
  // Hours 1–5 must be PM — AM classes cannot start at 1–5 AM; hour 6 is early-morning AM
  if (hour >= 1 && hour <= 5) return 'PM';
  // Hours 7–11: AM
  return 'AM';
}

/**
 * Extract the start/end time (in minutes) from a schedule string.
 * Works with both "HH:MM-HH:MM ..." and "DAY HH:MM-HH:MM ..." formats.
 * @param {string} scheduleStr
 * @returns {{ start: number, end: number } | null}
 */
export function getScheduleTimeRange(scheduleStr) {
  if (!scheduleStr) return null;

  // Normalize "HH:MM AM/PM" → 24-hour so the range regex can always match
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
  // Hours 1–5 without a meridiem marker must be PM — no class starts at 1–5 AM
  if (startH >= 1 && startH <= 5) startH += 12;
  if (endH   >= 1 && endH   <= 5) endH   += 12;

  const start = startH * 60 + Number(match[2]);
  const end   = endH   * 60 + Number(match[4]);
  if (end <= start) return null;
  return { start, end };
}

/**
 * Extract and format just the time range from a schedule string for display.
 * Handles all DB formats: "MTH 7:30AM-10:30AM", "07:30-10:30 Lec", "7:30-9:00 M Lec", etc.
 * Returns "H:MM-H:MM" (e.g. "7:30-10:30") or null if no time range found.
 * @param {string} scheduleStr
 * @returns {string|null}
 */
export function formatScheduleTimeDisplay(scheduleStr) {
  if (!scheduleStr) return null;
  const match = String(scheduleStr).match(/(\d{1,2}:\d{2})\s*(?:AM|PM)?\s*[-–]\s*(\d{1,2}:\d{2})\s*(?:AM|PM)?/i);
  if (!match) return scheduleStr;
  const stripLeadingZero = (t) => t.replace(/^0(\d)/, '$1');
  return `${stripLeadingZero(match[1])}-${stripLeadingZero(match[2])}`;
}

/**
 * Default empty card state for a given slot.
 * @param {string} slot - 'mth' | 'tfs'
 * @returns {{ enabled, mode, startH, startM, endH, endM, type }}
 */
export function emptyCardState(slot) {
  return {
    enabled: false,
    mode: 'pair',
    startH: '07',
    startM: '30',
    endH: '10',
    endM: '00',
    type: 'lec',
  };
}
