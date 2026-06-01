import { useContext } from 'react';
import { RowHighlightContext } from './RowHighlightContext.js';

// Hook-only file — keeps Vite Fast Refresh happy (no mixed component+hook exports).
export function useRowHighlight() {
  const context = useContext(RowHighlightContext);
  if (!context) {
    throw new Error('useRowHighlight must be used within RowHighlightProvider');
  }
  return context;
}
