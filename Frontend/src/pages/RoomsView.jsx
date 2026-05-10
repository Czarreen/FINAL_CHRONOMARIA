import { useEffect, useMemo, useState } from 'react';
import { DoorOpen, Plus, MapPin, Monitor, Maximize2, Trash2, Edit2, ChevronLeft, ChevronRight, X, Search, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { fetchRoomsPage, createRoom, updateRoom, deleteRoom } from '../services/roomsApi.js';
import { resolveRoomNotification } from '../services/notificationsApi.js';
import NotificationButton from '../components/NotificationButton.jsx';

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

  // Info overlay states
  const [showAddInfo, setShowAddInfo] = useState(false);

  // Form state
  const [formData, setFormData] = useState({ room_name: '', room_type: '', room_status: 'available' });
  const [formError, setFormError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

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

  const loadRoomNotifications = async () => {
    setNotificationsLoading(true);
    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
      const url = `${baseUrl}/api/notifications/rooms?is_resolved=false&limit=200`;
      console.log('Fetching room notifications from:', url);
      const response = await fetch(url);
      console.log('Response status:', response.status);
      if (!response.ok) throw new Error(`Failed to fetch room notifications: ${response.status}`);
      const data = await response.json();
      console.log('Full API response:', data);
      console.log('Rows array:', data.rows);
      console.log('Rows count:', data.rows ? data.rows.length : 0);
      console.log('Total from API:', data.total);
      
      // Transform API response into NotificationButton format
      // Group multiple issues from the same room into one notification
      const notificationMap = {};
      
      (data.rows || []).forEach((notification) => {
        const room = rooms.find((r) => r.room_id === notification.entity_id);
        const roomName = room ? room.room_name : `Room #${notification.entity_id}`;
        
        // Use the first issue's id as the notification id (we'll use the room_id as the key)
        const key = `room-${notification.entity_id}`;
        
        // Map severity from 'high' to 'critical' for UI display
        const mappedSeverity = notification.severity === 'high' ? 'critical' : (notification.severity || 'medium');
        
        if (!notificationMap[key]) {
          notificationMap[key] = {
            id: notification.id, // Store first issue's id
            title: roomName,
            severity: mappedSeverity,
            issues: [],
            room_id: notification.entity_id,
          };
        }
        
        // Map field names to more descriptive text
        let fieldLabel = notification.field_name || 'unknown';
        if (fieldLabel.toLowerCase().includes('name')) {
          fieldLabel = 'missing name';
        } else if (fieldLabel.toLowerCase().includes('type')) {
          fieldLabel = 'missing type';
        } else if (fieldLabel.toLowerCase().includes('status')) {
          fieldLabel = 'missing status';
        }
        
        // Add this issue to the issues array
        notificationMap[key].issues.push({
          field: fieldLabel,
          message: notification.message,
          type: notification.issue_type,
        });
      });
      
      // Convert map to array
      const transformedNotifications = Object.values(notificationMap);
      
      // Calculate stats by severity
      const stats = { total: transformedNotifications.length, critical: 0, medium: 0, low: 0 };
      transformedNotifications.forEach((notif) => {
        if (notif.severity === 'critical') stats.critical += 1;
        else if (notif.severity === 'medium') stats.medium += 1;
        else if (notif.severity === 'low') stats.low += 1;
      });
      
      console.log('Transformed notifications:', transformedNotifications);
      setNotifications(transformedNotifications);
      setNotificationStats(stats);
    } catch (err) {
      console.error('Failed to fetch room notifications:', err);
      setNotifications([]);
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

      // Check if all required fields are filled
      const hasName = room.room_name && room.room_name.trim() !== '';
      const hasType = room.room_type && room.room_type.trim() !== '';
      const hasStatus = room.room_status && room.room_status.trim() !== '';

      if (!hasName || !hasType || !hasStatus) {
        setResolveMessage('Issue is not yet Resolved');
        setResolveMessageType('error');
        setTimeout(() => setResolveMessage(null), 3000);
        return;
      }

      // All requirements met, resolve the notification
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
    <div className="space-y-gutter animate-in slide-in-from-right-4 duration-500">
      {resolveMessage && (
        <div className={`rounded-lg px-4 py-3 ${
          resolveMessageType === 'success'
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {resolveMessage}
        </div>
      )}
      {/* Header with stats */}
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-12">
        <div className="glass-panel col-span-1 flex items-center justify-between p-8 lg:col-span-8">
          <div className="space-y-1">
            <h2 className="text-headline-xl font-headline-xl text-on-surface">Available Rooms</h2>
            <p className="text-body-md text-on-surface-variant">Manage campus facilities and their capacities.</p>
          </div>
          <div className="flex gap-2">
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
            <button 
              onClick={handleAddClick}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={18} />
              <span>Add Room</span>
            </button>
          </div>
        </div>
        <div className="glass-panel flex flex-col items-center justify-center p-6 text-center">
          <DoorOpen size={24} className="text-primary" />
          <span className="mt-3 text-3xl font-bold text-on-surface">{stats.totalRooms}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Total Rooms</span>
        </div>
        <div className="glass-panel flex flex-col items-center justify-center p-6 text-center">
          <Maximize2 size={24} className="text-green-500" />
          <span className="mt-3 text-3xl font-bold text-on-surface">{stats.availableRooms}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Available</span>
        </div>
        <div className="glass-panel flex flex-col items-center justify-center p-6 text-center">
          <Monitor size={24} className="text-blue-500" />
          <span className="mt-3 text-3xl font-bold text-on-surface">{stats.roomTypeCount}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Room Types</span>
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
        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/20 bg-white/30">
                  <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-[0.28em] text-on-surface-variant/70">Room Name</th>
                  <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-[0.28em] text-on-surface-variant/70">Room Type</th>
                  <th className="px-6 py-4 text-center text-xs font-bold uppercase tracking-[0.28em] text-on-surface-variant/70">Status</th>
                  <th className="px-6 py-4 text-center text-xs font-bold uppercase tracking-[0.28em] text-on-surface-variant/70">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/20">
                {currentRooms.map((room, index) => (
                  <tr key={room.room_id} id={`room-row-${room.room_id}`} className={`border-b border-white/120 transition-colors hover:bg-white/100 ${index % 2 === 0 ? 'bg-white/6' : ''}`}>
                    <td className="px-6 py-4">
                      <span className="inline-block rounded-md bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                        {room.room_name || 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-on-surface">
                      {room.room_type || '—'}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex justify-center">
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
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => handleEditClick(room)}
                          className="rounded-md p-2 text-slate-400 transition-colors hover:bg-white hover:text-primary"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteClick(room)}
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
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-on-surface">Add New Room</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-on-surface"
              >
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                  disabled={isSubmitting}
                >
                  <option value="available">Available</option>
                  <option value="unavailable">Unavailable</option>
                  <option value="occupied">Occupied</option>
                </select>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={isSubmitting}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-on-surface transition-all hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 rounded-lg bg-primary px-4 py-2 font-medium text-white transition-all hover:bg-primary/90 disabled:opacity-50"
                >
                  {isSubmitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Room Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-on-surface">Edit Room</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-on-surface"
              >
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
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
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                  disabled={isSubmitting}
                >
                  <option value="available">Available</option>
                  <option value="unavailable">Unavailable</option>
                  <option value="occupied">Occupied</option>
                </select>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  disabled={isSubmitting}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-on-surface transition-all hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 rounded-lg bg-primary px-4 py-2 font-medium text-white transition-all hover:bg-primary/90 disabled:opacity-50"
                >
                  {isSubmitting ? 'Updating...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && deleteTargetRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-on-surface">Delete Room</h3>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-on-surface"
              >
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle size={16} />
                {formError}
              </div>
            )}

            <p className="mb-6 text-on-surface">
              Are you sure you want to delete <span className="font-bold">{deleteTargetRoom.room_name}</span>? This action cannot be undone.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={isSubmitting}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-on-surface transition-all hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isSubmitting}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 font-medium text-white transition-all hover:bg-red-700 disabled:opacity-50"
              >
                {isSubmitting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
