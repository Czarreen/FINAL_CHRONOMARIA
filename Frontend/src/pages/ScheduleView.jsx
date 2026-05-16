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

const LAST_SCHEDULER_RUN_KEY = 'automaticSchedulerLastRun';

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

function ScheduleTable({ rows, loading }) {
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
      <table className="w-full text-sm">
        <thead className="bg-white/60 border-b border-white/50">
          <tr>
            <th className="px-4 py-3 text-left font-bold text-on-surface">Code</th>
            <th className="px-4 py-3 text-left font-bold text-on-surface">Course No.</th>
            <th className="px-4 py-3 text-left font-bold text-on-surface">Section</th>
            <th className="px-4 py-3 text-left font-bold text-on-surface">Title</th>
            <th className="px-4 py-3 text-left font-bold text-on-surface">Lec Hrs</th>
            <th className="px-4 py-3 text-left font-bold text-on-surface">Lab Hrs</th>
            <th className="px-4 py-3 text-left font-bold text-on-surface">MTH Schedule</th>
            <th className="px-4 py-3 text-left font-bold text-on-surface">MTH Room</th>
            <th className="px-4 py-3 text-left font-bold text-on-surface">TFS Schedule</th>
            <th className="px-4 py-3 text-left font-bold text-on-surface">TFS Room</th>
            <th className="px-4 py-3 text-left font-bold text-on-surface">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-b border-white/30 hover:bg-white/40 transition-colors">
              <td className="px-4 py-3 text-on-surface font-medium">{row.code || '—'}</td>
              <td className="px-4 py-3 text-on-surface">{row.course_no || '—'}</td>
              <td className="px-4 py-3 text-on-surface">{row.section || '—'}</td>
              <td className="px-4 py-3 text-on-surface max-w-xs truncate" title={row.descriptive_title}>{row.descriptive_title || '—'}</td>
              <td className="px-4 py-3 text-on-surface">{row.lec_hrs || '—'}</td>
              <td className="px-4 py-3 text-on-surface">{row.lab_hrs || '—'}</td>
              <td className="px-4 py-3 text-on-surface text-xs">{row.mth_schedule || '—'}</td>
              <td className="px-4 py-3 text-on-surface text-xs">{row.mth_room_id || '—'}</td>
              <td className="px-4 py-3 text-on-surface text-xs">{row.tfs_schedule || '—'}</td>
              <td className="px-4 py-3 text-on-surface text-xs">{row.tfs_room_id || '—'}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-1 rounded text-xs font-semibold ${row.merged ? 'bg-blue-100/80 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                  {row.merged ? 'Merged' : 'New'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ScheduleView() {
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
  const [backupEnabled, setBackupEnabled] = useState(true);

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
      // Ensure we always have an array
      const rowsArray = Array.isArray(data) ? data : (data?.rows && Array.isArray(data.rows) ? data.rows : []);
      setRows(rowsArray);
    } catch (err) {
      console.error('Failed to load scheduler rows:', err);
      setRows([]);
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
      const response = await runAutomaticScheduler({ dryRun });
      setResult(response);

      const fitness = Number(response?.fitness_overall || 0);
      const summary = {
        generatedAt: formatDateTimeStandard(new Date()),
        quality: fitnessToQuality(fitness),
        fitness,
        schedulesGenerated: response?.schedules_generated || 0,
        conflictsResolved: response?.conflicts_resolved || 0,
        runId: response?.run_id || 'n/a',
        dryRun,
      };
      setLastRunSummary(summary);
      localStorage.setItem(LAST_SCHEDULER_RUN_KEY, JSON.stringify(summary));
      await loadPreflight();
      await loadRows();
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
      const data = await exportAutomaticSchedulerRows();
      // Trigger download
      const element = document.createElement('a');
      element.setAttribute('href', 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2)));
      element.setAttribute('download', 'schedule_export.json');
      element.style.display = 'none';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      setShowExportModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  async function handleUpdateCourseOffering() {
    try {
      setUpdating(true);
      setError('');
      const response = await updateCourseOfferingFromScheduler({ backup: backupEnabled });
      // Show success
      alert(`Course offerings updated successfully! ${response?.persisted || 0} rows persisted.`);
      setShowUpdateModal(false);
      await loadPreflight();
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setUpdating(false);
    }
  }

  const unresolvedList = result?.unresolved || result?.unresolved_issues || result?.report?.unresolved_issues || [];
  const unresolvedCount = Array.isArray(unresolvedList) ? unresolvedList.length : 0;
  const hasConflicts = unresolvedCount > 0 || (result && Number(result.fitness_overall || 0) < 100);
  const isFixed = result && Number(result.fitness_overall || 0) >= 95 && unresolvedCount === 0;

  const groupedIssues = issues.reduce((acc, issue) => {
    const bucket = issue.severity || 'low';
    if (!acc[bucket]) acc[bucket] = [];
    acc[bucket].push(issue);
    return acc;
  }, {});

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
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-on-surface-variant">Conflicts Resolved</p>
              <p className="mt-2 text-2xl font-bold text-on-surface">{lastRunSummary.conflictsResolved}</p>
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
              <p className="mt-1 text-sm text-emerald-800">No conflicts detected. Fitness score indicates optimal or near-optimal schedule.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button onClick={() => setShowExportModal(true)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors">
                  <Download size={16} />
                  Export Only
                </button>
                <button onClick={() => setShowUpdateModal(true)} className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-600 hover:bg-emerald-50 transition-colors">
                  <ArrowRight size={16} />
                  Update Course Offering
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Issues State */}
      {hasConflicts && !isFixed && result && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl p-6 border border-amber-200 bg-amber-50/50">
          <div className="flex items-start gap-4">
            <AlertTriangle className="text-amber-600 flex-shrink-0 mt-1" size={24} />
            <div className="flex-1">
              <h3 className="font-bold text-amber-900">Schedule Has Conflicts</h3>
              <p className="mt-1 text-sm text-amber-800">The GA detected conflicts that need manual review and adjustment.</p>
              {Array.isArray(unresolvedList) && unresolvedList.length > 0 && (
                <div className="mt-4 space-y-2">
                  {unresolvedList.slice(0, 8).map((issue, idx) => (
                    <div key={idx} className="text-sm text-amber-700 bg-white/50 rounded p-3">
                      <div><strong>{issue.descriptive_title || issue.course_no || issue.code || 'Subject'}</strong> {issue.section ? `(${issue.section})` : ''}</div>
                      <div className="text-xs mt-1"><strong>Reason:</strong> {Array.isArray(issue.reasons) ? issue.reasons.join('; ') : issue.reasons || issue.reason || issue.problem}</div>
                      {issue.suggestions && <div className="text-xs mt-1"><strong>Suggestion:</strong> {issue.suggestions.room_conflict || issue.suggestions.time_conflict}</div>}
                    </div>
                  ))}
                  {unresolvedList.length > 8 && <div className="text-sm text-amber-700">+{unresolvedList.length - 8} more unresolved items...</div>}
                </div>
              )}
            </div>
          </div>
        </motion.div>
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
                  {groupedIssues['medium'].slice(0, 10).map((issue, idx) => {
                    const text = issue.message || issue.description || issue.problem || issue.title || JSON.stringify(issue);
                    const subjectId = issue.source_subject_id || issue.entity_id || issue.subject_id || issue.id;
                    return (
                      <div key={idx} className="bg-white/60 rounded p-3 text-sm text-amber-900 flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="font-medium">{text}</div>
                          <div className="text-xs mt-1 text-on-surface-variant">
                            {issue.entity_label && <span className="block">Subject: {issue.entity_label}</span>}
                            {issue.department_name && <span className="block">Department: {issue.department_name}</span>}
                            {issue.suggestion && <span className="block">Suggestion: {issue.suggestion}</span>}
                          </div>
                        </div>
                        <div className="flex-shrink-0 ml-3 flex flex-col items-end gap-2">
                          {subjectId && (
                            <button
                              onClick={() => { window.location.href = `/subjects/${subjectId}/edit`; }}
                              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                            >
                              Edit
                            </button>
                          )}
                          <button
                            onClick={() => navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(issue, null, 2))}
                            className="rounded-md border border-outline-variant bg-white px-3 py-1 text-xs text-on-surface hover:bg-gray-50"
                          >
                            Copy JSON
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {groupedIssues['medium'].length > 10 && (
                    <div className="text-xs text-amber-700 italic">+{groupedIssues['medium'].length - 10} more...</div>
                  )}
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
        <ScheduleTable rows={rows} loading={loadingRows} />
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
            <p className="text-on-surface-variant mb-6">Download the current schedule as a JSON file. This can be imported back later.</p>
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
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-2xl font-bold text-on-surface mb-4">Update Course Offering</h3>
            <p className="text-on-surface-variant mb-6">Apply the generated schedule to the Course Offering table.</p>
            <div className="mb-6 flex items-center gap-3 rounded-lg bg-blue-50 p-3 border border-blue-200">
              <input 
                type="checkbox" 
                checked={backupEnabled} 
                onChange={(e) => setBackupEnabled(e.target.checked)}
                className="w-4 h-4 cursor-pointer"
              />
              <label className="cursor-pointer flex-1 text-sm font-medium text-blue-900">Create backup before updating</label>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowUpdateModal(false)} className="flex-1 rounded-lg border border-outline-variant px-4 py-2 font-semibold text-on-surface hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleUpdateCourseOffering} disabled={updating} className="flex-1 rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2">
                {updating ? <RefreshCcw size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                {updating ? 'Updating...' : 'Update'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
