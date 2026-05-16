import { supabaseAdmin } from './supabase.js';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitTokens(value) {
  return normalizeText(value)
    .split(/[,;/|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractKeywords(value) {
  const keywords = new Set();
  for (const token of splitTokens(value)) {
    for (const part of token.split(/\s+/)) {
      const clean = normalizeUpper(part).replace(/[^A-Z0-9]/g, '');
      if (clean.length >= 2) {
        keywords.add(clean);
      }
    }
  }
  return keywords;
}

export function normalizePriorityLevel(value) {
  const parsed = Number(value);
  if (parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  return 2;
}

function buildSubjectText(subject) {
  return [
    subject.subject_code,
    subject.subject_course_no,
    subject.subject_descriptive_title,
    subject.department_name,
  ]
    .map(normalizeUpper)
    .filter(Boolean)
    .join(' ');
}

function scoreSubjectMatch(facultySpecialization, subject) {
  const sourceKeywords = extractKeywords(facultySpecialization);
  const targetKeywords = extractKeywords(buildSubjectText(subject));
  let score = 0;
  for (const keyword of sourceKeywords) {
    if (targetKeywords.has(keyword)) {
      score += 10;
    }
  }

  const sourceText = normalizeUpper(facultySpecialization);
  const targetTitle = normalizeUpper(subject.subject_descriptive_title);
  const targetCode = normalizeUpper(subject.subject_code);
  const targetCourseNo = normalizeUpper(subject.subject_course_no);

  if (targetTitle && sourceText.includes(targetTitle)) score += 24;
  if (targetCode && sourceText.includes(targetCode)) score += 16;
  if (targetCourseNo && sourceText.includes(targetCourseNo)) score += 14;

  return score;
}

function scoreToPriority(score) {
  if (score >= 30) return 1;
  if (score >= 15) return 2;
  if (score > 0) return 3;
  return null;
}

export function buildFacultyPreferenceMap(rows = []) {
  const map = {};

  for (const row of rows) {
    const facultyId = toNumber(row.faculty_id);
    const subjectId = toNumber(row.subject_id);
    const priority = normalizePriorityLevel(row.priority_level);

    if (facultyId === null || subjectId === null) continue;

    const key = String(facultyId);
    if (!map[key]) {
      map[key] = {};
    }
    map[key][String(subjectId)] = priority;
  }

  return map;
}

export async function fetchFacultySubjectPreferenceRows() {
  const { data, error } = await supabaseAdmin
    .from('faculty_subject_tags')
    .select('faculty_id, subject_id, priority_level')
    .order('faculty_id', { ascending: true })
    .order('priority_level', { ascending: true })
    .order('subject_id', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function fetchFacultySubjectPreferencesForFaculty(facultyId) {
  const facultyResp = await supabaseAdmin
    .from('faculty')
    .select('faculty_id, faculty_name, department_id')
    .eq('faculty_id', facultyId)
    .maybeSingle();

  if (facultyResp.error) throw facultyResp.error;

  const faculty = facultyResp.data;
  if (!faculty) {
    return [];
  }

  const preferenceResp = await supabaseAdmin
    .from('faculty_subject_tags')
    .select('faculty_id, subject_id, priority_level, created_at, updated_at')
    .eq('faculty_id', facultyId)
    .order('priority_level', { ascending: true })
    .order('subject_id', { ascending: true });

  if (preferenceResp.error) throw preferenceResp.error;

  const rows = preferenceResp.data || [];
  const subjectIds = [...new Set(rows.map((row) => Number(row.subject_id)).filter((value) => Number.isFinite(value)))];

  let subjects = [];
  if (subjectIds.length > 0) {
    const subjectResp = await supabaseAdmin
      .from('subjects')
      .select('subject_id, subject_code, subject_course_no, subject_descriptive_title, subject_section, subject_status, department_id')
      .in('subject_id', subjectIds);

    if (subjectResp.error) throw subjectResp.error;
    subjects = subjectResp.data || [];
  }

  const subjectMap = new Map(subjects.map((subject) => [Number(subject.subject_id), subject]));

  return rows
    .map((row) => {
      const subject = subjectMap.get(Number(row.subject_id));
      if (!subject) return null;

      return {
        ...row,
        subject_code: subject.subject_code,
        subject_course_no: subject.subject_course_no,
        subject_descriptive_title: subject.subject_descriptive_title,
        subject_section: subject.subject_section,
        subject_status: subject.subject_status,
        department_id: subject.department_id,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.priority_level !== right.priority_level) return left.priority_level - right.priority_level;
      const leftCode = normalizeUpper(left.subject_code);
      const rightCode = normalizeUpper(right.subject_code);
      if (leftCode !== rightCode) return leftCode.localeCompare(rightCode);
      const leftCourse = normalizeUpper(left.subject_course_no);
      const rightCourse = normalizeUpper(right.subject_course_no);
      if (leftCourse !== rightCourse) return leftCourse.localeCompare(rightCourse);
      const leftSection = normalizeUpper(left.subject_section);
      const rightSection = normalizeUpper(right.subject_section);
      return leftSection.localeCompare(rightSection);
    });
}

export async function saveFacultySubjectPreference({ facultyId, subjectId, priorityLevel }) {
  const normalizedFacultyId = toNumber(facultyId);
  const normalizedSubjectId = toNumber(subjectId);
  const normalizedPriority = normalizePriorityLevel(priorityLevel);

  if (normalizedFacultyId === null) {
    throw new Error('facultyId is required');
  }

  if (normalizedSubjectId === null) {
    throw new Error('subjectId is required');
  }

  // Validate department constraint
  const facultyResp = await supabaseAdmin
    .from('faculty')
    .select('department_id')
    .eq('faculty_id', normalizedFacultyId)
    .maybeSingle();

  if (facultyResp.error) throw facultyResp.error;

  const faculty = facultyResp.data;
  if (!faculty) {
    throw new Error('Faculty member not found');
  }

  const subjectResp = await supabaseAdmin
    .from('subjects')
    .select('department_id')
    .eq('subject_id', normalizedSubjectId)
    .maybeSingle();

  if (subjectResp.error) throw subjectResp.error;

  const subject = subjectResp.data;
  if (!subject) {
    throw new Error('Subject not found');
  }

  // Enforce department constraint
  if (faculty.department_id !== subject.department_id) {
    throw new Error(`Cannot tag faculty with subjects from different departments. Faculty department: ${faculty.department_id}, Subject department: ${subject.department_id}`);
  }

  const payload = {
    faculty_id: normalizedFacultyId,
    subject_id: normalizedSubjectId,
    priority_level: normalizedPriority,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('faculty_subject_tags')
    .upsert(payload, { onConflict: 'faculty_id,subject_id' })
    .select('faculty_id, subject_id, priority_level')
    .single();

  if (error) throw error;

  return data || { faculty_id: normalizedFacultyId, subject_id: normalizedSubjectId, priority_level: normalizedPriority };
}

export async function deleteFacultySubjectPreference({ facultyId, subjectId }) {
  const normalizedFacultyId = toNumber(facultyId);
  const normalizedSubjectId = toNumber(subjectId);

  if (normalizedFacultyId === null) {
    throw new Error('facultyId is required');
  }

  if (normalizedSubjectId === null) {
    throw new Error('subjectId is required');
  }

  const { data, error } = await supabaseAdmin
    .from('faculty_subject_tags')
    .delete()
    .eq('faculty_id', normalizedFacultyId)
    .eq('subject_id', normalizedSubjectId)
    .select('faculty_id, subject_id')
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  return data || null;
}

export async function autoGenerateFacultySubjectPreferences({ facultyId }) {
  const normalizedFacultyId = toNumber(facultyId);
  if (normalizedFacultyId === null) {
    throw new Error('facultyId is required');
  }

  const facultyResp = await supabaseAdmin
    .from('faculty')
    .select('faculty_id, faculty_name, faculty_specialization, department_id, faculty_status')
    .eq('faculty_id', normalizedFacultyId)
    .maybeSingle();

  if (facultyResp.error) throw facultyResp.error;

  const faculty = facultyResp.data;
  if (!faculty) {
    return { faculty: null, generated: [], upserted: 0 };
  }

  // Filter subjects by faculty's department
  const subjectResp = await supabaseAdmin
    .from('subjects')
    .select('subject_id, subject_code, subject_course_no, subject_descriptive_title, department_id, subject_status, subject_section')
    .eq('subject_status', 'active')
    .eq('department_id', faculty.department_id)
    .order('subject_code', { ascending: true })
    .order('subject_course_no', { ascending: true })
    .order('subject_section', { ascending: true })
    .order('subject_id', { ascending: true });

  if (subjectResp.error) throw subjectResp.error;

  const generated = [];
  for (const subject of subjectResp.data || []) {
    const score = scoreSubjectMatch(faculty.faculty_specialization, subject);
    const priorityLevel = scoreToPriority(score);
    if (!priorityLevel) continue;

    generated.push({
      faculty_id: normalizedFacultyId,
      subject_id: Number(subject.subject_id),
      priority_level: priorityLevel,
      updated_at: new Date().toISOString(),
    });
  }

  if (generated.length === 0) {
    return { faculty, generated: [], upserted: 0 };
  }

  const { error } = await supabaseAdmin
    .from('faculty_subject_tags')
    .upsert(generated, { onConflict: 'faculty_id,subject_id' });

  if (error) throw error;

  return { faculty, generated, upserted: generated.length };
}