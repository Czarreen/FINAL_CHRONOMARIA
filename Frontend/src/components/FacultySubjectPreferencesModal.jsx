import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Zap, AlertCircle, Loader } from 'lucide-react';
import {
  fetchFacultySubjectPreferences,
  addFacultySubjectPreference,
  deleteFacultySubjectPreference,
  autoGenerateFacultySubjectPreferences,
  updateFacultySubjectPreferencePriority,
} from '../services/facultySubjectPreferencesApi.js';
import { fetchSubjects } from '../services/subjectsApi.js';

export default function FacultySubjectPreferencesModal({ faculty, onClose, onRefresh }) {
  const [preferences, setPreferences] = useState([]);
  const [allSubjects, setAllSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('2');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [updated, setUpdated] = useState(null);

  useEffect(() => {
    loadPreferences();
    loadAllSubjects();
  }, [faculty.faculty_id]);

  async function loadPreferences() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchFacultySubjectPreferences(faculty.faculty_id);
      setPreferences(data.rows || []);
    } catch (err) {
      setError(err.message || 'Failed to load preferences');
      setPreferences([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadAllSubjects() {
    try {
      const data = await fetchSubjects({ limit: 1000 });
      setAllSubjects(data.rows || []);
    } catch (err) {
      console.error('Failed to load subjects:', err);
      setAllSubjects([]);
    }
  }

  const getAvailableSubjects = () => {
    const preferredIds = new Set(preferences.map((p) => p.subject_id));
    return allSubjects.filter((s) => !preferredIds.has(s.subject_id));
  };

  async function handleAddPreference() {
    if (!selectedSubjectId) return;

    try {
      setAdding(true);
      setError(null);
      await addFacultySubjectPreference(faculty.faculty_id, {
        subjectId: Number(selectedSubjectId),
        priorityLevel: Number(selectedPriority),
      });
      setSelectedSubjectId('');
      setSelectedPriority('2');
      await loadPreferences();
    } catch (err) {
      setError(err.message || 'Failed to add preference');
    } finally {
      setAdding(false);
    }
  }

  async function handleDeletePreference(subjectId) {
    try {
      setDeleting(subjectId);
      setError(null);
      await deleteFacultySubjectPreference(faculty.faculty_id, subjectId);
      await loadPreferences();
    } catch (err) {
      setError(err.message || 'Failed to delete preference');
    } finally {
      setDeleting(null);
    }
  }

  async function handleAutoGenerate() {
    try {
      setAutoGenerating(true);
      setError(null);
      const result = await autoGenerateFacultySubjectPreferences(faculty.faculty_id);
      setUpdated(`Auto-generated ${result.upserted} preferences`);
      await loadPreferences();
      setTimeout(() => setUpdated(null), 3000);
    } catch (err) {
      setError(err.message || 'Failed to auto-generate preferences');
    } finally {
      setAutoGenerating(false);
    }
  }

  async function handlePriorityChange(subjectId, newPriority) {
    try {
      setError(null);
      await updateFacultySubjectPreferencePriority(faculty.faculty_id, subjectId, Number(newPriority));
      await loadPreferences();
    } catch (err) {
      setError(err.message || 'Failed to update priority');
    }
  }

  const priorityColor = {
    1: 'bg-red-100 text-red-700 border-red-300',
    2: 'bg-amber-100 text-amber-700 border-amber-300',
    3: 'bg-blue-100 text-blue-700 border-blue-300',
  };

  const priorityLabel = {
    1: 'High Expertise',
    2: 'Capable',
    3: 'Fallback',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="my-4 flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl max-h-[calc(100vh-2rem)] min-h-0">
        <div className="flex items-center justify-between border-b border-slate-200 bg-primary px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-white">Subject Preferences</h3>
            <p className="text-xs text-white/70 mt-0.5">{faculty.faculty_name}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {updated && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">
              <Zap size={16} />
              {updated}
            </div>
          )}

          {/* Add New Preference */}
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">Add Subject Tag</p>
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_auto]">
              <select
                value={selectedSubjectId}
                onChange={(e) => setSelectedSubjectId(e.target.value)}
                disabled={adding}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Select a subject...</option>
                {getAvailableSubjects().map((subject) => (
                  <option key={subject.subject_id} value={subject.subject_id}>
                    {subject.subject_code} - {subject.subject_descriptive_title}
                  </option>
                ))}
              </select>
              <select
                value={selectedPriority}
                onChange={(e) => setSelectedPriority(e.target.value)}
                disabled={adding}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="1">High (1)</option>
                <option value="2">Capable (2)</option>
                <option value="3">Fallback (3)</option>
              </select>
              <button
                onClick={handleAddPreference}
                disabled={adding || !selectedSubjectId}
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white transition-all hover:bg-primary-dark disabled:opacity-50"
              >
                {adding ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
                <span>Add</span>
              </button>
            </div>
          </div>

          {/* Auto-Generate */}
          <button
            onClick={handleAutoGenerate}
            disabled={autoGenerating}
            className="w-full rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-700 transition-all hover:bg-amber-100 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {autoGenerating ? <Loader size={14} className="animate-spin" /> : <Zap size={14} />}
            Auto-Generate from Specialization
          </button>

          {/* Current Preferences */}
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">
              Current Tags ({preferences.length})
            </p>

            {loading ? (
              <div className="flex items-center justify-center py-4">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary"></div>
              </div>
            ) : preferences.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center text-xs text-slate-600">
                No preferences yet. Add one or use auto-generate.
              </div>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200">
                {preferences.map((pref) => (
                  <div
                    key={pref.subject_id}
                    className={`flex items-center justify-between gap-2 rounded border-l-4 p-2 ${priorityColor[pref.priority_level]}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">
                        {pref.subject_code} - {pref.subject_course_no}
                      </p>
                      <p className="text-[10px] text-opacity-70 truncate">{pref.subject_descriptive_title}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <select
                        value={pref.priority_level}
                        onChange={(e) => handlePriorityChange(pref.subject_id, e.target.value)}
                        className="text-[10px] rounded border border-current bg-transparent px-1.5 py-0.5 outline-none hover:opacity-70"
                        title={priorityLabel[pref.priority_level]}
                      >
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                      </select>
                      <button
                        onClick={() => handleDeletePreference(pref.subject_id)}
                        disabled={deleting === pref.subject_id}
                        className="rounded p-1 text-current transition-all hover:opacity-50 disabled:opacity-50"
                        title="Delete preference"
                      >
                        {deleting === pref.subject_id ? (
                          <Loader size={12} className="animate-spin" />
                        ) : (
                          <Trash2 size={12} />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="rounded-lg bg-slate-50 p-3 space-y-1 text-[10px]">
            <p className="font-bold text-slate-700">Priority Levels:</p>
            <div className="grid grid-cols-3 gap-1">
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-red-500"></div>
                <span>1 = High</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-amber-500"></div>
                <span>2 = Capable</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                <span>3 = Fallback</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
