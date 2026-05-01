import { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { fetchCourseOfferingsPage, fetchCourseOfferings, createCourseOffering, updateCourseOffering, deleteCourseOffering } from '../services/courseOfferingsApi';
import { fetchRooms } from '../services/roomsApi';

const PAGE_SIZE = 50;

export default function CourseOfferingView() {
  const [offerings, setOfferings] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [editingId, setEditingId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingData, setEditingData] = useState({});
  const [savingOffering, setSavingOffering] = useState(false);
  const [offeringError, setOfferingError] = useState(null);
  const [updateError, setUpdateError] = useState(null);
  const [rooms, setRooms] = useState([]);

  const totalPages = useMemo(() => {
    if (!totalRows) return 1;
    return Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  }, [totalRows]);

  useEffect(() => {
    let active = true;

    async function loadOfferings() {
      setLoading(true);
      setError('');

      try {
        const { rows: data, total: count } = await fetchCourseOfferingsPage(page, PAGE_SIZE);

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
  }, [page]);

  // Load rooms data
  useEffect(() => {
    let active = true;

    async function loadRooms() {
      try {
        const { rows } = await fetchRooms({ page: 1, limit: 100000 });
        if (active) setRooms(rows);
      } catch (err) {
        console.error('Failed to load rooms:', err);
      }
    }

    loadRooms();
    return () => {
      active = false;
    };
  }, []);



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

  // Search / filter / sort state
  const [filterText, setFilterText] = useState('');
  const [filterColumn, setFilterColumn] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'code', direction: 'asc' });

  const handleSort = (key) => {
    setSortConfig((currentSort) => ({
      key,
      direction: currentSort.key === key && currentSort.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  async function handleAddOffering() {
    if (!editingData.code) {
      setOfferingError('Course code is required');
      return;
    }
    try {
      setSavingOffering(true);
      setOfferingError(null);
      const payload = {
        ...editingData,
        mth_room_id: editingData.mth_room_id ? Number(editingData.mth_room_id) : null,
        tfs_room_id: editingData.tfs_room_id ? Number(editingData.tfs_room_id) : null,
      };
      await createCourseOffering(payload);
      setShowAddModal(false);
      setEditingData({});
      await loadInitialPage();
    } catch (err) {
      setOfferingError(err.message || 'Failed to create course offering');
    } finally {
      setSavingOffering(false);
    }
  }

  async function handleEditOffering(offering) {
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
      mth_room_id: offering.mth_room_id != null ? String(offering.mth_room_id) : '',
      tfs_schedule: offering.tfs_schedule || '',
      tfs_room_id: offering.tfs_room_id != null ? String(offering.tfs_room_id) : '',
    });
    setOfferingError(null);
  }

  async function handleSaveEdit() {
    if (!editingData.code) {
      setOfferingError('Course code is required');
      return;
    }
    if (!confirm('Are you sure you want to save these changes?')) return;
    try {
      setSavingOffering(true);
      setOfferingError(null);
      const payload = {
        ...editingData,
        mth_room_id: editingData.mth_room_id ? Number(editingData.mth_room_id) : null,
        tfs_room_id: editingData.tfs_room_id ? Number(editingData.tfs_room_id) : null,
      };
      await updateCourseOffering(editingId, payload);
      setEditingId(null);
      setEditingData({});
      await loadInitialPage();
    } catch (err) {
      if (String(err.message || '').includes('404')) {
        setEditingId(null);
        setEditingData({});
        await loadInitialPage();
        setUpdateError('That offering was removed. The list has been refreshed.');
        return;
      }
      setOfferingError(err.message || 'Failed to save offering');
    } finally {
      setSavingOffering(false);
    }
  }

  async function handleDeleteOffering(offering) {
    if (!confirm(`Delete "${offering.code} - ${offering.descriptive_title}"?`)) return;
    try {
      setUpdateError(null);
      await deleteCourseOffering(offering.id);
      await loadInitialPage();
    } catch (err) {
      if (String(err.message || '').includes('404')) {
        await loadInitialPage();
        setUpdateError('That offering was already removed. The list has been refreshed.');
        return;
      }
      setUpdateError(err.message || 'Failed to delete offering');
    }
  }

  async function loadInitialPage() {
    setPage(1);
  }

  const numericCols = new Set(['units', 'lec_hrs', 'lab_hrs', 'curr_id', 'mth_room_id', 'tfs_room_id']);

  // Simplified column definitions for better header
  const columns = [
    { key: 'code', label: 'Code' },
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
  useEffect(() => {
    if (!filterText) return; // only run when there's a search term
    let active = true;
    const tid = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        // request a large limit or let backend honor `search` param if supported
        const { rows } = await fetchCourseOfferings({ page: 1, limit: 100000, search: filterText });
        if (!active) return;
        setOfferings(
          rows.map((row) => ({
            ...row,
            department_name:
              row.departments?.department_name ??
              (row.department_id !== null && row.department_id !== undefined
                ? `Department #${row.department_id}`
                : null),
          }))
        );
        setTotalRows(rows.length);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to run global search.');
        setOfferings([]);
        setTotalRows(0);
      } finally {
        if (active) setLoading(false);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(tid);
    };
  }, [filterText]);

  const filteredOfferings = useMemo(() => {
    if (!filterText) return offerings;
    const q = filterText.toLowerCase();
    return offerings.filter((row) => {
      const check = (val) => (val === null || val === undefined) ? false : String(val).toLowerCase().includes(q);
      if (filterColumn === 'all') {
        return columns.some((c) => check(row[c.key]));
      }
      const col = columns.find((c) => c.key === filterColumn);
      return col ? check(row[col.key]) : false;
    });
  }, [offerings, filterText, filterColumn]);

  const displayedOfferings = useMemo(() => {
    const items = Array.from(filteredOfferings);
    const directionMultiplier = sortConfig.direction === 'asc' ? 1 : -1;

    const getComparableValue = (offering, key) => {
      const value = offering[key];
      if (numericCols.has(key)) {
        return Number(value ?? 0);
      }
      return String(value ?? '');
    };

    items.sort((a, b) => {
      const aVal = getComparableValue(a, sortConfig.key);
      const bVal = getComparableValue(b, sortConfig.key);

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * directionMultiplier;
      }

      return String(aVal).localeCompare(String(bVal), undefined, { sensitivity: 'base' }) * directionMultiplier;
    });

    return items;
  }, [filteredOfferings, sortConfig]);


  const renderCellValue = (value) => {
    if (value === null || value === undefined) return <span className="text-slate-400">—</span>;
    return String(value);
  };

  const getRoomName = (roomId) => {
    if (roomId === null || roomId === undefined || roomId === '') return '—';
    const idNum = Number(roomId);
    const room = rooms.find((r) => {
      // handle numeric and string id fields
      if (r == null) return false;
      if (r.id !== undefined && r.id !== null && Number(r.id) === idNum) return true;
      if (r.room_id !== undefined && r.room_id !== null && Number(r.room_id) === idNum) return true;
      // fall back to string compare
      if (String(r.id) === String(roomId)) return true;
      if (String(r.room_id) === String(roomId)) return true;
      return false;
    });

    if (room) return room.room_name || room.name || room.label || `Room ${roomId}`;
    return `Room ${roomId}`;
  };

  return (
    <div className="space-y-gutter animate-in slide-in-from-right-4 duration-500">
      {/* Header with stats */}
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-12">
        <div className="glass-panel col-span-1 flex items-center justify-between p-8 lg:col-span-8">
          <div className="space-y-1">
            <h2 className="text-headline-xl font-headline-xl text-on-surface">Course Offerings</h2>
            <p className="text-body-md text-on-surface-variant">Manage course offerings, schedules, and room assignments.</p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-primary flex items-center gap-2"
              onClick={() => setPage(1)}
              type="button"
            >
              <RefreshCw size={18} />
              <span>Reload</span>
            </button>
            <button
              className="btn-primary flex items-center gap-2"
              onClick={() => {
                setShowAddModal(true);
                setEditingData({});
                setOfferingError(null);
              }}
              type="button"
            >
              <PlusCircle size={18} />
              <span>Add Offering</span>
            </button>
          </div>
        </div>

        <div className="glass-panel flex flex-col items-center justify-center p-6 text-center">
          <BookMarked size={24} className="text-primary" />
          <span className="mt-3 text-3xl font-bold text-on-surface">{totalRows}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Total Offerings</span>
        </div>

        <div className="glass-panel flex flex-col items-center justify-center p-6 text-center">
          <span className="text-3xl font-bold text-on-surface">{page}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Current Page</span>
        </div>
      </div>

      {/* Controls: Search / Filter / Sort */}
      <div className="glass-panel space-y-4 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Search Input */}
          <div className="relative flex-1 md:max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="text"
              placeholder="Search by code or title..."
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
              }}
              className="w-full rounded-lg border border-white/30 bg-white/50 py-2 pl-10 pr-4 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white focus:shadow-lg"
            />
          </div>

          {/* Column Filter */}
          <div className="flex gap-2">
            <select
              value={filterColumn}
              onChange={(e) => setFilterColumn(e.target.value)}
              className="rounded-lg border border-white/30 bg-white/50 px-3 py-2 text-sm text-on-surface-variant outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white"
            >
              <option value="all">All columns</option>
              {columns.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <button
              onClick={() => { setFilterText(''); setFilterColumn('all'); setSortConfig({ key: 'code', direction: 'asc' }); }}
              className="rounded-lg border border-white/60 bg-white px-3 py-2 text-sm font-bold text-on-surface-variant transition-all hover:bg-slate-50"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Error Messages */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
        {updateError && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={16} />
            {updateError}
          </div>
        )}
      </div>

      {/* Data Table */}
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
                <tr className="border-b border-white/20 bg-white/30">
                  {columns.map((col) => (
                    <th key={col.key} className="px-6 py-4 text-left">
                      <button type="button" onClick={() => handleSort(col.key)} className={`flex w-full items-center justify-start gap-2 text-xs font-bold uppercase tracking-[0.28em] transition-colors ${
                        sortConfig.key === col.key ? 'text-primary' : 'text-on-surface-variant/70 hover:text-on-surface'
                      }`}>
                        <span>{col.label}</span>
                        <ArrowUpDown size={12} />
                      </button>
                    </th>
                  ))}
                  <th className="px-6 py-4 text-center text-xs font-bold uppercase tracking-[0.28em] text-on-surface-variant/70">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-white/20">
              {loading && (
                <tr>
                  <td
                    className="px-6 py-12 text-center text-sm text-on-surface-variant"
                    colSpan={columns.length + 1}
                  >
                    Loading course offerings...
                  </td>
                </tr>
              )}

              {!loading && error && (
                <tr>
                  <td
                    className="px-6 py-12 text-center text-sm text-error"
                    colSpan={columns.length + 1}
                  >
                    {error}
                  </td>
                </tr>
              )}

              {!loading && !error && offerings.length === 0 && (
                <tr>
                  <td
                    className="px-6 py-12 text-center text-sm text-on-surface-variant"
                    colSpan={columns.length + 1}
                  >
                    No course offerings found.
                  </td>
                </tr>
              )}

              {!loading && !error && displayedOfferings.map((offering) => (
                <tr key={offering.id} className="transition-colors hover:bg-white/40">
                  {columns.map((col) => (
                    <td key={col.key} className="px-6 py-4">
                      {col.key === 'code' ? (
                        <span className="inline-block rounded-md bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                          {renderCellValue(offering[col.key])}
                        </span>
                      ) : col.key === 'course_no' ? (
                        <span className="text-sm font-medium text-on-surface">
                          {renderCellValue(offering[col.key])}
                        </span>
                      ) : col.key === 'descriptive_title' ? (
                        <div className="max-w-xs">
                          <p className="text-xs text-on-surface-variant">{renderCellValue(offering[col.key])}</p>
                        </div>
                      ) : col.key === 'units' ? (
                        <span className="text-sm font-medium text-on-surface">
                          {renderCellValue(offering[col.key])}
                        </span>
                      ) : col.key === 'lec_hrs' || col.key === 'lab_hrs' ? (
                        <span className="text-sm font-medium text-on-surface-variant">
                          {renderCellValue(offering[col.key])}h
                        </span>
                      ) : col.key === 'mth_room_id' || col.key === 'tfs_room_id' ? (
                        <span className="text-sm text-on-surface-variant">
                          {getRoomName(offering[col.key])}
                        </span>
                      ) : (
                        <span className="text-sm text-on-surface-variant">
                          {renderCellValue(offering[col.key])}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="px-6 py-4">
                    <div className="flex justify-center gap-2">
                      <button
                        onClick={() => handleEditOffering(offering)}
                        className="rounded-md p-2 text-slate-400 transition-colors hover:bg-white hover:text-primary"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteOffering(offering)}
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
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between rounded-xl border border-white/50 bg-white/60 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-on-surface-variant/80">
          Showing {startRow}-{endRow} of {totalRows}
        </p>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1 rounded-md border border-white/60 bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-50"
            disabled={page <= 1 || loading}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            type="button"
          >
            <ChevronLeft size={14} />
            Prev
          </button>
          <span className="text-xs font-semibold text-on-surface-variant">
            Page {page} of {totalPages}
          </span>
          <button
            className="inline-flex items-center gap-1 rounded-md border border-white/60 bg-white px-3 py-2 text-xs font-semibold text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-50"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            type="button"
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Edit Modal */}
      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl p-8">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-xl font-bold text-on-surface">Edit Course Offering</h3>
              <button
                onClick={() => setEditingId(null)}
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

            {editingId && (
              <div className="space-y-6">
                {columnGroups.map((group) => (
                  <div key={group.title} className={`space-y-4 rounded-xl ${group.color} p-4`}>
                    <h4 className={`text-sm font-bold uppercase tracking-[0.2em] ${group.titleColor}`}>
                      {group.title}
                    </h4>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {group.columns.map((col) => (
                        <div key={col.key}>
                          <label className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant/70">
                            {col.label}
                          </label>
                          {col.key === 'mth_room_id' || col.key === 'tfs_room_id' ? (
                            <select
                              value={editingData[col.key] ?? ''}
                              onChange={(e) => setEditingData({ ...editingData, [col.key]: e.target.value })}
                              className="w-full rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm text-on-surface outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                            >
                              <option value="">Select a room</option>
                              {rooms.map((room) => (
                                    <option key={room.id} value={String(room.id)}>
                                      {room.room_name || room.name || `Room ${room.id}`}
                                    </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={numericCols.has(col.key) ? 'number' : 'text'}
                              value={editingData[col.key] ?? ''}
                              onChange={(e) => setEditingData({ ...editingData, [col.key]: e.target.value })}
                              className="w-full rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm text-on-surface outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex gap-3 pt-6">
                  <button
                    onClick={() => setEditingId(null)}
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

            <div className="space-y-6">
              {columnGroups.map((group) => (
                <div key={group.title} className="space-y-4">
                  <h4 className="text-sm font-bold uppercase tracking-[0.2em] text-on-surface-variant/80">
                    {group.title}
                  </h4>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {group.columns.map((col) => (
                      <div key={col.key}>
                        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                          {col.label}
                        </label>
                        {col.key === 'mth_room_id' || col.key === 'tfs_room_id' ? (
                          <select
                            value={editingData[col.key] ?? ''}
                            onChange={(e) => setEditingData({ ...editingData, [col.key]: e.target.value })}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                          >
                            <option value="">Select a room</option>
                            {rooms.map((room) => (
                              <option key={room.id} value={String(room.id)}>
                                {room.room_name || room.name || `Room ${room.id}`}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={numericCols.has(col.key) ? 'number' : 'text'}
                            value={editingData[col.key] ?? ''}
                            onChange={(e) => setEditingData({ ...editingData, [col.key]: e.target.value })}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                            placeholder={`Enter ${col.label.toLowerCase()}`}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div className="flex gap-3 pt-6">
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingData({});
                    setOfferingError(null);
                  }}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddOffering}
                  disabled={savingOffering}
                  className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
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
