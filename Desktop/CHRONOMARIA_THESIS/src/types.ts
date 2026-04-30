export type ViewType = 'dashboard' | 'faculty' | 'subjects' | 'rooms' | 'schedule';

export interface FacultyMember {
  id: string;
  name: string;
  email: string;
  department: string;
  role: string;
  status: 'active' | 'on-leave' | 'inactive';
  avatarUrl?: string;
}

export interface Subject {
  id: string;
  code: string;
  title: string;
  units: number;
  category: 'major' | 'minor' | 'elective';
  assignedFaculty?: string[];
  lastUpdate: string;
}

export interface Room {
  id: string;
  code: string;
  name: string;
  type: 'lecture' | 'laboratory' | 'specialized';
  location: string;
  capacity: number;
  equipment: string[];
  status: 'available' | 'maintenance' | 'occupied';
  imageUrl: string;
}
