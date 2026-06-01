import { useState, useEffect, useCallback } from 'react';
import { RowHighlightContext } from './RowHighlightContext.js';
import { clearHighlightedRowElement, highlightRowElement } from '../utils/highlightRow.js';

// Separated into its own file so Vite Fast Refresh can handle it as a
// components-only module (mixing components + hooks in one file breaks HMR).
export function RowHighlightProvider({ children }) {
  const [highlighted, setHighlightedState] = useState({
    rowId: null,
    viewName: null,
    element: null,
  });

  const clearHighlight = useCallback(() => {
    clearHighlightedRowElement();
    setHighlightedState({ rowId: null, viewName: null, element: null });
  }, []);

  const setHighlight = useCallback((rowId, viewName, severity = null, options = {}) => {
    const {
      onHighlighted,
      onFailed,
      ...restOptions
    } = options;

    highlightRowElement(rowId, {
      severity,
      ...restOptions,
      onHighlighted: (element) => {
        setHighlightedState({ rowId, viewName, element });
        if (typeof onHighlighted === 'function') onHighlighted(element);
      },
      onFailed: () => {
        if (typeof onFailed === 'function') onFailed();
      },
    });
  }, []);

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
