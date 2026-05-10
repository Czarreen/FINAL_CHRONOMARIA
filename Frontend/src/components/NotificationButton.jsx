import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Bell, Maximize2, Minimize2 } from 'lucide-react';

export default function NotificationButton({
  items = [],
  title = 'Notifications',
  emptyLabel = 'No issues found.',
  buttonLabel = 'Notifications',
  panelSize = 'md',
  onItemJump,
  onItemEdit,
  onItemResolve,
  severityFilter = 'all',
  onSeverityFilterChange,
  notificationSearch = '',
  onNotificationSearchChange,
  notificationStats = { total: 0, critical: 0, medium: 0, low: 0 },
  searchPlaceholder = 'Search by code or title...',
}) {
  const [open, setOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const [categoryFilter, setCategoryFilter] = useState('all');
  const panelRef = useRef(null);
  const buttonRef = useRef(null);

  // Extract and count categories from notifications
  const categoryCounts = useMemo(() => {
    const counts = {};
    items.forEach((notif) => {
      (notif.issues || []).forEach((issue) => {
        const field = issue.field || 'Other';
        let category = 'Other';

        const f = field.toLowerCase();
        // Room-specific categories
        if (f.includes('name')) category = 'Missing Name';
        else if (f.includes('type')) category = 'Missing Type';
        else if (f.includes('status')) category = 'Missing Status';
        // Shared/Faculty/Subject categories
        else if (f.includes('room')) category = 'Missing Room';
        else if (f.includes('schedule')) category = 'Missing Schedule';
        else if (f.includes('code')) category = 'Missing Code';
        else if (f.includes('title') || f.includes('role') || f.includes('name')) category = 'Missing Title';
        else if (f.includes('department')) category = 'Missing Department';

        counts[category] = (counts[category] || 0) + 1;
      });
    });
    return counts;
  }, [items]);

  // Filter items by category
  const filteredByCategory = useMemo(() => {
    if (categoryFilter === 'all') return items;

    return items.filter((notif) => {
      return (notif.issues || []).some((issue) => {
        const field = issue.field || 'Other';
        let category = 'Other';

        const f2 = field.toLowerCase();
        // Room-specific categories
        if (f2.includes('name')) category = 'Missing Name';
        else if (f2.includes('type')) category = 'Missing Type';
        else if (f2.includes('status')) category = 'Missing Status';
        // Shared/Faculty/Subject categories
        else if (f2.includes('room')) category = 'Missing Room';
        else if (f2.includes('schedule')) category = 'Missing Schedule';
        else if (f2.includes('code')) category = 'Missing Code';
        else if (f2.includes('title') || f2.includes('role') || f2.includes('name')) category = 'Missing Title';
        else if (f2.includes('department')) category = 'Missing Department';

        return category === categoryFilter;
      });
    });
  }, [items, categoryFilter]);

  // Combine category filter with severity filter
  const displayedNotifications = useMemo(() => {
    return filteredByCategory.filter((notif) => {
      if (severityFilter === 'all') return true;
      return notif.severity === severityFilter;
    }).filter((notif) => {
      if (!notificationSearch.trim()) return true;
      const q = notificationSearch.toLowerCase();
      return (notif.title?.toLowerCase() || '').includes(q) ||
             (notif.code?.toLowerCase() || '').includes(q);
    });
  }, [filteredByCategory, severityFilter, notificationSearch]);

  const panelStyle = useMemo(() => ({
    position: 'fixed',
    top: isExpanded ? '6vh' : `${position.top}px`,
    left: isExpanded ? '50%' : `${position.left}px`,
    width: isExpanded ? 'min(960px, calc(100vw - 32px))' : `${position.width}px`,
    height: isExpanded ? 'min(84vh, 900px)' : 'auto',
    transform: isExpanded ? 'translateX(-50%)' : 'none',
  }), [position, isExpanded]);

  const panelSizes = {
    sm: { width: 336, maxHeightClass: 'max-h-72' },
    md: { width: 384, maxHeightClass: 'max-h-80' },
    lg: { width: 520, maxHeightClass: 'max-h-[34rem]' },
    xl: { width: 640, maxHeightClass: 'max-h-[38rem]' },
  };

  const resolvedPanelSize = panelSizes[panelSize] || panelSizes.md;

  function formatIssueDetails(details) {
    if (details == null) {
      return '';
    }

    if (typeof details === 'string') {
      return details;
    }

    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return String(details);
    }
  }

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
      if (!clickedInsidePanel && !clickedButton) {
        setOpen(false);
      }
    }

    function handleWindowChange() {
      if (open) {
        updatePosition();
      }
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
    }
  }, [open]);

  return (
    <div ref={panelRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="btn-primary relative flex items-center gap-2"
      >
        <Bell size={18} />
        <span>{buttonLabel}</span>
        {(notificationStats.total || items.length) > 0 && (
          <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-primary">
            {notificationStats.total || items.length}
          </span>
        )}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={panelStyle}
          className={`z-[9999] overflow-hidden rounded-2xl border border-white/60 bg-white p-4 shadow-2xl backdrop-blur ${isExpanded ? 'flex flex-col' : ''}`}
        >
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-on-surface">{title}</h3>
              <p className="text-xs text-on-surface-variant">{items.length ? `${items.length} item(s) need attention` : emptyLabel}</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsExpanded((current) => !current)}
                className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-slate-100 hover:text-on-surface"
              >
                <span className="sr-only">{isExpanded ? 'Shrink notifications window' : 'Expand notifications window'}</span>
                {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-slate-100 hover:text-on-surface"
              >
                <span className="sr-only">Close notifications</span>
                <AlertCircle size={16} />
              </button>
            </div>
          </div>

          {/* Notification Stats & Filters */}
          <div className="mb-3 space-y-2 border-b border-slate-200 pb-3">
            {/* Summary Stats */}
            <div className="flex gap-2 text-xs">
              <button
                onClick={() => onSeverityFilterChange?.('all')}
                className={`rounded px-2 py-1 font-semibold transition-colors ${
                  severityFilter === 'all'
                    ? 'bg-slate-200 text-on-surface'
                    : 'text-on-surface-variant hover:bg-slate-100'
                }`}
              >
                All ({notificationStats.total})
              </button>
              {notificationStats.critical > 0 && (
                <button
                  onClick={() => onSeverityFilterChange?.('critical')}
                  className={`rounded px-2 py-1 font-semibold transition-colors ${
                    severityFilter === 'critical'
                      ? 'bg-red-200 text-red-900'
                      : 'text-red-700 hover:bg-red-100'
                  }`}
                >
                  🔴 {notificationStats.critical}
                </button>
              )}
              {notificationStats.medium > 0 && (
                <button
                  onClick={() => onSeverityFilterChange?.('medium')}
                  className={`rounded px-2 py-1 font-semibold transition-colors ${
                    severityFilter === 'medium'
                      ? 'bg-amber-200 text-amber-900'
                      : 'text-amber-700 hover:bg-amber-100'
                  }`}
                >
                  🟡 {notificationStats.medium}
                </button>
              )}
              {notificationStats.low > 0 && (
                <button
                  onClick={() => onSeverityFilterChange?.('low')}
                  className={`rounded px-2 py-1 font-semibold transition-colors ${
                    severityFilter === 'low'
                      ? 'bg-blue-200 text-blue-900'
                      : 'text-blue-700 hover:bg-blue-100'
                  }`}
                >
                  🔵 {notificationStats.low}
                </button>
              )}
            </div>

            {/* Category Filters */}
            {Object.keys(categoryCounts).length > 0 && (
              <div className="flex flex-wrap gap-1 text-xs">
                {['Missing Name', 'Missing Type', 'Missing Status', 'Missing Room', 'Missing Schedule', 'Missing Code', 'Missing Title', 'Missing Department', 'Other'].map((category) => {
                  const count = categoryCounts[category];
                  if (!count) return null;
                  return (
                    <button
                      key={category}
                      onClick={() => setCategoryFilter(category)}
                      className={`rounded px-2 py-1 font-semibold transition-colors ${
                        categoryFilter === category
                          ? 'bg-slate-300 text-on-surface'
                          : 'text-on-surface-variant hover:bg-slate-100'
                      }`}
                    >
                      {category} ({count})
                    </button>
                  );
                })}
              </div>
            )}

            {/* Search Input */}
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={notificationSearch}
              onChange={(e) => onNotificationSearchChange?.(e.target.value)}
              className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>

          <div className={`${isExpanded ? 'flex-1 max-h-none' : resolvedPanelSize.maxHeightClass} space-y-2 overflow-y-auto pr-1`}>
            {displayedNotifications.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-on-surface-variant">
                {emptyLabel}
              </div>
            ) : (
              displayedNotifications.map((item) => {
                const severityConfig = {
                  critical: {
                    border: 'border-red-300',
                    bg: 'bg-red-50/80',
                    hover: 'hover:border-red-400 hover:bg-red-100/70',
                    icon: 'bg-red-100 text-red-700',
                    badge: 'bg-red-100 text-red-800',
                    textBadge: 'text-red-800',
                  },
                  medium: {
                    border: 'border-amber-200',
                    bg: 'bg-amber-50/80',
                    hover: 'hover:border-amber-300 hover:bg-amber-100/70',
                    icon: 'bg-amber-100 text-amber-700',
                    badge: 'bg-amber-100 text-amber-800',
                    textBadge: 'text-amber-800',
                  },
                  low: {
                    border: 'border-blue-200',
                    bg: 'bg-blue-50/80',
                    hover: 'hover:border-blue-300 hover:bg-blue-100/70',
                    icon: 'bg-blue-100 text-blue-700',
                    badge: 'bg-blue-100 text-blue-800',
                    textBadge: 'text-blue-800',
                  },
                };

                const severity = item.severity === 'high' ? 'critical' : (item.severity || 'medium');
                const config = severityConfig[severity] || severityConfig.medium;
                const severityLabel = severity.charAt(0).toUpperCase() + severity.slice(1);

                return (
                  <div
                    key={item.id}
                    className={`w-full rounded-xl border ${config.border} ${config.bg} p-3 transition-colors ${config.hover}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className={`mt-0.5 rounded-full p-1.5 ${config.icon}`}>
                        <AlertCircle size={14} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            {item.title && (
                              <p className="text-sm font-semibold text-on-surface break-words">{item.title}</p>
                            )}
                            {item.description && (
                              <p className="text-xs text-on-surface-variant mt-0.5">{item.description}</p>
                            )}
                          </div>
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${config.badge} whitespace-nowrap flex-shrink-0 ml-2`}>
                            {severityLabel}
                          </span>
                        </div>
                        {Array.isArray(item.missingFields) && item.missingFields.length > 0 && (
                          <p className={`text-[10px] uppercase tracking-[0.14em] ${config.textBadge} opacity-75 mb-2`}>
                            Fields: {item.missingFields.join(', ')}
                          </p>
                        )}
                        {Array.isArray(item.issues) && item.issues.length > 0 && (
                          <div className="mt-2 space-y-2 mb-3">
                            {item.issues.map((issue, idx) => (
                              <div key={idx} className="rounded-lg bg-white/50 p-2.5 border border-white/60">
                                <p className="text-xs font-semibold text-on-surface">{issue.message}</p>
                                {issue.details != null && (
                                  <p className="mt-1 text-[10px] leading-relaxed text-on-surface-variant">
                                    {formatIssueDetails(issue.details)}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (typeof onItemJump === 'function') {
                                onItemJump(item);
                              }
                              setOpen(false);
                            }}
                            className={`rounded-full border ${config.border} bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-on-surface-variant transition-colors hover:bg-slate-50`}
                          >
                            Go to row
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (typeof onItemEdit === 'function') {
                                onItemEdit(item);
                              }
                              setOpen(false);
                            }}
                            className="rounded-full bg-primary px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white transition-colors hover:bg-primary/90"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (typeof onItemResolve === 'function') {
                                onItemResolve(item);
                              }
                            }}
                            className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700 transition-colors hover:bg-slate-100"
                          >
                            Resolve
                          </button>
                        </div>
                      </div>
                    </div>
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