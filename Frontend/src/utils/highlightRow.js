const HIGHLIGHT_CLASSES = [
  'row-highlighted',
  'row-highlighted-critical',
  'row-highlighted-medium',
  'row-highlighted-low',
  'row-highlighted-entrance',
];

let activeHighlightElement = null;
let activeHighlightRequestId = 0;
// Cleanup fn for any currently-running MutationObserver
let activeObserverCleanup = null;

function clearElementHighlight(element) {
  if (!element) return;
  element.classList.remove(...HIGHLIGHT_CLASSES);
}

export function clearHighlightedRowElement() {
  clearElementHighlight(activeHighlightElement);
  activeHighlightElement = null;
}

function getSeverityClass(severity) {
  if (severity === 'critical' || severity === 'high') return 'row-highlighted-critical';
  if (severity === 'medium') return 'row-highlighted-medium';
  if (severity === 'low') return 'row-highlighted-low';
  return 'row-highlighted';
}

function applyHighlightToElement(element, { severity, scrollIntoView, behavior, block }) {
  clearHighlightedRowElement();

  const severityClass = getSeverityClass(severity);
  element.classList.add(severityClass);

  // Force CSS animation restart when the same row is highlighted repeatedly.
  element.classList.remove('row-highlighted-entrance');
  void element.offsetWidth;
  element.classList.add('row-highlighted-entrance');

  activeHighlightElement = element;

  if (scrollIntoView) {
    element.scrollIntoView({ behavior, block, inline: 'nearest' });
  }

  return element;
}

export function highlightRowElement(rowId, options = {}) {
  const {
    scrollIntoView = true,
    severity = null,
    behavior = 'smooth',
    block = 'center',
    retry = false,
    // maxWaitMs: how long the MutationObserver will wait before giving up
    maxWaitMs = 2500,
    // Legacy polling params accepted but unused — MutationObserver is used instead
    maxRetries,
    retryDelayMs,
    pollIntervalMs,
    onHighlighted,
    onFailed,
  } = options;

  // Cancel any in-flight MutationObserver from a previous call
  if (activeObserverCleanup) {
    activeObserverCleanup();
    activeObserverCleanup = null;
  }

  const requestId = ++activeHighlightRequestId;
  const selector = `[id$="-row-${rowId}"]`;

  // Try to apply the highlight immediately (same-page direct jump)
  function tryApply() {
    if (requestId !== activeHighlightRequestId) return false;
    const element = document.querySelector(selector);
    if (!element) return false;
    applyHighlightToElement(element, { severity, scrollIntoView, behavior, block });
    if (typeof onHighlighted === 'function') onHighlighted(element);
    return true;
  }

  if (tryApply()) return;

  if (!retry) {
    if (typeof onFailed === 'function') onFailed();
    return;
  }

  // Row not yet in DOM — use MutationObserver to detect the exact moment
  // React commits the new rows after a pagination render. This fires instantly
  // on DOM mutation rather than polling at fixed intervals.
  let observer = null;
  let timeoutHandle = null;

  function cleanup() {
    if (observer) { observer.disconnect(); observer = null; }
    if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
    if (activeObserverCleanup === cleanup) activeObserverCleanup = null;
  }

  activeObserverCleanup = cleanup;

  // Safety timeout — disconnect observer if row never appears
  timeoutHandle = setTimeout(() => {
    cleanup();
    if (requestId !== activeHighlightRequestId) return;
    if (typeof onFailed === 'function') onFailed();
  }, maxWaitMs);

  // Watch document.body for any DOM changes; check for target row on each mutation
  observer = new MutationObserver(() => {
    if (requestId !== activeHighlightRequestId) {
      cleanup();
      return;
    }
    if (tryApply()) {
      cleanup();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
