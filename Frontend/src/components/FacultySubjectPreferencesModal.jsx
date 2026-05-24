/**
 * Faculty Subject Preferences Modal Component
 * Modal for managing faculty subject preferences with manual and auto-generation capabilities
 * Uses subject_tag (text) instead of subject_id for historical preservation
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  fetchAllFacultySubjectPreferences,
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
  const [tagUsageCounts, setTagUsageCounts] = useState({});
  const [isSubjectMenuOpen, setIsSubjectMenuOpen] = useState(false);
  const [subjectSearchQuery, setSubjectSearchQuery] = useState('');
  const [prepLimit, setPrepLimit] = useState(4);
  const [facultyMaxUnits, setFacultyMaxUnits] = useState(0);
  const [usedTaggedUnits, setUsedTaggedUnits] = useState(0);
  const [remainingUnits, setRemainingUnits] = useState(0);
  const [selectedSubjectCode, setSelectedSubjectCode] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('2');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const subjectMenuRef = useRef(null);
  const subjectSearchInputRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (subjectMenuRef.current && !subjectMenuRef.current.contains(event.target)) {
        setIsSubjectMenuOpen(false);
        setSubjectSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isSubjectMenuOpen) {
      window.requestAnimationFrame(() => {
        subjectSearchInputRef.current?.focus();
      });
    }
  }, [isSubjectMenuOpen]);

  // Fetch initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [preferencesData, subjectsData, allPreferences] = await Promise.all([
          fetchFacultySubjectPreferences(facultyId),
          fetchAvailableSubjectsForFaculty(facultyId),
          fetchAllFacultySubjectPreferences().catch(() => ({})),
        ]);

        const usageCounts = {};
        for (const prefs of Object.values(allPreferences || {})) {
          for (const pref of prefs || []) {
            const code = String(pref.subject_tag || '').trim().toUpperCase();
            if (!code) continue;
            usageCounts[code] = (usageCounts[code] || 0) + 1;
          }
        }

        // modal data loaded

        setPreferences(preferencesData.preferences || []);
        setPrepLimit(Number(preferencesData.prepLimit ?? 4));
        setFacultyMaxUnits(Number(preferencesData.facultyMaxUnits ?? 0));
        setUsedTaggedUnits(Number(preferencesData.usedTaggedUnits ?? 0));
        setRemainingUnits(Number(preferencesData.remainingUnits ?? 0));
        setTagUsageCounts(usageCounts);
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

    // Client-side remaining units check
    const sel = availableSubjects.find((s) => s.subject_code === selectedSubjectCode);
    const selUnits = Number(sel?.subject_units || 0);
    if (remainingUnits <= 0 || selUnits > remainingUnits) {
      setError(`Cannot add subject: only ${remainingUnits} unit(s) remaining for this faculty.`);
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
      setPrepLimit(Number(preferencesData.prepLimit ?? 4));
      setFacultyMaxUnits(Number(preferencesData.facultyMaxUnits ?? 0));
      setUsedTaggedUnits(Number(preferencesData.usedTaggedUnits ?? 0));
      setRemainingUnits(Number(preferencesData.remainingUnits ?? 0));

      // Reset form
      setSelectedSubjectCode('');
      setSelectedPriority('2');
      setSubjectSearchQuery('');
      setIsSubjectMenuOpen(false);
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
      setPrepLimit(Number(preferencesData.prepLimit ?? 4));
      setFacultyMaxUnits(Number(preferencesData.facultyMaxUnits ?? 0));
      setUsedTaggedUnits(Number(preferencesData.usedTaggedUnits ?? 0));
      setRemainingUnits(Number(preferencesData.remainingUnits ?? 0));
      setSubjectSearchQuery('');

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
      setPrepLimit(Number(preferencesData.prepLimit ?? 4));
      setFacultyMaxUnits(Number(preferencesData.facultyMaxUnits ?? 0));
      setUsedTaggedUnits(Number(preferencesData.usedTaggedUnits ?? 0));
      setRemainingUnits(Number(preferencesData.remainingUnits ?? 0));
      setSubjectSearchQuery('');

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
      setPrepLimit(Number(preferencesData.prepLimit ?? 4));
      setFacultyMaxUnits(Number(preferencesData.facultyMaxUnits ?? 0));
      setUsedTaggedUnits(Number(preferencesData.usedTaggedUnits ?? 0));
      setRemainingUnits(Number(preferencesData.remainingUnits ?? 0));
      setSubjectSearchQuery('');

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

  const getTagUsageLabel = (subjectCode) => {
    const count = Number(tagUsageCounts[String(subjectCode || '').toUpperCase()] || 0);
    return String(count);
  };

  const getTagUsageTone = (subjectCode) => {
    const count = Number(tagUsageCounts[String(subjectCode || '').toUpperCase()] || 0);
    if (count <= 0) return 'tone-green';
    if (count <= 3) return 'tone-yellow';
    return 'tone-red';
  };

  const normalizeSearchText = (value) =>
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const compactSearchText = (value) =>
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

  const matchesSearchQuery = (subject, query) => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return true;
    const subjectCode = normalizeSearchText(subject.subject_code);
    const subjectTitle = normalizeSearchText(subject.subject_descriptive_title);
    const subjectDisplay = normalizeSearchText(getSubjectDisplay(subject));
    const compactQuery = compactSearchText(query);
    const compactCode = compactSearchText(subject.subject_code);
    const compactTitle = compactSearchText(subject.subject_descriptive_title);
    const compactDisplay = compactSearchText(getSubjectDisplay(subject));
    const queryParts = normalizedQuery.split(/\s+/).filter(Boolean);

    if (
      compactQuery &&
      (
        compactCode.includes(compactQuery) ||
        compactTitle.includes(compactQuery) ||
        compactDisplay.includes(compactQuery)
      )
    ) {
      return true;
    }

    return queryParts.every((part) => {
      return (
        subjectCode.includes(part) ||
        subjectTitle.includes(part) ||
        subjectDisplay.includes(part)
      );
    });
  };

  // Get subjects not yet tagged and that fit remaining capacity
  const untaggedSubjects = availableSubjects.filter((subject) => {
    const code = subject.subject_code?.toUpperCase();
    if (!code) return false;
    if (preferences.some((pref) => pref.subject_tag === code)) return false;
    const units = Number(subject.subject_units || 0);
    if (remainingUnits <= 0) return false;
    return units <= remainingUnits;
  });

  // Compute a relevance score for each candidate and sort by relevance so
  // the most relevant subjects appear on top instead of preserving input order.
  const scoreSubjectMatch = (subject, query) => {
    const qNorm = normalizeSearchText(query);
    const qCompact = compactSearchText(query);
    if (!qNorm) return 100; // no query — keep original ordering but high score so appears

    const code = String(subject.subject_code || '').toLowerCase();
    const title = normalizeSearchText(subject.subject_descriptive_title || '');
    const display = normalizeSearchText(getSubjectDisplay(subject));
    const compactCode = compactSearchText(subject.subject_code || '');
    const compactTitle = compactSearchText(subject.subject_descriptive_title || '');

    // Start with a base score if the legacy matcher considers it a match
    let score = matchesSearchQuery(subject, query) ? 100 : 0;

    // Exact code match (highest)
    if (compactCode === qCompact && qCompact) score += 1000;
    // Code starts with query
    if (compactCode.startsWith(qCompact) && qCompact) score += 500;
    // Code contains query
    if (compactCode.includes(qCompact) && qCompact) score += 250;

    // Title exact phrase
    if (display.includes(qNorm) && qNorm) score += 200;
    // Title token matches: more tokens matched -> higher score
    const qParts = qNorm.split(/\s+/).filter(Boolean);
    let titleMatchCount = 0;
    for (const p of qParts) {
      if (title.includes(p) || display.includes(p)) titleMatchCount += 1;
    }
    score += titleMatchCount * 50;

    // Fallback small score if compact display contains compact query
    if (compactTitle.includes(qCompact) || compactCode.includes(qCompact)) score += 10;

    return score;
  };

  const searchableSubjects = (() => {
    // Map candidates to scored objects
    const scored = untaggedSubjects.map((subject) => ({
      subject,
      score: scoreSubjectMatch(subject, subjectSearchQuery),
    }));

    // Filter out non-matches when query present
    const filtered = subjectSearchQuery
      ? scored.filter((s) => s.score > 0)
      : scored;

    // Sort by score desc, then by subject_code asc for stability
    filtered.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aCode = String(a.subject.subject_code || '');
      const bCode = String(b.subject.subject_code || '');
      return aCode.localeCompare(bCode);
    });

    // no debug logging

    return filtered.map((f) => f.subject);
  })();

  const openSubjectMenu = () => {
    if (untaggedSubjects.length === 0 || isAdding || remainingUnits <= 0) return;
    setIsSubjectMenuOpen((open) => !open);
  };

  // subject status availableCount/taggedCount/untaggedCount

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
              <div className="subject-select-wrapper" ref={subjectMenuRef}>
                <button
                  type="button"
                  className="subject-select-button"
                  onClick={openSubjectMenu}
                  disabled={untaggedSubjects.length === 0 || isAdding || remainingUnits <= 0}
                >
                  <span className="subject-select-button-label">
                    {selectedSubjectCode
                      ? getSubjectDisplay(
                          availableSubjects.find((subject) => subject.subject_code === selectedSubjectCode)
                        )
                      : remainingUnits <= 0
                      ? `No remaining units (${usedTaggedUnits}/${facultyMaxUnits})`
                      : untaggedSubjects.length === 0
                      ? 'No eligible subjects available'
                      : 'Select a subject...'}
                  </span>
                  <span className="subject-select-button-caret">▾</span>
                </button>

                {isSubjectMenuOpen && untaggedSubjects.length > 0 && remainingUnits > 0 && (
                  <div className="subject-select-menu">
                    <div className="subject-search-wrapper">
                      <input
                        type="text"
                        className="subject-search-input"
                        placeholder="Search subject code or title..."
                        value={subjectSearchQuery}
                        onChange={(e) => setSubjectSearchQuery(e.target.value)}
                        ref={subjectSearchInputRef}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </div>

                    {searchableSubjects.length === 0 ? (
                      <div className="subject-search-empty">No matching subjects</div>
                    ) : (
                      searchableSubjects.map((subject, idx) => {
                        const code = subject.subject_code;
                        const countLabel = getTagUsageLabel(code);
                        const uniqueKey = `${String(code || '')}__${String(subject.subject_descriptive_title || '')}__${idx}`;
                        return (
                          <button
                            key={uniqueKey}
                            type="button"
                            className="subject-select-option"
                            onClick={() => {
                              setSelectedSubjectCode(code);
                              setSubjectSearchQuery('');
                              setIsSubjectMenuOpen(false);
                            }}
                          >
                            <span className="subject-select-option-text">
                              {getSubjectDisplay(subject)}
                            </span>
                            <span className={`subject-count-pill ${getTagUsageTone(code)}`}>
                              {countLabel}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

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
                disabled={!selectedSubjectCode || isAdding || remainingUnits <= 0}
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
            <p className="help-text">
              Units used: {usedTaggedUnits} / {facultyMaxUnits || 0} — Remaining: {remainingUnits}
            </p>

            {/* Prep slot breakdown */}
            {preferences.length > 0 && (() => {
              const p1Count = preferences.filter(p => p.priority_level === 1).length;
              const p2Count = preferences.filter(p => p.priority_level === 2).length;
              const p3Count = preferences.filter(p => p.priority_level === 3).length;
              const remaining = Math.max(0, prepLimit - preferences.length);
              return (
                <div className="prep-slot-breakdown">
                  <span className="prep-slot-item prep-slot-p1" title="Hard pre-assigned before GA runs">
                    P1 (High): {p1Count}
                  </span>
                  <span className="prep-slot-divider">·</span>
                  <span className="prep-slot-item prep-slot-p2" title="Prep slot reserved for GA">
                    P2 (Capable): {p2Count}
                  </span>
                  <span className="prep-slot-divider">·</span>
                  <span className="prep-slot-item prep-slot-p3" title="Prep slot reserved for GA">
                    P3 (Fallback): {p3Count}
                  </span>
                  <span className="prep-slot-divider">·</span>
                  <span className={`prep-slot-item prep-slot-free${remaining === 0 ? ' prep-slot-free-empty' : ''}`}
                    title="Remaining slots the GA can fill from department matching">
                    Free for GA: {remaining}
                  </span>
                </div>
              );
            })()}

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
