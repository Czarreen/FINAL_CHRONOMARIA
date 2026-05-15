import { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
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
} from 'lucide-react';
import {
  fetchCourseOfferings,
  createCourseOffering,
  updateCourseOffering,
  deleteCourseOffering,
  importCourseOfferingsCsv,
  fetchCourseOfferingById,
  fetchCourseOfferingPageNumber,
  checkDuplicateCode,
} from '../services/courseOfferingsApi';
import { fetchRooms } from '../services/roomsApi';
import { fetchDepartments } from '../services/departmentsApi';
import NotificationButton from '../components/NotificationButton';
import { fetchCourseOfferingNotifications, resolveCourseOfferingNotification, syncCourseOfferingNotifications, rescanAllCourseOfferingNotifications } from '../services/notificationsApi';
import { useRowHighlight } from '../hooks/useRowHighlight.jsx';
import { isFormValid, getDisabledReason, getSchedulePairStatus } from '../utils/courseOfferingValidation';
import { normalizeNotificationSeverity } from '../utils/notificationUtils';

const PAGE_SIZE = 50;

export default function CourseOfferingView({ onSubjectMutated } = {}) {
  const [offerings, setOfferings] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
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
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [selectedCsvFile, setSelectedCsvFile] = useState(null);
  const [importingCsv, setImportingCsv] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  const [importError, setImportError] = useState('');
  const [replaceMode, setReplaceMode] = useState(false);
  const [showBackupPrompt, setShowBackupPrompt] = useState(false);
  const [importResultModal, setImportResultModal] = useState(null); // holds summary after import finishes
  const [selectedOfferings, setSelectedOfferings] = useState(new Set());
  const [refreshTrigger, setRefreshTrigger] = useState(0);
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
  const [departments, setDepartments] = useState([]);
  const [duplicateCodeSuggestions, setDuplicateCodeSuggestions] = useState([]);
  const [checkingDuplicateCode, setCheckingDuplicateCode] = useState(false);
  const colMenuRef = useRef(null);
  const [notificationFilter, setNotificationFilter] = useState('all'); // 'all', 'critical', 'medium', 'low'
  const [notificationSearch, setNotificationSearch] = useState('');
  const [pendingScrollToOfferingId, setPendingScrollToOfferingId] = useState(null);
  const [findingNotificationRow, setFindingNotificationRow] = useState(false);
  const [editingFromNotification, setEditingFromNotification] = useState(false);
  const [notificationMissingFields, setNotificationMissingFields] = useState(new Set());
  const [notificationsLoading, setNotificationsLoading] = useState(false);

  const { setHighlight, clearHighlight } = useRowHighlight();

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

  const totalPages = useMemo(() => {
    if (!totalRows) return 1;
    return Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  }, [totalRows]);

  // Debounced search text — prevents a request on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const tid = setTimeout(() => setDebouncedSearch(filterText), 300);
    return () => clearTimeout(tid);
  }, [filterText]);

  // Reset to page 1 whenever the search query or column filter changes
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterColumn]);

  // Unified data-loading effect — handles both paginated browsing and server-side search
  useEffect(() => {
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
  }, [page, refreshToken, refreshTrigger, sortConfig, debouncedSearch, filterColumn]);

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
        console.error('Failed to load rooms:', err);
      }
    }

    loadRooms();
    return () => {
      active = false;
    };
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
        console.error('Failed to load departments:', err);
        setDepartments([]);
      }
    }

    loadDepartments();
    return () => {
      active = false;
    };
  }, []);

  // Handle scrolling to offering when it appears (after page navigation)
  useEffect(() => {
    if (pendingScrollToOfferingId) {
      setHighlight(pendingScrollToOfferingId, 'CourseOfferingView');
      setPendingScrollToOfferingId(null);
    }
  }, [pendingScrollToOfferingId, offerings, setHighlight]);

  async function findOfferingPageNumber(offeringId) {
    try {
      return await fetchCourseOfferingPageNumber(offeringId, {
        sortBy: sortConfig.key,
        sortOrder: sortConfig.direction,
        pageSize: PAGE_SIZE,
      });
    } catch (err) {
      console.error('Failed to find offering page number:', err);
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
      console.error('Failed to check duplicate code:', err);
      setDuplicateCodeSuggestions([]);
    } finally {
      setCheckingDuplicateCode(false);
    }
  }

  async function handleAddOffering() {
    if (!isFormValid(editingData)) {
      setOfferingError(getDisabledReason(editingData) || 'Please fill in all required fields');
      return;
    }

    try {
      setSavingOffering(true);
      setOfferingError(null);

      // Convert room arrays to slash-separated strings
      const mthRoomIds = Array.isArray(editingData.mth_room_id)
        ? editingData.mth_room_id.filter(Boolean).join('/')
        : (editingData.mth_room_id || null);

      const tfsRoomIds = Array.isArray(editingData.tfs_room_id)
        ? editingData.tfs_room_id.filter(Boolean).join('/')
        : (editingData.tfs_room_id || null);

      const payload = {
        ...editingData,
        mth_room_id: mthRoomIds,
        tfs_room_id: tfsRoomIds,
      };

      await createCourseOffering(payload);
      setSuccessMessage(`Created "${editingData.code}"`);
      setShowAddModal(false);
      setEditingData({});
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
      mth_room_id: resolveRoomIds(offering, 'mth').map(String),
      tfs_schedule: offering.tfs_schedule || '',
      tfs_room_id: resolveRoomIds(offering, 'tfs').map(String),
    });
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

      // Convert room arrays to slash-separated strings
      const mthRoomIds = Array.isArray(editingData.mth_room_id)
        ? editingData.mth_room_id.filter(Boolean).join('/')
        : (editingData.mth_room_id || null);

      const tfsRoomIds = Array.isArray(editingData.tfs_room_id)
        ? editingData.tfs_room_id.filter(Boolean).join('/')
        : (editingData.tfs_room_id || null);

      const payload = {
        ...editingData,
        mth_room_id: mthRoomIds,
        tfs_room_id: tfsRoomIds,
      };

      const savedId = editingId;
      await updateCourseOffering(savedId, payload);
      setSuccessMessage(`Updated "${editingData.code}"`);
      setEditingId(null);
      setEditingData({});
      setEditingFromNotification(false);
      setNotificationMissingFields(new Set());
      // Re-sync notifications for this offering in the background then refresh list
      syncCourseOfferingNotifications(savedId).catch(() => {});
      await loadInitialPage();
    } catch (err) {
      if (String(err.message || '').includes('404')) {
        setEditingId(null);
        setEditingData({});
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
      setRefreshTrigger((prev) => prev + 1);
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

  // Maps issue.field strings (from buildCourseOfferingNotifications) → editingData keys
  const NOTIFICATION_FIELD_TO_KEY = {
    'Course Code': 'code',
    'Course Number': 'course_no',
    'Course Title': 'descriptive_title',
    'Department': 'department_id',
    'Curriculum': 'curr_id',
    'Credit Units': 'units',
    'Lecture Hours': ['lec_hrs', 'lab_hrs'],
    'Lecture/Lab Hours': ['lec_hrs', 'lab_hrs'],
    'Schedule': ['mth_schedule', 'tfs_schedule'],
    'Room Assignment': ['mth_room_id', 'tfs_room_id'],
    'MTH Room': 'mth_room_id',
    'TFS Room': 'tfs_room_id',
    'MTH Schedule': 'mth_schedule',
    'TFS Schedule': 'tfs_schedule',
  };

  // Maps backend snake_case field names to display names
  const BACKEND_FIELD_TO_DISPLAY_NAME = {
    'code': 'Course Code',
    'course_no': 'Course Number',
    'descriptive_title': 'Course Title',
    'department_id': 'Department',
    'curr_id': 'Curriculum',
    'units': 'Credit Units',
    'lec_hrs': 'Lecture/Lab Hours',
    'hours': 'Lecture/Lab Hours',
    'mth_schedule': 'MTH Schedule',
    'tfs_schedule': 'TFS Schedule',
    'mth_room_id': 'MTH Room',
    'tfs_room_id': 'TFS Room',
  };

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

  const [notifications, setNotifications] = useState([]);

  // Transform flat DB rows (one row per issue) into grouped notification objects
  function transformDbNotifications(rows) {
    const byOffering = {};
    (rows || []).forEach((row) => {
      const key = row.entity_id;
      if (!byOffering[key]) {
        byOffering[key] = {
          id: row.entity_id,
          offeringId: row.entity_id,
          entity_id: row.entity_id,
          title: row.details?.code ? `${row.details.code}` : `Offering #${row.entity_id}`,
          description: row.message,
          severity: normalizeNotificationSeverity(row.severity),
          issues: [],
          missingFields: [],
          dbIds: [],
        };
      }
      const displayFieldName = BACKEND_FIELD_TO_DISPLAY_NAME[row.field_name] || row.field_name;
      byOffering[key].issues.push({
        field: displayFieldName,
        message: row.message,
        details: row.details,
      });
      byOffering[key].missingFields.push(displayFieldName);
      byOffering[key].dbIds.push(row.id);
      // Escalate severity if any issue is high/critical
      if (normalizeNotificationSeverity(row.severity) === 'critical') {
        byOffering[key].severity = 'critical';
      }
    });
    return Object.values(byOffering);
  }

  // Fetch persisted notifications from backend
  useEffect(() => {
    let active = true;

    async function loadNotifications() {
      setNotificationsLoading(true);
      try {
        const payload = await fetchCourseOfferingNotifications({ page: 1, limit: 500, unresolvedOnly: true });
        if (!active) return;

        const rowCount = payload.total ?? payload.rows?.length ?? 0;
        if (rowCount === 0) {
          // DB is empty — auto-rescan all offerings to populate the table
          await rescanAllCourseOfferingNotifications();
          if (!active) return;
          const refetched = await fetchCourseOfferingNotifications({ page: 1, limit: 500, unresolvedOnly: true });
          if (!active) return;
          setNotifications(transformDbNotifications(refetched.rows || []));
        } else {
          setNotifications(transformDbNotifications(payload.rows || []));
        }
      } catch (err) {
        console.error('Failed to load course offering notifications:', err);
        if (active) setNotifications([]);
      } finally {
        if (active) setNotificationsLoading(false);
      }
    }

    loadNotifications();
    return () => { active = false; };
  }, [refreshTrigger]);

  // Filter notifications by severity and search
  const filteredNotifications = useMemo(() => {
    let filtered = notifications;

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
  }, [notifications, notificationFilter, notificationSearch]);

  // Calculate notification stats
  const notificationStats = useMemo(() => {
    return {
      total: notifications.length,
      critical: notifications.filter((n) => n.severity === 'critical').length,
      medium: notifications.filter((n) => n.severity === 'medium').length,
      low: notifications.filter((n) => n.severity === 'low').length,
    };
  }, [notifications]);

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
            // Clear search filter before navigating - allows pagination effect to run
            if (filterText) {
              setFilterText('');
            }
            setPage(pageNum);
            setPendingScrollToOfferingId(item.offeringId);
          } else if (!pageNum) {
            console.warn('Offering not found');
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
            // Clear search filter before navigating - allows pagination effect to run
            if (filterText) {
              setFilterText('');
            }
            setPage(pageNum);
            setPendingScrollToOfferingId(item.offeringId);
          }
        })
        .catch((err) => {
          console.error('Failed to edit offering from notification:', err);
          setOfferingError('Could not load offering for editing');
        })
        .finally(() => setFindingNotificationRow(false));
    }
  };

  const handleForceRescan = async () => {
    setNotificationsLoading(true);
    try {
      await rescanAllCourseOfferingNotifications(true);
      const refetched = await fetchCourseOfferingNotifications({ page: 1, limit: 500, unresolvedOnly: true });
      setNotifications(transformDbNotifications(refetched.rows || []));
    } catch (err) {
      console.error('Force rescan failed:', err);
    } finally {
      setNotificationsLoading(false);
    }
  };

  const resolveNotificationItem = async (item) => {
    // Optimistically remove from local list
    setNotifications((prev) => prev.filter((n) => n.id !== item.id));
    try {
      await Promise.all(
        (item.dbIds || []).map((dbId) => resolveCourseOfferingNotification(dbId))
      );
    } catch (err) {
      console.error('Failed to resolve notification:', err);
      setRefreshTrigger((t) => t + 1);
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
      syncCourseOfferingNotifications(offeringId).catch(() => {});
      setRefreshTrigger((t) => t + 1);
    } catch (err) {
      console.error('Inline save failed:', err);
    }
  };

  const renderCellValue = (value) => {
    if (value === null || value === undefined) return <span className="text-slate-400">—</span>;
    return String(value);
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
      <div className="space-y-2 rounded-lg border border-white/60 bg-white/70 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface-variant/60">
            Selected Rooms:
          </span>
          {selectedRoomNames.length ? (
            selectedRoomNames.map((roomName, index) => (
              <span
                key={`${field}-selected-${index}`}
                className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
              >
                {roomName}
              </span>
            ))
          ) : (
            <span className="text-xs text-on-surface-variant/70">None selected</span>
          )}
        </div>
        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {!rooms || rooms.length === 0 ? (
            <p className="text-xs text-on-surface-variant">
              {rooms === null ? 'Loading rooms...' : 'No rooms available'}
            </p>
          ) : (
            rooms.map((room, idx) => {
              // Safely get room_id - handle 0 as valid ID
              const roomId = room?.room_id !== undefined ? room.room_id : (room?.id !== undefined ? room.id : null);

              if (roomId === null || roomId === undefined) {
                console.warn('Room at index', idx, 'has no valid ID:', room);
                return null;
              }

              const roomIdStr = String(roomId);
              const isChecked = selectedValues.includes(roomIdStr);
              const conflicts = getConflictingOfferings(roomIdStr, scheduleType);
              const conflictCount = conflicts.filter((o) => o.id !== editingId && !isMergedSubject(o, editingData)).length;

              return (
                <div key={roomIdStr}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-on-surface-variant transition-colors hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleRoomSelection(field, roomIdStr)}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-on-surface break-words">
                        {room?.room_name || `Room ${roomId}`}
                      </span>
                      {room?.room_type && (
                        <span className="ml-2 text-xs text-on-surface-variant/70">
                          ({room.room_type})
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-on-surface-variant/70 flex-shrink-0">#{roomId}</span>
                  </label>
                  {conflictCount > 0 && (
                    <p className="ml-7 text-xs text-amber-600">
                      ⚠️ Used by {conflictCount} other offering(s)
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-on-surface-variant/60">
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

  // Returns true when two offerings occupy the exact same physical slot —
  // identical schedule strings AND at least one shared room ID.
  // Two offerings at the exact same time in the same room are the same physical
  // class (merged/cross-listed), regardless of code, title, dept, or curriculum.
  const isMergedSubject = (offering, compareTo) => {
    // Same course section: same curriculum + department + course_no → intentional room-share
    // (staggered lab sections share rooms at different times — not a conflict)
    if (offering.curr_id && compareTo.curr_id &&
        String(offering.curr_id) === String(compareTo.curr_id) &&
        String(offering.department_id) === String(compareTo.department_id) &&
        String(offering.course_no || '').trim().toUpperCase() === String(compareTo.course_no || '').trim().toUpperCase()) {
      return true;
    }

    const norm = (s) => String(s || '').trim().toUpperCase();

    const mthA = norm(offering.mth_schedule);
    const mthB = norm(compareTo.mth_schedule);
    const tfsA = norm(offering.tfs_schedule);
    const tfsB = norm(compareTo.tfs_schedule);

    // Must have at least one schedule to compare
    if (!mthA && !tfsA) return false;

    // Schedules must match exactly
    if (mthA !== mthB || tfsA !== tfsB) return false;

    // Room overlap helper — handles slash-separated strings and arrays
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

    // If offering has an MTH room, compareTo must share at least one
    if (mthRoomA.length && !shareRoom(mthRoomA, mthRoomB)) return false;
    // If offering has a TFS room, compareTo must share at least one
    if (tfsRoomA.length && !shareRoom(tfsRoomA, tfsRoomB)) return false;

    return true;
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

  // Pre-computed room→offerings map: avoids O(n) filter per room per render
  const roomConflictMap = useMemo(() => {
    const map = new Map();
    for (const offering of offerings) {
      for (const stype of ['mth', 'tfs']) {
        const ids = resolveRoomIds(offering, stype);
        for (const id of ids) {
          const key = `${id}:${stype}`;
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(offering);
        }
      }
    }
    return map;
  }, [offerings]);

  const getConflictingOfferings = (roomId, scheduleType) => {
    if (!roomId) return [];
    return roomConflictMap.get(`${roomId}:${scheduleType}`) || [];
  };

  const exportToCSV = async () => {
    if (offerings.length === 0) {
      setUpdateError('No offerings to export');
      return;
    }

    try {
      setLoading(true);
      setUpdateError(null);

      let allOfferings = offerings;

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
        console.error('Failed to fetch all offerings for export:', err);
        setUpdateError('Failed to fetch all offerings. Exporting current page only.');
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
      link.download = `course-offerings-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();

      setUpdateError(null);
    } catch (err) {
      setUpdateError(err.message || 'Failed to export offerings');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2 animate-in slide-in-from-right-4 duration-500 p-3">
      {/* Header with compact stats */}
      <div className="glass-panel flex flex-col gap-2 p-3">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-on-surface">Course Offerings</h2>
            <p className="text-xs text-on-surface-variant">Manage offerings, schedules, and room assignments.</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
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
              isRescanning={notificationsLoading}
              totalEntityCount={totalRows}
            />
            <button
              type="button"
              onClick={handleForceRescan}
              disabled={notificationsLoading}
              title="Clear and re-detect all schedule conflicts and missing data"
              className="btn-primary flex items-center gap-1 text-xs px-2 py-1 disabled:opacity-50"
            >
              <RefreshCw size={14} className={notificationsLoading ? 'animate-spin' : ''} />
              <span>Rescan</span>
            </button>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/70 px-2 py-1 text-[10px] font-semibold text-on-surface-variant backdrop-blur">
              <BookMarked size={12} className="text-primary" />
              {totalRows}
            </span>
            {selectedOfferings.size > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/60 bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary backdrop-blur">
                {selectedOfferings.size} sel
              </span>
            )}
            <button
              className="btn-primary flex items-center gap-1 text-xs px-2 py-1"
              onClick={loadInitialPage}
              type="button"
              title="Reload data"
            >
              <RefreshCw size={14} />
              <span>Reload</span>
            </button>
            <button
              className="btn-primary flex items-center gap-1 text-xs px-2 py-1"
              onClick={exportToCSV}
              type="button"
              title="Export to CSV"
            >
              <Download size={14} />
              <span>Export</span>
            </button>
            <button
              ref={colButtonRef}
              className="btn-primary flex items-center gap-1 text-xs px-2 py-1"
              onClick={() => setColMenuOpen((prev) => !prev)}
              type="button"
              title="Column visibility"
            >
              <Settings size={14} />
              <span>Cols</span>
            </button>
            {colMenuOpen && typeof document !== 'undefined' && createPortal(
              <div
                ref={colMenuRef}
                style={{
                  position: 'fixed',
                  top: `${colMenuPos.top}px`,
                  left: `${colMenuPos.left}px`,
                  zIndex: 9999,
                }}
                className="bg-white border border-slate-200 rounded-lg shadow-2xl p-2 min-w-max"
              >
                {columns.map((col) => (
                  <label
                    key={col.key}
                    className="flex items-center gap-2 px-3 py-2 text-xs text-on-surface hover:bg-primary/5 rounded cursor-pointer whitespace-nowrap transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(col.key)}
                      onChange={() => toggleColumnVisibility(col.key)}
                      className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary/30"
                    />
                    {col.label}
                  </label>
                ))}
              </div>,
              document.body
            )}
            {selectedOfferings.size > 0 && (
              <button
                className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2 py-1 font-semibold text-white text-xs transition-colors hover:bg-red-700"
                onClick={handleBulkDelete}
                type="button"
              >
                <Trash2 size={14} />
                <span>Delete</span>
              </button>
            )}
            <button
              className="btn-primary flex items-center gap-1 text-xs px-2 py-1"
              onClick={() => {
                setShowAddModal(true);
                setEditingData({ mth_room_id: [], tfs_room_id: [] });
                setOfferingError(null);
              }}
              type="button"
            >
              <PlusCircle size={14} />
              <span>Add</span>
            </button>
            {/* CSV Import group */}
            <div className="flex items-center gap-1 rounded-xl border border-white/60 bg-white/80 p-1 backdrop-blur shadow-sm">
              {/* File picker */}
              <label
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors select-none ${
                  selectedCsvFile
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface-variant hover:bg-slate-100'
                }`}
                title="Choose a CSV file to import"
              >
                <FileUp size={14} className={selectedCsvFile ? 'text-primary' : 'text-on-surface-variant'} />
                <span className="max-w-[120px] truncate">
                  {selectedCsvFile ? selectedCsvFile.name : 'Choose CSV'}
                </span>
                {selectedCsvFile && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="ml-0.5 rounded p-0.5 hover:bg-primary/20"
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
                    <X size={11} />
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

              {/* Divider */}
              <div className="h-5 w-px bg-slate-200" />

              {/* Replace mode toggle */}
              <label
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium select-none transition-colors ${
                  replaceMode
                    ? 'bg-orange-100 text-orange-700'
                    : 'text-on-surface-variant hover:bg-slate-100'
                }`}
                title="Replace Mode: clears ALL Course Offerings, Subjects, and Rooms before importing the new file"
              >
                <input
                  type="checkbox"
                  checked={replaceMode}
                  onChange={(e) => setReplaceMode(e.target.checked)}
                  className="h-3 w-3 rounded border-slate-300 accent-orange-500"
                />
                <span>Replace All</span>
                {replaceMode && (
                  <span className="rounded bg-orange-200 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-800">
                    New Sem
                  </span>
                )}
              </label>

              {/* Divider */}
              <div className="h-5 w-px bg-slate-200" />

              {/* Import button */}
              <button
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
                  replaceMode
                    ? 'bg-orange-500 hover:bg-orange-600'
                    : 'bg-primary hover:bg-primary/90'
                }`}
                onClick={handleClickImport}
                type="button"
                disabled={importingCsv}
                title={replaceMode ? 'Import and replace all existing data' : 'Import CSV — update or add rows'}
              >
                <Upload size={13} />
                <span>{importingCsv ? 'Importing…' : 'Import'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Controls: Search / Filter / Sort */}
      <div className="glass-panel space-y-2 p-3">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          {/* Search Input */}
          <div className="flex gap-2 flex-1 xl:max-w-xs">
            <select
              value={filterColumn}
              onChange={(e) => setFilterColumn(e.target.value)}
              className="rounded-lg border border-white/30 bg-white/50 px-2 py-1.5 text-xs text-on-surface-variant outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white"
            >
              <option value="all">All cols</option>
              {columns.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant" />
              <input
                type="text"
                placeholder={`Search ${filterColumn === 'all' ? 'all columns' : columns.find(c => c.key === filterColumn)?.label || filterColumn}...`}
                value={filterText}
                onChange={(e) => {
                  setFilterText(e.target.value);
                }}
                className="w-full rounded-lg border border-white/30 bg-white/50 py-1.5 pl-8 pr-8 text-xs text-on-surface placeholder-on-surface-variant/50 outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white focus:shadow-lg"
              />
              {filterText && (
                <button
                  onClick={() => setFilterText('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                  title="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Reset Button */}
          <div className="flex flex-wrap gap-1 xl:justify-end">
            <button
              onClick={() => { setFilterText(''); setFilterColumn('all'); setSortConfig({ key: 'code', direction: 'asc' }); }}
              className="rounded-lg border border-white/60 bg-white px-2 py-1.5 text-xs font-bold text-on-surface-variant transition-all hover:bg-slate-50"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Error Messages */}
        {error && (
          <div className="flex items-center gap-1 rounded-lg bg-red-50 p-2 text-xs text-red-700">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
        {updateError && (
          <div className="flex items-center gap-1 rounded-lg bg-red-50 p-2 text-xs text-red-700">
            <AlertCircle size={14} />
            {updateError}
          </div>
        )}
        {importError && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={16} />
            {importError}
          </div>
        )}
        {importSummary && (
          <div className="space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-emerald-900">
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-medium">
              <span>Total: {importSummary.totalRows}</span>
              <span>Processed: {importSummary.processedRows}</span>
              <span>Inserted: {importSummary.insertedRows}</span>
              <span>Updated: {importSummary.updatedRows}</span>
              <span>Failed: {importSummary.failedRows}</span>
              <span>Skipped: {importSummary.skippedRows}</span>
            </div>
            {Array.isArray(importSummary.errors) && importSummary.errors.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-800/80">
                  Row Errors
                </p>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-emerald-100 bg-white/80 p-2">
                  {importSummary.errors.slice(0, 20).map((issue) => (
                    <p key={`csv-error-${issue.row}-${(issue.messages || []).join('|')}`} className="text-xs text-red-700">
                      Row {issue.row}: {Array.isArray(issue.messages) ? issue.messages.join('; ') : 'Unknown row error'}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {successMessage && (
          <div className="flex items-center gap-1 rounded-lg bg-green-50 p-2 text-xs text-green-700">
            <Check size={14} />
            {successMessage}
          </div>
        )}
      </div>

      {/* Data Table - Compact */}
      <div className="glass-panel overflow-hidden flex-1">
        <div className="max-h-[calc(100vh-24rem)] overflow-auto pb-8">
          <table className="min-w-full w-full text-left text-xs">
            <thead>
                <tr className="sticky top-0 z-20 border-b border-white/20 bg-white/95 backdrop-blur">
                  <th className="px-3 py-2 text-center w-10">
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
                      <th key={col.key} className={`px-3 py-2 ${col.key === 'code' || col.key === 'curr_id' ? 'text-center' : 'text-left'}`}>
                        <button type="button" onClick={() => handleSort(col.key)} className={`flex items-center justify-start gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                          sortConfig.key === col.key ? 'text-primary' : 'text-on-surface-variant/70 hover:text-on-surface'
                        }`}>
                          <span>{col.label}</span>
                          <ArrowUpDown size={10} />
                        </button>
                      </th>
                    );
                  })}
                  <th className="sticky right-0 z-30 bg-white/95 px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/70 backdrop-blur">Act</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-white/20">
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

              {!loading && !error && displayedOfferings.map((offering) => (
                <tr id={`offering-row-${offering.id}`} key={offering.id} className="transition-colors hover:bg-white/40 text-xs">
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={selectedOfferings.has(offering.id)}
                      onChange={() => toggleSelectOffering(offering.id)}
                      className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary/30"
                    />
                  </td>
                  {columns.map((col) => {
                    if (!visibleColumns.has(col.key)) return null;
                    return (
                      <td key={col.key} className={`px-3 py-2 truncate ${col.key === 'code' || col.key === 'curr_id' ? 'text-center' : ''}`}>
                        {col.key === 'code' ? (
                          <span className="inline-block rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                            {renderCellValue(offering[col.key])}
                          </span>
                        ) : col.key === 'course_no' ? (
                          <span className="text-[11px] font-medium text-on-surface">
                            {renderCellValue(offering[col.key])}
                          </span>
                        ) : col.key === 'descriptive_title' ? (
                          <span className="text-[10px] text-on-surface-variant truncate max-w-xs block">{renderCellValue(offering[col.key])}</span>
                        ) : col.key === 'units' ? (
                          <span className="text-[11px] font-medium text-on-surface">
                            {renderCellValue(offering[col.key])}
                          </span>
                        ) : col.key === 'lec_hrs' || col.key === 'lab_hrs' ? (
                          <span className="text-[11px] font-medium text-on-surface-variant">
                            {renderCellValue(offering[col.key])}h
                          </span>
                        ) : col.key === 'mth_room_id' || col.key === 'tfs_room_id' ? (
                          <span className="text-[10px] text-on-surface-variant">{renderRoomCell(offering, col.key)}</span>
                        ) : (
                          <span className="text-[11px] text-on-surface-variant truncate">
                            {renderCellValue(offering[col.key])}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 bg-white/90 px-2 py-2 backdrop-blur">
                    <div className="flex justify-center gap-1">
                      <button
                        onClick={() => handleEditOffering(offering)}
                        className="rounded-md p-1 text-slate-400 transition-colors hover:bg-white hover:text-primary"
                        title="Edit"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteOffering(offering)}
                        className="rounded-md p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination - Always visible and compact */}
      <div className="flex items-center justify-between rounded-xl border border-white/50 bg-white/60 px-3 py-2 gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/80 whitespace-nowrap">
          {startRow}-{endRow} / {totalRows}
        </p>
        <div className="flex items-center gap-1">
          <button
            className="inline-flex items-center gap-0.5 rounded-md border border-white/60 bg-white px-2 py-1 text-xs font-semibold text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-50"
            disabled={page <= 1 || loading}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            type="button"
            title="Previous page"
          >
            <ChevronLeft size={12} />
            <span>Prev</span>
          </button>
          <span className="text-xs font-semibold text-on-surface-variant px-1">
            {page} / {totalPages}
          </span>
          <button
            className="inline-flex items-center gap-0.5 rounded-md border border-white/60 bg-white px-2 py-1 text-xs font-semibold text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-50"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            type="button"
            title="Next page"
          >
            <span>Next</span>
            <ChevronRight size={12} />
          </button>
        </div>
      </div>

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
                Replace mode: deleting all Course Offerings, Subjects &amp; Rooms, then rebuilding from CSV.
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
            <div className={`px-6 py-4 ${importResultModal.failedRows > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-white">
                  {importResultModal.failedRows > 0 ? <AlertCircle size={18} /> : <Check size={18} />}
                  <span className="font-bold text-base">
                    {importResultModal.failedRows > 0 ? 'Import Completed with Errors' : 'Import Successful'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setImportResultModal(null)}
                  className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Mode badge */}
              {importResultModal.replaceMode && (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
                  <span>Replace Mode — all old data was cleared first</span>
                </div>
              )}

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Total Rows', value: importResultModal.totalRows, color: 'bg-slate-50 text-slate-700' },
                  { label: 'Inserted', value: importResultModal.insertedRows, color: 'bg-emerald-50 text-emerald-700' },
                  { label: 'Updated', value: importResultModal.updatedRows, color: 'bg-blue-50 text-blue-700' },
                  { label: 'Skipped', value: importResultModal.skippedRows, color: 'bg-slate-50 text-slate-500' },
                  { label: 'Failed', value: importResultModal.failedRows, color: importResultModal.failedRows > 0 ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-400' },
                  { label: 'Subjects Synced', value: importResultModal.syncedSubjectRows, color: 'bg-purple-50 text-purple-700' },
                ].map(({ label, value, color }) => (
                  <div key={label} className={`rounded-xl ${color} flex flex-col items-center justify-center p-3`}>
                    <span className="text-2xl font-bold">{value ?? 0}</span>
                    <span className="text-[10px] font-medium text-center leading-tight mt-0.5">{label}</span>
                  </div>
                ))}
              </div>

              {/* Row errors */}
              {Array.isArray(importResultModal.errors) && importResultModal.errors.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-widest text-red-600">
                    Row Errors ({importResultModal.errors.length})
                  </p>
                  <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-red-100 bg-red-50 p-2">
                    {importResultModal.errors.slice(0, 30).map((issue) => (
                      <p
                        key={`result-error-${issue.row}-${(issue.messages || []).join('|')}`}
                        className="text-xs text-red-700"
                      >
                        <span className="font-bold">Row {issue.row}:</span>{' '}
                        {Array.isArray(issue.messages) ? issue.messages.join('; ') : 'Unknown error'}
                      </p>
                    ))}
                    {importResultModal.errors.length > 30 && (
                      <p className="text-xs text-red-500 font-medium">
                        ...and {importResultModal.errors.length - 30} more errors.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => setImportResultModal(null)}
                className="w-full rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
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
            <div className={`px-6 py-4 ${replaceMode ? 'bg-orange-500' : 'bg-primary'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-white">
                  <Download size={18} />
                  <span className="font-bold text-base">Save a Backup First?</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBackupPrompt(false)}
                  className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* File being imported */}
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs text-slate-600">
                <FileUp size={13} className="shrink-0 text-slate-400" />
                <span className="truncate font-medium">{selectedCsvFile?.name}</span>
              </div>

              {/* Warning message */}
              {replaceMode ? (
                <div className="rounded-lg border border-orange-100 bg-orange-50 p-3 text-xs text-orange-800 space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <AlertCircle size={13} />
                    Replace Mode is ON
                  </p>
                  <p>This will permanently delete <strong>all</strong> existing Course Offerings, Subjects, and Rooms — then import the new file from scratch.</p>
                  <p className="font-semibold">We strongly recommend downloading a backup before continuing.</p>
                </div>
              ) : (
                <p className="text-sm text-on-surface-variant">
                  Would you like to download a backup of your current course offerings before the import runs?
                </p>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowBackupPrompt(false);
                    exportToCSV().then(() => runImport());
                  }}
                  className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors ${
                    replaceMode ? 'bg-orange-500 hover:bg-orange-600' : 'bg-primary hover:bg-primary/90'
                  }`}
                >
                  <Download size={15} />
                  Download Backup, then Import
                </button>
                <button
                  type="button"
                  onClick={runImport}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
                >
                  <Upload size={15} />
                  Skip Backup &amp; Import Now
                </button>
                <button
                  type="button"
                  onClick={() => setShowBackupPrompt(false)}
                  className="w-full rounded-xl px-4 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-slate-600"
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
          <div className="w-full max-w-md rounded-2xl border border-white/60 bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start gap-3">
              <div
                className={`mt-0.5 rounded-full p-2 ${confirmDialog.tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-primary/10 text-primary'}`}
              >
                <AlertCircle size={18} />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-on-surface">{confirmDialog.title}</h3>
                <p className="text-sm text-on-surface-variant">{confirmDialog.message}</p>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
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
                className={`flex-1 rounded-lg px-4 py-2.5 font-semibold text-white transition-colors disabled:opacity-50 ${
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
          <div className="glass-panel w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-on-surface">Edit Course Offering</h3>
                {editingFromNotification && (
                  <p className="mt-0.5 text-xs text-amber-600 font-semibold">From notification</p>
                )}
              </div>
              <button
                onClick={() => {
                  setEditingId(null);
                  setEditingFromNotification(false);
                  setNotificationMissingFields(new Set());
                }}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/60 hover:text-on-surface"
              >
                <X size={20} />
              </button>
            </div>

            {offeringError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle size={16} />
                {offeringError}
              </div>
            )}

            {editingFromNotification && (
              <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-amber-500" />
                <div>
                  <p className="font-semibold">Fixing missing data</p>
                  <p className="text-xs mt-0.5 text-amber-700">Filled fields are locked. Only highlighted fields need your attention.</p>
                </div>
              </div>
            )}

            {editingId && (
              <div className="space-y-6">
                {columnGroups.map((group) => (
                  <div key={group.title} className={`space-y-4 rounded-xl ${group.color} p-4`}>
                    <h4 className={`text-sm font-bold uppercase tracking-[0.2em] ${group.titleColor}`}>
                      {group.title}
                    </h4>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {group.columns.map((col) => {
                        const isLocked = editableKeys !== null && !editableKeys.has(col.key);
                        const isMissing = editableKeys !== null && editableKeys.has(col.key);
                        return (
                          <div key={col.key}>
                            <label className={`mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.2em] ${isLocked ? 'text-slate-400' : 'text-on-surface-variant/70'}`}>
                              {col.label}
                              {isLocked && <Lock size={10} className="text-slate-300" />}
                              {isMissing && <span className="text-[10px] text-amber-600 font-bold normal-case tracking-normal">MISSING</span>}
                            </label>
                            {isLocked ? (
                              <div className="flex items-center gap-2 w-full rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-400 cursor-not-allowed select-none">
                                <Lock size={11} className="flex-shrink-0 text-slate-300" />
                                <span className="truncate">{(() => { const v = editingData[col.key]; return (v !== undefined && v !== null && v !== '' && v !== 0) ? String(v) : '—'; })()}</span>
                              </div>
                            ) : col.key === 'mth_room_id' || col.key === 'tfs_room_id' ? (
                              <div className={isMissing ? 'ring-2 ring-amber-400/40 rounded-lg' : ''}>
                                {renderRoomPicker(col.key)}
                              </div>
                            ) : (
                              <input
                                type={numericCols.has(col.key) ? 'number' : 'text'}
                                value={editingData[col.key] ?? ''}
                                onChange={(e) => setEditingData({ ...editingData, [col.key]: e.target.value })}
                                className={`w-full rounded-lg border px-3 py-2 text-sm text-on-surface outline-none transition-all ${
                                  isMissing
                                    ? 'border-amber-300 bg-amber-50/40 ring-2 ring-amber-400/30 focus:border-amber-500 focus:ring-amber-400/50'
                                    : 'border-white/60 bg-white/70 focus:border-primary focus:ring-2 focus:ring-primary/20'
                                }`}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="flex gap-3 pt-6">
                  <button
                    onClick={() => {
                      setEditingId(null);
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
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-xl font-bold text-on-surface">Add New Course Offering</h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingData({});
                  setOfferingError(null);
                  setDuplicateCodeSuggestions([]);
                }}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-on-surface"
              >
                <X size={20} />
              </button>
            </div>

            {offeringError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle size={16} />
                {offeringError}
              </div>
            )}

            {duplicateCodeSuggestions.length > 0 && (
              <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                <p className="mb-2 text-sm font-semibold text-yellow-900">Similar course codes found:</p>
                <div className="space-y-1 text-sm text-yellow-800">
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
                <h4 className="text-sm font-bold uppercase tracking-[0.2em] text-on-surface-variant/80">
                  Basic Information
                </h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Course Code with duplicate detection */}
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                      Course Code *
                    </label>
                    <input
                      type="text"
                      value={editingData.code ?? ''}
                      onChange={(e) => {
                        setEditingData({ ...editingData, code: e.target.value });
                        handleCheckDuplicateCode(e.target.value);
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                      placeholder="Enter course code"
                    />
                  </div>

                  {/* Course Number */}
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                      Course Number *
                    </label>
                    <input
                      type="text"
                      value={editingData.course_no ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, course_no: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                      placeholder="Enter course number"
                    />
                  </div>

                  {/* Section */}
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                      Section *
                    </label>
                    <input
                      type="text"
                      value={editingData.section ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, section: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                      placeholder="Enter section"
                    />
                  </div>

                  {/* Department Dropdown */}
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                      Department *
                    </label>
                    <select
                      value={editingData.department_id ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, department_id: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                      Curriculum ID *
                    </label>
                    <input
                      type="text"
                      value={editingData.curr_id ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, curr_id: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                      placeholder="Enter curriculum ID"
                    />
                  </div>

                  {/* Descriptive Title */}
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                      Descriptive Title
                    </label>
                    <input
                      type="text"
                      value={editingData.descriptive_title ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, descriptive_title: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                      placeholder="Enter course title"
                    />
                  </div>
                </div>
              </div>

              {/* Hours and Units Section */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-[0.2em] text-on-surface-variant/80">
                  Hours & Units
                </h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                      Units
                    </label>
                    <input
                      type="number"
                      value={editingData.units ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, units: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                      Lecture Hours
                    </label>
                    <input
                      type="number"
                      value={editingData.lec_hrs ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, lec_hrs: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                      Lab Hours
                    </label>
                    <input
                      type="number"
                      value={editingData.lab_hrs ?? ''}
                      onChange={(e) => setEditingData({ ...editingData, lab_hrs: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>

              {/* Schedules Section */}
              <div className="space-y-4">
                <h4 className="text-sm font-bold uppercase tracking-[0.2em] text-on-surface-variant/80">
                  Schedules & Rooms (At least one required *)
                </h4>

                {/* MTH Schedule & Room */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h5 className="font-semibold text-on-surface">MTH Schedule & Room</h5>
                    <span className={`text-sm font-semibold ${getSchedulePairStatus(editingData.mth_schedule, editingData.mth_room_id).status === 'complete' ? 'text-green-600' : getSchedulePairStatus(editingData.mth_schedule, editingData.mth_room_id).status === 'incomplete' ? 'text-yellow-600' : 'text-slate-400'}`}>
                      {getSchedulePairStatus(editingData.mth_schedule, editingData.mth_room_id).icon || '○'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                        Schedule (e.g., MWF 10:00-11:30 or MTH 14:00-15:30)
                      </label>
                      <input
                        type="text"
                        value={editingData.mth_schedule ?? ''}
                        onChange={(e) => setEditingData({ ...editingData, mth_schedule: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                        placeholder="e.g., MWF 10:00-11:30"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                        Room
                      </label>
                      {renderRoomPicker('mth_room_id')}
                    </div>
                  </div>
                </div>

                {/* TFS Schedule & Room */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h5 className="font-semibold text-on-surface">TFS Schedule & Room (Optional)</h5>
                    <span className={`text-sm font-semibold ${getSchedulePairStatus(editingData.tfs_schedule, editingData.tfs_room_id).status === 'complete' ? 'text-green-600' : getSchedulePairStatus(editingData.tfs_schedule, editingData.tfs_room_id).status === 'incomplete' ? 'text-yellow-600' : 'text-slate-400'}`}>
                      {getSchedulePairStatus(editingData.tfs_schedule, editingData.tfs_room_id).icon || '○'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                        Schedule (e.g., TTh 10:00-11:30 or TFS 14:00-15:30)
                      </label>
                      <input
                        type="text"
                        value={editingData.tfs_schedule ?? ''}
                        onChange={(e) => setEditingData({ ...editingData, tfs_schedule: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                        placeholder="e.g., TTh 10:00-11:30"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                        Room
                      </label>
                      {renderRoomPicker('tfs_room_id')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingData({});
                    setOfferingError(null);
                    setDuplicateCodeSuggestions([]);
                  }}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddOffering}
                  disabled={savingOffering || !isFormValid(editingData)}
                  title={!isFormValid(editingData) ? getDisabledReason(editingData) : ''}
                  className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingOffering ? 'Creating...' : 'Create Offering'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
