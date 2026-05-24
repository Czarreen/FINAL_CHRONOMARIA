import { useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpDown,
  Users,
  PlusCircle,
  Edit2,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  AlertCircle,
  Building2,
  Mail,
  RotateCcw,
  RefreshCw,
  Settings,
  Tag,
} from 'lucide-react';
import {
  fetchFaculty,
  fetchFacultyById,
  createFaculty,
  updateFaculty,
  updateFacultyStatus,
  deleteFaculty,
} from '../services/facultyApi.js';
import { fetchDepartments } from '../services/departmentsApi.js';
import NotificationButton from '../components/NotificationButton.jsx';
import FacultySubjectPreferencesModal from '../components/FacultySubjectPreferencesModal.jsx';
import { fetchAllFacultySubjectPreferences } from '../services/facultySubjectPreferencesApi.js';
import { fetchFacultyNotifications, fetchPersistedFacultyNotifications, resolveFacultyNotification, syncFacultyNotifications } from '../services/notificationsApi.js';
import { useRowHighlight } from '../hooks/useRowHighlight.jsx';
import { normalizeNotificationSeverity } from '../utils/notificationUtils';

export default function FacultyView() {
  const [faculty, setFaculty] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState(1);
  const [limit] = useState(50);
  const [total, setTotal] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [updateError, setUpdateError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'faculty_name', direction: 'asc' });

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPreferencesModal, setShowPreferencesModal] = useState(false);
  const [preferencesModalFacultyId, setPreferencesModalFacultyId] = useState(null);
  const [preferencesModalFacultyName, setPreferencesModalFacultyName] = useState(null);
  const [savingFaculty, setSavingFaculty] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [facultyError, setFacultyError] = useState(null);
  const [editError, setEditError] = useState(null);
  const [editingFaculty, setEditingFaculty] = useState(null);
  const [newSpecializationInput, setNewSpecializationInput] = useState('');
  const [editSpecializationInput, setEditSpecializationInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [facultyToDelete, setFacultyToDelete] = useState(null);
  const [deletingFaculty, setDeletingFaculty] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [allSubjectPreferences, setAllSubjectPreferences] = useState({});
  const [newFaculty, setNewFaculty] = useState({
    faculty_name: '',
    faculty_role: '',
    faculty_status: 'active',
    faculty_email: '',
    department_id: '',
    faculty_specialization: [],
    faculty_max_units: '',
  });
  const [editingData, setEditingData] = useState({});
  const [departments, setDepartments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [notificationSearch, setNotificationSearch] = useState('');
  const [notificationSeverityFilter, setNotificationSeverityFilter] = useState('all');
  const [pendingScrollTo, setPendingScrollTo] = useState(null);
  const [findingRow, setFindingRow] = useState(false);

  const columns = [
    { key: 'faculty_name', label: 'Faculty Member' },
    { key: 'department', label: 'Department' },
    { key: 'faculty_role', label: 'Role' },
    { key: 'faculty_specialization', label: 'Specialization' },
    { key: 'subject_tags', label: 'Subject Tags' },
    { key: 'faculty_max_units', label: 'Units' },
    { key: 'faculty_status', label: 'Status' },
  ];

  const [visibleColumns, setVisibleColumns] = useState(new Set(columns.map((c) => c.key)));
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [colMenuPos, setColMenuPos] = useState({ top: 0, left: 0 });
  const colButtonRef = useRef(null);
  const colMenuRef = useRef(null);

  // Handle column menu positioning and click outside (consistent with CourseOffering/Rooms)
  useEffect(() => {
    if (!colMenuOpen) return;

    const updatePosition = () => {
      if (!colButtonRef.current) return;
      const rect = colButtonRef.current.getBoundingClientRect();
      setColMenuPos({
        top: rect.bottom + 8,
        left: rect.right - 220,
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

  const [selectedFaculty, setSelectedFaculty] = useState(new Set());

  function toggleSelectFaculty(facultyId) {
    setSelectedFaculty((prev) => {
      const next = new Set(prev);
      if (next.has(facultyId)) {
        next.delete(facultyId);
      } else {
        next.add(facultyId);
      }
      return next;
    });
  }

  function toggleSelectAllFaculty() {
    if (selectedFaculty.size === sortedFaculty.length && sortedFaculty.length > 0) {
      setSelectedFaculty(new Set());
    } else {
      setSelectedFaculty(new Set(sortedFaculty.map((member) => member.faculty_id)));
    }
  }

  const { setHighlight } = useRowHighlight();

  useEffect(() => {
    loadFaculty();
  }, [page, limit, search, statusFilter]);

  useEffect(() => {
    loadDepartments();
  }, []);

  useEffect(() => {
    loadFacultyNotifications();
  }, []);

  const handleInlineSave = async ({ offeringId, field, value, facultyId }) => {
    const id = facultyId || offeringId;
    if (!id) return;
    const keyMap = {
      'Faculty Name': 'faculty_name',
      'Faculty Email': 'faculty_email',
      'Role': 'faculty_role',
      'faculty_name': 'faculty_name',
      'faculty_email': 'faculty_email',
    };
    const dbField = keyMap[field] || field;
    try {
      await updateFaculty(id, { [dbField]: value });
      try { await syncFacultyNotifications(id); } catch (_) {}
      await loadFacultyNotifications();
    } catch (err) {
      console.error('Inline save (faculty) failed:', err);
    }
  };

  // Handle scrolling to row when it appears (after page navigation)
  useLayoutEffect(() => {
    if (!pendingScrollTo?.id) return;

    setHighlight(
      pendingScrollTo.id,
      'FacultyView',
      pendingScrollTo.severity,
      {
        retry: true,
        maxWaitMs: 2500,
        pollIntervalMs: 16,
        onHighlighted: () => setPendingScrollTo(null),
      }
    );
  }, [pendingScrollTo, faculty, setHighlight]);

  async function findFacultyPageNumber(facultyId) {
    try {
      // Fetch all faculty members to calculate which page the target is on
      const { rows: allFaculty } = await fetchFaculty({
        page: 1,
        limit: 10000,
        search: '',
        status: statusFilter,
      });

      const facultyIndex = allFaculty.findIndex((f) => f.faculty_id === facultyId);
      if (facultyIndex === -1) return null;

      return Math.ceil((facultyIndex + 1) / limit);
    } catch (err) {
      console.error('Failed to find faculty page number:', err);
      return null;
    }
  }

  async function loadFacultyNotifications() {
    try {
      // Prefer persisted notifications when available
      const payload = await fetchPersistedFacultyNotifications({ page: 1, limit: 200, unresolvedOnly: true });
      const normalized = (payload.rows || []).map((row) => ({
        ...row,
        severity: normalizeNotificationSeverity(row.severity),
      }));
      setNotifications(normalized);
    } catch (err) {
      console.error('Failed to load faculty notifications:', err);
      setNotifications([]);
    }
  }

  async function handleResolveNotification(item) {
    try {
      await resolveFacultyNotification(item.id);
      // Refresh notifications after resolving
      await loadFacultyNotifications();
    } catch (err) {
      console.error('Failed to resolve notification:', err);
    }
  }

  async function handleNotificationEdit(item) {
    // Fetch full faculty data to edit
    try {
      const memberRow = await fetchFacultyById(item.faculty_id);
      if (memberRow) {
        handleEditFaculty(memberRow);
        // Navigate to the page this faculty member is on
        const pageNum = await findFacultyPageNumber(item.faculty_id);
        if (pageNum && pageNum !== page) {
          setSearch('');
          setStatusFilter('');
          setPage(pageNum);
          setPendingScrollTo({ id: item.faculty_id, severity: item.severity || null });
        } else {
          setHighlight(item.faculty_id, 'FacultyView', item.severity || null, { retry: true, maxWaitMs: 1200, pollIntervalMs: 16 });
        }
      } else {
        console.error('Faculty member not found');
      }
    } catch (err) {
      console.error('Failed to fetch faculty for editing:', err);
    }
  }

  function handleNotificationJump(item) {
    const rowElement = document.getElementById(`faculty-row-${item.faculty_id}`);
    if (rowElement) {
      setHighlight(item.faculty_id, 'FacultyView', item.severity || null, { retry: true, maxWaitMs: 1200, pollIntervalMs: 16 });
    } else {
      // Faculty member not on current page, find which page they're on
      setFindingRow(true);
      findFacultyPageNumber(item.faculty_id)
        .then((pageNum) => {
          if (pageNum && pageNum !== page) {
            setSearch('');
            setStatusFilter('');
            setPage(pageNum);
            setPendingScrollTo({ id: item.faculty_id, severity: item.severity || null });
          } else if (!pageNum) {
            console.warn('Faculty member not found');
          }
        })
        .finally(() => setFindingRow(false));
    }
  }

  async function loadFaculty() {
    try {
      setLoading(true);
      setError(null);
      const [data, prefsMap] = await Promise.all([
        fetchFaculty({ page, limit, search, status: statusFilter }),
        fetchAllFacultySubjectPreferences().catch(() => ({})),
      ]);
      setFaculty(data.rows || []);
      setTotal(Number(data.total || 0));
      setActiveCount(Number(data.activeCount || 0));
      setAllSubjectPreferences(prefsMap);
    } catch (err) {
      setError(err.message || 'Failed to load faculty members');
      setFaculty([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function loadDepartments() {
    try {
      const rows = await fetchDepartments();
      setDepartments(rows);
    } catch (err) {
      console.error('Failed to load departments:', err);
      setDepartments([]);
    }
  }

  function handleSort(columnKey) {
    setSortConfig((currentSort) => ({
      key: columnKey,
      direction: currentSort.key === columnKey && currentSort.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  const sortedFaculty = useMemo(() => {
    const items = [...faculty];
    const directionMultiplier = sortConfig.direction === 'asc' ? 1 : -1;

    const getComparableValue = (member, key) => {
      switch (key) {
        case 'faculty_name':
          return String(member.faculty_name ?? '');
        case 'department':
          return String(member.departments?.department_name ?? 'Unassigned');
        case 'faculty_role':
          return String(member.faculty_role ?? '');
        case 'faculty_specialization':
          return String(member.faculty_specialization ?? '');
        case 'faculty_max_units':
          return Number(member.faculty_max_units ?? 0);
        case 'faculty_status':
          return String(member.faculty_status ?? '');
        case 'actions':
          return Number(member.faculty_id ?? 0);
        default:
          return String(member.faculty_name ?? '');
      }
    };

    items.sort((left, right) => {
      const leftValue = getComparableValue(left, sortConfig.key);
      const rightValue = getComparableValue(right, sortConfig.key);

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * directionMultiplier;
      }

      return String(leftValue).localeCompare(String(rightValue), undefined, { sensitivity: 'base' }) * directionMultiplier;
    });

    return items;
  }, [faculty, sortConfig]);

  const onLeaveCount = useMemo(
    () => faculty.filter((member) => String(member.faculty_status || '').toLowerCase() === 'on-leave').length,
    [faculty]
  );

  const departmentCount = useMemo(() => {
    return new Set(faculty.map((member) => member.departments?.department_name || 'Unassigned')).size;
  }, [faculty]);

  const notificationStats = useMemo(() => {
    const stats = { total: notifications.length, critical: 0, medium: 0, low: 0 };
    notifications.forEach((notif) => {
      if (notif.severity === 'critical') stats.critical += 1;
      else if (notif.severity === 'medium') stats.medium += 1;
      else if (notif.severity === 'low') stats.low += 1;
    });
    return stats;
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    let filtered = [...notifications];
    if (notificationSeverityFilter !== 'all') {
      filtered = filtered.filter((notif) => notif.severity === notificationSeverityFilter);
    }
    if (notificationSearch) {
      const searchLower = notificationSearch.toLowerCase();
      filtered = filtered.filter(
        (notif) =>
          (notif.title || '').toLowerCase().includes(searchLower) ||
          (notif.description || '').toLowerCase().includes(searchLower) ||
          (notif.id || '').toString().includes(searchLower)
      );
    }
    return filtered;
  }, [notifications, notificationSeverityFilter, notificationSearch]);

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

  function normalizePayload(payload) {
    return {
      ...payload,
      department_id: payload.department_id === '' || payload.department_id === undefined ? null : Number(payload.department_id),
      faculty_max_units: payload.faculty_max_units === '' || payload.faculty_max_units === undefined ? null : Number(payload.faculty_max_units),
      faculty_email: payload.faculty_email || null,
      faculty_specialization: Array.isArray(payload.faculty_specialization)
        ? payload.faculty_specialization.join(', ') || null
        : payload.faculty_specialization || null,
      faculty_role: payload.faculty_role || null,
      faculty_status: payload.faculty_status || 'active',
    };
  }

  function parseSpecializations(value) {
    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function addSpecializationToForm(formSetter, specializationList, inputValue, inputSetter) {
    const value = String(inputValue || '').trim();
    if (!value) {
      return;
    }
    if (specializationList.some((item) => item.toLowerCase() === value.toLowerCase())) {
      inputSetter('');
      return;
    }
    formSetter((current) => ({
      ...current,
      faculty_specialization: [...current.faculty_specialization, value],
    }));
    inputSetter('');
  }

  function removeSpecializationFromForm(formSetter, valueToRemove) {
    formSetter((current) => ({
      ...current,
      faculty_specialization: current.faculty_specialization.filter((item) => item !== valueToRemove),
    }));
  }

  async function handleAddFaculty() {
    if (!newFaculty.faculty_name.trim()) {
      setFacultyError('Faculty name is required');
      return;
    }
    try {
      setSavingFaculty(true);
      setFacultyError(null);
      await createFaculty(normalizePayload(newFaculty));
      setShowAddModal(false);
      setNewFaculty({
        faculty_name: '',
        faculty_role: '',
        faculty_status: 'active',
        faculty_email: '',
        department_id: '',
        faculty_specialization: [],
        faculty_max_units: '',
      });
      setNewSpecializationInput('');
      await loadFaculty();
      await loadFacultyNotifications(); // ← Refresh notifications after add
    } catch (err) {
      setFacultyError(err.message || 'Failed to create faculty member');
    } finally {
      setSavingFaculty(false);
    }
  }

  function handleEditFaculty(member) {
    setEditingFaculty(member);
    setEditingData({
      faculty_name: member.faculty_name || '',
      faculty_role: member.faculty_role || '',
      faculty_status: member.faculty_status || 'active',
      faculty_email: member.faculty_email || '',
      department_id: member.department_id ?? '',
      faculty_specialization: parseSpecializations(member.faculty_specialization),
      faculty_max_units: member.faculty_max_units ?? '',
    });
    setEditSpecializationInput('');
    setEditError(null);
    setShowEditModal(true);
  }

  function handleOpenPreferencesModal(member) {
    setPreferencesModalFacultyId(member.faculty_id);
    setPreferencesModalFacultyName(member.faculty_name);
    setShowPreferencesModal(true);
  }

  async function handleSaveEdit() {
    if (!editingFaculty || !editingData.faculty_name?.trim()) {
      setEditError('Faculty name is required');
      return;
    }
    try {
      setSavingEdit(true);
      setEditError(null);
      const normalized = normalizePayload(editingData);
      console.log('Sending PATCH data:', normalized);
      await updateFaculty(editingFaculty.faculty_id, normalized);
      setShowEditModal(false);
      setEditingFaculty(null);
      await loadFaculty();
      await loadFacultyNotifications(); // ← Refresh notifications after edit
    } catch (err) {
      console.error('Edit error details:', err);
      if (String(err.message || '').includes('404')) {
        setShowEditModal(false);
        setEditingFaculty(null);
        await loadFaculty();
        setUpdateError('That faculty member was removed. The list has been refreshed.');
        return;
      }
      setEditError(err.message || 'Failed to update faculty member');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteFaculty(member) {
    try {
      setUpdateError(null);
      await deleteFaculty(member.faculty_id);
      await loadFaculty();
      await loadFacultyNotifications(); // ← Refresh notifications after delete
    } catch (err) {
      if (String(err.message || '').includes('404')) {
        await loadFaculty();
        await loadFacultyNotifications(); // ← Refresh notifications after delete
        setUpdateError('That faculty member was already removed. The list has been refreshed.');
        return;
      }
      setUpdateError(err.message || 'Failed to delete faculty member');
    }
  }

  function openDeleteConfirm(member) {
    setDeleteError(null);
    setFacultyToDelete(member);
    setShowDeleteConfirm(true);
  }

  function closeDeleteConfirm() {
    setShowDeleteConfirm(false);
    setFacultyToDelete(null);
    setDeletingFaculty(false);
    setDeleteError(null);
  }

  async function confirmDeleteFaculty() {
    if (!facultyToDelete) return;

    try {
      setDeletingFaculty(true);
      setDeleteError(null);
      await handleDeleteFaculty(facultyToDelete);
      closeDeleteConfirm();
    } catch (err) {
      setDeleteError(err?.message || 'Failed to delete faculty member');
      setDeletingFaculty(false);
    }
  }

  async function handleStatusToggle(memberId, currentStatus) {
    const current = String(currentStatus || '').toLowerCase();
    const newStatus = current === 'active' ? 'inactive' : 'active';
    try {
      setUpdatingStatus(memberId);
      setUpdateError(null);
      await updateFacultyStatus(memberId, newStatus);
      await loadFaculty();
      await loadFacultyNotifications(); // ← Refresh notifications after status change
    } catch (err) {
      if (String(err.message || '').includes('404')) {
        await loadFaculty();
        await loadFacultyNotifications(); // ← Refresh notifications after status change
        setUpdateError('That faculty member was removed. The list has been refreshed.');
        return;
      }
      setUpdateError(err.message || 'Failed to update faculty status');
    } finally {
      setUpdatingStatus(null);
    }
  }

  function getStatusBadgeClass(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'active') {
      return 'bg-green-100 text-green-700 hover:bg-green-200';
    }
    if (normalized === 'on-leave') {
      return 'bg-amber-100 text-amber-700 hover:bg-amber-200';
    }
    return 'bg-slate-100 text-slate-600 hover:bg-slate-200';
  }

  function getDepartmentBadgeClass(departmentName) {
    const normalized = String(departmentName || '').toLowerCase();
    if (normalized.includes('architecture')) {
      return 'bg-fuchsia-100 text-fuchsia-800';
    }
    if (normalized.includes('information technology') || normalized.includes('it')) {
      return 'bg-sky-100 text-sky-800';
    }
    if (normalized.includes('civil engineering')) {
      return 'bg-emerald-100 text-emerald-800';
    }
    if (normalized.includes('electrical engineering')) {
      return 'bg-amber-100 text-amber-800';
    }
    if (normalized.includes('computer engineering')) {
      return 'bg-violet-100 text-violet-800';
    }
    if (normalized.includes('mechanical engineering')) {
      return 'bg-slate-100 text-slate-700';
    }
    if (normalized.includes('data') || normalized.includes('science')) {
      return 'bg-cyan-100 text-cyan-800';
    }
    if (normalized.includes('mathematics')) {
      return 'bg-indigo-100 text-indigo-800';
    }
    return 'bg-slate-100 text-slate-700';
  }

  return (
<div className="space-y-2 animate-in slide-in-from-bottom-4 duration-500">

      {/* Header with Title, Description, and Action Buttons */}
      <div className="glass-panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5 min-w-0">
          <h2 className="text-lg font-bold text-on-surface truncate">Faculty Directory</h2>
          <p className="text-xs text-on-surface-variant truncate">Manage and track academic teaching staff.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2 py-1">
            <NotificationButton
              buttonClassName="btn-primary border-none"
              items={filteredNotifications}
              title="Faculty Notifications"
              buttonLabel="Issues"
              emptyLabel="No faculty issues"
              panelSize="md"
              onItemEdit={handleNotificationEdit}
              onItemJump={handleNotificationJump}
              onItemResolve={handleResolveNotification}
              onItemInlineSave={handleInlineSave}
              severityFilter={notificationSeverityFilter}
              onSeverityFilterChange={setNotificationSeverityFilter}
              notificationSearch={notificationSearch}
              onNotificationSearchChange={setNotificationSearch}
              notificationStats={notificationStats}
            />
            <button
              onClick={() => loadFaculty()}
              disabled={loading}
              className="btn-primary inline-flex items-center gap-1.5 h-11 text-sm px-4 py-2"
              title="Reload faculty members"
              type="button"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>{loading ? 'Reloading' : 'Reload'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2 rounded-2xl bg-white px-2 py-1">
            {selectedFaculty.size > 0 && (
              <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-slate-900 shadow-sm">
                {selectedFaculty.size} selected
              </span>
            )}
            <span className="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-primary shadow-sm">
              {total} faculty
            </span>
          </div>

          <button
            ref={colButtonRef}
            className="btn-primary inline-flex items-center gap-2 h-11 text-sm px-4 py-2"
            onClick={() => setColMenuOpen((prev) => !prev)}
            type="button"
            title="Column visibility"
          >
            <Settings size={16} />
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
                  className="flex items-center gap-2 px-3 py-2 text-xs text-on-surface hover:bg-slate-50 rounded cursor-pointer whitespace-nowrap transition-colors"
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
            className="btn-primary flex items-center gap-1.5 text-xs px-3 py-2 min-h-11 min-w-11 shrink-0"
            type="button"
          >
            <PlusCircle size={14} />
            <span>Add</span>
          </button>
        </div>
      </div>

      {/* Search and Filter Bar */}
      <div className="glass-panel p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1 md:max-w-lg">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="text"
              placeholder="Search faculty..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-3 text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {['', 'active', 'inactive', 'on-leave'].map((status) => (
              <button
                key={status}
                onClick={() => {
                  setStatusFilter(status);
                  setPage(1);
                }}
                type="button"
                className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] transition ${
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
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">
            <AlertCircle size={16} />
            <span>{updateError}</span>
          </div>
        )}
      </div>

      {selectedFaculty.size > 0 && (
        <div className="glass-panel mb-4 flex flex-col gap-3 rounded-2xl border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-semibold">{selectedFaculty.size} faculty selected</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-on-surface transition-colors hover:bg-slate-100"
            >
              Export selected
            </button>
            <button
              type="button"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100"
            >
              Delete selected
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="glass-panel flex flex-col items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary"></div>
          <p className="mt-4 text-sm text-on-surface-variant">Loading faculty members...</p>
        </div>
      )}

      {error && !loading && (
        <div className="glass-panel flex items-center gap-3 rounded-lg bg-red-50 p-3 text-red-700">
          <AlertCircle size={18} />
          <div>
            <p className="font-bold text-sm">Error loading faculty</p>
            <p className="text-xs">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && faculty.length > 0 && (
        <div className="glass-panel overflow-hidden">

          <div className="max-h-[calc(100vh-18rem)] overflow-auto">
            <table className="min-w-full w-full border-collapse text-left text-sm">
              <thead>
                <tr className="sticky top-0 z-20 border-b border-slate-200 bg-white">
                  <th className="px-4 py-3 text-center w-12">
                    <input
                      type="checkbox"
                      checked={selectedFaculty.size > 0 && selectedFaculty.size === sortedFaculty.length}
                      onChange={toggleSelectAllFaculty}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                      aria-label="Select all faculty rows"
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
                {sortedFaculty.map((member) => {
                  const specializationItems = parseSpecializations(member.faculty_specialization);
                  const visibleSpecializations = specializationItems.slice(0, 2);
                  const hiddenSpecializationCount = Math.max(0, specializationItems.length - visibleSpecializations.length);
                  const isSelected = selectedFaculty.has(member.faculty_id);

                  return (
                    <tr
                      key={member.faculty_id}
                      id={`faculty-row-${member.faculty_id}`}
                      className={`group transition-colors ${isSelected ? 'bg-primary/10' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-4 py-3 text-center align-top">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectFaculty(member.faculty_id)}
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                          aria-label={`Select faculty ${member.faculty_name || member.faculty_id}`}
                        />
                      </td>
                      {columns.map(col => visibleColumns.has(col.key) && (
                        <td key={col.key} className="px-4 py-3 align-top">
                          {col.key === 'faculty_name' && (
                            <div className="min-w-0">
                              <p className="font-semibold text-on-surface leading-5">{member.faculty_name}</p>
                              <div className="mt-1 flex items-center gap-1 text-xs text-on-surface-variant/80">
                                <Mail size={12} />
                                <span className="truncate">
                                  {member.faculty_email ||
                                    `${String(member.faculty_name || '')
                                      .toLowerCase()
                                      .replace(/\s+/g, '.')}@chronomaria.edu`}
                                </span>
                              </div>
                            </div>
                          )}
                          {col.key === 'department' && (
                            <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${getDepartmentBadgeClass(member.departments?.department_name)}`}>
                              {member.departments?.department_name || 'Unassigned'}
                            </span>
                          )}
                          {col.key === 'faculty_role' && (
                            <span className="text-sm text-on-surface-variant">{member.faculty_role}</span>
                          )}
                          {col.key === 'faculty_specialization' && (
                            <div className="flex flex-wrap items-center gap-1">
                              {specializationItems.length === 0 ? (
                                <span className="text-xs text-on-surface-variant">—</span>
                              ) : (
                                <> 
                                  {visibleSpecializations.map((specialization) => (
                                    <span
                                      key={`${member.faculty_id}-${specialization}`}
                                      className="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary"
                                    >
                                      {specialization}
                                    </span>
                                  ))}
                                  {hiddenSpecializationCount > 0 && (
                                    <span
                                      title={specializationItems.join(', ')}
                                      className="cursor-help rounded-full bg-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700"
                                    >
                                      +{hiddenSpecializationCount}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                          {col.key === 'faculty_max_units' && (
                            <span className="text-sm font-medium text-on-surface">{member.faculty_max_units ?? '—'}</span>
                          )}
                          {col.key === 'subject_tags' && (() => {
                            const tags = allSubjectPreferences[String(member.faculty_id)] || [];
                            if (tags.length === 0) return <span className="text-xs text-on-surface-variant">—</span>;
                            const priorityStyle = {
                              1: 'bg-amber-100 text-amber-800',
                              2: 'bg-blue-100 text-blue-700',
                              3: 'bg-slate-100 text-slate-600',
                            };
                            const priorityLabel = { 1: 'High', 2: 'Capable', 3: 'Fallback' };
                            return (
                              <div className="flex flex-wrap gap-1">
                                {tags.map((t) => (
                                  <span
                                    key={t.subject_tag}
                                    title={`Priority: ${priorityLabel[t.priority_level] ?? t.priority_level}`}
                                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${priorityStyle[t.priority_level] ?? 'bg-slate-100 text-slate-600'}`}
                                  >
                                    {t.subject_tag}
                                    <span className="opacity-60 font-normal">P{t.priority_level}</span>
                                  </span>
                                ))}
                              </div>
                            );
                          })()}
                          {col.key === 'faculty_status' && (
                            <div className="flex justify-center">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${getStatusBadgeClass(member.faculty_status)}`}>
                                {String(member.faculty_status || 'inactive').replace('-', ' ')}
                              </span>
                            </div>
                          )}
                        </td>
                      ))}
                      <td className="sticky right-0 z-10 px-4 py-3 bg-white">
                        <div className="flex items-center justify-center gap-2 opacity-80 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={() => handleOpenPreferencesModal(member)}
                            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:border-transparent hover:bg-blue-50 hover:text-blue-600"
                            type="button"
                            aria-label={`Subject preferences for ${member.faculty_name}`}
                            title="Subject preferences"
                          >
                            <Tag size={16} />
                          </button>
                          <button
                            onClick={() => handleEditFaculty(member)}
                            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:border-transparent hover:bg-primary/10 hover:text-primary"
                            type="button"
                            aria-label={`Edit ${member.faculty_name}`}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => openDeleteConfirm(member)}
                            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:border-transparent hover:bg-red-50 hover:text-red-600"
                            type="button"
                            aria-label={`Delete ${member.faculty_name}`}
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

          {totalPages > 1 && (
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
                  aria-label="Previous faculty page"
                >
                  <ChevronLeft size={16} />
                  <span>Prev</span>
                </button>
                <div className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <label htmlFor="faculty-page-input" className="text-xs font-semibold text-slate-500">
                    Page
                  </label>
                  <input
                    id="faculty-page-input"
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
                    aria-label="Faculty page number"
                  />
                  <span className="text-xs font-semibold text-slate-500">of {totalPages}</span>
                </div>
                <button
                  onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
                  disabled={safePage === totalPages}
                  className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  aria-label="Next faculty page"
                >
                  <span>Next</span>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && !error && faculty.length === 0 && (
        <div className="glass-panel flex flex-col items-center justify-center py-16 text-center">
          <Users size={40} className="text-on-surface-variant/30" />
          <p className="mt-3 text-sm font-bold text-on-surface">No faculty members found</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            {search || statusFilter ? 'Try adjusting your filters' : 'Create your first faculty member to get started'}
          </p>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/20 bg-primary px-6 py-4">
              <h3 className="text-lg font-bold text-white">Add Faculty Member</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {facultyError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle size={16} />
                  {facultyError}
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Faculty Name *</label>
                <input
                  type="text"
                  value={newFaculty.faculty_name}
                  onChange={(e) => setNewFaculty({ ...newFaculty, faculty_name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Role</label>
                  <input
                    type="text"
                    value={newFaculty.faculty_role}
                    onChange={(e) => setNewFaculty({ ...newFaculty, faculty_role: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Status</label>
                  <select
                    value={newFaculty.faculty_status}
                    onChange={(e) => setNewFaculty({ ...newFaculty, faculty_status: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="on-leave">On Leave</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Department</label>
                  <select
                    value={newFaculty.department_id}
                    onChange={(e) => setNewFaculty({ ...newFaculty, department_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Select department</option>
                    {departments.map((department) => (
                      <option key={department.department_id} value={department.department_id}>
                        {department.department_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Max Units</label>
                  <input
                    type="number"
                    min="0"
                    value={newFaculty.faculty_max_units}
                    onChange={(e) => setNewFaculty({ ...newFaculty, faculty_max_units: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Email</label>
                <input
                  type="email"
                  value={newFaculty.faculty_email}
                  onChange={(e) => setNewFaculty({ ...newFaculty, faculty_email: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Specialization</label>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newSpecializationInput}
                      onChange={(e) => setNewSpecializationInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addSpecializationToForm(
                            setNewFaculty,
                            newFaculty.faculty_specialization,
                            newSpecializationInput,
                            setNewSpecializationInput
                          );
                        }
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        addSpecializationToForm(
                          setNewFaculty,
                          newFaculty.faculty_specialization,
                          newSpecializationInput,
                          setNewSpecializationInput
                        )
                      }
                      className="rounded-lg border border-white/60 bg-white px-3 py-2 text-xs font-bold text-on-surface-variant transition-colors hover:bg-slate-50"
                    >
                      Add
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {newFaculty.faculty_specialization.map((specialization) => (
                      <span key={specialization} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                        {specialization}
                        <button
                          type="button"
                          onClick={() => removeSpecializationFromForm(setNewFaculty, specialization)}
                          className="text-primary/70 hover:text-primary"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 rounded-lg border border-white/60 bg-white px-4 py-2.5 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddFaculty}
                  disabled={savingFaculty}
                  className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {savingFaculty ? 'Saving...' : 'Save Faculty'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showDeleteConfirm && facultyToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-on-surface">Delete Faculty Member</h3>
              <button
                onClick={closeDeleteConfirm}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-on-surface"
                aria-label="Close delete confirmation"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5" />
              <div>
                Are you sure you want to delete{' '}
                <span className="font-bold">{facultyToDelete.faculty_name}</span>? This action cannot be undone.
              </div>
            </div>

            {deleteError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle size={16} />
                {deleteError}
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                onClick={closeDeleteConfirm}
                disabled={deletingFaculty}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteFaculty}
                disabled={deletingFaculty}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {deletingFaculty ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && editingFaculty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/20 bg-primary px-6 py-4">
              <h3 className="text-lg font-bold text-white">Edit Faculty Member</h3>
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
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Faculty Name *</label>
                <input
                  type="text"
                  value={editingData.faculty_name}
                  onChange={(e) => setEditingData({ ...editingData, faculty_name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Role</label>
                  <input
                    type="text"
                    value={editingData.faculty_role}
                    onChange={(e) => setEditingData({ ...editingData, faculty_role: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Status</label>
                  <select
                    value={editingData.faculty_status}
                    onChange={(e) => setEditingData({ ...editingData, faculty_status: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="on-leave">On Leave</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Department</label>
                  <select
                    value={editingData.department_id}
                    onChange={(e) => setEditingData({ ...editingData, department_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Select department</option>
                    {departments.map((department) => (
                      <option key={department.department_id} value={department.department_id}>
                        {department.department_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Max Units</label>
                  <input
                    type="number"
                    min="0"
                    value={editingData.faculty_max_units}
                    onChange={(e) => setEditingData({ ...editingData, faculty_max_units: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Email</label>
                <input
                  type="email"
                  value={editingData.faculty_email}
                  onChange={(e) => setEditingData({ ...editingData, faculty_email: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Specialization</label>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editSpecializationInput}
                      onChange={(e) => setEditSpecializationInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addSpecializationToForm(
                            setEditingData,
                            editingData.faculty_specialization || [],
                            editSpecializationInput,
                            setEditSpecializationInput
                          );
                        }
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        addSpecializationToForm(
                          setEditingData,
                          editingData.faculty_specialization || [],
                          editSpecializationInput,
                          setEditSpecializationInput
                        )
                      }
                      className="rounded-lg border border-white/60 bg-white px-3 py-2 text-xs font-bold text-on-surface-variant transition-colors hover:bg-slate-50"
                    >
                      Add
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(editingData.faculty_specialization || []).map((specialization) => (
                      <span key={specialization} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                        {specialization}
                        <button
                          type="button"
                          onClick={() => removeSpecializationFromForm(setEditingData, specialization)}
                          className="text-primary/70 hover:text-primary"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
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

      {showPreferencesModal && preferencesModalFacultyId !== null && (
        <FacultySubjectPreferencesModal
          facultyId={preferencesModalFacultyId}
          facultyName={preferencesModalFacultyName}
          onClose={async () => {
            setShowPreferencesModal(false);
            // Always refresh faculty list and preferences after modal closes
            try {
              await loadFaculty();
            } catch (e) {
              console.warn('Error refreshing faculty list after closing modal', e);
            }
            try {
              await fetchAllFacultySubjectPreferences().then(setAllSubjectPreferences).catch(() => {});
            } catch (e) {
              console.warn('Error refreshing preferences map after closing modal', e);
            }
          }}
          onSaved={async () => {
            // Also refresh when saved inside modal (redundant but safe)
            try {
              await loadFaculty();
              await fetchAllFacultySubjectPreferences().then(setAllSubjectPreferences).catch(() => {});
            } catch (e) {
              console.warn('Error refreshing after modal save', e);
            }
          }}
        />
      )}
    </div>
  );
}
