import { Router } from 'express';
import {
  autoGenerateFacultySubjectPreferences,
  deleteFacultySubjectPreference,
  fetchFacultySubjectPreferencesForFaculty,
  saveFacultySubjectPreference,
} from '../lib/facultySubjectPreferences.js';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

async function loadFaculty(facultyId) {
  const { data, error } = await supabaseAdmin
    .from('faculty')
    .select('faculty_id, faculty_name, faculty_specialization, department_id, faculty_status')
    .eq('faculty_id', facultyId)
    .maybeSingle();

  if (error) throw error;

  if (!data) return null;

  return {
    faculty_id: data.faculty_id,
    faculty_name: data.faculty_name,
    faculty_specialization: data.faculty_specialization,
    department_id: data.department_id,
    faculty_status: data.faculty_status,
  };
}

router.get('/:id/subject-preferences', async (req, res) => {
  try {
    const facultyId = Number(req.params.id);
    if (!Number.isFinite(facultyId)) {
      return res.status(400).json({ error: 'Invalid faculty id' });
    }

    const faculty = await loadFaculty(facultyId);
    if (!faculty) {
      return res.status(404).json({ error: 'Faculty member not found' });
    }

    const rows = await fetchFacultySubjectPreferencesForFaculty(facultyId);
    return res.json({ faculty, rows });
  } catch (err) {
    console.error('[facultySubjectPreferences] GET error:', err.message || err);
    console.error('[facultySubjectPreferences] Stack:', err.stack);
    return res.status(500).json({
      error: err instanceof Error && err.message ? err.message : 'Failed to load subject preferences',
      detail: err?.code || err?.details || err?.hint || 'unknown',
    });
  }
});

router.post('/:id/subject-preferences', async (req, res) => {
  try {
    const facultyId = Number(req.params.id);
    const subjectId = Number(req.body?.subject_id);
    const priorityLevel = req.body?.priority_level;

    if (!Number.isFinite(facultyId)) {
      return res.status(400).json({ error: 'Invalid faculty id' });
    }

    if (!Number.isFinite(subjectId)) {
      return res.status(400).json({ error: 'subject_id is required' });
    }

    const faculty = await loadFaculty(facultyId);
    if (!faculty) {
      return res.status(404).json({ error: 'Faculty member not found' });
    }

    const saved = await saveFacultySubjectPreference({ facultyId, subjectId, priorityLevel });
    return res.status(201).json({ ...saved, faculty });
  } catch (err) {
    console.error('[facultySubjectPreferences] POST error:', err);
    const message = err instanceof Error && err.message ? err.message : 'Unknown error';
    // Return 400 for department constraint violations
    if (message.includes('Cannot tag faculty') || message.includes('different departments')) {
      return res.status(400).json({ error: message });
    }
    return res.status(500).json({ error: message });
  }
});

router.delete('/:id/subject-preferences/:subjectId', async (req, res) => {
  try {
    const facultyId = Number(req.params.id);
    const subjectId = Number(req.params.subjectId);

    if (!Number.isFinite(facultyId)) {
      return res.status(400).json({ error: 'Invalid faculty id' });
    }

    if (!Number.isFinite(subjectId)) {
      return res.status(400).json({ error: 'Invalid subject id' });
    }

    // Verify department constraint
    const facultyResp = await supabaseAdmin
      .from('faculty')
      .select('department_id')
      .eq('faculty_id', facultyId)
      .maybeSingle();

    if (facultyResp.error) throw facultyResp.error;

    const faculty = facultyResp.data;
    if (!faculty) {
      return res.status(404).json({ error: 'Faculty member not found' });
    }

    const subjectResp = await supabaseAdmin
      .from('subjects')
      .select('department_id')
      .eq('subject_id', subjectId)
      .maybeSingle();

    if (subjectResp.error) throw subjectResp.error;

    const subject = subjectResp.data;
    if (!subject) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    if (faculty.department_id !== subject.department_id) {
      return res.status(403).json({ error: 'Cannot delete: subject is not in faculty\'s department' });
    }

    const deleted = await deleteFacultySubjectPreference({ facultyId, subjectId });
    if (!deleted) {
      return res.status(404).json({ error: 'Preference not found' });
    }

    return res.json({ success: true, deleted });
  } catch (err) {
    console.error('[facultySubjectPreferences] DELETE error:', err);
    return res.status(500).json({ error: err instanceof Error && err.message ? err.message : 'Unknown error' });
  }
});

router.post('/:id/subject-preferences/auto-generate', async (req, res) => {
  try {
    const facultyId = Number(req.params.id);
    if (!Number.isFinite(facultyId)) {
      return res.status(400).json({ error: 'Invalid faculty id' });
    }

    const faculty = await loadFaculty(facultyId);
    if (!faculty) {
      return res.status(404).json({ error: 'Faculty member not found' });
    }

    const result = await autoGenerateFacultySubjectPreferences({ facultyId });
    return res.status(201).json({ ...result, faculty });
  } catch (err) {
    console.error('[facultySubjectPreferences] AUTO-GENERATE error:', err);
    return res.status(500).json({ error: err instanceof Error && err.message ? err.message : 'Unknown error' });
  }
});

export default router;