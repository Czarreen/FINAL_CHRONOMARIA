export function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

export function buildMissingDataNotifications(rows, fields, options = {}) {
  const {
    idKey = 'id',
    titleKey = 'code',
    subtitleKey = 'descriptive_title',
  } = options;

  return rows.flatMap((row, index) => {
    const missingFields = fields.filter((field) => {
      if (!field || !field.key) return false;
      const checker = typeof field.isEmpty === 'function' ? field.isEmpty : isEmptyValue;
      return checker(row[field.key], row);
    });

    if (missingFields.length === 0) return [];

    const titleValue = row[titleKey] || `Row ${index + 1}`;
    const subtitleValue = subtitleKey ? row[subtitleKey] : '';

    return [{
      id: row[idKey] ?? `${index}`,
      title: subtitleValue ? `${titleValue} • ${subtitleValue}` : titleValue,
      description: `${missingFields.length} important field${missingFields.length === 1 ? '' : 's'} missing`,
      missingFields: missingFields.map((field) => field.label || field.key),
      severity: missingFields.length >= 3 ? 'high' : 'medium',
      row,
    }];
  });
}

export function buildCourseOfferingNotifications(offerings) {
  const notifications = [];

  offerings.forEach((offering, index) => {
    const issues = [];
    let severity = 'low';

    // Check critical fields: code and course_no
    if (isEmptyValue(offering.code)) {
      issues.push({
        field: 'Course Code',
        severity: 'critical',
        message: 'Course code is required',
        details: 'Every offering must have a unique course code (e.g., CS101). This is the primary identifier for the course.'
      });
      severity = 'critical';
    }

    if (isEmptyValue(offering.course_no)) {
      issues.push({
        field: 'Course Number',
        severity: 'critical',
        message: 'Course number is required',
        details: 'A course number is needed to identify the specific instance or level of this course (e.g., 101, 201).'
      });
      severity = 'critical';
    }

    // Check schedule completeness logic
    // MTH = Monday-Thursday, TFS = Tuesday-Friday-Saturday
    // University has no classes on Wednesday
    // At least ONE of these should have BOTH schedule AND room
    const mthSchedule = !isEmptyValue(offering.mth_schedule);
    const mthRooms = !isEmptyValue(offering.mth_room_id);
    const tfsSchedule = !isEmptyValue(offering.tfs_schedule);
    const tfsRooms = !isEmptyValue(offering.tfs_room_id);

    const mthComplete = mthSchedule && mthRooms;
    const tfsComplete = tfsSchedule && tfsRooms;

    // If neither schedule is complete
    if (!mthComplete && !tfsComplete) {
      if (!mthSchedule && !tfsSchedule) {
        issues.push({
          field: 'Schedule',
          severity: 'critical',
          message: 'No schedule assigned',
          details: 'The course must be scheduled for either MTH (Monday-Thursday) or TFS (Tuesday-Friday-Saturday), or both. At least one schedule is required.'
        });
        severity = 'critical';
      } else if (!mthRooms && !tfsRooms) {
        issues.push({
          field: 'Room Assignment',
          severity: 'critical',
          message: 'No classroom assigned for scheduled times',
          details: 'Every scheduled time slot (MTH or TFS) must have a classroom assigned. Students need to know where to attend class.'
        });
        severity = 'critical';
      } else {
        // One has schedule but no room, or vice versa
        if (mthSchedule && !mthRooms) {
          issues.push({
            field: 'MTH Room',
            severity: 'medium',
            message: 'MTH schedule is missing room assignment',
            details: 'You have scheduled the course for Monday-Thursday times but haven\'t assigned a classroom. Add a room to complete this schedule.'
          });
          if (severity !== 'critical') severity = 'medium';
        }
        if (tfsSchedule && !tfsRooms) {
          issues.push({
            field: 'TFS Room',
            severity: 'medium',
            message: 'TFS schedule is missing room assignment',
            details: 'You have scheduled the course for Tuesday-Friday-Saturday times but haven\'t assigned a classroom. Add a room to complete this schedule.'
          });
          if (severity !== 'critical') severity = 'medium';
        }
        if (!mthSchedule && mthRooms) {
          issues.push({
            field: 'MTH Schedule',
            severity: 'medium',
            message: 'MTH room is assigned but no schedule',
            details: 'You assigned a classroom for Monday-Thursday but haven\'t specified what times the course meets. Add a schedule (e.g., "MWTh 10:00-11:30").'
          });
          if (severity !== 'critical') severity = 'medium';
        }
        if (!tfsSchedule && tfsRooms) {
          issues.push({
            field: 'TFS Schedule',
            severity: 'medium',
            message: 'TFS room is assigned but no schedule',
            details: 'You assigned a classroom for Tuesday-Friday-Saturday but haven\'t specified what times the course meets. Add a schedule (e.g., "TFS 10:00-11:30").'
          });
          if (severity !== 'critical') severity = 'medium';
        }
      }
    }

    // Check other medium priority fields
    const mediumIssues = [];
    if (isEmptyValue(offering.descriptive_title)) {
      mediumIssues.push({
        field: 'Course Title',
        message: 'Course title is missing',
        details: 'Add a descriptive title for the course (e.g., "Introduction to Computer Science"). This helps students understand what the course is about.'
      });
    }
    if (isEmptyValue(offering.department_id)) {
      mediumIssues.push({
        field: 'Department',
        message: 'Department is not assigned',
        details: 'Select which department offers this course. This helps organize courses by academic area.'
      });
    }
    if (isEmptyValue(offering.curr_id)) {
      mediumIssues.push({
        field: 'Curriculum',
        message: 'Curriculum ID is missing',
        details: 'Link this course to a curriculum program. This ensures proper academic planning and degree requirements.'
      });
    }
    if (isEmptyValue(offering.units)) {
      mediumIssues.push({
        field: 'Credit Units',
        message: 'Credit units are not specified',
        details: 'Specify how many credit units (credits) students earn for completing this course (e.g., 3 units).'
      });
    }
    const hasLectureHours = !isEmptyValue(offering.lec_hrs);
    const hasLabHours = !isEmptyValue(offering.lab_hrs);
    if (!hasLectureHours && !hasLabHours) {
      mediumIssues.push({
        field: 'Lecture/Lab Hours',
        message: 'Either lecture hours or lab hours is required',
        details: 'Fill at least one: lecture hours or lab hours. Both can be filled if applicable.'
      });
    }

    if (mediumIssues.length > 0 && severity !== 'critical') {
      mediumIssues.forEach((issue) => {
        issues.push({
          ...issue,
          severity: 'medium'
        });
        severity = 'medium';
      });
    }

    if (issues.length > 0) {
      // Escalate: 4+ issues on a single offering means it's essentially unusable → critical
      if (severity !== 'critical' && issues.length >= 4) {
        severity = 'critical';
      }

      const titleValue = offering.code || `Row ${index + 1}`;
      const subtitleValue = offering.descriptive_title || '';

      notifications.push({
        id: offering.id ?? `${index}`,
        title: subtitleValue ? `${titleValue} • ${subtitleValue}` : titleValue,
        description: issues[0].message,
        issues: issues,
        missingFields: issues.map((i) => i.field),
        severity: severity,
        offeringId: offering.id,
        entity_id: offering.id,
      });
    }
  });

  return notifications;
}
