import { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpDown, BookOpen, PlusCircle, Edit2, Trash2, Search, ChevronLeft, ChevronRight, Check, X, AlertCircle, RotateCcw, Settings } from 'lucide-react';
import { fetchSubjects, fetchSubjectById, updateSubjectStatus, createSubject, updateSubject, deleteSubject } from '../services/subjectsApi';
import { fetchRooms } from '../services/roomsApi';
import NotificationButton from '../components/NotificationButton';
import { fetchSubjectNotifications, fetchPersistedSubjectNotifications, resolveSubjectNotification, rescanAllSubjectNotifications } from '../services/notificationsApi';
import { useRowHighlight } from '../hooks/useRowHighlight.jsx';

export default function SubjectsView({ authRefreshKey = 0 } = {}) {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [updateError, setUpdateError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'subject_code', direction: 'asc' });
  const [roomNameById, setRoomNameById] = useState({});
  
  // Add Subject modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSubject, setNewSubject] = useState({
    subject_code: '',
    subject_course_no: '',
    subject_descriptive_title: '',
    subject_units: 3,
    subject_lec_hrs: 3,
    subject_lab_hrs: 0,
    mth_schedule: '',
    tfs_schedule: '',
    mth_room: '',
    tfs_room: '',
    subject_status: 'active',
  });
  const [savingSubject, setSavingSubject] = useState(false);
  const [subjectError, setSubjectError] = useState(null);

  // Edit Subject modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingSubject, setEditingSubject] = useState(null);
  const [editingData, setEditingData] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState(null);
  const [subjectNotifications, setSubjectNotifications] = useState([]);
  const [subjectNotificationsLoading, setSubjectNotificationsLoading] = useState(false);
  const [notifSeverityFilter, setNotifSeverityFilter] = useState('all');
  const [notifSearch, setNotifSearch] = useState('');

  const columns = [
    { key: 'subject_code', label: 'Code' },
    { key: 'subject_course_no', label: 'Course No' },
    { key: 'subject_descriptive_title', label: 'Description' },
    { key: 'mth_schedule', label: 'MTH' },
    { key: 'tfs_schedule', label: 'TFS' },
    { key: 'room', label: 'Room' },
    { key: 'subject_units', label: 'Units' },
    { key: 'subject_lec_lab', label: 'Lec/Lab' },
    { key: 'subject_status', label: 'Status' },
  ];

  const [visibleColumns, setVisibleColumns] = useState(new Set(columns.map(c => c.key)));
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [colMenuPos, setColMenuPos] = useState({ top: 0, left: 0 });
  const colButtonRef = useRef(null);
  const colMenuRef = useRef(null);
  const pendingStatusUpdatesRef = useRef(new Set());

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

  function normalizeNotificationSeverity(severity) {
    if (severity === 'high') return 'critical';
    if (severity === 'critical' || severity === 'medium' || severity === 'low') return severity;
    return 'medium';
  }

  const visibleSubjectNotifications = useMemo(() => {
    const searchTerm = String(notifSearch || '').trim().toLowerCase();

    return subjectNotifications.filter((item) => {
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
  }, [subjectNotifications, notifSeverityFilter, notifSearch]);

  const subjectNotificationStats = useMemo(() => {
    const stats = { total: 0, critical: 0, medium: 0, low: 0 };

    for (const item of subjectNotifications) {
      const severity = normalizeNotificationSeverity(item.severity);
      stats.total += 1;
      if (severity === 'critical') stats.critical += 1;
      else if (severity === 'medium') stats.medium += 1;
      else if (severity === 'low') stats.low += 1;
    }

    return stats;
  }, [visibleSubjectNotifications]);

  const { setHighlight } = useRowHighlight();

  // Load subjects data
  useEffect(() => {
    loadSubjects();
  }, [page, limit, search, statusFilter]);

  useEffect(() => {
    loadSubjectNotifications({ forceRescan: true });
  }, [authRefreshKey]);

  useEffect(() => {
    loadRoomLookup();
  }, []);

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
        await Promise.all(
          batch.map(async (s) => {
            const { hasOpenIssues } = getSubjectIssueState(s.subject_id);
            const desired = hasOpenIssues ? 'inactive' : 'active';
            try {
              setUpdatingStatus(s.subject_id);
              await updateSubjectStatus(s.subject_id, desired);
              setSubjects((prev) =>
                prev.map((sub) =>
                  sub.subject_id === s.subject_id
                    ? { ...sub, subject_status: desired }
                    : sub
                )
              );
              setActiveCount((c) => c + (desired === 'active' ? 1 : -1));
            } catch (_) {
              // ignore individual failures; effect will retry on next notification reload
            } finally {
              pendingStatusUpdatesRef.current.delete(s.subject_id);
              setUpdatingStatus((prev) => (prev === s.subject_id ? null : prev));
            }
          })
        );
      }
    }

    runBatched();
  }, [subjectNotifications, subjects, subjectNotificationsLoading]);

  async function loadRoomLookup() {
    try {
      const nextLookup = {};
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
        }

        hasMore = rows.length === pageSize;
        currentPage += 1;
      }

      setRoomNameById(nextLookup);
    } catch {
      setRoomNameById({});
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

  async function loadSubjectNotifications({ forceRescan = false } = {}) {
    try {
      setSubjectNotificationsLoading(true);
      if (forceRescan) {
        await rescanAllSubjectNotifications();
      }
      // Prefer persisted notifications (allows resolving); fallback to computed live
      try {
        const persisted = await fetchPersistedSubjectNotifications({ page: 1, limit: 500 });
        const rows = Array.isArray(persisted.rows) ? persisted.rows : [];

        // Enrich with subject data for better display and action wiring
        const uniqueIds = Array.from(new Set(rows.map((r) => r.entity_id).filter(Boolean))).slice(0, 500);
        const subjectById = {};
        await Promise.all(uniqueIds.map(async (id) => {
          try {
            const s = await fetchSubjectById(id);
            subjectById[id] = s;
          } catch (_) {
            // ignore missing subjects
          }
        }));

        // Map persisted rows into the NotificationButton item shape
        const items = rows.map((r) => {
          const subj = subjectById[r.entity_id] || null;
          const field = r.field_name || null;
          return {
            id: r.id,
            title: subj?.subject_descriptive_title || r.message || `Subject #${r.entity_id}`,
            description: subj?.subject_code || null,
            severity: normalizeNotificationSeverity(r.severity),
            missingFields: field ? [field] : [],
            issues: [{ message: r.message, details: r.details, field }],
            rowId: r.entity_id,
            subject: subj,
            raw: r,
          };
        });

        setSubjectNotifications(items);
      } catch (err) {
        const data = await fetchSubjectNotifications({ page: 1, limit: 500 });
        // fallback: map computed live rows to expected shape
        const items = (Array.isArray(data.rows) ? data.rows : []).map((r) => ({
          id: r.id || `subject-${r.rowId}`,
          title: r.title || r.message || `Subject #${r.rowId}`,
          description: r.description || null,
          severity: normalizeNotificationSeverity(r.severity),
          missingFields: r.missingFields || [],
          issues: r.issues || (r.message ? [{ message: r.message, field: (r.field_name || (r.missingFields && r.missingFields[0]) || null) }] : []),
          rowId: r.rowId,
          subject: r.subject || null,
          raw: r,
        }));
        setSubjectNotifications(items);
      }
    } catch (err) {
      setSubjectNotifications([]);
    } finally {
      setSubjectNotificationsLoading(false);
    }
  }

  function scrollToSubjectRowById(subjectId) {
    const rowElement = document.getElementById(`subject-row-${subjectId}`);
    if (rowElement) {
      setHighlight(subjectId, 'SubjectsView');
      return;
    }

    const numericId = Number(subjectId);
    if (!numericId || Number.isNaN(numericId)) {
      return;
    }

    (async () => {
      try {
        const maxSearchPages = 200;
        for (let candidatePage = 1; candidatePage <= maxSearchPages; candidatePage += 1) {
          const result = await fetchSubjects({
            page: candidatePage,
            limit,
            search,
            status: statusFilter,
          });

          const rows = Array.isArray(result.rows) ? result.rows : [];
          if (rows.some((row) => Number(row.subject_id) === numericId)) {
            if (candidatePage !== page) {
              setPage(candidatePage);
            }

            window.setTimeout(() => {
              setHighlight(subjectId, 'SubjectsView');
            }, 150);

            break;
          }

          if (rows.length < limit) {
            break;
          }
        }
      } catch (_) {
        // ignore fallback failures
      }
    })();
  }

  async function handleResolveNotification(item) {
    try {
      // item.id from persisted table should be numeric; ignore computed ids like 'subject-123'
      const numericId = Number(item.id);
      if (!numericId || Number.isNaN(numericId)) return;
      await resolveSubjectNotification(numericId);
      await loadSubjectNotifications();
    } catch (err) {
      // ignore or set a UI error state if desired
    }
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
      mth_schedule: subject.mth_schedule || '',
      tfs_schedule: subject.tfs_schedule || '',
      mth_room: subject.mth_room || subject.mth_room_id || '',
      tfs_room: subject.tfs_room || subject.tfs_room_id || '',
      subject_section: subject.subject_section || '',
      department_id: subject.department_id ?? '',
      subject_status: subject.subject_status || 'active',
    });
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
      const updated = await updateSubject(editingSubject.subject_id, editingData);
      // Update local state
      setSubjects(subjects.map(s => s.subject_id === editingSubject.subject_id ? updated : s));
      if ((previousStatus === 'active') !== (updated.subject_status === 'active')) {
        setActiveCount((currentCount) => currentCount + (updated.subject_status === 'active' ? 1 : -1));
      }
      setShowEditModal(false);
      setEditingSubject(null);
      await loadSubjectNotifications();
    } catch (err) {
      if (String(err.message || '').includes('404')) {
        setShowEditModal(false);
        setEditingSubject(null);
        await loadSubjects();
        setUpdateError('That subject was removed. The list has been refreshed.');
        return;
      }
      setEditError(err.message || 'Failed to save subject');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteSubject(subject) {
    try {
      setUpdateError(null);
      await deleteSubject(subject.subject_id);
      if (subject.subject_status === 'active') {
        setActiveCount((currentCount) => Math.max(0, currentCount - 1));
      }
      await loadSubjects();
      await loadSubjectNotifications();
    } catch (err) {
      if (String(err.message || '').includes('404')) {
        await loadSubjects();
        setUpdateError('That subject was already removed. The list has been refreshed.');
        return;
      }
      setUpdateError(err.message || 'Failed to delete subject');
    }
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
      const createdSubject = await createSubject(newSubject);
      // Reset form and close modal
      setShowAddModal(false);
      setNewSubject({
        subject_code: '',
        subject_course_no: '',
        subject_descriptive_title: '',
        subject_units: 3,
        subject_lec_hrs: 3,
        subject_lab_hrs: 0,
        mth_schedule: '',
        tfs_schedule: '',
        mth_room: '',
        tfs_room: '',
        subject_status: 'active',
      });
      if ((createdSubject?.subject_status || 'active') === 'active') {
        setActiveCount((currentCount) => currentCount + 1);
      }
      // Reload subjects
      await loadSubjects();
      await loadSubjectNotifications();
    } catch (err) {
      setSubjectError(err.message || 'Failed to create subject');
    } finally {
      setSavingSubject(false);
    }
  }

  const totalPages = Math.ceil(total / limit);

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

  function resolveRoomDisplayValue(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return '';
    }

    const tokens = normalized
      .split(/\s*[,/]\s*/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      return '';
    }

    return tokens
      .map((token) => roomNameById[token] || token)
      .join(' / ');
  }

  function extractRoomSummary(subject) {
    const mthRoom = resolveRoomDisplayValue(subject.mth_room ?? subject.mth_room_id ?? '');
    const tfsRoom = resolveRoomDisplayValue(subject.tfs_room ?? subject.tfs_room_id ?? '');

    if (mthRoom && tfsRoom && mthRoom !== tfsRoom) {
      return `MTH: ${mthRoom} | TFS: ${tfsRoom}`;
    }

    return mthRoom || tfsRoom || '—';
  }

  function getSubjectIssueState(subjectId) {
    const id = Number(subjectId);
    const hasOpenIssues = subjectNotifications.some(
      (item) => Number(item.rowId) === id
    );
    return { hasOpenIssues };
  }

  return (
<div className="p-3 flex flex-col h-screen bg-background animate-in slide-in-from-right-4 duration-500">
      {/* Header with Title, Description, and Action Buttons */}
<div className="bg-white/90 rounded-xl border border-white/60 flex items-center justify-between p-3 flex-shrink-0">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-lg font-bold text-on-surface truncate">Curriculum Repository</h2>
          <p className="text-xs text-on-surface-variant truncate">Manage subjects, credit units, and classifications.</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-4">
          <NotificationButton
            items={visibleSubjectNotifications}
            title="Subject Notifications"
            emptyLabel="No subject issues"
            buttonLabel="Issues"
            onItemEdit={(item) => {
              const subj = item.subject || subjectNotifications.find(s => s.rowId === item.rowId)?.subject;
              const missingFields = Array.isArray(item.missingFields) ? item.missingFields : [];
              if (subj) handleEditSubject(subj, { fromNotification: true, missingFields });
            }}
            onItemJump={(item) => {
              const rowId = item.rowId || (typeof item.subject?.subject_id !== 'undefined' ? item.subject.subject_id : null);
              if (rowId) scrollToSubjectRowById(rowId);
            }}
            onItemResolve={(item) => handleResolveNotification(item)}
            severityFilter={notifSeverityFilter}
            onSeverityFilterChange={(v) => setNotifSeverityFilter(v)}
            notificationSearch={notifSearch}
            onNotificationSearchChange={(v) => setNotifSearch(v)}
            notificationStats={subjectNotificationStats}
          />
          <span className="inline-block rounded-md bg-primary/10 px-2 py-1 text-xs font-bold text-primary whitespace-nowrap">
            {total} subjects
          </span>
          <button
            onClick={async () => {
              await loadSubjects();
              await loadSubjectNotifications({ forceRescan: true });
            }}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white hover:text-primary flex-shrink-0"
            title="Reload subjects and sync status"
          >
            <RotateCcw size={16} />
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
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary flex items-center gap-1 px-3 py-1.5 text-sm flex-shrink-0"
          >
            <PlusCircle size={16} />
            <span>Add</span>
          </button>
        </div>
      </div>

      {/* Search and Filter Bar */}
<div className="bg-white/90 rounded-xl border border-white/60 space-y-2 p-3 flex-shrink-0 mt-1">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1 md:max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="text"
              placeholder="Search subjects..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-white/30 bg-white/50 py-1.5 pl-9 pr-3 text-xs text-on-surface placeholder-on-surface-variant/50 outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white focus:shadow-lg"
            />
          </div>

          <div className="flex gap-1">
            {['', 'active', 'inactive'].map((status) => (
              <button
                key={status}
                onClick={() => {
                  setStatusFilter(status);
                  setPage(1);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                  statusFilter === status
                    ? 'bg-primary text-white shadow-md shadow-primary/20'
                    : 'border border-white/60 bg-white text-on-surface-variant hover:bg-slate-50'
                }`}
              >
                {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'All'}
              </button>
            ))}
          </div>
        </div>

        {updateError && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
            <AlertCircle size={14} />
            {updateError}
          </div>
        )}
      </div>

      {/* Loading State */}
      {loading && (
<div className="bg-white/90 rounded-xl border border-white/60 flex flex-col items-center justify-center flex-1 mt-1">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary"></div>
          <p className="mt-4 text-sm text-on-surface-variant">Loading subjects...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
<div className="bg-red-50 rounded-xl border border-white/60 flex items-center gap-3 p-3 text-red-700 flex-1 mt-1">
          <AlertCircle size={18} />
          <div>
            <p className="font-bold text-sm">Error loading subjects</p>
            <p className="text-xs">{error}</p>
          </div>
        </div>
      )}

      {/* Subjects Table */}
      {!loading && !error && subjects.length > 0 && (
<div className="bg-white/90 rounded-xl border border-white/60 overflow-hidden flex-1 flex flex-col mt-1 min-h-0">
          <div className="overflow-auto flex-1">
            <table className="min-w-full w-full text-left text-xs">
              <thead>
<tr className="sticky top-0 z-20 border-b border-white/20 bg-white">
                  {columns.map(col => visibleColumns.has(col.key) && (
                    <th key={col.key} className="px-4 py-2 text-left">
                      <button type="button" onClick={() => handleSort(col.key)} className={sortHeaderClass(col.key)}>
                        <span>{col.label}</span>
                        <ArrowUpDown size={10} />
                      </button>
                    </th>
                  ))}
                  <th className="sticky right-0 z-30 px-4 py-2 text-center text-xs font-bold uppercase tracking-[0.28em] text-on-surface-variant/70 bg-white">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/20">
                {sortedSubjects.map((subject, index) => (
                  <tr id={`subject-row-${subject.subject_id}`} data-subject-id={subject.subject_id} key={subject.subject_id} className={`border-b border-white/120 transition-colors hover:bg-white/100 ${index % 2 === 0 ? 'bg-white/6' : ''}`}>
                    {columns.map(col => visibleColumns.has(col.key) && (
                      <td key={col.key} className="px-4 py-2">
                        {col.key === 'subject_code' && (
                          <span className="inline-block rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                            {subject.subject_code || 'N/A'}
                          </span>
                        )}
                        {col.key === 'subject_course_no' && (
                          <span className="text-xs font-medium text-on-surface">{subject.subject_course_no || '—'}</span>
                        )}
                        {col.key === 'subject_descriptive_title' && (
                          <div className="max-w-xs">
                            <p className="text-xs font-medium text-on-surface truncate">{subject.subject_descriptive_title || '—'}</p>
                          </div>
                        )}
                        {col.key === 'mth_schedule' && (
                          <span className="block text-xs text-on-surface-variant">{extractTimeRange(subject.mth_schedule)}</span>
                        )}
                        {col.key === 'tfs_schedule' && (
                          <span className="block text-xs text-on-surface-variant">{extractTimeRange(subject.tfs_schedule)}</span>
                        )}
                        {col.key === 'room' && (
                          <span className="block text-xs text-on-surface-variant">{extractRoomSummary(subject)}</span>
                        )}
                        {col.key === 'subject_units' && (
                          <span className="text-center text-xs font-medium text-on-surface">{subject.subject_units || 0}</span>
                        )}
                        {col.key === 'subject_lec_lab' && (
                          <span className="text-center text-xs font-medium text-on-surface-variant">{subject.subject_lec_hrs || 0}h / {subject.subject_lab_hrs || 0}h</span>
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
                    <td className="sticky right-0 z-10 px-4 py-2 bg-white">
                      <div className="flex justify-center gap-1">
                        <button
                          onClick={() => handleEditSubject(subject)}
                          className="rounded-md bg-white/30 p-1 text-slate-400 transition-colors hover:bg-white hover:text-primary"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteSubject(subject)}
                          className="rounded-md bg-white/30 p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-white/20 bg-white/30 px-4 py-2 flex-shrink-0">
              <div className="text-xs text-on-surface-variant">
                {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="flex items-center gap-1 rounded-lg border border-white/30 bg-white px-2 py-1 text-xs font-bold text-on-surface transition-all hover:bg-slate-50 disabled:opacity-50"
                >
                  <ChevronLeft size={14} />
                </button>
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (page <= 3) {
                      pageNum = i + 1;
                    } else if (page >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = page - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        className={`rounded-lg px-2 py-1 text-xs font-bold transition-all ${
                          pageNum === page
                            ? 'bg-primary text-white'
                            : 'border border-white/30 bg-white text-on-surface hover:bg-slate-50'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="flex items-center gap-1 rounded-lg border border-white/30 bg-white px-2 py-1 text-xs font-bold text-on-surface transition-all hover:bg-slate-50 disabled:opacity-50"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && subjects.length === 0 && (
<div className="bg-white/90 rounded-xl border border-white/60 flex flex-col items-center justify-center flex-1 mt-1 text-center">
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
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/20 bg-primary px-6 py-4">
              <h3 className="text-lg font-bold text-white">Add New Subject</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {subjectError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle size={16} />
                  {subjectError}
                </div>
              )}

              <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Subject Code *
                  </label>
                  <input
                    type="text"
                    value={newSubject.subject_code}
                    onChange={(e) => setNewSubject({ ...newSubject, subject_code: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g., 4700"
                  />
                </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                  Course No
                </label>
                <input
                  type="text"
                  value={newSubject.subject_course_no}
                  onChange={(e) => setNewSubject({ ...newSubject, subject_course_no: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g., HCI-101"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                  Descriptive Title
                </label>
                <input
                  type="text"
                  value={newSubject.subject_descriptive_title}
                  onChange={(e) => setNewSubject({ ...newSubject, subject_descriptive_title: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g., Introduction to Human Computer Interactions"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    MTH Schedule
                  </label>
                  <input
                    type="text"
                    value={newSubject.mth_schedule}
                    onChange={(e) => setNewSubject({ ...newSubject, mth_schedule: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g., M 7:00-10:00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    MTH Room
                  </label>
                  <select
                    value={newSubject.mth_room}
                    onChange={(e) => setNewSubject({ ...newSubject, mth_room: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">— No Room —</option>
                    {Object.entries(roomNameById).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    TFS Schedule
                  </label>
                  <input
                    type="text"
                    value={newSubject.tfs_schedule}
                    onChange={(e) => setNewSubject({ ...newSubject, tfs_schedule: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g., T 1:00-4:00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    TFS Room
                  </label>
                  <select
                    value={newSubject.tfs_room}
                    onChange={(e) => setNewSubject({ ...newSubject, tfs_room: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">— No Room —</option>
                    {Object.entries(roomNameById).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                </div>
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
                    value={newSubject.subject_units}
                    step="0.5"
                    onChange={(e) => setNewSubject({ ...newSubject, subject_units: parseFloat(e.target.value) || 0 })}
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
                    value={newSubject.subject_lec_hrs}
                    step="0.5"
                    onChange={(e) => setNewSubject({ ...newSubject, subject_lec_hrs: parseFloat(e.target.value) || 0 })}
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
                    value={newSubject.subject_lab_hrs}
                    step="0.5"
                    onChange={(e) => setNewSubject({ ...newSubject, subject_lab_hrs: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                  Status
                </label>
                <select
                  value={newSubject.subject_status}
                  onChange={(e) => setNewSubject({ ...newSubject, subject_status: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div className="flex gap-3 pt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 rounded-lg border border-white/60 bg-white px-4 py-2.5 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddSubject}
                  disabled={savingSubject}
                  className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {savingSubject ? 'Saving...' : 'Save Subject'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Subject Modal */}
      {showEditModal && editingSubject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
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
                onClick={() => setShowEditModal(false)}
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
                  onChange={(e) => setEditingData({ ...editingData, subject_course_no: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                  placeholder="e.g., 1"
                  disabled={editingSubject?._fromNotification && !editingSubject?._missingFields?.includes('subject_course_no')}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                  Descriptive Title
                </label>
                <input
                  type="text"
                  value={editingData.subject_descriptive_title}
                  onChange={(e) => setEditingData({ ...editingData, subject_descriptive_title: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                  placeholder="e.g., Introduction to Computer Science"
                  disabled={editingSubject?._fromNotification && !editingSubject?._missingFields?.includes('subject_descriptive_title')}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    MTH Schedule
                  </label>
                  <input
                    type="text"
                    value={editingData.mth_schedule}
                    onChange={(e) => setEditingData({ ...editingData, mth_schedule: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                    placeholder="e.g., M 7:00-10:00"
                    disabled={editingSubject?._fromNotification && !editingSubject?._missingFields?.includes('mth_schedule')}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    MTH Room
                  </label>
                  <select
                    value={editingData.mth_room}
                    onChange={(e) => setEditingData({ ...editingData, mth_room: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                    disabled={editingSubject?._fromNotification && !editingSubject?._missingFields?.includes('mth_room')}
                  >
                    <option value="">— No Room —</option>
                    {Object.entries(roomNameById).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    TFS Schedule
                  </label>
                  <input
                    type="text"
                    value={editingData.tfs_schedule}
                    onChange={(e) => setEditingData({ ...editingData, tfs_schedule: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                    placeholder="e.g., T 1:00-4:00"
                    disabled={editingSubject?._fromNotification && !editingSubject?._missingFields?.includes('tfs_schedule')}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    TFS Room
                  </label>
                  <select
                    value={editingData.tfs_room}
                    onChange={(e) => setEditingData({ ...editingData, tfs_room: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                    disabled={editingSubject?._fromNotification && !editingSubject?._missingFields?.includes('tfs_room')}
                  >
                    <option value="">— No Room —</option>
                    {Object.entries(roomNameById).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                </div>
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
                  onClick={() => setShowEditModal(false)}
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
    </div>
  );
}
