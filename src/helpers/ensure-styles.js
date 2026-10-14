const STYLE_ID = 'recurbuy-storefront-eds-css';

/**
 * Inject package CSS once. Resolves via `import.meta.url`, so it works for both
 * `file:packages/…` (import map) and a published npm package (same served path).
 */
export function ensureRecurBuyStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;

  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = new URL('../../styles/recurbuy-storefront.css', import.meta.url).href;
  document.head.appendChild(link);
}
