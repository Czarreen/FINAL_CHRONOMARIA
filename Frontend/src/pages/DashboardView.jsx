import { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, DoorOpen, BookOpen, Users, UserPlus, Info, FileUp, Upload, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { fetchFacultyPage } from '../services/facultyApi.js';
import { fetchSubjects } from '../services/subjectsApi.js';
import { fetchRoomsPage } from '../services/roomsApi.js';
import { importCourseOfferingsCsv } from '../services/courseOfferingsApi.js';

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
      setImportingCsv(true);
      setImportError('');
      setImportSummary(null);

      const csvText = await selectedCsvFile.text();
      const response = await importCourseOfferingsCsv({
        csvText,
        fileName: selectedCsvFile.name,
      });

      setImportSummary(response?.summary ?? null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'CSV import failed.');
    } finally {
      setImportingCsv(false);
    }
  };

  return (
    <div className="space-y-gutter animate-in fade-in duration-500">
      <div className="mb-6 flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div>
          <h2 className="text-5xl font-bold text-on-surface">Dashboard</h2>
          <p className="mt-2 text-body-md font-medium text-on-surface-variant">Overview of the faculty loading system</p>
        </div>
        <div className="relative">
          <button 
            onClick={() => onNavigate('schedule')}
            onMouseEnter={() => setShowScheduleInfo(true)}
            onMouseLeave={() => setShowScheduleInfo(false)}
            className="flex w-fit items-center gap-2 rounded-lg bg-primary px-6 py-3 font-label-bold text-label-bold text-on-primary shadow-md transition-all hover:bg-primary/90 hover:shadow-lg active:shadow-sm"
          >
            <Calendar size={20} />
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
        <div className="glass-panel col-span-1 flex min-h-[160px] flex-col justify-between rounded-xl p-6 md:col-span-3">
          <div className="flex items-start justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary-container/50 text-secondary">
              <CheckCircle2 size={24} />
            </div>
            <span className="rounded-md bg-secondary-container/30 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-secondary">
              Status
            </span>
          </div>
          <div className="mt-4">
            <p className="text-4xl font-bold text-on-surface">{systemReadiness}%</p>
            <p className="mt-1 text-body-sm font-medium text-on-surface-variant">System Readiness</p>
          </div>
          <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-surface-variant">
            <div 
              className="h-full rounded-full bg-secondary transition-all duration-500" 
              style={{ width: `${systemReadiness}%` }}
            />
          </div>
        </div>

        <div className="col-span-1 grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:col-span-9 lg:grid-cols-4">
          {statCards.map((card) => {
            const isEmpty = card.label === 'Schedules Generated' && card.value === '0';
            return (
              <div 
                key={card.label} 
                className={`glass-panel flex flex-col justify-between rounded-xl p-4 transition-opacity duration-300 ${isEmpty ? 'opacity-70' : 'opacity-100'}`}
              >
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{card.label}</h3>
                  <p className={`mt-3 font-bold text-on-surface ${
                    card.value === '0' ? 'text-4xl' : card.value.length > 2 ? 'text-5xl' : 'text-6xl'
                  }`}>
                    {card.value}
                  </p>
                </div>
                {isEmpty && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-on-surface-variant">
                    <div className="h-1 w-1 rounded-full bg-on-surface-variant/50" />
                    <span>No schedules yet</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-8">
        <h3 className="mb-5 text-[20px] font-bold text-on-surface">Quick Actions</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="relative">
            <button 
              onClick={() => onNavigate('faculty')}
              onMouseEnter={() => setShowFacultyInfo(true)}
              onMouseLeave={() => setShowFacultyInfo(false)}
              className="glass-panel group flex w-full items-center gap-4 rounded-xl border-2 border-transparent bg-blue-50/20 p-5 text-left transition-all hover:border-blue-400/60 hover:bg-blue-50/50 hover:shadow-md active:scale-98"
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 transition-all group-hover:bg-blue-200 group-hover:scale-110">
                <UserPlus size={24} />
              </div>
              <div>
                <p className="text-sm font-bold text-on-surface">Manage Faculty</p>
                <p className="mt-1 text-[11px] text-on-surface-variant">Add or edit instructors</p>
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
              className="glass-panel group flex w-full items-center gap-4 rounded-xl border-2 border-transparent bg-orange-50/20 p-5 text-left transition-all hover:border-orange-400/60 hover:bg-orange-50/50 hover:shadow-md active:scale-98"
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-600 transition-all group-hover:bg-orange-200 group-hover:scale-110">
                <BookOpen size={24} />
              </div>
              <div>
                <p className="text-sm font-bold text-on-surface">Manage Subjects</p>
                <p className="mt-1 text-[11px] text-on-surface-variant">Update course offerings</p>
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
              className="glass-panel group flex w-full items-center gap-4 rounded-xl border-2 border-transparent bg-purple-50/20 p-5 text-left transition-all hover:border-purple-400/60 hover:bg-purple-50/50 hover:shadow-md active:scale-98"
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-600 transition-all group-hover:bg-purple-200 group-hover:scale-110">
                <DoorOpen size={24} />
              </div>
              <div>
                <p className="text-sm font-bold text-on-surface">Manage Rooms</p>
                <p className="mt-1 text-[11px] text-on-surface-variant">Configure facilities</p>
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

          <div className="glass-panel col-span-1 rounded-xl p-6 sm:col-span-3">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                <Upload size={20} />
              </div>
              <h4 className="text-sm font-bold text-on-surface">Import Course Offerings</h4>
            </div>
            <div className="space-y-4">
              <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-surface-variant bg-surface-variant/20 px-6 py-8 text-center transition-all hover:border-blue-400 hover:bg-blue-50/30 active:bg-blue-50">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setSelectedCsvFile(file);
                    setImportSummary(null);
                    setImportError('');
                  }}
                />
                <div className="flex flex-col items-center gap-2">
                  <FileUp size={24} className="text-blue-600" />
                  {selectedCsvFile ? (
                    <div className="flex flex-col items-center">
                      <p className="text-sm font-semibold text-on-surface">{selectedCsvFile.name}</p>
                      <p className="text-xs text-on-surface-variant">Click to replace</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <p className="text-sm font-semibold text-on-surface">Click to select CSV file</p>
                      <p className="text-xs text-on-surface-variant">or drag and drop</p>
                    </div>
                  )}
                </div>
              </label>
              <button
                type="button"
                onClick={handleCsvImport}
                disabled={!selectedCsvFile || importingCsv}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white transition-all hover:bg-blue-700 disabled:bg-surface-variant disabled:text-on-surface-variant disabled:cursor-not-allowed"
              >
                <Upload size={16} />
                {importingCsv ? 'Importing...' : 'Import CSV'}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('course-offering')}
                className="w-full rounded-lg border-2 border-outline bg-white px-4 py-2 text-sm font-semibold text-on-surface transition-all hover:bg-surface-container focus:outline-none focus:ring-2 focus:ring-blue-400/50"
              >
                View Course Offerings
              </button>
            </div>
            {importError && (
              <div className="mt-4 flex items-start gap-3 rounded-lg border-l-4 border-red-500 bg-red-50 p-4">
                <AlertCircle size={18} className="mt-0.5 flex-shrink-0 text-red-600" />
                <div>
                  <p className="text-sm font-semibold text-red-900">Import Failed</p>
                  <p className="mt-1 text-xs text-red-700">{importError}</p>
                </div>
              </div>
            )}
            {importSummary && (
              <div className="mt-4 flex items-start gap-3 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-4">
                <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0 text-emerald-600" />
                <div>
                  <p className="text-sm font-semibold text-emerald-900">Import Successful</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-emerald-800">
                    <div>Total: {importSummary.totalRows}</div>
                    <div>Processed: {importSummary.processedRows}</div>
                    <div>Inserted: {importSummary.insertedRows}</div>
                    <div>Updated: {importSummary.updatedRows}</div>
                    <div>Failed: {importSummary.failedRows}</div>
                    <div>Skipped: {importSummary.skippedRows}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8">
        <h3 className="mb-5 text-[20px] font-bold text-on-surface">System Status</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="glass-panel rounded-xl p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Faculty</p>
                <p className="mt-3 text-3xl font-bold text-on-surface">{facultyCount > 0 ? '✓' : '–'}</p>
              </div>
              <div className={`flex h-8 w-8 items-center justify-center rounded-full ${facultyCount > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-surface-variant text-on-surface-variant'}`}>
                <Users size={16} />
              </div>
            </div>
            <p className="mt-3 text-xs text-on-surface-variant">{facultyCount > 0 ? `${facultyCount} instructors loaded` : 'No faculty data'}</p>
          </div>

          <div className="glass-panel rounded-xl p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Subjects</p>
                <p className="mt-3 text-3xl font-bold text-on-surface">{subjectsCount > 0 ? '✓' : '–'}</p>
              </div>
              <div className={`flex h-8 w-8 items-center justify-center rounded-full ${subjectsCount > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-surface-variant text-on-surface-variant'}`}>
                <BookOpen size={16} />
              </div>
            </div>
            <p className="mt-3 text-xs text-on-surface-variant">{subjectsCount > 0 ? `${subjectsCount} subjects configured` : 'No subjects data'}</p>
          </div>

          <div className="glass-panel rounded-xl p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Rooms</p>
                <p className="mt-3 text-3xl font-bold text-on-surface">{roomsCount > 0 ? '✓' : '–'}</p>
              </div>
              <div className={`flex h-8 w-8 items-center justify-center rounded-full ${roomsCount > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-surface-variant text-on-surface-variant'}`}>
                <DoorOpen size={16} />
              </div>
            </div>
            <p className="mt-3 text-xs text-on-surface-variant">{roomsCount > 0 ? `${roomsCount} rooms available` : 'No rooms data'}</p>
          </div>

          <div className="glass-panel rounded-xl p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Scheduling</p>
                <p className="mt-3 text-3xl font-bold text-on-surface">{schedulesCount > 0 ? '✓' : '–'}</p>
              </div>
              <div className={`flex h-8 w-8 items-center justify-center rounded-full ${schedulesCount > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-surface-variant text-on-surface-variant'}`}>
                <Calendar size={16} />
              </div>
            </div>
            <p className="mt-3 text-xs text-on-surface-variant">{schedulesCount > 0 ? `${schedulesCount} schedules generated` : 'Ready to generate'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
