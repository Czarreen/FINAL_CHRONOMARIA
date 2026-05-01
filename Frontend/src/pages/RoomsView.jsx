import { useEffect, useMemo, useState } from 'react';
import { DoorOpen, Plus, MapPin, Monitor, Maximize2, Trash2, Edit2, ChevronLeft, ChevronRight, X, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { fetchRoomsPage, createRoom, updateRoom, deleteRoom } from '../services/roomsApi.js';

export default function RoomsView() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentTypeIndex, setCurrentTypeIndex] = useState(0);
  const PAGE_SIZE = 9999;

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [deleteTargetRoom, setDeleteTargetRoom] = useState(null);

  // Info overlay states
  const [showAddInfo, setShowAddInfo] = useState(false);
  const [showAddButtonTooltip, setShowAddButtonTooltip] = useState(false);

  // Form state
  const [formData, setFormData] = useState({ room_name: '', room_type: '', room_status: 'available' });
  const [formError, setFormError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  const loadRooms = async () => {
    setLoading(true);
    try {
      const data = await fetchRoomsPage(1, PAGE_SIZE);
      setRooms(data.rows || []);
      setError(null);
      setCurrentTypeIndex(0);
    } catch (err) {
      console.error('Failed to fetch rooms:', err);
      setError(err.message);
      setRooms([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRooms();
  }, []);

  const { stats, roomTypes, currentType, currentRooms } = useMemo(() => {
    // Filter rooms by search query only if search query is not empty
    const filteredRooms = searchQuery.trim() === '' 
      ? rooms 
      : rooms.filter((r) => {
        const query = searchQuery.toLowerCase();
        return (
          (r.room_name || '').toLowerCase().includes(query) ||
          (r.room_type || '').toLowerCase().includes(query) ||
          (r.room_status || '').toLowerCase().includes(query)
        );
      });

    const totalRooms = filteredRooms.length;
    const availableRooms = filteredRooms.filter((r) => r.room_status === 'available').length;
    
    // If searching, show all matching rooms without type filtering
    if (searchQuery.trim() !== '') {
      const roomTypeCount = new Set(filteredRooms.map(r => r.room_type || 'Unassigned')).size;
      return {
        stats: { totalRooms, availableRooms, roomTypeCount },
        roomTypes: [],
        currentType: null,
        currentRooms: filteredRooms,
      };
    }

    const typeMap = {};
    filteredRooms.forEach((r) => {
      const typeName = r.room_type || 'Unassigned';
      if (!typeMap[typeName]) {
        typeMap[typeName] = [];
      }
      typeMap[typeName].push(r);
    });
    
    const types = Object.keys(typeMap).sort();
    const roomTypeCount = types.length;
    
    const current = types[currentTypeIndex] || null;
    const members = current ? typeMap[current] : [];

    return {
      stats: { totalRooms, availableRooms, roomTypeCount },
      roomTypes: types,
      currentType: current,
      currentRooms: members,
    };
  }, [rooms, currentTypeIndex, searchQuery]);

  const handlePrevType = () => {
    setCurrentTypeIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextType = () => {
    setCurrentTypeIndex((prev) => Math.min(roomTypes.length - 1, prev + 1));
  };

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
    } catch (err) {
      console.error('Failed to delete room:', err);
      setFormError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-gutter animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2 className="text-headline-xl font-headline-xl text-on-surface">Available Rooms</h2>
          <p className="mt-1 text-body-md text-on-surface-variant">Manage campus facilities and their capacities.</p>
        </div>
        <div className="relative">
          <button
            onClick={handleAddClick}
            onMouseEnter={() => setShowAddButtonTooltip(true)}
            onMouseLeave={() => setShowAddButtonTooltip(false)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={18} />
            <span>Add New Room</span>
          </button>
          {showAddButtonTooltip && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.2 }}
              className="absolute right-0 top-full mt-2 w-64 rounded-lg bg-white/95 shadow-lg border border-white/60 p-3 z-50 pointer-events-none"
            >
              <p className="text-sm text-on-surface-variant leading-relaxed">
                Create a new room. Fill in the name and details then save.
              </p>
            </motion.div>
          )}
        </div>
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="border-b border-white/50 px-6 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { label: 'Total Rooms', val: String(stats.totalRooms), icon: DoorOpen },
              { label: 'Available', val: String(stats.availableRooms), icon: Maximize2 },
              { label: 'Room Types', val: String(stats.roomTypeCount), icon: Monitor },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white/60 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">{stat.label}</p>
                    <p className="mt-2 text-2xl font-bold text-on-surface">{stat.val}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <stat.icon size={18} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-b border-white/50 px-6 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" size={16} />
            <input
              type="text"
              placeholder="Search by name, type, or status..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-white/30 bg-white/60 pl-9 pr-4 py-2.5 text-sm text-on-surface placeholder-on-surface-variant/50 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-white/50 bg-white/50">
                <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/70">Room Name</th>
                <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/70">Room Type</th>
                <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/70">Room ID</th>
                <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/70">Status</th>
                <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-[0.22em] text-on-surface-variant/70">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/50">
              {loading ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-on-surface-variant">
                    Loading rooms data...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-red-500">
                    Error: {error}
                  </td>
                </tr>
              ) : rooms.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-on-surface-variant">
                    No rooms found.
                  </td>
                </tr>
              ) : currentRooms.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-on-surface-variant">
                    No rooms in this type.
                  </td>
                </tr>
              ) : (
                currentRooms.map((room) => (
                  <tr key={room.room_id} className="group transition-colors hover:bg-white/45">
                    <td className="px-6 py-4">
                      <p className="font-bold text-on-surface">{room.room_name}</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">{room.room_type || 'N/A'}</td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant/70 flex items-center gap-2">
                      <MapPin size={14} className="text-slate-400" />
                      {room.room_id}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`badge ${
                          room.room_status === 'available'
                            ? 'badge-success'
                            : room.room_status === 'maintenance'
                            ? 'badge-warning'
                            : 'badge-error'
                        }`}
                      >
                        {room.room_status}
                      </span>
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
              {currentType ? `${currentType} (${currentRooms.length} rooms)` : 'No room types'}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrevType}
                disabled={currentTypeIndex === 0}
                className="h-8 w-8 rounded-md border border-white/60 bg-white text-xs font-bold text-on-surface-variant transition-colors hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="flex items-center gap-1">
                {roomTypes.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentTypeIndex(idx)}
                    className={`h-8 w-8 rounded-md text-xs font-bold transition-colors ${
                      idx === currentTypeIndex
                        ? 'bg-primary text-white shadow-sm'
                        : 'border border-white/60 bg-white text-on-surface-variant hover:bg-slate-50'
                    }`}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>
              <button
                onClick={handleNextType}
                disabled={currentTypeIndex === roomTypes.length - 1}
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
            <div className="glass-panel w-full max-w-md animate-in fade-in duration-300 rounded-lg shadow-xl">
              <div
                className="flex items-center justify-between border-b border-white/20 p-6 cursor-help"
                onMouseEnter={() => setShowAddInfo(true)}
                onMouseLeave={() => setShowAddInfo(false)}
              >
                <h3 className="text-lg font-bold text-on-surface">Add New Room</h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="rounded p-1 text-slate-400 hover:bg-white/20 hover:text-on-surface"
                >
                  <X size={20} />
                </button>
              </div>
              
              {showAddInfo && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="absolute left-0 right-0 -top-20 w-72 rounded-lg bg-white/95 shadow-lg border border-white/60 p-4 z-50"
                >
                  <p className="text-sm text-on-surface-variant leading-relaxed">
                    Create a new room. Fill in the name and details then save.
                  </p>
                </motion.div>
              )}

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
                  <option value="maintenance">Maintenance</option>
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
            <div className="glass-panel w-full max-w-md animate-in fade-in duration-300 rounded-lg shadow-xl">
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
                  <option value="maintenance">Maintenance</option>
                  <option value="occupied">Occupied</option>
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
