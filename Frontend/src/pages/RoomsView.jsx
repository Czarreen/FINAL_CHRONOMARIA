import { useEffect, useMemo, useState } from 'react';
import { DoorOpen, Plus, MapPin, Monitor, Maximize2, Trash2, Edit2, ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchRoomsPage } from '../services/roomsApi.js';

export default function RoomsView() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentTypeIndex, setCurrentTypeIndex] = useState(0);
  const PAGE_SIZE = 9999;

  useEffect(() => {
    setLoading(true);
    fetchRoomsPage(1, PAGE_SIZE)
      .then((data) => {
        setRooms(data.rows || []);
        setError(null);
        setCurrentTypeIndex(0);
      })
      .catch((err) => {
        console.error('Failed to fetch rooms:', err);
        setError(err.message);
        setRooms([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const { stats, roomTypes, currentType, currentRooms } = useMemo(() => {
    const totalRooms = rooms.length;
    const availableRooms = rooms.filter((r) => r.room_status === 'available').length;
    
    // Group by room type
    const typeMap = {};
    rooms.forEach((r) => {
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
  }, [rooms, currentTypeIndex]);

  const handlePrevType = () => {
    setCurrentTypeIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextType = () => {
    setCurrentTypeIndex((prev) => Math.min(roomTypes.length - 1, prev + 1));
  };

  if (loading) {
    return (
      <div className="space-y-gutter animate-in slide-in-from-top-4 duration-500">
        <p className="text-center text-on-surface-variant">Loading rooms data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-gutter animate-in slide-in-from-top-4 duration-500">
        <p className="text-center text-red-500">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-gutter animate-in slide-in-from-top-4 duration-500">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2 className="text-headline-xl font-headline-xl text-on-surface">
            Available Rooms {currentType && `- ${currentType}`}
          </h2>
          <p className="mt-1 text-body-md text-on-surface-variant">Manage campus facilities and their capacities.</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          <span>Add New Room</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {[
          { label: 'Total Rooms', val: String(stats.totalRooms), icon: DoorOpen },
          { label: 'Available', val: String(stats.availableRooms), icon: Maximize2 },
          { label: 'Room Types', val: String(stats.roomTypeCount), icon: Monitor },
        ].map((stat, idx) => (
          <div key={idx} className="glass-panel flex items-center gap-5 p-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/60 bg-white/70 text-primary shadow-sm">
              <stat.icon size={26} />
            </div>
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">{stat.label}</p>
              <p className="text-2xl font-bold text-on-surface">{stat.val}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {currentRooms.length === 0 ? (
          <p className="col-span-full text-center text-on-surface-variant">No rooms found for this type.</p>
        ) : (
          currentRooms.map((room) => (
            <div key={room.room_id} className="glass-panel group flex flex-col overflow-hidden sm:flex-row">
              <div className="relative h-56 w-full overflow-hidden sm:h-auto sm:w-56 bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                <div className="text-center">
                  <DoorOpen size={48} className="text-primary/40 mx-auto mb-2" />
                  <p className="text-sm text-primary/60">{room.room_type}</p>
                </div>
              </div>
              <div className="flex flex-1 flex-col justify-between bg-white/50 p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="mb-1 text-xl font-bold text-on-surface">{room.room_name}</h3>
                    <div className="mb-4 flex items-center gap-2 text-on-surface-variant">
                      <MapPin size={14} className="text-slate-400" />
                      <span className="text-xs font-medium">Room {room.room_id}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 transition-all duration-300 group-hover:opacity-100">
                    <button className="rounded-md p-2 text-slate-400 transition-colors hover:bg-white hover:text-primary">
                      <Edit2 size={16} />
                    </button>
                    <button className="rounded-md p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="flex items-end justify-between gap-6">
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Status</p>
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
                  </div>
                  <div
                    className={`h-3 w-3 rounded-full border-2 border-white shadow-sm ring-1 ring-slate-100 animate-pulse ${
                      room.room_status === 'available' ? 'bg-green-500' : 'bg-amber-500'
                    }`}
                    title={room.room_status}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t border-white/50 bg-white/35 px-6 py-4 rounded-lg">
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
    </div>
  );
}
