export const REQUIRED_FIELDS = ['code', 'course_no', 'section', 'department_id', 'curr_id'];

// Time boundaries (in minutes from midnight)
const EARLIEST_START_MIN = 7 * 60 + 30; // 7:30 AM
const LATEST_END_MIN = 20 * 60;          // 8:00 PM

/**
 * Validate that a schedule string falls within allowed time boundaries.
 * Returns null if valid or no time found, otherwise an error string.
 */
export function validateTimeBoundaries(scheduleStr) {
  if (!scheduleStr || typeof scheduleStr !== 'string') return null;
  const match = scheduleStr.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const startMin = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  const endMin = parseInt(match[3], 10) * 60 + parseInt(match[4], 10);
  if (startMin < EARLIEST_START_MIN) return 'Classes must start no earlier than 7:30 AM';
  if (endMin > LATEST_END_MIN) return 'Classes must end no later than 8:00 PM';
  return null;
}

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

  if (hasSchedule) {
    const boundaryError = validateTimeBoundaries(schedule);
    if (boundaryError) return { valid: false, error: boundaryError };
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
