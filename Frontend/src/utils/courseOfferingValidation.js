export const REQUIRED_FIELDS = ['code', 'course_no', 'section', 'department_id', 'curr_id'];

export function isEmptyValue(value) {
  return !value || (typeof value === 'string' && value.trim() === '');
}

export function validateCourseOfferingForm(data) {
  const errors = {};

  for (const field of REQUIRED_FIELDS) {
    if (isEmptyValue(data[field])) {
      const labels = {
        code: 'Course Code',
        course_no: 'Course Number',
        section: 'Section',
        department_id: 'Department',
        curr_id: 'Curriculum ID',
      };
      errors[field] = `${labels[field]} is required`;
    }
  }

  return errors;
}

export function validateSchedulePair(schedule, room) {
  const hasSchedule = !isEmptyValue(schedule);
  const hasRoom = !isEmptyValue(room);

  if (hasSchedule && !hasRoom) {
    return { valid: false, error: 'Room assignment required for this schedule' };
  }

  if (!hasSchedule && hasRoom) {
    return { valid: false, error: 'Schedule required for this room' };
  }

  return { valid: true, error: null };
}

export function hasAtLeastOneSchedulePair(data) {
  const mthValid = validateSchedulePair(data.mth_schedule, data.mth_room_id).valid;
  const tfsValid = validateSchedulePair(data.tfs_schedule, data.tfs_room_id).valid;

  return mthValid || tfsValid;
}

export function getSchedulePairStatus(schedule, room) {
  const hasSchedule = !isEmptyValue(schedule);
  const hasRoom = !isEmptyValue(room);

  if (hasSchedule && hasRoom) return { status: 'complete', icon: '✓' };
  if (hasSchedule || hasRoom) return { status: 'incomplete', icon: '⚠' };
  return { status: 'empty', icon: null };
}

export function isFormValid(data) {
  const requiredFieldErrors = validateCourseOfferingForm(data);
  if (Object.keys(requiredFieldErrors).length > 0) {
    return false;
  }

  const hasMthValid = validateSchedulePair(data.mth_schedule, data.mth_room_id).valid;
  const hasTfsValid = validateSchedulePair(data.tfs_schedule, data.tfs_room_id).valid;

  if (!hasMthValid && !hasTfsValid) {
    return false;
  }

  return true;
}

export function getDisabledReason(data) {
  const requiredFieldErrors = validateCourseOfferingForm(data);
  if (Object.keys(requiredFieldErrors).length > 0) {
    const missingFields = Object.keys(requiredFieldErrors).slice(0, 2).map(f => {
      const labels = {
        code: 'Course Code',
        course_no: 'Course Number',
        section: 'Section',
        department_id: 'Department',
        curr_id: 'Curriculum ID',
      };
      return labels[f];
    }).join(', ');
    return `Please fill in: ${missingFields}${Object.keys(requiredFieldErrors).length > 2 ? '...' : ''}`;
  }

  const mthValidation = validateSchedulePair(data.mth_schedule, data.mth_room_id);
  const tfsValidation = validateSchedulePair(data.tfs_schedule, data.tfs_room_id);

  if (!mthValidation.valid && !tfsValidation.valid) {
    return 'At least one schedule with room assignment required (MTH or TFS)';
  }

  if (!mthValidation.valid && !isEmptyValue(data.mth_schedule)) {
    return mthValidation.error;
  }

  if (!tfsValidation.valid && !isEmptyValue(data.tfs_schedule)) {
    return tfsValidation.error;
  }

  return null;
}
