export function highlightRowElement(rowId, scrollIntoView = true) {
  const selector = `[id$="-row-${rowId}"]`;
  const element = document.querySelector(selector);

  if (!element) {
    console.warn(`Row element not found for ID: ${rowId}`);
    return null;
  }

  element.classList.add('row-highlighted', 'row-highlighted-entrance');

  if (scrollIntoView) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return element;
}
