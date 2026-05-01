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