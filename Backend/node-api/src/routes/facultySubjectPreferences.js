/**
 * Faculty Subject Preferences Routes
 * Endpoints for managing faculty subject preferences
 */

import { Router } from 'express';
import {
  fetchAllFacultySubjectPreferences,
  fetchFacultySubjectPreferencesForFaculty,
  fetchFacultyPreferenceRecordsForFaculty,
  fetchFacultyPrepLimit,
  saveFacultySubjectPreference,
  deleteFacultySubjectPreference,
  deleteFacultyPreferenceRecord,
  autoGenerateFacultySubjectPreferences,
  autoGenerateSpecializationFromPreferences,
  fetchAvailableSubjectsForFaculty,
} from '../lib/facultySubjectPreferences.js';
import { recordAuditLog } from '../lib/auditLogger.js';
import { supabaseAdmin } from '../lib/supabase.js';

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

    const numericFacultyId = Number(facultyId);
    const [preferences, prepMeta] = await Promise.all([
      fetchFacultySubjectPreferencesForFaculty(numericFacultyId),
      fetchFacultyPrepLimit(numericFacultyId),
    ]);

    return res.json({
      facultyId: numericFacultyId,
      prepLimit: prepMeta.prepLimit,
      facultyMaxUnits: prepMeta.facultyMaxUnits,
      usedTaggedUnits: Number(prepMeta.usedTaggedUnits || 0),
      remainingUnits: Number(prepMeta.remainingUnits || 0),
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
 * GET /api/faculty/:facultyId/preference-records
 * Fetch append-only faculty preference records.
 */
router.get('/:facultyId/preference-records', async (req, res) => {
  try {
    const { facultyId } = req.params;
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);

    if (!facultyId || isNaN(facultyId)) {
      return res.status(400).json({ error: 'Valid faculty ID required' });
    }

    const result = await fetchFacultyPreferenceRecordsForFaculty(Number(facultyId), { limit, offset });

    return res.json({
      facultyId: Number(facultyId),
      records: result.records || [],
      count: Number(result.count ?? 0),
      limit: Number(result.limit ?? 20),
      offset: Number(result.offset ?? 0),
      hasMore: Boolean(result.hasMore),
    });
  } catch (err) {
    console.error('Error fetching faculty preference records:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch faculty preference records',
    });
  }
});

/**
 * DELETE /api/faculty/:facultyId/preference-records/:recordId
 * Delete a faculty preference record row.
 */
router.delete('/:facultyId/preference-records/:recordId', async (req, res) => {
  try {
    const { facultyId, recordId } = req.params;

    if (!facultyId || isNaN(facultyId)) {
      return res.status(400).json({ error: 'Valid faculty ID required' });
    }

    if (!recordId || isNaN(recordId)) {
      return res.status(400).json({ error: 'Valid record ID required' });
    }

    const deleted = await deleteFacultyPreferenceRecord({
      facultyId: Number(facultyId),
      recordId: Number(recordId),
    });

    try {
      await recordAuditLog(req, {
        action: 'DELETE_FACULTY_PREFERENCE_RECORD',
        module: 'FACULTY_SUBJECT_PREFERENCES',
        description: `Deleted faculty preference record: faculty_id=${facultyId}, record_id=${recordId}`,
        status: 'success',
      });
    } catch (logErr) {
      console.error('Error logging action:', logErr);
    }

    return res.json({
      message: 'Faculty preference record deleted successfully',
      deleted: deleted || null,
    });
  } catch (err) {
    console.error('Error deleting faculty preference record:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to delete faculty preference record',
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
 * DELETE /api/faculty/:facultyId/preference-records/:recordId
 * Delete a faculty preference record entry.
 */
router.delete('/:facultyId/preference-records/:recordId', async (req, res) => {
  try {
    const { facultyId, recordId } = req.params;

    if (!facultyId || isNaN(facultyId)) {
      return res.status(400).json({ error: 'Valid faculty ID required' });
    }

    if (!recordId || isNaN(recordId)) {
      return res.status(400).json({ error: 'Valid record ID required' });
    }

    const deleted = await deleteFacultyPreferenceRecord({
      facultyId: Number(facultyId),
      recordId: Number(recordId),
    });

    try {
      await recordAuditLog(req, {
        action: 'DELETE_FACULTY_PREFERENCE_RECORD',
        module: 'FACULTY_SUBJECT_PREFERENCES',
        description: `Deleted faculty preference record: faculty_id=${facultyId}, record_id=${recordId}`,
        status: 'success',
      });
    } catch (logErr) {
      console.error('Error logging action:', logErr);
    }

    return res.json({
      message: 'Faculty preference record deleted successfully',
      deleted: deleted || null,
    });
  } catch (err) {
    console.error('Error deleting faculty preference record:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to delete faculty preference record',
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

/**
 * POST /api/faculty/:id/specialization/auto-generate
 * Auto-generate specialization keywords from the faculty's selected subject preferences
 */
router.post('/:facultyId/specialization/auto-generate', async (req, res) => {
  try {
    const { facultyId } = req.params;

    if (!facultyId || isNaN(facultyId)) {
      return res.status(400).json({ error: 'Valid faculty ID required' });
    }

    const facultyNumericId = Number(facultyId);
    const generated = await autoGenerateSpecializationFromPreferences(facultyNumericId);

    try {
      await recordAuditLog(req, {
        action: 'AUTO_GENERATE_SPECIALIZATION_FROM_PREFERENCES',
        module: 'FACULTY_SUBJECT_PREFERENCES',
        description: `Auto-generated specialization keywords: faculty_id=${facultyId}, count=${generated.length}`,
        status: 'success',
      });
    } catch (logErr) {
      console.error('Error logging action:', logErr);
    }

    const normalizeSpec = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const splitSpecializations = (value) =>
      String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    // Persist generated specialization text back to faculty.faculty_specialization
    try {
      const { data: facultyRow, error: facultyErr } = await supabaseAdmin
        .from('faculty')
        .select('faculty_specialization')
        .eq('faculty_id', facultyNumericId)
        .single();

      if (facultyErr) {
        throw facultyErr;
      }

      const existingValues = splitSpecializations(facultyRow?.faculty_specialization);
      const mergedValues = [];
      const seen = new Set();

      for (const value of [...existingValues, ...(Array.isArray(generated) ? generated : [])]) {
        const normalized = normalizeSpec(value);
        if (!normalized || seen.has(normalized)) {
          continue;
        }
        seen.add(normalized);
        mergedValues.push(String(value).trim());
      }

      const savedValue = mergedValues.join(', ');

      console.log(`[auto-generate specialization] facultyId=${facultyId} existingCount=${existingValues.length} generatedCount=${generated.length} savedValue='${savedValue}'`);
      const { data: savedRow, error: updateErr } = await supabaseAdmin
        .from('faculty')
        .update({ faculty_specialization: savedValue })
        .eq('faculty_id', Number(facultyId))
        .select()
        .single();

      console.log('[auto-generate specialization] supabase update result:', { savedRow, updateErr });

      if (updateErr) {
        console.error('Error saving generated specialization:', updateErr);
        return res.json({
          message: 'Specialization generated but failed to save',
          generated: generated || [],
          count: generated ? generated.length : 0,
          saved: null,
          saveError: updateErr.message || String(updateErr),
          saveDebug: { savedValue },
        });
      }

      return res.json({
        message: 'Specialization keywords generated and saved',
        generated: generated || [],
        count: generated ? generated.length : 0,
          saved: savedRow?.faculty_specialization || savedValue,
          saveDebug: { existingValues, generated, mergedValues, savedValue, savedRow },
      });
    } catch (saveErr) {
      console.error('Unexpected error saving specialization:', saveErr);
      return res.json({
        message: 'Specialization generated but save failed',
        generated: generated || [],
        count: generated ? generated.length : 0,
        saved: null,
        saveError: saveErr instanceof Error ? saveErr.message : String(saveErr),
        saveDebug: { generated },
      });
    }
  } catch (err) {
    console.error('Error auto-generating specialization from preferences:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to generate specialization keywords',
    });
  }
});

export default router;
