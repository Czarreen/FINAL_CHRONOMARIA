/**
 * Faculty Subject Preferences Modal Component
 * Modal for managing faculty subject preferences with manual and auto-generation capabilities
 * Uses subject_tag (text) instead of subject_id for historical preservation
 */

import React, { useEffect, useState } from 'react';
import {
  fetchFacultySubjectPreferences,
  fetchAvailableSubjectsForFaculty,
  addFacultySubjectPreference,
  deleteFacultySubjectPreference,
  autoGenerateFacultySubjectPreferences,
} from '../services/facultySubjectPreferencesApi.js';
import './FacultySubjectPreferencesModal.css';

const PRIORITY_LABELS = {
  1: 'High',
  2: 'Capable',
  3: 'Fallback',
};

const PRIORITY_COLORS = {
  1: '#d32f2f', // Red for High
  2: '#f57c00', // Amber for Capable
  3: '#1976d2', // Blue for Fallback
};

export default function FacultySubjectPreferencesModal({ facultyId, facultyName, onClose }) {
  const [preferences, setPreferences] = useState([]);
  const [availableSubjects, setAvailableSubjects] = useState([]);
  const [selectedSubjectCode, setSelectedSubjectCode] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('2');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  // Fetch initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [preferencesData, subjectsData] = await Promise.all([
          fetchFacultySubjectPreferences(facultyId),
          fetchAvailableSubjectsForFaculty(facultyId),
        ]);

        console.log('📊 Modal Data Loaded:', {
          facultyId,
          preferencesCount: preferencesData.preferences?.length || 0,
          availableSubjectsCount: subjectsData.subjects?.length || 0,
          preferences: preferencesData.preferences,
          availableSubjects: subjectsData.subjects,
        });

        setPreferences(preferencesData.preferences || []);
        setAvailableSubjects(subjectsData.subjects || []);
      } catch (err) {
        console.error('❌ Error loading data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [facultyId]);

  // Handle adding a new preference
  const handleAddPreference = async () => {
    if (!selectedSubjectCode) {
      setError('Please select a subject');
      return;
    }

    try {
      setError(null);
      setIsAdding(true);

      await addFacultySubjectPreference(facultyId, {
        subjectTag: selectedSubjectCode.toUpperCase(),
        priorityLevel: Number(selectedPriority),
      });

      // Refresh preferences
      const preferencesData = await fetchFacultySubjectPreferences(facultyId);
      setPreferences(preferencesData.preferences || []);

      // Reset form
      setSelectedSubjectCode('');
      setSelectedPriority('2');
      setSuccessMessage('Subject preference added successfully');

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error adding preference:', err);
      setError(err instanceof Error ? err.message : 'Failed to add preference');
    } finally {
      setIsAdding(false);
    }
  };

  // Handle deleting a preference
  const handleDeletePreference = async (subjectTag) => {
    if (!window.confirm('Are you sure you want to delete this preference?')) {
      return;
    }

    try {
      setError(null);

      await deleteFacultySubjectPreference(facultyId, subjectTag);

      // Refresh preferences
      const preferencesData = await fetchFacultySubjectPreferences(facultyId);
      setPreferences(preferencesData.preferences || []);

      setSuccessMessage('Subject preference deleted successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error deleting preference:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete preference');
    }
  };

  // Handle updating priority
  const handleUpdatePriority = async (subjectTag, newPriority) => {
    try {
      setError(null);

      await addFacultySubjectPreference(facultyId, {
        subjectTag,
        priorityLevel: Number(newPriority),
      });

      // Refresh preferences
      const preferencesData = await fetchFacultySubjectPreferences(facultyId);
      setPreferences(preferencesData.preferences || []);

      setSuccessMessage('Priority updated successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error updating priority:', err);
      setError(err instanceof Error ? err.message : 'Failed to update priority');
    }
  };

  // Handle auto-generation
  const handleAutoGenerate = async () => {
    if (!window.confirm(
      'This will auto-generate preferences from the faculty specialization field. Continue?'
    )) {
      return;
    }

    try {
      setError(null);
      setIsAutoGenerating(true);

      const result = await autoGenerateFacultySubjectPreferences(facultyId);

      // Refresh preferences
      const preferencesData = await fetchFacultySubjectPreferences(facultyId);
      setPreferences(preferencesData.preferences || []);

      setSuccessMessage(
        `Auto-generated ${result.count} subject preference(s) successfully`
      );
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error auto-generating preferences:', err);
      setError(err instanceof Error ? err.message : 'Failed to auto-generate preferences');
    } finally {
      setIsAutoGenerating(false);
    }
  };

  // Get subject display name
  const getSubjectDisplay = (subject) => {
    if (!subject) return 'Unknown Subject';
    const parts = [];
    if (subject.subject_code) parts.push(subject.subject_code);
    if (subject.subject_descriptive_title) parts.push(`${subject.subject_descriptive_title}`);
    return parts.join(' - ') || 'Unknown Subject';
  };

  // Get subjects not yet tagged
  const untaggedSubjects = availableSubjects.filter(
    (subject) => !preferences.some((pref) => pref.subject_tag === subject.subject_code?.toUpperCase())
  );

  console.log('🏷️ Subject Status:', {
    availableCount: availableSubjects.length,
    taggedCount: preferences.length,
    untaggedCount: untaggedSubjects.length,
    isDropdownDisabled: untaggedSubjects.length === 0,
  });

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Subject Preferences</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <p>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Subject Preferences</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* Error Message */}
          {error && <div className="alert alert-error">{error}</div>}

          {/* Success Message */}
          {successMessage && <div className="alert alert-success">{successMessage}</div>}

          {/* Faculty Name */}
          <div className="faculty-info">
            <strong>Faculty:</strong> {facultyName}
          </div>

          {/* Add Subject Tag Section */}
          <div className="add-subject-section">
            <h3>Add Subject Tag</h3>
            <div className="add-subject-form">
              <select
                value={selectedSubjectCode}
                onChange={(e) => setSelectedSubjectCode(e.target.value)}
                className="subject-select"
                disabled={untaggedSubjects.length === 0 || isAdding}
              >
                <option value="">
                  {untaggedSubjects.length === 0
                    ? 'All subjects tagged'
                    : 'Select a subject...'}
                </option>
                {untaggedSubjects.map((subject) => (
                  <option key={subject.subject_code} value={subject.subject_code}>
                    {getSubjectDisplay(subject)}
                  </option>
                ))}
              </select>

              <select
                value={selectedPriority}
                onChange={(e) => setSelectedPriority(e.target.value)}
                className="priority-select"
                disabled={isAdding}
              >
                {Object.entries(PRIORITY_LABELS).map(([level, label]) => (
                  <option key={level} value={level}>
                    {level} - {label}
                  </option>
                ))}
              </select>

              <button
                onClick={handleAddPreference}
                className="btn btn-primary"
                disabled={!selectedSubjectCode || isAdding}
              >
                {isAdding ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>

          {/* Auto-Generate Button */}
          <div className="auto-generate-section">
            <button
              onClick={handleAutoGenerate}
              className="btn btn-secondary"
              disabled={isAutoGenerating}
            >
              {isAutoGenerating ? 'Generating...' : 'Auto-Generate from Specialization'}
            </button>
            <p className="help-text">
              Auto-generates preferences from the faculty specialization field based on keyword matching
            </p>
          </div>

          {/* Current Tags Section */}
          <div className="current-tags-section">
            <h3>
              Current Tags ({preferences.length})
            </h3>

            {preferences.length === 0 ? (
              <p className="no-tags-message">No subject preferences added yet</p>
            ) : (
              <div className="tags-list">
                {preferences.map((pref) => (
                  <div key={pref.subject_tag} className="tag-item">
                    <div className="tag-subject-info">
                      <span className="tag-code">{pref.subject_tag}</span>
                    </div>

                    <div className="tag-priority">
                      <select
                        value={pref.priority_level}
                        onChange={(e) =>
                          handleUpdatePriority(pref.subject_tag, e.target.value)
                        }
                        className="priority-badge"
                        style={{
                          backgroundColor: PRIORITY_COLORS[pref.priority_level],
                          color: 'white',
                        }}
                      >
                        {Object.entries(PRIORITY_LABELS).map(([level, label]) => (
                          <option key={level} value={level}>
                            {level} - {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      onClick={() => handleDeletePreference(pref.subject_tag)}
                      className="btn-delete"
                      title="Delete preference"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Priority Levels Legend */}
          <div className="priority-legend">
            <p><strong>Priority Levels:</strong></p>
            <div className="legend-items">
              <div className="legend-item">
                <span className="legend-color" style={{ backgroundColor: PRIORITY_COLORS[1] }}></span>
                <span>1 = High (Primary assignment)</span>
              </div>
              <div className="legend-item">
                <span className="legend-color" style={{ backgroundColor: PRIORITY_COLORS[2] }}></span>
                <span>2 = Capable (Secondary/backup)</span>
              </div>
              <div className="legend-item">
                <span className="legend-color" style={{ backgroundColor: PRIORITY_COLORS[3] }}></span>
                <span>3 = Fallback (Emergency coverage)</span>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-default">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
