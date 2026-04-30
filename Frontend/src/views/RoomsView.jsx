import { DoorOpen, Plus, MapPin, Monitor, Maximize2, Trash2, Edit2, Layers3, Cpu } from 'lucide-react';

const MOCK_ROOMS = [
  { 
    id: '1', 
    code: 'LH-A101', 
    name: 'Lecture Hall A-101', 
    type: 'lecture', 
    location: 'Building 1, Floor 1', 
    capacity: 60, 
    equipment: ['Projector', 'Audio'], 
    status: 'available',
    imageUrl: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?q=80&w=800&auto=format&fit=crop'
  },
  { 
    id: '2', 
    code: 'CL-C302', 
    name: 'Computer Lab C-302', 
    type: 'laboratory', 
    location: 'Building 3, Floor 2', 
    capacity: 30, 
    equipment: ['30 Workstations'], 
    status: 'maintenance',
    imageUrl: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?q=80&w=800&auto=format&fit=crop'
  },
];

export default function RoomsView() {
  return (
    <div className="space-y-gutter animate-in slide-in-from-top-4 duration-500">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2 className="text-headline-xl font-headline-xl text-on-surface">Available Rooms</h2>
          <p className="mt-1 text-body-md text-on-surface-variant">Manage campus facilities and their capacities.</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          <span>Add New Room</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {[
          { label: 'Total Rooms', val: '24', icon: DoorOpen },
          { label: 'Total Capacity', val: '840', icon: Maximize2 },
          { label: 'Spec. Labs', val: '8', icon: Monitor },
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
        {MOCK_ROOMS.map((room) => (
          <div key={room.id} className="glass-panel group flex flex-col overflow-hidden sm:flex-row">
            <div className="relative h-56 w-full overflow-hidden sm:h-auto sm:w-56">
              <img 
                src={room.imageUrl} 
                alt={room.name}
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
              />
              <div className="absolute top-4 left-4">
                <span className={`badge whitespace-nowrap border border-white/20 px-3 py-1 shadow-lg backdrop-blur-md ${
                  room.type === 'lecture' ? 'bg-primary/90 text-white' : 'bg-slate-700/90 text-white'
                }`}>
                  {room.type}
                </span>
              </div>
            </div>
            <div className="flex flex-1 flex-col justify-between bg-white/50 p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="mb-1 text-xl font-bold text-on-surface">{room.name}</h3>
                  <div className="mb-4 flex items-center gap-2 text-on-surface-variant">
                    <MapPin size={14} className="text-slate-400" />
                    <span className="text-xs font-medium">{room.location}</span>
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
                <div className="flex gap-6">
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Capacity</p>
                    <p className="text-2xl font-bold leading-tight text-primary">{room.capacity}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.28em] text-on-surface-variant/60">Equipment</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {room.equipment.map((eq, i) => (
                        <span key={i} className="rounded-md border border-white/60 bg-white/70 px-2 py-0.5 text-[10px] font-bold text-on-surface-variant">
                          {eq}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className={`h-3 w-3 rounded-full border-2 border-white shadow-sm ring-1 ring-slate-100 animate-pulse ${
                    room.status === 'available' ? 'bg-green-500' : 'bg-amber-500'
                  }`}
                  title={room.status}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
