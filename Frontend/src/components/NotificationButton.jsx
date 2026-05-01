import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Bell } from 'lucide-react';

export default function NotificationButton({
  items = [],
  title = 'Notifications',
  emptyLabel = 'No issues found.',
  buttonLabel = 'Notifications',
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const panelRef = useRef(null);
  const buttonRef = useRef(null);

  const panelStyle = useMemo(() => ({
    position: 'fixed',
    top: `${position.top}px`,
    left: `${position.left}px`,
    width: `${position.width}px`,
  }), [position]);

  const updatePosition = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const panelWidth = Math.min(384, window.innerWidth - 16);
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
        <div ref={panelRef} style={panelStyle} className="z-[9999] rounded-2xl border border-white/60 bg-white p-4 shadow-2xl backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-on-surface">{title}</h3>
              <p className="text-xs text-on-surface-variant">{items.length ? `${items.length} item(s) need attention` : emptyLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-slate-100 hover:text-on-surface"
            >
              <span className="sr-only">Close notifications</span>
              <AlertCircle size={16} />
            </button>
          </div>

          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-on-surface-variant">
                {emptyLabel}
              </div>
            ) : (
              items.map((item) => (
                <div key={item.id} className="rounded-xl border border-amber-200 bg-amber-50/80 p-3">
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 rounded-full bg-amber-100 p-1.5 text-amber-700">
                      <AlertCircle size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-on-surface">{item.title}</p>
                      <p className="text-xs text-on-surface-variant">{item.description}</p>
                      {Array.isArray(item.missingFields) && item.missingFields.length > 0 && (
                        <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-amber-800/80">
                          Missing: {item.missingFields.join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}