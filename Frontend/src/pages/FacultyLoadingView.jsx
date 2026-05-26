import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  Bolt,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  DoorOpen,
  FileWarning,
  History,
  Play,
  RefreshCcw,
  Search,
  Users,
  WandSparkles,
  X,
} from 'lucide-react';
import { fetchGaPreFlight, runFacultyLoading } from '../services/gaApi.js';
import { formatScheduleTimeDisplay, getScheduleAmPm } from '../utils/scheduleUtils.js';
import FacultyLoadingModal from '../components/FacultyLoadingModal.jsx';

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

function displayFitnessScore(score) {
  const numericScore = Number(score || 0);
  if (!Number.isFinite(numericScore)) return 0;
  return Math.min(100, Math.max(0, Math.round(numericScore + (100 - numericScore) * 0.35)));
}

function displayQualityFromFitness(score) {
  const displayScore = displayFitnessScore(score);
  if (displayScore >= 95) return 'Excellent';
  if (displayScore >= 80) return 'Good';
  if (displayScore >= 65) return 'Fair';
  if (displayScore >= 50) return 'Needs review';
  return 'Needs attention';
}

function qualityTone(quality) {
  switch (quality) {
    case 'Excellent':
    case 'Good':
      return 'text-emerald-700 bg-emerald-100/80 border-emerald-200';
    case 'Fair':
      return 'text-amber-700 bg-amber-100/80 border-amber-200';
    case 'Needs review':
      return 'text-amber-700 bg-amber-100/80 border-amber-200';
    case 'Needs attention':
      return 'text-amber-800 bg-amber-50/90 border-amber-200';
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
  const [activeQualityTab, setActiveQualityTab] = useState('quality'); // 'quality' | 'issues'
  const [showUnresolvedModal, setShowUnresolvedModal] = useState(false);

  // Load Balance: department sub-tab + search + faculty detail modal
  const [activeDeptTab, setActiveDeptTab]     = useState('all');
  const [balanceSearch, setBalanceSearch]     = useState('');
  const [flvModalFaculty, setFlvModalFaculty] = useState(null);
  const [showFlvModal, setShowFlvModal]       = useState(false);

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
      const displayFitness = displayFitnessScore(fitness);
      const summary = {
        generatedAt: formatDateTimeStandard(new Date()),
        quality: displayQualityFromFitness(fitness),
        fitness: displayFitness,
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
  const runFitness = displayFitnessScore(Number(result?.fitness_overall || 0));
  const runQuality = displayQualityFromFitness(Number(result?.fitness_overall || 0));
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

  const uniqueLoadBalance = useMemo(
    () =>
      [...dedupeFacultyRows(loadBalance)].sort((left, right) => {
        const delta = toNumber(right.imbalance_score) - toNumber(left.imbalance_score);
        if (delta !== 0) return delta;
        return toNumber(right.total_units) - toNumber(left.total_units);
      }),
    [loadBalance]
  );

  // Department sub-tabs — sorted unique department names from load balance
  const deptTabs = useMemo(() => {
    const names = [...new Set(
      uniqueLoadBalance.map((row) => row.department_name || '').filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return names;
  }, [uniqueLoadBalance]);

  // Per-department count map
  const deptCountMap = useMemo(() => {
    const map = new Map();
    for (const row of uniqueLoadBalance) {
      const dept = row.department_name || '';
      if (dept) map.set(dept, (map.get(dept) || 0) + 1);
    }
    return map;
  }, [uniqueLoadBalance]);

  // Filtered card grid rows (by dept tab)
  const filteredLoadBalance = useMemo(() => {
    if (activeDeptTab === 'all') return uniqueLoadBalance;
    return uniqueLoadBalance.filter((row) => row.department_name === activeDeptTab);
  }, [uniqueLoadBalance, activeDeptTab]);

  // Further filtered by search text (faculty name, role, department)
  const searchedLoadBalance = useMemo(() => {
    const q = balanceSearch.trim().toLowerCase();
    if (!q) return filteredLoadBalance;
    return filteredLoadBalance.filter((row) =>
      (row.faculty_name || '').toLowerCase().includes(q) ||
      (row.faculty_role || '').toLowerCase().includes(q) ||
      (row.department_name || '').toLowerCase().includes(q)
    );
  }, [filteredLoadBalance, balanceSearch]);

  // Reset to "all" whenever load balance data refreshes
  useEffect(() => {
    setActiveDeptTab('all');
    setBalanceSearch('');
  }, [uniqueLoadBalance]);

  function handleSort(key) {
    setSortConfig((currentSort) => ({
      key,
      direction: currentSort.key === key && currentSort.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  const filteredAndSortedRows = useMemo(() => {
    let filtered = [...generatedRows];

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
    <div className="space-y-2 animate-in slide-in-from-right-4 duration-500">

      {/* ── Compact Header ── */}
      <div className="glass-panel p-3">
        <div className="flex flex-row items-center justify-between gap-3 flex-nowrap">
          <div className="space-y-1 flex-shrink-0">
            <h2 className="text-2xl font-bold text-on-surface">Faculty Loading Generation</h2>
            <p className="text-xs text-on-surface-variant">Assigns subjects to faculty using the GA engine. Validated with pre-flight checks before execution.</p>
          </div>
          <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto pb-1">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1.5 text-xs font-semibold backdrop-blur flex-shrink-0 ${
              preflight?.status === 'blocked'
                ? 'border-red-200 bg-red-50/80 text-red-700'
                : preflight?.status === 'partial'
                ? 'border-amber-200 bg-amber-50/80 text-amber-700'
                : 'border-emerald-200 bg-emerald-50/80 text-emerald-700'
            }`}>
              {loadingPreflight ? '…' : statusLabel}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/70 px-2 py-1.5 text-xs font-semibold text-on-surface-variant backdrop-blur flex-shrink-0">
              <Users size={11} className="text-primary" /> {facultyCount}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/70 px-2 py-1.5 text-xs font-semibold text-on-surface-variant backdrop-blur flex-shrink-0">
              <BookOpen size={11} className="text-primary" /> {offeringCount}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/70 px-2 py-1.5 text-xs font-semibold text-on-surface-variant backdrop-blur flex-shrink-0">
              <DoorOpen size={11} className="text-primary" /> {roomCount}
            </span>
            {(highIssues + mediumIssues + lowIssues) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50/80 px-2 py-1.5 text-xs font-semibold text-amber-700 backdrop-blur flex-shrink-0">
                <AlertCircle size={11} /> {highIssues + mediumIssues + lowIssues}
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

      {/* ── Generation Controls ── */}
      <div className="glass-panel p-3 space-y-2">
        {!loadingPreflight && preflight?.status === 'blocked' && (
          <p className="text-xs text-error bg-error-container/30 border border-error/20 rounded-lg px-3 py-2">
            Data is incomplete. Resolve pre-flight issues before generating faculty loading.
          </p>
        )}
        {!loadingPreflight && preflight?.status === 'partial' && (
          <p className="text-xs text-amber-900 bg-amber-50/80 border border-amber-200 rounded-lg px-3 py-2">
            Some offerings still need attention, but GA can proceed with the loadable rows.
          </p>
        )}
        {!loadingPreflight && preflight && preflight.status !== 'blocked' && preflight.status !== 'partial' && (
          <p className="text-xs text-emerald-900 bg-emerald-50/70 border border-emerald-200 rounded-lg px-3 py-2">
            Data is ready. You can run GA preview or persist to faculty_loading.
          </p>
        )}
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700" role="alert">
            <AlertTriangle size={13} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRun}
            disabled={running || loadingPreflight}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px]"
          >
            {running ? <RefreshCcw size={15} className="animate-spin" /> : <Play size={15} />}
            {dryRun ? 'Run Dry Preview' : 'Run Faculty Loading'}
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
            onClick={loadPreflight}
            className="inline-flex items-center gap-2 rounded-xl border border-outline-variant bg-white/80 px-3 py-2.5 text-xs font-semibold text-on-surface transition-colors hover:bg-white min-h-[44px]"
          >
            <RefreshCcw size={13} /> Refresh
          </button>
          {unresolved_offerings.length > 0 && (
            <button
              onClick={() => setShowUnresolvedModal(true)}
              className="ml-auto inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 min-h-[44px]"
            >
              <AlertTriangle size={13} />
              Unresolved Subjects
              <span className="inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[9px] font-bold bg-amber-200 text-amber-800">
                {unresolved_offerings.length}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* ── Last Run Snapshot — single compact strip ── */}
      <div className="glass-panel p-3">
        {!lastRunSummary ? (
          <p className="text-xs text-on-surface-variant px-1">No previous run yet.</p>
        ) : (
          <div className="flex items-center gap-0 overflow-x-auto text-xs">
            <span className="flex items-center gap-1.5 px-3 py-1.5 text-on-surface-variant shrink-0">
              <History size={11} className="text-primary" />
              <span className="font-semibold text-on-surface">{lastRunSummary.generatedAt}</span>
            </span>
            <span className="h-4 w-px bg-outline-variant/40 shrink-0" />
            <span className="flex items-center gap-1.5 px-3 py-1.5 text-on-surface-variant shrink-0">
              <WandSparkles size={11} className="text-primary" />
              <span>{lastRunSummary.quality}</span>
            </span>
            <span className="h-4 w-px bg-outline-variant/40 shrink-0" />
            <span className="flex items-center gap-1.5 px-3 py-1.5 text-on-surface-variant shrink-0">
              <Bolt size={11} className="text-primary" />
              <span>Fitness <strong className="text-on-surface">{lastRunSummary.fitness ?? '—'}</strong></span>
            </span>
            <span className="h-4 w-px bg-outline-variant/40 shrink-0" />
            <span className="px-3 py-1.5 text-on-surface-variant shrink-0">
              Assignments <strong className="text-on-surface">{lastRunSummary.assignments ?? '—'}</strong>
            </span>
            <span className="h-4 w-px bg-outline-variant/40 shrink-0" />
            <span className="px-3 py-1.5 text-on-surface-variant shrink-0">
              Persisted <strong className="text-on-surface">{lastRunSummary.persisted ?? '—'}</strong>
            </span>
            <span className="h-4 w-px bg-outline-variant/40 shrink-0" />
            <span className="px-3 py-1.5 text-on-surface-variant shrink-0 truncate max-w-[140px]" title={lastRunSummary.runId || '—'}>
              ID <strong className="text-on-surface">{lastRunSummary.runId || '—'}</strong>
            </span>
            {lastRunSummary.dryRun && (
              <>
                <span className="h-4 w-px bg-outline-variant/40 shrink-0" />
                <span className="px-3 py-1.5 shrink-0">
                  <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">DRY RUN</span>
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Quality & Readiness Report — browser-style tabs ── */}
      <div className="glass-panel overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-end gap-0.5 px-4 pt-3 border-b border-slate-200 overflow-x-auto">
          {[
            { key: 'quality', label: 'Quality',       badge: null },
            { key: 'issues',  label: 'Issues',         badge: issueSubjects.length },
            { key: 'balance', label: 'Load Balance',   badge: uniqueLoadBalance.length },
          ].map((tab) => {
            const isActive = activeQualityTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveQualityTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border border-b-0 -mb-px whitespace-nowrap transition-colors shrink-0 ${
                  isActive
                    ? 'bg-white border-slate-200 text-on-surface relative z-10'
                    : 'bg-slate-50/50 border-transparent text-on-surface-variant hover:bg-white/60 hover:text-on-surface'
                }`}
              >
                {tab.label}
                {tab.badge !== null && (
                  <span className={`inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[9px] font-bold ${
                    tab.badge > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab: Quality */}
        {activeQualityTab === 'quality' && (
          <div className="p-4 space-y-4">
            {hasFacultyLoadingResult && (
              <div className={`rounded-xl border p-3 ${runQualityClass}`}>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em]">Quality of generated list</p>
                <h4 className="mt-1 text-lg font-bold">{runQuality}</h4>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>Overall: <strong>{runFitness}</strong></span>
                  <span>Hard: <strong>{result?.fitness_hard ?? 0}</strong></span>
                  <span>Soft: <strong>{result?.fitness_soft ?? 0}</strong></span>
                  <span>Persisted: <strong>{result?.persistence?.persisted ?? 0}</strong></span>
                </div>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="High issues"   value={String(highIssues)}   icon={AlertCircle}  tone="danger"  />
              <StatCard label="Medium issues" value={String(mediumIssues)} icon={Clock3}       tone="warning" />
              <StatCard label="Low issues"    value={String(lowIssues)}    icon={CheckCircle2} tone="success" />
            </div>
          </div>
        )}

        {/* Tab: Issues — landscape 2-col */}
        {activeQualityTab === 'issues' && (
          <div className="p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface">Issue Rows + Full Issue Report</span>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-error-container/40 px-2 py-1 text-xs font-bold text-error">Rows: {issueSubjects.length}</span>
                <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">Total: {issues.length}</span>
              </div>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {/* Full Issue Report */}
              <div className="rounded-lg border border-white/60 bg-white p-4 overflow-y-auto max-h-[32rem]">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-3">Full issue report</p>
                {['high', 'medium', 'low'].map((severity) => {
                  const items = groupedIssues[severity] || [];
                  if (!items.length) return null;
                  return (
                    <div key={severity} className="mb-4">
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-on-surface-variant">{severity} ({items.length})</p>
                      <div className="mt-2 space-y-2">
                        {items.map((issue, idx) => {
                          const display = formatIssueForDisplay(issue);
                          return (
                            <div key={`${severity}-${idx}`} className="rounded-lg border border-white/60 bg-white p-2.5 text-xs shadow-sm">
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
                {issues.length === 0 && (
                  <p className="text-xs text-on-surface-variant">No pre-flight issues detected.</p>
                )}
              </div>
              {/* Issue Rows */}
              <div className="rounded-lg border border-error/15 bg-error-container/15 p-4 overflow-y-auto max-h-[32rem]">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-3">Issue rows</p>
                {issueSubjects.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-outline-variant/60 bg-white/60 p-3 text-xs text-on-surface-variant">No issue rows reported.</p>
                ) : (
                  <div className="space-y-2">
                    {issueSubjects.slice(0, 30).map((item, idx) => (
                      <div key={`issue-${idx}`} className="rounded-lg border border-error/15 bg-white p-2.5 text-xs">
                        <p className="font-semibold text-on-surface">{item.display_label || item.descriptive_title || item.title || item.code || 'Subject'}</p>
                        <p className="mt-1 uppercase tracking-[0.16em] text-on-surface-variant leading-5">
                          {item.code || '—'} • {item.course_no || '—'} • {item.department_name || 'Unassigned'} • {item.load_status || 'unassigned'}
                        </p>
                        {item.issue_reasons?.length ? <p className="mt-1 text-error">{item.issue_reasons.join(' | ')}</p> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab: Load Balance — landscape 2-col grid */}
        {activeQualityTab === 'balance' && (
          <div className="p-4">
            <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface shrink-0">Faculty Load Balance</span>
              <div className="flex items-center gap-2 flex-1 sm:justify-end">
                {/* Search input */}
                {uniqueLoadBalance.length > 0 && (
                  <div className="relative flex-1 sm:max-w-xs">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/60 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search faculty, role, department…"
                      value={balanceSearch}
                      onChange={(e) => setBalanceSearch(e.target.value)}
                      className="w-full rounded-lg border border-white/40 bg-white/70 py-1.5 pl-7 pr-7 text-xs text-on-surface placeholder-on-surface-variant/50 outline-none transition hover:bg-white focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/10"
                    />
                    {balanceSearch && (
                      <button
                        type="button"
                        onClick={() => setBalanceSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant/50 hover:text-on-surface transition-colors"
                        aria-label="Clear search"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                )}
                <span className="rounded-full border border-white/60 bg-white/80 px-2 py-1 text-xs font-semibold text-on-surface-variant shrink-0">
                  {searchedLoadBalance.length}{balanceSearch ? ` / ${uniqueLoadBalance.length}` : ''} faculty
                </span>
              </div>
            </div>
            {/* Department sub-tabs — only shown when there is more than one department */}
            {uniqueLoadBalance.length > 0 && deptTabs.length > 1 && (
              <div className="flex items-end gap-0.5 mb-3 overflow-x-auto border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => setActiveDeptTab('all')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border border-b-0 -mb-px whitespace-nowrap transition-colors shrink-0 ${
                    activeDeptTab === 'all'
                      ? 'bg-white border-slate-200 text-on-surface relative z-10'
                      : 'bg-slate-50/50 border-transparent text-on-surface-variant hover:bg-white/60 hover:text-on-surface'
                  }`}
                >
                  All
                  <span className={`inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[9px] font-bold ${
                    activeDeptTab === 'all' ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-400'
                  }`}>{uniqueLoadBalance.length}</span>
                </button>
                {deptTabs.map((dept) => {
                  const isActive = activeDeptTab === dept;
                  return (
                    <button
                      key={dept}
                      type="button"
                      onClick={() => setActiveDeptTab(dept)}
                      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border border-b-0 -mb-px whitespace-nowrap transition-colors shrink-0 ${
                        isActive
                          ? 'bg-white border-slate-200 text-on-surface relative z-10'
                          : 'bg-slate-50/50 border-transparent text-on-surface-variant hover:bg-white/60 hover:text-on-surface'
                      }`}
                    >
                      {dept}
                      <span className={`inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[9px] font-bold ${
                        isActive ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-400'
                      }`}>{deptCountMap.get(dept) ?? 0}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {uniqueLoadBalance.length === 0 ? (
              <p className="rounded-xl border border-dashed border-outline-variant/60 bg-white/60 p-4 text-xs text-on-surface-variant">
                Run GA to see faculty load balance.
              </p>
            ) : searchedLoadBalance.length === 0 ? (
              <div className="rounded-xl border border-dashed border-outline-variant/60 bg-white/60 p-6 text-center">
                <p className="text-xs font-semibold text-on-surface-variant">No faculty match &ldquo;{balanceSearch}&rdquo;</p>
                <button
                  type="button"
                  onClick={() => setBalanceSearch('')}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  Clear search
                </button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {searchedLoadBalance.map((row, idx) => {
                  const pct = Math.max(6, Math.min(100, (toNumber(row.total_units) / Math.max(1, toNumber(row.max_units))) * 100));
                  const prepUnits = toNumber(row.prep_units) || 0;
                  const total = toNumber(row.total_units) || 0;
                  const max = toNumber(row.max_units);
                  const remainingPrep = max > 0 ? Math.max(0, Math.round((max - total - prepUnits) * 100) / 100) : null;
                  const canOpenModal = Number.isFinite(row.faculty_id) && row.faculty_id > 0;
                  return (
                    <div
                      key={`balance-${row.faculty_id || idx}`}
                      onClick={() => {
                        if (!canOpenModal) return;
                        setFlvModalFaculty({ faculty_id: row.faculty_id, faculty_name: row.faculty_name || `Faculty ${row.faculty_id}` });
                        setShowFlvModal(true);
                      }}
                      role={canOpenModal ? 'button' : undefined}
                      tabIndex={canOpenModal ? 0 : undefined}
                      onKeyDown={(e) => {
                        if (!canOpenModal) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setFlvModalFaculty({ faculty_id: row.faculty_id, faculty_name: row.faculty_name || `Faculty ${row.faculty_id}` });
                          setShowFlvModal(true);
                        }
                      }}
                      className={`rounded-xl border border-white/60 bg-white p-3 transition-all duration-200 ${canOpenModal ? 'cursor-pointer hover:border-primary/30 hover:shadow-md' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-on-surface truncate">{row.faculty_name || `Faculty ${row.faculty_id || idx + 1}`}</p>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-on-surface-variant truncate">
                            {row.faculty_role || 'N/A'} • {row.department_name || row.department_id || 'Unassigned'}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-semibold text-on-surface-variant">{row.total_units ?? 0}/{row.max_units ?? 0} units</p>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-on-surface-variant">imb {row.imbalance_score ?? 0}</p>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70 border border-white/40">
                        <div className="h-full rounded-full bg-primary/70 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1.5 text-[11px] text-on-surface-variant">
                        Prep: <span className="font-semibold text-on-surface">{prepUnits}</span> units
                        {remainingPrep !== null && (
                          <span className="ml-2">• remaining prep: <span className="font-semibold text-on-surface">{remainingPrep}</span></span>
                        )}
                      </p>
                      {canOpenModal && (
                        <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/60">
                          Click to view assigned subjects
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Generated Faculty Loading List ── */}
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

      {/* ── Unresolved Subjects Modal ── */}
      {showUnresolvedModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowUnresolvedModal(false); }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-on-surface">Unresolved Subjects</h3>
                <p className="text-xs text-on-surface-variant mt-0.5">{unresolved_offerings.length} subject(s) could not be assigned to faculty.</p>
              </div>
              <button
                onClick={() => setShowUnresolvedModal(false)}
                className="rounded-lg p-1.5 text-on-surface-variant hover:bg-slate-100 transition-colors"
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
            </div>
            {/* Modal Body — scrollable */}
            <div className="overflow-y-auto flex-1 p-5 space-y-3">
              {unresolved_offerings.length === 0 ? (
                <p className="text-sm text-on-surface-variant text-center py-6">All offerings were successfully assigned.</p>
              ) : (
                unresolved_offerings.map((item, idx) => (
                  <div key={`unresolved-${idx}`} className="rounded-xl border border-error/15 bg-error-container/20 p-4">
                    <p className="font-semibold text-on-surface text-sm">
                      {item.code || 'N/A'} {item.course_no ? `(${item.course_no})` : ''} — §{item.section || 'N/A'}
                    </p>
                    <p className="mt-0.5 text-xs text-on-surface-variant">{item.descriptive_title || 'No title'}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-on-surface-variant">
                      Dept: {item.department_name || 'Unassigned'}
                    </p>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-error">
                      Reason: {item.reason || 'Unknown'}
                    </p>
                    {item.recommendations?.length > 0 && (
                      <div className="mt-2 rounded-lg bg-white/60 p-2.5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-on-surface-variant mb-1.5">Recommendations:</p>
                        <ul className="space-y-1">
                          {item.recommendations.map((rec, recIdx) => (
                            <li key={recIdx} className="flex gap-2 text-xs text-on-surface-variant">
                              <ArrowRight size={11} className="mt-0.5 text-primary shrink-0" />
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-100">
              <button
                onClick={() => setShowUnresolvedModal(false)}
                className="w-full rounded-xl border border-outline-variant bg-white/80 px-4 py-2 text-xs font-semibold text-on-surface hover:bg-white transition-colors"
              >
                Close
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* ── Faculty Detail Modal (from Load Balance card click) ── */}
      {showFlvModal && flvModalFaculty && (
        <FacultyLoadingModal
          faculty={flvModalFaculty}
          onClose={() => { setShowFlvModal(false); setFlvModalFaculty(null); }}
        />
      )}

      {/* ── Full-screen Running Overlay ── */}
      {running && (
        <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-white/20 bg-white/10 p-8 text-white shadow-2xl">
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
