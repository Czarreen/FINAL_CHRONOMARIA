import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  ArrowUpDown,
  BookOpen,
  Bolt,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  DoorOpen,
  FileWarning,
  Gauge,
  History,
  Play,
  RefreshCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Users,
  WandSparkles,
  X,
} from 'lucide-react';
import { fetchGaPreFlight, runFacultyLoading } from '../services/gaApi.js';
import { formatScheduleTimeDisplay, getScheduleAmPm } from '../utils/scheduleUtils.js';

const LAST_FACULTY_LOADING_RUN_KEY = 'facultyLoadingLastRun';
const LAST_FACULTY_LOADING_RESULT_KEY = 'facultyLoadingLastResult';
const GENERATED_LIST_PAGE_SIZE = 50;

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

function qualityFromFitness(score) {
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

function getSpecialDayOnlyScheduleLabel(mthSchedule, tfsSchedule) {
  const hasSat = (s) => /\bsat(urday)?\b/i.test(s || '');
  const hasWed = (s) => /\b(wed(nesday)?|w)\b/i.test(s || '');
  const hasAutomatedWeekday = (s) => /\b(mon|tue|thu|fri|mth|tfs)\b/i.test(s || '');
  const mthText = String(mthSchedule || '').trim();
  const tfsText = String(tfsSchedule || '').trim();
  if (!mthText && !tfsText) return null;
  const combinedText = `${mthText} ${tfsText}`.trim();
  if (hasSat(combinedText) && !hasAutomatedWeekday(combinedText)) return 'SAT';
  if (hasWed(combinedText) && !hasAutomatedWeekday(combinedText)) return 'WED';
  return null;
}

function isSatOnlySchedule(mthSchedule, tfsSchedule) {
  return getSpecialDayOnlyScheduleLabel(mthSchedule, tfsSchedule) === 'SAT';
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

function timestampForFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function humanizeField(field) {
  if (!field) return '';
  return String(field)
    .replace(/_id$/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function compactIssueText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\bcurr\s*:\s*\d+\b/gi, '')
    .replace(/\bofferings\s+(\d+)\s+/gi, 'offerings ')
    .replace(/\band\s+(\d+)\s+/gi, 'and ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function resolveIssuePage(issue) {
  if (!issue || typeof issue !== 'object') {
    return {
      page: 'Subjects',
      action: 'Open Subjects page and review the affected subject record.',
    };
  }

  if (issue.type === 'room' || issue.type === 'room_conflict' || issue.field === 'mth_room_id' || issue.field === 'tfs_room_id' || issue.field === 'room_name') {
    return {
      page: 'Rooms',
      action: 'Open Rooms page, search this room, then fix room status, room data, or conflicting time usage.',
    };
  }

  if (issue.type === 'faculty' || issue.type === 'cross_reference' || issue.field === 'faculty_status' || issue.field === 'faculty_name' || issue.field === 'faculty_max_units') {
    return {
      page: 'Faculty',
      action: 'Open Faculty page, check active faculty and max units for this department, then update assignments or faculty availability.',
    };
  }

  return {
    page: 'Subjects',
    action: 'Open Subjects page, search this subject, and complete schedule, units, hours, and room references.',
  };
}

function formatIssueForDisplay(issue) {
  const fallbackName = issue?.type === 'room_conflict'
    ? (issue?.room_label || `Room ${issue?.id || ''}`.trim())
    : issue?.type === 'cross_reference'
      ? issue?.department_name || issue?.entity_label || `Department ${issue?.id || ''}`.trim()
      : issue?.type === 'faculty'
        ? issue?.entity_label || `Faculty ${issue?.id || ''}`.trim()
        : issue?.entity_label || `Subject ${issue?.id || ''}`.trim();

  const issueText = compactIssueText(issue?.problem || issue?.message || issue?.description || 'Issue requires manual review.');
  const location = resolveIssuePage(issue);
  const meta = [issue?.type, humanizeField(issue?.field), issue?.department_name].filter(Boolean).join(' • ');

  return {
    name: fallbackName,
    issueText,
    page: location.page,
    action: location.action,
    meta,
  };
}

function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function downloadGeneratedListCsv(filename, rows) {
  const headers = [
    'section',
    'course_code',
    'course_no',
    'descriptive_title',
    'units',
    'mth_schedule',
    'mth_ampm',
    'tfs_schedule',
    'tfs_ampm',
    'department',
    'faculty',
    'merged',
    'status',
  ];

  const csvRows = rows.map((item) => ({
    section: item.section || '-',
    course_code: item.code || '-',
    course_no: item.course_no || '-',
    descriptive_title: item.descriptive_title || '-',
    units: item.units ?? '-',
    mth_schedule: formatScheduleTimeDisplay(item.mth_schedule) || '-',
    mth_ampm: getScheduleAmPm(item.mth_schedule) || '-',
    tfs_schedule: formatScheduleTimeDisplay(item.tfs_schedule) || '-',
    tfs_ampm: getScheduleAmPm(item.tfs_schedule) || '-',
    department: item.department_name || 'Unassigned department',
    faculty: item.faculty_name || '-',
    merged: item.merged ? 'Merged' : '',
    status: item.load_status?.replace(/_/g, ' ') || '-',
  }));

  const lines = [headers.join(',')];
  for (const row of csvRows) {
    lines.push(headers.map((header) => escapeCsvCell(row[header])).join(','));
  }

  const csv = lines.join('\r\n');
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

export default function FacultyLoadingView() {
  const [preflight, setPreflight] = useState(null);
  const [result, setResult] = useState(null);
  const [loadingPreflight, setLoadingPreflight] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [lastRunSummary, setLastRunSummary] = useState(null);
  const [filterText, setFilterText] = useState('');
  const [filterColumn, setFilterColumn] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'section', direction: 'asc' });
  const [generatedListPage, setGeneratedListPage] = useState(1);
  const [generatedListPageInput, setGeneratedListPageInput] = useState(1);

  const columns = [
    { key: 'section', label: 'Section' },
    { key: 'code', label: 'Course Code' },
    { key: 'course_no', label: 'Course No' },
    { key: 'descriptive_title', label: 'Descriptive Title' },
    { key: 'units', label: 'Units' },
    { key: 'mth_schedule', label: 'MTH' },
    { key: 'tfs_schedule', label: 'TFS' },
    { key: 'department_name', label: 'Department' },
    { key: 'faculty_name', label: 'Faculty' },
    { key: 'merged', label: 'Merged' },
    { key: 'load_status', label: 'Status' },
  ];

  async function loadPreflight() {
    try {
      setLoadingPreflight(true);
      setError('');
      const payload = await fetchGaPreFlight();
      setPreflight(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load GA pre-flight data.');
      setPreflight(null);
    } finally {
      setLoadingPreflight(false);
    }
  }

  useEffect(() => {
    loadPreflight();
    const raw = localStorage.getItem(LAST_FACULTY_LOADING_RUN_KEY);
    if (raw) {
      try {
        setLastRunSummary(JSON.parse(raw));
      } catch {
        setLastRunSummary(null);
      }
    }

    const lastResultRaw = localStorage.getItem(LAST_FACULTY_LOADING_RESULT_KEY);
    if (lastResultRaw) {
      try {
        setResult(JSON.parse(lastResultRaw));
      } catch {
        setResult(null);
      }
    }
  }, []);

  const issues = preflight?.issues || [];
  const highIssues = issues.filter((issue) => issue.severity === 'high').length;
  const mediumIssues = issues.filter((issue) => issue.severity === 'medium').length;
  const lowIssues = issues.filter((issue) => issue.severity === 'low').length;
  const facultyCount = preflight?.faculty_count || 0;
  const offeringCount = preflight?.offering_count || 0;
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
      const response = await runFacultyLoading({ dryRun });
      setResult(response);

      const fitness = Number(response?.fitness_overall || 0);
      const summary = {
        generatedAt: formatDateTimeStandard(new Date()),
        quality: qualityFromFitness(fitness),
        fitness,
        assignments: response?.assignments?.length || 0,
        persisted: response?.persistence?.persisted ?? 0,
        runId: response?.run_id || 'n/a',
        dryRun,
      };
      setLastRunSummary(summary);
      localStorage.setItem(LAST_FACULTY_LOADING_RUN_KEY, JSON.stringify(summary));
      localStorage.setItem(LAST_FACULTY_LOADING_RESULT_KEY, JSON.stringify(response));
      await loadPreflight();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Faculty loading run failed.');
    } finally {
      setRunning(false);
    }
  }

  const groupedIssues = issues.reduce((acc, issue) => {
    const bucket = issue.severity || 'low';
    if (!acc[bucket]) acc[bucket] = [];
    acc[bucket].push(issue);
    return acc;
  }, {});

  const hasFacultyLoadingResult = result !== null;
  const runQuality = qualityFromFitness(Number(result?.fitness_overall || 0));
  const runQualityClass = qualityTone(runQuality);
  const generatedRows = result?.report?.generated_rows || result?.assignments || preflight?.faculty_loading || [];
  const unresolved_offerings = result?.report?.unresolved_offerings || [];
  const problematicOfferings = [
    ...(Array.isArray(result?.report?.problematic_offerings) ? result.report.problematic_offerings : []),
    ...(Array.isArray(preflight?.problematic_offerings) ? preflight.problematic_offerings : []),
  ];
  const issueSubjects = (() => {
    const fromProblematic = problematicOfferings.map((item) => ({
      ...item,
      load_status: item.load_status || 'needs_attention',
      issue_reasons: item.issue_reasons || item.reasons || [],
    }));

    const fromGenerated = generatedRows
      .filter((row) => row.load_status === 'needs_attention' || row.load_status === 'unassigned')
      .map((row) => ({
        ...row,
        issue_reasons: row.issue_reasons || row.reasons || [],
      }));

    const unique = new Map();
    for (const row of [...fromProblematic, ...fromGenerated]) {
      const reasonKey = Array.isArray(row.issue_reasons) ? row.issue_reasons.join('|') : '';
      const key = `${row.id || 'na'}-${row.code || ''}-${row.course_no || ''}-${row.section || ''}-${reasonKey}`;
      if (!unique.has(key)) unique.set(key, row);
    }

    return Array.from(unique.values());
  })();
  const facultyWithFreeUnits = result?.report?.faculty_free_units || result?.report?.faculty_with_free_units || [];
  const loadBalance = result?.report?.faculty_load_balance || preflight?.faculty_load_balance || [];

  function dedupeFacultyRows(rows) {
    const seen = new Map();
    const fallback = [];
    for (const row of rows) {
      const facultyId = Number(row?.faculty_id);
      if (Number.isFinite(facultyId) && facultyId !== 0) {
        if (!seen.has(facultyId)) seen.set(facultyId, row);
      } else {
        fallback.push(row);
      }
    }
    return [...seen.values(), ...fallback];
  }

  function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const uniqueFacultyWithFreeUnits = [...dedupeFacultyRows(facultyWithFreeUnits)].sort((left, right) => toNumber(right.free_units) - toNumber(left.free_units));

  const deptUnitsSummary = useMemo(() => {
    const map = new Map();
    for (const row of dedupeFacultyRows(loadBalance)) {
      const deptName = row.department_name || 'Unassigned';
      const deptKey = row.department_id ?? deptName;
      if (!map.has(deptKey)) {
        map.set(deptKey, { department_name: deptName, used_units: 0, max_units: 0, faculty_count: 0 });
      }
      const entry = map.get(deptKey);
      entry.used_units += toNumber(row.total_units);
      entry.max_units += toNumber(row.max_units);
      entry.faculty_count += 1;
    }
    return [...map.values()].sort((a, b) => a.department_name.localeCompare(b.department_name));
  }, [loadBalance]);

  const uniqueLoadBalance = [...dedupeFacultyRows(loadBalance)].sort((left, right) => {
    const delta = toNumber(right.imbalance_score) - toNumber(left.imbalance_score);
    if (delta !== 0) return delta;
    return toNumber(right.total_units) - toNumber(left.total_units);
  });

  function handleSort(key) {
    setSortConfig((currentSort) => ({
      key,
      direction: currentSort.key === key && currentSort.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  const filteredAndSortedRows = useMemo(() => {
    let filtered = [...generatedRows];

    // Apply filter
    if (filterText) {
      const searchLower = filterText.toLowerCase();
      filtered = filtered.filter((row) => {
        if (filterColumn === 'all') {
          return columns.some((col) => {
            const value = String(row[col.key] || '').toLowerCase();
            return value.includes(searchLower);
          });
        } else {
          const value = String(row[filterColumn] || '').toLowerCase();
          return value.includes(searchLower);
        }
      });
    }

    // Apply sort
    const directionMultiplier = sortConfig.direction === 'asc' ? 1 : -1;
    filtered.sort((left, right) => {
      let leftValue = left[sortConfig.key];
      let rightValue = right[sortConfig.key];

      if (sortConfig.key === 'units') {
        leftValue = Number(leftValue || 0);
        rightValue = Number(rightValue || 0);
        return (leftValue - rightValue) * directionMultiplier;
      }

      leftValue = String(leftValue || '');
      rightValue = String(rightValue || '');
      return leftValue.localeCompare(rightValue, undefined, { sensitivity: 'base' }) * directionMultiplier;
    });

    return filtered;
  }, [generatedRows, filterText, filterColumn, sortConfig]);

  const totalGeneratedPages = Math.ceil(filteredAndSortedRows.length / GENERATED_LIST_PAGE_SIZE);
  const startRowNum = filteredAndSortedRows.length === 0 ? 0 : (generatedListPage - 1) * GENERATED_LIST_PAGE_SIZE + 1;
  const endRowNum = Math.min(generatedListPage * GENERATED_LIST_PAGE_SIZE, filteredAndSortedRows.length);

  const paginatedRows = useMemo(() => {
    const start = (generatedListPage - 1) * GENERATED_LIST_PAGE_SIZE;
    const end = start + GENERATED_LIST_PAGE_SIZE;
    return filteredAndSortedRows.slice(start, end);
  }, [filteredAndSortedRows, generatedListPage]);

  useEffect(() => {
    setGeneratedListPageInput(generatedListPage);
  }, [generatedListPage]);

  const applyGeneratedListPageInput = () => {
    const nextPage = Number(generatedListPageInput);
    if (Number.isInteger(nextPage) && nextPage >= 1 && nextPage <= totalGeneratedPages) {
      setGeneratedListPage(nextPage);
    } else {
      setGeneratedListPageInput(generatedListPage);
    }
  };

  function handleExportGeneratedListCsv() {
    if (!generatedRows.length) return;
    downloadGeneratedListCsv(`faculty_loading_generated_list_${timestampForFileName()}.csv`, generatedRows);
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-[28px] border border-white/70 bg-white/70 p-6 shadow-[0_30px_50px_rgba(75,42,184,0.08)] backdrop-blur-xl md:p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-container/15 via-transparent to-secondary/10" />
        <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-secondary/10 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary-container/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.3em] text-primary">
            <Sparkles size={14} /> Faculty Loading GA
          </div>
          <h2 className="mt-3 text-4xl font-headline-xl font-extrabold tracking-tight text-on-surface md:text-5xl">Faculty Loading Generation</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-on-surface-variant md:text-base">Runs are validated with pre-flight checks before GA execution.</p>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-6">
        <SectionHeader
          title="Generation Controls"
          subtitle="Check readiness, review active profile, and run the GA."
          action={<div className="flex items-center gap-2 rounded-full bg-primary-container/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-primary"><Users size={14} /> Live snapshot</div>}
        />

        <div className="mt-6 space-y-5">
          {!loadingPreflight && preflight?.status === 'blocked' ? (
            <div className="rounded-2xl border border-error/20 bg-error-container/35 p-4 text-sm text-error">Data is incomplete. Resolve pre-flight issues before generating faculty loading.</div>
          ) : null}

          {!loadingPreflight && preflight?.status === 'partial' ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">Some offerings still need attention, but GA can proceed with the loadable rows.</div>
          ) : null}

          {!loadingPreflight && preflight?.status !== 'blocked' ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900">Data is ready. You can run GA preview or persist to faculty_loading.</div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Faculty Loaded" value={String(facultyCount)} icon={Users} tone="primary" />
            <StatCard label="Offerings Loaded" value={String(offeringCount)} icon={BookOpen} tone="primary" />
            <StatCard label="Rooms Loaded" value={String(roomCount)} icon={DoorOpen} tone="primary" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={handleRun} disabled={running || loadingPreflight} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-on-primary shadow-lg shadow-primary/20 transition-all hover:-translate-y-0.5 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
              {running ? <RefreshCcw size={16} className="animate-spin" /> : <Play size={16} />}
              {dryRun ? 'Run Dry Preview' : 'Run Faculty Loading'}
            </button>
            <button onClick={() => setDryRun((value) => !value)} className="inline-flex items-center gap-2 rounded-xl border border-outline-variant bg-white/80 px-4 py-3 text-sm font-semibold text-on-surface transition-colors hover:bg-white">
              <ShieldAlert size={16} />
              {dryRun ? 'Dry run enabled' : 'Dry run disabled'}
            </button>
            <button onClick={loadPreflight} className="inline-flex items-center gap-2 rounded-xl border border-outline-variant bg-white/80 px-4 py-3 text-sm font-semibold text-on-surface transition-colors hover:bg-white">
              <RefreshCcw size={16} /> Refresh checks
            </button>
            <div className="inline-flex items-center gap-2 rounded-xl border border-white/60 bg-white/80 px-4 py-3 text-sm text-on-surface-variant">
              <Gauge size={16} />
              Status: <span className={`font-bold ${statusTone === 'danger' ? 'text-error' : statusTone === 'warning' ? 'text-amber-700' : 'text-emerald-700'}`}>{statusLabel}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-6">
        <SectionHeader title="Latest Run Snapshot" subtitle="Quick summary of the most recent execution." action={<div className="rounded-full bg-secondary-container/20 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-secondary">History</div>} />
        {!lastRunSummary ? (
          <div className="mt-6 rounded-2xl border border-dashed border-outline-variant/60 bg-white/60 p-6 text-sm text-on-surface-variant">No previous run yet.</div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-white/60 bg-white/80 p-4"><p className="text-xs uppercase tracking-[0.22em] text-on-surface-variant flex items-center gap-1"><History size={14} /> Generated At</p><p className="mt-2 font-semibold text-on-surface">{lastRunSummary.generatedAt}</p></div>
            <div className="rounded-xl border border-white/60 bg-white/80 p-4"><p className="text-xs uppercase tracking-[0.22em] text-on-surface-variant flex items-center gap-1"><WandSparkles size={14} /> Quality</p><p className="mt-2 font-semibold text-on-surface">{lastRunSummary.quality}</p></div>
            <div className="rounded-xl border border-white/60 bg-white/80 p-4"><p className="text-xs uppercase tracking-[0.22em] text-on-surface-variant flex items-center gap-1"><Bolt size={14} /> Fitness</p><p className="mt-2 font-semibold text-on-surface">{lastRunSummary.fitness ?? '-'}</p></div>
            <div className="rounded-xl border border-white/60 bg-white/80 p-4"><p className="text-xs uppercase tracking-[0.22em] text-on-surface-variant">Assignments</p><p className="mt-2 font-semibold text-on-surface">{lastRunSummary.assignments ?? '-'}</p></div>
            <div className="rounded-xl border border-white/60 bg-white/80 p-4"><p className="text-xs uppercase tracking-[0.22em] text-on-surface-variant">Persisted</p><p className="mt-2 font-semibold text-on-surface">{lastRunSummary.persisted ?? '-'}</p></div>
            <div className="rounded-xl border border-white/60 bg-white/80 p-4"><p className="text-xs uppercase tracking-[0.22em] text-on-surface-variant">Run ID</p><p className="mt-2 truncate font-semibold text-on-surface">{lastRunSummary.runId || '-'}</p></div>
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="glass-panel rounded-2xl p-6">
          <SectionHeader title="Quality & Readiness Report" subtitle="Old-page inspired report panel, mapped to current GA payload." action={<div className="rounded-full bg-primary-container/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-primary">Report</div>} />
          <div className="mt-6 space-y-4">
            {hasFacultyLoadingResult ? (
              <div className={`rounded-2xl border p-4 ${runQualityClass}`}>
                <p className="text-xs font-bold uppercase tracking-[0.22em]">Quality of generated list</p>
                <h4 className="mt-1 text-xl font-bold">{runQuality}</h4>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                  <p>Overall: <strong>{result?.fitness_overall ?? 0}</strong></p>
                  <p>Hard: <strong>{result?.fitness_hard ?? 0}</strong></p>
                  <p>Soft: <strong>{result?.fitness_soft ?? 0}</strong></p>
                  <p>Persisted: <strong>{result?.persistence?.persisted ?? 0}</strong></p>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="High issues" value={String(highIssues)} icon={AlertCircle} tone="danger" />
              <StatCard label="Medium issues" value={String(mediumIssues)} icon={Clock3} tone="warning" />
              <StatCard label="Low issues" value={String(lowIssues)} icon={CheckCircle2} tone="success" />
            </div>

            <div className="mt-4 rounded-xl border border-white/60 bg-white/80 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface">Issue Rows + Full Issue Report</h4>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-error-container/40 px-2 py-1 text-xs font-bold text-error">Rows: {issueSubjects.length}</span>
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">Total issues: {issues.length}</span>
                </div>
              </div>

              <div className="mt-3 space-y-4">
                <div className="w-full rounded-lg border border-white/60 bg-white p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">Full issue report</p>
                  <div className="mt-3 max-h-[28rem] space-y-3 overflow-y-auto pr-1">
                    {['high', 'medium', 'low'].map((severity) => {
                      const items = groupedIssues[severity] || [];
                      if (!items.length) return null;
                      return (
                        <div key={severity}>
                          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">{severity} ({items.length})</p>
                          <div className="mt-2 space-y-2">
                            {items.map((issue, idx) => {
                              const display = formatIssueForDisplay(issue);
                              return (
                                <div key={`${severity}-${idx}`} className="rounded-lg border border-white/60 bg-white p-2.5 text-xs">
                                  <p className="font-semibold text-on-surface flex items-center gap-1.5"><FileWarning size={12} /> {display.name}</p>
                                  <p className="mt-1 text-on-surface-variant leading-5">{display.issueText}</p>
                                  <p className="mt-1 text-[11px] font-semibold text-primary">Fix in: {display.page}</p>
                                  <p className="mt-1 uppercase tracking-[0.16em] text-on-surface-variant">{display.meta}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="w-full rounded-lg border border-error/15 bg-error-container/15 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">Issue rows</p>
                  <div className="mt-3 max-h-[24rem] space-y-2 overflow-y-auto pr-1">
                    {issueSubjects.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-outline-variant/60 bg-white/60 p-3 text-sm text-on-surface-variant">No issue rows reported.</p>
                    ) : (
                      issueSubjects.slice(0, 30).map((item, idx) => (
                        <div key={`issue-${idx}`} className="rounded-lg border border-error/15 bg-white p-2.5 text-xs">
                          <p className="font-semibold text-on-surface">{item.display_label || item.descriptive_title || item.title || item.code || 'Subject'}</p>
                          <p className="mt-1 uppercase tracking-[0.16em] text-on-surface-variant leading-5">{item.code || '-'} • {item.course_no || '-'} • {item.department_name || 'Unassigned department'} • {item.load_status || 'unassigned'}</p>
                          {item.issue_reasons?.length ? <p className="mt-1 text-error">{item.issue_reasons.join(' | ')}</p> : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        <div>
          <div className="glass-panel rounded-2xl p-6">
            <SectionHeader
              title="Faculty Capacity Overview"
              subtitle="Department Unit Capacity, Faculty Load Balance, and Faculty with Free Units in one block."
              action={
                <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/80 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-on-surface-variant">
                  {deptUnitsSummary.length} dept(s)
                </div>
              }
            />

            <div className="mt-4 rounded-xl border border-white/60 bg-white/80 p-3.5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface">Department Unit Capacity</p>
              <p className="mt-1 text-xs text-on-surface-variant">Combined used vs. max units across all faculty per department after loading.</p>
              {deptUnitsSummary.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-outline-variant/60 bg-white/60 p-3 text-sm text-on-surface-variant">Run GA to see department unit usage.</div>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  {deptUnitsSummary.map((dept, idx) => {
                    const pct = dept.max_units > 0 ? Math.min(100, (dept.used_units / dept.max_units) * 100) : 0;
                    const barColor = pct >= 95 ? 'bg-error/70' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500/70';
                    const textColor = pct >= 95 ? 'text-error' : pct >= 80 ? 'text-amber-700' : 'text-emerald-700';
                    return (
                      <div key={`dept-${idx}`} className="rounded-xl border border-white/60 bg-white p-3">
                        <p className="text-sm font-bold text-on-surface truncate" title={dept.department_name}>{dept.department_name}</p>
                        <p className="mt-1 text-xs text-on-surface-variant">{dept.faculty_count} faculty member{dept.faculty_count !== 1 ? 's' : ''}</p>
                        <div className="mt-3 flex items-end justify-between gap-2">
                          <span className={`text-lg font-extrabold ${textColor}`}>{dept.used_units}</span>
                          <span className="text-xs text-on-surface-variant">/ {dept.max_units} max units</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/70">
                          <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${Math.max(4, pct)}%` }} />
                        </div>
                        <p className={`mt-1 text-right text-xs font-semibold ${textColor}`}>{pct.toFixed(0)}% used</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-4 rounded-xl border border-white/60 bg-white/80 p-3.5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface">Faculty Load Balance</p>
              <p className="mt-1 text-xs text-on-surface-variant">Sorted by imbalance so the most uneven loads appear first.</p>
              <div className="mt-3 max-h-[260px] space-y-2 overflow-y-auto pr-1">
                {uniqueLoadBalance.slice(0, 16).map((row, idx) => (
                  <div key={`balance-${row.faculty_id || idx}`} className="rounded-xl border border-white/60 bg-white p-3">
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <p className="font-semibold text-on-surface">{row.faculty_name || `Faculty ${row.faculty_id || idx + 1}`}</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-on-surface-variant">{row.faculty_role || 'N/A'} • {row.department_name || row.department_id || 'Unassigned department'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-on-surface-variant">{row.total_units ?? 0}/{row.max_units ?? 0} units</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-on-surface-variant">imbalance {row.imbalance_score ?? 0}</p>
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
                      <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(6, Math.min(100, (toNumber(row.total_units) / Math.max(1, toNumber(row.max_units))) * 100))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/60 bg-white/80 p-3.5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface">Faculty with Free Units</p>
              <p className="mt-1 text-xs text-on-surface-variant">Faculty still below max capacity, sorted by remaining units.</p>
              <div className="mt-3 max-h-[230px] space-y-2 overflow-y-auto pr-1">
                {uniqueFacultyWithFreeUnits.length === 0 ? (
                  <p className="rounded-xl border border-white/60 bg-white p-3 text-sm text-on-surface-variant">No free-unit report available.</p>
                ) : (
                  uniqueFacultyWithFreeUnits.slice(0, 20).map((row, idx) => (
                    <div key={`free-${idx}`} className="rounded-xl border border-white/60 bg-white p-3">
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <div>
                          <p className="font-semibold text-on-surface">{row.faculty_name || row.name || `Faculty ${row.faculty_id || idx + 1}`}</p>
                          <p className="text-xs uppercase tracking-[0.18em] text-on-surface-variant">{row.faculty_role || 'N/A'} • {row.department_name || row.department_id || 'Unassigned department'}</p>
                        </div>
                        <p className="text-on-surface-variant">{row.free_units ?? 0} free</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-6">
        <SectionHeader
          title="Generated Faculty Loading List"
          subtitle="Old master-list concept adapted to current result assignments."
          action={(
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/80 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-on-surface-variant">
                {generatedRows.length} row(s)
              </div>
              <button
                onClick={handleExportGeneratedListCsv}
                disabled={!generatedRows.length}
                className="inline-flex items-center gap-2 rounded-xl border border-outline-variant bg-white/80 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-on-surface transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download size={14} />
                Export CSV
              </button>
            </div>
          )}
        />
        {!generatedRows.length ? (
          <div className="mt-6 rounded-2xl border border-dashed border-outline-variant/60 bg-white/60 p-6 text-sm text-on-surface-variant">No generated list yet. Run GA to populate assignments.</div>
        ) : (
          <>
            {/* Search and Filter Controls */}
            <div className="mt-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex gap-3 flex-1 xl:max-w-sm">
                <select
                  value={filterColumn}
                  onChange={(e) => setFilterColumn(e.target.value)}
                  aria-label="Search column"
                  className="rounded-lg border border-white/30 bg-white/50 px-3 py-2 text-sm text-on-surface-variant outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white min-h-[44px]"
                >
                  <option value="all">All cols</option>
                  {columns.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
                <div className="relative flex-1">
                  <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                  <input
                    type="text"
                    placeholder={`Search ${filterColumn === 'all' ? 'all columns' : columns.find(c => c.key === filterColumn)?.label || filterColumn}...`}
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    aria-label="Search generated list"
                    className="w-full rounded-lg border border-white/30 bg-white/50 py-2 pl-10 pr-10 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white focus:shadow-lg min-h-[44px]"
                  />
                  {filterText && (
                    <button
                      onClick={() => setFilterText('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                      title="Clear search"
                      aria-label="Clear search"
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
              </div>
              <div className="text-xs text-on-surface-variant">{startRowNum}-{endRowNum} / {filteredAndSortedRows.length}</div>
            </div>

            {/* Data Table */}
            <div className="mt-6 overflow-hidden rounded-2xl border border-white/60 bg-white/80">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-primary-container/20 text-on-surface sticky top-0 z-10">
                    <tr>
                      {columns.map((col) => (
                        <th key={col.key} className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleSort(col.key)}
                            className={`flex items-center justify-start gap-1 text-xs font-bold uppercase tracking-[0.28em] transition-colors ${
                              sortConfig.key === col.key ? 'text-primary' : 'text-on-surface-variant/70 hover:text-on-surface'
                            }`}
                            aria-pressed={sortConfig.key === col.key ? 'true' : 'false'}
                          >
                            <span>{col.label}</span>
                            <ArrowUpDown size={12} />
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length} className="px-4 py-4 text-center text-xs text-on-surface-variant">No rows match your search.</td>
                      </tr>
                    ) : (
                      paginatedRows.map((item, index) => {
                        const specialDayLabel = getSpecialDayOnlyScheduleLabel(item.mth_schedule, item.tfs_schedule);
                        return (
                        <tr key={`assignment-${index}`} className="border-t border-white/60">
                          <td className="px-4 py-3 text-on-surface">{item.section || '-'}</td>
                          <td className="px-4 py-3 text-on-surface">{item.code || '-'}</td>
                          <td className="px-4 py-3 text-on-surface">{item.course_no || '-'}</td>
                          <td className="px-4 py-3 text-on-surface">{item.descriptive_title || '-'}</td>
                          <td className="px-4 py-3 text-on-surface">{item.units ?? '-'}</td>
                          <td className="px-4 py-3 text-on-surface-variant">
                            <span className="inline-flex items-center gap-1 text-xs">
                              {formatScheduleTimeDisplay(item.mth_schedule) || '-'}
                              {getScheduleAmPm(item.mth_schedule) && (
                                <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${getScheduleAmPm(item.mth_schedule) === 'AM' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {getScheduleAmPm(item.mth_schedule)}
                                </span>
                              )}
                              {item.mth_schedule && specialDayLabel && (
                                <span
                                  className="px-1 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700"
                                  title={`${specialDayLabel}-only — assign manually`}
                                >
                                  {specialDayLabel}
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-on-surface-variant">
                            <span className="inline-flex items-center gap-1 text-xs">
                              {formatScheduleTimeDisplay(item.tfs_schedule) || '-'}
                              {getScheduleAmPm(item.tfs_schedule) && (
                                <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${getScheduleAmPm(item.tfs_schedule) === 'AM' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {getScheduleAmPm(item.tfs_schedule)}
                                </span>
                              )}
                              {item.tfs_schedule && specialDayLabel && (
                                <span
                                  className="px-1 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700"
                                  title={`${specialDayLabel}-only — assign manually`}
                                >
                                  {specialDayLabel}
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-on-surface">{item.department_name || 'Unassigned department'}</td>
                          <td className="px-4 py-3 text-on-surface">
                            {item.faculty_name || (
                              specialDayLabel
                                ? <span className="text-xs text-purple-600 font-medium">Manual ({specialDayLabel})</span>
                                : '-'
                            )}
                          </td>
                          <td className="px-4 py-3 text-on-surface-variant">{item.merged ? 'Merged' : ''}</td>
                          <td className="px-4 py-3 text-on-surface-variant capitalize">{item.load_status?.replace(/_/g, ' ') || '-'}</td>
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination Controls */}
            {filteredAndSortedRows.length > 0 && (
              <div className="mt-4 flex flex-col gap-4 rounded-lg border border-white/60 bg-white/80 p-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="text-xs text-on-surface-variant">
                  {startRowNum}-{endRowNum} / {filteredAndSortedRows.length}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => setGeneratedListPage((p) => Math.max(1, p - 1))}
                    disabled={generatedListPage === 1}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-white/80 px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <ChevronLeft size={14} />
                    <span>Prev</span>
                  </button>
                  <div className="flex items-center gap-2">
                    <label htmlFor="gen-list-page-input" className="text-xs font-semibold text-on-surface-variant uppercase tracking-[0.1em]">Page</label>
                    <input
                      id="gen-list-page-input"
                      type="number"
                      min="1"
                      max={totalGeneratedPages}
                      value={generatedListPageInput}
                      onChange={(e) => setGeneratedListPageInput(e.target.value)}
                      onBlur={applyGeneratedListPageInput}
                      onKeyDown={(e) => e.key === 'Enter' && applyGeneratedListPageInput()}
                      className="w-12 rounded border border-white/60 bg-white/80 px-2 py-1 text-center text-xs font-semibold text-on-surface outline-none transition-all hover:bg-white focus:border-primary focus:bg-white"
                    />
                    <span className="text-xs text-on-surface-variant font-semibold">of {totalGeneratedPages}</span>
                  </div>
                  <button
                    onClick={() => setGeneratedListPage((p) => Math.min(totalGeneratedPages, p + 1))}
                    disabled={generatedListPage === totalGeneratedPages}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-white/80 px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span>Next</span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="glass-panel rounded-2xl p-6">
        <SectionHeader title="Unassigned Subjects" subtitle="Subjects that could not be assigned to faculty. Review reasons and recommendations for resolution." />
        {unresolved_offerings.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-outline-variant/60 bg-white/60 p-6 text-sm text-on-surface-variant">
            All offerings were successfully assigned or marked as general subjects.
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {unresolved_offerings.map((item, idx) => (
              <div key={`unresolved-${idx}`} className="rounded-xl border border-error/15 bg-error-container/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="font-semibold text-on-surface">
                      {item.code || 'N/A'} {item.course_no ? `(${item.course_no})` : ''} - Section {item.section || 'N/A'}
                    </p>
                    <p className="mt-1 text-sm text-on-surface-variant">{item.descriptive_title || 'No title'}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-on-surface-variant">Department: {item.department_name || 'Unassigned department'}</p>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-error">Reason: {item.reason || 'Unknown'}</p>
                  </div>
                </div>
                {item.recommendations && item.recommendations.length > 0 ? (
                  <div className="mt-3 rounded-lg bg-white/50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-on-surface-variant mb-2">Recommendations:</p>
                    <ul className="space-y-1 text-xs text-on-surface-variant">
                      {item.recommendations.map((rec, recIdx) => (
                        <li key={recIdx} className="flex gap-2">
                          <span className="mt-0.5 text-primary">→</span>
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/60 bg-white/80 p-4 text-sm text-on-surface-variant">
        <div className="flex items-center justify-between gap-3">
          <span>{preflight?.suggested_next_step || 'Loading checks...'}</span>
          <ArrowRight size={16} className="shrink-0" />
        </div>
      </div>

      {error ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-error/20 bg-error-container/40 p-4 text-sm text-error">
          {error}
        </motion.div>
      ) : null}

      {/* Full-screen Faculty Loading Overlay — freezes all interaction while running */}
      {running && (
        <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-white/20 bg-white/10 p-8 text-white shadow-2xl">
            {/* Spinner */}
            <div className="relative h-16 w-16">
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-white/20 border-t-white" />
              <div className="absolute inset-2 animate-spin rounded-full border-4 border-white/10 border-t-white/60" style={{ animationDirection: 'reverse', animationDuration: '0.8s' }} />
            </div>

            <div className="space-y-1.5 text-center">
              <p className="text-lg font-bold tracking-tight">
                {dryRun ? 'Running Dry Run…' : 'Running Faculty Loading…'}
              </p>
              <p className="text-sm text-white/70">
                {dryRun
                  ? 'Testing the GA configuration. Please wait.'
                  : 'Processing assignments and persisting to database. Please wait.'}
              </p>
              <p className="text-xs text-white/50">Do not close or refresh this page.</p>
            </div>

            {!dryRun && (
              <div className="w-full rounded-lg border border-orange-300/30 bg-orange-500/20 px-4 py-2.5 text-center text-xs text-orange-200">
                Live run: assignments will be persisted to the database.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
