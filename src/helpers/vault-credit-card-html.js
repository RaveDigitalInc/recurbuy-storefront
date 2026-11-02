import { escapeHtml } from './dom-html.js';

/**
 * Magento / APS card-type codes → shopper-facing brand. Placeholders like UNKNOWN are omitted.
 *
 * @type {Record<string, string>}
 */
const BRAND_LABELS = {
  VI: 'Visa',
  VN: 'Visa',
  MC: 'Mastercard',
  SM: 'Mastercard',
  AE: 'American Express',
  DI: 'Discover',
  DN: 'Diners',
  JCB: 'JCB',
};

/**
 * Shopper-visible brand, or null when Commerce sends a useless placeholder.
 *
 * @param {unknown} type
 * @returns {string|null}
 */
export function formatVaultCardBrand(type) {
  const code = String(type ?? '').trim().toUpperCase();
  if (code === '' || code === 'UNKNOWN' || code === 'OT' || code === 'UN') {
    return null;
  }
  return BRAND_LABELS[code] ?? null;
}

/**
 * Magento AccS credit-card payment_details markup (no card-type icon CDN).
 *
 * @param {Record<string, unknown>|null|undefined} details
 * @returns {string} Empty string when maskedCC is missing
 */
export function renderVaultCreditCardHtml(details) {
  if (!details || typeof details !== 'object') {
    return '';
  }

  const maskedCc = String(details.maskedCC ?? '').trim();
  if (maskedCc === '') {
    return '';
  }

  const expiration = String(details.expirationDate ?? '').trim();
  const brand = formatVaultCardBrand(details.type);

  let html = `<div class="credit-card wrapper">
  <div class="card-number"><span>Card Number:</span> <span>****${escapeHtml(maskedCc)}</span></div>`;

  if (expiration !== '') {
    html += `
  <div class="expiration-date"><span>Expiration Date:</span> <span>${escapeHtml(expiration)}</span></div>`;
  }

  if (brand !== null) {
    html += `
  <div class="card-type"><span>${escapeHtml(brand)}</span></div>`;
  }

  html += `
</div>`;

  return html;
}
