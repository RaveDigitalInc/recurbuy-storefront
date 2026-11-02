import { escapeHtml } from './dom-html.js';

/** sessionStorage key for Magento-parity AccS success flash across SPA hash navigations. */
export const ACCOUNT_SUCCESS_FLASH_KEY = 'recurbuy.account.successFlash';

/**
 * Magento `messageManager->addSuccessMessage` copy keyed by storefront action id.
 * @type {Readonly<Record<string, string>>}
 */
export const ACCOUNT_SUCCESS_MESSAGES = Object.freeze({
  'save-payment': 'Payment has been successfully saved.',
  'save-next-payment-date': 'Next Payment Date has been successfully changed.',
  'save-plan': 'Subscription Plan has been successfully changed.',
  'save-item': 'The subscription has been updated successfully.',
  cancel: 'The subscription was successfully canceled.',
  extend: 'The subscription was successfully extended.',
  'skip-next': 'The next subscription order was skipped successfully.',
  'remove-item': 'The product was successfully removed from this subscription.',
  'unskip-item': 'The product was successfully returned to the subscription.',
  'skip-item': 'The product will not be included in the next order. Your subscription will go back to regular orders afterward.',
});

/**
 * @param {string} actionId
 * @returns {string|null}
 */
export function getAccountSuccessMessage(actionId) {
  const key = String(actionId || '');
  return Object.prototype.hasOwnProperty.call(ACCOUNT_SUCCESS_MESSAGES, key)
    ? ACCOUNT_SUCCESS_MESSAGES[key]
    : null;
}

/**
 * Store a success message for the next account paint (detail after edit navigate / reload).
 * @param {string} message
 */
export function setAccountSuccessFlash(message) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(ACCOUNT_SUCCESS_FLASH_KEY, text);
  } catch {
    // Private mode / quota — flash is best-effort.
  }
}

/**
 * Read and clear the pending success flash.
 * @returns {string|null}
 */
export function consumeAccountSuccessFlash() {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const value = sessionStorage.getItem(ACCOUNT_SUCCESS_FLASH_KEY);
    sessionStorage.removeItem(ACCOUNT_SUCCESS_FLASH_KEY);
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

/**
 * AccS success message markup (Magento `.message.success`).
 * @param {string} message
 * @returns {string}
 */
export function renderAccountSuccessMessage(message) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return '';
  return `<div class="message success" role="status"><span>${escapeHtml(text)}</span></div>`;
}

/**
 * Set Magento copy for an action id, if known.
 * @param {string} actionId
 * @returns {boolean} true when a message was stored
 */
export function setAccountSuccessFlashForAction(actionId) {
  const message = getAccountSuccessMessage(actionId);
  if (!message) return false;
  setAccountSuccessFlash(message);
  return true;
}
