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
        field: 'Code',
        severity: 'critical',
        message: 'Course code is required'
      });
      severity = 'critical';
    }

    if (isEmptyValue(offering.course_no)) {
      issues.push({
        field: 'Course Number',
        severity: 'critical',
        message: 'Course number is required'
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
          message: 'No schedule assigned (MTH or TFS required)'
        });
        severity = 'critical';
      } else if (!mthRooms && !tfsRooms) {
        issues.push({
          field: 'Room Assignment',
          severity: 'critical',
          message: 'No room assigned for scheduled times'
        });
        severity = 'critical';
      } else {
        // One has schedule but no room, or vice versa
        if (mthSchedule && !mthRooms) {
          issues.push({
            field: 'MTH Room',
            severity: 'medium',
            message: 'MTH schedule missing room assignment'
          });
          if (severity !== 'critical') severity = 'medium';
        }
        if (tfsSchedule && !tfsRooms) {
          issues.push({
            field: 'TFS Room',
            severity: 'medium',
            message: 'TFS schedule missing room assignment'
          });
          if (severity !== 'critical') severity = 'medium';
        }
        if (!mthSchedule && mthRooms) {
          issues.push({
            field: 'MTH Schedule',
            severity: 'medium',
            message: 'Room assigned but no MTH schedule'
          });
          if (severity !== 'critical') severity = 'medium';
        }
        if (!tfsSchedule && tfsRooms) {
          issues.push({
            field: 'TFS Schedule',
            severity: 'medium',
            message: 'Room assigned but no TFS schedule'
          });
          if (severity !== 'critical') severity = 'medium';
        }
      }
    }

    // Check other medium priority fields
    const mediumFields = [];
    if (isEmptyValue(offering.descriptive_title)) mediumFields.push('Title');
    if (isEmptyValue(offering.department_id)) mediumFields.push('Department');
    if (isEmptyValue(offering.curr_id)) mediumFields.push('Curriculum');
    if (isEmptyValue(offering.units)) mediumFields.push('Units');
    if (isEmptyValue(offering.lec_hrs)) mediumFields.push('Lecture Hours');

    if (mediumFields.length > 0 && severity !== 'critical') {
      issues.push({
        field: 'Missing Info',
        severity: 'medium',
        message: `Missing: ${mediumFields.join(', ')}`
      });
      severity = 'medium';
    }

    if (issues.length > 0) {
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
