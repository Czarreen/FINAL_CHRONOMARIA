import { useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpDown, DoorOpen, Plus, MapPin, Monitor, Maximize2, Trash2, Edit2, ChevronLeft, ChevronRight, X, Search, AlertCircle, Settings, RefreshCw, BookOpen } from 'lucide-react';
import { motion } from 'motion/react';
import { fetchRoomsPage, createRoom, updateRoom, deleteRoom, fetchRoomOfferings } from '../services/roomsApi.js';
import { fetchDepartments } from '../services/departmentsApi.js';
import { fetchRoomNotifications, rescanAllRoomNotifications, resolveRoomNotification } from '../services/notificationsApi.js';
import NotificationButton from '../components/NotificationButton.jsx';
import { highlightRowElement } from '../utils/highlightRow.js';

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

function inferRoomTypeFromOfferings(offerings) {
  const hasLabHours = Array.isArray(offerings) && offerings.some((offering) => Number(offering?.lab_hrs || 0) > 0);
  return hasLabHours ? 'Lab' : 'Lecture';
}

function parseRoomDepartmentIds(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return [];

  const values = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue)
        .split(/[\/,]/)
        .map((value) => value.trim());

  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}

export default function RoomsView({ authRefreshKey = 0 } = {}) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState(1);
  const PAGE_SIZE = 50;

  // Notification states
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [resolveMessage, setResolveMessage] = useState(null);
  const [resolveMessageType, setResolveMessageType] = useState(null); // 'success' or 'error'
  const [notificationSearch, setNotificationSearch] = useState('');
  const [notificationSeverityFilter, setNotificationSeverityFilter] = useState('all');
  const [notificationStats, setNotificationStats] = useState({ total: 0, critical: 0, medium: 0, low: 0 });
  const [refreshStatus, setRefreshStatus] = useState(null);

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
  const [pendingScrollToRoom, setPendingScrollToRoom] = useState(null);
  const [departments, setDepartments] = useState([]);

  // Info overlay states
  const [showAddInfo, setShowAddInfo] = useState(false);

  // Form state
  const [formData, setFormData] = useState({ room_name: '', room_type: '', room_status: 'available', department_ids: [] });
  const [formError, setFormError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'room_name', direction: 'asc' });
  const [selectedRooms, setSelectedRooms] = useState(new Set());
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Column visibility states
  const [visibleColumns, setVisibleColumns] = useState(
    new Set(['room_name', 'room_type', 'department_name', 'room_status'])
  );
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [colMenuPos, setColMenuPos] = useState({ top: 0, left: 0 });
  const colButtonRef = useRef(null);
  const colMenuRef = useRef(null);

  const clearRoomFiltersForJump = () => {
    setSearchQuery('');
    setStatusFilter('');
  };

  const columns = [
    { key: 'room_name', label: 'Room Name' },
    { key: 'room_type', label: 'Room Type' },
    { key: 'department_name', label: 'Department' },
    { key: 'room_status', label: 'Status' },
  ];

  const departmentsById = useMemo(() => {
    const map = new Map();
    departments.forEach((department) => {
      map.set(Number(department.department_id), department.department_name || `Department #${department.department_id}`);
    });
    return map;
  }, [departments]);

  const getRoomDepartmentLabel = (room) => {
    const ids = parseRoomDepartmentIds(room?.room_department_ids ?? room?.room_department_id);
    if (ids.length === 0) return '';

    return ids
      .map((id) => departmentsById.get(id) || `Department #${id}`)
      .join(', ');
  };

  const loadRooms = async ({ refreshNotifications = true, forceNotificationRescan = false } = {}) => {
    setLoading(true);
    try {
      const data = await fetchRoomsPage(1, 9999);
      const baseRows = Array.isArray(data.rows) ? data.rows : [];
      const rowsWithDerivedTypes = await Promise.all(
        baseRows.map(async (room) => {
          if (room.room_type && String(room.room_type).trim() !== '') {
            return room;
          }

          try {
            const offerings = await fetchRoomOfferings(room.room_id);
            const inferredType = inferRoomTypeFromOfferings(offerings);

            return {
              ...room,
              room_type: inferredType,
            };
          } catch (err) {
            console.error(`Failed to infer room type for room ${room.room_id}:`, err);
            return {
              ...room,
              room_type: 'Lecture',
            };
          }
        })
      );

      const roomsNeedingPersist = rowsWithDerivedTypes.filter((room) => {
        const originalRoom = baseRows.find((candidate) => candidate.room_id === room.room_id);
        const originalType = String(originalRoom?.room_type || '').trim();
        const derivedType = String(room.room_type || '').trim();
        return originalType !== derivedType && derivedType !== '';
      });

      if (roomsNeedingPersist.length > 0) {
        await Promise.allSettled(
          roomsNeedingPersist.map((room) =>
            updateRoom(room.room_id, {
              room_type: room.room_type,
            })
          )
        );
      }

      setRooms(rowsWithDerivedTypes);
      setError(null);
      setCurrentPage(1);

      if (refreshNotifications) {
        setRefreshStatus('Refreshing room issues...');
        await loadRoomNotifications(rowsWithDerivedTypes, { forceRescan: forceNotificationRescan });
        setRefreshStatus('Room issues refreshed');
        window.setTimeout(() => setRefreshStatus(null), 1800);
      }
    } catch (err) {
      console.error('Failed to fetch rooms:', err);
      setError(err.message);
      setRooms([]);
      setRefreshStatus(null);
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

  const loadRoomNotifications = async (roomList = rooms, { forceRescan = false } = {}) => {
    setNotificationsLoading(true);
    try {
      if (forceRescan) {
        await rescanAllRoomNotifications(true);
      }

      let data = await fetchRoomNotifications({ page: 1, limit: 200, unresolvedOnly: true });

      if (!forceRescan && (data.total ?? 0) === 0) {
        await rescanAllRoomNotifications(false);
        data = await fetchRoomNotifications({ page: 1, limit: 200, unresolvedOnly: true });
      }

      const rows = Array.isArray(data.rows) ? data.rows : [];
      const severityRank = { low: 1, medium: 2, critical: 3 };
      const normalizeSeverity = (value) => {
        if (!value) return 'medium';
        if (value === 'high') return 'critical';
        return value;
      };

      const roomsById = new Map(roomList.map((room) => [String(room.room_id), room]));
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
    loadRooms({ refreshNotifications: true, forceNotificationRescan: true });
  }, [authRefreshKey]);

  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const rows = await fetchDepartments();
        setDepartments(Array.isArray(rows) ? rows : []);
      } catch (err) {
        console.error('Failed to fetch departments:', err);
        setDepartments([]);
      }
    };

    loadDepartments();
  }, [authRefreshKey]);

  useEffect(() => {
    setPageInput(currentPage);
  }, [currentPage]);

  const applyPageInput = () => {
    const nextPage = Number(pageInput);
    if (Number.isInteger(nextPage) && nextPage >= 1) {
      setCurrentPage(nextPage);
    } else {
      setPageInput(currentPage);
    }
  };

  const { stats, totalPages, currentRooms, sortedFilteredRooms } = useMemo(() => {
    // Filter rooms by search query and status
    let filteredRooms = searchQuery.trim() === ''
      ? rooms
      : rooms.filter((r) => {
          const query = searchQuery.toLowerCase();
          return (
            (r.room_name || '').toLowerCase().includes(query) ||
            (r.room_type || '').toLowerCase().includes(query) ||
            getRoomDepartmentLabel(r).toLowerCase().includes(query) ||
            (r.room_status || '').toLowerCase().includes(query)
          );
        });

    // Apply status filter
    if (statusFilter) {
      filteredRooms = filteredRooms.filter((r) => r.room_status === statusFilter);
    }

    // Sort
    const directionMultiplier = sortConfig.direction === 'asc' ? 1 : -1;
    const getRoomSortValue = (room) => {
      switch (sortConfig.key) {
        case 'room_name': return String(room.room_name ?? '');
        case 'room_type': return String(room.room_type ?? '');
        case 'department_name': return getRoomDepartmentLabel(room);
        case 'room_status': return String(room.room_status ?? '');
        default: return String(room.room_name ?? '');
      }
    };
    const sorted = [...filteredRooms].sort(
      (left, right) =>
        String(getRoomSortValue(left)).localeCompare(
          String(getRoomSortValue(right)),
          undefined,
          { sensitivity: 'base' }
        ) * directionMultiplier
    );

    const totalRooms = sorted.length;
    const availableRooms = sorted.filter((r) => r.room_status === 'available').length;
    const roomTypeCount = new Set(sorted.map((r) => r.room_type || 'Unassigned')).size;

    // Calculate pagination
    const pages = Math.ceil(totalRooms / PAGE_SIZE);
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx = startIdx + PAGE_SIZE;
    const paginatedRooms = sorted.slice(startIdx, endIdx);

    return {
      stats: { totalRooms, availableRooms, roomTypeCount },
      totalPages: pages,
      currentRooms: paginatedRooms,
      sortedFilteredRooms: sorted,
    };
  }, [rooms, currentPage, searchQuery, statusFilter, PAGE_SIZE, sortConfig, departmentsById]);

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

  function handleSort(columnKey) {
    setSortConfig((currentSort) => ({
      key: columnKey,
      direction: currentSort.key === columnKey && currentSort.direction === 'asc' ? 'desc' : 'asc',
    }));
    setCurrentPage(1);
  }

  function sortHeaderClass(columnKey) {
    return `flex w-full items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.28em] transition-colors ${
      sortConfig.key === columnKey ? 'text-primary' : 'text-on-surface-variant/70 hover:text-on-surface'
    }`;
  }

  useLayoutEffect(() => {
    if (!pendingScrollToRoom?.id) return;

    highlightRowElement(pendingScrollToRoom.id, {
      scrollIntoView: true,
      severity: pendingScrollToRoom.severity,
      retry: true,
      maxWaitMs: 2500,
      pollIntervalMs: 16,
      onHighlighted: () => setPendingScrollToRoom(null),
    });
  }, [pendingScrollToRoom, currentRooms]);

  // Notification handlers
  function handleNotificationJump(item) {
    const rowElement = document.getElementById(`room-row-${item.room_id}`);
    if (rowElement) {
      highlightRowElement(item.room_id, { scrollIntoView: true, severity: item.severity || null, retry: true, maxWaitMs: 1200, pollIntervalMs: 16 });
      return;
    }

    // Clear filters first so the full sorted list is shown after navigation
    clearRoomFiltersForJump();

    // Find the room's position in the full sorted (unfiltered) list so the
    // page calculation matches what will be rendered after the filters clear.
    const dirMult = sortConfig.direction === 'asc' ? 1 : -1;
    const getSortVal = (room) => {
      switch (sortConfig.key) {
        case 'room_name': return String(room.room_name ?? '');
        case 'room_type': return String(room.room_type ?? '');
        case 'department_name': return getRoomDepartmentLabel(room);
        case 'room_status': return String(room.room_status ?? '');
        default: return String(room.room_name ?? '');
      }
    };
    const fullSorted = [...rooms].sort((a, b) =>
      String(getSortVal(a)).localeCompare(String(getSortVal(b)), undefined, { sensitivity: 'base' }) * dirMult
    );
    const roomIndex = fullSorted.findIndex((room) => room.room_id === item.room_id);
    if (roomIndex === -1) return;

    const targetPage = Math.max(1, Math.ceil((roomIndex + 1) / PAGE_SIZE));
    if (targetPage !== currentPage) {
      setCurrentPage(targetPage);
    }
    setPendingScrollToRoom({ id: item.room_id, severity: item.severity || null });
  }

  function handleNotificationEdit(item) {
    // Find the room by ID and open edit modal
    const room = rooms.find((r) => r.room_id === item.room_id);
    if (room) {
      handleEditClick(room);
      handleNotificationJump(item);
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
    setFormData({ room_name: '', room_type: '', room_status: 'available', department_ids: [] });
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
      department_ids: parseRoomDepartmentIds(room.room_department_ids ?? room.room_department_id),
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
        room_department_id: formData.department_ids,
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
        room_department_id: formData.department_ids,
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
    <div className="space-y-2 animate-in slide-in-from-right-4 duration-500">
      {refreshStatus && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-800">
          {refreshStatus}
        </div>
      )}
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
      <div className="glass-panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-on-surface">Available Rooms</h2>
          <p className="text-xs text-on-surface-variant">Manage campus facilities and their capacities.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-2 py-1">
            <NotificationButton
              buttonClassName="btn-primary border-none"
              items={filteredNotifications}
              title="Room Issues"
              emptyLabel="No room data quality issues detected"
              buttonLabel="Issues"
              isRescanning={notificationsLoading || loading}
              onItemEdit={handleNotificationEdit}
              onItemJump={handleNotificationJump}
              onItemResolve={handleResolveNotification}
              severityFilter={notificationSeverityFilter}
              onSeverityFilterChange={setNotificationSeverityFilter}
              notificationSearch={notificationSearch}
              onNotificationSearchChange={setNotificationSearch}
              notificationStats={notificationStats}
            />
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-primary shadow-sm">
              <DoorOpen size={14} />
              {stats.totalRooms} rooms
            </span>
            <button
              className="btn-primary inline-flex items-center gap-1.5 h-11 text-sm px-4 py-2"
              onClick={() => loadRooms({ refreshNotifications: true, forceNotificationRescan: true })}
              type="button"
              title="Reload data"
              disabled={loading || notificationsLoading}
            >
              <RefreshCw size={14} className={loading || notificationsLoading ? 'animate-spin' : ''} />
              <span>{loading || notificationsLoading ? 'Refreshing...' : 'Reload'}</span>
            </button>
            {selectedRooms.size > 0 && (
              <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-slate-900 shadow-sm">
                {selectedRooms.size} selected
              </span>
            )}
          </div>

          <button
            ref={colButtonRef}
            className="btn-primary inline-flex items-center gap-1.5 h-11 text-sm px-4 py-2"
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
          {selectedRooms.size > 0 && (
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700"
              onClick={handleBulkDelete}
              type="button"
            >
              <Trash2 size={14} />
              <span>Delete</span>
            </button>
          )}
          <button
            onClick={handleAddClick}
            className="btn-primary inline-flex items-center gap-1.5 text-xs px-3 py-2 h-11 min-w-11"
            type="button"
          >
            <Plus size={14} />
            <span>Add Room</span>
          </button>
        </div>
      </div>

      {/* Search and Filter Bar - Line 2 */}
      <div className="glass-panel p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {['', 'available', 'unavailable'].map((status) => (
              <button
                key={status}
                onClick={() => {
                  setStatusFilter(status);
                  setCurrentPage(1);
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
      </div>

      {/* Rooms Table */}
      {!loading && !error && rooms.length > 0 && (
        <div className="glass-panel overflow-hidden">
          <div className="max-h-[calc(100vh-18rem)] overflow-auto pb-4">
            <table className="min-w-full w-full border-collapse text-left text-sm">
              <thead>
                <tr className="sticky top-0 z-20 border-b border-slate-200 bg-white">
                  <th className="px-4 py-3 text-center w-10">
                    <input
                      type="checkbox"
                      checked={currentRooms.length > 0 && selectedRooms.size === currentRooms.length}
                      indeterminate={selectedRooms.size > 0 && selectedRooms.size < currentRooms.length ? true : undefined}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                    />
                  </th>
                  {columns.map((col) => {
                    if (!visibleColumns.has(col.key)) return null;
                    return (
                      <th key={col.key} className="px-4 py-3 text-left">
                        <button type="button" onClick={() => handleSort(col.key)} className={sortHeaderClass(col.key)}>
                          <span>{col.label}</span>
                          <ArrowUpDown size={12} />
                        </button>
                      </th>
                    );
                  })}
                  <th className="sticky right-0 z-30 bg-white px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.28em] text-on-surface-variant/70">Act</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {currentRooms.map((room, index) => {
                  const isSelected = selectedRooms.has(room.room_id);
                  return (
                    <tr key={room.room_id} id={`room-row-${room.room_id}`} className={`group transition-colors ${isSelected ? 'bg-primary/10' : 'hover:bg-slate-50'} ${index % 2 === 0 && !isSelected ? 'bg-white/6' : ''}`}>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRoom(room.room_id)}
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                        />
                      </td>
                      {columns.map((col) => {
                        if (!visibleColumns.has(col.key)) return null;
                        return (
                          <td key={col.key} className="px-4 py-3 align-top">
                            {col.key === 'room_name' ? (
                              <span className="inline-block rounded-md bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
                                {room.room_name || 'N/A'}
                              </span>
                            ) : col.key === 'room_type' ? (
                              <span className="text-sm font-medium text-on-surface">
                                {room.room_type || '—'}
                              </span>
                            ) : col.key === 'department_name' ? (
                              <span className="text-sm font-medium text-on-surface">
                                {getRoomDepartmentLabel(room) || '—'}
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
                      <td className="sticky right-0 z-10 bg-white px-4 py-3 text-center">
                        <div className="flex justify-center gap-2 opacity-80 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={() => handleEditClick(room)}
                            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:border-transparent hover:bg-primary/10 hover:text-primary"
                            type="button"
                            aria-label={`Edit ${room.room_name}`}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleViewSubjects(room)}
                            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:border-transparent hover:bg-indigo-50 hover:text-indigo-600"
                            type="button"
                            title="View scheduled offerings"
                          >
                            <BookOpen size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(room)}
                            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:border-transparent hover:bg-red-50 hover:text-red-600"
                            type="button"
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
                Showing {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, stats.totalRooms)} of {stats.totalRooms}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrevPage}
                  disabled={currentPage === 1}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-50"
                  type="button"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-50"
                  type="button"
                >
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
                    Department
                  </label>
                  <div className="max-h-36 space-y-2 overflow-auto rounded-lg border border-slate-300 bg-white p-3">
                    {departments.map((department) => {
                      const deptId = Number(department.department_id);
                      const isChecked = formData.department_ids.includes(deptId);

                      return (
                        <label key={department.department_id} className="flex cursor-pointer items-center gap-2 text-sm text-on-surface">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              setFormData((prev) => {
                                const current = new Set(prev.department_ids);
                                if (e.target.checked) current.add(deptId);
                                else current.delete(deptId);
                                return { ...prev, department_ids: Array.from(current) };
                              });
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                            disabled={isSubmitting}
                          />
                          <span>{department.department_name}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-xs text-on-surface-variant">Select one or more departments for this room.</p>
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
                    Department
                  </label>
                  <div className="max-h-36 space-y-2 overflow-auto rounded-lg border border-slate-300 bg-white p-3">
                    {departments.map((department) => {
                      const deptId = Number(department.department_id);
                      const isChecked = formData.department_ids.includes(deptId);

                      return (
                        <label key={department.department_id} className="flex cursor-pointer items-center gap-2 text-sm text-on-surface">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              setFormData((prev) => {
                                const current = new Set(prev.department_ids);
                                if (e.target.checked) current.add(deptId);
                                else current.delete(deptId);
                                return { ...prev, department_ids: Array.from(current) };
                              });
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                            disabled={isSubmitting}
                          />
                          <span>{department.department_name}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-xs text-on-surface-variant">Select one or more departments for this room.</p>
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
