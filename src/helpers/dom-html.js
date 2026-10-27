/**
 * Escape text for HTML text nodes / attributes.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Merchant PDP copy may include HTML (Subscribe And Save parity).
 * @param {string} value
 * @returns {string}
 */
export function sanitizeMerchantHtml(value) {
  if (typeof value !== 'string' || !value.trim() || typeof DOMParser === 'undefined') {
    return escapeHtml(value || '');
  }

  const doc = new DOMParser().parseFromString(value, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, link, meta').forEach((node) => {
    node.remove();
  });
  doc.body.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim().toLowerCase();
      // Strip inline handlers and javascript: URLs from merchant HTML.
      // eslint-disable-next-line no-script-url -- sanitizer removes this protocol
      if (name.startsWith('on') || val.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
}
