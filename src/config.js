import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';

// Local AccS options-list often takes 12–15s; a 10s abort showed as (canceled) in DevTools.
export const SUBSCRIPTION_REQUEST_TIMEOUT_MS = 30000;

/**
 * @param {string} key
 * @returns {string|undefined}
 */
function readConfigString(key) {
  const value = getConfigValue(key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * The panel resolves store view and website from the connection token.
 *
 * @returns {{ storefrontUrl: string, connectionToken: string }}
 * @throws {Error} when the URL or the token is missing
 */
export function getValidSubscriptionConfig() {
  const storefrontUrl = readConfigString('subscriptions-storefront-url')?.replace(/\/$/, '');
  const connectionToken = readConfigString('subscriptions-connection-token');

  if (!storefrontUrl || !connectionToken) {
    const missing = [];
    if (!storefrontUrl) missing.push('subscriptions-storefront-url');
    if (!connectionToken) missing.push('subscriptions-connection-token');

    throw new Error(`[Subscriptions Selector Error] Invalid configuration: Missing or empty required keys: ${missing.join(', ')}`);
  }

  return { storefrontUrl, connectionToken };
}
