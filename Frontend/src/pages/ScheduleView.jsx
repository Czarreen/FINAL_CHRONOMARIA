import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Bolt,
  CheckCircle2,
  Clock3,
  Download,
  DoorOpen,
  FileWarning,
  Gauge,
  History,
  Play,
  RefreshCcw,
  Sparkles,
  TrendingUp,
  WandSparkles,
  AlertTriangle,
  Calendar,
  CalendarOff,
  BrainCircuit,
} from 'lucide-react';
import {
  fetchAutomaticSchedulerPreFlight,
  runAutomaticScheduler,
  fetchAutomaticSchedulerRows,
  exportAutomaticSchedulerRows,
  updateCourseOfferingFromScheduler,
} from '../services/gaApi.js';
import { getScheduleAmPm, formatScheduleTimeDisplay } from '../utils/scheduleUtils.js';

const LAST_SCHEDULER_RUN_KEY = 'automaticSchedulerLastRun';
const COURSE_OFFERING_UPDATE_MODES = {
  BACKUP_THEN_UPDATE: 'BACKUP_THEN_UPDATE',
  UPDATE_NO_BACKUP: 'UPDATE_NO_BACKUP',
};

function StatCard({ label, value, icon: Icon, tone = 'primary' }) {
  const toneClass =
    tone === 'danger'
      ? 'text-error bg-error-container/60'
      : tone === 'warning'
        ? 'text-amber-700 bg-amber-100/80'
        : tone === 'success'
          ? 'text-emerald-700 bg-emerald-100/80'
          : 'text-primary bg-primary-container/20';

  return (
    <div className="glass-panel rounded-xl p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-on-surface-variant">{label}</p>
          <p className="mt-2 text-3xl font-headline-xl font-extrabold text-on-surface">{value}</p>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-full ${toneClass}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-col gap-3 border-b border-white/50 pb-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h3 className="text-xl font-headline-lg font-bold text-on-surface">{title}</h3>
        <p className="mt-1 text-sm text-on-surface-variant">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function fitnessToQuality(score) {
  if (score >= 95) return 'Excellent';
  if (score >= 80) return 'Good';
  if (score >= 60) return 'Fair';
  if (score >= 40) return 'Poor';
  return 'Very Poor';
}

function qualityTone(quality) {
  switch (quality) {
    case 'Excellent':
    case 'Good':
      return 'text-emerald-700 bg-emerald-100/80 border-emerald-200';
    case 'Fair':
      return 'text-amber-700 bg-amber-100/80 border-amber-200';
    case 'Poor':
    case 'Very Poor':
      return 'text-error bg-error-container/60 border-error/20';
    default:
      return 'text-on-surface bg-white/80 border-white/60';
  }
}

function formatDateTimeStandard(date) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
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
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

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

  const [searchQuery, setSearchQuery] = useState('');

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

  // Groups merged rows by physical slot (schedule + room) → { codes: Set, depts: [], sections: Set }
  const mergedGroupMap = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(rows)) return map;
    for (const row of rows) {
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
  }, [rows]);

  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  const SORT_KEYS = {
    code: (r) => (r.code || '').toLowerCase(),
    course_no: (r) => (r.course_no || '').toLowerCase(),
    section: (r) => (r.section || '').toLowerCase(),
    dept_name: (r) => (r.department_name || '').toLowerCase(),
    title: (r) => (r.descriptive_title || '').toLowerCase(),
    lec_hrs: (r) => Number(r.lec_hrs) || 0,
    lab_hrs: (r) => Number(r.lab_hrs) || 0,
    mth_schedule: (r) => (r.mth_schedule || '').toLowerCase(),
    mth_room: (r) => (r.mth_room_name || r.mth_room_id || '').toLowerCase(),
    tfs_schedule: (r) => (r.tfs_schedule || '').toLowerCase(),
    tfs_room: (r) => (r.tfs_room_name || r.tfs_room_id || '').toLowerCase(),
    status: (r) => (isMergedRow(r) ? 'merged' : r.merged === 'preserved' ? 'preserved' : ''),
  };

  const sortedRows = useMemo(() => {
    if (!sortCol || !SORT_KEYS[sortCol]) return rows;
    const fn = SORT_KEYS[sortCol];
    return [...rows].sort((a, b) => {
      const av = fn(a);
      const bv = fn(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, sortCol, sortDir]);

  const rowSearchIndex = useMemo(
    () => sortedRows.map((row) =>
      [
        row.code,
        row.course_no,
        row.section,
        row.descriptive_title,
        row.mth_schedule,
        row.mth_room_name || row.mth_room_id,
        row.tfs_schedule,
        row.tfs_room_name || row.tfs_room_id,
        row.department_name,
      ].filter(Boolean).join(' ').toLowerCase()
    ),
    [sortedRows]
  );

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedRows;
    return sortedRows.filter((_, idx) => rowSearchIndex[idx].includes(q));
  }, [sortedRows, rowSearchIndex, searchQuery]);

  function SortIcon({ col }) {
    if (sortCol !== col) return <span className="ml-1 opacity-30">↕</span>;
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  function Th({ col, children }) {
    return (
      <th
        className="px-4 py-3 text-left font-bold text-on-surface cursor-pointer select-none hover:bg-white/40 transition-colors whitespace-nowrap"
        onClick={() => handleSort(col)}
      >
        {children}<SortIcon col={col} />
      </th>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCcw className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-on-surface-variant">No schedule data available. Run the GA to generate a schedule.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="px-4 pt-4 pb-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by code, course, section, title, room..."
            className="w-full max-w-sm rounded-lg border border-white/40 bg-white/50 px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {searchQuery && (
            <span className="text-xs text-on-surface-variant">
              {filteredRows.length} of {rows.length} rows
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onExportClick}
            className="inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-white/80 px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-white"
          >
            <Download size={14} />
            Export CSV
          </button>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={onUpdateClick}
              disabled={isDryRunRows}
              title={isDryRunRows ? 'Disable dry run and click Generate Schedule to save results first.' : undefined}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowRight size={14} />
              Update Course Offering
            </button>
            {isDryRunRows && (
              <p className="text-[11px] text-amber-700">Dry run preview — save a real run first.</p>
            )}
          </div>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-white/60 border-b border-white/50">
          <tr>
            <Th col="code">Code</Th>
            <Th col="course_no">Course No.</Th>
            <Th col="section">Section</Th>
            <Th col="dept_name">Department</Th>
            <Th col="title">Title</Th>
            <Th col="lec_hrs">Lec Hrs</Th>
            <Th col="lab_hrs">Lab Hrs</Th>
            <Th col="mth_schedule">MTH Schedule</Th>
            <Th col="mth_room">MTH Room</Th>
            <Th col="tfs_schedule">TF Schedule</Th>
            <Th col="tfs_room">TF Room</Th>
            <Th col="status">Status</Th>
          </tr>
        </thead>
        <tbody>
          {filteredRows.map((row, idx) => (
            <tr key={idx} className="border-b border-white/30 hover:bg-white/40 transition-colors">
              <td className="px-4 py-3 text-on-surface font-medium">
                <div className="flex flex-col gap-0.5">
                  <span>{row.code || '—'}</span>
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
              </td>
              <td className="px-4 py-3 text-on-surface">
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  <span>{row.course_no || '—'}</span>
                  {isPathFitSubject(row.course_no) && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">PATH FIT</span>
                  )}
                </span>
              </td>
              <td className="px-4 py-3 text-on-surface">{row.section || '—'}</td>
              <td className="px-4 py-3 text-on-surface">{row.department_name || '—'}</td>
              <td className="px-4 py-3 text-on-surface max-w-xs" title={row.descriptive_title}>
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  <span className="truncate">{row.descriptive_title || '—'}</span>
                  {row.preflight_tag === 'general' && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 border border-violet-300 shrink-0">General</span>
                  )}
                </span>
              </td>
              <td className="px-4 py-3 text-on-surface">{row.lec_hrs || '—'}</td>
              <td className="px-4 py-3 text-on-surface">{row.lab_hrs || '—'}</td>
              <td className="px-4 py-3 text-on-surface text-xs">
                {row.mth_schedule ? (
                  <span className="inline-flex items-center gap-1">
                    {formatScheduleTimeDisplay(row.mth_schedule)}
                    {getScheduleAmPm(row.mth_schedule) && (
                      <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${getScheduleAmPm(row.mth_schedule) === 'AM' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                        {getScheduleAmPm(row.mth_schedule)}
                      </span>
                    )}
                  </span>
                ) : '—'}
              </td>
              <td className="px-4 py-3 text-on-surface text-xs">
                {(() => {
                  const name = row.mth_room_name || row.mth_room_id || '';
                  if (!name) return '—';
                  return (
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                      <span>{name}</span>
                      {isGymRoom(name) && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">GYM</span>
                      )}
                    </span>
                  );
                })()}
              </td>
              <td className="px-4 py-3 text-on-surface text-xs">
                {row.tfs_schedule ? (
                  <span className="inline-flex items-center gap-1">
                    {formatScheduleTimeDisplay(row.tfs_schedule)}
                    {getScheduleAmPm(row.tfs_schedule) && (
                      <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${getScheduleAmPm(row.tfs_schedule) === 'AM' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                        {getScheduleAmPm(row.tfs_schedule)}
                      </span>
                    )}
                  </span>
                ) : '—'}
              </td>
              <td className="px-4 py-3 text-on-surface text-xs">
                {(() => {
                  const name = row.tfs_room_name || row.tfs_room_id || '';
                  if (!name) return '—';
                  return (
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                      <span>{name}</span>
                      {isGymRoom(name) && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">GYM</span>
                      )}
                    </span>
                  );
                })()}
              </td>
              <td className="px-4 py-3">
                {(() => {
                  const isMerged = isMergedRow(row);
                  const isUnresolved = row.merged === 'unresolved';
                  const isPreserved = row.merged === 'preserved';
                  if (row.schedule_missing) {
                    return (
                      <span className="px-2 py-1 rounded text-xs font-semibold bg-orange-100 text-orange-700 border border-orange-200 self-start">
                        No Schedule
                      </span>
                    );
                  }
                  if (isUnresolved) {
                    return (
                      <span className="px-2 py-1 rounded text-xs font-semibold bg-red-100 text-red-700 self-start">
                        Unresolved
                      </span>
                    );
                  }
                  if (isPreserved) {
                    return (
                      <span className="px-2 py-1 rounded text-xs font-semibold bg-teal-100 text-teal-700 self-start">
                        Preserved
                      </span>
                    );
                  }
                  if (!isMerged) {
                    return <span className="text-xs text-on-surface-variant">—</span>;
                  }
                  const groupKey = mergeSlotKey(row);
                  const group = mergedGroupMap.get(groupKey) || { codes: new Set(), courseNos: new Set(), depts: [], sections: new Set() };
                  const uniqueCourseNos = [...(group.courseNos || new Set())];
                  const multiCourse = uniqueCourseNos.length > 1;
                  if (multiCourse) {
                    return (
                      <div className="flex flex-col gap-0.5">
                        <span className="px-2 py-1 rounded text-xs font-semibold bg-blue-100/80 text-blue-700 self-start">Merged</span>
                        <span className="text-xs text-blue-500 pl-1" title={group.depts.join(', ')}>
                          → {uniqueCourseNos.join(', ')}
                        </span>
                      </div>
                    );
                  }
                  const abbrevList = group.depts.map(abbreviateDept).join(', ');
                  const fullList = group.depts.join(', ');
                  return (
                    <div className="flex flex-col gap-0.5">
                      <span className="px-2 py-1 rounded text-xs font-semibold bg-blue-100/80 text-blue-700 self-start">Merged</span>
                      {abbrevList && (
                        <span className="text-xs text-blue-500 pl-1" title={fullList}>
                          → {abbrevList}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      try {
        setLastRunSummary(JSON.parse(raw));
      } catch {
        setLastRunSummary(null);
      }
    }
  }, []);

  const issues = preflight?.issues || [];
  const highIssues = issues.filter((issue) => issue.severity === 'high').length;
  const mediumIssues = issues.filter((issue) => issue.severity === 'medium').length;
  const lowIssues = issues.filter((issue) => issue.severity === 'low').length;
  const subjectCount = preflight?.subject_count || 0;
  const roomCount = preflight?.room_count || 0;

  const statusLabel = useMemo(() => {
    if (!preflight) return 'Unavailable';
    if (preflight.status === 'blocked') return 'Blocked';
    if (preflight.status === 'partial') return 'Ready with issues';
    return 'Ready';
  }, [preflight]);

  const statusTone = preflight?.status === 'blocked' ? 'danger' : preflight?.status === 'partial' ? 'warning' : 'success';

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
        const dryRunRows = Array.isArray(response?.assignments) ? response.assignments : [];
        setRows(dryRunRows);
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
          {
            exported_at: new Date().toISOString(),
            rows: response.backup_export,
          }
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
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-[28px] border border-white/70 bg-white/70 p-6 shadow-[0_30px_50px_rgba(75,42,184,0.08)] backdrop-blur-xl md:p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-container/15 via-transparent to-secondary/10" />
        <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-secondary/10 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary-container/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.3em] text-primary">
            <Calendar size={14} /> Automatic Scheduler
          </div>
          <h2 className="mt-3 text-4xl font-headline-xl font-extrabold tracking-tight text-on-surface md:text-5xl">Schedule Generation</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-on-surface-variant md:text-base">Automatically assign time slots and rooms using the Genetic Algorithm engine.</p>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="rounded-2xl border border-error/20 bg-error-container/35 p-4 text-sm text-error flex items-start gap-3">
          <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-sm text-emerald-900 flex items-start gap-3">
          <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0" />
          <div className="flex flex-col gap-2 flex-1">
            <span>{notice}</span>
            {postUpdateNav && (
              <button
                onClick={() => onNavigate?.('course-offering')}
                className="self-start inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white/80 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors"
              >
                <ArrowRight size={16} />
                View Course Offerings
              </button>
            )}
          </div>
        </div>
      )}

      {/* Generation Controls */}
      <div className="glass-panel rounded-2xl p-6">
        <SectionHeader
          title="Generation Controls"
          subtitle="Check readiness, review active profile, and run the GA."
          action={<div className="flex items-center gap-2 rounded-full bg-primary-container/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-primary"><TrendingUp size={14} /> Live snapshot</div>}
        />

        <div className="mt-6 space-y-5">
          {!loadingPreflight && preflight?.status === 'blocked' ? (
            <div className="rounded-2xl border border-error/20 bg-error-container/35 p-4 text-sm text-error">Subjects or rooms data is incomplete. Resolve pre-flight issues before generating schedule.</div>
          ) : null}

          {!loadingPreflight && preflight?.status === 'partial' ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">Some subjects still need attention, but GA can proceed with the schedulable rows.</div>
          ) : null}

          {!loadingPreflight && preflight?.status !== 'blocked' ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900">Data is ready. You can run GA preview or persist to automatic_scheduler.</div>
          ) : null}

          {!loadingPreflight && preflight?.scenario === 'scenario_1' && (
            <div className="rounded-2xl border border-teal-200 bg-teal-50/80 p-4 text-sm text-teal-900 flex items-start gap-3">
              <Calendar size={18} className="mt-0.5 flex-shrink-0 text-teal-600" />
              <div>
                <span className="font-semibold">Scenario 1 detected</span> — {(preflight.preserved_merged_count || 0) + (preflight.preserved_unique_count || 0)} subject(s) already have conflict-free schedules and will be preserved.{' '}
                {preflight.needs_scheduling_count > 0
                  ? `${preflight.needs_scheduling_count} subject(s) will be rescheduled by the GA.`
                  : 'All subjects are already scheduled.'}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Subjects Loaded" value={String(subjectCount)} icon={BookOpen} tone="primary" />
            <StatCard label="Rooms Loaded" value={String(roomCount)} icon={DoorOpen} tone="primary" />
            <StatCard label="Total Issues" value={String(highIssues + mediumIssues + lowIssues)} icon={AlertCircle} tone={issues.length > 0 ? 'warning' : 'success'} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={handleRun} disabled={running || loadingPreflight} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-on-primary shadow-lg shadow-primary/20 transition-all hover:-translate-y-0.5 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
              {running ? <RefreshCcw size={16} className="animate-spin" /> : <Play size={16} />}
              {dryRun ? 'Run Dry Preview' : 'Generate Schedule'}
            </button>
            <button onClick={() => setDryRun((value) => !value)} className="inline-flex items-center gap-2 rounded-xl border border-outline-variant bg-white/80 px-4 py-3 text-sm font-semibold text-on-surface transition-colors hover:bg-white">
              <Bolt size={16} />
              {dryRun ? 'Dry run enabled' : 'Dry run disabled'}
            </button>
            <button onClick={() => { loadPreflight(); loadRows(); }} className="inline-flex items-center gap-2 rounded-xl border border-outline-variant bg-white/80 px-4 py-3 text-sm font-semibold text-on-surface transition-colors hover:bg-white">
              <RefreshCcw size={16} /> Refresh checks
            </button>
            <div className="inline-flex items-center gap-2 rounded-xl border border-white/60 bg-white/80 px-4 py-3 text-sm text-on-surface-variant">
              <Gauge size={16} />
              Status: <span className={`font-bold ${statusTone === 'danger' ? 'text-error' : statusTone === 'warning' ? 'text-amber-700' : 'text-emerald-700'}`}>{statusLabel}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Last Run Summary */}
      {lastRunSummary && (
        <div className="glass-panel rounded-2xl p-6">
          <SectionHeader
            title="Last Run Summary"
            subtitle={`Generated ${lastRunSummary.generatedAt}`}
            action={null}
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white/60 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-on-surface-variant">Quality</p>
              <p className={`mt-2 text-2xl font-bold ${qualityTone(lastRunSummary.quality).split(' ')[0]}`}>{lastRunSummary.quality}</p>
            </div>
            <div className="rounded-xl bg-white/60 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-on-surface-variant">Fitness Score</p>
              <p className="mt-2 text-2xl font-bold text-on-surface">{(lastRunSummary.fitness || 0).toFixed(1)}%</p>
            </div>
            <div className="rounded-xl bg-white/60 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-on-surface-variant">Schedules</p>
              <p className="mt-2 text-2xl font-bold text-on-surface">{lastRunSummary.schedulesGenerated}</p>
            </div>
            <div className="rounded-xl bg-white/60 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-on-surface-variant">Unresolved Issues</p>
              <p className="mt-2 text-2xl font-bold text-on-surface">{lastRunSummary.unresolvedCount}</p>
            </div>
            <div className="rounded-xl bg-white/60 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-on-surface-variant">GA Conflicts</p>
              <p className="mt-2 text-2xl font-bold text-on-surface">{gaConflicts.length}</p>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Fixed State */}
      {isFixed && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl p-6 border border-emerald-200 bg-emerald-50/50">
          <div className="flex items-start gap-4">
            <CheckCircle2 className="text-emerald-600 flex-shrink-0 mt-1" size={24} />
            <div className="flex-1">
              <h3 className="font-bold text-emerald-900">Schedule Verified Successfully</h3>
              <p className="mt-1 text-sm text-emerald-800">No conflicts detected and the fitness score reached 100. You can safely export this schedule, update Course Offering, and continue to Faculty Loading.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button onClick={() => onNavigate?.('faculty-loading')} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white/80 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors">
                  <Sparkles size={16} />
                  Proceed to Faculty Loading
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Issues State */}
      {needsManualResolution && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl border border-amber-200 bg-amber-50/50 p-6">
          <div className="flex flex-col gap-6">
            <div className="flex items-start gap-4">
              <AlertTriangle className="mt-1 flex-shrink-0 text-amber-600" size={24} />
              <div className="flex-1">
                <h3 className="font-bold text-amber-900">Manual Resolution Required</h3>
                <p className="mt-1 text-sm text-amber-800">The scheduler is not yet verified. You can still export or update Course Offering, but review the unresolved issues below first.</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <div className="rounded-xl border border-amber-200 bg-white/70 px-4 py-3 text-sm text-amber-900">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700">Fitness</div>
                    <div className="mt-1 text-2xl font-bold">{fitnessScore.toFixed(2)}%</div>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-white/70 px-4 py-3 text-sm text-amber-900">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700">Persistent Issues</div>
                    <div className="mt-1 text-2xl font-bold">{unresolvedCount}</div>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-white/70 px-4 py-3 text-sm text-amber-900">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-rose-700">GA Conflicts</div>
                    <div className="mt-1 text-2xl font-bold">{gaConflicts.length}</div>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-white/70 px-4 py-3 text-sm text-amber-900">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700">Decision</div>
                    <div className="mt-1 font-semibold">User verification required</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button onClick={() => onNavigate?.('subjects')} className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-white/80 px-4 py-2 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100">
                <BookOpen size={16} />
                Review Subjects
              </button>
              <button onClick={() => onNavigate?.('rooms')} className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-white/80 px-4 py-2 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100">
                <DoorOpen size={16} />
                Review Rooms
              </button>
            </div>

            {unresolvedCards.length > 0 ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {unresolvedCards.map((issue, idx) => (
                  <div key={`${issue.subject_id || issue.code || 'issue'}-${idx}`} className="rounded-2xl border border-amber-200/80 bg-white/75 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-on-surface">{issue.descriptive_title || issue.course_no || issue.code || 'Subject needs manual review'}</h4>
                        <p className="mt-1 text-xs text-on-surface-variant">
                          {[issue.code, issue.course_no, issue.section].filter(Boolean).join(' • ') || 'Unassigned subject'}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {issue.categories.map((category) => (
                          <span key={category} className="rounded-full border border-amber-200 bg-amber-100/80 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-800">
                            {category}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl bg-amber-50/80 p-3 text-sm text-amber-900">
                      <div className="font-semibold">Persistent issue</div>
                      <div className="mt-1 text-xs leading-5">
                        {Array.isArray(issue.reasons) && issue.reasons.length > 0
                          ? issue.reasons.join('; ')
                          : issue.reason || issue.problem || 'No detailed reason returned by the GA.'}
                      </div>
                    </div>

                    {/* Available rooms from the GA diagnosis */}
                    {Array.isArray(issue.available_rooms) && issue.available_rooms.length > 0 ? (
                      <div className="mt-3">
                        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">
                          Available Rooms ({issue.available_rooms.length})
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {issue.available_rooms.map((room) => (
                            <span key={room.room_id} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">
                              <DoorOpen size={11} />{room.room_name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : issue.rooms_exhausted === true ? (
                      <div className="mt-3 flex items-center gap-2 rounded-xl border border-error/20 bg-error-container/20 p-3 text-xs text-error">
                        <DoorOpen size={14} className="flex-shrink-0" />
                        <span>No available rooms — add more rooms to the system before rerunning.</span>
                      </div>
                    ) : null}

                    {/* Free time windows from the GA diagnosis */}
                    {Array.isArray(issue.available_time_slots) && issue.available_time_slots.length > 0 ? (
                      <div className="mt-3">
                        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">
                          Free Time Windows
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {issue.available_time_slots.map((slot) => (
                            <span key={slot.label} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                              <Clock3 size={11} />{slot.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : issue.section_blocked === true ? (
                      <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900">
                        <Clock3 size={14} className="flex-shrink-0" />
                        <span>Section is fully booked — manually reschedule another class in this section to free a slot.</span>
                      </div>
                    ) : null}

                    {/* Next-step action guidance */}
                    {issue.recommendations.length > 0 && (
                      <div className="mt-3 space-y-2 text-sm text-on-surface-variant">
                        {issue.recommendations.map((recommendation) => (
                          <div key={recommendation} className="flex items-start gap-2 rounded-xl bg-slate-50/80 p-3">
                            {recommendation.toLowerCase().includes('room') ? (
                              <DoorOpen size={15} className="mt-0.5 flex-shrink-0 text-slate-500" />
                            ) : recommendation.toLowerCase().includes('time') || recommendation.toLowerCase().includes('slot') || recommendation.toLowerCase().includes('reschedule') ? (
                              <Clock3 size={15} className="mt-0.5 flex-shrink-0 text-slate-500" />
                            ) : (
                              <AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-slate-500" />
                            )}
                            <span>{recommendation}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-white/70 p-4 text-sm text-amber-900">
                The fitness score is below 100 even though the GA did not return explicit unresolved items. Review subject times and room allocation manually, then rerun the scheduler.
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* GA Conflict Report */}
      {gaConflicts.length > 0 && (
        <div className="glass-panel rounded-2xl p-6">
          <SectionHeader
            title={`GA Conflict Report (${gaConflicts.length})`}
            subtitle="Subjects scheduled by the GA but still in hard conflict. These are the exact violations reducing the fitness score."
            action={null}
          />
          <div className="mt-4 space-y-3">
            {gaConflicts.map((c, idx) => {
              const isRoom = c.type === 'room_conflict';
              const isOverload = c.type === 'section_overload';
              const isGymExclusivity = c.type === 'gym_exclusivity';
              const isGymCapacity = c.type === 'gym_capacity';
              return (
                <div key={idx} className={`rounded-2xl border p-4 ${
                  isRoom
                    ? 'border-rose-200 bg-rose-50/60'
                    : isOverload
                    ? 'border-amber-200 bg-amber-50/60'
                    : isGymExclusivity || isGymCapacity
                    ? 'border-purple-200 bg-purple-50/60'
                    : 'border-orange-200 bg-orange-50/60'
                }`}>
                  <div className="flex items-start gap-3 flex-wrap">
                    <span className={`mt-0.5 flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${
                      isRoom
                        ? 'bg-rose-100 text-rose-700'
                        : isOverload
                        ? 'bg-amber-100 text-amber-700'
                        : isGymExclusivity
                        ? 'bg-purple-100 text-purple-700'
                        : isGymCapacity
                        ? 'bg-violet-100 text-violet-700'
                        : 'bg-orange-100 text-orange-700'
                    }`}>
                      {isRoom ? 'Room Conflict' : isOverload ? 'Daily Overload' : isGymExclusivity ? 'GYM Exclusivity' : isGymCapacity ? 'GYM Capacity' : 'Section Overlap'}
                    </span>
                    {c.day && <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 mt-1">{c.day}</span>}
                    {isRoom && c.room && (
                      <span className="text-[11px] font-semibold text-slate-500 mt-1">Room: {c.room}</span>
                    )}
                    {!isRoom && !isGymExclusivity && !isGymCapacity && c.section && (
                      <span className="text-[11px] font-semibold text-slate-500 mt-1">Section: {c.section}</span>
                    )}
                    {isOverload && c.total_hours != null && (
                      <span className="text-[11px] font-semibold text-amber-600 mt-1">{c.total_hours}h / 10h limit</span>
                    )}
                    {(isGymExclusivity || isGymCapacity) && c.room && (
                      <span className="text-[11px] font-semibold text-purple-600 mt-1">Room: {c.room}</span>
                    )}
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
        </div>
      )}

      {/* Issues Summary */}
      {Object.keys(groupedIssues).length > 0 && (
        <div className="glass-panel rounded-2xl p-6">
          <SectionHeader
            title="Pre-flight Issues"
            subtitle="Issues detected during data validation"
            action={null}
          />
          <div className="mt-4 space-y-4">
            {groupedIssues['high'] && (
              <div className="border-l-4 border-error bg-error-container/20 rounded p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={18} className="text-error" />
                  <h4 className="font-semibold text-error">High Severity Issues ({groupedIssues['high'].length})</h4>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {groupedIssues['high'].map((issue, idx) => (
                    <div key={idx} className="bg-white/60 rounded p-3 text-sm">
                      <div className="font-medium text-error/90">{issue.problem}</div>
                      <div className="text-on-surface-variant text-xs mt-1">
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
                  <AlertCircle size={18} className="text-amber-700" />
                  <h4 className="font-semibold text-amber-700">Medium Severity Issues ({groupedIssues['medium'].length})</h4>
                </div>
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {groupedIssues['medium'].map((issue, idx) => {
                    const text = issue.message || issue.description || issue.problem || issue.title || JSON.stringify(issue);
                    return (
                      <div key={idx} className="bg-white/60 rounded p-3 text-sm text-amber-900">
                        <div className="font-medium">{text}</div>
                        <div className="text-xs mt-1 text-on-surface-variant">
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
                <h4 className="font-semibold text-blue-700">Low Severity Issues ({groupedIssues['low'].length})</h4>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Schedule Data Table */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-white/50">
          <SectionHeader
            title="Automatic Scheduler Data"
            subtitle="Current schedule assignments and room allocations"
            action={null}
          />
        </div>
        <ScheduleTable
          rows={rows}
          loading={loadingRows}
          onExportClick={() => setShowExportModal(true)}
          onUpdateClick={() => { setUpdateModalStep('select'); setUpdateResult(null); setUpdateModalError(''); setShowUpdateModal(true); }}
          isDryRunRows={isDryRunRows}
        />
      </div>

      {/* Empty State */}
      {!result && (!Array.isArray(rows) || rows.length === 0) && !loadingRows && (
        <div className="glass-panel flex min-h-[400px] flex-col overflow-hidden">
          <div className="relative flex flex-1 flex-col items-center justify-center p-12 text-center">
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#4F46E5 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
            
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="relative z-10 max-w-lg"
            >
              <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl border border-white/60 bg-white/80 shadow-sm">
                <CalendarOff size={40} className="text-slate-400" />
              </div>
              <h4 className="mb-4 text-2xl font-bold text-on-surface">No Schedule Generated Yet</h4>
              <p className="mb-8 text-sm font-medium leading-relaxed text-on-surface-variant">
                The scheduling workspace is empty. Use the <span className="font-bold text-primary">Genetic Algorithm Engine</span> above to generate an optimized schedule based on your subjects and rooms.
              </p>
            </motion.div>
          </div>
        </div>
      )}

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

      {/* Update Modal */}
      {showUpdateModal && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <motion.div key={updateModalStep} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">

            {/* Step 1 — Select mode */}
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
                    className={`w-full rounded-xl border p-4 text-left transition-colors ${
                      updateMode === COURSE_OFFERING_UPDATE_MODES.BACKUP_THEN_UPDATE
                        ? 'border-primary bg-primary-container/20'
                        : 'border-outline-variant bg-slate-50/80 hover:bg-white'
                    }`}
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
                    className={`w-full rounded-xl border p-4 text-left transition-colors ${
                      updateMode === COURSE_OFFERING_UPDATE_MODES.UPDATE_NO_BACKUP
                        ? 'border-amber-300 bg-amber-50/80'
                        : 'border-outline-variant bg-slate-50/80 hover:bg-white'
                    }`}
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
                  <button onClick={closeUpdateModal} className="flex-1 rounded-lg border border-outline-variant px-4 py-2 font-semibold text-on-surface hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={() => setUpdateModalStep('confirm')}
                    disabled={isDryRunRows}
                    className="flex-1 rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
                  >
                    <ArrowRight size={16} />
                    Next
                  </button>
                </div>
              </>
            )}

            {/* Step 2 — Confirm */}
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
                  Selected: <span className="font-semibold text-on-surface">
                    {updateMode === COURSE_OFFERING_UPDATE_MODES.BACKUP_THEN_UPDATE ? 'Backup then update' : 'Update without backup'}
                  </span>
                </p>
                {updateModalError && (
                  <div className="mb-4 rounded-xl border border-error/30 bg-error-container/30 p-3 text-sm text-error flex items-start gap-2">
                    <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                    <span>{updateModalError}</span>
                  </div>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => { setUpdateModalStep('select'); setUpdateModalError(''); }}
                    className="flex-1 rounded-lg border border-outline-variant px-4 py-2 font-semibold text-on-surface hover:bg-gray-50 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleUpdateCourseOffering}
                    disabled={updating}
                    className="flex-1 rounded-lg bg-error px-4 py-2 font-semibold text-white hover:bg-error/90 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
                  >
                    {updating ? <RefreshCcw size={16} className="animate-spin" /> : <AlertTriangle size={16} />}
                    {updating ? 'Updating...' : 'Yes, Proceed'}
                  </button>
                </div>
              </>
            )}

            {/* Step 3 — Success */}
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
                  <button onClick={closeUpdateModal} className="flex-1 rounded-lg border border-outline-variant px-4 py-2 font-semibold text-on-surface hover:bg-gray-50 transition-colors">
                    Close
                  </button>
                  <button
                    onClick={() => { closeUpdateModal(); onNavigate?.('course-offering'); }}
                    className="flex-1 rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary/90 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <ArrowRight size={16} />
                    View Course Offerings
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
