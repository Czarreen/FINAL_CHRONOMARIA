import { useEffect, useMemo, useState } from 'react';
import { DoorOpen, Plus, MapPin, Monitor, Maximize2, Trash2, Edit2, ChevronLeft, ChevronRight, X, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { fetchRoomsPage, createRoom, updateRoom, deleteRoom } from '../services/roomsApi.js';
import { resolveRoomNotification } from '../services/notificationsApi.js';
import { createAuditLog, buildChangeSummary } from '../services/auditLogsApi.js';
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
      createAuditLog({ action: 'Created room', module: 'Rooms', description: `Added room "${newRoom.room_name}"`, changesAfter: newRoom });
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
      createAuditLog({ action: 'Updated room', module: 'Rooms', description: `Updated room "${updatedRoom.room_name}": ${buildChangeSummary(editingRoom, updatedRoom, { room_name: 'Name', room_type: 'Type', room_status: 'Status' })}` });
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
      createAuditLog({ action: 'Deleted room', module: 'Rooms', description: `Deleted room "${deleteTargetRoom.room_name}"`, changesBefore: deleteTargetRoom });
      setDeleteTargetRoom(null);
    } catch (err) {
      console.error('Failed to delete room:', err);
      setFormError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-gutter animate-in slide-in-from-bottom-4 duration-500">
      {resolveMessage && (
        <div className={`rounded-lg px-4 py-3 ${
          resolveMessageType === 'success'
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {resolveMessage}
        </div>
      )}
      <div className="flex gap-3">
        <div className="glass-panel flex items-center p-8" style={{flex: '0 0 63.41%'}}>
          <div className="space-y-1">
            <h2 className="text-headline-xl font-headline-xl text-on-surface">Available Rooms</h2>
            <p className="text-body-md text-on-surface-variant">Manage campus facilities and their capacities.</p>
          </div>
          <div className="flex-1"></div>
          <div className="flex items-center gap-3">
            <NotificationButton
              items={notifications}
              title="Room Issues"
              buttonLabel="Notifications"
              emptyLabel="No room data quality issues detected"
              panelSize="md"
              onItemJump={handleNotificationJump}
              onItemEdit={handleNotificationEdit}
              onItemResolve={handleResolveNotification}
              searchPlaceholder="Search by name, type or status"
              notificationSearch={notificationSearch}
              onNotificationSearchChange={setNotificationSearch}
              notificationStats={notificationStats}
            />
            <button
              onClick={handleAddClick}
              className="btn-primary flex flex-row items-center justify-center gap-2 py-2 px-4 whitespace-nowrap"
            >
              <Plus size={18} />
              <span>Add New Room</span>
            </button>
          </div>
        </div>
        <div className="glass-panel flex flex-col items-center justify-center p-4 text-center" style={{flex: '0 0 12.20%'}}>
          <DoorOpen size={24} className="text-primary" />
          <span className="mt-3 text-3xl font-bold text-on-surface">{stats.totalRooms}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Total Rooms</span>
        </div>
        <div className="glass-panel flex flex-col items-center justify-center p-4 text-center" style={{flex: '0 0 12.20%'}}>
          <Maximize2 size={24} className="text-green-500" />
          <span className="mt-3 text-3xl font-bold text-on-surface">{stats.availableRooms}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Available</span>
        </div>
        <div className="glass-panel flex flex-col items-center justify-center p-4 text-center" style={{flex: '0 0 12.20%'}}>
          <Monitor size={24} className="text-blue-500" />
          <span className="mt-3 text-3xl font-bold text-on-surface">{stats.roomTypeCount}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Room Types</span>
        </div>
      </div>

      <div className="glass-panel space-y-4 p-4">
        <div className="border-b border-white/50 px-2 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative flex-1 md:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" size={16} />
              <input
                type="text"
                placeholder="Search by name, type or status..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full rounded-lg border border-white/30 bg-white/60 pl-9 pr-4 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/50 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

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
                  {status === '' ? 'All' : status === 'available' ? 'Available' : status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-white/50 bg-white/50">
                <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/70">Room Name</th>
                <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/70">Room Type</th>
                <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/70">Status</th>
                <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/70">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/50">
              {loading ? (
                <tr>
                  <td colSpan="4" className="px-6 py-8 text-center text-on-surface-variant">
                    Loading rooms data...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="4" className="px-6 py-8 text-center text-red-500">
                    Error: {error}
                  </td>
                </tr>
              ) : rooms.length === 0 ? (
                <tr>
                  <td colSpan="4" className="px-6 py-8 text-center text-on-surface-variant">
                    No rooms found.
                  </td>
                </tr>
              ) : currentRooms.length === 0 ? (
                <tr>
                  <td colSpan="4" className="px-6 py-8 text-center text-on-surface-variant">
                    No rooms in this type.
                  </td>
                </tr>
              ) : (
                currentRooms.map((room) => (
                  <tr key={room.room_id} id={`room-row-${room.room_id}`} className="group transition-colors hover:bg-white/45">
                    <td className="px-6 py-4">
                      <p className="font-bold text-on-surface">{room.room_name}</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">{room.room_type || 'N/A'}</td>
                    <td className="px-6 py-4">
                      {room.room_status ? (
                        <span
                          className={`badge ${
                            room.room_status === 'available'
                              ? 'badge-success'
                              : room.room_status === 'unavailable'
                              ? 'badge-warning'
                              : 'badge-error'
                          }`}
                        >
                          {room.room_status}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => handleEditClick(room)}
                          className="rounded-lg p-2 text-slate-400 transition-all hover:bg-white hover:text-primary"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteClick(room)}
                          className="rounded-lg p-2 text-slate-400 transition-all hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {searchQuery.trim() === '' && (
          <div className="flex items-center justify-between border-t border-white/50 bg-white/35 px-6 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">
              {totalPages > 0 ? `Page ${currentPage} of ${totalPages}` : 'No rooms'}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrevPage}
                disabled={currentPage === 1}
                className="h-8 w-8 rounded-md border border-white/60 bg-white text-xs font-bold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((pageNum) => (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`h-8 w-8 rounded-md text-xs font-bold transition-colors ${
                      pageNum === currentPage
                        ? 'bg-primary text-white shadow-sm'
                        : 'border border-white/60 bg-white text-on-surface-variant hover:bg-slate-50'
                    }`}
                  >
                    {pageNum}
                  </button>
                ))}
              </div>
              <button
                onClick={handleNextPage}
                disabled={currentPage === totalPages}
                className="h-8 w-8 rounded-md border border-white/60 bg-white text-xs font-bold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Room Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative">
            <div className="glass-panel w-full max-w-lg animate-in fade-in duration-300 rounded-lg shadow-xl">
              <div
                className="flex items-center justify-between border-b border-white/20 p-6"
              >
                <div>
                  <h3 className="text-lg font-bold text-on-surface">Add New Room</h3>
                  <p className="mt-1 text-sm text-on-surface-variant">Fill in the room details to create a new room.</p>
                </div>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="rounded p-1 text-slate-400 hover:bg-white/20 hover:text-on-surface"
                >
                  <X size={20} />
                </button>
              </div>

            <form onSubmit={handleAddRoom} className="space-y-4 p-6">
              {formError && <p className="rounded bg-red-100 p-3 text-sm text-red-700">{formError}</p>}

              <div>
                <label className="mb-2 block text-sm font-medium text-on-surface">Room Name *</label>
                <input
                  type="text"
                  value={formData.room_name}
                  onChange={(e) => setFormData({ ...formData, room_name: e.target.value })}
                  className="w-full rounded-md border border-white/30 bg-white/60 px-3 py-2 text-on-surface placeholder-on-surface-variant/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g., Room 101"
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-on-surface">Room Type</label>
                <input
                  type="text"
                  value={formData.room_type}
                  onChange={(e) => setFormData({ ...formData, room_type: e.target.value })}
                  className="w-full rounded-md border border-white/30 bg-white/60 px-3 py-2 text-on-surface placeholder-on-surface-variant/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g., Lecture Hall"
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-on-surface">Status</label>
                <select
                  value={formData.room_status}
                  onChange={(e) => setFormData({ ...formData, room_status: e.target.value })}
                  className="w-full rounded-md border border-white/30 bg-white/60 px-3 py-2 text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  disabled={isSubmitting}
                >
                  <option value="available">Available</option>
                  <option value="unavailable">Unavailable</option>
                  <option value="occupied">Occupied</option>
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={isSubmitting}
                  className="flex-1 rounded-md border border-white/30 bg-white/60 px-4 py-2 font-medium text-on-surface transition-colors hover:bg-white/80 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 rounded-md bg-primary px-4 py-2 font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative">
            <div className="glass-panel w-full max-w-lg animate-in fade-in duration-300 rounded-lg shadow-xl">
              <div
                className="flex items-center justify-between border-b border-white/20 p-6"
              >
                <div>
                  <h3 className="text-lg font-bold text-on-surface">Edit Room</h3>
                  <p className="mt-1 text-sm text-on-surface-variant">Update room details. Make your changes and save them.</p>
                </div>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="rounded p-1 text-slate-400 hover:bg-white/20 hover:text-on-surface"
                >
                  <X size={20} />
                </button>
              </div>

            <form onSubmit={handleUpdateRoom} className="space-y-4 p-6">
              {formError && <p className="rounded bg-red-100 p-3 text-sm text-red-700">{formError}</p>}

              <div>
                <label className="mb-2 block text-sm font-medium text-on-surface">Room Name *</label>
                <input
                  type="text"
                  value={formData.room_name}
                  onChange={(e) => setFormData({ ...formData, room_name: e.target.value })}
                  className="w-full rounded-md border border-white/30 bg-white/60 px-3 py-2 text-on-surface placeholder-on-surface-variant/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g., Room 101"
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-on-surface">Room Type</label>
                <input
                  type="text"
                  value={formData.room_type}
                  onChange={(e) => setFormData({ ...formData, room_type: e.target.value })}
                  className="w-full rounded-md border border-white/30 bg-white/60 px-3 py-2 text-on-surface placeholder-on-surface-variant/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g., Lecture Hall"
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-on-surface">Status</label>
                <select
                  value={formData.room_status}
                  onChange={(e) => setFormData({ ...formData, room_status: e.target.value })}
                  className="w-full rounded-md border border-white/30 bg-white/60 px-3 py-2 text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  disabled={isSubmitting}
                >
                  <option value="available">Available</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  disabled={isSubmitting}
                  className="flex-1 rounded-md border border-white/30 bg-white/60 px-4 py-2 font-medium text-on-surface transition-colors hover:bg-white/80 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 rounded-md bg-primary px-4 py-2 font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {isSubmitting ? 'Updating...' : 'Update Room'}
                </button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && deleteTargetRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative">
            <div className="glass-panel w-full max-w-sm animate-in fade-in duration-300 rounded-lg shadow-xl">
              <div
                className="flex items-center justify-between border-b border-white/20 p-6"
              >
                <div>
                  <h3 className="text-lg font-bold text-on-surface">Delete Room</h3>
                  <p className="mt-1 text-sm text-on-surface-variant">Once you delete this room you cannot bring it back.</p>
                </div>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="rounded p-1 text-slate-400 hover:bg-white/20 hover:text-on-surface"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4 p-6">
                {formError && <p className="rounded bg-red-100 p-3 text-sm text-red-700">{formError}</p>}
                <p className="text-on-surface">
                  Are you sure you want to delete <span className="font-bold">{deleteTargetRoom.room_name}</span>? This action cannot be undone.
                </p>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowDeleteModal(false)}
                    disabled={isSubmitting}
                    className="flex-1 rounded-md border border-white/30 bg-white/60 px-4 py-2 font-medium text-on-surface transition-colors hover:bg-white/80 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDelete}
                    disabled={isSubmitting}
                    className="flex-1 rounded-md bg-red-500 px-4 py-2 font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                  >
                    {isSubmitting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
