import { useEffect, useMemo, useState } from 'react';
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
import { fetchFacultyNotifications, fetchPersistedFacultyNotifications, resolveFacultyNotification } from '../services/notificationsApi.js';
import { useRowHighlight } from '../hooks/useRowHighlight.jsx';
import { createAuditLog, buildChangeSummary } from '../services/auditLogsApi.js';

export default function FacultyView() {
  const [faculty, setFaculty] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
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
  const [savingFaculty, setSavingFaculty] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [facultyError, setFacultyError] = useState(null);
  const [editError, setEditError] = useState(null);
  const [editingFaculty, setEditingFaculty] = useState(null);
  const [newSpecializationInput, setNewSpecializationInput] = useState('');
  const [editSpecializationInput, setEditSpecializationInput] = useState('');
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
  const [pendingScrollToId, setPendingScrollToId] = useState(null);
  const [findingRow, setFindingRow] = useState(false);

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

  // Handle scrolling to row when it appears (after page navigation)
  useEffect(() => {
    if (pendingScrollToId) {
      setHighlight(pendingScrollToId, 'FacultyView');
      setPendingScrollToId(null);
    }
  }, [pendingScrollToId, faculty, setHighlight]);

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
      setNotifications(payload.rows || []);
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
          setPage(pageNum);
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
      setHighlight(item.faculty_id, 'FacultyView');
    } else {
      // Faculty member not on current page, find which page they're on
      setFindingRow(true);
      findFacultyPageNumber(item.faculty_id)
        .then((pageNum) => {
          if (pageNum && pageNum !== page) {
            setPage(pageNum);
            setPendingScrollToId(item.faculty_id);
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
      const data = await fetchFaculty({
        page,
        limit,
        search,
        status: statusFilter,
      });
      setFaculty(data.rows || []);
      setTotal(Number(data.total || 0));
      setActiveCount(Number(data.activeCount || 0));
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

  const totalPages = Math.ceil(total / limit);

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
      const createdFaculty = await createFaculty(normalizePayload(newFaculty));
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
      createAuditLog({ action: 'Created faculty', module: 'Faculty', description: `Added faculty "${createdFaculty?.faculty_name || newFaculty.faculty_name}"`, changesAfter: createdFaculty });
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
      createAuditLog({ action: 'Updated faculty', module: 'Faculty', description: `Updated faculty "${editingFaculty.faculty_name}": ${buildChangeSummary(editingFaculty, normalized, { faculty_name: 'Name', faculty_role: 'Role', faculty_status: 'Status', faculty_email: 'Email', faculty_max_units: 'Max Units' })}` });
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
      createAuditLog({ action: 'Deleted faculty', module: 'Faculty', description: `Deleted faculty "${member.faculty_name}"`, changesBefore: member });
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

  async function handleStatusToggle(memberId, currentStatus) {
    const current = String(currentStatus || '').toLowerCase();
    const newStatus = current === 'active' ? 'inactive' : 'active';
    try {
      setUpdatingStatus(memberId);
      setUpdateError(null);
      await updateFacultyStatus(memberId, newStatus);
      await loadFaculty();
      await loadFacultyNotifications(); // ← Refresh notifications after status change
      createAuditLog({ action: `Set faculty status to ${newStatus}`, module: 'Faculty', description: `Changed faculty #${memberId} status to ${newStatus}` });
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

  return (
    <div className="space-y-gutter animate-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-12">
        <div className="glass-panel col-span-1 flex items-center justify-between p-8 lg:col-span-8">
          <div className="space-y-1">
            <h2 className="text-headline-xl font-headline-xl text-on-surface">Faculty Directory</h2>
            <p className="text-body-md text-on-surface-variant">Manage and track academic teaching staff.</p>
          </div>
          <div className="flex items-center gap-3">
            <NotificationButton
              items={filteredNotifications}
              title="Faculty Notifications"
              buttonLabel="Issues"
              emptyLabel="No faculty issues"
              panelSize="md"
              onItemEdit={handleNotificationEdit}
              onItemJump={handleNotificationJump}
              onItemResolve={handleResolveNotification}
              severityFilter={notificationSeverityFilter}
              onSeverityFilterChange={setNotificationSeverityFilter}
              notificationSearch={notificationSearch}
              onNotificationSearchChange={setNotificationSearch}
              notificationStats={notificationStats}
            />
            <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2">
              <PlusCircle size={18} />
              <span>Add Faculty</span>
            </button>
          </div>
        </div>
        <div className="glass-panel flex flex-col items-center justify-center p-6 text-center">
          <Users size={24} className="text-primary" />
          <span className="mt-3 text-3xl font-bold text-on-surface">{total}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Total Faculty</span>
        </div>
        <div className="glass-panel flex flex-col items-center justify-center p-6 text-center">
          <Check size={24} className="text-green-500" />
          <span className="mt-3 text-3xl font-bold text-on-surface">{activeCount}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Active</span>
        </div>
      </div>

      <div className="glass-panel space-y-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-white/60 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">On Leave (Current Page)</p>
            <p className="mt-2 text-2xl font-bold text-on-surface">{onLeaveCount}</p>
          </div>
          <div className="rounded-xl bg-white/60 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Departments (Current Page)</p>
                <p className="mt-2 text-2xl font-bold text-on-surface">{departmentCount}</p>
              </div>
              <Building2 size={18} className="text-primary" />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1 md:max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="text"
              placeholder="Search by name, email, or role..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-white/30 bg-white/50 py-2 pl-10 pr-4 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white focus:shadow-lg"
            />
          </div>

          <div className="flex gap-2">
            {['', 'active', 'inactive', 'on-leave'].map((status) => (
              <button
                key={status}
                onClick={() => {
                  setStatusFilter(status);
                  setPage(1);
                }}
                className={`rounded-lg px-4 py-2 text-xs font-bold transition-all ${
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
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={16} />
            {updateError}
          </div>
        )}
      </div>

      {loading && (
        <div className="glass-panel flex flex-col items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary"></div>
          <p className="mt-4 text-on-surface-variant">Loading faculty members...</p>
        </div>
      )}

      {error && !loading && (
        <div className="glass-panel flex items-center gap-3 rounded-lg bg-red-50 p-4 text-red-700">
          <AlertCircle size={20} />
          <div>
            <p className="font-bold">Error loading faculty</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && faculty.length > 0 && (
        <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-white/20 bg-white/30">
                <th className="px-6 py-4 text-left">
                  <button type="button" onClick={() => handleSort('faculty_name')} className={sortHeaderClass('faculty_name')}>
                    <span>Faculty Member</span>
                    <ArrowUpDown size={12} />
                  </button>
                </th>
                <th className="px-6 py-4 text-left">
                  <button type="button" onClick={() => handleSort('department')} className={sortHeaderClass('department')}>
                    <span>Department</span>
                    <ArrowUpDown size={12} />
                  </button>
                </th>
                <th className="px-6 py-4 text-left">
                  <button type="button" onClick={() => handleSort('faculty_role')} className={sortHeaderClass('faculty_role')}>
                    <span>Role</span>
                    <ArrowUpDown size={12} />
                  </button>
                </th>
                <th className="px-6 py-4 text-left">
                  <button
                    type="button"
                    onClick={() => handleSort('faculty_specialization')}
                    className={sortHeaderClass('faculty_specialization')}
                  >
                    <span>Specialization</span>
                    <ArrowUpDown size={12} />
                  </button>
                </th>
                <th className="px-6 py-4 text-center">
                  <button type="button" onClick={() => handleSort('faculty_max_units')} className={sortHeaderClass('faculty_max_units')}>
                    <span>Units</span>
                    <ArrowUpDown size={12} />
                  </button>
                </th>
                <th className="px-6 py-4 text-center">
                  <button type="button" onClick={() => handleSort('faculty_status')} className={sortHeaderClass('faculty_status')}>
                    <span>Status</span>
                    <ArrowUpDown size={12} />
                  </button>
                </th>
                <th className="px-6 py-4 text-center">
                  <button type="button" onClick={() => handleSort('actions')} className={sortHeaderClass('actions')}>
                    <span>Actions</span>
                    <ArrowUpDown size={12} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/20">
              {sortedFaculty.map((member) => {
                const specializationItems = parseSpecializations(member.faculty_specialization);
                const visibleSpecializations = specializationItems.slice(0, 2);
                const hiddenSpecializationCount = Math.max(0, specializationItems.length - visibleSpecializations.length);

                return (
                  <tr key={member.faculty_id} id={`faculty-row-${member.faculty_id}`} className="group transition-colors hover:bg-white/45">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-bold text-on-surface">{member.faculty_name}</p>
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-on-surface-variant/70">
                            <Mail size={12} />
                            <span>
                              {member.faculty_email ||
                                `${String(member.faculty_name || '')
                                  .toLowerCase()
                                  .replace(/\s+/g, '.')}@chronomaria.edu`}
                            </span>
                          </div>
                        </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-on-surface-variant">
                      {member.departments?.department_name || 'Unassigned'}
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">{member.faculty_role}</td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">
                      {specializationItems.length === 0 ? (
                        '—'
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {visibleSpecializations.map((specialization) => (
                            <span
                              key={`${member.faculty_id}-${specialization}`}
                              className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
                            >
                              {specialization}
                            </span>
                          ))}
                          {hiddenSpecializationCount > 0 && (
                            <span
                              title={specializationItems.join(', ')}
                              className="cursor-help rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
                            >
                              +{hiddenSpecializationCount} more
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center text-sm font-medium text-on-surface">
                      {member.faculty_max_units ?? '—'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center">
                        <button
                          onClick={() => handleStatusToggle(member.faculty_id, member.faculty_status)}
                          disabled={updatingStatus === member.faculty_id}
                          className={`inline-flex items-center gap-2 rounded-lg px-3 py-1 text-xs font-bold transition-all ${getStatusBadgeClass(
                            member.faculty_status
                          )} disabled:opacity-50`}
                        >
                          {updatingStatus === member.faculty_id ? (
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                          ) : String(member.faculty_status || '').toLowerCase() === 'active' ? (
                            <>
                              <Check size={14} />
                              Active
                            </>
                          ) : (
                            <>
                              <X size={14} />
                              {String(member.faculty_status || 'inactive').replace('-', ' ')}
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => handleEditFaculty(member)}
                          className="rounded-lg p-2 text-slate-400 transition-all hover:bg-white hover:text-primary"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteFaculty(member)}
                          className="rounded-lg p-2 text-slate-400 transition-all hover:bg-red-50 hover:text-red-500"
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
          <div className="flex items-center justify-between border-t border-white/20 bg-white/30 px-6 py-4">
            <div className="text-sm text-on-surface-variant">
              Showing {(page - 1) * limit + 1} to {Math.min(page * limit, total)} of {total} faculty members
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 rounded-lg border border-white/30 bg-white px-3 py-2 text-sm font-bold text-on-surface transition-all hover:bg-slate-50 disabled:opacity-50"
              >
                <ChevronLeft size={16} />
                Previous
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = index + 1;
                  } else if (page <= 3) {
                    pageNum = index + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + index;
                  } else {
                    pageNum = page - 2 + index;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`rounded-lg px-3 py-2 text-sm font-bold transition-all ${
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
                className="flex items-center gap-1 rounded-lg border border-white/30 bg-white px-3 py-2 text-sm font-bold text-on-surface transition-all hover:bg-slate-50 disabled:opacity-50"
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      )}

      {!loading && !error && faculty.length === 0 && (
        <div className="glass-panel flex flex-col items-center justify-center py-16 text-center">
          <Users size={48} className="text-on-surface-variant/30" />
          <p className="mt-4 text-lg font-bold text-on-surface">No faculty members found</p>
          <p className="mt-1 text-sm text-on-surface-variant">
            {search || statusFilter ? 'Try adjusting your filters' : 'Create your first faculty member to get started'}
          </p>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-on-surface">Add Faculty Member</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-on-surface"
              >
                <X size={20} />
              </button>
            </div>

            {facultyError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle size={16} />
                {facultyError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Faculty Name *</label>
                <input
                  type="text"
                  value={newFaculty.faculty_name}
                  onChange={(e) => setNewFaculty({ ...newFaculty, faculty_name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Role</label>
                  <input
                    type="text"
                    value={newFaculty.faculty_role}
                    onChange={(e) => setNewFaculty({ ...newFaculty, faculty_role: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Status</label>
                  <select
                    value={newFaculty.faculty_status}
                    onChange={(e) => setNewFaculty({ ...newFaculty, faculty_status: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="on-leave">On Leave</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Department</label>
                  <select
                    value={newFaculty.department_id}
                    onChange={(e) => setNewFaculty({ ...newFaculty, department_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Email</label>
                <input
                  type="email"
                  value={newFaculty.faculty_email}
                  onChange={(e) => setNewFaculty({ ...newFaculty, faculty_email: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                      className="rounded-lg border border-white/60 bg-white px-3 py-2 text-xs font-bold text-on-surface-variant hover:bg-slate-50"
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
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-600 transition-colors hover:bg-slate-50"
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
      )}

      {showEditModal && editingFaculty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-on-surface">Edit Faculty Member</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-on-surface"
              >
                <X size={20} />
              </button>
            </div>

            {editError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle size={16} />
                {editError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Faculty Name *</label>
                <input
                  type="text"
                  value={editingData.faculty_name}
                  onChange={(e) => setEditingData({ ...editingData, faculty_name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Role</label>
                  <input
                    type="text"
                    value={editingData.faculty_role}
                    onChange={(e) => setEditingData({ ...editingData, faculty_role: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Status</label>
                  <select
                    value={editingData.faculty_status}
                    onChange={(e) => setEditingData({ ...editingData, faculty_status: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="on-leave">On Leave</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Department</label>
                  <select
                    value={editingData.department_id}
                    onChange={(e) => setEditingData({ ...editingData, department_id: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">Email</label>
                <input
                  type="email"
                  value={editingData.faculty_email}
                  onChange={(e) => setEditingData({ ...editingData, faculty_email: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                      className="rounded-lg border border-white/60 bg-white px-3 py-2 text-xs font-bold text-on-surface-variant hover:bg-slate-50"
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
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowEditModal(false)}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-600 transition-colors hover:bg-slate-50"
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
      )}
    </div>
  );
}

