import { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import Toast from '../components/Toast';
import { ArrowUpDown, BookOpen, PlusCircle, Edit2, Trash2, Search, ChevronLeft, ChevronRight, Check, X, AlertCircle, RotateCcw, RefreshCw, Settings, GitCompare, Download } from 'lucide-react';
import { fetchSubjects, fetchSubjectPageNumber, fetchSubjectById, updateSubjectStatus, createSubject, updateSubject, deleteSubject } from '../services/subjectsApi';
import { fetchDepartments } from '../services/departmentsApi';
import { fetchRooms, fetchRoomBookings } from '../services/roomsApi';
import { useRoomConflictMap, useConflictingIdSets } from '../hooks/useRoomConflictMap';
import { syncSubjectsFromOfferings, applyGeneralTagsToSubjects } from '../services/courseOfferingsApi';
import NotificationButton from '../components/NotificationButton';
import RoomConflictsPanel from '../components/RoomConflictsPanel';
import { syncSubjectNotifications } from '../services/notificationsApi';
import { useRowHighlight } from '../hooks/useRowHighlight.jsx';
import { useNotifications } from '../hooks/useNotifications';
import { highlightRowElement } from '../utils/highlightRow.js';
import { normalizeNotificationSeverity } from '../utils/notificationUtils';
import ScheduleCardInput from '../components/ScheduleCardInput';
import { buildScheduleString, parseScheduleString, emptyCardState, formatScheduleDisplay, isSimpleSchedule, getScheduleAmPm } from '../utils/scheduleUtils';

const GENERAL_RE = /^(G[- ]|CFE|PATH\s*FIT|NSTP|ADV\s*ORAL(\s*COM)?|FOR\s*LANG)/i;

const columns = [
  { key: 'curr_id', label: 'Curriculum ID' },
  { key: 'subject_code', label: 'Code' },
  { key: 'subject_course_no', label: 'Course No' },
  { key: 'subject_descriptive_title', label: 'Description' },
  { key: 'department_info', label: 'Department' },
  { key: 'merged', label: 'Merged' },
  { key: 'mth_schedule', label: 'MTH' },
  { key: 'tfs_schedule', label: 'TFS' },
  { key: 'room', label: 'Room' },
  { key: 'subject_units', label: 'Units' },
  { key: 'subject_lec_lab', label: 'Lec/Lab' },
  { key: 'is_general', label: 'General' },
  { key: 'subject_status', label: 'Status' },
];

export default function SubjectsView({ subjectMutationKey = 0 } = {}) {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState(1);
  const [total, setTotal] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [updatingGeneral, setUpdatingGeneral] = useState(null);
  const [updateError, setUpdateError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'subject_code', direction: 'asc' });
  const [roomNameById, setRoomNameById] = useState({});
  const [roomObjects, setRoomObjects] = useState([]);
  const [roomBookings, setRoomBookings] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [successToast, setSuccessToast] = useState(null);

  // Structured schedule card state shared between Add and Edit modals
  const [mthCard, setMthCard] = useState(emptyCardState('mth'));
  const [tfsCard, setTfsCard] = useState(emptyCardState('tfs'));
  const [mthCardModified, setMthCardModified] = useState(false);
  const [tfsCardModified, setTfsCardModified] = useState(false);

  // Add Subject modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSubject, setNewSubject] = useState({
    subject_code: '',
    subject_course_no: '',
    subject_descriptive_title: '',
    subject_units: 3,
    subject_lec_hrs: 3,
    subject_lab_hrs: 0,
    is_general: false,
    mth_schedule: '',
    tfs_schedule: '',
    mth_room: [],
    tfs_room: [],
    subject_status: 'active',
    curr_id: '',
    department_id: '',
  });
  const [savingSubject, setSavingSubject] = useState(false);
  const [subjectError, setSubjectError] = useState(null);
  const [fetching, setFetching] = useState(false);

  // Edit Subject modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingSubject, setEditingSubject] = useState(null);
  const [editingData, setEditingData] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const {
    subjectNotifications,
    subjectLoading: subjectNotificationsLoading,
    rescanBoth: handleRescanNotifications,
    resolveSubject: handleResolveNotification,
    refreshSubject: refreshNotifications,
    rescanning,
  } = useNotifications();
  const [notifSeverityFilter, setNotifSeverityFilter] = useState('all');
  const [notifSearch, setNotifSearch] = useState('');
  const [compareIds, setCompareIds] = useState(null); // null | [id1, id2]
  const [pendingScrollToSubject, setPendingScrollToSubject] = useState(null);

  const [visibleColumns, setVisibleColumns] = useState(new Set(columns.map(c => c.key)));
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [colMenuPos, setColMenuPos] = useState({ top: 0, left: 0 });
  const colButtonRef = useRef(null);
  const colMenuRef = useRef(null);
  const pendingStatusUpdatesRef = useRef(new Set());
  const skipNextSearchResetRef = useRef(false);

  useEffect(() => {
    if (!successToast) return;
    const timer = setTimeout(() => setSuccessToast(null), 3000);
    return () => clearTimeout(timer);
  }, [successToast]);

  useEffect(() => {
    if (!colMenuOpen) return;

    const updatePosition = () => {
      if (!colButtonRef.current) return;
      const rect = colButtonRef.current.getBoundingClientRect();
      setColMenuPos({
        top: rect.bottom + 8,
        left: rect.right - 224,
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

  function toggleColumnVisibility(columnKey) {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(columnKey)) {
        next.delete(columnKey);
      } else {
        next.add(columnKey);
      }
      return next;
    });
  }

  // Selection state for bulk actions (checkboxes)
  const [selectedSubjects, setSelectedSubjects] = useState(new Set());

  const toggleSelectSubject = (subjectId) => {
    setSelectedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) next.delete(subjectId);
      else next.add(subjectId);
      return next;
    });
  };

  const toggleSelectAllSubjects = () => {
    if (selectedSubjects.size === sortedSubjects.length && sortedSubjects.length > 0) {
      setSelectedSubjects(new Set());
    } else {
      setSelectedSubjects(new Set(sortedSubjects.map((s) => s.subject_id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedSubjects.size === 0) return;
    if (!window.confirm(`Delete ${selectedSubjects.size} subject(s)? This cannot be undone.`)) return;
    try {
      setUpdateError(null);
      const ids = Array.from(selectedSubjects);
      const deletePromises = ids.map((id) => deleteSubject(id));
      await Promise.all(deletePromises);
      setSelectedSubjects(new Set());
      await loadSubjects();
      refreshNotifications();
    } catch (err) {
      setUpdateError(err.message || 'Failed to delete subjects');
    }
  };

  // Strip schedule_conflict issues — those are shown exclusively in the Room Conflicts panel.
  const subjectNotificationsNoConflicts = useMemo(() => {
    return subjectNotifications
      .map((item) => ({
        ...item,
        issues: (item.issues || []).filter((i) => i.field !== 'schedule_conflict'),
        missingFields: (item.missingFields || []).filter((f) => f !== 'schedule_conflict'),
      }))
      .filter((item) => item.issues.length > 0);
  }, [subjectNotifications]);

  const visibleSubjectNotifications = useMemo(() => {
    const searchTerm = String(notifSearch || '').trim().toLowerCase();

    return subjectNotificationsNoConflicts.filter((item) => {
      const severity = normalizeNotificationSeverity(item.severity);
      if (notifSeverityFilter !== 'all' && severity !== notifSeverityFilter) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        item.title,
        item.description,
        ...(Array.isArray(item.missingFields) ? item.missingFields : []),
        ...(Array.isArray(item.issues) ? item.issues.map((issue) => issue.message) : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(searchTerm);
    });
  }, [subjectNotificationsNoConflicts, notifSeverityFilter, notifSearch]);

  const subjectNotificationStats = useMemo(() => {
    const stats = { total: 0, critical: 0, medium: 0, low: 0 };

    for (const item of subjectNotificationsNoConflicts) {
      const severity = normalizeNotificationSeverity(item.severity);
      stats.total += 1;
      if (severity === 'critical') stats.critical += 1;
      else if (severity === 'medium') stats.medium += 1;
      else if (severity === 'low') stats.low += 1;
    }

    return stats;
  }, [subjectNotificationsNoConflicts]);

  const { setHighlight } = useRowHighlight();

  // Debounced search: update search state when searchInput changes
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      setSearch(searchInput);
      if (skipNextSearchResetRef.current) {
        skipNextSearchResetRef.current = false;
      } else {
        setPage(1); // Reset to page 1 when search changes
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(debounceTimer);
  }, [searchInput]);

  const handleSearchNow = useCallback(() => {
    setSearch(searchInput);
    setPage(1);
  }, [searchInput]);

  useLayoutEffect(() => {
    if (!pendingScrollToSubject?.id) return;

    highlightRowElement(pendingScrollToSubject.id, {
      scrollIntoView: true,
      severity: pendingScrollToSubject.severity,
      retry: true,
      maxWaitMs: 2500,
      pollIntervalMs: 16,
      onHighlighted: () => setPendingScrollToSubject(null),
    });
  }, [pendingScrollToSubject, subjects]);

  function clearSubjectFiltersForJump() {
    skipNextSearchResetRef.current = true;
    setSearchInput('');
    setSearch('');
    setSearchField('all');
    setStatusFilter('');
  }

  // Load subjects data
  useEffect(() => {
    if (compareIds) return;
    loadSubjects();
  }, [page, limit, search, searchField, statusFilter, subjectMutationKey, compareIds]);


  const handleInlineSave = async ({ offeringId, field, value }) => {
    const subjectId = offeringId;
    if (!subjectId) return;
    const keyMap = {
      'Course Code': 'subject_code', 'Course Number': 'subject_course_no', 'Course Title': 'subject_descriptive_title',
      'Curriculum': 'curr_id', 'Credit Units': 'subject_units', 'Lecture Hours': 'subject_lec_hrs',
      'code': 'subject_code', 'course_no': 'subject_course_no', 'descriptive_title': 'subject_descriptive_title',
      'curr_id': 'curr_id', 'units': 'subject_units', 'lec_hrs': 'subject_lec_hrs',
    };
    const dbField = keyMap[field] || field;
    try {
      await updateSubject(subjectId, { [dbField]: value });
        syncSubjectNotifications(subjectId)
        .then(() => refreshNotifications())
        .catch(() => {});
    } catch (err) {
      console.error('Inline save (subject) failed:', err);
    }
  };

  useEffect(() => {
    loadRoomLookup();
  }, []);

  useEffect(() => {
    let active = true;

    fetchRoomBookings()
      .then((rows) => { if (active) setRoomBookings(rows); })
      .catch((err) => console.error('Failed to load room bookings:', err));

    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetchDepartments()
      .then((rows) => { if (active) setDepartments(Array.isArray(rows) ? rows : []); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Conflict set derived from full-DB room bookings — covers every page, not just the first 500 notifications.
  const { conflictingSubjectIds } = useConflictingIdSets(roomBookings);

  // Auto-toggle subject_status based on open notification issues
  // Runs on initial load, refresh, and whenever notifications or subjects change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!subjects.length || subjectNotificationsLoading) return;

    const toUpdate = subjects.filter((s) => {
      if (pendingStatusUpdatesRef.current.has(s.subject_id)) return false;
      const { hasOpenIssues } = getSubjectIssueState(s.subject_id);
      const desired = hasOpenIssues ? 'inactive' : 'active';
      return desired !== s.subject_status;
    });

    if (!toUpdate.length) return;

    toUpdate.forEach((s) => pendingStatusUpdatesRef.current.add(s.subject_id));

    async function runBatched() {
      const CONCURRENCY = 5;
      for (let i = 0; i < toUpdate.length; i += CONCURRENCY) {
        const batch = toUpdate.slice(i, i + CONCURRENCY);
        const batchUpdates = new Map();
        await Promise.all(
          batch.map(async (s) => {
            const { hasOpenIssues } = getSubjectIssueState(s.subject_id);
            const desired = hasOpenIssues ? 'inactive' : 'active';
            try {
              await updateSubjectStatus(s.subject_id, desired);
              batchUpdates.set(s.subject_id, desired);
            } catch (_) {
              // ignore individual failures; effect will retry on next notification reload
            } finally {
              pendingStatusUpdatesRef.current.delete(s.subject_id);
            }
          })
        );
        if (batchUpdates.size > 0) {
          setSubjects((prev) =>
            prev.map((sub) =>
              batchUpdates.has(sub.subject_id)
                ? { ...sub, subject_status: batchUpdates.get(sub.subject_id) }
                : sub
            )
          );
          const delta = [...batchUpdates.values()].reduce(
            (acc, v) => acc + (v === 'active' ? 1 : -1),
            0
          );
          setActiveCount((c) => c + delta);
        }
      }
      setUpdatingStatus(null);
    }

    runBatched();
  }, [subjectNotifications, subjects, subjectNotificationsLoading]);

  async function loadRoomLookup({ forceRefresh = false } = {}) {
    const CACHE_KEY = 'chronomaria_room_lookup';
    const OBJECTS_CACHE_KEY = 'chronomaria_room_objects';
    if (!forceRefresh) {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        const cachedObjects = sessionStorage.getItem(OBJECTS_CACHE_KEY);
        if (cached && cachedObjects) {
          const parsed = JSON.parse(cached);
          const parsedObjects = JSON.parse(cachedObjects);
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0 && Array.isArray(parsedObjects)) {
            setRoomNameById(parsed);
            setRoomObjects(parsedObjects);
            return;
          }
        }
      } catch (_) {
        // ignore parse errors
      }
    }

    try {
      const nextLookup = {};
      const allRoomRows = [];
      const pageSize = 200;
      let currentPage = 1;
      let hasMore = true;

      while (hasMore) {
        const result = await fetchRooms({ page: currentPage, limit: pageSize });
        const rows = Array.isArray(result.rows) ? result.rows : [];

        for (const row of rows) {
          const roomId = String(row.room_id ?? '').trim();
          const roomName = String(row.room_name ?? '').trim();
          if (roomId && roomName) {
            nextLookup[roomId] = roomName;
          }
          allRoomRows.push(row);
        }

        hasMore = rows.length === pageSize;
        currentPage += 1;
      }

      setRoomNameById(nextLookup);
      setRoomObjects(allRoomRows);
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(nextLookup));
        sessionStorage.setItem(OBJECTS_CACHE_KEY, JSON.stringify(allRoomRows));
      } catch (_) {}
    } catch {
      setRoomNameById({});
    }
  }

  async function handleFetch() {
    try {
      setFetching(true);
      await syncSubjectsFromOfferings();
      // Set is_general=true on subjects whose linked course offering has tag='general'
      await applyGeneralTagsToSubjects().catch(() => {});
      await loadSubjects();
    } catch (_) {
    } finally {
      setFetching(false);
    }
  }

  async function loadSubjects() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchSubjects({
        page,
        limit,
        search,
        searchField,
        status: statusFilter,
      });
      setSubjects(data.rows);
      setTotal(data.total);
      setActiveCount(data.activeCount ?? 0);
    } catch (err) {
      setError(err.message || 'Failed to load subjects');
    } finally {
      setLoading(false);
    }
  }


  // Compare mode: fetch exactly the two conflicting subjects by ID.
  useEffect(() => {
    if (!compareIds) return;
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all(compareIds.map((id) => fetchSubjectById(id)))
      .then((results) => {
        if (!active) return;
        const rows = results.filter(Boolean);
        setSubjects(rows);
        setTotal(rows.length);
      })
      .catch(() => { if (active) { setSubjects([]); setTotal(0); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [compareIds]);

  const exitCompareMode = () => {
    setCompareIds(null);
  };

  function scrollToSubjectRowById(subjectId, severity = null) {
    const rowElement = document.getElementById(`subject-row-${subjectId}`);
    if (rowElement) {
      setHighlight(subjectId, 'SubjectsView', severity, { retry: true, maxWaitMs: 1200, pollIntervalMs: 16 });
      return;
    }

    const numericId = Number(subjectId);
    if (!numericId || Number.isNaN(numericId)) {
      return;
    }

    // Use the page-lookup endpoint instead of iterating up to 200 pages
    (async () => {
      try {
        clearSubjectFiltersForJump();
        const targetPage = await fetchSubjectPageNumber(numericId, { search: '', searchField: 'all', status: '', limit });
        if (!targetPage) return;
        if (targetPage !== page) {
          setPage(targetPage);
        }
        setPendingScrollToSubject({ id: subjectId, severity });
      } catch (_) {
        // ignore fallback failures
      }
    })();
  }

  async function handleStatusToggle(subjectId, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    try {
      setUpdatingStatus(subjectId);
      setUpdateError(null);
      await updateSubjectStatus(subjectId, newStatus);
      // Update local state
      setSubjects(subjects.map(s => 
        s.subject_id === subjectId 
          ? { ...s, subject_status: newStatus }
          : s
      ));
      setActiveCount((currentCount) => currentCount + (newStatus === 'active' ? 1 : -1));
    } catch (err) {
      if (String(err.message || '').includes('404')) {
        await loadSubjects();
        setUpdateError('That subject was removed. The list has been refreshed.');
        return;
      }
      setUpdateError(err.message || 'Failed to update status');
    } finally {
      setUpdatingStatus(null);
    }
  }

  async function handleGeneralToggle(subjectId, currentValue) {
    const newValue = !Boolean(currentValue);
    try {
      setUpdatingGeneral(subjectId);
      setUpdateError(null);
      const updated = await updateSubject(subjectId, { is_general: newValue });
      setSubjects(subjects.map((s) =>
        s.subject_id === subjectId
          ? { ...s, ...updated }
          : s
      ));
    } catch (err) {
      if (String(err.message || '').includes('404')) {
        await loadSubjects();
        setUpdateError('That subject was removed. The list has been refreshed.');
        return;
      }
      setUpdateError(err.message || 'Failed to update general flag');
    } finally {
      setUpdatingGeneral(null);
    }
  }

  async function handleEditSubject(subject, { fromNotification = false, missingFields = [] } = {}) {
    setEditingSubject({
      ...subject,
      _fromNotification: fromNotification,
      _missingFields: missingFields,
    });
    setEditingData({
      subject_code: subject.subject_code || '',
      subject_course_no: subject.subject_course_no || '',
      subject_descriptive_title: subject.subject_descriptive_title || '',
      subject_units: subject.subject_units || 0,
      subject_lec_hrs: subject.subject_lec_hrs || 0,
      subject_lab_hrs: subject.subject_lab_hrs || 0,
      is_general: Boolean(subject.is_general),
      mth_schedule: subject.mth_schedule || '',
      tfs_schedule: subject.tfs_schedule || '',
      mth_room: (subject.mth_room || subject.mth_room_id || '').toString().split('/').map(s => s.trim()).filter(Boolean),
      tfs_room: (subject.tfs_room || subject.tfs_room_id || '').toString().split('/').map(s => s.trim()).filter(Boolean),
      subject_section: subject.subject_section || '',
      department_id: subject.department_id ?? '',
      subject_status: subject.subject_status || 'active',
      curr_id: subject.curr_id ?? '',
    });
    // Pre-populate structured card state from existing schedule strings
    const mthParsed = parseScheduleString(subject.mth_schedule || '', 'mth');
    setMthCard(mthParsed ? { enabled: true, ...mthParsed } : emptyCardState('mth'));
    const tfsParsed = parseScheduleString(subject.tfs_schedule || '', 'tfs');
    setTfsCard(tfsParsed ? { enabled: true, ...tfsParsed } : emptyCardState('tfs'));
    setMthCardModified(false);
    setTfsCardModified(false);
    setShowEditModal(true);
    setEditError(null);
  }

  async function handleSaveEdit() {
    if (!editingSubject || !editingData.subject_code) {
      setEditError('Subject code is required');
      return;
    }
    try {
      setSavingEdit(true);
      setEditError(null);
      const previousStatus = editingSubject.subject_status || 'active';
      // Preserve original complex schedule strings when the card was not touched by the user
      const mthStr = mthCardModified
        ? (mthCard.enabled ? buildScheduleString('mth', mthCard.mode, mthCard.startH, mthCard.startM, mthCard.endH, mthCard.endM, mthCard.type, mthCard.hasSec, mthCard.startH2, mthCard.startM2, mthCard.endH2, mthCard.endM2, mthCard.type2) : null)
        : (editingData.mth_schedule || null);
      const tfsStr = tfsCardModified
        ? (tfsCard.enabled ? buildScheduleString('tfs', tfsCard.mode, tfsCard.startH, tfsCard.startM, tfsCard.endH, tfsCard.endM, tfsCard.type, tfsCard.hasSec, tfsCard.startH2, tfsCard.startM2, tfsCard.endH2, tfsCard.endM2, tfsCard.type2) : null)
        : (editingData.tfs_schedule || null);
      const payload = {
        ...editingData,
        mth_schedule: mthStr || null,
        tfs_schedule: tfsStr || null,
        mth_room: mthCard.enabled ? buildCombinedRoomId(editingData.mth_room) : '',
        tfs_room: tfsCard.enabled ? buildCombinedRoomId(editingData.tfs_room) : '',
      };
      const updated = await updateSubject(editingSubject.subject_id, payload);
      // Update local state
      setSubjects(subjects.map(s => s.subject_id === editingSubject.subject_id ? updated : s));
      if ((previousStatus === 'active') !== (updated.subject_status === 'active')) {
        setActiveCount((currentCount) => currentCount + (updated.subject_status === 'active' ? 1 : -1));
      }
      setSuccessToast(`Updated "${editingSubject.subject_code}"`);
      setShowEditModal(false);
      setEditingSubject(null);
      setMthCard(emptyCardState('mth'));
      setTfsCard(emptyCardState('tfs'));
      syncSubjectNotifications(editingSubject.subject_id)
        .then(() => refreshNotifications())
        .catch(() => {});
    } catch (err) {
      if (String(err.message || '').includes('404')) {
        setShowEditModal(false);
        setEditingSubject(null);
        setMthCard(emptyCardState('mth'));
        setTfsCard(emptyCardState('tfs'));
        await loadSubjects();
        setUpdateError('That subject was removed. The list has been refreshed.');
        return;
      }
      setEditError(err.message || 'Failed to save subject');
    } finally {
      setSavingEdit(false);
    }
  }

  function handleDeleteSubject(subject) {
    setConfirmDialog({
      title: 'Delete subject?',
      message: `Delete "${subject.subject_code} - ${subject.subject_descriptive_title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        try {
          setUpdateError(null);
          await deleteSubject(subject.subject_id);
          if (subject.subject_status === 'active') {
            setActiveCount((c) => Math.max(0, c - 1));
          }
          setSuccessToast(`Deleted "${subject.subject_code}"`);
          await loadSubjects();
          refreshNotifications();
        } catch (err) {
          if (String(err.message || '').includes('404')) {
            await loadSubjects();
            setUpdateError('That subject was already removed. The list has been refreshed.');
            return;
          }
          setUpdateError(err.message || 'Failed to delete subject');
        } finally {
          setConfirmDialog(null);
        }
      },
    });
  }

  function handleSort(columnKey) {
    setSortConfig((currentSort) => ({
      key: columnKey,
      direction: currentSort.key === columnKey && currentSort.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  const sortedSubjects = useMemo(() => {
    const items = [...subjects];
    const directionMultiplier = sortConfig.direction === 'asc' ? 1 : -1;

    const getComparableValue = (subject, key) => {
      switch (key) {
        case 'subject_code':
          return String(subject.subject_code ?? '');
        case 'subject_course_no':
          return String(subject.subject_course_no ?? '');
        case 'subject_descriptive_title':
          return String(subject.subject_descriptive_title ?? '');
        case 'subject_units':
          return Number(subject.subject_units ?? 0);
        case 'curr_id':
          return Number(subject.curr_id ?? 0);
        case 'department_info':
          return String(subject.departments?.department_name ?? '');
        case 'mth_schedule':
          return String(subject.mth_schedule ?? '');
        case 'tfs_schedule':
          return String(subject.tfs_schedule ?? '');
        case 'mth_room':
          return String(subject.mth_room ?? subject.mth_room_id ?? '');
        case 'tfs_room':
          return String(subject.tfs_room ?? subject.tfs_room_id ?? '');
        case 'room':
          return extractRoomSummary(subject);
        case 'subject_lec_lab':
          return [Number(subject.subject_lec_hrs ?? 0), Number(subject.subject_lab_hrs ?? 0)];
        case 'is_general':
          return subject.is_general ? 1 : 0;
        case 'subject_status':
          return String(subject.subject_status ?? '');
        default:
          return String(subject.subject_code ?? '');
      }
    };

    items.sort((left, right) => {
      const leftValue = getComparableValue(left, sortConfig.key);
      const rightValue = getComparableValue(right, sortConfig.key);

      if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
        const [leftLec, leftLab] = leftValue;
        const [rightLec, rightLab] = rightValue;
        if (leftLec !== rightLec) {
          return (leftLec - rightLec) * directionMultiplier;
        }
        return (leftLab - rightLab) * directionMultiplier;
      }

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * directionMultiplier;
      }

      return String(leftValue).localeCompare(String(rightValue), undefined, { sensitivity: 'base' }) * directionMultiplier;
    });

    return items;
  }, [subjects, sortConfig]);

  async function handleAddSubject() {
    if (!newSubject.subject_code) {
      setSubjectError('Subject code is required');
      return;
    }
    try {
      setSavingSubject(true);
      setSubjectError(null);
      const mthStr = mthCard.enabled ? buildScheduleString('mth', mthCard.mode, mthCard.startH, mthCard.startM, mthCard.endH, mthCard.endM, mthCard.type, mthCard.hasSec, mthCard.startH2, mthCard.startM2, mthCard.endH2, mthCard.endM2, mthCard.type2) : null;
      const tfsStr = tfsCard.enabled ? buildScheduleString('tfs', tfsCard.mode, tfsCard.startH, tfsCard.startM, tfsCard.endH, tfsCard.endM, tfsCard.type, tfsCard.hasSec, tfsCard.startH2, tfsCard.startM2, tfsCard.endH2, tfsCard.endM2, tfsCard.type2) : null;
      const payload = {
        ...newSubject,
        mth_schedule: mthStr || null,
        tfs_schedule: tfsStr || null,
        mth_room: mthCard.enabled ? buildCombinedRoomId(newSubject.mth_room) : '',
        tfs_room: tfsCard.enabled ? buildCombinedRoomId(newSubject.tfs_room) : '',
      };
      const createdSubject = await createSubject(payload);
      setSuccessToast(`Created "${newSubject.subject_code}"`);
      // Reset form and close modal
      setShowAddModal(false);
      setMthCard(emptyCardState('mth'));
      setTfsCard(emptyCardState('tfs'));
      setNewSubject({
        subject_code: '',
        subject_course_no: '',
        subject_descriptive_title: '',
        subject_units: 3,
        subject_lec_hrs: 3,
        subject_lab_hrs: 0,
        is_general: false,
        mth_schedule: '',
        tfs_schedule: '',
        mth_room: [],
        tfs_room: [],
        subject_status: 'active',
        curr_id: '',
      });
      if ((createdSubject?.subject_status || 'active') === 'active') {
        setActiveCount((currentCount) => currentCount + 1);
      }
      // Reload subjects then sync notifications
      await loadSubjects();
      refreshNotifications();
    } catch (err) {
      setSubjectError(err.message || 'Failed to create subject');
    } finally {
      setSavingSubject(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageStart = total === 0 ? 0 : (safePage - 1) * limit + 1;
  const pageEnd = Math.min(safePage * limit, total);

  useEffect(() => {
    setPageInput(page);
  }, [page]);

  useEffect(() => {
    if (total > 0 && page > totalPages) {
      setPage(totalPages);
    }
  }, [page, total, totalPages]);

  const applyPageInput = () => {
    const nextPage = Number(pageInput);
    if (Number.isInteger(nextPage) && nextPage >= 1 && nextPage <= totalPages) {
      setPage(nextPage);
    } else {
      setPageInput(safePage);
    }
  };

  function sortHeaderClass(columnKey) {
    return `flex w-full items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.28em] transition-colors ${
      sortConfig.key === columnKey ? 'text-primary' : 'text-on-surface-variant/70 hover:text-on-surface'
    }`;
  }

  function extractTimeRange(value) {
    if (!value) {
      return '';
    }

    const match = String(value).match(/\b\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\b/);
    return match ? match[0].replace(/\s+/g, '') : '';
  }

  function getRoomName(roomId) {
    if (roomId === null || roomId === undefined || roomId === '') {
      return '';
    }

    let token = String(roomId).trim();
    if (!token) {
      return '';
    }

    token = token.replace(/^(?:room|rm)\s*/i, '').trim();
    if (!token) {
      return '';
    }

    const lookup = roomNameById[token] || roomNameById[String(Number(token))];
    return lookup || token;
  }

  function parseRoomTokens(value) {
    if (value === null || value === undefined || value === '') {
      return [];
    }

    if (Array.isArray(value)) {
      return value.flatMap((item) => parseRoomTokens(item));
    }

    if (typeof value === 'object') {
      if (value.room_id || value.id) {
        return [String(value.room_id ?? value.id)];
      }
      return [String(value)];
    }

    const raw = String(value).trim();
    if (!raw) {
      return [];
    }

    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        const parsed = JSON.parse(raw);
        return parseRoomTokens(parsed);
      } catch (_) {
        // fall back to token parsing below
      }
    }

    return raw
      .replace(/^[\[\]"]+|[\[\]"]+$/g, '')
      .split(/\s*[,/]\s*/)
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => token.replace(/^(?:room|rm)\s*/i, '').trim())
      .filter(Boolean);
  }

  const buildCombinedRoomId = (roomArr) => {
    const ids = (Array.isArray(roomArr) ? roomArr : (roomArr ? [roomArr] : [])).filter(Boolean);
    if (!ids.length) return '';
    if (ids.length === 1 || ids[0] === ids[1]) return ids[0];
    return `${ids[0]}/${ids[1]}`;
  };

  function resolveRoomDisplayValue(value) {
    const tokens = parseRoomTokens(value);
    if (tokens.length === 0) {
      return '';
    }

    return Array.from(new Set(tokens))
      .map(getRoomName)
      .filter(Boolean)
      .join(' / ');
  }

  function extractRoomSummary(subject) {
    const mthRoom = subject.mth_room_name || resolveRoomDisplayValue(subject.mth_room ?? subject.mth_room_id ?? '');
    const tfsRoom = subject.tfs_room_name || resolveRoomDisplayValue(subject.tfs_room ?? subject.tfs_room_id ?? '');

    if (mthRoom && tfsRoom && mthRoom !== tfsRoom) {
      return `MTH: ${mthRoom} | TFS: ${tfsRoom}`;
    }

    return mthRoom || tfsRoom || '—';
  }

  // Pre-computed set of subject IDs that have notifications — avoids O(n) .some() per row
  const notificationSubjectIds = useMemo(
    () => new Set(subjectNotifications.map((item) => Number(item.rowId)).filter(Boolean)),
    [subjectNotifications]
  );

  // Sorted rooms array for ScheduleCardInput (derived from roomNameById dict)
  const roomsArray = useMemo(
    () =>
      Object.entries(roomNameById)
        .map(([id, name]) => ({ room_id: id, room_name: name }))
        .sort((a, b) => a.room_name.localeCompare(b.room_name)),
    [roomNameById]
  );

  const { getConflictingOfferings } = useRoomConflictMap(roomBookings);

  function getSubjectIssueState(subjectId) {
    const id = Number(subjectId);
    const hasNotificationIssues = notificationSubjectIds.has(id);
    const hasScheduleConflict = conflictingSubjectIds.has(id);

    return {
      hasOpenIssues: hasNotificationIssues || hasScheduleConflict,
      hasNotificationIssues,
      hasScheduleConflict,
      conflictingCount: 0,
    };
  }

  const searchFieldLabel = {
    all: 'subjects',
    subject_code: 'code',
    subject_course_no: 'course no',
    subject_descriptive_title: 'title',
    curr_id: 'curriculum ID',
  };

  const exportToCSV = () => {
    if (!subjects.length) return;
    const visibleCols = columns.filter((c) => visibleColumns.has(c.key));
    const headers = visibleCols.map((c) => c.label);
    const rows = subjects.map((s) =>
      visibleCols.map((c) => {
        const v = s[c.key];
        if (v === null || v === undefined) return '';
        return String(v);
      })
    );
    const csv = [
      headers.join(','),
      ...rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    a.download = `subjects-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
<>
<div className="space-y-2 animate-in slide-in-from-right-4 duration-500">
      {/* Header — identity + health monitoring only */}
      <div className="glass-panel p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Identity */}
          <div>
            <h2 className="text-2xl font-bold text-on-surface">Curriculum Repository</h2>
            <div className="mt-0.5 flex items-center gap-2">
              <p className="text-xs text-on-surface-variant">Manage subjects, credit units, and classifications.</p>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/70 px-2 py-0.5 text-xs font-semibold text-on-surface-variant backdrop-blur">
                <BookOpen size={10} className="text-primary" />
                {total}
              </span>
            </div>
          </div>
          {/* Monitoring */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-stretch gap-1 rounded-xl border border-white/60 bg-white/80 p-1.5 backdrop-blur shadow-sm">
              <NotificationButton
                panelSize="lg"
                items={visibleSubjectNotifications}
                title="Subject Notifications"
                emptyLabel="No subject issues"
                buttonLabel="Issues"
                onItemInlineSave={handleInlineSave}
                onItemEdit={(item) => {
                  const subj = item.subject || subjectNotifications.find(s => s.rowId === item.rowId)?.subject;
                  const missingFields = Array.isArray(item.missingFields) ? item.missingFields : [];
                  if (subj) handleEditSubject(subj, { fromNotification: true, missingFields });
                }}
                onItemJump={(item) => {
                  const rowId = item.rowId || (typeof item.subject?.subject_id !== 'undefined' ? item.subject.subject_id : null);
                  if (rowId) scrollToSubjectRowById(rowId, item.severity || null);
                }}
                onItemResolve={(item) => handleResolveNotification(item)}
                severityFilter={notifSeverityFilter}
                onSeverityFilterChange={(v) => setNotifSeverityFilter(v)}
                notificationSearch={notifSearch}
                onNotificationSearchChange={(v) => setNotifSearch(v)}
                notificationStats={subjectNotificationStats}
                isRescanning={rescanning}
              />
              <div className="h-5 w-px bg-slate-200" />
              <button
                onClick={handleRescanNotifications}
                disabled={rescanning}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[40px] min-w-max"
                title="Re-detect all subject issues"
                type="button"
              >
                <RotateCcw size={14} className={rescanning ? 'animate-spin' : ''} />
                <span>{rescanning ? 'Scanning' : 'Rescan'}</span>
              </button>
            </div>
            <div className="flex items-stretch gap-1 rounded-xl border border-white/60 bg-white/80 p-1.5 backdrop-blur shadow-sm">
              <RoomConflictsPanel
                items={subjectNotifications}
                rooms={roomObjects}
                entityType="subject"
                onItemJump={(item) => {
                  const rowId = item.rowId || item.entity_id || null;
                  if (rowId) scrollToSubjectRowById(rowId, item.severity || null);
                }}
                onItemEdit={(item) => {
                  const subj = item.subject || subjectNotifications.find((s) => s.rowId === item.rowId)?.subject;
                  const missingFields = Array.isArray(item.missingFields) ? item.missingFields : [];
                  if (subj) handleEditSubject(subj, { fromNotification: true, missingFields });
                }}
                onCompare={(primaryId, peerId) => setCompareIds([primaryId, peerId])}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Search + Toolbar */}
      <div className="glass-panel space-y-3 p-3">
        {/* Search row — full width */}
        <div className="flex gap-3">
          <select
            value={searchField}
            onChange={(e) => { setSearchField(e.target.value); setPage(1); }}
            className="rounded-lg border border-white/30 bg-white/50 px-3 py-2 text-sm text-on-surface-variant outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white min-h-[44px]"
          >
            <option value="all">All Fields</option>
            <option value="subject_code">Code</option>
            <option value="subject_course_no">Course No</option>
            <option value="subject_descriptive_title">Title</option>
            <option value="curr_id">Curriculum ID</option>
          </select>
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="text"
              placeholder={`Search ${searchFieldLabel[searchField] ?? searchField.replace(/_/g, ' ')}...`}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearchNow(); }}
              className="w-full rounded-lg border border-white/30 bg-white/50 py-2 pl-10 pr-10 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white focus:shadow-lg min-h-[44px]"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                title="Clear search"
                type="button"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Action + Filter row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setMthCard(emptyCardState('mth')); setTfsCard(emptyCardState('tfs')); setShowAddModal(true); }}
              className="btn-primary flex items-center gap-1.5 text-xs px-3 py-2 min-h-[44px]"
              type="button"
              title="Add new subject"
            >
              <PlusCircle size={14} />
              <span>Add</span>
            </button>
            <button
              onClick={handleFetch}
              disabled={fetching || loading}
              className="btn-primary flex items-center gap-1.5 text-xs px-3 py-2 min-h-[44px] disabled:opacity-50"
              title="Sync subjects from course offerings"
              type="button"
            >
              <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />
              <span>{fetching ? 'Fetching…' : 'Fetch'}</span>
            </button>
            <button
              onClick={exportToCSV}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/60 bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 min-h-[44px]"
              type="button"
              title="Export visible subjects to CSV"
            >
              <Download size={14} />
              <span>Export</span>
            </button>
            <div className="h-6 w-px bg-slate-200 mx-0.5" />
            <button
              onClick={() => loadSubjects()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/60 bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 min-h-[44px] disabled:opacity-50"
              title="Reload subjects"
              type="button"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Reload</span>
            </button>
            <button
              ref={colButtonRef}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/60 bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 min-h-[44px]"
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
              onClick={() => { setSearchInput(''); setSearch(''); setSearchField('all'); setStatusFilter(''); setPage(1); }}
              className="rounded-lg border border-white/60 bg-white px-3 py-2 text-xs font-bold text-on-surface-variant transition-all hover:bg-slate-50 min-h-[44px]"
              type="button"
            >
              Reset
            </button>
          </div>

          {/* Status filter pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {['', 'active', 'inactive'].map((status) => (
              <button
                key={status}
                onClick={() => { setStatusFilter(status); setPage(1); }}
                type="button"
                className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] transition min-h-[36px] ${
                  statusFilter === status
                    ? 'bg-primary text-white shadow-md shadow-primary/20'
                    : 'border border-slate-200 bg-white text-on-surface-variant hover:bg-slate-50'
                }`}
              >
                {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'All'}
              </button>
            ))}
          </div>
        </div>

        {updateError && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
            <AlertCircle size={16} />
            <span>{updateError}</span>
          </div>
        )}
      </div>

      {/* Contextual selection bar — only rendered when rows are selected */}
      {selectedSubjects.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-red-700">
            <Trash2 size={15} className="shrink-0" />
            {selectedSubjects.size} subject{selectedSubjects.size > 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedSubjects(new Set())}
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

      {/* Loading State */}
      {loading && (
        <div className="glass-panel flex flex-col items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary"></div>
          <p className="mt-4 text-sm text-on-surface-variant">Loading subjects...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="rounded-xl border border-red-100 bg-red-50 flex items-center gap-3 p-3 text-red-700">
          <AlertCircle size={18} />
          <div>
            <p className="font-bold text-sm">Error loading subjects</p>
            <p className="text-xs">{error}</p>
          </div>
        </div>
      )}

      {/* Subjects Table */}
      {!loading && !error && subjects.length > 0 && (
        <div className="glass-panel overflow-hidden">
          <div className="max-h-[calc(100vh-18rem)] overflow-auto">
            <table className="min-w-full w-full border-collapse text-left text-sm">
              <thead>
                <tr className="sticky top-0 z-20 border-b border-slate-200 bg-white">
                  <th className="px-4 py-3 text-center w-12">
                    <input
                      type="checkbox"
                      checked={selectedSubjects.size > 0 && selectedSubjects.size === sortedSubjects.length}
                      onChange={toggleSelectAllSubjects}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                      aria-label="Select all subjects"
                    />
                  </th>
                  {columns.map(col => visibleColumns.has(col.key) && (
                    <th key={col.key} className="px-4 py-3 text-left">
                      <button type="button" onClick={() => handleSort(col.key)} className={sortHeaderClass(col.key)}>
                        <span>{col.label}</span>
                        <ArrowUpDown size={12} />
                      </button>
                    </th>
                  ))}
                  <th className="sticky right-0 z-30 px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.28em] text-on-surface-variant/70 bg-white">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {sortedSubjects.map((subject, index) => {
                  const issueState = getSubjectIssueState(subject.subject_id);
                  const isSelected = selectedSubjects.has(subject.subject_id);
                  return (
                    <tr id={`subject-row-${subject.subject_id}`} data-subject-id={subject.subject_id} key={subject.subject_id} className={`group transition-colors ${isSelected ? 'bg-primary/10' : issueState.hasScheduleConflict ? 'bg-red-50/70' : 'hover:bg-slate-50'}`}>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectSubject(subject.subject_id)}
                          aria-label={`Select subject ${subject.subject_code || subject.subject_id}`}
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                        />
                      </td>
                      {columns.map(col => visibleColumns.has(col.key) && (
                        <td key={col.key} className="px-4 py-3 align-top">
                          {col.key === 'subject_code' && (
                            <div className="inline-flex items-center gap-1.5">
                              <span className="inline-block rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                                {subject.subject_code || 'N/A'}
                              </span>
                              {issueState.hasScheduleConflict && (
                                <span className="inline-block rounded-md bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                                  Conflict
                                </span>
                              )}
                            </div>
                          )}
                          {col.key === 'subject_course_no' && (
                            <span className="text-sm font-medium text-on-surface">{subject.subject_course_no || '—'}</span>
                          )}
                          {col.key === 'subject_descriptive_title' && (
                            <div className="max-w-xs">
                              <p className="text-sm font-medium text-on-surface truncate">{subject.subject_descriptive_title || '—'}</p>
                            </div>
                          )}
                          {col.key === 'curr_id' && (
                            <span className="block text-sm font-medium text-on-surface">{subject.curr_id || '—'}</span>
                          )}
                          {col.key === 'department_info' && (
                            <span className="text-sm font-medium text-on-surface">{subject.departments?.department_name || '—'}</span>
                          )}
                          {col.key === 'merged' && (
                            <div className="flex justify-center">
                              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                                {subject.merged === true || subject.merged === 'true'
                                  ? 'Merged'
                                  : subject.merged === false || subject.merged === 'false'
                                  ? '—'
                                  : String(subject.merged ?? '—')}
                              </span>
                            </div>
                          )}
                          {col.key === 'mth_schedule' && (
                            <span className="inline-flex items-center gap-1 text-sm text-on-surface-variant flex-wrap">
                              {formatScheduleDisplay(subject.mth_schedule) || extractTimeRange(subject.mth_schedule)}
                              {isSimpleSchedule(subject.mth_schedule) && getScheduleAmPm(subject.mth_schedule) && (
                                <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${getScheduleAmPm(subject.mth_schedule) === 'AM' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {getScheduleAmPm(subject.mth_schedule)}
                                </span>
                              )}
                            </span>
                          )}
                          {col.key === 'tfs_schedule' && (
                            <span className="inline-flex items-center gap-1 text-sm text-on-surface-variant flex-wrap">
                              {formatScheduleDisplay(subject.tfs_schedule) || extractTimeRange(subject.tfs_schedule)}
                              {isSimpleSchedule(subject.tfs_schedule) && getScheduleAmPm(subject.tfs_schedule) && (
                                <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${getScheduleAmPm(subject.tfs_schedule) === 'AM' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {getScheduleAmPm(subject.tfs_schedule)}
                                </span>
                              )}
                            </span>
                          )}
                          {col.key === 'room' && (
                            <span className="block text-sm text-on-surface-variant">{extractRoomSummary(subject)}</span>
                          )}
                          {col.key === 'subject_units' && (
                            <span className="text-sm font-medium text-on-surface">{subject.subject_units || 0}</span>
                          )}
                          {col.key === 'subject_lec_lab' && (
                            <span className="text-sm font-medium text-on-surface-variant">{subject.subject_lec_hrs || 0}h / {subject.subject_lab_hrs || 0}h</span>
                          )}
                          {col.key === 'is_general' && (
                            <div className="flex justify-center">
                              <button
                                onClick={() => handleGeneralToggle(subject.subject_id, subject.is_general)}
                                disabled={updatingGeneral === subject.subject_id}
                                className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-bold transition-all ${
                                  subject.is_general
                                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                } disabled:opacity-50`}
                              >
                                {updatingGeneral === subject.subject_id ? (
                                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                                ) : subject.is_general ? (
                                  <>
                                    <Check size={12} />
                                    General
                                  </>
                                ) : (
                                  <>
                                    <X size={12} />
                                    In scope
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                          {col.key === 'subject_status' && (
                            <div className="flex justify-center">
                              <button
                                onClick={() => handleStatusToggle(subject.subject_id, subject.subject_status)}
                                disabled={updatingStatus === subject.subject_id}
                                className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-bold transition-all ${
                                  subject.subject_status === 'active'
                                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                } disabled:opacity-50`}
                              >
                                {updatingStatus === subject.subject_id ? (
                                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                                ) : subject.subject_status === 'active' ? (
                                  <>
                                    <Check size={12} />
                                    Active
                                  </>
                                ) : (
                                  <>
                                    <X size={12} />
                                    Inactive
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </td>
                      ))}
                      <td className="sticky right-0 z-10 px-4 py-3 bg-white">
                        <div className="flex justify-center gap-1 opacity-80 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={() => handleEditSubject(subject)}
                            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:border-transparent hover:bg-primary/10 hover:text-primary"
                            type="button"
                            aria-label={`Edit ${subject.subject_code}`}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteSubject(subject)}
                            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:border-transparent hover:bg-red-50 hover:text-red-600"
                            type="button"
                            aria-label={`Delete ${subject.subject_code}`}
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

          {!compareIds && totalPages > 1 && (
            <div className="flex flex-col gap-3 border-t border-slate-200 bg-white/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-600">
                Showing {pageStart}-{pageEnd} of {total}
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <button
                  onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
                  disabled={safePage === 1}
                  className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  aria-label="Previous subjects page"
                >
                  <ChevronLeft size={16} />
                  <span>Prev</span>
                </button>
                <div className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <label htmlFor="subjects-page-input" className="text-xs font-semibold text-slate-500">
                    Page
                  </label>
                  <input
                    id="subjects-page-input"
                    type="number"
                    min="1"
                    max={totalPages}
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    onBlur={applyPageInput}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyPageInput();
                    }}
                    className="h-7 w-14 rounded-md border border-slate-200 bg-slate-50 px-2 text-right text-sm font-semibold text-slate-800 outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/10"
                    aria-label="Subjects page number"
                  />
                  <span className="text-xs font-semibold text-slate-500">of {totalPages}</span>
                </div>
                <button
                  onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
                  disabled={safePage === totalPages}
                  className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  aria-label="Next subjects page"
                >
                  <span>Next</span>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && subjects.length === 0 && (
        <div className="glass-panel flex flex-col items-center justify-center py-16 text-center">
          <BookOpen size={40} className="text-on-surface-variant/30" />
          <p className="mt-3 text-sm font-bold text-on-surface">No subjects found</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            {search || statusFilter ? 'Try adjusting your filters' : 'Create your first subject to get started'}
          </p>
        </div>
      )}

      {/* Add Subject Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-5xl rounded-2xl bg-white shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/20 bg-primary px-6 py-4">
              <h3 className="text-lg font-bold text-white">Add New Subject</h3>
              <button
                onClick={() => { setShowAddModal(false); setMthCard(emptyCardState('mth')); setTfsCard(emptyCardState('tfs')); }}
                className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {subjectError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-700" role="alert">
                  <AlertCircle size={18} />
                  {subjectError}
                </div>
              )}

              <div className="space-y-6">
                {/* Basic Information Section */}
                <div className="space-y-4">
                  <h4 className="text-lg font-bold uppercase tracking-[0.2em] text-on-surface-variant/80">
                    Basic Information
                  </h4>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                        Subject Code *
                      </label>
                      <input
                        type="text"
                        value={newSubject.subject_code}
                        onChange={(e) => setNewSubject({ ...newSubject, subject_code: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                        placeholder="e.g., 4700"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                        Course No
                      </label>
                      <input
                        type="text"
                        value={newSubject.subject_course_no}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewSubject({ ...newSubject, subject_course_no: val, ...(GENERAL_RE.test(val) && { is_general: true }) });
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                        placeholder="e.g., HCI-101"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                        Curriculum ID
                      </label>
                      <input
                        type="number"
                        value={newSubject.curr_id}
                        onChange={(e) => setNewSubject({ ...newSubject, curr_id: e.target.value ? parseInt(e.target.value) : '' })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                        placeholder="e.g., 1"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                        Department
                      </label>
                      <select
                        value={newSubject.department_id ?? ''}
                        onChange={(e) => setNewSubject({ ...newSubject, department_id: e.target.value })}
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
                    <div className="sm:col-span-2">
                      <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                        Descriptive Title
                      </label>
                      <input
                        type="text"
                        value={newSubject.subject_descriptive_title}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewSubject({ ...newSubject, subject_descriptive_title: val, ...(GENERAL_RE.test(val) && { is_general: true }) });
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                        placeholder="e.g., Introduction to Human Computer Interactions"
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
                        min="0"
                        max="10"
                        value={newSubject.subject_units}
                        step="0.5"
                        onChange={(e) => setNewSubject({ ...newSubject, subject_units: parseFloat(e.target.value) || 0 })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                        Lecture Hours
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={newSubject.subject_lec_hrs}
                        step="0.5"
                        onChange={(e) => setNewSubject({ ...newSubject, subject_lec_hrs: parseFloat(e.target.value) || 0 })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                        Lab Hours
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={newSubject.subject_lab_hrs}
                        step="0.5"
                        onChange={(e) => setNewSubject({ ...newSubject, subject_lab_hrs: parseFloat(e.target.value) || 0 })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                      />
                    </div>
                  </div>
                </div>

                {/* Schedules Section */}
                <div className="space-y-4">
                  <h4 className="text-lg font-bold uppercase tracking-[0.2em] text-on-surface-variant/80">
                    Schedules & Rooms (At least one required *)
                  </h4>
                  <ScheduleCardInput
                    slot="mth"
                    value={mthCard}
                    onChange={setMthCard}
                    onToggle={() => setMthCard((c) => ({ ...c, enabled: !c.enabled }))}
                    canDisable={tfsCard.enabled}
                    roomId={Array.isArray(newSubject.mth_room) ? (newSubject.mth_room[0] || null) : (newSubject.mth_room || null)}
                    onRoomChange={(id) => setNewSubject((s) => {
                      const arr = [...(Array.isArray(s.mth_room) ? s.mth_room : [''])];
                      arr[0] = id || '';
                      return { ...s, mth_room: arr };
                    })}
                    roomId2={Array.isArray(newSubject.mth_room) ? (newSubject.mth_room[1] || null) : null}
                    onRoomChange2={(id) => setNewSubject((s) => {
                      const arr = [...(Array.isArray(s.mth_room) ? s.mth_room : [''])];
                      if (arr.length < 2) arr.push('');
                      arr[1] = id || '';
                      return { ...s, mth_room: arr };
                    })}
                    rooms={roomsArray}
                    getConflictingOfferings={getConflictingOfferings}
                    editingId={null}
                  />
                  <ScheduleCardInput
                    slot="tfs"
                    value={tfsCard}
                    onChange={setTfsCard}
                    onToggle={() => setTfsCard((c) => ({ ...c, enabled: !c.enabled }))}
                    canDisable={mthCard.enabled}
                    roomId={Array.isArray(newSubject.tfs_room) ? (newSubject.tfs_room[0] || null) : (newSubject.tfs_room || null)}
                    onRoomChange={(id) => setNewSubject((s) => {
                      const arr = [...(Array.isArray(s.tfs_room) ? s.tfs_room : [''])];
                      arr[0] = id || '';
                      return { ...s, tfs_room: arr };
                    })}
                    roomId2={Array.isArray(newSubject.tfs_room) ? (newSubject.tfs_room[1] || null) : null}
                    onRoomChange2={(id) => setNewSubject((s) => {
                      const arr = [...(Array.isArray(s.tfs_room) ? s.tfs_room : [''])];
                      if (arr.length < 2) arr.push('');
                      arr[1] = id || '';
                      return { ...s, tfs_room: arr };
                    })}
                    rooms={roomsArray}
                    getConflictingOfferings={getConflictingOfferings}
                    editingId={null}
                  />
                </div>

                {/* Classification Section */}
                <div className="space-y-4">
                  <h4 className="text-lg font-bold uppercase tracking-[0.2em] text-on-surface-variant/80">
                    Classification
                  </h4>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                        General / In scope
                      </label>
                      <select
                        value={newSubject.is_general ? 'true' : 'false'}
                        onChange={(e) => setNewSubject({ ...newSubject, is_general: e.target.value === 'true' })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                      >
                        <option value="false">In scope</option>
                        <option value="true">General</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-bold uppercase tracking-wide text-on-surface-variant">
                        Status
                      </label>
                      <select
                        value={newSubject.subject_status}
                        onChange={(e) => setNewSubject({ ...newSubject, subject_status: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-on-surface outline-none focus:border-primary min-h-[44px]"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => { setShowAddModal(false); setMthCard(emptyCardState('mth')); setTfsCard(emptyCardState('tfs')); }}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-5 py-3 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 text-base min-h-[48px]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddSubject}
                    disabled={savingSubject}
                    className="flex-1 rounded-lg bg-primary px-5 py-3 font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50 text-base min-h-[48px]"
                  >
                    {savingSubject ? 'Saving...' : 'Save Subject'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Subject Modal */}
      {showEditModal && editingSubject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-5xl rounded-2xl bg-white shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/20 bg-primary px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {editingSubject._fromNotification ? 'Fix Missing Fields' : 'Edit Subject'}
                </h3>
                {editingSubject._fromNotification && (
                  <p className="text-xs text-white/70 mt-0.5">Only fields with missing data are editable. Filled fields are locked.</p>
                )}
              </div>
              <button
                onClick={() => { setShowEditModal(false); setMthCard(emptyCardState('mth')); setTfsCard(emptyCardState('tfs')); }}
                className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {editError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle size={16} />
                  {editError}
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                  Subject Code *
                </label>
                <input
                  type="text"
                  value={editingData.subject_code}
                  onChange={(e) => setEditingData({ ...editingData, subject_code: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                  placeholder="e.g., CMSC 11"
                  disabled={editingSubject?._fromNotification && !editingSubject?._missingFields?.includes('subject_code')}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                  Course No
                </label>
                <input
                  type="text"
                  value={editingData.subject_course_no}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditingData({ ...editingData, subject_course_no: val, ...(GENERAL_RE.test(val) && { is_general: true }) });
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                  placeholder="e.g., 1"
                  disabled={editingSubject?._fromNotification && !editingSubject?._missingFields?.includes('subject_course_no')}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                  Curriculum ID
                </label>
                <input
                  type="number"
                  value={editingData.curr_id}
                  onChange={(e) => setEditingData({ ...editingData, curr_id: e.target.value ? parseInt(e.target.value) : '' })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                  placeholder="e.g., 1"
                  disabled={editingSubject?._fromNotification && !editingSubject?._missingFields?.includes('curr_id')}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                  Department
                </label>
                <select
                  value={editingData.department_id ?? ''}
                  onChange={(e) => setEditingData({ ...editingData, department_id: e.target.value })}
                  disabled={editingSubject?._fromNotification && !editingSubject?._missingFields?.includes('department_id')}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
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
                  Descriptive Title
                </label>
                <input
                  type="text"
                  value={editingData.subject_descriptive_title}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditingData({ ...editingData, subject_descriptive_title: val, ...(GENERAL_RE.test(val) && { is_general: true }) });
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                  placeholder="e.g., Introduction to Computer Science"
                  disabled={editingSubject?._fromNotification && !editingSubject?._missingFields?.includes('subject_descriptive_title')}
                />
              </div>

              <div className="space-y-3">
                <ScheduleCardInput
                  slot="mth"
                  value={mthCard}
                  onChange={(v) => { setMthCard(v); setMthCardModified(true); }}
                  onToggle={() => { setMthCard((c) => ({ ...c, enabled: !c.enabled })); setMthCardModified(true); }}
                  canDisable={tfsCard.enabled}
                  roomId={Array.isArray(editingData.mth_room) ? (editingData.mth_room[0] || null) : (editingData.mth_room || null)}
                  onRoomChange={(id) => setEditingData((d) => {
                    const arr = [...(Array.isArray(d.mth_room) ? d.mth_room : [''])];
                    arr[0] = id || '';
                    return { ...d, mth_room: arr };
                  })}
                  roomId2={Array.isArray(editingData.mth_room) ? (editingData.mth_room[1] || null) : null}
                  onRoomChange2={(id) => setEditingData((d) => {
                    const arr = [...(Array.isArray(d.mth_room) ? d.mth_room : [''])];
                    if (arr.length < 2) arr.push('');
                    arr[1] = id || '';
                    return { ...d, mth_room: arr };
                  })}
                  rooms={roomsArray}
                  getConflictingOfferings={getConflictingOfferings}
                  editingId={editingSubject?.subject_id ?? null}
                  isMissing={
                    editingSubject?._fromNotification &&
                    (editingSubject?._missingFields?.includes('mth_schedule') || editingSubject?._missingFields?.includes('mth_room'))
                  }
                  disabled={
                    editingSubject?._fromNotification &&
                    !editingSubject?._missingFields?.includes('mth_schedule') &&
                    !editingSubject?._missingFields?.includes('mth_room')
                  }
                />
                <ScheduleCardInput
                  slot="tfs"
                  value={tfsCard}
                  onChange={(v) => { setTfsCard(v); setTfsCardModified(true); }}
                  onToggle={() => { setTfsCard((c) => ({ ...c, enabled: !c.enabled })); setTfsCardModified(true); }}
                  canDisable={mthCard.enabled}
                  roomId={Array.isArray(editingData.tfs_room) ? (editingData.tfs_room[0] || null) : (editingData.tfs_room || null)}
                  onRoomChange={(id) => setEditingData((d) => {
                    const arr = [...(Array.isArray(d.tfs_room) ? d.tfs_room : [''])];
                    arr[0] = id || '';
                    return { ...d, tfs_room: arr };
                  })}
                  roomId2={Array.isArray(editingData.tfs_room) ? (editingData.tfs_room[1] || null) : null}
                  onRoomChange2={(id) => setEditingData((d) => {
                    const arr = [...(Array.isArray(d.tfs_room) ? d.tfs_room : [''])];
                    if (arr.length < 2) arr.push('');
                    arr[1] = id || '';
                    return { ...d, tfs_room: arr };
                  })}
                  rooms={roomsArray}
                  getConflictingOfferings={getConflictingOfferings}
                  editingId={editingSubject?.subject_id ?? null}
                  isMissing={
                    editingSubject?._fromNotification &&
                    (editingSubject?._missingFields?.includes('tfs_schedule') || editingSubject?._missingFields?.includes('tfs_room'))
                  }
                  disabled={
                    editingSubject?._fromNotification &&
                    !editingSubject?._missingFields?.includes('tfs_schedule') &&
                    !editingSubject?._missingFields?.includes('tfs_room')
                  }
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
                    max="10"
                    value={editingData.subject_units}
                    step="0.5"
                    onChange={(e) => setEditingData({ ...editingData, subject_units: parseFloat(e.target.value) || 0 })}
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
                    value={editingData.subject_lec_hrs}
                    step="0.5"
                    onChange={(e) => setEditingData({ ...editingData, subject_lec_hrs: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Lab Hrs
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editingData.subject_lab_hrs}
                    step="0.5"
                    onChange={(e) => setEditingData({ ...editingData, subject_lab_hrs: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                  General / In scope
                </label>
                <select
                  value={editingData.is_general ? 'true' : 'false'}
                  onChange={(e) => setEditingData({ ...editingData, is_general: e.target.value === 'true' })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="false">In scope</option>
                  <option value="true">General</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                  Status
                </label>
                <select
                  value={editingData.subject_status}
                  onChange={(e) => setEditingData({ ...editingData, subject_status: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div className="flex gap-3 pt-6">
                <button
                  onClick={() => { setShowEditModal(false); setMthCard(emptyCardState('mth')); setTfsCard(emptyCardState('tfs')); }}
                  className="flex-1 rounded-lg border border-white/60 bg-white px-4 py-2.5 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                  className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
                  if (typeof action === 'function') action();
                  else setConfirmDialog(null);
                }}
                className={`flex-1 rounded-lg px-4 py-2.5 font-semibold text-white transition-colors ${
                  confirmDialog.tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary/90'
                }`}
              >
                {confirmDialog.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    <AnimatePresence>
      {successToast && (
        <Toast
          key={successToast}
          message={successToast}
          onClose={() => setSuccessToast(null)}
        />
      )}
    </AnimatePresence>
</>
  );
}
