export const CUSTOMER_READY = 'recurbuy-customer-ready';
export const CUSTOMER_CONTEXT = 'recurbuy-customer-context';
export const CUSTOMER_RESIZE = 'recurbuy-customer-resize';
export const CUSTOMER_UNAUTHENTICATED = 'recurbuy-customer-unauthenticated';

export const CUSTOMER_EMBED_PATH = '/dist/storefront/index.html';

/**
 * @param {string} storefrontUrl
 * @returns {string}
 */
export function customerEmbedUrl(storefrontUrl) {
  const base = String(storefrontUrl || '').replace(/\/$/, '');
  return `${base}${CUSTOMER_EMBED_PATH}`;
}

/**
 * @param {string} storefrontUrl
 * @returns {string}
 */
export function customerPanelOrigin(storefrontUrl) {
  return new URL(customerEmbedUrl(storefrontUrl)).origin;
}
