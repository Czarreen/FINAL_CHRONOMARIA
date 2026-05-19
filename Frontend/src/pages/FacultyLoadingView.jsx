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
  ShieldAlert,
  Sparkles,
  Users,
  WandSparkles,
} from 'lucide-react';
import { fetchGaPreFlight, runFacultyLoading } from '../services/gaApi.js';
import { formatScheduleTimeDisplay, getScheduleAmPm } from '../utils/scheduleUtils.js';

const LAST_FACULTY_LOADING_RUN_KEY = 'facultyLoadingLastRun';

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
  const generatedRows = result?.report?.generated_rows || result?.assignments || [];
  const generalSubjects = generatedRows.filter((row) => row.load_status === 'general');
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
  const uniqueLoadBalance = [...dedupeFacultyRows(loadBalance)].sort((left, right) => {
    const delta = toNumber(right.imbalance_score) - toNumber(left.imbalance_score);
    if (delta !== 0) return delta;
    return toNumber(right.total_units) - toNumber(left.total_units);
  });

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

            <details className="rounded-2xl border border-white/60 bg-white/80 p-4">
              <summary className="cursor-pointer text-sm font-bold uppercase tracking-[0.22em] text-on-surface">Show full issue report</summary>
              <div className="mt-4 space-y-4">
                {['high', 'medium', 'low'].map((severity) => {
                  const items = groupedIssues[severity] || [];
                  if (!items.length) return null;
                  return (
                    <div key={severity}>
                      <p className="text-xs font-bold uppercase tracking-[0.22em] text-on-surface-variant">{severity} ({items.length})</p>
                      <div className="mt-2 space-y-2">
                        {items.map((issue, idx) => (
                          <div key={`${severity}-${idx}`} className="rounded-xl border border-white/60 bg-white p-3 text-sm">
                            <p className="font-semibold text-on-surface flex items-center gap-2"><FileWarning size={14} /> {issue.entity_label || issue.problem}</p>
                            <p className="mt-1 text-sm text-on-surface-variant">{issue.problem}</p>
                            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-on-surface-variant">{issue.type}{issue.field ? ` • ${issue.field}` : ''}{issue.department_name ? ` • ${issue.department_name}` : ''}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-panel rounded-2xl p-6">
            <SectionHeader title="Faculty with Free Units" subtitle="Faculty still below max capacity, sorted by remaining units." />
            <div className="mt-4 max-h-[230px] space-y-3 overflow-y-auto pr-1">
              {uniqueFacultyWithFreeUnits.length === 0 ? (
                <p className="rounded-xl border border-white/60 bg-white/80 p-3 text-sm text-on-surface-variant">No free-unit report available.</p>
              ) : (
                uniqueFacultyWithFreeUnits.slice(0, 20).map((row, idx) => (
                  <div key={`free-${idx}`} className="rounded-xl border border-white/60 bg-white/80 p-3">
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

          <div className="glass-panel rounded-2xl p-6">
            <SectionHeader title="Faculty Load Balance" subtitle="Sorted by imbalance so the most uneven loads appear first." />
            <div className="mt-4 max-h-[260px] space-y-3 overflow-y-auto pr-1">
              {uniqueLoadBalance.slice(0, 16).map((row, idx) => (
                <div key={`balance-${row.faculty_id || idx}`} className="rounded-xl border border-white/60 bg-white/80 p-3">
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
          <div className="mt-6 overflow-hidden rounded-2xl border border-white/60 bg-white/80">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-primary-container/20 text-on-surface">
                  <tr>
                    <th className="px-4 py-3 font-bold uppercase tracking-[0.16em] text-xs">Section</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-[0.16em] text-xs">Course Code</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-[0.16em] text-xs">Course No</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-[0.16em] text-xs">Descriptive Title</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-[0.16em] text-xs">Units</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-[0.16em] text-xs">MTH</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-[0.16em] text-xs">TFS</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-[0.16em] text-xs">Department</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-[0.16em] text-xs">Faculty</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-[0.16em] text-xs">Merged</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-[0.16em] text-xs">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {generatedRows.map((item, index) => (
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
                        </span>
                      </td>
                      <td className="px-4 py-3 text-on-surface">{item.department_name || 'Unassigned department'}</td>
                      <td className="px-4 py-3 text-on-surface">{item.faculty_name || '-'}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{item.merged ? 'Merged' : ''}</td>
                      <td className="px-4 py-3 text-on-surface-variant capitalize">{item.load_status?.replace(/_/g, ' ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="glass-panel rounded-2xl p-6">
        <SectionHeader title="Subject Coverage" subtitle="General subjects are included but intentionally left without faculty. Issue rows still need resolution." />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/60 bg-white/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-bold uppercase tracking-[0.22em] text-on-surface">General Subjects</h4>
              <span className="rounded-full bg-primary-container/20 px-2 py-1 text-xs font-bold text-primary">{generalSubjects.length}</span>
            </div>
            <p className="mt-2 text-xs text-on-surface-variant">Included in the generated list without faculty assignment by design.</p>
            <div className="mt-4 max-h-[230px] space-y-2 overflow-y-auto pr-1">
              {generalSubjects.length === 0 ? (
                <p className="rounded-xl border border-dashed border-outline-variant/60 bg-white/60 p-3 text-sm text-on-surface-variant">No general subjects reported.</p>
              ) : (
                generalSubjects.slice(0, 20).map((item, idx) => (
                  <div key={`general-${idx}`} className="rounded-xl border border-primary/10 bg-primary-container/10 p-3 text-sm">
                    <p className="font-semibold text-on-surface">{item.display_label || item.descriptive_title || item.title || item.code || 'Subject'}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-on-surface-variant">{item.code || '-'} • {item.course_no || '-'} • {item.department_name || 'Unassigned department'}</p>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">General</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/60 bg-white/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-bold uppercase tracking-[0.22em] text-on-surface">Issue Rows</h4>
              <span className="rounded-full bg-error-container/40 px-2 py-1 text-xs font-bold text-error">{issueSubjects.length}</span>
            </div>
            <p className="mt-2 text-xs text-on-surface-variant">These still need attention before they can be treated as normal loading rows.</p>
            <div className="mt-4 max-h-[230px] space-y-2 overflow-y-auto pr-1">
              {issueSubjects.length === 0 ? (
                <p className="rounded-xl border border-dashed border-outline-variant/60 bg-white/60 p-3 text-sm text-on-surface-variant">No issue rows reported.</p>
              ) : (
                issueSubjects.slice(0, 20).map((item, idx) => (
                  <div key={`issue-${idx}`} className="rounded-xl border border-error/15 bg-error-container/20 p-3 text-sm">
                    <p className="font-semibold text-on-surface">{item.display_label || item.descriptive_title || item.title || item.code || 'Subject'}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-on-surface-variant">{item.code || '-'} • {item.course_no || '-'} • {item.department_name || 'Unassigned department'} • {item.load_status || 'unassigned'}</p>
                    {item.issue_reasons?.length ? <p className="mt-2 text-xs text-error">{item.issue_reasons.join(' | ')}</p> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
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
    </div>
  );
}
