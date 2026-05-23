import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  Bolt,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  DoorOpen,
  Play,
  RefreshCcw,
  Search,
  Settings,
  X,
} from 'lucide-react';
import {
  fetchAutomaticSchedulerPreFlight,
  runAutomaticScheduler,
  fetchAutomaticSchedulerRows,
  exportAutomaticSchedulerRows,
  updateCourseOfferingFromScheduler,
} from '../services/gaApi.js';
import { getScheduleAmPm, formatScheduleDisplay, isSimpleSchedule } from '../utils/scheduleUtils.js';

const LAST_SCHEDULER_RUN_KEY = 'automaticSchedulerLastRun';
const COURSE_OFFERING_UPDATE_MODES = {
  BACKUP_THEN_UPDATE: 'BACKUP_THEN_UPDATE',
  UPDATE_NO_BACKUP: 'UPDATE_NO_BACKUP',
};
const TABLE_PAGE_SIZE = 50;

const DRY_RUN_PHRASES = [
  'Peeking at possibilities…',
  'Ghost-scheduling your classes…',
  'Trying on schedules for size…',
  'Running a dress rehearsal…',
  'Whispering to the algorithm…',
  'No subjects were harmed in this preview…',
  'Simulating the simulation…',
  'Sneak-peeking the timetable…',
  'Asking the GA nicely for a sneak peek…',
  'Almost real, but not quite yet…',
];

const REAL_RUN_PHRASES = [
  'Teaching rooms to share nicely…',
  'Negotiating with stubborn time slots…',
  'Untangling the schedule spaghetti…',
  'Playing Tetris with your timetable…',
  'Convincing 7:30 AM classes they are necessary…',
  'Evolving the perfect timetable, one generation at a time…',
  'Herding subjects into time slots…',
  'Solving the hardest puzzle in academia…',
  'Arguing with overlapping lectures…',
  'Making everyone fit without stepping on toes…',
  'Asking rooms politely to stop double-booking…',
  'Finding the cosmic alignment of all sections…',
  'Making Monday bearable, one slot at a time…',
  'Running 1,000 possible schedules through their paces…',
  'Bribing the algorithm with better fitness scores…',
  'Almost there — the GA is on its last lap…',
];

const ALL_COLUMNS = [
  { key: 'code', label: 'Code' },
  { key: 'course_no', label: 'Course No.' },
  { key: 'section', label: 'Section' },
  { key: 'dept_name', label: 'Department' },
  { key: 'title', label: 'Title' },
  { key: 'lec_hrs', label: 'Lec Hrs' },
  { key: 'lab_hrs', label: 'Lab Hrs' },
  { key: 'mth_schedule', label: 'MTH Schedule' },
  { key: 'mth_room', label: 'MTH Room' },
  { key: 'tfs_schedule', label: 'TF Schedule' },
  { key: 'tfs_room', label: 'TF Room' },
  { key: 'status', label: 'Status' },
];

function fitnessToQuality(score) {
  if (score >= 95) return 'Excellent';
  if (score >= 80) return 'Good';
  if (score >= 60) return 'Fair';
  if (score >= 40) return 'Poor';
  return 'Very Poor';
}

function formatDateTimeStandard(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function buildCsvFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const headers = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    Object.keys(row).forEach((key) => {
      if (!headers.includes(key)) headers.push(key);
    });
  }
  if (headers.length === 0) return '';
  const headerLine = headers.map((h) => escapeCsvCell(h)).join(',');
  const dataLines = rows.map((row) => headers.map((h) => escapeCsvCell(row?.[h])).join(','));
  return [headerLine, ...dataLines].join('\r\n');
}

function downloadCsvFile(filename, rows) {
  const csv = buildCsvFromRows(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

function timestampForFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function normalizeUnresolvedIssues(result) {
  const list = result?.unresolved || result?.unresolved_issues || result?.report?.unresolved_issues || [];
  const humanReview = result?.human_review || result?.report?.human_review || [];
  const combined = [...(Array.isArray(list) ? list : []), ...(Array.isArray(humanReview) ? humanReview : [])];
  const seen = new Set();
  return combined.filter((item) => {
    const key = item?.subject_id ?? item?.code ?? JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function issueCategories(issue) {
  if (issue?.reason_type === 'unresolvable_conflict') return ['Needs manual review'];
  if (issue?.conflict_type) {
    if (issue.conflict_type === 'section') return ['Time conflict'];
    if (issue.conflict_type === 'room') return ['Room conflict'];
    if (issue.conflict_type === 'both') return ['Room conflict', 'Time conflict'];
  }
  const sourceText = [
    ...(Array.isArray(issue?.reasons) ? issue.reasons : []),
    issue?.reason,
    issue?.problem,
    issue?.suggestions?.room_conflict,
    issue?.suggestions?.time_conflict,
  ].filter(Boolean).join(' ').toLowerCase();
  const categories = [];
  if (sourceText.includes('room')) categories.push('Room conflict');
  if (sourceText.includes('time') || sourceText.includes('slot') || sourceText.includes('schedule')) {
    categories.push('Time conflict');
  }
  return categories.length > 0 ? categories : ['Manual review'];
}

function buildIssueRecommendations(issue, roomCount) {
  const categories = issueCategories(issue);
  const steps = [];
  if (categories.includes('Room conflict')) {
    if (issue?.rooms_exhausted) {
      steps.push('Add more rooms in the Rooms page, then rerun the scheduler.');
    } else if (Array.isArray(issue?.available_rooms) && issue.available_rooms.length > 0) {
      steps.push('Assign this class to one of the available rooms shown above, then rerun the scheduler.');
    } else if (issue?.suggestions?.room_conflict) {
      steps.push(issue.suggestions.room_conflict);
    } else {
      steps.push(
        roomCount > 0
          ? 'Review the active rooms already loaded and try reassigning this class.'
          : 'No active rooms are currently loaded. Add more rooms before rerunning the scheduler.'
      );
    }
  }
  if (categories.includes('Time conflict')) {
    if (issue?.section_blocked) {
      steps.push('Manually reschedule another class in this section to free a time slot, then rerun.');
    } else if (Array.isArray(issue?.available_time_slots) && issue.available_time_slots.length > 0) {
      steps.push('Try manually assigning this subject to one of the free time windows shown above.');
    } else if (issue?.suggestions?.time_conflict) {
      steps.push(issue.suggestions.time_conflict);
    } else {
      steps.push('Adjust the time schedule for this section, then rerun the scheduler.');
    }
  }
  if (categories.includes('Manual review')) {
    steps.push('Review subject data and room/schedule assignments, then rerun the scheduler.');
  }
  return steps;
}

const DEPT_ABBREV_OVERRIDE = {
  'ELECTRONICS ENGINEERING': 'ECE',
  'ELECTRICAL ENGINEERING': 'EE',
  'COMPUTER ENGINEERING': 'CPE',
  'CIVIL ENGINEERING': 'CE',
  'COMPUTER SCIENCE': 'CS',
  'INFORMATION TECHNOLOGY': 'IT',
  'ARCHITECTURE': 'AR',
  'LIBRARY AND INFORMATION SCIENCE': 'LIS',
  'ELECTRICAL COMMUNICATIONS ENGINEERING': 'ECE',
  'ELECTRONICS AND COMMUNICATIONS ENGINEERING': 'ECE',
};

function abbreviateDept(name) {
  if (!name) return '?';
  const upper = name.trim().toUpperCase();
  if (DEPT_ABBREV_OVERRIDE[upper]) return DEPT_ABBREV_OVERRIDE[upper];
  const stripped = name.replace(/^(department|college|school|institute)\s+of\s+/i, '').trim();
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words.map((w) => w[0]?.toUpperCase() || '').join('');
}

function isPathFitSubject(courseNo) {
  return /path\s*fit/i.test(courseNo || '');
}

function isGymRoom(roomName) {
  return /gym/i.test(roomName || '');
}

function ScheduleTable({ rows, loading, onExportClick, onUpdateClick, isDryRunRows }) {
  const normalizeKey = (v) => (v || '').trim().toUpperCase().replace(/\s+/g, '');

  function isMergedRow(row) {
    return (
      row.merged === true ||
      row.merged === 'true' ||
      (typeof row.merged === 'string' &&
        row.merged !== '' &&
        row.merged.toLowerCase() !== 'false' &&
        row.merged !== 'preserved')
    );
  }

  function mergeSlotKey(row) {
    const mthR = normalizeKey(row.mth_room_name || row.mth_room || String(row.mth_room_id || ''));
    const tfsR = normalizeKey(row.tfs_room_name || row.tfs_room || String(row.tfs_room_id || ''));
    return `${normalizeKey(row.mth_schedule || '')}|||${normalizeKey(row.tfs_schedule || '')}|||${mthR}|||${tfsR}`;
  }

  function getCellText(row, colKey) {
    switch (colKey) {
      case 'code': return row.code || '';
      case 'course_no': return row.course_no || '';
      case 'section': return row.section || '';
      case 'dept_name': return row.department_name || '';
      case 'title': return row.descriptive_title || '';
      case 'lec_hrs': return String(row.lec_hrs || '');
      case 'lab_hrs': return String(row.lab_hrs || '');
      case 'mth_schedule': return row.mth_schedule || '';
      case 'mth_room': return row.mth_room_name || String(row.mth_room_id || '');
      case 'tfs_schedule': return row.tfs_schedule || '';
      case 'tfs_room': return row.tfs_room_name || String(row.tfs_room_id || '');
      case 'status': return isMergedRow(row) ? 'merged' : row.merged === 'preserved' ? 'preserved' : row.schedule_missing ? 'no schedule' : '';
      default: return '';
    }
  }

  const [visibleColumns, setVisibleColumns] = useState(() => new Set(ALL_COLUMNS.map((c) => c.key)));
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [colMenuPos, setColMenuPos] = useState({ top: 0, left: 0 });
  const colButtonRef = useRef(null);
  const colMenuRef = useRef(null);
  const selectAllRef = useRef(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchCol, setSearchCol] = useState('all');
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState(1);

  useEffect(() => {
    if (!colMenuOpen) return;
    const updatePos = () => {
      if (!colButtonRef.current) return;
      const rect = colButtonRef.current.getBoundingClientRect();
      setColMenuPos({ top: rect.bottom + 8, left: rect.right - 220 });
    };
    updatePos();
    window.addEventListener('scroll', updatePos);
    window.addEventListener('resize', updatePos);
    const handleClickOutside = (e) => {
      if (!colButtonRef.current?.contains(e.target) && !colMenuRef.current?.contains(e.target)) {
        setColMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('scroll', updatePos);
      window.removeEventListener('resize', updatePos);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [colMenuOpen]);

  useEffect(() => {
    setPage(1);
    setPageInput(1);
  }, [searchQuery, searchCol, sortCol, sortDir]);

  const indexedRows = useMemo(
    () => (Array.isArray(rows) ? rows : []).map((row, i) => ({
      ...row,
      _key: row.id != null ? String(row.id) : `idx-${i}`,
    })),
    [rows]
  );

  const mergedGroupMap = useMemo(() => {
    const map = new Map();
    for (const row of indexedRows) {
      if (!isMergedRow(row)) continue;
      const key = mergeSlotKey(row);
      if (!map.has(key)) map.set(key, { codes: new Set(), courseNos: new Set(), depts: [], sections: new Set() });
      const entry = map.get(key);
      if (row.code) entry.codes.add(row.code);
      if (row.course_no) entry.courseNos.add(row.course_no);
      if (row.section) entry.sections.add(row.section);
      const dept = row.department_name || `Dept ${row.department_id}`;
      if (!entry.depts.includes(dept)) entry.depts.push(dept);
    }
    return map;
  }, [indexedRows]);

  const SORT_KEYS = {
    code: (r) => (r.code || '').toLowerCase(),
    course_no: (r) => (r.course_no || '').toLowerCase(),
    section: (r) => (r.section || '').toLowerCase(),
    dept_name: (r) => (r.department_name || '').toLowerCase(),
    title: (r) => (r.descriptive_title || '').toLowerCase(),
    lec_hrs: (r) => Number(r.lec_hrs) || 0,
    lab_hrs: (r) => Number(r.lab_hrs) || 0,
    mth_schedule: (r) => (r.mth_schedule || '').toLowerCase(),
    mth_room: (r) => (r.mth_room_name || String(r.mth_room_id || '')).toLowerCase(),
    tfs_schedule: (r) => (r.tfs_schedule || '').toLowerCase(),
    tfs_room: (r) => (r.tfs_room_name || String(r.tfs_room_id || '')).toLowerCase(),
    status: (r) => (isMergedRow(r) ? 'merged' : r.merged === 'preserved' ? 'preserved' : ''),
  };

  const sortedRows = useMemo(() => {
    if (!sortCol || !SORT_KEYS[sortCol]) return indexedRows;
    const fn = SORT_KEYS[sortCol];
    return [...indexedRows].sort((a, b) => {
      const av = fn(a);
      const bv = fn(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [indexedRows, sortCol, sortDir]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedRows;
    if (searchCol === 'all') {
      return sortedRows.filter((row) => ALL_COLUMNS.some((c) => getCellText(row, c.key).toLowerCase().includes(q)));
    }
    return sortedRows.filter((row) => getCellText(row, searchCol).toLowerCase().includes(q));
  }, [sortedRows, searchQuery, searchCol]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / TABLE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startRow = filteredRows.length === 0 ? 0 : (safePage - 1) * TABLE_PAGE_SIZE + 1;
  const endRow = Math.min(safePage * TABLE_PAGE_SIZE, filteredRows.length);
  const pagedRows = filteredRows.slice((safePage - 1) * TABLE_PAGE_SIZE, safePage * TABLE_PAGE_SIZE);

  const allPageSelected = pagedRows.length > 0 && pagedRows.every((r) => selectedRows.has(r._key));
  const somePageSelected = !allPageSelected && pagedRows.some((r) => selectedRows.has(r._key));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = somePageSelected;
  }, [somePageSelected]);

  function handleSort(col) {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  }

  function toggleVisibleColumn(key) {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    const pageKeys = pagedRows.map((r) => r._key);
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageKeys.forEach((k) => next.delete(k));
      else pageKeys.forEach((k) => next.add(k));
      return next;
    });
  }

  function toggleSelectRow(key) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleExportSelected() {
    const selected = filteredRows
      .filter((r) => selectedRows.has(r._key))
      .map(({ _key, ...rest }) => rest);
    downloadCsvFile(`scheduler_selected_${timestampForFileName()}.csv`, selected);
  }

  function applyPageInput() {
    const n = Number(pageInput);
    if (Number.isInteger(n) && n >= 1 && n <= totalPages) setPage(n);
    else setPageInput(safePage);
  }

  function renderStatusCell(row) {
    if (row.schedule_missing) {
      return (
        <span className="px-2 py-1 rounded text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-200">
          No Schedule
        </span>
      );
    }
    if (row.merged === 'unresolved') {
      return <span className="px-2 py-1 rounded text-xs font-semibold bg-red-100 text-red-700">Unresolved</span>;
    }
    if (row.merged === 'preserved') {
      return <span className="px-2 py-1 rounded text-xs font-semibold bg-teal-100 text-teal-700">Preserved</span>;
    }
    if (!isMergedRow(row)) return <span className="text-xs text-on-surface-variant">—</span>;

    const groupKey = mergeSlotKey(row);
    const group = mergedGroupMap.get(groupKey) || { courseNos: new Set(), depts: [] };
    const uniqueCourseNos = [...(group.courseNos || new Set())];
    const multiCourse = uniqueCourseNos.length > 1;

    if (multiCourse) {
      return (
        <div className="flex flex-col gap-0.5">
          <span className="px-2 py-1 rounded text-xs font-semibold bg-blue-100/80 text-blue-700 self-start">Merged</span>
          <span className="text-xs text-blue-500 pl-1" title={group.depts.join(', ')}>→ {uniqueCourseNos.join(', ')}</span>
        </div>
      );
    }
    const abbrevList = group.depts.map(abbreviateDept).join(', ');
    return (
      <div className="flex flex-col gap-0.5">
        <span className="px-2 py-1 rounded text-xs font-semibold bg-blue-100/80 text-blue-700 self-start">Merged</span>
        {abbrevList && <span className="text-xs text-blue-500 pl-1" title={group.depts.join(', ')}>→ {abbrevList}</span>}
      </div>
    );
  }

  function renderCell(row, colKey) {
    switch (colKey) {
      case 'code':
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-block rounded-md bg-primary/10 px-2 py-1 text-xs font-bold text-primary">{row.code || '—'}</span>
            {row.preflight_tag === 'general' && (
              <span className="flex gap-1 flex-wrap">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-300">Original</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 border border-violet-300">General</span>
              </span>
            )}
            {row.preflight_tag === 'original' && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-300 self-start">Original</span>
            )}
            {!row.preflight_tag && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-300 self-start">New!</span>
            )}
          </div>
        );
      case 'course_no':
        return (
          <span className="inline-flex items-center gap-1 flex-wrap">
            <span className="text-xs font-medium text-on-surface">{row.course_no || '—'}</span>
            {isPathFitSubject(row.course_no) && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">PATH FIT</span>
            )}
          </span>
        );
      case 'section':
        return <span className="text-xs text-on-surface">{row.section || '—'}</span>;
      case 'dept_name':
        return <span className="text-xs text-on-surface-variant">{row.department_name || '—'}</span>;
      case 'title':
        return (
          <span className="inline-flex items-center gap-1 flex-wrap" title={row.descriptive_title}>
            <span className="text-xs text-on-surface-variant truncate max-w-xs">{row.descriptive_title || '—'}</span>
            {row.preflight_tag === 'general' && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 border border-violet-300 shrink-0">General</span>
            )}
          </span>
        );
      case 'lec_hrs':
        return <span className="text-xs font-medium text-on-surface-variant">{row.lec_hrs != null ? `${row.lec_hrs}h` : '—'}</span>;
      case 'lab_hrs':
        return <span className="text-xs font-medium text-on-surface-variant">{row.lab_hrs != null ? `${row.lab_hrs}h` : '—'}</span>;
      case 'mth_schedule':
        return row.mth_schedule ? (
          <span className="inline-flex items-center gap-1 flex-wrap">
            <span className="text-xs">{formatScheduleDisplay(row.mth_schedule)}</span>
            {isSimpleSchedule(row.mth_schedule) && getScheduleAmPm(row.mth_schedule) && (
              <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${getScheduleAmPm(row.mth_schedule) === 'AM' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                {getScheduleAmPm(row.mth_schedule)}
              </span>
            )}
          </span>
        ) : <span className="text-xs text-on-surface-variant">—</span>;
      case 'mth_room': {
        const name = row.mth_room_name || row.mth_room_id || '';
        if (!name) return <span className="text-xs text-on-surface-variant">—</span>;
        return (
          <span className="inline-flex items-center gap-1 flex-wrap">
            <span className="text-xs text-on-surface-variant">{name}</span>
            {isGymRoom(name) && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">GYM</span>}
          </span>
        );
      }
      case 'tfs_schedule':
        return row.tfs_schedule ? (
          <span className="inline-flex items-center gap-1 flex-wrap">
            <span className="text-xs">{formatScheduleDisplay(row.tfs_schedule)}</span>
            {isSimpleSchedule(row.tfs_schedule) && getScheduleAmPm(row.tfs_schedule) && (
              <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${getScheduleAmPm(row.tfs_schedule) === 'AM' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                {getScheduleAmPm(row.tfs_schedule)}
              </span>
            )}
          </span>
        ) : <span className="text-xs text-on-surface-variant">—</span>;
      case 'tfs_room': {
        const name = row.tfs_room_name || row.tfs_room_id || '';
        if (!name) return <span className="text-xs text-on-surface-variant">—</span>;
        return (
          <span className="inline-flex items-center gap-1 flex-wrap">
            <span className="text-xs text-on-surface-variant">{name}</span>
            {isGymRoom(name) && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">GYM</span>}
          </span>
        );
      }
      case 'status':
        return renderStatusCell(row);
      default:
        return null;
    }
  }

  const visibleColCount = ALL_COLUMNS.filter((c) => visibleColumns.has(c.key)).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCcw className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="p-3 border-b border-white/50">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex gap-2 flex-1 xl:max-w-sm">
            <select
              value={searchCol}
              onChange={(e) => setSearchCol(e.target.value)}
              aria-label="Search column"
              className="rounded-lg border border-white/30 bg-white/50 px-2 py-2 text-xs text-on-surface-variant outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white min-h-[40px]"
            >
              <option value="all">All cols</option>
              {ALL_COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input
                type="text"
                placeholder={searchCol === 'all' ? 'Search all columns...' : `Search ${ALL_COLUMNS.find((c) => c.key === searchCol)?.label || searchCol}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-white/30 bg-white/50 py-2 pl-8 pr-8 text-xs text-on-surface placeholder-on-surface-variant/50 outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white min-h-[40px]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface" title="Clear search">
                  <X size={14} />
                </button>
              )}
            </div>
            {searchQuery && (
              <span className="self-center text-xs text-on-surface-variant whitespace-nowrap shrink-0">
                {filteredRows.length}/{(rows || []).length}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <button
              ref={colButtonRef}
              type="button"
              onClick={() => setColMenuOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-white min-h-[40px]"
            >
              <Settings size={13} /> Cols
            </button>
            {colMenuOpen && typeof document !== 'undefined' && createPortal(
              <div
                ref={colMenuRef}
                style={{ position: 'fixed', top: `${colMenuPos.top}px`, left: `${colMenuPos.left}px`, zIndex: 9999 }}
                className="bg-white border border-slate-200 rounded-lg shadow-2xl p-2 min-w-[180px]"
              >
                {ALL_COLUMNS.map((col) => (
                  <label key={col.key} className="flex items-center gap-2 px-3 py-2 text-xs text-on-surface hover:bg-primary/5 rounded cursor-pointer whitespace-nowrap transition-colors">
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(col.key)}
                      onChange={() => toggleVisibleColumn(col.key)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-primary focus:ring-primary/30"
                    />
                    {col.label}
                  </label>
                ))}
              </div>,
              document.body
            )}

            {selectedRows.size > 0 && (
              <>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/60 bg-primary/10 px-2 py-1.5 text-xs font-semibold text-primary">
                  {selectedRows.size} sel
                </span>
                <button
                  type="button"
                  onClick={handleExportSelected}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-white/80 px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-white min-h-[40px]"
                >
                  <Download size={13} /> Export Selected
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onExportClick}
              className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-white/80 px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-white min-h-[40px]"
            >
              <Download size={13} /> Export CSV
            </button>

            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={onUpdateClick}
                disabled={isDryRunRows}
                title={isDryRunRows ? 'Disable dry run and click Generate Schedule to save results first.' : undefined}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 min-h-[40px]"
              >
                <ArrowRight size={13} /> Update Course Offering
              </button>
              {isDryRunRows && (
                <p className="text-[11px] text-amber-700">Dry run preview — save a real run first.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="max-h-[calc(100vh-22rem)] overflow-auto">
        <table className="min-w-full w-full text-left text-xs">
          <thead className="sticky top-0 z-20 border-b border-white bg-white">
            <tr>
              <th className="px-3 py-3 w-10 text-center">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={toggleSelectAll}
                  className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary/30"
                />
              </th>
              {ALL_COLUMNS.filter((c) => visibleColumns.has(c.key)).map((col) => (
                <th key={col.key} className="px-3 py-3 text-left" scope="col">
                  <button
                    type="button"
                    onClick={() => handleSort(col.key)}
                    className={`flex items-center gap-1 text-xs font-bold uppercase tracking-[0.28em] transition-colors ${
                      sortCol === col.key ? 'text-primary' : 'text-on-surface-variant/70 hover:text-on-surface'
                    }`}
                    aria-pressed={sortCol === col.key ? 'true' : 'false'}
                  >
                    <span>{col.label}</span>
                    <ArrowUpDown size={10} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {!Array.isArray(rows) || rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColCount + 1} className="px-3 py-8 text-center text-xs text-on-surface-variant">
                  No schedule data. Run the GA to generate a schedule.
                </td>
              </tr>
            ) : pagedRows.length === 0 ? (
              <tr>
                <td colSpan={visibleColCount + 1} className="px-3 py-8 text-center text-xs text-on-surface-variant">
                  No rows match your search.
                </td>
              </tr>
            ) : (
              pagedRows.map((row, idx) => {
                const isSelected = selectedRows.has(row._key);
                return (
                  <tr
                    key={row._key}
                    className={`transition-colors ${isSelected ? 'bg-primary/10' : 'hover:bg-white/40'} ${idx % 2 === 0 && !isSelected ? 'bg-white/6' : ''}`}
                  >
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectRow(row._key)}
                        className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary/30"
                      />
                    </td>
                    {ALL_COLUMNS.filter((c) => visibleColumns.has(c.key)).map((col) => (
                      <td key={col.key} className="px-3 py-2 truncate">
                        {renderCell(row, col.key)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination — only shown when there are more rows than one page */}
      {filteredRows.length > TABLE_PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-white/50 bg-white/40 px-4 py-2 gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/80 whitespace-nowrap">
            {startRow}–{endRow} / {filteredRows.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1 rounded-lg border border-white/60 bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-50 min-h-[36px]"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              type="button"
            >
              <ChevronLeft size={13} /> Prev
            </button>
            <div className="flex items-center gap-2 rounded-lg border border-white/60 bg-white px-3 py-2">
              <span className="text-xs text-on-surface-variant">Page</span>
              <input
                type="number"
                min="1"
                max={totalPages}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={applyPageInput}
                onKeyDown={(e) => { if (e.key === 'Enter') applyPageInput(); }}
                className="w-12 rounded border border-slate-200 bg-slate-50 px-1 py-1 text-right text-xs text-slate-800 outline-none focus:border-primary"
              />
              <span className="text-xs text-on-surface-variant">of {totalPages}</span>
            </div>
            <button
              className="inline-flex items-center gap-1 rounded-lg border border-white/60 bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-50 min-h-[36px]"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              type="button"
            >
              Next <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScheduleView({ onNavigate }) {
  const [preflight, setPreflight] = useState(null);
  const [result, setResult] = useState(null);
  const [loadingPreflight, setLoadingPreflight] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [rows, setRows] = useState([]);
  const [lastRunSummary, setLastRunSummary] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [notice, setNotice] = useState('');
  const [updateMode, setUpdateMode] = useState(COURSE_OFFERING_UPDATE_MODES.BACKUP_THEN_UPDATE);
  const [postUpdateNav, setPostUpdateNav] = useState(false);
  const [isDryRunRows, setIsDryRunRows] = useState(false);
  const [updateModalStep, setUpdateModalStep] = useState('select');
  const [updateResult, setUpdateResult] = useState(null);
  const [updateModalError, setUpdateModalError] = useState('');
  const [showUnresolved, setShowUnresolved] = useState(true);
  const [showGaConflicts, setShowGaConflicts] = useState(true);
  const [showPreflightIssues, setShowPreflightIssues] = useState(true);
  const [loadingPhraseIdx, setLoadingPhraseIdx] = useState(0);

  async function loadPreflight() {
    try {
      setLoadingPreflight(true);
      setError('');
      const payload = await fetchAutomaticSchedulerPreFlight();
      setPreflight(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scheduler pre-flight data.');
      setPreflight(null);
    } finally {
      setLoadingPreflight(false);
    }
  }

  async function loadRows() {
    try {
      setLoadingRows(true);
      const data = await fetchAutomaticSchedulerRows();
      const rowsArray = Array.isArray(data) ? data : (data?.rows && Array.isArray(data.rows) ? data.rows : []);
      setRows(rowsArray);
      setIsDryRunRows(false);
    } catch (err) {
      console.error('Failed to load scheduler rows:', err);
      setRows([]);
      setIsDryRunRows(false);
    } finally {
      setLoadingRows(false);
    }
  }

  useEffect(() => {
    loadPreflight();
    loadRows();
    const raw = localStorage.getItem(LAST_SCHEDULER_RUN_KEY);
    if (raw) {
      try { setLastRunSummary(JSON.parse(raw)); } catch { setLastRunSummary(null); }
    }
  }, []);

  useEffect(() => {
    if (!running) { setLoadingPhraseIdx(0); return; }
    const phrases = dryRun ? DRY_RUN_PHRASES : REAL_RUN_PHRASES;
    const id = setInterval(() => setLoadingPhraseIdx((i) => (i + 1) % phrases.length), 2500);
    return () => clearInterval(id);
  }, [running, dryRun]);

  const issues = preflight?.issues || [];
  const highIssues = issues.filter((i) => i.severity === 'high').length;
  const mediumIssues = issues.filter((i) => i.severity === 'medium').length;
  const lowIssues = issues.filter((i) => i.severity === 'low').length;
  const subjectCount = preflight?.subject_count || 0;
  const roomCount = preflight?.room_count || 0;
  const totalIssues = highIssues + mediumIssues + lowIssues;

  async function handleRun() {
    try {
      setRunning(true);
      setError('');
      setNotice('');
      setPostUpdateNav(false);
      const response = await runAutomaticScheduler({ dryRun });
      setResult(response);

      const fitness = Number(response?.fitness_overall || 0);
      const unresolvedIssues = normalizeUnresolvedIssues(response);
      const summary = {
        generatedAt: formatDateTimeStandard(new Date()),
        quality: fitnessToQuality(fitness),
        fitness,
        schedulesGenerated: Array.isArray(response?.assignments) ? response.assignments.length : 0,
        unresolvedCount: unresolvedIssues.length,
        runId: response?.run_id || 'n/a',
        dryRun,
      };
      setLastRunSummary(summary);
      localStorage.setItem(LAST_SCHEDULER_RUN_KEY, JSON.stringify(summary));

      const preservedCount = (preflight?.preserved_merged_count || 0) + (preflight?.preserved_unique_count || 0);
      const gaAssigned = summary.schedulesGenerated - preservedCount;
      const scenarioNotice =
        preflight?.scenario === 'scenario_1' && preservedCount > 0
          ? `${preservedCount} preserved (merged/unique), ${Math.max(0, gaAssigned)} newly assigned by GA. `
          : '';
      setNotice(
        fitness === 100 && unresolvedIssues.length === 0
          ? `${scenarioNotice}Schedule reached a verified state. You can export it or update Course Offering, then proceed to Faculty Loading.`
          : `${scenarioNotice}Schedule generated, but unresolved issues still need manual review before continuing to Faculty Loading.`
      );

      if (dryRun) {
        await loadPreflight();
        setRows(Array.isArray(response?.assignments) ? response.assignments : []);
        setIsDryRunRows(true);
      } else {
        await Promise.all([loadPreflight(), loadRows()]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scheduler run failed.');
    } finally {
      setRunning(false);
    }
  }

  async function handleExport() {
    try {
      setExporting(true);
      setError('');
      setNotice('');
      const data = await exportAutomaticSchedulerRows();
      const exportRows = Array.isArray(data?.rows) ? data.rows : [];
      downloadCsvFile(`automatic_scheduler_export_${timestampForFileName()}.csv`, exportRows);
      setNotice('Schedule export downloaded as CSV. You can import it back to Course Offering.');
      setShowExportModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  function closeUpdateModal() {
    setShowUpdateModal(false);
    setUpdateModalStep('select');
    setUpdateResult(null);
    setUpdateModalError('');
  }

  async function handleUpdateCourseOffering() {
    try {
      setUpdating(true);
      setUpdateModalError('');
      setError('');
      setNotice('');
      const response = await updateCourseOfferingFromScheduler({ mode: updateMode });
      if (response?.backup_created && Array.isArray(response?.backup_export)) {
        downloadJsonFile(
          `course_offering_backup_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`,
          { exported_at: new Date().toISOString(), rows: response.backup_export }
        );
      }
      setUpdateResult(response);
      setUpdateModalStep('success');
      setPostUpdateNav(true);
      setNotice(
        response?.backup_created
          ? `Course Offering replaced with ${response?.updated || 0} schedule rows. A backup export was downloaded first.`
          : `Course Offering replaced with ${response?.updated || 0} schedule rows without creating a backup.`
      );
      await Promise.all([loadPreflight(), loadRows()]);
    } catch (err) {
      setPostUpdateNav(false);
      setUpdateModalError(err instanceof Error ? err.message : 'Update failed. Please try again.');
    } finally {
      setUpdating(false);
    }
  }

  const fitnessScore = Number(result?.fitness_overall || 0);
  const gaConflicts = useMemo(
    () => (Array.isArray(result?.report?.ga_report?.conflicts) ? result.report.ga_report.conflicts : []),
    [result]
  );
  const unresolvedList = useMemo(() => normalizeUnresolvedIssues(result), [result]);
  const unresolvedCount = unresolvedList.length;
  const isFixed = Boolean(result) && fitnessScore === 100 && unresolvedCount === 0 && gaConflicts.length === 0;
  const needsManualResolution = Boolean(result) && !isFixed;

  const unresolvedCards = useMemo(
    () => unresolvedList.map((issue) => ({
      ...issue,
      categories: issueCategories(issue),
      recommendations: buildIssueRecommendations(issue, roomCount),
    })),
    [unresolvedList, roomCount]
  );

  const groupedIssues = useMemo(
    () => issues.reduce((acc, issue) => {
      const bucket = issue.severity || 'low';
      if (!acc[bucket]) acc[bucket] = [];
      acc[bucket].push(issue);
      return acc;
    }, {}),
    [issues]
  );

  return (
    <div className="space-y-2 animate-in slide-in-from-right-4 duration-500">

      {/* Compact Header */}
      <div className="glass-panel p-3">
        <div className="flex flex-row items-center justify-between gap-3 flex-nowrap">
          <div className="space-y-1 flex-shrink-0">
            <h2 className="text-2xl font-bold text-on-surface">Schedule Generation</h2>
            <p className="text-xs text-on-surface-variant">Automatically assign time slots and rooms using the Genetic Algorithm engine.</p>
          </div>
          <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto pb-1">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1.5 text-xs font-semibold backdrop-blur flex-shrink-0 ${
              preflight?.status === 'blocked'
                ? 'border-red-200 bg-red-50/80 text-red-700'
                : preflight?.status === 'partial'
                ? 'border-amber-200 bg-amber-50/80 text-amber-700'
                : 'border-emerald-200 bg-emerald-50/80 text-emerald-700'
            }`}>
              {loadingPreflight ? '…' : preflight?.status === 'blocked' ? 'Blocked' : preflight?.status === 'partial' ? 'Partial' : 'Ready'}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/70 px-2 py-1.5 text-xs font-semibold text-on-surface-variant backdrop-blur flex-shrink-0">
              <BookOpen size={11} className="text-primary" /> {subjectCount}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/70 px-2 py-1.5 text-xs font-semibold text-on-surface-variant backdrop-blur flex-shrink-0">
              <DoorOpen size={11} className="text-primary" /> {roomCount}
            </span>
            {totalIssues > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50/80 px-2 py-1.5 text-xs font-semibold text-amber-700 backdrop-blur flex-shrink-0">
                <AlertCircle size={11} /> {totalIssues}
              </span>
            )}
            {lastRunSummary && (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/70 px-2 py-1.5 text-xs font-semibold text-on-surface-variant backdrop-blur flex-shrink-0 whitespace-nowrap">
                Run {lastRunSummary.generatedAt}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Generation Controls */}
      <div className="glass-panel p-3 space-y-2">
        {!loadingPreflight && preflight?.scenario === 'scenario_1' && (
          <p className="text-xs text-teal-900 bg-teal-50/80 border border-teal-200 rounded-lg px-3 py-2">
            <span className="font-semibold">Scenario 1:</span>{' '}
            {(preflight.preserved_merged_count || 0) + (preflight.preserved_unique_count || 0)} subject(s) preserved.{' '}
            {preflight.needs_scheduling_count > 0
              ? `${preflight.needs_scheduling_count} will be rescheduled by GA.`
              : 'All subjects already scheduled.'}
          </p>
        )}

        {!loadingPreflight && preflight?.status === 'blocked' && (
          <p className="text-xs text-error bg-error-container/30 border border-error/20 rounded-lg px-3 py-2">
            Subjects or rooms data is incomplete. Resolve pre-flight issues before running.
          </p>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700" role="alert">
            <AlertTriangle size={13} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50/80 border border-emerald-200 px-3 py-2 text-xs text-emerald-900" role="status">
            <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />
            <div className="flex flex-col gap-2 flex-1">
              <span>{notice}</span>
              {postUpdateNav && (
                <button
                  onClick={() => onNavigate?.('course-offering')}
                  className="self-start inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors"
                >
                  <ArrowRight size={12} /> View Course Offerings
                </button>
              )}
            </div>
          </div>
        )}

        {isFixed && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50/80 border border-emerald-200 px-3 py-2 text-xs text-emerald-900">
            <CheckCircle2 size={13} className="text-emerald-600 flex-shrink-0" />
            <span className="font-semibold">Schedule verified — 100% fitness, no conflicts.</span>
            <button
              onClick={() => onNavigate?.('faculty-loading')}
              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors flex-shrink-0"
            >
              <ArrowRight size={11} /> Faculty Loading
            </button>
          </div>
        )}

        {needsManualResolution && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50/80 border border-amber-200 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle size={13} className="text-amber-600 flex-shrink-0" />
            <span>
              <span className="font-semibold">{unresolvedCount} unresolved issue(s)</span>, fitness {fitnessScore.toFixed(1)}%
              {gaConflicts.length > 0 ? `, ${gaConflicts.length} GA conflict(s)` : ''}.{' '}
              Review sections below before continuing.
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRun}
            disabled={running || loadingPreflight}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px]"
          >
            {running ? <RefreshCcw size={15} className="animate-spin" /> : <Play size={15} />}
            {dryRun ? 'Run Dry Preview' : 'Generate Schedule'}
          </button>
          <button
            onClick={() => setDryRun((v) => !v)}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors min-h-[44px] ${
              dryRun
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-outline-variant bg-white/80 text-on-surface hover:bg-white'
            }`}
          >
            <Bolt size={13} />
            {dryRun ? 'Dry Run ON' : 'Dry Run OFF'}
          </button>
          <button
            onClick={() => { loadPreflight(); loadRows(); }}
            className="inline-flex items-center gap-2 rounded-xl border border-outline-variant bg-white/80 px-3 py-2.5 text-xs font-semibold text-on-surface transition-colors hover:bg-white min-h-[44px]"
          >
            <RefreshCcw size={13} /> Refresh
          </button>
          {result && (
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1.5 text-xs font-semibold flex-shrink-0 ${
              isFixed
                ? 'border-emerald-200 bg-emerald-50/80 text-emerald-700'
                : 'border-amber-200 bg-amber-50/80 text-amber-700'
            }`}>
              {fitnessScore.toFixed(1)}% · {fitnessToQuality(fitnessScore)}
            </span>
          )}
        </div>
      </div>

      {/* Unresolved Issues — collapsible */}
      {unresolvedCards.length > 0 && (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowUnresolved((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-amber-900 bg-amber-50/50 border-b border-amber-200 hover:bg-amber-100/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-600" />
              Unresolved Issues ({unresolvedCards.length})
            </span>
            <ChevronDown size={14} className={`text-amber-600 transition-transform duration-200 ${showUnresolved ? 'rotate-180' : ''}`} />
          </button>
          {showUnresolved && (
            <div className="p-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                <button onClick={() => onNavigate?.('subjects')} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white/80 px-3 py-2 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100">
                  <BookOpen size={13} /> Review Subjects
                </button>
                <button onClick={() => onNavigate?.('rooms')} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white/80 px-3 py-2 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100">
                  <DoorOpen size={13} /> Review Rooms
                </button>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {unresolvedCards.map((issue, idx) => (
                  <div key={`${issue.subject_id || issue.code || 'issue'}-${idx}`} className="rounded-2xl border border-amber-200/80 bg-white/75 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-sm text-on-surface">{issue.descriptive_title || issue.course_no || issue.code || 'Subject needs manual review'}</h4>
                        <p className="mt-0.5 text-xs text-on-surface-variant">
                          {[issue.code, issue.course_no, issue.section].filter(Boolean).join(' • ') || 'Unassigned subject'}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {issue.categories.map((cat) => (
                          <span key={cat} className="rounded-full border border-amber-200 bg-amber-100/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-800">
                            {cat}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="mt-3 rounded-xl bg-amber-50/80 p-3 text-xs text-amber-900">
                      <div className="font-semibold">Persistent issue</div>
                      <div className="mt-1 leading-5">
                        {Array.isArray(issue.reasons) && issue.reasons.length > 0
                          ? issue.reasons.join('; ')
                          : issue.reason || issue.problem || 'No detailed reason returned by the GA.'}
                      </div>
                    </div>
                    {Array.isArray(issue.available_rooms) && issue.available_rooms.length > 0 ? (
                      <div className="mt-3">
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Available Rooms ({issue.available_rooms.length})</p>
                        <div className="flex flex-wrap gap-1.5">
                          {issue.available_rooms.map((room) => (
                            <span key={room.room_id} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800">
                              <DoorOpen size={10} />{room.room_name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : issue.rooms_exhausted === true ? (
                      <div className="mt-3 flex items-center gap-2 rounded-xl border border-error/20 bg-error-container/20 p-3 text-xs text-error">
                        <DoorOpen size={13} className="flex-shrink-0" />
                        <span>No available rooms — add more rooms to the system before rerunning.</span>
                      </div>
                    ) : null}
                    {Array.isArray(issue.available_time_slots) && issue.available_time_slots.length > 0 ? (
                      <div className="mt-3">
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Free Time Windows</p>
                        <div className="flex flex-wrap gap-1.5">
                          {issue.available_time_slots.map((slot) => (
                            <span key={slot.label} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                              <Clock3 size={10} />{slot.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : issue.section_blocked === true ? (
                      <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900">
                        <Clock3 size={13} className="flex-shrink-0" />
                        <span>Section is fully booked — manually reschedule another class in this section to free a slot.</span>
                      </div>
                    ) : null}
                    {issue.recommendations.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {issue.recommendations.map((rec) => (
                          <div key={rec} className="flex items-start gap-2 rounded-xl bg-slate-50/80 p-2.5 text-xs text-on-surface-variant">
                            {rec.toLowerCase().includes('room') ? (
                              <DoorOpen size={13} className="mt-0.5 flex-shrink-0 text-slate-500" />
                            ) : rec.toLowerCase().includes('time') || rec.toLowerCase().includes('slot') || rec.toLowerCase().includes('reschedule') ? (
                              <Clock3 size={13} className="mt-0.5 flex-shrink-0 text-slate-500" />
                            ) : (
                              <AlertCircle size={13} className="mt-0.5 flex-shrink-0 text-slate-500" />
                            )}
                            <span>{rec}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {needsManualResolution && unresolvedCards.length === 0 && (
        <div className="glass-panel border border-amber-200 bg-amber-50/40 rounded-2xl px-4 py-3 text-xs text-amber-900">
          The fitness score is below 100 but the GA returned no explicit unresolved items. Review subject times and room allocation manually, then rerun.
        </div>
      )}

      {/* GA Conflict Report — collapsible */}
      {gaConflicts.length > 0 && (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowGaConflicts((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-rose-900 bg-rose-50/50 border-b border-rose-200 hover:bg-rose-100/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <AlertCircle size={14} className="text-rose-600" />
              GA Conflict Report ({gaConflicts.length})
            </span>
            <ChevronDown size={14} className={`text-rose-600 transition-transform duration-200 ${showGaConflicts ? 'rotate-180' : ''}`} />
          </button>
          {showGaConflicts && (
            <div className="p-4 space-y-3">
              <p className="text-xs text-on-surface-variant">Subjects scheduled by the GA but still in hard conflict — these violations reduce the fitness score.</p>
              {gaConflicts.map((c, idx) => {
                const isRoom = c.type === 'room_conflict';
                const isOverload = c.type === 'section_overload';
                const isGymExclusivity = c.type === 'gym_exclusivity';
                const isGymCapacity = c.type === 'gym_capacity';
                return (
                  <div key={idx} className={`rounded-2xl border p-4 ${
                    isRoom ? 'border-rose-200 bg-rose-50/60'
                    : isOverload ? 'border-amber-200 bg-amber-50/60'
                    : isGymExclusivity || isGymCapacity ? 'border-purple-200 bg-purple-50/60'
                    : 'border-orange-200 bg-orange-50/60'
                  }`}>
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className={`mt-0.5 flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${
                        isRoom ? 'bg-rose-100 text-rose-700'
                        : isOverload ? 'bg-amber-100 text-amber-700'
                        : isGymExclusivity ? 'bg-purple-100 text-purple-700'
                        : isGymCapacity ? 'bg-violet-100 text-violet-700'
                        : 'bg-orange-100 text-orange-700'
                      }`}>
                        {isRoom ? 'Room Conflict' : isOverload ? 'Daily Overload' : isGymExclusivity ? 'GYM Exclusivity' : isGymCapacity ? 'GYM Capacity' : 'Section Overlap'}
                      </span>
                      {c.day && <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 mt-1">{c.day}</span>}
                      {isRoom && c.room && <span className="text-[11px] font-semibold text-slate-500 mt-1">Room: {c.room}</span>}
                      {!isRoom && !isGymExclusivity && !isGymCapacity && c.section && <span className="text-[11px] font-semibold text-slate-500 mt-1">Section: {c.section}</span>}
                      {isOverload && c.total_hours != null && <span className="text-[11px] font-semibold text-amber-600 mt-1">{c.total_hours}h / 10h limit</span>}
                      {(isGymExclusivity || isGymCapacity) && c.room && <span className="text-[11px] font-semibold text-purple-600 mt-1">Room: {c.room}</span>}
                    </div>
                    {isGymExclusivity && c.subject && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700">{c.subject}</span>
                      </div>
                    )}
                    <p className="mt-2 text-sm font-medium text-on-surface">{c.problem}</p>
                    {Array.isArray(c.subjects) && c.subjects.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.subjects.map((sub, si) => (
                          <span key={si} className="rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1 text-xs font-semibold text-slate-700">{sub}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Pre-flight Issues — collapsible */}
      {Object.keys(groupedIssues).length > 0 && (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowPreflightIssues((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-on-surface bg-white/60 border-b border-white/50 hover:bg-white/80 transition-colors"
          >
            <span>Pre-flight Issues</span>
            <ChevronDown size={14} className={`text-on-surface-variant transition-transform duration-200 ${showPreflightIssues ? 'rotate-180' : ''}`} />
          </button>
          {showPreflightIssues && (
            <div className="p-4 space-y-4">
              {groupedIssues['high'] && (
                <div className="border-l-4 border-error bg-error-container/20 rounded p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={15} className="text-error" />
                    <h4 className="font-semibold text-error text-sm">High Severity ({groupedIssues['high'].length})</h4>
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {groupedIssues['high'].map((issue, idx) => (
                      <div key={idx} className="bg-white/60 rounded p-3 text-xs">
                        <div className="font-medium text-error/90">{issue.problem}</div>
                        <div className="text-on-surface-variant mt-1">
                          {issue.entity_label && <span className="block">Subject: {issue.entity_label}</span>}
                          {issue.department_name && <span className="block">Department: {issue.department_name}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {groupedIssues['medium'] && (
                <div className="border-l-4 border-amber-400 bg-amber-100/20 rounded p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle size={15} className="text-amber-700" />
                    <h4 className="font-semibold text-amber-700 text-sm">Medium Severity ({groupedIssues['medium'].length})</h4>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {groupedIssues['medium'].map((issue, idx) => {
                      const text = issue.message || issue.description || issue.problem || issue.title || JSON.stringify(issue);
                      return (
                        <div key={idx} className="bg-white/60 rounded p-3 text-xs text-amber-900">
                          <div className="font-medium">{text}</div>
                          <div className="mt-1 text-on-surface-variant">
                            {issue.entity_label && <span className="block">Subject: {issue.entity_label}</span>}
                            {issue.department_name && <span className="block">Department: {issue.department_name}</span>}
                            {issue.suggestion && <span className="block">Suggestion: {issue.suggestion}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {groupedIssues['low'] && (
                <div className="border-l-4 border-blue-300 bg-blue-100/20 rounded p-4">
                  <h4 className="font-semibold text-blue-700 text-sm">Low Severity ({groupedIssues['low'].length})</h4>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Schedule Data Table */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/50">
          <h3 className="text-sm font-bold text-on-surface">Automatic Scheduler Data</h3>
          <p className="text-xs text-on-surface-variant mt-0.5">Current schedule assignments and room allocations</p>
        </div>
        <ScheduleTable
          rows={rows}
          loading={loadingRows}
          onExportClick={() => setShowExportModal(true)}
          onUpdateClick={() => { setUpdateModalStep('select'); setUpdateResult(null); setUpdateModalError(''); setShowUpdateModal(true); }}
          isDryRunRows={isDryRunRows}
        />
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-2xl font-bold text-on-surface mb-4">Export Schedule</h3>
            <p className="text-on-surface-variant mb-6">Download the automatic scheduler output as CSV. This can be imported back to Course Offering.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowExportModal(false)} className="flex-1 rounded-lg border border-outline-variant px-4 py-2 font-semibold text-on-surface hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleExport} disabled={exporting} className="flex-1 rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2">
                {exporting ? <RefreshCcw size={16} className="animate-spin" /> : <Download size={16} />}
                {exporting ? 'Exporting...' : 'Export'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Full-screen Schedule Generation Overlay */}
      {running && (
        <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-white/20 bg-white/10 p-8 text-white shadow-2xl">
            <div className="relative h-16 w-16">
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-white/20 border-t-white" />
              <div className="absolute inset-2 animate-spin rounded-full border-4 border-white/10 border-t-white/60" style={{ animationDirection: 'reverse', animationDuration: '0.8s' }} />
            </div>
            <div className="space-y-1.5 text-center">
              <p className="text-lg font-bold tracking-tight">
                {(dryRun ? DRY_RUN_PHRASES : REAL_RUN_PHRASES)[loadingPhraseIdx]}
              </p>
              <p className="text-sm text-white/70">
                {dryRun
                  ? 'Running the Genetic Algorithm in preview mode. Please wait.'
                  : 'Running the Genetic Algorithm to assign time slots and rooms. Please wait.'}
              </p>
              <p className="text-xs text-white/50">Do not close or refresh this page.</p>
            </div>
            {!dryRun && (
              <div className="w-full rounded-lg border border-primary/30 bg-primary/20 px-4 py-2.5 text-center text-xs text-white/80">
                This run will save results to the database.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Update Modal */}
      {showUpdateModal && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <motion.div key={updateModalStep} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">

            {updateModalStep === 'select' && (
              <>
                <h3 className="text-2xl font-bold text-on-surface mb-4">Update Course Offering</h3>
                {isDryRunRows && (
                  <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900 flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-amber-600" />
                    <span>The table shows a <strong>dry run preview</strong> that was not saved. Disable dry run and click <strong>Generate Schedule</strong> first to persist the results before updating Course Offering.</span>
                  </div>
                )}
                <p className="text-on-surface-variant mb-6">Choose how to update Course Offering. Both choices clear and replace the current Course Offering table with the scheduler output.</p>
                <div className="mb-6 space-y-3">
                  <button
                    onClick={() => setUpdateMode(COURSE_OFFERING_UPDATE_MODES.BACKUP_THEN_UPDATE)}
                    className={`w-full rounded-xl border p-4 text-left transition-colors ${updateMode === COURSE_OFFERING_UPDATE_MODES.BACKUP_THEN_UPDATE ? 'border-primary bg-primary-container/20' : 'border-outline-variant bg-slate-50/80 hover:bg-white'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-on-surface">Choice 1: Backup export first, then update</div>
                        <p className="mt-1 text-sm text-on-surface-variant">Downloads a backup of the current Course Offering table before the scheduler replaces it.</p>
                      </div>
                      {updateMode === COURSE_OFFERING_UPDATE_MODES.BACKUP_THEN_UPDATE && <CheckCircle2 size={18} className="text-primary flex-shrink-0" />}
                    </div>
                  </button>
                  <button
                    onClick={() => setUpdateMode(COURSE_OFFERING_UPDATE_MODES.UPDATE_NO_BACKUP)}
                    className={`w-full rounded-xl border p-4 text-left transition-colors ${updateMode === COURSE_OFFERING_UPDATE_MODES.UPDATE_NO_BACKUP ? 'border-amber-300 bg-amber-50/80' : 'border-outline-variant bg-slate-50/80 hover:bg-white'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-on-surface">Choice 2: Proceed with no backup</div>
                        <p className="mt-1 text-sm text-on-surface-variant">Immediately clears and replaces the Course Offering table with no exported backup.</p>
                      </div>
                      {updateMode === COURSE_OFFERING_UPDATE_MODES.UPDATE_NO_BACKUP && <CheckCircle2 size={18} className="text-amber-600 flex-shrink-0" />}
                    </div>
                  </button>
                </div>
                <div className="flex gap-3">
                  <button onClick={closeUpdateModal} className="flex-1 rounded-lg border border-outline-variant px-4 py-2 font-semibold text-on-surface hover:bg-gray-50 transition-colors">Cancel</button>
                  <button onClick={() => setUpdateModalStep('confirm')} disabled={isDryRunRows} className="flex-1 rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2">
                    <ArrowRight size={16} /> Next
                  </button>
                </div>
              </>
            )}

            {updateModalStep === 'confirm' && (
              <>
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-error-container/40 flex-shrink-0">
                    <AlertTriangle size={22} className="text-error" />
                  </div>
                  <h3 className="text-xl font-bold text-on-surface">Confirm Update</h3>
                </div>
                <div className="mb-5 rounded-xl border border-error/20 bg-error-container/20 p-4 text-sm text-on-surface space-y-2">
                  <p className="font-semibold text-error">This action cannot be undone.</p>
                  <p>All current Course Offering rows will be <strong>permanently deleted</strong> and replaced with the {rows.length} row{rows.length !== 1 ? 's' : ''} from the Automatic Scheduler.</p>
                  {updateMode === COURSE_OFFERING_UPDATE_MODES.BACKUP_THEN_UPDATE
                    ? <p className="text-emerald-800 font-medium">A JSON backup of the current data will be downloaded to your device first.</p>
                    : <p className="text-amber-800 font-medium">No backup will be created. Proceeding means the existing data is gone.</p>
                  }
                </div>
                <p className="mb-6 text-sm text-on-surface-variant">
                  Selected: <span className="font-semibold text-on-surface">{updateMode === COURSE_OFFERING_UPDATE_MODES.BACKUP_THEN_UPDATE ? 'Backup then update' : 'Update without backup'}</span>
                </p>
                {updateModalError && (
                  <div className="mb-4 rounded-xl border border-error/30 bg-error-container/30 p-3 text-sm text-error flex items-start gap-2">
                    <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                    <span>{updateModalError}</span>
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => { setUpdateModalStep('select'); setUpdateModalError(''); }} className="flex-1 rounded-lg border border-outline-variant px-4 py-2 font-semibold text-on-surface hover:bg-gray-50 transition-colors">Back</button>
                  <button onClick={handleUpdateCourseOffering} disabled={updating} className="flex-1 rounded-lg bg-error px-4 py-2 font-semibold text-white hover:bg-error/90 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2">
                    {updating ? <RefreshCcw size={16} className="animate-spin" /> : <AlertTriangle size={16} />}
                    {updating ? 'Updating...' : 'Yes, Proceed'}
                  </button>
                </div>
              </>
            )}

            {updateModalStep === 'success' && (
              <>
                <div className="mb-6 flex flex-col items-center text-center gap-3">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                    <CheckCircle2 size={36} className="text-emerald-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-on-surface">Update Successful</h3>
                  <p className="text-on-surface-variant text-sm">
                    Course Offering has been replaced with{' '}
                    <span className="font-bold text-on-surface">{updateResult?.updated ?? 0} row{(updateResult?.updated ?? 0) !== 1 ? 's' : ''}</span>{' '}
                    from the Automatic Scheduler.
                  </p>
                  {updateResult?.backup_created && (
                    <div className="w-full rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-900 flex items-center gap-2">
                      <CheckCircle2 size={15} className="flex-shrink-0 text-emerald-600" />
                      <span>A backup of the previous data was downloaded to your device.</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={closeUpdateModal} className="flex-1 rounded-lg border border-outline-variant px-4 py-2 font-semibold text-on-surface hover:bg-gray-50 transition-colors">Close</button>
                  <button onClick={() => { closeUpdateModal(); onNavigate?.('course-offering'); }} className="flex-1 rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary/90 transition-colors inline-flex items-center justify-center gap-2">
                    <ArrowRight size={16} /> View Course Offerings
                  </button>
                </div>
              </>
            )}

          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
