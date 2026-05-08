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
  Download,
  Settings,
  Check,
} from 'lucide-react';
import { fetchCourseOfferingsPage, fetchCourseOfferings, createCourseOffering, updateCourseOffering, deleteCourseOffering } from '../services/courseOfferingsApi';
import { fetchRooms } from '../services/roomsApi';
import NotificationButton from '../components/NotificationButton';
import { fetchCourseOfferingNotifications } from '../services/notificationsApi';
import { buildCourseOfferingNotifications } from '../utils/missingData';

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
  const [successMessage, setSuccessMessage] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [selectedOfferings, setSelectedOfferings] = useState(new Set());
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [visibleColumns, setVisibleColumns] = useState(
    new Set([
      'code', 'course_no', 'descriptive_title', 'department_name', 'section',
      'units', 'lec_hrs', 'lab_hrs', 'mth_schedule', 'mth_room_id', 'tfs_schedule', 'tfs_room_id'
    ])
  );
  const [filterText, setFilterText] = useState('');
  const [filterColumn, setFilterColumn] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'code', direction: 'asc' });

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

  const totalPages = useMemo(() => {
    if (!totalRows) return 1;
    return Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  }, [totalRows]);

  useEffect(() => {
    if (filterText) return; // skip pagination load when searching

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
  }, [page, filterText, refreshTrigger]);

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

  async function handleAddOffering() {
    if (!editingData.code) {
      setOfferingError('Course code is required');
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
      mth_room_id: resolveRoomIds(offering, 'mth').map(String),
      tfs_schedule: offering.tfs_schedule || '',
      tfs_room_id: resolveRoomIds(offering, 'tfs').map(String),
    });
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

      await updateCourseOffering(editingId, payload);
      setSuccessMessage(`Updated "${editingData.code}"`);
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
    setConfirmDialog({
      title: 'Delete offering?',
      message: `Delete "${offering.code} - ${offering.descriptive_title}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        try {
          setUpdateError(null);
          await deleteCourseOffering(offering.id);
          setSuccessMessage(`Deleted "${offering.code}"`);
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
    setRefreshTrigger((prev) => prev + 1);
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
    if (!filterText) {
      setPage(1);
      return;
    }
    let active = true;
    const tid = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
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
        setPage(1);
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
  }, [filterText, refreshTrigger]);

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

  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    let active = true;
    async function loadNotifications() {
      try {
        const localNotifications = buildCourseOfferingNotifications(offerings);
        if (!active) return;
        setNotifications(localNotifications);
      } catch (err) {
        console.error('Failed to build notifications:', err);
        setNotifications([]);
      }
    }
    loadNotifications();
    return () => { active = false; };
  }, [offerings]);

  const focusNotificationItem = (item) => {
    if (!item?.offeringId) return;
    const targetRow = document.getElementById(`offering-row-${item.offeringId}`);
    if (targetRow) {
      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetRow.classList.add('ring-2', 'ring-primary/40');
      window.setTimeout(() => {
        targetRow.classList.remove('ring-2', 'ring-primary/40');
      }, 1200);
    }

  };

  const editNotificationItem = (item) => {
    const offering = offerings.find((row) => row.id === item.offeringId);
    if (offering) {
      handleEditOffering(offering);
      const targetRow = document.getElementById(`offering-row-${item.offeringId}`);
      if (targetRow) {
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetRow.classList.add('ring-2', 'ring-primary/40');
        window.setTimeout(() => {
          targetRow.classList.remove('ring-2', 'ring-primary/40');
        }, 1200);
      }
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
              const conflictCount = conflicts.filter((o) => o.id !== editingId).length;

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

    // Look up by room_id (integer)
    const room = rooms.find((r) => {
      if (!r) return false;
      // Try matching by room_id as number
      if (r.room_id !== undefined && r.room_id !== null) {
        if (Number(r.room_id) === idNum) return true;
      }
      // Try matching by id as number (fallback)
      if (r.id !== undefined && r.id !== null) {
        if (Number(r.id) === idNum) return true;
      }
      return false;
    });

    if (room) {
      return room.room_name || room.name || `Room ${roomId}`;
    }

    return `Room ${roomId}`;
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
    if (selectedOfferings.size === offerings.length && offerings.length > 0) {
      setSelectedOfferings(new Set());
    } else {
      setSelectedOfferings(new Set(offerings.map((o) => o.id)));
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

  const getConflictingOfferings = (roomId, scheduleType) => {
    return offerings.filter((offering) => {
      if (!roomId) return false;
      const offeringRoomIds = resolveRoomIds(offering, scheduleType);
      return offeringRoomIds.includes(Number(roomId));
    });
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

      if (!filterText) {
        try {
          const { rows } = await fetchCourseOfferings({ page: 1, limit: 100000 });
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
              items={notifications}
              onItemJump={focusNotificationItem}
              onItemEdit={editNotificationItem}
            />
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
              onClick={() => setPage(1)}
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
            <div className="relative group">
              <button
                className="btn-primary flex items-center gap-1 text-xs px-2 py-1"
                type="button"
                title="Column visibility"
              >
                <Settings size={14} />
                <span>Cols</span>
              </button>
              <div className="absolute right-0 top-full mt-2 hidden group-hover:flex flex-col bg-white border border-slate-200 rounded-lg shadow-2xl p-2 min-w-max z-[9999]">
                {columns.map((col) => (
                  <label
                    key={col.key}
                    className="flex items-center gap-2 px-3 py-2 text-xs text-on-surface hover:bg-primary/5 rounded cursor-pointer whitespace-nowrap"
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
              </div>
            </div>
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
          </div>
        </div>
      </div>

      {/* Controls: Search / Filter / Sort */}
      <div className="glass-panel space-y-2 p-3">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          {/* Search Input */}
          <div className="relative flex-1 xl:max-w-xs">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="text"
              placeholder="Search..."
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
              }}
              className="w-full rounded-lg border border-white/30 bg-white/50 py-1.5 pl-8 pr-3 text-xs text-on-surface placeholder-on-surface-variant/50 outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white focus:shadow-lg"
            />
          </div>

          {/* Column Filter and Reset */}
          <div className="flex flex-wrap gap-1 xl:justify-end">
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
        {successMessage && (
          <div className="flex items-center gap-1 rounded-lg bg-green-50 p-2 text-xs text-green-700">
            <Check size={14} />
            {successMessage}
          </div>
        )}
      </div>

      {/* Data Table - Compact */}
      <div className="glass-panel overflow-hidden flex-1">
        <div className="max-h-[calc(100vh-24rem)] overflow-auto">
          <table className="min-w-full w-full text-left text-xs">
            <thead>
                <tr className="sticky top-0 z-20 border-b border-white/20 bg-white/95 backdrop-blur">
                  <th className="px-3 py-2 text-center w-10">
                    <input
                      type="checkbox"
                      checked={offerings.length > 0 && selectedOfferings.size === offerings.length}
                      indeterminate={selectedOfferings.size > 0 && selectedOfferings.size < offerings.length ? true : undefined}
                      onChange={toggleSelectAll}
                      className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary/30"
                    />
                  </th>
                  {columns.map((col) => {
                    if (!visibleColumns.has(col.key)) return null;
                    return (
                      <th key={col.key} className="px-3 py-2 text-left">
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
                      <td key={col.key} className="px-3 py-2 truncate">
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
                            renderRoomPicker(col.key)
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
                          renderRoomPicker(col.key)
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
