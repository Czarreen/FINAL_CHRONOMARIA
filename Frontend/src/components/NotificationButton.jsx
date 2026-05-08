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
}) {
  const [open, setOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const panelRef = useRef(null);
  const buttonRef = useRef(null);

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
        {items.length > 0 && (
          <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-primary">
            {items.length}
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

          <div className={`${isExpanded ? 'flex-1 max-h-none' : resolvedPanelSize.maxHeightClass} space-y-2 overflow-y-auto pr-1`}>
            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-on-surface-variant">
                {emptyLabel}
              </div>
            ) : (
              items.map((item) => {
                const severityConfig = {
                  critical: {
                    border: 'border-red-300',
                    bg: 'bg-red-50/80',
                    hover: 'hover:border-red-400 hover:bg-red-100/70',
                    icon: 'bg-red-100 text-red-700',
                    badge: 'bg-red-100 text-red-800',
                  },
                  medium: {
                    border: 'border-amber-200',
                    bg: 'bg-amber-50/80',
                    hover: 'hover:border-amber-300 hover:bg-amber-100/70',
                    icon: 'bg-amber-100 text-amber-700',
                    badge: 'bg-amber-100 text-amber-800',
                  },
                  low: {
                    border: 'border-blue-200',
                    bg: 'bg-blue-50/80',
                    hover: 'hover:border-blue-300 hover:bg-blue-100/70',
                    icon: 'bg-blue-100 text-blue-700',
                    badge: 'bg-blue-100 text-blue-800',
                  },
                };

                const severity = item.severity || 'medium';
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
                        <div className="flex items-start gap-2">
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-on-surface">{item.title}</p>
                            <p className="text-xs text-on-surface-variant">{item.description}</p>
                          </div>
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${config.badge} whitespace-nowrap`}>
                            {severityLabel}
                          </span>
                        </div>
                        {Array.isArray(item.missingFields) && item.missingFields.length > 0 && (
                          <p className={`mt-1 text-[11px] uppercase tracking-[0.16em] ${config.badge.replace('bg-', 'text-').replace(' text-', '/80')} opacity-80`}>
                            Issues: {item.missingFields.join(', ')}
                          </p>
                        )}
                        {Array.isArray(item.issues) && item.issues.length > 0 && (
                          <div className="mt-2 space-y-2">
                            {item.issues.map((issue, idx) => (
                              <div key={idx} className="rounded-lg bg-white/40 p-2">
                                <p className="text-xs font-semibold text-on-surface">{issue.message}</p>
                                <p className="mt-1 text-[10px] leading-relaxed text-on-surface-variant">
                                  {issue.details || issue.message}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
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