/**
 * Faculty Subject Preferences Routes
 * Endpoints for managing faculty subject preferences
 */

import { Router } from 'express';
import {
  fetchAllFacultySubjectPreferences,
  fetchFacultySubjectPreferencesForFaculty,
  saveFacultySubjectPreference,
  deleteFacultySubjectPreference,
  autoGenerateFacultySubjectPreferences,
  fetchAvailableSubjectsForFaculty,
} from '../lib/facultySubjectPreferences.js';
import { recordAuditLog } from '../lib/auditLogger.js';

const router = Router();

/**
 * GET /api/faculty/subject-preferences/all
 * Fetch all subject preferences for every faculty in one query.
 * Returns: { [facultyId]: [{ subject_tag, priority_level }] }
 */
router.get('/subject-preferences/all', async (req, res) => {
  try {
    const map = await fetchAllFacultySubjectPreferences();
    return res.json({ preferences: map });
  } catch (err) {
    console.error('Error fetching all faculty subject preferences:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch subject preferences',
    });
  }
});

/**
 * GET /api/faculty/:id/subject-preferences
 * Fetch all subject preferences for a faculty member
 */
router.get('/:facultyId/subject-preferences', async (req, res) => {
  try {
    const { facultyId } = req.params;

    if (!facultyId || isNaN(facultyId)) {
      return res.status(400).json({ error: 'Valid faculty ID required' });
    }

    const preferences = await fetchFacultySubjectPreferencesForFaculty(Number(facultyId));

    return res.json({
      facultyId: Number(facultyId),
      preferences: preferences || [],
      count: preferences ? preferences.length : 0,
    });
  } catch (err) {
    console.error('Error fetching faculty subject preferences:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch subject preferences',
    });
  }
});

/**
 * GET /api/faculty/:id/subject-preferences/available
 * Fetch all available subjects for faculty's department
 */
router.get('/:facultyId/subject-preferences/available', async (req, res) => {
  try {
    const { facultyId } = req.params;

    if (!facultyId || isNaN(facultyId)) {
      return res.status(400).json({ error: 'Valid faculty ID required' });
    }

    const subjects = await fetchAvailableSubjectsForFaculty(Number(facultyId));

    return res.json({
      facultyId: Number(facultyId),
      subjects: subjects || [],
      count: subjects ? subjects.length : 0,
    });
  } catch (err) {
    console.error('Error fetching available subjects:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch available subjects',
    });
  }
});

/**
 * POST /api/faculty/:id/subject-preferences
 * Create or update a subject preference
 * Body: { subjectTag, priorityLevel }
 */
router.post('/:facultyId/subject-preferences', async (req, res) => {
  try {
    const { facultyId } = req.params;
    const { subjectTag, priorityLevel } = req.body;

    if (!facultyId || isNaN(facultyId)) {
      return res.status(400).json({ error: 'Valid faculty ID required' });
    }

    if (!subjectTag || subjectTag.trim() === '') {
      return res.status(400).json({ error: 'Valid subject tag required' });
    }

    if (!priorityLevel || priorityLevel < 1 || priorityLevel > 3) {
      return res.status(400).json({ error: 'Priority level must be 1, 2, or 3' });
    }

    const preference = await saveFacultySubjectPreference({
      facultyId: Number(facultyId),
      subjectTag: subjectTag.trim(),
      priorityLevel: Number(priorityLevel),
    });

    // Log the action
    try {
      await recordAuditLog(req, {
        action: 'ADD_FACULTY_SUBJECT_PREFERENCE',
        module: 'FACULTY_SUBJECT_PREFERENCES',
        description: `Added subject preference: faculty_id=${facultyId}, subject_tag=${subjectTag}, priority=${priorityLevel}`,
        status: 'success',
      });
    } catch (logErr) {
      console.error('Error logging action:', logErr);
      // Don't fail the request due to logging error
    }

    return res.status(201).json({
      message: 'Subject preference created/updated successfully',
      preference,
    });
  } catch (err) {
    console.error('Error saving faculty subject preference:', err);
    const errorMsg = err instanceof Error ? err.message : 'Failed to save subject preference';
    return res.status(500).json({
      error: errorMsg,
    });
  }
});

/**
 * DELETE /api/faculty/:id/subject-preferences/:subjectTag
 * Delete a subject preference
 */
router.delete('/:facultyId/subject-preferences/:subjectTag', async (req, res) => {
  try {
    const { facultyId, subjectTag } = req.params;

    if (!facultyId || isNaN(facultyId)) {
      return res.status(400).json({ error: 'Valid faculty ID required' });
    }

    if (!subjectTag || subjectTag.trim() === '') {
      return res.status(400).json({ error: 'Valid subject tag required' });
    }

    const deleted = await deleteFacultySubjectPreference({
      facultyId: Number(facultyId),
      subjectTag: subjectTag.trim(),
    });

    // Log the action
    try {
      await recordAuditLog(req, {
        action: 'DELETE_FACULTY_SUBJECT_PREFERENCE',
        module: 'FACULTY_SUBJECT_PREFERENCES',
        description: `Deleted subject preference: faculty_id=${facultyId}, subject_tag=${subjectTag}`,
        status: 'success',
      });
    } catch (logErr) {
      console.error('Error logging action:', logErr);
      // Don't fail the request due to logging error
    }

    return res.json({
      message: 'Subject preference deleted successfully',
      deleted: deleted || null,
    });
  } catch (err) {
    console.error('Error deleting faculty subject preference:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to delete subject preference',
    });
  }
});

/**
 * POST /api/faculty/:id/subject-preferences/auto-generate
 * Auto-generate preferences from faculty specialization field
 */
router.post('/:facultyId/subject-preferences/auto-generate', async (req, res) => {
  try {
    const { facultyId } = req.params;

    if (!facultyId || isNaN(facultyId)) {
      return res.status(400).json({ error: 'Valid faculty ID required' });
    }

    const generated = await autoGenerateFacultySubjectPreferences(Number(facultyId));

    // Log the action
    try {
      await recordAuditLog(req, {
        action: 'AUTO_GENERATE_FACULTY_SUBJECT_PREFERENCES',
        module: 'FACULTY_SUBJECT_PREFERENCES',
        description: `Auto-generated subject preferences: faculty_id=${facultyId}, count=${generated.length}`,
        status: 'success',
      });
    } catch (logErr) {
      console.error('Error logging action:', logErr);
      // Don't fail the request due to logging error
    }

    return res.json({
      message: 'Subject preferences auto-generated successfully',
      generated: generated || [],
      count: generated ? generated.length : 0,
    });
  } catch (err) {
    console.error('Error auto-generating faculty subject preferences:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to auto-generate subject preferences',
    });
  }
});

export default router;
