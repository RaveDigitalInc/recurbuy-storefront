import { getCookie } from '@dropins/tools/lib.js';

/**
 * AccS drop-in customer JWT cookie (same name Adobe auth uses).
 * Kept inside the package so merchants never need host-repo relative imports.
 *
 * @returns {string|undefined}
 */
export function getShopperAuthToken() {
  const token = getCookie('auth_dropin_user_token');
  return typeof token === 'string' && token.trim() !== '' ? token.trim() : undefined;
}
