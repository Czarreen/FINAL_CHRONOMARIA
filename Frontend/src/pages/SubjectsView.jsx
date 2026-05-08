import { useMemo, useState, useEffect } from 'react';
import { ArrowUpDown, BookOpen, PlusCircle, Edit2, Trash2, Search, ChevronLeft, ChevronRight, Check, X, AlertCircle } from 'lucide-react';
import { fetchSubjects, updateSubjectStatus, createSubject, updateSubject, deleteSubject } from '../services/subjectsApi';
import { fetchRooms } from '../services/roomsApi';

export default function SubjectsView() {
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

  // Load subjects data
  useEffect(() => {
    loadSubjects();
  }, [page, limit, search, statusFilter]);

  useEffect(() => {
    loadRoomLookup();
  }, []);

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

  async function handleEditSubject(subject) {
    setEditingSubject(subject);
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

  return (
    <div className="space-y-gutter animate-in slide-in-from-right-4 duration-500">
      {/* Header with stats */}
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-12">
        <div className="glass-panel col-span-1 flex items-center justify-between p-8 lg:col-span-8">
          <div className="space-y-1">
            <h2 className="text-headline-xl font-headline-xl text-on-surface">Curriculum Repository</h2>
            <p className="text-body-md text-on-surface-variant">Manage subjects, credit units, and classifications.</p>
          </div>
          <div className="flex gap-2">
<button 
              onClick={() => setShowAddModal(true)}
              className="btn-primary flex items-center gap-2"
            >
              <PlusCircle size={18} />
              <span>Add Subject</span>
            </button>
          </div>
        </div>
        <div className="glass-panel flex flex-col items-center justify-center p-6 text-center">
          <BookOpen size={24} className="text-primary" />
          <span className="mt-3 text-3xl font-bold text-on-surface">{total}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Total Subjects</span>
        </div>
        <div className="glass-panel flex flex-col items-center justify-center p-6 text-center">
          <Check size={24} className="text-green-500" />
          <span className="mt-3 text-3xl font-bold text-on-surface">{activeCount}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Active</span>
        </div>
      </div>

      {/* Search and Filter Bar */}
      <div className="glass-panel space-y-4 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Search Input */}
          <div className="relative flex-1 md:max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="text"
              placeholder="Search by code, description, schedule, or room..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-white/30 bg-white/50 py-2 pl-10 pr-4 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white focus:shadow-lg"
            />
          </div>

          {/* Status Filter */}
          <div className="flex gap-2">
            {['', 'active', 'inactive'].map((status) => (
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

        {/* Error Message */}
        {updateError && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={16} />
            {updateError}
          </div>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="glass-panel flex flex-col items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary"></div>
          <p className="mt-4 text-on-surface-variant">Loading subjects...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="glass-panel flex items-center gap-3 rounded-lg bg-red-50 p-4 text-red-700">
          <AlertCircle size={20} />
          <div>
            <p className="font-bold">Error loading subjects</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Subjects Table */}
      {!loading && !error && subjects.length > 0 && (
        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/20 bg-white/30">
                  <th className="px-6 py-4 text-left">
                    <button type="button" onClick={() => handleSort('subject_code')} className={sortHeaderClass('subject_code')}>
                      <span>Code</span>
                      <ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left">
                    <button type="button" onClick={() => handleSort('subject_course_no')} className={sortHeaderClass('subject_course_no')}>
                      <span>Course No</span>
                      <ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left">
                    <button type="button" onClick={() => handleSort('subject_descriptive_title')} className={sortHeaderClass('subject_descriptive_title')}>
                      <span>Description</span>
                      <ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left">
                    <button type="button" onClick={() => handleSort('mth_schedule')} className={sortHeaderClass('mth_schedule')}>
                      <span>MTH</span>
                      <ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left">
                    <button type="button" onClick={() => handleSort('tfs_schedule')} className={sortHeaderClass('tfs_schedule')}>
                      <span>TFS</span>
                      <ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left">
                    <button type="button" onClick={() => handleSort('room')} className={sortHeaderClass('room')}>
                      <span>Room</span>
                      <ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-center">
                    <button type="button" onClick={() => handleSort('subject_units')} className={sortHeaderClass('subject_units')}>
                      <span>Units</span>
                      <ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-center">
                    <button type="button" onClick={() => handleSort('subject_lec_lab')} className={sortHeaderClass('subject_lec_lab')}>
                      <span>Lec/Lab</span>
                      <ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-center">
                    <button type="button" onClick={() => handleSort('subject_status')} className={sortHeaderClass('subject_status')}>
                      <span>Status</span>
                      <ArrowUpDown size={12} />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-bold uppercase tracking-[0.28em] text-on-surface-variant/70">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/20">
                {sortedSubjects.map((subject, index) => (
                  <tr key={subject.subject_id} className={`border-b border-white/120 transition-colors hover:bg-white/100 ${index % 2 === 0 ? 'bg-white/6' : ''}`}>
                    <td className="px-6 py-4">
                      <span className="inline-block rounded-md bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                        {subject.subject_code || 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-on-surface">
                      {subject.subject_course_no || '—'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="max-w-xs">
                        <p className="text-sm font-medium text-on-surface">{subject.subject_descriptive_title || '—'}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">
                      <span className="block text-sm text-on-surface-variant">{extractTimeRange(subject.mth_schedule)}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">
                      <span className="block text-sm text-on-surface-variant">{extractTimeRange(subject.tfs_schedule)}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">
                      <span className="block text-sm text-on-surface-variant">{extractRoomSummary(subject)}</span>
                    </td>
                    <td className="px-6 py-4 text-center text-sm font-medium text-on-surface">
                      {subject.subject_units || 0}
                    </td>
                    <td className="px-6 py-4 text-center text-sm font-medium text-on-surface-variant">
                      {subject.subject_lec_hrs || 0}h / {subject.subject_lab_hrs || 0}h
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center">
                        <button
                          onClick={() => handleStatusToggle(subject.subject_id, subject.subject_status)}
                          disabled={updatingStatus === subject.subject_id}
                          className={`inline-flex items-center gap-2 rounded-lg px-3 py-1 text-xs font-bold transition-all ${
                            subject.subject_status === 'active'
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          } disabled:opacity-50`}
                        >
                          {updatingStatus === subject.subject_id ? (
                            <>
                              <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                            </>
                          ) : subject.subject_status === 'active' ? (
                            <>
                              <Check size={14} />
                              Active
                            </>
                          ) : (
                            <>
                              <X size={14} />
                              Inactive
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => handleEditSubject(subject)}
                          className="rounded-md p-2 text-slate-400 transition-colors hover:bg-white hover:text-primary"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteSubject(subject)}
                          className="rounded-md p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={16} />
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
            <div className="flex items-center justify-between border-t border-white/20 bg-white/30 px-6 py-4">
              <div className="text-sm text-on-surface-variant">
                Showing {(page - 1) * limit + 1} to {Math.min(page * limit, total)} of {total} subjects
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

{/* Empty State */}
      {!loading && !error && subjects.length === 0 && (
        <div className="glass-panel flex flex-col items-center justify-center py-16 text-center">
          <BookOpen size={48} className="text-on-surface-variant/30" />
          <p className="mt-4 text-lg font-bold text-on-surface">No subjects found</p>
          <p className="mt-1 text-sm text-on-surface-variant">
            {search || statusFilter ? 'Try adjusting your filters' : 'Create your first subject to get started'}
          </p>
        </div>
      )}

      {/* Add Subject Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-on-surface">Add New Subject</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-on-surface"
              >
                <X size={20} />
              </button>
            </div>

            {subjectError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle size={16} />
                {subjectError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Subject Code *
                  </label>
                  <input
                    type="text"
                    value={newSubject.subject_code}
                    onChange={(e) => setNewSubject({ ...newSubject, subject_code: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                  placeholder="e.g., Introduction to Human Computer Interactions"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    MTH Schedule
                  </label>
                  <input
                    type="text"
                    value={newSubject.mth_schedule}
                    onChange={(e) => setNewSubject({ ...newSubject, mth_schedule: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                    placeholder="e.g., M 7:00-10:00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    MTH Room(s)
                  </label>
                  <input
                    type="text"
                    value={newSubject.mth_room}
                    onChange={(e) => setNewSubject({ ...newSubject, mth_room: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                    placeholder="e.g., 101/102"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    TFS Schedule
                  </label>
                  <input
                    type="text"
                    value={newSubject.tfs_schedule}
                    onChange={(e) => setNewSubject({ ...newSubject, tfs_schedule: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                    placeholder="e.g., T 1:00-4:00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    TFS Room(s)
                  </label>
                  <input
                    type="text"
                    value={newSubject.tfs_room}
                    onChange={(e) => setNewSubject({ ...newSubject, tfs_room: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                    placeholder="e.g., 201"
                  />
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
                    onChange={(e) => setNewSubject({ ...newSubject, subject_units: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                    onChange={(e) => setNewSubject({ ...newSubject, subject_lec_hrs: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                    onChange={(e) => setNewSubject({ ...newSubject, subject_lab_hrs: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
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
                onClick={handleAddSubject}
                disabled={savingSubject}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {savingSubject ? 'Saving...' : 'Save Subject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Subject Modal */}
      {showEditModal && editingSubject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-on-surface">Edit Subject</h3>
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
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                  Subject Code *
                </label>
                <input
                  type="text"
                  value={editingData.subject_code}
                  onChange={(e) => setEditingData({ ...editingData, subject_code: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                  placeholder="e.g., CMSC 11"
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                  placeholder="e.g., 1"
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                  placeholder="e.g., Introduction to Computer Science"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    MTH Schedule
                  </label>
                  <input
                    type="text"
                    value={editingData.mth_schedule}
                    onChange={(e) => setEditingData({ ...editingData, mth_schedule: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                    placeholder="e.g., M 7:00-10:00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    MTH Room(s)
                  </label>
                  <input
                    type="text"
                    value={editingData.mth_room}
                    onChange={(e) => setEditingData({ ...editingData, mth_room: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                    placeholder="e.g., 101/102"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    TFS Schedule
                  </label>
                  <input
                    type="text"
                    value={editingData.tfs_schedule}
                    onChange={(e) => setEditingData({ ...editingData, tfs_schedule: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                    placeholder="e.g., T 1:00-4:00"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    TFS Room(s)
                  </label>
                  <input
                    type="text"
                    value={editingData.tfs_room}
                    onChange={(e) => setEditingData({ ...editingData, tfs_room: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                    placeholder="e.g., 201"
                  />
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
                    onChange={(e) => setEditingData({ ...editingData, subject_units: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                    onChange={(e) => setEditingData({ ...editingData, subject_lec_hrs: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                    onChange={(e) => setEditingData({ ...editingData, subject_lab_hrs: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
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
