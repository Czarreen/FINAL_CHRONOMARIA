import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const RowHighlightContext = createContext(null);

export function RowHighlightProvider({ children }) {
  const [highlighted, setHighlightedState] = useState({
    rowId: null,
    viewName: null,
    element: null,
  });

  const clearHighlight = useCallback(() => {
    if (highlighted.element) {
      highlighted.element.classList.remove(
        'row-highlighted', 'row-highlighted-critical', 'row-highlighted-medium',
        'row-highlighted-low', 'row-highlighted-entrance'
      );
    }
    setHighlightedState({ rowId: null, viewName: null, element: null });
  }, [highlighted]);

  const setHighlight = useCallback((rowId, viewName, severity = null) => {
    const selector = `[id$="-row-${rowId}"]`;
    const element = document.querySelector(selector);

    if (!element) return;

    clearHighlight();

    const severityClass = severity === 'critical' ? 'row-highlighted-critical'
      : severity === 'medium' ? 'row-highlighted-medium'
      : severity === 'low' ? 'row-highlighted-low'
      : 'row-highlighted';

    element.classList.add(severityClass, 'row-highlighted-entrance');
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    setHighlightedState({ rowId, viewName, element });
  }, [clearHighlight]);

  useEffect(() => {
    if (!highlighted.element) return;

    const handleClickAway = (e) => {
      if (!highlighted.element.contains(e.target)) {
        clearHighlight();
      }
    };

    document.addEventListener('mousedown', handleClickAway);
    return () => document.removeEventListener('mousedown', handleClickAway);
  }, [highlighted, clearHighlight]);

  const value = {
    highlighted,
    setHighlight,
    clearHighlight,
  };

  return (
    <RowHighlightContext.Provider value={value}>
      {children}
    </RowHighlightContext.Provider>
  );
}

export function useRowHighlight() {
  const context = useContext(RowHighlightContext);
  if (!context) {
    throw new Error('useRowHighlight must be used within RowHighlightProvider');
  }
  return context;
}
