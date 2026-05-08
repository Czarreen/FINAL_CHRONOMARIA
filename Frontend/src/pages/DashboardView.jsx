import { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, DoorOpen, BookOpen, Users, UserPlus, Info, FileUp, Upload, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { fetchFacultyPage } from '../services/facultyApi.js';
import { fetchSubjects } from '../services/subjectsApi.js';
import { fetchRoomsPage } from '../services/roomsApi.js';
import {
  previewCourseOfferingsCsv,
  confirmCourseOfferingsCsv,
} from '../services/courseOfferingsApi.js';
import CsvImportReviewPanel from '../components/CsvImportReviewPanel.jsx';

export default function DashboardView({ onNavigate }) {
  const [facultyCount, setFacultyCount] = useState(0);
  const [subjectsCount, setSubjectsCount] = useState(0);
  const [roomsCount, setRoomsCount] = useState(0);
  const [schedulesCount, setSchedulesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showScheduleInfo, setShowScheduleInfo] = useState(false);
  const [showFacultyInfo, setShowFacultyInfo] = useState(false);
  const [showSubjectsInfo, setShowSubjectsInfo] = useState(false);
  const [showRoomsInfo, setShowRoomsInfo] = useState(false);
  const [selectedCsvFile, setSelectedCsvFile] = useState(null);
  const [importingCsv, setImportingCsv] = useState(false);
  const [reviewingCsv, setReviewingCsv] = useState(false);
  const [csvPreview, setCsvPreview] = useState(null);
  const [showCsvReview, setShowCsvReview] = useState(false);
  const [csvConfirmError, setCsvConfirmError] = useState('');
  const [importSummary, setImportSummary] = useState(null);
  const [importError, setImportError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch faculty count
        const facultyData = await fetchFacultyPage(1, 9999);
        setFacultyCount(facultyData.rows?.length || 0);
        
        // Fetch subjects count
        const subjectsData = await fetchSubjects({ page: 1, limit: 9999 });
        setSubjectsCount(subjectsData.total || 0);
        
        // Fetch rooms count
        const roomsData = await fetchRoomsPage(1, 9999);
        setRoomsCount(roomsData.rows?.length || 0);
        
        // Schedules count (currently placeholder - update when backend is ready)
        setSchedulesCount(0);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const statCards = [
    { label: 'Total Faculty', value: String(facultyCount), icon: Users },
    { label: 'Total Subjects', value: String(subjectsCount), icon: BookOpen },
    { label: 'Total Rooms', value: String(roomsCount), icon: DoorOpen },
    { label: 'Schedules Generated', value: String(schedulesCount), icon: Calendar },
  ];

  // Calculate system readiness based on available components
  const readinessScore = [
    facultyCount > 0,
    subjectsCount > 0,
    roomsCount > 0,
    schedulesCount > 0,
  ].filter(Boolean).length;
  
  const systemReadiness = Math.round((readinessScore / 4) * 100);

  const handleCsvImport = async () => {
    if (!selectedCsvFile) {
      setImportError('Choose a CSV file first.');
      return;
    }

    try {
      setReviewingCsv(true);
      setImportError('');
      setImportSummary(null);
      setCsvConfirmError('');

      const csvText = await selectedCsvFile.text();
      const response = await previewCourseOfferingsCsv({
        csvText,
        fileName: selectedCsvFile.name,
      });

      setCsvPreview(response?.preview ?? null);
      setShowCsvReview(true);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'CSV preview failed.');
    } finally {
      setReviewingCsv(false);
    }
  };

  const handleConfirmCsvImport = async ({ importToken, edits }) => {
    try {
      setImportingCsv(true);
      setCsvConfirmError('');
      setImportError('');

      const response = await confirmCourseOfferingsCsv({
        importToken,
        edits,
      });

      setImportSummary(response?.summary ?? null);
      setShowCsvReview(false);
      setCsvPreview(null);
    } catch (error) {
      setCsvConfirmError(error instanceof Error ? error.message : 'CSV import confirm failed.');
    } finally {
      setImportingCsv(false);
    }
  };

  return (
    <div className="space-y-gutter animate-in fade-in duration-500">
      <div className="mb-2 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2 className="text-headline-xl font-headline-xl text-on-surface">Dashboard</h2>
          <p className="mt-1 text-body-md text-on-surface-variant">Overview of the faculty loading system</p>
        </div>
        <div className="relative">
          <button 
            onClick={() => onNavigate('schedule')}
            onMouseEnter={() => setShowScheduleInfo(true)}
            onMouseLeave={() => setShowScheduleInfo(false)}
            className="flex w-fit items-center gap-2 rounded-lg bg-primary px-6 py-2.5 font-label-bold text-label-bold text-on-primary shadow-sm transition-colors hover:bg-primary/90"
          >
            <Calendar size={18} />
            Generate Schedules
          </button>
          
          {showScheduleInfo && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="absolute right-0 top-full mt-2 w-72 rounded-lg bg-white/95 shadow-lg border border-white/60 p-4 z-50"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-primary flex-shrink-0 mt-0.5">
                  <Info size={16} />
                </div>
                <div>
                  <p className="font-semibold text-on-surface mb-1">Generate Schedules</p>
                  <p className="text-sm text-on-surface-variant leading-relaxed">
                    Launch the optimization engine to automatically generate optimized schedules based on faculty availability, subject requirements, and room capacities using advanced genetic algorithm calculations.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-gutter md:grid-cols-12">
        <div className="glass-panel col-span-1 flex min-h-[180px] flex-col justify-between rounded-xl p-container-padding md:col-span-4">
          <div className="flex items-start justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary-container/50 text-secondary">
              <CheckCircle2 size={24} />
            </div>
            <span className="rounded-md bg-secondary-container/30 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-secondary">
              Status
            </span>
          </div>
          <div className="mt-4">
            <p className="text-numeric-lg font-numeric-lg text-on-surface">{systemReadiness}%</p>
            <p className="mt-1 text-body-sm font-medium text-on-surface-variant">System Readiness</p>
          </div>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-variant">
            <div 
              className="h-full rounded-full bg-secondary transition-all duration-500" 
              style={{ width: `${systemReadiness}%` }}
            />
          </div>
        </div>

        <div className="col-span-1 grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:col-span-8 lg:grid-cols-4">
          {statCards.map((card) => (
            <div key={card.label} className="glass-panel flex flex-col justify-center rounded-xl p-5">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-variant/50 text-tertiary">
                  <card.icon size={18} />
                </div>
                <h3 className="text-label-bold font-label-bold text-on-surface-variant">{card.label}</h3>
              </div>
              <p className="text-numeric-lg font-numeric-lg text-on-surface">{card.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <h3 className="mb-4 text-[18px] font-headline-lg text-on-surface">Quick Actions</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <div className="relative">
            <button 
              onClick={() => onNavigate('faculty')}
              onMouseEnter={() => setShowFacultyInfo(true)}
              onMouseLeave={() => setShowFacultyInfo(false)}
              className="glass-panel group flex w-full items-center gap-4 rounded-xl p-4 text-left transition-colors hover:bg-white/80"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-variant/50 text-primary transition-colors group-hover:bg-primary-container/30">
                <UserPlus size={20} />
              </div>
              <div>
                <p className="text-label-bold font-label-bold text-on-surface">Manage Faculty</p>
                <p className="mt-0.5 text-[11px] text-on-surface-variant">Add or edit instructors</p>
              </div>
            </button>
            
            {showFacultyInfo && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="absolute left-0 top-full mt-2 w-64 rounded-lg bg-white/95 shadow-lg border border-white/60 p-3 z-50"
              >
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  View and manage all faculty members. Add new instructors, edit their information, and track their status.
                </p>
              </motion.div>
            )}
          </div>

          <div className="relative">
            <button 
              onClick={() => onNavigate('subjects')}
              onMouseEnter={() => setShowSubjectsInfo(true)}
              onMouseLeave={() => setShowSubjectsInfo(false)}
              className="glass-panel group flex w-full items-center gap-4 rounded-xl p-4 text-left transition-colors hover:bg-white/80"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-variant/50 text-primary transition-colors group-hover:bg-primary-container/30">
                <BookOpen size={20} />
              </div>
              <div>
                <p className="text-label-bold font-label-bold text-on-surface">Manage Subjects</p>
                <p className="mt-0.5 text-[11px] text-on-surface-variant">Update course offerings</p>
              </div>
            </button>
            
            {showSubjectsInfo && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="absolute left-0 top-full mt-2 w-64 rounded-lg bg-white/95 shadow-lg border border-white/60 p-3 z-50"
              >
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  Manage all subjects and courses. Add new subjects, edit course details, and control which courses are available.
                </p>
              </motion.div>
            )}
          </div>

          <div className="relative">
            <button 
              onClick={() => onNavigate('rooms')}
              onMouseEnter={() => setShowRoomsInfo(true)}
              onMouseLeave={() => setShowRoomsInfo(false)}
              className="glass-panel group flex w-full items-center gap-4 rounded-xl p-4 text-left transition-colors hover:bg-white/80"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-variant/50 text-primary transition-colors group-hover:bg-primary-container/30">
                <DoorOpen size={20} />
              </div>
              <div>
                <p className="text-label-bold font-label-bold text-on-surface">Manage Rooms</p>
                <p className="mt-0.5 text-[11px] text-on-surface-variant">Configure facilities</p>
              </div>
            </button>
            
            {showRoomsInfo && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="absolute left-0 top-full mt-2 w-64 rounded-lg bg-white/95 shadow-lg border border-white/60 p-3 z-50"
              >
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  View and manage all available rooms and facilities. Add new rooms, edit room details, and set capacity limits.
                </p>
              </motion.div>
            )}
          </div>

          <div className="glass-panel rounded-xl p-4 sm:col-span-3 lg:col-span-4">
            <div className="mb-3 flex items-center gap-2">
              <Upload size={16} className="text-primary" />
              <p className="text-label-bold font-label-bold text-on-surface">Import Course Offerings CSV</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/60 bg-white/80 px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-white">
                <FileUp size={16} className="text-primary" />
                <span>{selectedCsvFile ? selectedCsvFile.name : 'Choose CSV'}</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setSelectedCsvFile(file);
                    setImportSummary(null);
                    setImportError('');
                    setCsvPreview(null);
                    setShowCsvReview(false);
                    setCsvConfirmError('');
                  }}
                />
              </label>
              <button
                type="button"
                onClick={handleCsvImport}
                disabled={importingCsv || reviewingCsv}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Upload size={14} />
                {reviewingCsv ? 'Reviewing...' : 'Review CSV'}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('course-offering')}
                className="rounded-lg border border-white/60 bg-white px-4 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
              >
                Open Course Offerings
              </button>
            </div>
            {importError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700">
                <AlertCircle size={14} />
                {importError}
              </div>
            )}
            {importSummary && (
              <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/70 p-3 text-xs text-emerald-900">
                <p className="font-semibold">
                  Total {importSummary.totalRows} • Processed {importSummary.processedRows} • Inserted {importSummary.insertedRows} • Updated {importSummary.updatedRows} • Failed {importSummary.failedRows} • Skipped {importSummary.skippedRows}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <CsvImportReviewPanel
        open={showCsvReview}
        preview={csvPreview}
        confirming={importingCsv}
        confirmError={csvConfirmError}
        onClose={() => {
          if (importingCsv) return;
          setShowCsvReview(false);
        }}
        onConfirm={handleConfirmCsvImport}
      />
    </div>
  );
}
