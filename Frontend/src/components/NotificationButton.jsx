import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowLeftRight, Bell, ChevronDown, ChevronRight, Maximize2, Minimize2, X, Zap } from 'lucide-react';

// Maps issue.field values to human-readable category labels
function getIssueCategory(field) {
  if (!field) return 'Other';
  const f = field.toLowerCase();
  if (f.includes('conflict')) return 'Schedule Conflict';
  if (f.includes('name')) return 'Missing Name';
  if (f.includes('type')) return 'Missing Type';
  if (f.includes('status')) return 'Missing Status';
  if (f.includes('room')) return 'Missing Room';
  if (f.includes('schedule')) return 'Missing Schedule';
  if (f.includes('code')) return 'Missing Code';
  if (f.includes('title') || f.includes('role')) return 'Missing Title';
  if (f.includes('department')) return 'Missing Department';
  if (f.includes('curr') || f.includes('curriculum')) return 'Missing Curriculum';
  if (f.includes('unit') || f.includes('lec') || f.includes('lab')) return 'Missing Hours/Units';
  return 'Other';
}

// Fields that support inline quick-fix (simple text/number inputs)
const INLINE_FIXABLE_FIELDS = new Set([
  'code', 'course_no', 'descriptive_title', 'units', 'lec_hrs',
  'subject_lec_hrs', 'subject_lab_hrs', 'department_id', 'curr_id',
  'Course Code', 'Course Number', 'Course Title', 'Credit Units', 'Lecture Hours', 'Lab Hours', 'Department', 'Curriculum',
]);

function getIssueFieldLabel(field) {
  const labelMap = {
    code: 'Course Code',
    course_no: 'Course Number',
    descriptive_title: 'Course Title',
    units: 'Credit Units',
    lec_hrs: 'Lecture Hours',
    lab_hrs: 'Lab Hours',
    subject_lec_hrs: 'Lecture Hours',
    subject_lab_hrs: 'Lab Hours',
    department_id: 'Department',
    curr_id: 'Curriculum',
    schedule: 'Schedule',
    mth_schedule: 'MTH Schedule',
    tfs_schedule: 'TFS Schedule',
    mth_room: 'MTH Room',
    tfs_room: 'TFS Room',
    mth_room_id: 'MTH Room',
    tfs_room_id: 'TFS Room',
    subject_code: 'Subject Code',
    subject_course_no: 'Course Number',
    subject_descriptive_title: 'Subject Title',
    subject_units: 'Subject Units',
    schedule_conflict: 'Schedule Conflict',
  };
  return labelMap[field] || field || 'Field';
}

/**
 * Renders a human-readable summary of an issue's details object.
 * For conflict issues shows "with [code] on [days] in [room]" instead of raw JSON.
 */
function renderIssueDetail(issue) {
  if (!issue.details) return null;
  const f = String(issue.field || '').toLowerCase();

  if (f.includes('conflict')) {
    const d = issue.details;
    const code =
      d.conflicting_code ||
      d.conflicting_offering_code ||
      d.conflicting_subject_code ||
      d.code ||
      '';
    const days = Array.isArray(d.conflicting_days)
      ? d.conflicting_days.join(', ')
      : '';
    const room = d.room || '';
    const parts = [
      code && `conflicts with ${code}`,
      days && `on ${days}`,
      room && `in room ${room}`,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }

  if (typeof issue.details === 'string') return issue.details;
  try {
    const str = JSON.stringify(issue.details);
    return str === '{}' ? null : str;
  } catch {
    return null;
  }
}

/** Mini entity summary card used inside conflict-pair rows */
function ConflictEntityCard({ item, config, onJump, onEdit, closePanelOnAction }) {
  return (
    <div className={`flex-1 min-w-0 rounded-lg border ${config.border} bg-white/70 p-3`}>
      <p className="text-sm font-bold text-on-surface truncate">{item.title || `#${item.entity_id}`}</p>
      {item.description && (
        <p className="text-xs text-on-surface-variant truncate mt-0.5">{item.description}</p>
      )}
      <div className="mt-2 flex gap-1.5">
        {onJump && (
          <button
            type="button"
            onClick={() => { onJump(item); closePanelOnAction?.(); }}
            className={`rounded-full border ${config.border} bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant transition-colors hover:bg-slate-50`}
          >
            Go to
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={() => { onEdit(item); closePanelOnAction?.(); }}
            className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-primary/90"
          >
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

export default function NotificationButton({
  items = [],
  title = 'Notifications',
  emptyLabel = 'No issues found.',
  buttonLabel = 'Notifications',
  buttonClassName = '',
  panelSize = 'md',
  onItemJump,
  onItemEdit,
  onItemResolve,
  onItemInlineSave,
  severityFilter = 'all',
  onSeverityFilterChange,
  notificationSearch = '',
  onNotificationSearchChange,
  notificationStats = { total: 0, critical: 0, medium: 0, low: 0 },
  searchPlaceholder = 'Search by code or title...',
  isRescanning = false,
  totalEntityCount = 0,
}) {
  const [open, setOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [inlineEditingId, setInlineEditingId] = useState(null);
  const [inlineValue, setInlineValue] = useState('');
  const [inlineSaving, setInlineSaving] = useState(false);
  const panelRef = useRef(null);
  const buttonRef = useRef(null);

  const categoryCounts = useMemo(() => {
    const counts = {};
    items.forEach((notif) => {
      (notif.issues || []).forEach((issue) => {
        const category = getIssueCategory(issue.field);
        counts[category] = (counts[category] || 0) + 1;
      });
    });
    return counts;
  }, [items]);

  const filteredByCategory = useMemo(() => {
    if (categoryFilter === 'all') return items;
    return items.filter((notif) =>
      (notif.issues || []).some((issue) => getIssueCategory(issue.field) === categoryFilter)
    );
  }, [items, categoryFilter]);

  const displayedNotifications = useMemo(() => {
    return filteredByCategory
      .filter((notif) => severityFilter === 'all' || notif.severity === severityFilter)
      .filter((notif) => {
        if (!notificationSearch.trim()) return true;
        const q = notificationSearch.toLowerCase();
        const t = notif.title?.toLowerCase() || '';
        const d = notif.description?.toLowerCase() || '';
        const c = notif.code?.toLowerCase() || '';
        return t.includes(q) || d.includes(q) || c.includes(q);
      });
  }, [filteredByCategory, severityFilter, notificationSearch]);

  const groupedNotifications = useMemo(() => {
    const groups = {};
    displayedNotifications.forEach((notif) => {
      const primaryField = notif.issues?.[0]?.field || 'Other';
      const category = getIssueCategory(primaryField);
      if (!groups[category]) groups[category] = [];
      groups[category].push(notif);
    });
    return groups;
  }, [displayedNotifications]);

  const panelSizes = {
    sm: { width: 400, maxHeightClass: 'max-h-80' },
    md: { width: 480, maxHeightClass: 'max-h-[28rem]' },
    lg: { width: 700, maxHeightClass: 'max-h-[36rem]' },
    xl: { width: 820, maxHeightClass: 'max-h-[42rem]' },
  };

  const resolvedPanelSize = panelSizes[panelSize] || panelSizes.md;

  const panelStyle = useMemo(() => ({
    position: 'fixed',
    top: isExpanded ? '4vh' : `${position.top}px`,
    left: isExpanded ? '50%' : `${position.left}px`,
    width: isExpanded ? 'min(1080px, calc(100vw - 32px))' : `${position.width}px`,
    height: isExpanded ? 'min(90vh, 960px)' : 'auto',
    transform: isExpanded ? 'translateX(-50%)' : 'none',
  }), [position, isExpanded]);

  const updatePosition = () => {
    if (isExpanded) return;
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const panelWidth = Math.min(resolvedPanelSize.width, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8));
    const top = rect.bottom + 12;
    setPosition({ top, left, width: panelWidth });
  };

  useEffect(() => {
    function handleClickOutside(event) {
      const clickedInsidePanel = panelRef.current && panelRef.current.contains(event.target);
      const clickedButton = buttonRef.current && buttonRef.current.contains(event.target);
      if (!clickedInsidePanel && !clickedButton) setOpen(false);
    }

    function handleWindowChange() {
      if (open) updatePosition();
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('resize', handleWindowChange);
      window.addEventListener('scroll', handleWindowChange, true);
      updatePosition();
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        window.removeEventListener('resize', handleWindowChange);
        window.removeEventListener('scroll', handleWindowChange, true);
      };
    }

    return undefined;
  }, [open, isExpanded]);

  useEffect(() => {
    if (!open) {
      setIsExpanded(false);
      setInlineEditingId(null);
    }
  }, [open]);

  const toggleGroup = (category) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const expandAll = () => setCollapsedGroups(new Set());
  const collapseAll = () => setCollapsedGroups(new Set(Object.keys(groupedNotifications)));

  const severityConfig = {
    critical: {
      border: 'border-red-300',
      bg: 'bg-red-50/80',
      leftBar: 'bg-red-500',
      icon: 'bg-red-100 text-red-700',
      badge: 'bg-red-100 text-red-800',
      chip: 'bg-red-100 text-red-700 border-red-200',
      groupHeader: 'bg-red-50 border-red-200 text-red-800',
    },
    medium: {
      border: 'border-amber-200',
      bg: 'bg-amber-50/80',
      leftBar: 'bg-amber-400',
      icon: 'bg-amber-100 text-amber-700',
      badge: 'bg-amber-100 text-amber-800',
      chip: 'bg-amber-100 text-amber-700 border-amber-200',
      groupHeader: 'bg-amber-50 border-amber-200 text-amber-800',
    },
    low: {
      border: 'border-blue-200',
      bg: 'bg-blue-50/80',
      leftBar: 'bg-blue-400',
      icon: 'bg-blue-100 text-blue-700',
      badge: 'bg-blue-100 text-blue-800',
      chip: 'bg-blue-100 text-blue-700 border-blue-200',
      groupHeader: 'bg-blue-50 border-blue-200 text-blue-800',
    },
  };

  const statsTotal = Number(notificationStats?.total);
  const totalCount = Number.isFinite(statsTotal) ? statsTotal : items.length;
  const hasCritical = notificationStats.critical > 0;
  const buttonStateClass = hasCritical
    ? 'bg-error text-white hover:bg-error/90'
    : 'bg-primary text-white hover:bg-primary/90';

  const closePanel = () => setOpen(false);

  return (
    <div ref={panelRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`relative flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all active:scale-95 ${buttonStateClass} ${buttonClassName}`}
      >
        <Bell size={18} />
        <span>{buttonLabel}</span>
        {isRescanning ? (
          <span className="ml-1 text-[10px] font-bold opacity-60 animate-pulse">...</span>
        ) : totalCount > 0 ? (
          <span className={`ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-primary${hasCritical ? ' animate-pulse' : ''}`}>
            {totalCount}
          </span>
        ) : null}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={panelStyle}
          className={`z-[9999] overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl backdrop-blur ${isExpanded ? 'flex flex-col' : ''}`}
        >
          {/* Header */}
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-on-surface">{title}</h3>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  {isRescanning ? 'Rechecking...' : (items.length ? `${items.length} item(s) need attention` : emptyLabel)}
                </p>
                {totalEntityCount > 0 && items.length > 0 && (
                  <div className="mt-2.5">
                    <div className="flex justify-between text-[10px] text-on-surface-variant/70 mb-1">
                      <span>{items.length} of {totalEntityCount} have issues</span>
                      <span>{Math.round((items.length / totalEntityCount) * 100)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-red-400 transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.round((items.length / totalEntityCount) * 100))}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setIsExpanded((c) => !c)}
                  className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-slate-100 hover:text-on-surface"
                  title={isExpanded ? 'Shrink panel' : 'Expand panel'}
                >
                  {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-slate-100 hover:text-on-surface"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="px-5 pb-3 border-b border-slate-100 space-y-2.5">
            {/* Severity + expand/collapse row */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-1.5 text-xs flex-wrap">
                <button
                  onClick={() => onSeverityFilterChange?.('all')}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${severityFilter === 'all' ? 'bg-slate-200 text-on-surface' : 'text-on-surface-variant hover:bg-slate-100'}`}
                >
                  All <span className="opacity-70">({notificationStats.total})</span>
                </button>
                {notificationStats.critical > 0 && (
                  <button
                    onClick={() => onSeverityFilterChange?.('critical')}
                    className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${severityFilter === 'critical' ? 'bg-red-200 text-red-900' : 'text-red-600 hover:bg-red-50'}`}
                  >
                    Critical <span className="opacity-80">({notificationStats.critical})</span>
                  </button>
                )}
                {notificationStats.medium > 0 && (
                  <button
                    onClick={() => onSeverityFilterChange?.('medium')}
                    className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${severityFilter === 'medium' ? 'bg-amber-200 text-amber-900' : 'text-amber-600 hover:bg-amber-50'}`}
                  >
                    Medium <span className="opacity-80">({notificationStats.medium})</span>
                  </button>
                )}
                {notificationStats.low > 0 && (
                  <button
                    onClick={() => onSeverityFilterChange?.('low')}
                    className={`rounded-lg px-2.5 py-1 font-semibold transition-colors ${severityFilter === 'low' ? 'bg-blue-200 text-blue-900' : 'text-blue-600 hover:bg-blue-50'}`}
                  >
                    Low <span className="opacity-80">({notificationStats.low})</span>
                  </button>
                )}
              </div>
              {Object.keys(groupedNotifications).length > 1 && (
                <div className="ml-auto flex gap-1">
                  <button onClick={expandAll} className="rounded px-2 py-1 text-[10px] text-on-surface-variant hover:bg-slate-100 transition-colors">Expand all</button>
                  <button onClick={collapseAll} className="rounded px-2 py-1 text-[10px] text-on-surface-variant hover:bg-slate-100 transition-colors">Collapse all</button>
                </div>
              )}
            </div>

            {/* Category chips */}
            {Object.keys(categoryCounts).length > 0 && (
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => setCategoryFilter('all')}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${categoryFilter === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-on-surface-variant hover:bg-slate-200'}`}
                >
                  All types
                </button>
                {Object.entries(categoryCounts).map(([category, count]) => (
                  <button
                    key={category}
                    onClick={() => setCategoryFilter(category === categoryFilter ? 'all' : category)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${categoryFilter === category ? 'bg-slate-700 text-white' : 'bg-slate-100 text-on-surface-variant hover:bg-slate-200'}`}
                  >
                    {category} <span className="opacity-70">({count})</span>
                  </button>
                ))}
              </div>
            )}

            {/* Search */}
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={notificationSearch}
              onChange={(e) => onNotificationSearchChange?.(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 placeholder-slate-400"
            />
          </div>

          {/* Notification list */}
          <div className={`${isExpanded ? 'flex-1 max-h-none' : resolvedPanelSize.maxHeightClass} overflow-y-auto px-4 py-3 space-y-3`}>
            {displayedNotifications.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-on-surface-variant">
                {isRescanning ? 'Rechecking notifications...' : emptyLabel}
              </div>
            ) : (
              Object.entries(groupedNotifications).map(([category, groupItems]) => {
                const isCollapsed = collapsedGroups.has(category);
                const isConflictGroup = category === 'Schedule Conflict';
                return (
                  <div key={category}>
                    {/* Group header */}
                    <button
                      type="button"
                      onClick={() => toggleGroup(category)}
                      className="w-full flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-on-surface-variant transition-colors hover:bg-slate-100"
                    >
                      <span className="flex items-center gap-1.5">
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        {isConflictGroup && <ArrowLeftRight size={12} className="text-red-500" />}
                        {category}
                        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold">{groupItems.length}</span>
                      </span>
                    </button>

                    {!isCollapsed && (
                      <div className="mt-1.5 space-y-2 pl-0.5">
                        {groupItems.map((item) => {
                          const severity = item.severity === 'high' ? 'critical' : (item.severity || 'medium');
                          const config = severityConfig[severity] || severityConfig.medium;
                          const severityLabel = severity.charAt(0).toUpperCase() + severity.slice(1);
                          const isConflictPair = Boolean(item.conflictPeer);

                          const singleIssue = item.issues?.length === 1 ? item.issues[0] : null;
                          const isInlineFixable = singleIssue && INLINE_FIXABLE_FIELDS.has(singleIssue.field);
                          const isThisInlineEditing = inlineEditingId === item.id;

                          // Conflict pair: special horizontal layout
                          if (isConflictPair) {
                            const peer = item.conflictPeer;
                            const conflictIssue = (item.issues || []).find((i) =>
                              String(i.field || '').toLowerCase().includes('conflict')
                            );
                            const detailStr = conflictIssue ? renderIssueDetail(conflictIssue) : null;

                            return (
                              <div
                                key={item.id}
                                className={`rounded-xl border ${config.border} ${config.bg} overflow-hidden`}
                              >
                                {/* Left severity bar */}
                                <div className="flex">
                                  <div className={`w-1 flex-shrink-0 ${config.leftBar}`} />
                                  <div className="flex-1 min-w-0 p-3">
                                    {/* Header row */}
                                    <div className="flex items-center gap-2 mb-2.5">
                                      <div className={`rounded-full p-1 ${config.icon} flex-shrink-0`}>
                                        <ArrowLeftRight size={12} />
                                      </div>
                                      <span className="text-xs font-bold text-on-surface">Schedule Conflict</span>
                                      <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${config.badge} flex-shrink-0`}>
                                        {severityLabel}
                                      </span>
                                    </div>

                                    {/* Side-by-side entity cards */}
                                    <div className="flex items-stretch gap-2 mb-2.5">
                                      <ConflictEntityCard
                                        item={item}
                                        config={config}
                                        onJump={onItemJump}
                                        onEdit={onItemEdit}
                                        closePanelOnAction={closePanel}
                                      />
                                      <div className="flex items-center flex-shrink-0 text-slate-400">
                                        <ArrowLeftRight size={16} />
                                      </div>
                                      <ConflictEntityCard
                                        item={peer}
                                        config={config}
                                        onJump={onItemJump}
                                        onEdit={onItemEdit}
                                        closePanelOnAction={closePanel}
                                      />
                                    </div>

                                    {detailStr && (
                                      <p className="text-[11px] text-on-surface-variant mb-2 px-1">
                                        {detailStr}
                                      </p>
                                    )}

                                    {/* Resolve button */}
                                    <div className="flex justify-end">
                                      <button
                                        type="button"
                                        onClick={() => onItemResolve?.(item)}
                                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600 transition-colors hover:bg-slate-50"
                                      >
                                        Resolve
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          // Standard item card
                          const nonConflictIssues = (item.issues || []).filter(
                            (i) => !String(i.field || '').toLowerCase().includes('conflict')
                          );
                          const conflictIssues = (item.issues || []).filter(
                            (i) => String(i.field || '').toLowerCase().includes('conflict')
                          );

                          return (
                            <div
                              key={item.id}
                              className={`rounded-xl border ${config.border} ${config.bg} overflow-hidden`}
                            >
                              <div className="flex">
                                {/* Left severity bar */}
                                <div className={`w-1 flex-shrink-0 ${config.leftBar}`} />
                                <div className="flex-1 min-w-0 p-3">
                                  {/* Title row */}
                                  <div className="flex items-start gap-2 mb-2">
                                    <div className={`mt-0.5 rounded-full p-1 ${config.icon} flex-shrink-0`}>
                                      <AlertCircle size={12} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      {item.title && (
                                        <p className="text-sm font-semibold text-on-surface leading-snug">{item.title}</p>
                                      )}
                                      {item.description && (
                                        <p className="text-xs text-on-surface-variant mt-0.5">{item.description}</p>
                                      )}
                                    </div>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${config.badge} flex-shrink-0`}>
                                      {severityLabel}
                                    </span>
                                  </div>

                                  {/* Missing field chips */}
                                  {nonConflictIssues.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mb-2">
                                      {nonConflictIssues.map((issue, idx) => (
                                        <span
                                          key={idx}
                                          className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${config.chip}`}
                                        >
                                          {getIssueFieldLabel(issue.field)}
                                        </span>
                                      ))}
                                    </div>
                                  )}

                                  {/* Issue messages */}
                                  {nonConflictIssues.length > 0 && (
                                    <div className="space-y-1.5 mb-2">
                                      {nonConflictIssues.map((issue, idx) => (
                                        <div key={idx} className={`border-l-2 ${config.leftBar.replace('bg-', 'border-')} pl-2`}>
                                          <p className="text-xs text-on-surface leading-snug">{issue.message}</p>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Conflict note (when this item has conflicts but peer has other issues too) */}
                                  {conflictIssues.length > 0 && (
                                    <div className="mb-2">
                                      {conflictIssues.map((issue, idx) => {
                                        const detail = renderIssueDetail(issue);
                                        return (
                                          <div key={idx} className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50/60 px-2.5 py-1.5">
                                            <ArrowLeftRight size={11} className="text-red-500 flex-shrink-0 mt-0.5" />
                                            <p className="text-[11px] text-red-700 leading-snug">
                                              {detail || issue.message}
                                            </p>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {/* Inline quick-fix input */}
                                  {isInlineFixable && isThisInlineEditing && (
                                    <div className="mb-2.5 flex gap-2 items-center">
                                      <input
                                        type="text"
                                        autoFocus
                                        value={inlineValue}
                                        onChange={(e) => setInlineValue(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Escape') { setInlineEditingId(null); setInlineValue(''); }
                                        }}
                                        placeholder={`Enter ${getIssueFieldLabel(singleIssue.field)}...`}
                                        className="flex-1 rounded border border-amber-300 bg-amber-50/50 px-2 py-1 text-xs outline-none focus:border-amber-500"
                                      />
                                      <button
                                        type="button"
                                        disabled={inlineSaving || !inlineValue.trim()}
                                        onClick={async () => {
                                          if (!inlineValue.trim()) return;
                                          setInlineSaving(true);
                                          try {
                                            await onItemInlineSave?.({ offeringId: item.offeringId, field: singleIssue.field, value: inlineValue.trim() });
                                            setInlineEditingId(null);
                                            setInlineValue('');
                                          } finally {
                                            setInlineSaving(false);
                                          }
                                        }}
                                        className="rounded px-2 py-1 text-[11px] font-bold bg-primary text-white disabled:opacity-50 hover:bg-primary/90 transition-colors"
                                      >
                                        {inlineSaving ? '...' : 'Save'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { setInlineEditingId(null); setInlineValue(''); }}
                                        className="rounded p-1 text-slate-400 hover:bg-slate-100 transition-colors"
                                      >
                                        <X size={13} />
                                      </button>
                                    </div>
                                  )}

                                  {/* Action buttons */}
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => { onItemJump?.(item); setOpen(false); }}
                                      className={`rounded-full border ${config.border} bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface-variant transition-colors hover:bg-slate-50`}
                                    >
                                      Go to row
                                    </button>
                                    {isInlineFixable && !isThisInlineEditing && (
                                      <button
                                        type="button"
                                        onClick={() => { setInlineEditingId(item.id); setInlineValue(''); }}
                                        className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-700 transition-colors hover:bg-amber-100 flex items-center gap-1"
                                      >
                                        <Zap size={10} />
                                        Quick Fix
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => { onItemEdit?.(item); setOpen(false); }}
                                      className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-primary/90"
                                    >
                                      Edit
                                    </button>
                                    <span className="text-slate-200">|</span>
                                    <button
                                      type="button"
                                      onClick={() => onItemResolve?.(item)}
                                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:bg-slate-50"
                                    >
                                      Resolve
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
