import { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DoorOpen, Plus, MapPin, Monitor, Maximize2, Trash2, Edit2, ChevronLeft, ChevronRight, X, Search, AlertCircle, Settings, RefreshCw, BookOpen } from 'lucide-react';
import { motion } from 'motion/react';
import { fetchRoomsPage, createRoom, updateRoom, deleteRoom, fetchRoomOfferings } from '../services/roomsApi.js';
import { fetchRoomNotifications, rescanAllRoomNotifications, resolveRoomNotification } from '../services/notificationsApi.js';
import NotificationButton from '../components/NotificationButton.jsx';

function parseStartMinutes(schedule) {
  if (!schedule) return Infinity;
  const match = schedule.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return Infinity;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const meridiem = match[3].toUpperCase();
  if (meridiem === 'PM' && h !== 12) h += 12;
  if (meridiem === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

function parseScheduleRange(schedule) {
  if (!schedule) return null;
  const match = schedule.match(/(\d+):(\d+)\s*(AM|PM)\s*-\s*(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return null;
  let sh = parseInt(match[1], 10);
  const sm = parseInt(match[2], 10);
  const smer = match[3].toUpperCase();
  let eh = parseInt(match[4], 10);
  const em = parseInt(match[5], 10);
  const emer = match[6].toUpperCase();
  if (smer === 'PM' && sh !== 12) sh += 12;
  if (smer === 'AM' && sh === 12) sh = 0;
  if (emer === 'PM' && eh !== 12) eh += 12;
  if (emer === 'AM' && eh === 12) eh = 0;
  return { start: sh * 60 + sm, end: eh * 60 + em };
}

function findConflictIds(offerings, scheduleKey) {
  const ids = new Set();
  for (let i = 0; i < offerings.length; i++) {
    for (let j = i + 1; j < offerings.length; j++) {
      const a = parseScheduleRange(offerings[i][scheduleKey]);
      const b = parseScheduleRange(offerings[j][scheduleKey]);
      if (a && b && a.start < b.end && b.start < a.end) {
        ids.add(offerings[i].id);
        ids.add(offerings[j].id);
      }
    }
  }
  return ids;
}

export default function RoomsView() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 50;

  // Notification states
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [resolveMessage, setResolveMessage] = useState(null);
  const [resolveMessageType, setResolveMessageType] = useState(null); // 'success' or 'error'
  const [notificationSearch, setNotificationSearch] = useState('');
  const [notificationSeverityFilter, setNotificationSeverityFilter] = useState('all');
  const [notificationStats, setNotificationStats] = useState({ total: 0, critical: 0, medium: 0, low: 0 });

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [deleteTargetRoom, setDeleteTargetRoom] = useState(null);

  // Subjects viewer modal states
  const [showSubjectsModal, setShowSubjectsModal] = useState(false);
  const [subjectsRoom, setSubjectsRoom] = useState(null);
  const [subjectsOfferings, setSubjectsOfferings] = useState([]);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [subjectCols, setSubjectCols] = useState(new Set(['code', 'course_no', 'descriptive_title', 'schedule']));
  const [subjectSort, setSubjectSort] = useState({ key: 'schedule', dir: 'asc' });

  // Info overlay states
  const [showAddInfo, setShowAddInfo] = useState(false);

  // Form state
  const [formData, setFormData] = useState({ room_name: '', room_type: '', room_status: 'available' });
  const [formError, setFormError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedRooms, setSelectedRooms] = useState(new Set());
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Column visibility states
  const [visibleColumns, setVisibleColumns] = useState(
    new Set(['room_name', 'room_type', 'room_status'])
  );
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [colMenuPos, setColMenuPos] = useState({ top: 0, left: 0 });
  const colButtonRef = useRef(null);
  const colMenuRef = useRef(null);

  const columns = [
    { key: 'room_name', label: 'Room Name' },
    { key: 'room_type', label: 'Room Type' },
    { key: 'room_status', label: 'Status' },
  ];

  const loadRooms = async () => {
    setLoading(true);
    try {
      const data = await fetchRoomsPage(1, 9999);
      setRooms(data.rows || []);
      setError(null);
      setCurrentPage(1);
    } catch (err) {
      console.error('Failed to fetch rooms:', err);
      setError(err.message);
      setRooms([]);
    } finally {
      setLoading(false);
    }
  };

  // Handle column menu positioning and click outside
  useEffect(() => {
    if (!colMenuOpen) return;

    const updatePosition = () => {
      if (!colButtonRef.current) return;
      const rect = colButtonRef.current.getBoundingClientRect();
      setColMenuPos({
        top: rect.bottom + 8,
        left: rect.right - 180,
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

  const toggleSelectRoom = (roomId) => {
    setSelectedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) {
        next.delete(roomId);
      } else {
        next.add(roomId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedRooms.size === currentRooms.length && currentRooms.length > 0) {
      setSelectedRooms(new Set());
    } else {
      setSelectedRooms(new Set(currentRooms.map((r) => r.room_id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedRooms.size === 0) return;
    setConfirmDialog({
      title: `Delete ${selectedRooms.size} room(s)?`,
      message: 'This action cannot be undone.',
      confirmLabel: 'Delete All',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        try {
          const deletePromises = Array.from(selectedRooms).map((id) =>
            deleteRoom(id)
          );
          await Promise.all(deletePromises);
          setSelectedRooms(new Set());
          await loadRooms();
          await loadRoomNotifications();
        } catch (err) {
          console.error('Failed to delete rooms:', err);
        } finally {
          setConfirmDialog(null);
        }
      },
    });
  };

  const loadRoomNotifications = async () => {
    setNotificationsLoading(true);
    try {
      let data = await fetchRoomNotifications({ page: 1, limit: 200, unresolvedOnly: true });

      if ((data.total ?? 0) === 0) {
        await rescanAllRoomNotifications();
        data = await fetchRoomNotifications({ page: 1, limit: 200, unresolvedOnly: true });
      }

      const rows = Array.isArray(data.rows) ? data.rows : [];
      const severityRank = { low: 1, medium: 2, critical: 3 };
      const normalizeSeverity = (value) => {
        if (!value) return 'medium';
        if (value === 'high') return 'critical';
        return value;
      };

      const roomsById = new Map(rooms.map((room) => [String(room.room_id), room]));
      const grouped = new Map();

      rows.forEach((row) => {
        const roomId = row.entity_id ?? row.room_id;
        if (roomId == null) return;

        const key = String(roomId);
        const room = roomsById.get(key);
        const issueSeverity = normalizeSeverity(row.severity);
        const fieldName = row.field_name || row.field || null;
        const issue = {
          field: fieldName,
          field_name: fieldName,
          message: row.message || '',
          issue_type: row.issue_type || 'missing',
          severity: issueSeverity,
          details: row.details || null,
        };

        const existing = grouped.get(key) || {
          id: roomId,
          room_id: roomId,
          title: room?.room_name || row.title || `Room #${roomId}`,
          description: room?.room_type || row.description || '',
          severity: issueSeverity,
          missingFields: [],
          issues: [],
        };

        if (fieldName && issue.issue_type === 'missing' && !existing.missingFields.includes(fieldName)) {
          existing.missingFields.push(fieldName);
        }

        existing.issues.push(issue);
        if (severityRank[issueSeverity] > severityRank[existing.severity] || !existing.severity) {
          existing.severity = issueSeverity;
        }

        grouped.set(key, existing);
      });

      const transformedNotifications = Array.from(grouped.values()).sort(
        (a, b) => Number(a.room_id) - Number(b.room_id)
      );

      const stats = { total: transformedNotifications.length, critical: 0, medium: 0, low: 0 };
      transformedNotifications.forEach((notif) => {
        if (notif.severity === 'critical') stats.critical += 1;
        else if (notif.severity === 'medium') stats.medium += 1;
        else if (notif.severity === 'low') stats.low += 1;
      });

      setNotifications(transformedNotifications);
      setNotificationStats(stats);
    } catch (err) {
      console.error('Failed to fetch room notifications:', err);
      setNotifications([]);
      setNotificationStats({ total: 0, critical: 0, medium: 0, low: 0 });
    } finally {
      setNotificationsLoading(false);
    }
  };

  useEffect(() => {
    loadRooms();
  }, []);

  // Reload notifications after rooms are loaded (needed to map room names)
  useEffect(() => {
    if (rooms.length > 0) {
      loadRoomNotifications();
    }
  }, [rooms.length]);

  const { stats, totalPages, currentRooms } = useMemo(() => {
    // Filter rooms by search query and status
    let filteredRooms = searchQuery.trim() === '' 
      ? rooms 
      : rooms.filter((r) => {
        const query = searchQuery.toLowerCase();
        return (
          (r.room_name || '').toLowerCase().includes(query) ||
          (r.room_type || '').toLowerCase().includes(query) ||
          (r.room_status || '').toLowerCase().includes(query)
        );
      });

    // Apply status filter
    if (statusFilter) {
      filteredRooms = filteredRooms.filter((r) => r.room_status === statusFilter);
    }

    const totalRooms = filteredRooms.length;
    const availableRooms = filteredRooms.filter((r) => r.room_status === 'available').length;
    const roomTypeCount = new Set(filteredRooms.map(r => r.room_type || 'Unassigned')).size;
    
    // Calculate pagination
    const pages = Math.ceil(totalRooms / PAGE_SIZE);
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx = startIdx + PAGE_SIZE;
    const paginatedRooms = filteredRooms.slice(startIdx, endIdx);

    return {
      stats: { totalRooms, availableRooms, roomTypeCount },
      totalPages: pages,
      currentRooms: paginatedRooms,
    };
  }, [rooms, currentPage, searchQuery, statusFilter, PAGE_SIZE]);

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
          (notif.room_id || '').toString().includes(searchLower)
      );
    }
    return filtered;
  }, [notifications, notificationSeverityFilter, notificationSearch]);

  const { mthOfferings, tfsOfferings, conflictMthIds, conflictTfsIds } = useMemo(() => {
    if (!subjectsRoom) return { mthOfferings: [], tfsOfferings: [], conflictMthIds: new Set(), conflictTfsIds: new Set() };
    const rid = String(subjectsRoom.room_id);
    const containsRoom = (field) => {
      if (!field) return false;
      return field === rid || field.startsWith(`${rid}/`) || field.endsWith(`/${rid}`) || field.includes(`/${rid}/`);
    };

    const applySortAndFilter = (list, scheduleKey) => {
      const filtered = list.filter((o) => containsRoom(o[scheduleKey === 'mth_schedule' ? 'mth_room_id' : 'tfs_room_id']));
      return [...filtered].sort((a, b) => {
        let aVal, bVal;
        if (subjectSort.key === 'schedule') {
          aVal = parseStartMinutes(a[scheduleKey]);
          bVal = parseStartMinutes(b[scheduleKey]);
        } else {
          aVal = (a[subjectSort.key] || '').toLowerCase();
          bVal = (b[subjectSort.key] || '').toLowerCase();
        }
        if (aVal < bVal) return subjectSort.dir === 'asc' ? -1 : 1;
        if (aVal > bVal) return subjectSort.dir === 'asc' ? 1 : -1;
        return 0;
      });
    };

    const mth = applySortAndFilter(subjectsOfferings, 'mth_schedule');
    const tfs = applySortAndFilter(subjectsOfferings, 'tfs_schedule');

    return {
      mthOfferings: mth,
      tfsOfferings: tfs,
      conflictMthIds: findConflictIds(mth, 'mth_schedule'),
      conflictTfsIds: findConflictIds(tfs, 'tfs_schedule'),
    };
  }, [subjectsOfferings, subjectsRoom, subjectSort]);

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(1, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages, prev + 1));
  };

  // Notification handlers
  function handleNotificationJump(item) {
    const rowElement = document.getElementById(`room-row-${item.room_id}`);
    if (rowElement) {
      rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      rowElement.classList.add('animate-pulse');
      setTimeout(() => rowElement.classList.remove('animate-pulse'), 2000);
    }
  }

  function handleNotificationEdit(item) {
    // Find the room by ID and open edit modal
    const room = rooms.find((r) => r.room_id === item.room_id);
    if (room) {
      handleEditClick(room);
      // Scroll to the room row
      const rowElement = document.getElementById(`room-row-${item.room_id}`);
      if (rowElement) {
        rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  async function handleResolveNotification(item) {
    try {
      // Find the actual room data
      const room = rooms.find((r) => r.room_id === item.room_id);
      
      if (!room) {
        setResolveMessage('Room not found');
        setResolveMessageType('error');
        setTimeout(() => setResolveMessage(null), 3000);
        return;
      }

      // Check if all issues reported in the notification have been resolved
      const missingFields = Array.isArray(item.missingFields) ? item.missingFields : [];
      const issues = Array.isArray(item.issues) ? item.issues : [];

      // Validate that all missing fields are now filled
      for (const field of missingFields) {
        const value = room[field];
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          setResolveMessage(`Field "${field}" is still missing`);
          setResolveMessageType('error');
          setTimeout(() => setResolveMessage(null), 3000);
          return;
        }
      }

      // If there are specific issues, ensure they're addressed
      if (issues.length > 0) {
        // Verify room has basic required data to resolve issues
        const hasName = room.room_name && room.room_name.trim() !== '';
        const hasType = room.room_type && room.room_type.trim() !== '';
        const hasStatus = room.room_status && room.room_status.trim() !== '';

        if (!hasName || !hasType || !hasStatus) {
          setResolveMessage('Complete room information required to resolve issues');
          setResolveMessageType('error');
          setTimeout(() => setResolveMessage(null), 3000);
          return;
        }
      }

      // All issues have been resolved, mark the notification as resolved
      await resolveRoomNotification(item.id);
      setResolveMessage('Issue resolved successfully!');
      setResolveMessageType('success');
      // Reload notifications after resolving
      await loadRoomNotifications();
      // Clear message after 3 seconds
      setTimeout(() => setResolveMessage(null), 3000);
    } catch (err) {
      console.error('Failed to resolve notification:', err);
      setResolveMessage('Issue is not yet Resolved');
      setResolveMessageType('error');
      // Clear message after 3 seconds
      setTimeout(() => setResolveMessage(null), 3000);
    }
  }

  // Form handlers
  const resetForm = () => {
    setFormData({ room_name: '', room_type: '', room_status: 'available' });
    setFormError(null);
  };

  const handleAddClick = () => {
    resetForm();
    setShowAddModal(true);
  };

  const handleEditClick = (room) => {
    setEditingRoom(room);
    setFormData({
      room_name: room.room_name,
      room_type: room.room_type || '',
      room_status: room.room_status || 'available',
    });
    setFormError(null);
    setShowEditModal(true);
  };

  const handleDeleteClick = (room) => {
    setDeleteTargetRoom(room);
    setShowDeleteModal(true);
  };

  const handleViewSubjects = async (room) => {
    setSubjectsRoom(room);
    setSubjectsOfferings([]);
    setSubjectsLoading(true);
    setShowSubjectsModal(true);
    try {
      const rows = await fetchRoomOfferings(room.room_id);
      setSubjectsOfferings(rows);
    } catch (err) {
      console.error('Failed to fetch room offerings:', err);
    } finally {
      setSubjectsLoading(false);
    }
  };

  const toggleSubjectCol = (col) => {
    setSubjectCols((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };

  const handleSubjectSort = (key) => {
    setSubjectSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    );
  };

  // CRUD handlers
  const handleAddRoom = async (e) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    try {
      if (!formData.room_name.trim()) {
        setFormError('Room name is required');
        setIsSubmitting(false);
        return;
      }

      const newRoom = await createRoom({
        room_name: formData.room_name,
        room_type: formData.room_type || null,
        room_status: formData.room_status,
      });

      setRooms([...rooms, newRoom]);
      setShowAddModal(false);
      resetForm();
      await loadRoomNotifications();
    } catch (err) {
      console.error('Failed to create room:', err);
      setFormError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateRoom = async (e) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    try {
      if (!formData.room_name.trim()) {
        setFormError('Room name is required');
        setIsSubmitting(false);
        return;
      }

      const updatedRoom = await updateRoom(editingRoom.room_id, {
        room_name: formData.room_name,
        room_type: formData.room_type || null,
        room_status: formData.room_status,
      });

      setRooms(rooms.map((r) => (r.room_id === editingRoom.room_id ? updatedRoom : r)));
      setShowEditModal(false);
      setEditingRoom(null);
      resetForm();
      await loadRoomNotifications();
    } catch (err) {
      console.error('Failed to update room:', err);
      setFormError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    setFormError(null);
    setIsSubmitting(true);

    try {
      await deleteRoom(deleteTargetRoom.room_id);
      setRooms(rooms.filter((r) => r.room_id !== deleteTargetRoom.room_id));
      setShowDeleteModal(false);
      setDeleteTargetRoom(null);
      await loadRoomNotifications();
    } catch (err) {
      console.error('Failed to delete room:', err);
      setFormError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-2 animate-in slide-in-from-right-4 duration-500 p-3 flex flex-col h-screen">
      {resolveMessage && (
        <div className={`rounded-lg px-4 py-3 ${
          resolveMessageType === 'success'
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {resolveMessage}
        </div>
      )}
      {/* Header with stats - Line 1: Title, stats, and action buttons */}
      <div className="glass-panel p-3">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-on-surface">Available Rooms</h2>
            <p className="text-xs text-on-surface-variant">Manage campus facilities and their capacities.</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <NotificationButton
              items={filteredNotifications}
              title="Room Issues"
              emptyLabel="No room data quality issues detected"
              buttonLabel="Issues"
              onItemEdit={handleNotificationEdit}
              onItemJump={handleNotificationJump}
              onItemResolve={handleResolveNotification}
              severityFilter={notificationSeverityFilter}
              onSeverityFilterChange={setNotificationSeverityFilter}
              notificationSearch={notificationSearch}
              onNotificationSearchChange={setNotificationSearch}
              notificationStats={notificationStats}
            />
            <span className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/70 px-2 py-1 text-[10px] font-semibold text-on-surface-variant backdrop-blur">
              <DoorOpen size={12} className="text-primary" />
              {stats.totalRooms}
            </span>
            {selectedRooms.size > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/60 bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary backdrop-blur">
                {selectedRooms.size} sel
              </span>
            )}
            <button
              className="btn-primary flex items-center gap-1 text-xs px-2 py-1"
              onClick={loadRooms}
              type="button"
              title="Reload data"
            >
              <RefreshCw size={14} />
              <span>Reload</span>
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
            {selectedRooms.size > 0 && (
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
              onClick={handleAddClick}
              className="btn-primary flex items-center gap-1 text-xs px-2 py-1"
            >
              <Plus size={14} />
              <span>Add Room</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search and Filter Bar - Line 2 */}
      <div className="glass-panel space-y-4 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Search Input */}
          <div className="relative flex-1 md:max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
            <input
              type="text"
              placeholder="Search by name, type or status..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full rounded-lg border border-white/30 bg-white/50 py-2 pl-10 pr-4 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none transition-all hover:bg-white/60 focus:border-primary focus:bg-white focus:shadow-lg"
            />
          </div>

          {/* Status Filter */}
          <div className="flex gap-2">
            {['', 'available', 'unavailable'].map((status) => (
              <button
                key={status}
                onClick={() => {
                  setStatusFilter(status);
                  setCurrentPage(1);
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
      </div>

      {/* Rooms Table */}
      {!loading && !error && rooms.length > 0 && (
        <div className="glass-panel overflow-hidden flex-1">
          <div className="max-h-[calc(100vh-24rem)] overflow-auto pb-8">
            <table className="min-w-full w-full text-left text-xs">
              <thead>
                <tr className="sticky top-0 z-20 border-b border-white/20 bg-white/95 backdrop-blur">
                  <th className="px-3 py-2 text-center w-10">
                    <input
                      type="checkbox"
                      checked={currentRooms.length > 0 && selectedRooms.size === currentRooms.length}
                      indeterminate={selectedRooms.size > 0 && selectedRooms.size < currentRooms.length ? true : undefined}
                      onChange={toggleSelectAll}
                      className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary/30"
                    />
                  </th>
                  {columns.map((col) => {
                    if (!visibleColumns.has(col.key)) return null;
                    return (
                      <th key={col.key} className="px-6 py-4 text-left">
                        <span className="text-xs font-bold uppercase tracking-[0.28em] text-on-surface-variant/70">
                          {col.label}
                        </span>
                      </th>
                    );
                  })}
                  <th className="sticky right-0 z-30 bg-white/95 px-6 py-4 text-center text-xs font-bold uppercase tracking-[0.28em] text-on-surface-variant/70 backdrop-blur">Act</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/20">
                {currentRooms.map((room, index) => (
                  <tr key={room.room_id} id={`room-row-${room.room_id}`} className={`transition-colors hover:bg-white/45 ${index % 2 === 0 ? 'bg-white/6' : ''}`}>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={selectedRooms.has(room.room_id)}
                        onChange={() => toggleSelectRoom(room.room_id)}
                        className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary/30"
                      />
                    </td>
                    {columns.map((col) => {
                      if (!visibleColumns.has(col.key)) return null;
                      return (
                        <td key={col.key} className="px-6 py-4">
                          {col.key === 'room_name' ? (
                            <span className="inline-block rounded-md bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                              {room.room_name || 'N/A'}
                            </span>
                          ) : col.key === 'room_type' ? (
                            <span className="text-sm font-medium text-on-surface">
                              {room.room_type || '—'}
                            </span>
                          ) : col.key === 'room_status' ? (
                            <div className="flex justify-start">
                              <span
                                className={`badge ${
                                  room.room_status === 'available'
                                    ? 'badge-success'
                                    : room.room_status === 'unavailable'
                                    ? 'badge-warning'
                                    : 'badge-error'
                                }`}
                              >
                                {room.room_status || 'N/A'}
                              </span>
                            </div>
                          ) : null}
                        </td>
                      );
                    })}
                    <td className="sticky right-0 z-10 bg-white/90 px-6 py-4 text-center backdrop-blur">
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => handleEditClick(room)}
                          className="rounded-md bg-white/30 p-2 text-slate-400 transition-colors hover:bg-white hover:text-primary"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleViewSubjects(room)}
                          className="rounded-md bg-white/30 p-2 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                          title="View scheduled offerings"
                        >
                          <BookOpen size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteClick(room)}
                          className="rounded-md bg-white/30 p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
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
                Page {currentPage} of {totalPages}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handlePrevPage}
                  disabled={currentPage === 1}
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
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`rounded-lg px-3 py-2 text-sm font-bold transition-all ${
                          pageNum === currentPage
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
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages}
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
      {!loading && !error && rooms.length === 0 && (
        <div className="glass-panel flex flex-col items-center justify-center py-16 text-center">
          <DoorOpen size={48} className="text-on-surface-variant/30" />
          <p className="mt-4 text-lg font-bold text-on-surface">No rooms found</p>
          <p className="mt-1 text-sm text-on-surface-variant">
            {searchQuery || statusFilter ? 'Try adjusting your filters' : 'Create your first room to get started'}
          </p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="glass-panel flex flex-col items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary"></div>
          <p className="mt-4 text-on-surface-variant">Loading rooms...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="glass-panel flex items-center gap-3 rounded-lg bg-red-50 p-4 text-red-700">
          <AlertCircle size={20} />
          <div>
            <p className="font-bold">Error loading rooms</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Add Room Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/20 bg-primary px-6 py-4">
              <h3 className="text-lg font-bold text-white">Add New Room</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {formError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle size={16} />
                  {formError}
                </div>
              )}

              <form onSubmit={handleAddRoom} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Room Name *
                  </label>
                  <input
                    type="text"
                    value={formData.room_name}
                    onChange={(e) => setFormData({ ...formData, room_name: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g., Room 101"
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Room Type
                  </label>
                  <input
                    type="text"
                    value={formData.room_type}
                    onChange={(e) => setFormData({ ...formData, room_type: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g., Lecture Hall"
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Status
                  </label>
                  <select
                    value={formData.room_status}
                    onChange={(e) => setFormData({ ...formData, room_status: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    disabled={isSubmitting}
                  >
                    <option value="available">Available</option>
                    <option value="unavailable">Unavailable</option>
                    <option value="occupied">Occupied</option>
                  </select>
                </div>

                <div className="flex gap-3 pt-6">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    disabled={isSubmitting}
                    className="flex-1 rounded-lg border border-white/60 bg-white px-4 py-2.5 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isSubmitting ? 'Creating...' : 'Create Room'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Room Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/20 bg-primary px-6 py-4">
              <h3 className="text-lg font-bold text-white">Edit Room</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {formError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle size={16} />
                  {formError}
                </div>
              )}

              <form onSubmit={handleUpdateRoom} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Room Name *
                  </label>
                  <input
                    type="text"
                    value={formData.room_name}
                    onChange={(e) => setFormData({ ...formData, room_name: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g., Room 101"
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Room Type
                  </label>
                  <input
                    type="text"
                    value={formData.room_type}
                    onChange={(e) => setFormData({ ...formData, room_type: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g., Lecture Hall"
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    Status
                  </label>
                  <select
                    value={formData.room_status}
                    onChange={(e) => setFormData({ ...formData, room_status: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    disabled={isSubmitting}
                  >
                    <option value="available">Available</option>
                    <option value="unavailable">Unavailable</option>
                    <option value="occupied">Occupied</option>
                  </select>
                </div>

                <div className="flex gap-3 pt-6">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    disabled={isSubmitting}
                    className="flex-1 rounded-lg border border-white/60 bg-white px-4 py-2.5 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 rounded-lg bg-primary px-4 py-2.5 font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isSubmitting ? 'Updating...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && deleteTargetRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/20 bg-red-600 px-6 py-4">
              <h3 className="text-lg font-bold text-white">Delete Room</h3>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {formError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle size={16} />
                  {formError}
                </div>
              )}

              <p className="text-on-surface">
                Are you sure you want to delete <span className="font-bold">{deleteTargetRoom.room_name}</span>? This action cannot be undone.
              </p>

              <div className="flex gap-3 pt-6">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isSubmitting}
                  className="flex-1 rounded-lg border border-white/60 bg-white px-4 py-2.5 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isSubmitting}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {isSubmitting ? 'Deleting...' : 'Delete Room'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/20 bg-red-600 px-6 py-4">
              <h3 className="text-lg font-bold text-white">{confirmDialog.title}</h3>
              <button
                onClick={() => setConfirmDialog(null)}
                className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-on-surface">
                {confirmDialog.message}
              </p>

              <div className="flex gap-3 pt-6">
                <button
                  type="button"
                  onClick={() => setConfirmDialog(null)}
                  className="flex-1 rounded-lg border border-white/60 bg-white px-4 py-2.5 font-semibold text-on-surface-variant transition-colors hover:bg-slate-50"
                >
                  {confirmDialog.cancelLabel}
                </button>
                <button
                  type="button"
                  onClick={confirmDialog.onConfirm}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-red-700"
                >
                  {confirmDialog.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subjects Modal */}
      {showSubjectsModal && subjectsRoom && (() => {
        const totalConflicts = conflictMthIds.size + conflictTfsIds.size;
        const sortCols = [
          { key: 'code', label: 'Code' },
          { key: 'course_no', label: 'Course No' },
          { key: 'descriptive_title', label: 'Description' },
          { key: 'schedule', label: 'Schedule' },
        ];
        const sortIndicator = (key) => {
          if (subjectSort.key !== key) return <span className="ml-1 text-[10px] text-indigo-300">↕</span>;
          return <span className="ml-1 text-[10px]">{subjectSort.dir === 'asc' ? '↑' : '↓'}</span>;
        };
        const mthThClass = (key) =>
          `px-3 py-2 text-left font-bold cursor-pointer select-none transition-colors hover:bg-indigo-50 ${subjectSort.key === key ? 'text-indigo-900' : 'text-indigo-700'}`;
        const tfsThClass = (key) =>
          `px-3 py-2 text-left font-bold cursor-pointer select-none transition-colors hover:bg-amber-50 ${subjectSort.key === key ? 'text-amber-900' : 'text-amber-700'}`;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
            <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/20 bg-indigo-600 px-6 py-4">
                <div className="flex items-center gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-white">{subjectsRoom.room_name}</h3>
                    <p className="text-indigo-200 text-xs mt-0.5">Scheduled Course Offerings</p>
                  </div>
                  {totalConflicts > 0 && !subjectsLoading && (
                    <span className="rounded-full bg-red-500 px-2.5 py-0.5 text-[11px] font-bold text-white">
                      {totalConflicts} conflict{totalConflicts !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowSubjectsModal(false)}
                  className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Column toggle pills */}
              <div className="flex flex-wrap items-center gap-1.5 px-6 pt-4 pb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Cols:</span>
                {[
                  { key: 'code', label: 'Code' },
                  { key: 'course_no', label: 'Course No' },
                  { key: 'descriptive_title', label: 'Description' },
                  { key: 'schedule', label: 'Schedule' },
                ].map((col) => (
                  <button
                    key={col.key}
                    onClick={() => toggleSubjectCol(col.key)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      subjectCols.has(col.key)
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {col.label}
                  </button>
                ))}
                {totalConflicts > 0 && !subjectsLoading && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-red-600">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-200 border border-red-400"></span>
                    = schedule conflict
                  </span>
                )}
              </div>

              <div className="overflow-y-auto flex-1 px-6 pb-6">
                {subjectsLoading ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600"></div>
                    <p className="mt-4 text-sm text-on-surface-variant">Loading offerings...</p>
                  </div>
                ) : subjectsOfferings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <BookOpen size={40} className="text-slate-300" />
                    <p className="mt-3 text-sm font-semibold text-on-surface">No offerings scheduled in this room</p>
                  </div>
                ) : (
                  <>
                    {/* MTh Section */}
                    <div className="mt-4">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-2">
                        Mon / Thu
                        {conflictMthIds.size > 0 && (
                          <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600">{conflictMthIds.size} conflict{conflictMthIds.size !== 1 ? 's' : ''}</span>
                        )}
                      </h4>
                      {mthOfferings.length === 0 ? (
                        <p className="text-xs text-slate-400 pl-2">None</p>
                      ) : (
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr className="border-b border-indigo-100">
                              {subjectCols.has('code') && (
                                <th className={mthThClass('code')} onClick={() => handleSubjectSort('code')}>
                                  Code{sortIndicator('code')}
                                </th>
                              )}
                              {subjectCols.has('course_no') && (
                                <th className={mthThClass('course_no')} onClick={() => handleSubjectSort('course_no')}>
                                  Course No{sortIndicator('course_no')}
                                </th>
                              )}
                              {subjectCols.has('descriptive_title') && (
                                <th className={mthThClass('descriptive_title')} onClick={() => handleSubjectSort('descriptive_title')}>
                                  Description{sortIndicator('descriptive_title')}
                                </th>
                              )}
                              {subjectCols.has('schedule') && (
                                <th className={mthThClass('schedule')} onClick={() => handleSubjectSort('schedule')}>
                                  Schedule{sortIndicator('schedule')}
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-indigo-50">
                            {mthOfferings.map((o) => {
                              const isConflict = conflictMthIds.has(o.id);
                              return (
                                <tr key={`mth-${o.id}`} className={isConflict ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-indigo-50/40'}>
                                  {subjectCols.has('code') && (
                                    <td className={`px-3 py-2 font-medium ${isConflict ? 'text-red-700' : 'text-on-surface'}`}>
                                      {o.code || '—'}
                                      {isConflict && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle"></span>}
                                    </td>
                                  )}
                                  {subjectCols.has('course_no') && <td className={`px-3 py-2 ${isConflict ? 'text-red-600' : 'text-on-surface-variant'}`}>{o.course_no || '—'}</td>}
                                  {subjectCols.has('descriptive_title') && <td className={`px-3 py-2 ${isConflict ? 'text-red-600' : 'text-on-surface-variant'}`}>{o.descriptive_title || '—'}</td>}
                                  {subjectCols.has('schedule') && <td className={`px-3 py-2 ${isConflict ? 'text-red-600 font-semibold' : 'text-on-surface-variant'}`}>{o.mth_schedule || '—'}</td>}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>

                    {/* TFS Section */}
                    <div className="mt-6">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-2">
                        Tue / Fri / Sat
                        {conflictTfsIds.size > 0 && (
                          <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600">{conflictTfsIds.size} conflict{conflictTfsIds.size !== 1 ? 's' : ''}</span>
                        )}
                      </h4>
                      {tfsOfferings.length === 0 ? (
                        <p className="text-xs text-slate-400 pl-2">None</p>
                      ) : (
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr className="border-b border-amber-100">
                              {subjectCols.has('code') && (
                                <th className={tfsThClass('code')} onClick={() => handleSubjectSort('code')}>
                                  Code{sortIndicator('code')}
                                </th>
                              )}
                              {subjectCols.has('course_no') && (
                                <th className={tfsThClass('course_no')} onClick={() => handleSubjectSort('course_no')}>
                                  Course No{sortIndicator('course_no')}
                                </th>
                              )}
                              {subjectCols.has('descriptive_title') && (
                                <th className={tfsThClass('descriptive_title')} onClick={() => handleSubjectSort('descriptive_title')}>
                                  Description{sortIndicator('descriptive_title')}
                                </th>
                              )}
                              {subjectCols.has('schedule') && (
                                <th className={tfsThClass('schedule')} onClick={() => handleSubjectSort('schedule')}>
                                  Schedule{sortIndicator('schedule')}
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-amber-50">
                            {tfsOfferings.map((o) => {
                              const isConflict = conflictTfsIds.has(o.id);
                              return (
                                <tr key={`tfs-${o.id}`} className={isConflict ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-amber-50/40'}>
                                  {subjectCols.has('code') && (
                                    <td className={`px-3 py-2 font-medium ${isConflict ? 'text-red-700' : 'text-on-surface'}`}>
                                      {o.code || '—'}
                                      {isConflict && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle"></span>}
                                      {o.tfs_schedule?.toLowerCase().includes('sat') && (
                                        <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Sat</span>
                                      )}
                                    </td>
                                  )}
                                  {subjectCols.has('course_no') && <td className={`px-3 py-2 ${isConflict ? 'text-red-600' : 'text-on-surface-variant'}`}>{o.course_no || '—'}</td>}
                                  {subjectCols.has('descriptive_title') && <td className={`px-3 py-2 ${isConflict ? 'text-red-600' : 'text-on-surface-variant'}`}>{o.descriptive_title || '—'}</td>}
                                  {subjectCols.has('schedule') && <td className={`px-3 py-2 ${isConflict ? 'text-red-600 font-semibold' : 'text-on-surface-variant'}`}>{o.tfs_schedule || '—'}</td>}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="flex justify-end border-t border-slate-100 px-6 py-4">
                <button
                  onClick={() => setShowSubjectsModal(false)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-on-surface hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
