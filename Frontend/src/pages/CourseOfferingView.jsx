import { useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import Toast from '../components/Toast';
import {
  BookMarked,
  Layers,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Eye,
  EyeOff,
  ArrowUpDown,
  Edit3,
  X,
  Search,
  AlertCircle,
  PlusCircle,
  Trash2,
  FileUp,
  Upload,
  Download,
  Settings,
  Check,
  Lock,
  GitCompare,
} from 'lucide-react';
import {
  fetchCourseOfferings,
  createCourseOffering,
  updateCourseOffering,
  deleteCourseOffering,
  importCourseOfferingsCsv,
  recordCourseOfferingExportAudit,
  fetchCourseOfferingById,
  fetchCourseOfferingPageNumber,
  checkDuplicateCode,
} from '../services/courseOfferingsApi';
import { fetchRooms, fetchRoomBookings } from '../services/roomsApi';
import { useRoomConflictMap, useConflictingIdSets } from '../hooks/useRoomConflictMap';
import { fetchDepartments } from '../services/departmentsApi';
import NotificationButton from '../components/NotificationButton';
import { syncCourseOfferingNotifications } from '../services/notificationsApi';
import { useRowHighlight } from '../hooks/useRowHighlight.jsx';
import { useNotifications } from '../hooks/useNotifications';
import { isFormValid, getDisabledReason } from '../utils/courseOfferingValidation';
import { NOTIFICATION_FIELD_TO_KEY } from '../utils/notificationTransform';
import ScheduleCardInput from '../components/ScheduleCardInput';
import RoomConflictsPanel from '../components/RoomConflictsPanel';
import { buildScheduleString, parseScheduleString, emptyCardState, splitMthAndWed, getScheduleAmPm, formatScheduleDisplay, isSimpleSchedule } from '../utils/scheduleUtils';

const PAGE_SIZE = 50;

export default function CourseOfferingView({ onSubjectMutated } = {}) {
  const [offerings, setOfferings] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [editingId, setEditingId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingData, setEditingData] = useState({});
  const [savingOffering, setSavingOffering] = useState(false);
  const [offeringError, setOfferingError] = useState(null);
  const [updateError, setUpdateError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [roomBookings, setRoomBookings] = useState([]);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [selectedCsvFile, setSelectedCsvFile] = useState(null);
  const [importingCsv, setImportingCsv] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  const [importError, setImportError] = useState('');
  const [replaceMode, setReplaceMode] = useState(false);
  const [showBackupPrompt, setShowBackupPrompt] = useState(false);
  const [importResultModal, setImportResultModal] = useState(null); // holds summary after import finishes
  const [selectedOfferings, setSelectedOfferings] = useState(new Set());
  const [visibleColumns, setVisibleColumns] = useState(
    new Set([
      'code', 'curr_id', 'course_no', 'descriptive_title', 'department_name', 'section',
      'units', 'lec_hrs', 'lab_hrs', 'mth_schedule', 'mth_room_id', 'tfs_schedule', 'tfs_room_id'
    ])
  );
  const [filterText, setFilterText] = useState('');
  const [filterColumn, setFilterColumn] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'code', direction: 'asc' });
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [colMenuPos, setColMenuPos] = useState({ top: 0, left: 0 });
  const colButtonRef = useRef(null);
  const colMenuRef = useRef(null);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [importMenuPos, setImportMenuPos] = useState({ top: 0, left: 0 });
  const importMenuButtonRef = useRef(null);
  const importMenuRef = useRef(null);
  const [departments, setDepartments] = useState([]);
  const [duplicateCodeSuggestions, setDuplicateCodeSuggestions] = useState([]);
  const [checkingDuplicateCode, setCheckingDuplicateCode] = useState(false);
  const [notificationFilter, setNotificationFilter] = useState('all'); // 'all', 'critical', 'medium', 'low'
  const [notificationSearch, setNotificationSearch] = useState('');
  const [compareIds, setCompareIds] = useState(null); // null | [id1, id2]
  const [pendingScrollToOffering, setPendingScrollToOffering] = useState(null);
  const [findingNotificationRow, setFindingNotificationRow] = useState(false);
  const [editingFromNotification, setEditingFromNotification] = useState(false);
  const [notificationMissingFields, setNotificationMissingFields] = useState(new Set());
  const {
    coNotifications: notifications,
    coLoading: notificationsLoading,
    rescanBoth: handleForceRescan,
    resolveCO: resolveNotificationItem,
    refreshCO: refreshNotifications,
    refreshSubject: refreshSubjectNotifications,
    triggerCoRefresh,
    rescanning,
  } = useNotifications();

  // Structured schedule card state — drives mth_schedule / tfs_schedule strings
  const [mthCard, setMthCard] = useState(emptyCardState('mth'));
  const [tfsCard, setTfsCard] = useState(emptyCardState('tfs'));
  // Wednesday is stored in mth_schedule with "W" suffix; separate card for rare cases
  const [wedCard, setWedCard] = useState(emptyCardState('wed'));
  const [mthCardModified, setMthCardModified] = useState(false);
  const [tfsCardModified, setTfsCardModified] = useState(false);
  const [wedCardModified, setWedCardModified] = useState(false);

  const { setHighlight, clearHighlight } = useRowHighlight();
  const skipNextFilterResetRef = useRef(false);

  useEffect(() => {
    if (!offeringError) return;
    const timer = setTimeout(() => setOfferingError(null), 5000);
    return () => clearTimeout(timer);
  }, [offeringError]);

  useEffect(() => {
    if (!updateError) return;
    const timer = setTimeout(() => setUpdateError(null), 5000);
    return () => clearTimeout(timer);
  }, [updateError]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  // Handle column menu positioning and click outside
  useEffect(() => {
    if (!colMenuOpen) return;

    const updatePosition = () => {
      if (!colButtonRef.current) return;
      const rect = colButtonRef.current.getBoundingClientRect();
      setColMenuPos({
        top: rect.bottom + 8,
        left: rect.right - 200,
      });
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition);
    window.addEventListener('resize', updatePosition);

    const handleClickOutside = (e) => {
      const isButtonClick = colButtonRef.current && colButtonRef.current.contains(e.target);
      const isMenuClick = colMenuRef.current && colMenuRef.current.contains(e.target);

      if (!isButtonClick && !isMenuClick) {
        setColMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [colMenuOpen]);

  // Handle import dropdown positioning and click outside
  useEffect(() => {
    if (!importMenuOpen) return;

    const updatePosition = () => {
      if (!importMenuButtonRef.current) return;
      const rect = importMenuButtonRef.current.getBoundingClientRect();
      setImportMenuPos({
        top: rect.bottom + 8,
        left: rect.left,
      });
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition);
    window.addEventListener('resize', updatePosition);

    const handleClickOutside = (e) => {
      const isButtonClick = importMenuButtonRef.current && importMenuButtonRef.current.contains(e.target);
      const isMenuClick = importMenuRef.current && importMenuRef.current.contains(e.target);
      if (!isButtonClick && !isMenuClick) {
        setImportMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [importMenuOpen]);

  const totalPages = useMemo(() => {
    if (!totalRows) return 1;
    return Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  }, [totalRows]);

  useEffect(() => {
    setPageInput(page);
  }, [page]);

  const applyPageInput = () => {
    const nextPage = Number(pageInput);
    if (Number.isInteger(nextPage) && nextPage >= 1 && nextPage <= totalPages) {
      setPage(nextPage);
    } else {
      setPageInput(page);
    }
  };

  // Debounced search text — prevents a request on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const tid = setTimeout(() => setDebouncedSearch(filterText), 300);
    return () => clearTimeout(tid);
  }, [filterText]);

  // Reset to page 1 whenever the search query or column filter changes
  useEffect(() => {
    if (skipNextFilterResetRef.current > 0) {
      skipNextFilterResetRef.current -= 1;
      return;
    }
    setPage(1);
  }, [debouncedSearch, filterColumn]);

  // Unified data-loading effect — handles both paginated browsing and server-side search
  useEffect(() => {
    if (compareIds) return;
    let active = true;

    async function loadOfferings() {
      setLoading(true);
      setError('');

      try {
        const { rows: data, total: count } = await fetchCourseOfferings({
          page,
          limit: PAGE_SIZE,
          search: debouncedSearch,
          searchCol: filterColumn !== 'all' ? filterColumn : '',
          sortBy: sortConfig.key,
          sortOrder: sortConfig.direction,
        });

        if (!active) return;
        setOfferings(
          data.map((row) => ({
            ...row,
            department_name:
              row.departments?.department_name ??
              (row.department_id !== null && row.department_id !== undefined
                ? `Department #${row.department_id}`
                : null),
          }))
        );
        setTotalRows(count);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load course offerings.');
        setOfferings([]);
        setTotalRows(0);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadOfferings();
    return () => {
      active = false;
    };
  }, [page, refreshToken, sortConfig, debouncedSearch, filterColumn, compareIds]);

  // Load rooms data
  useEffect(() => {
    let active = true;

    async function loadRooms() {
      try {
        const { rows } = await fetchRooms({ page: 1, limit: 100000 });
        if (active) {
          setRooms(rows);
        }
      } catch (err) {
      }
    }

    loadRooms();
    return () => {
      active = false;
    };
  }, []);

  // Load all room bookings from DB for conflict detection across all pages
  useEffect(() => {
    let active = true;
    fetchRoomBookings()
      .then((rows) => { if (active) setRoomBookings(rows); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Load departments data
  useEffect(() => {
    let active = true;

    async function loadDepartments() {
      try {
        const rows = await fetchDepartments();
        if (active) {
          setDepartments(Array.isArray(rows) ? rows : []);
        }
      } catch (err) {
        setDepartments([]);
      }
    }

    loadDepartments();
    return () => {
      active = false;
    };
  }, []);

  // Compare mode: fetch exactly the two conflicting offerings by ID.
  useEffect(() => {
    if (!compareIds) return;
    let active = true;
    setLoading(true);
    setError('');
    Promise.all(compareIds.map((id) => fetchCourseOfferingById(id)))
      .then((results) => {
        if (!active) return;
        const rows = results
          .filter(Boolean)
          .map((row) => ({
            ...row,
            department_name:
              row.departments?.department_name ??
              (row.department_id != null ? `Department #${row.department_id}` : null),
          }));
        setOfferings(rows);
        setTotalRows(rows.length);
      })
      .catch(() => { if (active) { setOfferings([]); setTotalRows(0); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [compareIds]);

  const exitCompareMode = () => {
    setCompareIds(null);
    setRefreshToken((t) => t + 1);
  };

  // Handle scrolling to offering when it appears (after page navigation)
  useLayoutEffect(() => {
    if (!pendingScrollToOffering?.id) return;

    setHighlight(
      pendingScrollToOffering.id,
      'CourseOfferingView',
      pendingScrollToOffering.severity,
      {
        retry: true,
        maxWaitMs: 2500,
        pollIntervalMs: 16,
        onHighlighted: () => setPendingScrollToOffering(null),
      }
    );
  }, [pendingScrollToOffering, offerings, setHighlight]);

  async function findOfferingPageNumber(offeringId) {
    try {
      return await fetchCourseOfferingPageNumber(offeringId, {
        sortBy: sortConfig.key,
        sortOrder: sortConfig.direction,
        pageSize: PAGE_SIZE,
      });
    } catch (err) {
      return null;
    }
  }



  const startRow = totalRows === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endRow = Math.min(page * PAGE_SIZE, totalRows);

  const toggleRowExpand = (id) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const handleSort = (key) => {
    setSortConfig((currentSort) => ({
      key,
      direction: currentSort.key === key && currentSort.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  async function handleCheckDuplicateCode(code) {
    if (!code || code.trim() === '') {
      setDuplicateCodeSuggestions([]);
      return;
    }

    setCheckingDuplicateCode(true);
    try {
      const result = await checkDuplicateCode(code.trim());
      setDuplicateCodeSuggestions(result.suggestions || []);
    } catch (err) {
      setDuplicateCodeSuggestions([]);
    } finally {
      setCheckingDuplicateCode(false);
    }
  }

  async function handleAddOffering() {
    // Derive schedule strings from structured card state (null for disabled cards)
    const mthStr = mthCard.enabled ? buildScheduleString('mth', mthCard.mode, mthCard.startH, mthCard.startM, mthCard.endH, mthCard.endM, mthCard.type, mthCard.hasSec, mthCard.startH2, mthCard.startM2, mthCard.endH2, mthCard.endM2, mthCard.type2) : null;
    const tfsStr = tfsCard.enabled ? buildScheduleString('tfs', tfsCard.mode, tfsCard.startH, tfsCard.startM, tfsCard.endH, tfsCard.endM, tfsCard.type, tfsCard.hasSec, tfsCard.startH2, tfsCard.startM2, tfsCard.endH2, tfsCard.endM2, tfsCard.type2) : null;
    // Wednesday is stored in mth_schedule, appended with a comma and "W" day suffix
    const wedStr = wedCard.enabled ? buildScheduleString('wed', 'wed', wedCard.startH, wedCard.startM, wedCard.endH, wedCard.endM, wedCard.type, wedCard.hasSec, wedCard.startH2, wedCard.startM2, wedCard.endH2, wedCard.endM2, wedCard.type2) : null;
    const combinedMthStr = [mthStr, wedStr].filter(Boolean).join(', ') || null;
    const dataForValidation = { ...editingData, mth_schedule: combinedMthStr, tfs_schedule: tfsStr || null };

    if (!isFormValid(dataForValidation)) {
      setOfferingError(getDisabledReason(dataForValidation) || 'Please fill in all required fields');
      return;
    }

    try {
      setSavingOffering(true);
      setOfferingError(null);

      const mthRoomId = mthCard.enabled
        ? buildCombinedRoomId(editingData.mth_room_id)
        : null;

      const tfsRoomId = tfsCard.enabled
        ? buildCombinedRoomId(editingData.tfs_room_id)
        : null;

      const payload = {
        ...editingData,
        mth_schedule: combinedMthStr,
        tfs_schedule: tfsStr || null,
        mth_room_id: mthRoomId,
        tfs_room_id: tfsRoomId,
      };

      await createCourseOffering(payload);
      setSuccessMessage(`Created "${editingData.code}"`);
      setShowAddModal(false);
      setEditingData({});
      setMthCard(emptyCardState('mth'));
      setTfsCard(emptyCardState('tfs'));
      setWedCard(emptyCardState('wed'));
      setDuplicateCodeSuggestions([]);
      await loadInitialPage();
    } catch (err) {
      setOfferingError(err.message || 'Failed to create course offering');
    } finally {
      setSavingOffering(false);
    }
  }

  async function handleEditOffering(offering, notifItem = null) {
    setEditingId(offering.id);
    const mthRoomIds = resolveRoomIds(offering, 'mth').map(String);
    const tfsRoomIds = resolveRoomIds(offering, 'tfs').map(String);
    setEditingData({
      code: offering.code || '',
      course_no: offering.course_no || '',
      descriptive_title: offering.descriptive_title || '',
      curr_id: offering.curr_id || '',
      department_id: offering.department_id || '',
      section: offering.section || '',
      units: offering.units || 0,
      lec_hrs: offering.lec_hrs || 0,
      lab_hrs: offering.lab_hrs || 0,
      mth_schedule: offering.mth_schedule || '',
      mth_room_id: mthRoomIds,
      tfs_schedule: offering.tfs_schedule || '',
      tfs_room_id: tfsRoomIds,
    });
    // Pre-populate structured card state from existing schedule strings.
    // mth_schedule may contain both Mon/Thu and Wednesday entries; split them first.
    const { mthPart, wedPart } = splitMthAndWed(offering.mth_schedule || '');
    const mthParsed = parseScheduleString(mthPart, 'mth');
    setMthCard(mthParsed ? { enabled: true, ...mthParsed } : emptyCardState('mth'));
    const tfsParsed = parseScheduleString(offering.tfs_schedule || '', 'tfs');
    setTfsCard(tfsParsed ? { enabled: true, ...tfsParsed } : emptyCardState('tfs'));
    const wedParsed = parseScheduleString(wedPart, 'wed');
    setWedCard(wedParsed ? { enabled: true, ...wedParsed } : emptyCardState('wed'));
    setMthCardModified(false);
    setTfsCardModified(false);
    setWedCardModified(false);
    setEditingFromNotification(!!notifItem);
    setNotificationMissingFields(
      notifItem
        ? new Set((notifItem.issues || []).map((i) => i.field))
        : new Set()
    );
    setOfferingError(null);
  }

  async function performSaveEdit() {
    try {
      setSavingOffering(true);
      setOfferingError(null);

      // Preserve original complex schedule strings when the card was not touched by the user.
      // For mth_schedule, split into MTH and Wednesday parts to preserve each independently.
      const originalMthPart = splitMthAndWed(editingData.mth_schedule || '').mthPart;
      const originalWedPart = splitMthAndWed(editingData.mth_schedule || '').wedPart;

      const mthStr = mthCardModified
        ? (mthCard.enabled ? buildScheduleString('mth', mthCard.mode, mthCard.startH, mthCard.startM, mthCard.endH, mthCard.endM, mthCard.type, mthCard.hasSec, mthCard.startH2, mthCard.startM2, mthCard.endH2, mthCard.endM2, mthCard.type2) : null)
        : (originalMthPart || null);
      const tfsStr = tfsCardModified
        ? (tfsCard.enabled ? buildScheduleString('tfs', tfsCard.mode, tfsCard.startH, tfsCard.startM, tfsCard.endH, tfsCard.endM, tfsCard.type, tfsCard.hasSec, tfsCard.startH2, tfsCard.startM2, tfsCard.endH2, tfsCard.endM2, tfsCard.type2) : null)
        : (editingData.tfs_schedule || null);
      const wedStr = wedCardModified
        ? (wedCard.enabled ? buildScheduleString('wed', 'wed', wedCard.startH, wedCard.startM, wedCard.endH, wedCard.endM, wedCard.type, wedCard.hasSec, wedCard.startH2, wedCard.startM2, wedCard.endH2, wedCard.endM2, wedCard.type2) : null)
        : (originalWedPart || null);
      const combinedMthStr = [mthStr, wedStr].filter(Boolean).join(', ') || null;

      const mthRoomId = mthCard.enabled
        ? buildCombinedRoomId(editingData.mth_room_id)
        : null;

      const tfsRoomId = tfsCard.enabled
        ? buildCombinedRoomId(editingData.tfs_room_id)
        : null;

      const payload = {
        ...editingData,
        mth_schedule: combinedMthStr,
        tfs_schedule: tfsStr || null,
        mth_room_id: mthRoomId,
        tfs_room_id: tfsRoomId,
      };

      const savedId = editingId;
      await updateCourseOffering(savedId, payload);
      setSuccessMessage(`Updated "${editingData.code}"`);
      setEditingId(null);
      setEditingData({});
      setMthCard(emptyCardState('mth'));
      setTfsCard(emptyCardState('tfs'));
      setWedCard(emptyCardState('wed'));
      setWedCardModified(false);
      setEditingFromNotification(false);
      setNotificationMissingFields(new Set());
      // Re-sync notifications for this offering in the background then refresh both
      syncCourseOfferingNotifications(savedId)
        .then(() => { refreshNotifications(); refreshSubjectNotifications(); })
        .catch(() => {});
      await loadInitialPage();
    } catch (err) {
      if (String(err.message || '').includes('404')) {
        setEditingId(null);
        setEditingData({});
        setMthCard(emptyCardState('mth'));
        setTfsCard(emptyCardState('tfs'));
        setWedCard(emptyCardState('wed'));
        setWedCardModified(false);
        setEditingFromNotification(false);
        setNotificationMissingFields(new Set());
        await loadInitialPage();
        setUpdateError('That offering was removed. The list has been refreshed.');
        return;
      }
      setOfferingError(err.message || 'Failed to save offering');
    } finally {
      setSavingOffering(false);
      setConfirmDialog(null);
    }
  }

  async function handleSaveEdit() {
    if (!editingData.code) {
      setOfferingError('Course code is required');
      return;
    }
    setConfirmDialog({
      title: 'Save changes?',
      message: 'This will update the course offering with your current edits.',
      confirmLabel: 'Save Changes',
      cancelLabel: 'Keep Editing',
      tone: 'primary',
      onConfirm: performSaveEdit,
    });
  }

  async function handleDeleteOffering(offering) {
    const displayCode = offering.code || '(no code)';
    const displayTitle = offering.descriptive_title || '(no title)';
    setConfirmDialog({
      title: 'Delete offering?',
      message: `Delete "${displayCode} - ${displayTitle}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        try {
          setUpdateError(null);
          const result = await deleteCourseOffering(offering.id);
          setSuccessMessage(`Deleted "${offering.code}"`);
          if (result?.subjectDelete?.action === 'skipped') {
            setUpdateError('Warning: linked subject record could not be removed automatically.');
          }
          onSubjectMutated?.();
          await loadInitialPage();
        } catch (err) {
          if (String(err.message || '').includes('404')) {
            await loadInitialPage();
            setUpdateError('That offering was already removed. The list has been refreshed.');
            return;
          }
          setUpdateError(err.message || 'Failed to delete offering');
        } finally {
          setConfirmDialog(null);
        }
      },
    });
  }

  async function loadInitialPage() {
    setPage(1);
    setRefreshToken((current) => current + 1);
  }

  function handleClickImport() {
    if (!selectedCsvFile) {
      setImportError('Choose a CSV file first.');
      return;
    }
    setImportError('');
    setImportSummary(null);
    setShowBackupPrompt(true);
  }

  async function runImport() {
    setShowBackupPrompt(false);
    setImportingCsv(true);
    setImportError('');
    setImportSummary(null);
    setImportResultModal(null);

    try {
      const csvText = await selectedCsvFile.text();
      const response = await importCourseOfferingsCsv({
        csvText,
        fileName: selectedCsvFile.name,
        replaceMode,
      });

      const summary = response?.summary ?? null;
      setImportSummary(summary);
      setImportResultModal(summary);
      triggerCoRefresh();
      await loadInitialPage();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import CSV.');
    } finally {
      setImportingCsv(false);
    }
  }

  const numericCols = new Set(['units', 'lec_hrs', 'lab_hrs', 'curr_id', 'mth_room_id', 'tfs_room_id']);

  // Simplified column definitions for better header
  const columns = [
    { key: 'code', label: 'Code' },
    { key: 'curr_id', label: 'Curriculum ID' },
    { key: 'course_no', label: 'Course #' },
    { key: 'descriptive_title', label: 'Title' },
    { key: 'department_name', label: 'Department' },
    { key: 'section', label: 'Section' },
    { key: 'merged', label: 'Merged' },
    { key: 'units', label: 'Units' },
    { key: 'lec_hrs', label: 'Lecture Hrs' },
    { key: 'lab_hrs', label: 'Lab Hrs' },
    { key: 'mth_schedule', label: 'MTH Schedule' },
    { key: 'mth_room_id', label: 'MTH Room' },
    { key: 'tfs_schedule', label: 'TFS Schedule' },
    { key: 'tfs_room_id', label: 'TFS Room' },
  ];

  // Column groups for modal display
  const columnGroups = [
    {
      title: 'Course Info',
      color: 'bg-blue-50/80 border-blue-100',
      titleColor: 'text-blue-900',
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'course_no', label: 'Course #' },
        { key: 'descriptive_title', label: 'Title' },
      ],
    },
    {
      title: 'Curriculum',
      color: 'bg-purple-50/80 border-purple-100',
      titleColor: 'text-purple-900',
      columns: [
        { key: 'curr_id', label: 'Curriculum ID' },
        { key: 'department_name', label: 'Department' },
        { key: 'section', label: 'Section' },
        { key: 'merged', label: 'Merged' },
        { key: 'units', label: 'Units' },
        { key: 'lec_hrs', label: 'Lecture Hrs' },
        { key: 'lab_hrs', label: 'Lab Hrs' },
      ],
    },
    {
      title: 'Schedule',
      color: 'bg-green-50/80 border-green-100',
      titleColor: 'text-green-900',
      columns: [
        { key: 'mth_schedule', label: 'MTH Schedule' },
        { key: 'mth_room_id', label: 'MTH Room' },
        { key: 'tfs_schedule', label: 'TFS Schedule' },
        { key: 'tfs_room_id', label: 'TFS Room' },
      ],
    },
  ];

  // Set of column keys that are editable in notification-edit mode (null = all editable)
  const editableKeys = useMemo(() => {
    if (!editingFromNotification) return null;
    const keys = new Set();
    notificationMissingFields.forEach((field) => {
      const mapped = NOTIFICATION_FIELD_TO_KEY[field];
      if (Array.isArray(mapped)) mapped.forEach((k) => keys.add(k));
      else if (mapped) keys.add(mapped);
    });
    return keys;
  }, [editingFromNotification, notificationMissingFields]);


  // Server-side search and sort are now active — offerings already contain only matching results
  const displayedOfferings = offerings;

  // Strip schedule_conflict issues — those are shown exclusively in the Room Conflicts panel.
  const notificationsNoConflicts = useMemo(() => {
    return notifications
      .map((item) => ({
        ...item,
        issues: (item.issues || []).filter((i) => i.field !== 'schedule_conflict'),
        missingFields: (item.missingFields || []).filter((f) => f !== 'schedule_conflict'),
      }))
      .filter((item) => item.issues.length > 0);
  }, [notifications]);

  // Derive gym room IDs so the conflict hook can exclude gym rooms (mirrors backend behaviour).
  const gymRoomIds = useMemo(
    () =>
      new Set(
        rooms
          .filter((r) => /gym/i.test(r.room_name || ''))
          .map((r) => String(r.room_id ?? r.id))
      ),
    [rooms]
  );

  // Conflict set derived from full-DB room bookings — covers every page, not just the first 500 notifications.
  const { conflictingOfferingIds } = useConflictingIdSets(roomBookings, gymRoomIds);

  // Filter notifications by severity and search
  const filteredNotifications = useMemo(() => {
    let filtered = notificationsNoConflicts;

    // Filter by severity
    if (notificationFilter !== 'all') {
      filtered = filtered.filter((notif) => notif.severity === notificationFilter);
    }

    // Filter by search text (code or title)
    if (notificationSearch.trim()) {
      const q = notificationSearch.toLowerCase();
      filtered = filtered.filter((notif) => {
        const title = (notif.title || '').toLowerCase();
        const description = (notif.description || '').toLowerCase();
        const code = (notif.code || '').toLowerCase();
        return title.includes(q) || description.includes(q) || code.includes(q);
      });
    }

    return filtered;
  }, [notificationsNoConflicts, notificationFilter, notificationSearch]);

  // Calculate notification stats
  const notificationStats = useMemo(() => {
    return {
      total: notificationsNoConflicts.length,
      critical: notificationsNoConflicts.filter((n) => n.severity === 'critical').length,
      medium: notificationsNoConflicts.filter((n) => n.severity === 'medium').length,
      low: notificationsNoConflicts.filter((n) => n.severity === 'low').length,
    };
  }, [notificationsNoConflicts]);

  const focusNotificationItem = (item) => {
    if (!item?.offeringId) return;
    const targetRow = document.getElementById(`offering-row-${item.offeringId}`);
    if (targetRow) {
      setHighlight(item.offeringId, 'CourseOfferingView', item.severity);
    } else {
      // Offering not on current page, find which page it's on
      setFindingNotificationRow(true);
      findOfferingPageNumber(item.offeringId)
        .then((pageNum) => {
          if (pageNum && pageNum !== page) {
            skipNextFilterResetRef.current = 2;
            setFilterText('');
            setFilterColumn('all');
            setPage(pageNum);
            setPendingScrollToOffering({ id: item.offeringId, severity: item.severity || null });
          } else if (!pageNum) {
          }
        })
        .finally(() => setFindingNotificationRow(false));
    }
  };

  const editNotificationItem = (item) => {
    if (!item?.offeringId) return;

    let offering = offerings.find((row) => row.id === item.offeringId);

    if (offering) {
      handleEditOffering(offering, item);
      setHighlight(item.offeringId, 'CourseOfferingView', item.severity);
    } else {
      // Offering not on current page, fetch it by ID
      setFindingNotificationRow(true);
      fetchCourseOfferingById(item.offeringId)
        .then((offering) => {
          if (offering) {
            handleEditOffering(offering, item);
            // Navigate to the page this offering is on
            return findOfferingPageNumber(item.offeringId);
          }
          throw new Error('Offering not found');
        })
        .then((pageNum) => {
          if (pageNum && pageNum !== page) {
            skipNextFilterResetRef.current = 2;
            setFilterText('');
            setFilterColumn('all');
            setPage(pageNum);
            setPendingScrollToOffering({ id: item.offeringId, severity: item.severity || null });
          }
        })
        .catch((err) => {
          setOfferingError('Could not load offering for editing');
        })
        .finally(() => setFindingNotificationRow(false));
    }
  };

  const handleInlineSave = async ({ offeringId, field, value }) => {
    const keyMap = {
      'Course Code': 'code', 'Course Number': 'course_no', 'Course Title': 'descriptive_title',
      'Curriculum': 'curr_id', 'Credit Units': 'units', 'Lecture Hours': 'lec_hrs',
      'code': 'code', 'course_no': 'course_no', 'descriptive_title': 'descriptive_title',
      'curr_id': 'curr_id', 'units': 'units', 'lec_hrs': 'lec_hrs',
    };
    const dbField = keyMap[field] || field;
    try {
      await updateCourseOffering(offeringId, { [dbField]: value });
      syncCourseOfferingNotifications(offeringId)
        .then(() => { refreshNotifications(); refreshSubjectNotifications(); })
        .catch(() => {});
    } catch (err) {
    }
  };

  const renderCellValue = (value) => {
    if (value === null || value === undefined) return <span className="text-slate-400">—</span>;
    return String(value);
  };

  const buildCombinedRoomId = (roomArr) => {
    const ids = (Array.isArray(roomArr) ? roomArr : []).filter(Boolean);
    if (!ids.length) return null;
    if (ids.length === 1 || ids[0] === ids[1]) return ids[0];
    return `${ids[0]}/${ids[1]}`;
  };

  // Resolve room ids for an offering and a logical field key (mth or tfs)
  const resolveRoomIds = (offering, key) => {
    // key will be 'mth' or 'tfs' when called, we map to field names
    const singleField = `${key}_room_id`;
    const idsField = `${key}_room_ids`;
    const objsField = `${key}_rooms`;

    // 1) If API returns explicit ids array
    if (Array.isArray(offering[idsField])) {
      return offering[idsField].map((v) => Number(v)).filter((v) => !Number.isNaN(v));
    }

    // 2) If API returns array of room objects
    if (Array.isArray(offering[objsField])) {
      return offering[objsField]
        .map((r) => (r && (r.id ?? r.room_id) != null ? Number(r.id ?? r.room_id) : null))
        .filter((v) => v !== null && !Number.isNaN(v));
    }

    // 3) If legacy single field contains slash-separated ids or single id
    const singleVal = offering[singleField];
    if (singleVal === null || singleVal === undefined || singleVal === '') return [];
    // handle numbers, numeric strings, or '11/12' style
    if (typeof singleVal === 'number') return [singleVal];
    if (Array.isArray(singleVal)) return singleVal.map((v) => Number(v)).filter((v) => !Number.isNaN(v));
    const parts = String(singleVal).split('/').map((p) => p.trim()).filter((p) => p !== '');
    return parts.map((p) => Number(p)).filter((v) => !Number.isNaN(v));
  };

  const renderRoomCell = (offering, key) => {
    const logical = key === 'mth_room_id' ? 'mth' : 'tfs';
    const ids = resolveRoomIds(offering, logical);
    if (!ids || ids.length === 0) return <span className="text-slate-400">—</span>;
    const names = ids.map((id) => getRoomName(id));
    return <span className="text-sm text-on-surface-variant">{names.join(' / ')}</span>;
  };

  const toggleRoomSelection = (field, roomId) => {
    const roomValue = String(roomId);
    setEditingData((current) => {
      const currentValues = Array.isArray(current[field]) ? current[field].map(String) : [];
      const nextValues = currentValues.includes(roomValue)
        ? currentValues.filter((value) => value !== roomValue)
        : [...currentValues, roomValue];

      return {
        ...current,
        [field]: nextValues,
      };
    });
  };

  const renderRoomPicker = (field) => {
    const selectedValues = Array.isArray(editingData[field]) ? editingData[field].map(String) : [];
    const selectedRoomNames = selectedValues.map((roomId) => getRoomName(roomId));
    const scheduleType = field === 'mth_room_id' ? 'mth' : 'tfs';

    return (
      <div className="space-y-3 rounded-lg border border-white/60 bg-white/70 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold uppercase tracking-[0.18em] text-on-surface-variant/60">
            Selected Rooms:
          </span>
          {selectedRoomNames.length ? (
            selectedRoomNames.map((roomName, index) => (
              <span
                key={`${field}-selected-${index}`}
                className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"
              >
                {roomName}
              </span>
            ))
          ) : (
            <span className="text-sm text-on-surface-variant/70">None selected</span>
          )}
        </div>
        <div className="max-h-56 space-y-2 overflow-y-auto pr-2">
          {!rooms || rooms.length === 0 ? (
            <p className="text-sm text-on-surface-variant">
              {rooms === null ? 'Loading rooms...' : 'No rooms available'}
            </p>
          ) : (
            rooms.map((room, idx) => {
              const roomId = room?.room_id !== undefined ? room.room_id : (room?.id !== undefined ? room.id : null);

              if (roomId === null || roomId === undefined) {
                return null;
              }

              const roomIdStr = String(roomId);
              const isChecked = selectedValues.includes(roomIdStr);
              const conflicts = getConflictingOfferings(roomIdStr, scheduleType);
              const conflictCount = conflicts.filter((o) => o.id !== editingId && !isMergedSubject(o, editingData)).length;

              return (
                <div key={roomIdStr}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-base text-on-surface-variant transition-colors hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleRoomSelection(field, roomIdStr)}
                      className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary/30"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-on-surface break-words text-base">
                        {room?.room_name || `Room ${roomId}`}
                      </span>
                      {room?.room_type && (
                        <span className="ml-2 text-sm text-on-surface-variant/70">
                          ({room.room_type})
                        </span>
                      )}
                    </div>
                    <span className="text-sm text-on-surface-variant/70 flex-shrink-0">#{roomId}</span>
                  </label>
                  {conflictCount > 0 && (
                    <p className="ml-10 text-sm text-amber-600">
                      ⚠️ Used by {conflictCount} other offering(s)
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
        <p className="text-sm uppercase tracking-[0.18em] text-on-surface-variant/60">
          {selectedValues.length ? `${selectedValues.length} room(s) selected` : 'No rooms selected'}
        </p>
      </div>
    );
  };

  const getRoomName = (roomId) => {
    if (roomId === null || roomId === undefined || roomId === '') return '—';
    const idNum = Number(roomId);
    if (isNaN(idNum)) return `Room ${roomId}`;
    return roomById.get(idNum) ?? `Room ${roomId}`;
  };

  const toggleColumnVisibility = (columnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }
      return next;
    });
  };

  const toggleSelectOffering = (offeringId) => {
    setSelectedOfferings((prev) => {
      const next = new Set(prev);
      if (next.has(offeringId)) {
        next.delete(offeringId);
      } else {
        next.add(offeringId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    // Toggle selection for the currently displayed page only
    const pageIds = (displayedOfferings || []).map((o) => o.id);
    if (selectedOfferings.size === pageIds.length && pageIds.length > 0) {
      setSelectedOfferings(new Set());
    } else {
      setSelectedOfferings(new Set(pageIds));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedOfferings.size === 0) return;
    setConfirmDialog({
      title: `Delete ${selectedOfferings.size} offering(s)?`,
      message: 'This action cannot be undone.',
      confirmLabel: 'Delete All',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        try {
          setUpdateError(null);
          const deletePromises = Array.from(selectedOfferings).map((id) =>
            deleteCourseOffering(id)
          );
          await Promise.all(deletePromises);
          setSelectedOfferings(new Set());
          setSuccessMessage(`Deleted ${selectedOfferings.size} offering(s)`);
          await loadInitialPage();
        } catch (err) {
          setUpdateError(err.message || 'Failed to delete offerings');
        } finally {
          setConfirmDialog(null);
        }
      },
    });
  };

  const isMergedSubject = (offering, compareTo) => {
    const norm = (s) => String(s || '').trim().toUpperCase();

    // Same course in same curriculum+department → intentional room-share (different sections)
    if (offering.curr_id && compareTo.curr_id &&
        String(offering.curr_id) === String(compareTo.curr_id) &&
        String(offering.department_id) === String(compareTo.department_id) &&
        norm(offering.course_no || '') === norm(compareTo.course_no || '') &&
        norm(offering.course_no || '') !== '') {
      return true;
    }

    // Explicitly flagged as merged
    if (offering.merged === true || compareTo.merged === true) return true;

    const mthA = norm(offering.mth_schedule);
    const mthB = norm(compareTo.mth_schedule);
    const tfsA = norm(offering.tfs_schedule);
    const tfsB = norm(compareTo.tfs_schedule);

    if (!mthA && !tfsA) return false;
    if (mthA !== mthB || tfsA !== tfsB) return false;

    const toIds = (val) => {
      if (Array.isArray(val)) return val.map(String).filter(Boolean);
      return String(val || '').split('/').map((s) => s.trim()).filter(Boolean);
    };
    const shareRoom = (idsA, idsB) => {
      if (!idsA.length || !idsB.length) return false;
      const setB = new Set(idsB);
      return idsA.some((id) => setB.has(id));
    };

    const mthRoomA = toIds(offering.mth_room_id);
    const mthRoomB = toIds(compareTo.mth_room_id);
    const tfsRoomA = toIds(offering.tfs_room_id);
    const tfsRoomB = toIds(compareTo.tfs_room_id);

    if (mthRoomA.length && !shareRoom(mthRoomA, mthRoomB)) return false;
    if (tfsRoomA.length && !shareRoom(tfsRoomA, tfsRoomB)) return false;

    // Same schedule + same room is a merge only if same course_no AND same descriptive_title.
    // Mirrors Python merge_detector.py: title match is required to avoid flagging as a conflict.
    const sameCourse = norm(offering.course_no || '') !== '' &&
      norm(offering.course_no || '') === norm(compareTo.course_no || '');
    const sameTitle = norm(offering.descriptive_title || '') !== '' &&
      norm(offering.descriptive_title || '') === norm(compareTo.descriptive_title || '');
    return sameCourse && sameTitle;
  };

  // Pre-computed room id→name map: avoids O(n) linear scan per getRoomName call
  const roomById = useMemo(() => {
    const map = new Map();
    for (const r of rooms) {
      if (!r) continue;
      const name = r.room_name || r.name;
      if (r.room_id != null) map.set(Number(r.room_id), name || `Room ${r.room_id}`);
      else if (r.id != null) map.set(Number(r.id), name || `Room ${r.id}`);
    }
    return map;
  }, [rooms]);

  // Full-DB room conflict map — used for the room picker conflict warnings
  const { getConflictingOfferings } = useRoomConflictMap(roomBookings);

  const exportToCSV = async () => {
    if (offerings.length === 0) {
      setUpdateError('No offerings to export');
      return;
    }

    try {
      setLoading(true);
      setUpdateError(null);

      let allOfferings = offerings;
      let usedCurrentPageFallback = false;

      try {
        // Fetch all matching rows (respects current search + sort) for the export
        const { rows } = await fetchCourseOfferings({
          page: 1,
          limit: 10000,
          search: debouncedSearch,
          searchCol: filterColumn !== 'all' ? filterColumn : '',
          sortBy: sortConfig.key,
          sortOrder: sortConfig.direction,
        });
        allOfferings = rows.map((row) => ({
          ...row,
          department_name:
            row.departments?.department_name ??
            (row.department_id !== null && row.department_id !== undefined
              ? `Department #${row.department_id}`
              : null),
        }));
      } catch (err) {
        setUpdateError('Failed to fetch all offerings. Exporting current page only.');
        usedCurrentPageFallback = true;
      }

      const headers = Array.from(visibleColumns).map((key) => {
        const col = columns.find((c) => c.key === key);
        return col ? col.label : key;
      });

      const rows = allOfferings.map((offering) =>
        Array.from(visibleColumns).map((key) => {
          let value = offering[key];
          if (key === 'mth_room_id' || key === 'tfs_room_id') {
            const logical = key === 'mth_room_id' ? 'mth' : 'tfs';
            const ids = resolveRoomIds(offering, logical);
            value = ids.map((id) => getRoomName(id)).join(' / ');
          }
          if (value === null || value === undefined) return '';
          return String(value);
        })
      );

      const csvContent = [
        headers.join(','),
        ...rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      const link = document.createElement('a');
      link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`;
      const fileName = `course-offerings-${new Date().toISOString().split('T')[0]}.csv`;
      link.download = fileName;

      await recordCourseOfferingExportAudit({
        fileName,
        rowCount: allOfferings.length,
        columns: headers,
        filters: {
          search: debouncedSearch,
          searchCol: filterColumn !== 'all' ? filterColumn : '',
        },
        sort: {
          sortBy: sortConfig.key,
          sortOrder: sortConfig.direction,
        },
        usedCurrentPageFallback,
      });

      link.click();

      setUpdateError(null);
    } catch (err) {
      setUpdateError(err.message || 'Failed to export offerings');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <div className="space-y-2 animate-in slide-in-from-right-4 duration-500">
      {/* Header — identity + health monitoring only */}
      <div className="glass-panel p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Identity */}
          <div>
            <h2 className="text-2xl font-bold text-on-surface">Course Offerings</h2>
            <div className="mt-0.5 flex items-center gap-2">
              <p className="text-xs text-on-surface-variant">Manage offerings, schedules, and room assignments.</p>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/70 px-2 py-0.5 text-xs font-semibold text-on-surface-variant backdrop-blur">
                <BookMarked size={10} className="text-primary" />
                {totalRows}
              </span>
            </div>
          </div>
          {/* Monitoring */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-stretch gap-1 rounded-xl border border-white/60 bg-white/80 p-1.5 backdrop-blur shadow-sm">
              <NotificationButton
                title="Missing Data"
                buttonLabel="Issues"
                emptyLabel="No missing data detected."
                panelSize="lg"
                items={filteredNotifications}
                onItemJump={focusNotificationItem}
                onItemEdit={editNotificationItem}
                onItemResolve={resolveNotificationItem}
                onItemInlineSave={handleInlineSave}
                severityFilter={notificationFilter}
                onSeverityFilterChange={setNotificationFilter}
                notificationSearch={notificationSearch}
                onNotificationSearchChange={setNotificationSearch}
                notificationStats={notificationStats}
                isRescanning={rescanning}
                totalEntityCount={totalRows}
              />
              <div className="h-5 w-px bg-slate-200" />
              <button
                type="button"
                onClick={handleForceRescan}
                disabled={rescanning}
                title="Clear and re-detect all schedule conflicts and missing data"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[40px] min-w-max"
              >
                <RefreshCw size={14} className={rescanning ? 'animate-spin' : ''} />
                <span>{rescanning ? 'Scanning' : 'Rescan'}</span>
              </button>
            </div>
            <div className="flex items-stretch gap-1 rounded-xl border border-white/60 bg-white/80 p-1.5 backdrop-blur shadow-sm">
              <RoomConflictsPanel
                items={notifications}
                rooms={rooms}
                entityType="offering"
                onItemJump={focusNotificationItem}
                onItemEdit={editNotificationItem}
                onCompare={(primaryId, peerId) => setCompareIds([primaryId, peerId])}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Controls: Search + Toolbar */}
      <div className="glass-panel space-y-3 p-3">
        {/* Search row — full width */}
        <div className="flex gap-3">
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
              aria-label="Search course offerings"
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

        {/* Action toolbar row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary: Add */}
          <button
            className="btn-primary flex items-center gap-1.5 text-xs px-3 py-2 min-h-[44px]"
            onClick={() => {
              setShowAddModal(true);
              setEditingData({ mth_room_id: [], tfs_room_id: [] });
              setMthCard(emptyCardState('mth'));
              setTfsCard(emptyCardState('tfs'));
              setWedCard(emptyCardState('wed'));
              setWedCardModified(false);
              setOfferingError(null);
            }}
            type="button"
            title="Add new course offering"
          >
            <PlusCircle size={14} />
            <span>Add</span>
          </button>

          {/* Import dropdown trigger */}
          <button
            ref={importMenuButtonRef}
            type="button"
            onClick={() => setImportMenuOpen((prev) => !prev)}
            title="Import CSV"
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors min-h-[44px] ${
              replaceMode ? 'bg-orange-500 hover:bg-orange-600' : 'bg-primary hover:bg-primary/90'
            }`}
          >
            <Upload size={14} />
            <span>Import</span>
            {selectedCsvFile && (
              <span className="h-2 w-2 rounded-full bg-white/80" title={selectedCsvFile.name} />
            )}
          </button>

          {/* Import dropdown portal */}
          {importMenuOpen && typeof document !== 'undefined' && createPortal(
            <div
              ref={importMenuRef}
              style={{ position: 'fixed', top: `${importMenuPos.top}px`, left: `${importMenuPos.left}px`, zIndex: 9999 }}
              className="w-72 rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
            >
              {/* File picker */}
              <div className="p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">CSV File</p>
                <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                  selectedCsvFile
                    ? 'border-primary/40 bg-primary/5 text-primary'
                    : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                }`}>
                  <FileUp size={15} className="shrink-0" />
                  <span className="flex-1 truncate font-medium">
                    {selectedCsvFile ? selectedCsvFile.name : 'Choose CSV file…'}
                  </span>
                  {selectedCsvFile && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="rounded p-0.5 hover:bg-primary/20"
                      title="Clear file"
                      onClick={(e) => {
                        e.preventDefault();
                        setSelectedCsvFile(null);
                        setImportError('');
                        setImportSummary(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedCsvFile(null);
                          setImportError('');
                          setImportSummary(null);
                        }
                      }}
                    >
                      <X size={13} />
                    </span>
                  )}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setSelectedCsvFile(file);
                      setImportError('');
                      setImportSummary(null);
                    }}
                  />
                </label>
              </div>

              <div className="border-t border-slate-100" />

              {/* Replace mode */}
              <div className="p-3">
                <label className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                  replaceMode ? 'bg-orange-50' : 'hover:bg-slate-50'
                }`}>
                  <input
                    type="checkbox"
                    checked={replaceMode}
                    onChange={(e) => setReplaceMode(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-orange-500"
                  />
                  <div>
                    <span className={`text-sm font-semibold ${replaceMode ? 'text-orange-700' : 'text-slate-700'}`}>
                      Replace All
                    </span>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Clears all offerings &amp; subjects, then rebuilds from CSV.
                    </p>
                    {replaceMode && (
                      <span className="mt-1 inline-block rounded bg-orange-200 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-orange-800">
                        New Semester
                      </span>
                    )}
                  </div>
                </label>
              </div>

              <div className="border-t border-slate-100" />

              {/* Import action */}
              <div className="p-3">
                <button
                  className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 min-h-[44px] ${
                    replaceMode ? 'bg-orange-500 hover:bg-orange-600' : 'bg-primary hover:bg-primary/90'
                  }`}
                  onClick={() => { setImportMenuOpen(false); handleClickImport(); }}
                  type="button"
                  disabled={importingCsv || !selectedCsvFile}
                  title={replaceMode ? 'Import and replace all existing data' : 'Import CSV — update or add rows'}
                >
                  <Upload size={15} />
                  <span>{importingCsv ? 'Importing…' : replaceMode ? 'Replace & Import' : 'Import CSV'}</span>
                </button>
              </div>
            </div>,
            document.body
          )}

          {/* Export */}
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/60 bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 min-h-[44px]"
            onClick={exportToCSV}
            type="button"
            title="Export to CSV"
          >
            <Download size={14} />
            <span>Export</span>
          </button>

          {/* Divider */}
          <div className="h-6 w-px bg-slate-200 mx-0.5" />

          {/* Utility: Reload, Cols, Reset */}
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/60 bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 min-h-[44px]"
            onClick={loadInitialPage}
            type="button"
            title="Reload data"
          >
            <RefreshCw size={14} />
            <span>Reload</span>
          </button>
          <button
            ref={colButtonRef}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/60 bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 min-h-[44px]"
            onClick={() => setColMenuOpen((prev) => !prev)}
            type="button"
            aria-label="Show/hide columns"
            title="Column visibility"
          >
            <Settings size={14} />
            <span>Cols</span>
          </button>
          {colMenuOpen && typeof document !== 'undefined' && createPortal(
            <div
              ref={colMenuRef}
              style={{ position: 'fixed', top: `${colMenuPos.top}px`, left: `${colMenuPos.left}px`, zIndex: 9999 }}
              className="bg-white border border-slate-200 rounded-lg shadow-2xl p-2 min-w-max"
            >
              {columns.map((col) => (
                <label
                  key={col.key}
                  className="flex items-center gap-2 px-3 py-2.5 text-sm text-on-surface hover:bg-primary/5 rounded cursor-pointer whitespace-nowrap transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={visibleColumns.has(col.key)}
                    onChange={() => toggleColumnVisibility(col.key)}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                  />
                  {col.label}
                </label>
              ))}
            </div>,
            document.body
          )}
          <button
            onClick={() => { setFilterText(''); setFilterColumn('all'); setSortConfig({ key: 'code', direction: 'asc' }); }}
            className="rounded-lg border border-white/60 bg-white px-3 py-2 text-xs font-bold text-on-surface-variant transition-all hover:bg-slate-50 min-h-[44px]"
          >
            Reset
          </button>
        </div>

        {/* Error Messages */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
            <AlertCircle size={18} />
            {error}
          </div>
        )}
        {updateError && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
            <AlertCircle size={18} />
            {updateError}
          </div>
        )}
        {importError && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
            <AlertCircle size={18} />
            {importError}
          </div>
        )}
        {importSummary && (
          <div className="space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-emerald-900">
            <div className="flex flex-wrap gap-x-6 gap-y-2 font-medium text-base">
              <span>Total: {importSummary.totalRows}</span>
              <span>Processed: {importSummary.processedRows}</span>
              <span>Inserted: {importSummary.insertedRows}</span>
              <span>Updated: {importSummary.updatedRows}</span>
              <span>Failed: {importSummary.failedRows}</span>
              <span>Skipped: {importSummary.skippedRows}</span>
            </div>
            {Array.isArray(importSummary.errors) && importSummary.errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-800/80">
                  Row Errors
                </p>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-emerald-100 bg-white/80 p-2">
                  {importSummary.errors.slice(0, 20).map((issue) => (
                    <p key={`csv-error-${issue.row}-${(issue.messages || []).join('|')}`} className="text-sm text-red-700">
                      Row {issue.row}: {Array.isArray(issue.messages) ? issue.messages.join('; ') : 'Unknown row error'}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Contextual selection bar — only rendered when rows are selected */}
      {selectedOfferings.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-red-700">
            <Trash2 size={15} className="shrink-0" />
            {selectedOfferings.size} offering{selectedOfferings.size > 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedOfferings(new Set())}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 hover:text-red-700 hover:bg-red-100 transition-colors"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 min-h-[36px]"
            >
              <Trash2 size={13} />
              Delete Selected
            </button>
          </div>
        </div>
      )}

      {/* Compare Mode Banner */}
      {compareIds && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700">
          <GitCompare size={15} className="shrink-0 text-blue-500" />
          <span>Compare Mode — showing 2 conflicting rows</span>
          <button
            type="button"
            onClick={exitCompareMode}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            <X size={12} />
            Exit Compare
          </button>
        </div>
      )}

      {/* Data Table - Compact */}
      <div className="glass-panel overflow-hidden flex-1">
        <div className="max-h-[calc(100vh-18rem)] overflow-auto pb-4">
          <table className="min-w-full w-full text-left text-xs">
            <thead>
                <tr className="sticky top-0 z-20 border-b border-white bg-white">
                  <th className="px-3 py-3 text-center w-12">
                    <input
                      type="checkbox"
                      checked={(displayedOfferings || []).length > 0 && selectedOfferings.size === (displayedOfferings || []).length}
                      indeterminate={selectedOfferings.size > 0 && selectedOfferings.size < (displayedOfferings || []).length ? true : undefined}
                      onChange={toggleSelectAll}
                      className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary/30"
                    />
                  </th>
                  {columns.map((col) => {
                    if (!visibleColumns.has(col.key)) return null;
                    return (
                      <th key={col.key} className={`px-3 py-3 ${col.key === 'code' || col.key === 'curr_id' ? 'text-center' : 'text-left'}`} scope="col">
                        <button type="button" onClick={() => handleSort(col.key)} className={`flex items-center justify-start gap-1 text-xs font-bold uppercase tracking-[0.28em] transition-colors ${
                          sortConfig.key === col.key ? 'text-primary' : 'text-on-surface-variant/70 hover:text-on-surface'
                        }`} aria-pressed={sortConfig.key === col.key ? 'true' : 'false'}>
                          <span>{col.label}</span>
                          <ArrowUpDown size={10} />
                        </button>
                      </th>
                    );
                  })}
                  <th className="sticky right-0 z-30 bg-white px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.28em] text-on-surface-variant/70">Act</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-black">
              {loading && (
                <tr>
                  <td
                    className="px-3 py-4 text-center text-xs text-on-surface-variant"
                    colSpan={columns.filter((c) => visibleColumns.has(c.key)).length + 2}
                  >
                    Loading...
                  </td>
                </tr>
              )}

              {!loading && error && (
                <tr>
                  <td
                    className="px-3 py-4 text-center text-xs text-error"
                    colSpan={columns.filter((c) => visibleColumns.has(c.key)).length + 2}
                  >
                    {error}
                  </td>
                </tr>
              )}

              {!loading && !error && offerings.length === 0 && (
                <tr>
                  <td
                    className="px-3 py-4 text-center text-xs text-on-surface-variant"
                    colSpan={columns.filter((c) => visibleColumns.has(c.key)).length + 2}
                  >
                    No offerings found.
                  </td>
                </tr>
              )}

              {!loading && !error && displayedOfferings.map((offering, index) => {
                const isSelected = selectedOfferings.has(offering.id);
                const hasConflict = conflictingOfferingIds.has(offering.id);
                return (
                  <tr id={`offering-row-${offering.id}`} key={offering.id} className={`transition-colors ${isSelected ? 'bg-primary/10' : hasConflict ? 'bg-red-50/70' : 'hover:bg-white/40'} ${index % 2 === 0 && !isSelected && !hasConflict ? 'bg-white/6' : ''}`}>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectOffering(offering.id)}
                        className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary/30"
                      />
                    </td>
                  {columns.map((col) => {
                    if (!visibleColumns.has(col.key)) return null;
                    return (
                      <td key={col.key} className={`px-3 py-3 truncate ${col.key === 'code' || col.key === 'curr_id' ? 'text-center' : ''}`}>
                        {col.key === 'code' ? (
                          <div className="flex flex-col items-center gap-1">
                            <span className="inline-block rounded-md bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
                              {renderCellValue(offering[col.key])}
                            </span>
                            {hasConflict && (
                              <span className="inline-block rounded-md bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                                Conflict
                              </span>
                            )}
                          </div>
                        ) : col.key === 'course_no' ? (
                          <span className="text-xs font-medium text-on-surface">
                            {renderCellValue(offering[col.key])}
                          </span>
                        ) : col.key === 'descriptive_title' ? (
                          <span className="text-xs text-on-surface-variant truncate max-w-xs block">{renderCellValue(offering[col.key])}</span>
                        ) : col.key === 'units' ? (
                          <span className="text-xs font-medium text-on-surface">
                            {renderCellValue(offering[col.key])}
                          </span>
                        ) : col.key === 'lec_hrs' || col.key === 'lab_hrs' ? (
                          <span className="text-xs font-medium text-on-surface-variant">
                            {renderCellValue(offering[col.key])}h
                          </span>
                        ) : col.key === 'mth_room_id' || col.key === 'tfs_room_id' ? (
                          <span className="text-xs text-on-surface-variant">{renderRoomCell(offering, col.key)}</span>
                        ) : col.key === 'merged' ? (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                            {offering.merged === true || offering.merged === 'true'
                              ? 'Merged'
                              : offering.merged === false || offering.merged === 'false'
                              ? '—'
                              : String(offering.merged ?? '—')}
                          </span>
                        ) : col.key === 'mth_schedule' || col.key === 'tfs_schedule' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant flex-wrap">
                            {formatScheduleDisplay(offering[col.key]) ?? renderCellValue(offering[col.key])}
                            {isSimpleSchedule(offering[col.key]) && getScheduleAmPm(offering[col.key]) && (
                              <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${getScheduleAmPm(offering[col.key]) === 'AM' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                                {getScheduleAmPm(offering[col.key])}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-on-surface-variant truncate">
                            {renderCellValue(offering[col.key])}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 bg-white px-3 py-3">
                    <div className="flex justify-center gap-2">
                      <button
                        onClick={() => handleEditOffering(offering)}
                        className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-white hover:text-primary min-h-[40px] min-w-[40px] flex items-center justify-center"
                        title="Edit"
                        aria-label={`Edit offering ${offering.code}`}
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteOffering(offering)}
                        className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 min-h-[40px] min-w-[40px] flex items-center justify-center"
                        title="Delete"
                        aria-label={`Delete offering ${offering.code}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination - hidden in compare mode */}
      {!compareIds && (
        <div className="flex items-center justify-between rounded-xl border border-white/50 bg-white/60 px-4 py-2 gap-3">
          <p className="text-sm font-semibold uppercase tracking-wider text-on-surface-variant/80 whitespace-nowrap">
            {startRow}-{endRow} / {totalRows}
          </p>
          <div className="flex items-center gap-3">
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-white/60 bg-white px-4 py-2.5 text-sm font-semibold text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px] min-w-[44px]"
              disabled={page <= 1 || loading}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              type="button"
              title="Previous page"
            >
              <ChevronLeft size={16} />
              Prev
            </button>

            <div className="flex items-center gap-3 rounded-lg border border-white/60 bg-white px-3 py-2.5">
              <span className="text-sm text-on-surface-variant">Page</span>
              <input
                type="number"
                min="1"
                max={totalPages}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={applyPageInput}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyPageInput();
                }}
                className="w-16 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-right text-base text-slate-800 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
              <span className="text-sm text-on-surface-variant">of {totalPages}</span>
            </div>

            <button
              className="inline-flex items-center gap-2 rounded-lg border border-white/60 bg-white px-4 py-2.5 text-sm font-semibold text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px] min-w-[44px]"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              type="button"
              title="Next page"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Full-screen Import Loading Overlay — freezes all interaction while import is running */}
      {importingCsv && (
        <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-white/20 bg-white/10 p-8 text-white shadow-2xl">
            {/* Spinner */}
            <div className="relative h-16 w-16">
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-white/20 border-t-white" />
              <div className="absolute inset-2 animate-spin rounded-full border-4 border-white/10 border-t-white/60" style={{ animationDirection: 'reverse', animationDuration: '0.8s' }} />
            </div>

            <div className="space-y-1.5 text-center">
              <p className="text-lg font-bold tracking-tight">
                {replaceMode ? 'Replacing Data…' : 'Importing CSV…'}
              </p>
              <p className="text-sm text-white/70">
                {replaceMode
                  ? 'Clearing existing data and importing fresh records. Please wait.'
                  : 'Processing your CSV file. Please wait.'}
              </p>
              <p className="text-xs text-white/50">Do not close or refresh this page.</p>
            </div>

            {replaceMode && (
              <div className="w-full rounded-lg border border-orange-300/30 bg-orange-500/20 px-4 py-2.5 text-center text-xs text-orange-200">
                Replace mode: deleting all Course Offerings &amp; Subjects, then rebuilding from CSV. Room records are not affected.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Import Result Modal — shown after import completes */}
      {importResultModal && !importingCsv && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/60 bg-white shadow-2xl overflow-hidden">

            {/* Header */}
            <div className={`px-6 py-5 ${importResultModal.failedRows > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-white">
                  {importResultModal.failedRows > 0 ? <AlertCircle size={22} /> : <Check size={22} />}
                  <span className="font-bold text-lg">
                    {importResultModal.failedRows > 0 ? 'Import Completed with Errors' : 'Import Successful'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setImportResultModal(null)}
                  className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                  aria-label="Close import result modal"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="px-6 py-6 space-y-5">
              {/* Mode badge */}
              {importResultModal.replaceMode && (
                <div className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-4 py-2 text-sm font-semibold text-orange-700">
                  <span>Replace Mode — Course Offerings &amp; Subjects were cleared first</span>
                </div>
              )}

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Total Rows', value: importResultModal.totalRows, color: 'bg-slate-50 text-slate-700' },
                  { label: 'Inserted', value: importResultModal.insertedRows, color: 'bg-emerald-50 text-emerald-700' },
                  { label: 'Updated', value: importResultModal.updatedRows, color: 'bg-blue-50 text-blue-700' },
                  { label: 'Skipped', value: importResultModal.skippedRows, color: 'bg-slate-50 text-slate-500' },
                  { label: 'Failed', value: importResultModal.failedRows, color: importResultModal.failedRows > 0 ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-400' },
                  { label: 'Subjects Synced', value: importResultModal.syncedSubjectRows, color: 'bg-purple-50 text-purple-700' },
                ].map(({ label, value, color }) => (
                  <div key={label} className={`rounded-xl ${color} flex flex-col items-center justify-center p-4`}>
                    <span className="text-3xl font-bold">{value ?? 0}</span>
                    <span className="text-xs font-medium text-center leading-tight mt-1">{label}</span>
                  </div>
                ))}
              </div>

              {/* Row errors */}
              {Array.isArray(importResultModal.errors) && importResultModal.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-bold uppercase tracking-widest text-red-600">
                    Row Errors ({importResultModal.errors.length})
                  </p>
                  <div className="max-h-36 space-y-2 overflow-y-auto rounded-xl border border-red-100 bg-red-50 p-3">
                    {importResultModal.errors.slice(0, 30).map((issue) => (
                      <p
                        key={`result-error-${issue.row}-${(issue.messages || []).join('|')}`}
                        className="text-sm text-red-700"
                      >
                        <span className="font-bold">Row {issue.row}:</span>{' '}
                        {Array.isArray(issue.messages) ? issue.messages.join('; ') : 'Unknown error'}
                      </p>
                    ))}
                    {importResultModal.errors.length > 30 && (
                      <p className="text-sm text-red-500 font-medium">
                        ...and {importResultModal.errors.length - 30} more errors.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setImportResultModal(null)}
                className="w-full rounded-xl bg-slate-800 px-5 py-3.5 text-base font-semibold text-white transition-colors hover:bg-slate-700 min-h-[48px]"
              >
                Done
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Backup Prompt Modal */}
      {showBackupPrompt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/60 bg-white shadow-2xl overflow-hidden">

            {/* Header stripe — orange for replace, blue for update */}
            <div className={`px-6 py-5 ${replaceMode ? 'bg-orange-500' : 'bg-primary'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-white">
                  <Download size={22} />
                  <span className="font-bold text-lg">Save a Backup First?</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBackupPrompt(false)}
                  className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                  aria-label="Close backup prompt"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="px-6 py-6 space-y-5">
              {/* File being imported */}
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-600">
                <FileUp size={16} className="shrink-0 text-slate-400" />
                <span className="truncate font-medium">{selectedCsvFile?.name}</span>
              </div>

              {/* Warning message */}
              {replaceMode ? (
                <div className="rounded-lg border border-orange-100 bg-orange-50 p-4 text-sm text-orange-800 space-y-2">
                  <p className="font-bold flex items-center gap-2">
                    <AlertCircle size={16} />
                    Replace Mode is ON
                  </p>
                  <p>This will permanently delete <strong>all</strong> existing Course Offerings and Subjects — then import the new file from scratch. Room records are not affected.</p>
                  <p className="font-semibold">We strongly recommend downloading a backup before continuing.</p>
                </div>
              ) : (
                <p className="text-base text-on-surface-variant">
                  Would you like to download a backup of your current course offerings before the import runs?
                </p>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowBackupPrompt(false);
                    exportToCSV().then(() => runImport());
                  }}
                  className={`flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-base font-semibold text-white transition-colors min-h-[48px] ${
                    replaceMode ? 'bg-orange-500 hover:bg-orange-600' : 'bg-primary hover:bg-primary/90'
                  }`}
                >
                  <Download size={18} />
                  Download Backup, then Import
                </button>
                <button
                  type="button"
                  onClick={runImport}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-base font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 min-h-[48px]"
                >
                  <Upload size={18} />
                  Skip Backup &amp; Import Now
                </button>
                <button
                  type="button"
                  onClick={() => setShowBackupPrompt(false)}
                  className="w-full rounded-xl px-5 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:text-slate-600"
                >
                  Cancel
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/60 bg-white p-8 shadow-2xl">
            <div className="mb-5 flex items-start gap-4">
              <div
                className={`mt-1 rounded-full p-3 ${confirmDialog.tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-primary/10 text-primary'}`}
              >
                <AlertCircle size={24} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-on-surface">{confirmDialog.title}</h3>
                <p className="text-base text-on-surface-variant">{confirmDialog.message}</p>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-5 py-3 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 text-base min-h-[48px]"
              >
                {confirmDialog.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const action = confirmDialog.onConfirm;
                  if (typeof action === 'function') {
                    action();
                  } else {
                    setConfirmDialog(null);
                  }
                }}
                className={`flex-1 rounded-lg px-5 py-3 font-semibold text-white transition-colors disabled:opacity-50 text-base min-h-[48px] ${
                  confirmDialog.tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary/90'
                }`}
                disabled={savingOffering}
              >
                {confirmDialog.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-5xl rounded-2xl bg-white shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/20 bg-primary px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {editingFromNotification ? 'Fix Missing Fields' : 'Edit Course Offering'}
                </h3>
                {editingFromNotification && (
                  <p className="text-xs text-white/70 mt-0.5">Only fields with missing data are editable</p>
                )}
              </div>
              <button
                onClick={() => {
                  setEditingId(null);
                  setMthCard(emptyCardState('mth'));
                  setTfsCard(emptyCardState('tfs'));
                  setWedCard(emptyCardState('wed'));
                  setWedCardModified(false);
                  setEditingFromNotification(false);
                  setNotificationMissingFields(new Set());
                }}
                className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                aria-label="Close edit modal"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">

            {offeringError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
                <AlertCircle size={16} />
                {offeringError}
              </div>
            )}

            {editingFromNotification && (
              <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-amber-500" />
                <div>
                  <p className="font-semibold">Fixing missing data</p>
                  <p className="text-sm mt-1 text-amber-700">Filled fields are locked. Only highlighted fields need your attention.</p>
                </div>
              </div>
            )}

            {editingId && (
              <div className="space-y-4">

                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Course Code *
                  </label>
                  <input
                    type="text"
                    value={editingData.code ?? ''}
                    onChange={(e) => setEditingData({ ...editingData, code: e.target.value })}
                    disabled={editableKeys !== null && !editableKeys.has('code')}
                    className={`w-full rounded-lg border px-3 py-2 text-sm text-on-surface outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed ${editableKeys !== null && editableKeys.has('code') ? 'border-amber-300 bg-amber-50/40 ring-2 ring-amber-400/30 focus:border-amber-500 focus:ring-amber-400/50' : 'border-slate-300 bg-white focus:border-primary focus:ring-primary/20'}`}
                    placeholder="e.g., BSCS-101-A"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Course Number *
                  </label>
                  <input
                    type="text"
                    value={editingData.course_no ?? ''}
                    onChange={(e) => setEditingData({ ...editingData, course_no: e.target.value })}
                    disabled={editableKeys !== null && !editableKeys.has('course_no')}
                    className={`w-full rounded-lg border px-3 py-2 text-sm text-on-surface outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed ${editableKeys !== null && editableKeys.has('course_no') ? 'border-amber-300 bg-amber-50/40 ring-2 ring-amber-400/30 focus:border-amber-500 focus:ring-amber-400/50' : 'border-slate-300 bg-white focus:border-primary focus:ring-primary/20'}`}
                    placeholder="e.g., CMSC 11"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Section *
                  </label>
                  <input
                    type="text"
                    value={editingData.section ?? ''}
                    onChange={(e) => setEditingData({ ...editingData, section: e.target.value })}
                    disabled={editableKeys !== null && !editableKeys.has('section')}
                    className={`w-full rounded-lg border px-3 py-2 text-sm text-on-surface outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed ${editableKeys !== null && editableKeys.has('section') ? 'border-amber-300 bg-amber-50/40 ring-2 ring-amber-400/30 focus:border-amber-500 focus:ring-amber-400/50' : 'border-slate-300 bg-white focus:border-primary focus:ring-primary/20'}`}
                    placeholder="e.g., A"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Department *
                  </label>
                  <select
                    value={editingData.department_id ?? ''}
                    onChange={(e) => setEditingData({ ...editingData, department_id: e.target.value })}
                    disabled={editableKeys !== null && !editableKeys.has('department_id')}
                    className={`w-full rounded-lg border px-3 py-2 text-sm text-on-surface outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed ${editableKeys !== null && editableKeys.has('department_id') ? 'border-amber-300 bg-amber-50/40 ring-2 ring-amber-400/30 focus:border-amber-500 focus:ring-amber-400/50' : 'border-slate-300 bg-white focus:border-primary focus:ring-primary/20'}`}
                  >
                    <option value="">Select department</option>
                    {(departments || []).map((dept) => (
                      <option key={dept.department_id} value={dept.department_id}>
                        {dept.department_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Curriculum ID *
                  </label>
                  <input
                    type="text"
                    value={editingData.curr_id ?? ''}
                    onChange={(e) => setEditingData({ ...editingData, curr_id: e.target.value })}
                    disabled={editableKeys !== null && !editableKeys.has('curr_id')}
                    className={`w-full rounded-lg border px-3 py-2 text-sm text-on-surface outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed ${editableKeys !== null && editableKeys.has('curr_id') ? 'border-amber-300 bg-amber-50/40 ring-2 ring-amber-400/30 focus:border-amber-500 focus:ring-amber-400/50' : 'border-slate-300 bg-white focus:border-primary focus:ring-primary/20'}`}
                    placeholder="e.g., 1"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Descriptive Title
                  </label>
                  <input
                    type="text"
                    value={editingData.descriptive_title ?? ''}
                    onChange={(e) => setEditingData({ ...editingData, descriptive_title: e.target.value })}
                    disabled={editableKeys !== null && !editableKeys.has('descriptive_title')}
                    className={`w-full rounded-lg border px-3 py-2 text-sm text-on-surface outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed ${editableKeys !== null && editableKeys.has('descriptive_title') ? 'border-amber-300 bg-amber-50/40 ring-2 ring-amber-400/30 focus:border-amber-500 focus:ring-amber-400/50' : 'border-slate-300 bg-white focus:border-primary focus:ring-primary/20'}`}
                    placeholder="e.g., Introduction to Computer Science"
                  />
                </div>

                <div className="space-y-3">
                  <ScheduleCardInput
                    slot="mth"
                    value={mthCard}
                    onChange={(v) => { setMthCard(v); setMthCardModified(true); }}
                    onToggle={() => { setMthCard((c) => ({ ...c, enabled: !c.enabled })); setMthCardModified(true); }}
                    canDisable={tfsCard.enabled}
                    roomId={Array.isArray(editingData.mth_room_id) ? (editingData.mth_room_id[0] || null) : (editingData.mth_room_id || null)}
                    onRoomChange={(id) => setEditingData((d) => {
                      const arr = [...(Array.isArray(d.mth_room_id) ? d.mth_room_id : [''])];
                      arr[0] = id ? String(id) : '';
                      return { ...d, mth_room_id: arr };
                    })}
                    roomId2={Array.isArray(editingData.mth_room_id) ? (editingData.mth_room_id[1] || null) : null}
                    onRoomChange2={(id) => setEditingData((d) => {
                      const arr = [...(Array.isArray(d.mth_room_id) ? d.mth_room_id : [''])];
                      if (arr.length < 2) arr.push('');
                      arr[1] = id ? String(id) : '';
                      return { ...d, mth_room_id: arr };
                    })}
                    rooms={rooms}
                    getConflictingOfferings={getConflictingOfferings}
                    editingId={editingId}
                    isMissing={editableKeys !== null && (editableKeys.has('mth_schedule') || editableKeys.has('mth_room_id'))}
                    disabled={editableKeys !== null && !editableKeys.has('mth_schedule') && !editableKeys.has('mth_room_id')}
                  />
                  <ScheduleCardInput
                    slot="tfs"
                    value={tfsCard}
                    onChange={(v) => { setTfsCard(v); setTfsCardModified(true); }}
                    onToggle={() => { setTfsCard((c) => ({ ...c, enabled: !c.enabled })); setTfsCardModified(true); }}
                    canDisable={mthCard.enabled}
                    roomId={Array.isArray(editingData.tfs_room_id) ? (editingData.tfs_room_id[0] || null) : (editingData.tfs_room_id || null)}
                    onRoomChange={(id) => setEditingData((d) => {
                      const arr = [...(Array.isArray(d.tfs_room_id) ? d.tfs_room_id : [''])];
                      arr[0] = id ? String(id) : '';
                      return { ...d, tfs_room_id: arr };
                    })}
                    roomId2={Array.isArray(editingData.tfs_room_id) ? (editingData.tfs_room_id[1] || null) : null}
                    onRoomChange2={(id) => setEditingData((d) => {
                      const arr = [...(Array.isArray(d.tfs_room_id) ? d.tfs_room_id : [''])];
                      if (arr.length < 2) arr.push('');
                      arr[1] = id ? String(id) : '';
                      return { ...d, tfs_room_id: arr };
                    })}
                    rooms={rooms}
                    getConflictingOfferings={getConflictingOfferings}
                    editingId={editingId}
                    isMissing={editableKeys !== null && (editableKeys.has('tfs_schedule') || editableKeys.has('tfs_room_id'))}
                    disabled={editableKeys !== null && !editableKeys.has('tfs_schedule') && !editableKeys.has('tfs_room_id')}
                  />
                  {/* Wednesday card — optional, rare use. Shares MTH room. */}
                  <ScheduleCardInput
                    slot="wed"
                    value={wedCard}
                    onChange={(v) => { setWedCard(v); setWedCardModified(true); }}
                    onToggle={() => { setWedCard((c) => ({ ...c, enabled: !c.enabled })); setWedCardModified(true); }}
                    canDisable={true}
                    rooms={rooms}
                    getConflictingOfferings={getConflictingOfferings}
                    editingId={editingId}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                      Units
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editingData.units ?? ''}
                      step="0.5"
                      onChange={(e) => setEditingData({ ...editingData, units: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                      Lec Hrs
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editingData.lec_hrs ?? ''}
                      step="0.5"
                      onChange={(e) => setEditingData({ ...editingData, lec_hrs: e.target.value })}
                      className={`w-full rounded-lg border px-3 py-2 text-sm text-on-surface outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed ${editableKeys !== null && editableKeys.has('lec_hrs') ? 'border-amber-300 bg-amber-50/40 ring-2 ring-amber-400/30 focus:border-amber-500 focus:ring-amber-400/50' : 'border-slate-300 bg-white focus:border-primary focus:ring-primary/20'}`}
                      disabled={editableKeys !== null && !editableKeys.has('lec_hrs')}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                      Lab Hrs
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editingData.lab_hrs ?? ''}
                      step="0.5"
                      onChange={(e) => setEditingData({ ...editingData, lab_hrs: e.target.value })}
                      className={`w-full rounded-lg border px-3 py-2 text-sm text-on-surface outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed ${editableKeys !== null && editableKeys.has('lab_hrs') ? 'border-amber-300 bg-amber-50/40 ring-2 ring-amber-400/30 focus:border-amber-500 focus:ring-amber-400/50' : 'border-slate-300 bg-white focus:border-primary focus:ring-primary/20'}`}
                      disabled={editableKeys !== null && !editableKeys.has('lab_hrs')}
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-6">
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setMthCard(emptyCardState('mth'));
                      setTfsCard(emptyCardState('tfs'));
                      setWedCard(emptyCardState('wed'));
                      setWedCardModified(false);
                      setEditingFromNotification(false);
                      setNotificationMissingFields(new Set());
                    }}
                    className="flex-1 rounded-lg border border-white/60 bg-white px-4 py-2.5 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={savingOffering}
                    className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {savingOffering ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-5xl rounded-2xl bg-white shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/20 bg-primary px-6 py-4">
              <h3 className="text-lg font-bold text-white">Add New Course Offering</h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingData({});
                  setMthCard(emptyCardState('mth'));
                  setTfsCard(emptyCardState('tfs'));
                  setWedCard(emptyCardState('wed'));
                  setWedCardModified(false);
                  setOfferingError(null);
                  setDuplicateCodeSuggestions([]);
                }}
                className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                aria-label="Close add modal"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-6">

            {offeringError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-700" role="alert">
                <AlertCircle size={18} />
                {offeringError}
              </div>
            )}

            {duplicateCodeSuggestions.length > 0 && (
              <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                <p className="mb-3 text-sm font-semibold text-yellow-900">Similar course codes found:</p>
                <div className="space-y-2 text-sm text-yellow-800">
                  {duplicateCodeSuggestions.map((sugg) => (
                    <div key={sugg.id} className="flex justify-between">
                      <span>{sugg.code} - {sugg.descriptive_title || 'No title'} (Section {sugg.section || 'N/A'})</span>
                      <span className="text-xs text-yellow-700">{sugg.units || 0} units</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-6">
              {/* Basic Information Section */}
              <div className="space-y-4">
                <h4 className="text-lg font-bold uppercase tracking-[0.2em] text-on-surface-variant/80">
                  Basic Information
                </h4>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  {/* Course Code with duplicate detection */}
                  <div>
                    <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                      Course Code *
                    </label>
                    <input
                      type="text"
                      value={editingData.code ?? ''}
                      onChange={(e) => {
                        setEditingData({ ...editingData, code: e.target.value });
                        handleCheckDuplicateCode(e.target.value);
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                      placeholder="Enter course code"
                    />
                  </div>

                  {/* Course Number */}
                  <div>
                    <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                      Course Number *
                    </label>
                    <input
                      type="text"
                      value={editingData.course_no ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, course_no: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                      placeholder="Enter course number"
                    />
                  </div>

                  {/* Section */}
                  <div>
                    <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                      Section *
                    </label>
                    <input
                      type="text"
                      value={editingData.section ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, section: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                      placeholder="Enter section"
                    />
                  </div>

                  {/* Department Dropdown */}
                  <div>
                    <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                      Department *
                    </label>
                    <select
                      value={editingData.department_id ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, department_id: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                    >
                      <option value="">Select department</option>
                      {(departments || []).map((dept) => (
                        <option key={dept.department_id} value={dept.department_id}>
                          {dept.department_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Curriculum ID */}
                  <div>
                    <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                      Curriculum ID *
                    </label>
                    <input
                      type="text"
                      value={editingData.curr_id ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, curr_id: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                      placeholder="Enter curriculum ID"
                    />
                  </div>

                  {/* Descriptive Title */}
                  <div className="sm:col-span-2">
                    <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                      Descriptive Title
                    </label>
                    <input
                      type="text"
                      value={editingData.descriptive_title ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, descriptive_title: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                      placeholder="Enter course title"
                    />
                  </div>
                </div>
              </div>

              {/* Hours and Units Section */}
              <div className="space-y-4">
                <h4 className="text-lg font-bold uppercase tracking-[0.2em] text-on-surface-variant/80">
                  Hours & Units
                </h4>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                  <div>
                    <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                      Units
                    </label>
                    <input
                      type="number"
                      value={editingData.units ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, units: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                      Lecture Hours
                    </label>
                    <input
                      type="number"
                      value={editingData.lec_hrs ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, lec_hrs: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                      Lab Hours
                    </label>
                    <input
                      type="number"
                      value={editingData.lab_hrs ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, lab_hrs: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>

              {/* Schedules Section */}
              <div className="space-y-4">
                <h4 className="text-lg font-bold uppercase tracking-[0.2em] text-on-surface-variant/80">
                  Schedules & Rooms (At least one required *)
                </h4>

                {/* MTH Schedule Card */}
                <ScheduleCardInput
                  slot="mth"
                  value={mthCard}
                  onChange={setMthCard}
                  onToggle={() => setMthCard((c) => ({ ...c, enabled: !c.enabled }))}
                  canDisable={tfsCard.enabled}
                  roomId={Array.isArray(editingData.mth_room_id) ? (editingData.mth_room_id[0] || null) : (editingData.mth_room_id || null)}
                  onRoomChange={(id) => setEditingData((d) => {
                    const arr = [...(Array.isArray(d.mth_room_id) ? d.mth_room_id : [''])];
                    arr[0] = id ? String(id) : '';
                    return { ...d, mth_room_id: arr };
                  })}
                  roomId2={Array.isArray(editingData.mth_room_id) ? (editingData.mth_room_id[1] || null) : null}
                  onRoomChange2={(id) => setEditingData((d) => {
                    const arr = [...(Array.isArray(d.mth_room_id) ? d.mth_room_id : [''])];
                    if (arr.length < 2) arr.push('');
                    arr[1] = id ? String(id) : '';
                    return { ...d, mth_room_id: arr };
                  })}
                  rooms={rooms}
                  getConflictingOfferings={getConflictingOfferings}
                  editingId={editingId}
                />

                {/* TFS Schedule Card */}
                <ScheduleCardInput
                  slot="tfs"
                  value={tfsCard}
                  onChange={setTfsCard}
                  onToggle={() => setTfsCard((c) => ({ ...c, enabled: !c.enabled }))}
                  canDisable={mthCard.enabled}
                  roomId={Array.isArray(editingData.tfs_room_id) ? (editingData.tfs_room_id[0] || null) : (editingData.tfs_room_id || null)}
                  onRoomChange={(id) => setEditingData((d) => {
                    const arr = [...(Array.isArray(d.tfs_room_id) ? d.tfs_room_id : [''])];
                    arr[0] = id ? String(id) : '';
                    return { ...d, tfs_room_id: arr };
                  })}
                  roomId2={Array.isArray(editingData.tfs_room_id) ? (editingData.tfs_room_id[1] || null) : null}
                  onRoomChange2={(id) => setEditingData((d) => {
                    const arr = [...(Array.isArray(d.tfs_room_id) ? d.tfs_room_id : [''])];
                    if (arr.length < 2) arr.push('');
                    arr[1] = id ? String(id) : '';
                    return { ...d, tfs_room_id: arr };
                  })}
                  rooms={rooms}
                  getConflictingOfferings={getConflictingOfferings}
                  editingId={editingId}
                />

                {/* Wednesday card — optional, rare use. Shares MTH room. */}
                <ScheduleCardInput
                  slot="wed"
                  value={wedCard}
                  onChange={(v) => { setWedCard(v); setWedCardModified(true); }}
                  onToggle={() => { setWedCard((c) => ({ ...c, enabled: !c.enabled })); setWedCardModified(true); }}
                  canDisable={true}
                  rooms={rooms}
                  getConflictingOfferings={getConflictingOfferings}
                  editingId={null}
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-4 pt-4">
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingData({});
                    setMthCard(emptyCardState('mth'));
                    setTfsCard(emptyCardState('tfs'));
                    setWedCard(emptyCardState('wed'));
                    setWedCardModified(false);
                    setOfferingError(null);
                    setDuplicateCodeSuggestions([]);
                  }}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-5 py-3 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 text-base min-h-[48px]"
                >
                  Cancel
                </button>
                {(() => {
                  const mthStr = mthCard.enabled ? buildScheduleString('mth', mthCard.mode, mthCard.startH, mthCard.startM, mthCard.endH, mthCard.endM, mthCard.type, mthCard.hasSec, mthCard.startH2, mthCard.startM2, mthCard.endH2, mthCard.endM2, mthCard.type2) : null;
                  const tfsStr = tfsCard.enabled ? buildScheduleString('tfs', tfsCard.mode, tfsCard.startH, tfsCard.startM, tfsCard.endH, tfsCard.endM, tfsCard.type, tfsCard.hasSec, tfsCard.startH2, tfsCard.startM2, tfsCard.endH2, tfsCard.endM2, tfsCard.type2) : null;
                  const previewData = { ...editingData, mth_schedule: mthStr || null, tfs_schedule: tfsStr || null };
                  const valid = isFormValid(previewData);
                  const disabledReason = !valid ? getDisabledReason(previewData) : '';
                  return (
                    <button
                      onClick={handleAddOffering}
                      disabled={savingOffering || !valid}
                      title={disabledReason}
                      className="flex-1 rounded-lg bg-primary px-5 py-3 font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-base min-h-[48px]"
                    >
                      {savingOffering ? 'Creating...' : 'Create Offering'}
                    </button>
                  );
                })()}
              </div>
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
    <AnimatePresence>
      {successMessage && (
        <Toast
          key={successMessage}
          message={successMessage}
          onClose={() => setSuccessMessage(null)}
        />
      )}
    </AnimatePresence>
    </>
  );
}
