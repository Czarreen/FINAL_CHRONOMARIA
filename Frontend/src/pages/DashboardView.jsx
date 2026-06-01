import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, CheckCircle2, DoorOpen, BookOpen, Users, UserPlus, FileUp, Upload, AlertCircle, Info, X, Bell } from 'lucide-react';
import { fetchFacultyPage } from '../services/facultyApi.js';
import { fetchSubjects } from '../services/subjectsApi.js';
import { fetchRoomsPage } from '../services/roomsApi.js';
import { importCourseOfferingsCsv } from '../services/courseOfferingsApi.js';
import { fetchAutomaticSchedulerRows } from '../services/gaApi.js';
import { fetchPersistedFacultyNotifications, fetchPersistedSubjectNotifications, fetchRoomNotifications } from '../services/notificationsApi.js';

export default function DashboardView({ onNavigate }) {
  const [facultyCount, setFacultyCount] = useState(0);
  const [subjectsCount, setSubjectsCount] = useState(0);
  const [roomsCount, setRoomsCount] = useState(0);
  const [schedulesCount, setSchedulesCount] = useState(0);
  const [facultyIssueCount, setFacultyIssueCount] = useState(0);
  const [subjectIssueCount, setSubjectIssueCount] = useState(0);
  const [roomIssueCount, setRoomIssueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedCsvFile, setSelectedCsvFile] = useState(null);
  const [importingCsv, setImportingCsv] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  const [importError, setImportError] = useState('');
  const [showCsvFormat, setShowCsvFormat] = useState(false);
  const csvFormatRef = useRef(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [facultyRes, subjectsRes, roomsRes, schedRes, facNotifRes, subNotifRes, roomNotifRes] = await Promise.allSettled([
          fetchFacultyPage(1, 9999),
          fetchSubjects({ page: 1, limit: 9999 }),
          fetchRoomsPage(1, 9999),
          fetchAutomaticSchedulerRows(),
          fetchPersistedFacultyNotifications({ page: 1, limit: 1, unresolvedOnly: true }),
          fetchPersistedSubjectNotifications({ page: 1, limit: 1, unresolvedOnly: true }),
          fetchRoomNotifications({ page: 1, limit: 1, unresolvedOnly: true }),
        ]);

        if (facultyRes.status === 'fulfilled') setFacultyCount(facultyRes.value.rows?.length || 0);
        if (subjectsRes.status === 'fulfilled') setSubjectsCount(subjectsRes.value.total || 0);
        if (roomsRes.status === 'fulfilled') setRoomsCount(roomsRes.value.rows?.length || 0);
        if (schedRes.status === 'fulfilled') setSchedulesCount(schedRes.value.count || 0);
        if (facNotifRes.status === 'fulfilled') setFacultyIssueCount(facNotifRes.value.total || 0);
        if (subNotifRes.status === 'fulfilled') setSubjectIssueCount(subNotifRes.value.total || 0);
        if (roomNotifRes.status === 'fulfilled') setRoomIssueCount(roomNotifRes.value.total || 0);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (!showCsvFormat) return;
    const handleClick = (e) => {
      if (csvFormatRef.current && !csvFormatRef.current.contains(e.target)) {
        setShowCsvFormat(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showCsvFormat]);

  // Readiness: 3 binary pillars × 25% + data-quality pillar up to 25%
  // Fewer unresolved conflicts across all pages → higher quality score
  const totalConflicts = facultyIssueCount + subjectIssueCount + roomIssueCount;
  const hasAnyData = facultyCount > 0 || subjectsCount > 0 || roomsCount > 0;
  const baseScore = [facultyCount > 0, subjectsCount > 0, roomsCount > 0].filter(Boolean).length * 25;
  const qualityScore = hasAnyData ? Math.round(25 * Math.max(0, 1 - Math.min(totalConflicts, 20) / 20)) : 0;
  const systemReadiness = Math.min(100, baseScore + qualityScore);

  const readinessPillars = [
    { label: 'Faculty', ready: facultyCount > 0, warn: false },
    { label: 'Subjects', ready: subjectsCount > 0, warn: false },
    { label: 'Rooms', ready: roomsCount > 0, warn: false },
    { label: 'No Issues', ready: totalConflicts === 0 && hasAnyData, warn: totalConflicts > 0 && hasAnyData },
  ];

  const handleCsvImport = async () => {
    if (!selectedCsvFile) {
      setImportError('Choose a CSV file first.');
      return;
    }
    try {
      setImportingCsv(true);
      setImportError('');
      setImportSummary(null);
      const csvText = await selectedCsvFile.text();
      const response = await importCourseOfferingsCsv({ csvText, fileName: selectedCsvFile.name });
      setImportSummary(response?.summary ?? null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'CSV import failed.');
    } finally {
      setImportingCsv(false);
    }
  };

  const formatBadge = (n) => (n > 999 ? '999+' : String(n));

  const stats = [
    {
      label: 'Faculty',
      value: facultyCount,
      icon: Users,
      subtext: facultyCount > 0 ? `${facultyCount} instructors configured` : 'No instructors loaded yet',
      issueCount: facultyIssueCount,
      issuePage: 'faculty',
    },
    {
      label: 'Subjects',
      value: subjectsCount,
      icon: BookOpen,
      subtext: subjectsCount > 0 ? `${subjectsCount} course offerings defined` : 'No subjects configured yet',
      issueCount: subjectIssueCount,
      issuePage: 'subjects',
    },
    {
      label: 'Rooms',
      value: roomsCount,
      icon: DoorOpen,
      subtext: roomsCount > 0 ? `${roomsCount} facilities available` : 'No rooms configured yet',
      issueCount: roomIssueCount,
      issuePage: 'rooms',
    },
    {
      label: 'Schedules',
      value: schedulesCount,
      icon: Calendar,
      subtext: schedulesCount > 0 ? `${schedulesCount} sessions currently assigned` : 'No schedule generated yet',
      issueCount: null,
      issuePage: null,
    },
  ];

  const quickActions = [
    { label: 'Manage Faculty', description: 'Add or edit instructors', icon: UserPlus, target: 'faculty' },
    { label: 'Manage Subjects', description: 'Update course offerings', icon: BookOpen, target: 'subjects' },
    { label: 'Manage Rooms', description: 'Configure facilities', icon: DoorOpen, target: 'rooms' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">

      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-5xl font-bold text-on-surface">Dashboard</h2>
          <p className="mt-1.5 text-base font-medium text-on-surface-variant">Overview of the faculty loading system</p>
        </div>
        <button
          onClick={() => onNavigate('schedule')}
          className="flex w-fit items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-bold text-on-primary shadow-md transition-all hover:bg-primary/90 hover:shadow-lg active:shadow-sm"
        >
          <Calendar size={18} />
          Generate Schedules
        </button>
      </div>

      {/* ── Stats Row ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">

        {/* Readiness Card */}
        <div className="glass-panel col-span-1 flex flex-col justify-between rounded-xl p-6 md:col-span-3">
          <div className="flex items-center justify-between">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary-container/50 text-secondary">
              <CheckCircle2 size={20} />
            </div>
            <span className="rounded-md bg-secondary-container/30 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-secondary">
              Status
            </span>
          </div>
          <div className="mt-5">
            <p className="text-5xl font-bold text-on-surface">{systemReadiness}%</p>
            <p className="mt-1 text-sm font-semibold text-on-surface-variant">System Readiness</p>
          </div>
          <div className="mt-4 space-y-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-variant">
              <div
                className="h-full rounded-full bg-secondary transition-all duration-700"
                style={{ width: `${systemReadiness}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {readinessPillars.map((p) => (
                <div key={p.label} className="flex items-center gap-2">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${
                    p.ready ? 'bg-emerald-500' : p.warn ? 'bg-amber-400' : 'bg-surface-variant'
                  }`} />
                  <span className="text-xs text-on-surface-variant">{p.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Metric Cards — landscape layout */}
        <div className="col-span-1 grid grid-cols-1 gap-4 sm:grid-cols-2 md:col-span-9">
          {stats.map((stat) => (
            <div key={stat.label} className="glass-panel relative flex items-center gap-5 rounded-xl p-6">
              {/* Bell badge — top-right, only for cards with a notification system */}
              {stat.issueCount !== null && (
                <button
                  type="button"
                  onClick={() => stat.issuePage && onNavigate(stat.issuePage)}
                  title={stat.issueCount > 0 ? `${stat.issueCount} unresolved issue${stat.issueCount !== 1 ? 's' : ''}` : 'No issues'}
                  className={`absolute right-4 top-4 flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-bold transition-colors ${
                    stat.issueCount > 0
                      ? 'bg-red-100 text-red-600 hover:bg-red-200'
                      : 'bg-surface-variant/50 text-on-surface-variant hover:bg-surface-variant'
                  }`}
                >
                  <Bell size={12} />
                  {stat.issueCount > 0 && <span>{formatBadge(stat.issueCount)}</span>}
                </button>
              )}

              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <stat.icon size={26} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold uppercase tracking-wider text-on-surface-variant">{stat.label}</p>
                <p className={`text-5xl font-bold text-on-surface transition-opacity duration-300 ${loading ? 'opacity-30' : 'opacity-100'}`}>
                  {stat.value}
                </p>
                <p className="mt-1 text-sm text-on-surface-variant">{stat.subtext}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div>
        <h3 className="mb-4 text-xl font-bold text-on-surface">Quick Actions</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {quickActions.map((action) => (
            <button
              key={action.target}
              onClick={() => onNavigate(action.target)}
              className="glass-panel group flex items-center gap-4 rounded-xl border-2 border-transparent p-5 text-left transition-all hover:border-primary/30 hover:shadow-md active:scale-[0.99]"
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-all group-hover:bg-primary/20 group-hover:scale-110">
                <action.icon size={22} />
              </div>
              <div className="min-w-0">
                <p className="text-base font-bold text-on-surface">{action.label}</p>
                <p className="mt-0.5 text-sm text-on-surface-variant">{action.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Import Course Offerings ── */}
      <div className="glass-panel rounded-xl p-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Upload size={18} />
          </div>
          <div>
            <h4 className="text-base font-bold text-on-surface">Import Course Offerings</h4>
            <p className="text-sm text-on-surface-variant">Bulk-import offerings via CSV — existing records are updated</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('course-offering')}
            className="ml-auto rounded-lg border border-outline px-3 py-1.5 text-sm font-semibold text-on-surface transition-all hover:bg-surface-container focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            View All Offerings
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* File picker */}
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-surface-variant bg-surface-variant/20 px-6 py-10 text-center transition-all hover:border-primary/40 hover:bg-primary/5">
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setSelectedCsvFile(file);
                setImportSummary(null);
                setImportError('');
              }}
            />
            <FileUp size={24} className="text-primary" />
            {selectedCsvFile ? (
              <div className="mt-3">
                <p className="text-sm font-semibold text-on-surface">{selectedCsvFile.name}</p>
                <p className="mt-0.5 text-sm text-on-surface-variant">Click to replace file</p>
              </div>
            ) : (
              <div className="mt-3">
                <p className="text-sm font-semibold text-on-surface">Select CSV file</p>
                <p className="mt-0.5 text-sm text-on-surface-variant">or drag and drop here</p>
              </div>
            )}
          </label>

          {/* Actions + format hint */}
          <div className="flex flex-col gap-3">
            <div className="relative flex-1 rounded-xl bg-surface-variant/20 p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">Expected Format</p>
                <button
                  type="button"
                  onClick={() => setShowCsvFormat((v) => !v)}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-primary/10 hover:text-primary"
                  aria-label="Show CSV format details"
                >
                  <Info size={14} />
                </button>
              </div>
              <p className="text-sm leading-relaxed text-on-surface-variant">
                Required: <span className="font-mono text-on-surface">curr_id, course_no, section</span><br />
                New rows are inserted; matched rows are updated.
              </p>

              {showCsvFormat && createPortal(
                <>
                  <div
                    className="fixed inset-0 z-[9998] bg-black/30 backdrop-blur-sm"
                    onClick={() => setShowCsvFormat(false)}
                  />
                  <div
                    ref={csvFormatRef}
                    className="fixed left-1/2 top-1/2 z-[9999] w-[min(900px,95vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-outline/20 bg-white shadow-2xl"
                  >
                    <div className="flex items-center justify-between border-b border-outline/15 bg-surface-container/70 px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Info size={16} />
                        </div>
                        <div>
                          <p className="text-base font-bold text-on-surface">CSV Format Reference</p>
                          <p className="text-sm text-on-surface-variant">Headers are case-insensitive — punctuation and spaces are ignored</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowCsvFormat(false)}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <div className="grid grid-cols-5 divide-x divide-outline/10">
                      <div className="col-span-2 flex flex-col gap-5 p-6">
                        <div>
                          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">Required Columns</p>
                          <div className="space-y-2">
                            {[
                              { header: 'CurrID', aliases: 'also: CurriculumID' },
                              { header: 'CourseNo', aliases: 'also: Course' },
                              { header: 'Section', aliases: null },
                            ].map((col) => (
                              <div key={col.header} className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                                  *
                                </div>
                                <div>
                                  <p className="font-mono text-sm font-bold text-primary">{col.header}</p>
                                  {col.aliases && <p className="mt-0.5 text-xs text-on-surface-variant">{col.aliases}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl bg-surface-variant/30 px-4 py-4">
                          <p className="mb-2.5 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Notes</p>
                          <ul className="space-y-2 text-sm leading-relaxed text-on-surface-variant">
                            <li className="flex gap-2">
                              <span className="mt-1 flex-shrink-0 text-[10px]">▸</span>
                              <span>Blank cells, <span className="font-mono text-xs text-on-surface">null</span>, <span className="font-mono text-xs text-on-surface">N/A</span>, and <span className="font-mono text-xs text-on-surface">-</span> are treated as empty.</span>
                            </li>
                            <li className="flex gap-2">
                              <span className="mt-1 flex-shrink-0 text-[10px]">▸</span>
                              <span>Rows missing any required column are skipped.</span>
                            </li>
                            <li className="flex gap-2">
                              <span className="mt-1 flex-shrink-0 text-[10px]">▸</span>
                              <span>Existing offerings are updated; new ones are inserted.</span>
                            </li>
                          </ul>
                        </div>
                      </div>

                      <div className="col-span-3 p-6">
                        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Optional Columns</p>
                        <div className="overflow-hidden rounded-xl border border-outline/20">
                          <table className="w-full">
                            <thead>
                              <tr className="bg-surface-container/60">
                                <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-on-surface-variant">Column Header</th>
                                <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-on-surface-variant">Also accepted as</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-outline/10">
                              {[
                                { header: 'Code', aliases: '' },
                                { header: 'Dept', aliases: 'Department, DepartmentCode, DepartmentName' },
                                { header: 'DescriptiveTitle', aliases: 'Title' },
                                { header: 'Units', aliases: '' },
                                { header: 'LecHrs', aliases: 'LectureHrs' },
                                { header: 'LabHrs', aliases: '' },
                                { header: 'MthSchedule', aliases: '' },
                                { header: 'MthRoom', aliases: 'MthRoomID, Room (1st occurrence)' },
                                { header: 'TfsSchedule', aliases: '' },
                                { header: 'TfsRoom', aliases: 'TfsRoomID, Room (2nd occurrence)' },
                                { header: 'Merged', aliases: 'true / false / yes / no / 1 / 0' },
                              ].map((col) => (
                                <tr key={col.header} className="transition-colors hover:bg-surface-container/40">
                                  <td className="px-4 py-2.5 font-mono text-sm font-semibold text-on-surface">{col.header}</td>
                                  <td className="px-4 py-2.5 text-sm text-on-surface-variant">{col.aliases || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                </>,
                document.body
              )}
            </div>

            <button
              type="button"
              onClick={handleCsvImport}
              disabled={!selectedCsvFile || importingCsv}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-bold text-white transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-surface-variant disabled:text-on-surface-variant"
            >
              <Upload size={16} />
              {importingCsv ? 'Importing...' : 'Import CSV'}
            </button>
          </div>
        </div>

        {importError && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border-l-4 border-red-500 bg-red-50 p-4">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-red-600" />
            <div>
              <p className="text-sm font-semibold text-red-900">Import Failed</p>
              <p className="mt-0.5 text-sm text-red-700">{importError}</p>
            </div>
          </div>
        )}

        {importSummary && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-4">
            <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-semibold text-emerald-900">Import Successful</p>
              <div className="mt-2 grid grid-cols-3 gap-x-6 gap-y-1 text-sm text-emerald-800">
                <span><strong>{importSummary.totalRows}</strong> Total</span>
                <span><strong>{importSummary.processedRows}</strong> Processed</span>
                <span><strong>{importSummary.insertedRows}</strong> Inserted</span>
                <span><strong>{importSummary.updatedRows}</strong> Updated</span>
                <span><strong>{importSummary.failedRows}</strong> Failed</span>
                <span><strong>{importSummary.skippedRows}</strong> Skipped</span>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
