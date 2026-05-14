export function normalizeNotificationSeverity(severity) {
  if (severity === 'high') return 'critical';
  if (severity === 'critical' || severity === 'medium' || severity === 'low') return severity;
  return 'medium';
}
