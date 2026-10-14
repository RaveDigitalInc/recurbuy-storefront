/**
 * Magento checkoutConfig keys from GET checkout/config (MixedQuote + MixedPaymentMethodList).
 *
 * @typedef {Object} StorefrontCheckoutConfig
 * @property {boolean} isAwSarp2QuoteSubscription
 * @property {boolean} isAwSarp2QuoteMixed
 * @property {string[]} awSarp2MixedPaymentMethodList
 * @property {boolean} isMultishippingCheckoutAvailable
 * @property {boolean} isGuestCheckoutAllowed
 * @property {string} awSarp2GrandTotalBasicCurrencyMessage
 * @property {string} awSarp2GrandTotalYouPayNow
 */

const DEFAULT_GRAND_TOTAL_CHARGED_FOR = 'You will be charged for';
const DEFAULT_GRAND_TOTAL_YOU_PAY_NOW = 'You pay now';

/**
 * @returns {StorefrontCheckoutConfig}
 */
function createDefaultStorefrontCheckoutConfig() {
  return {
    isAwSarp2QuoteSubscription: false,
    isAwSarp2QuoteMixed: false,
    awSarp2MixedPaymentMethodList: [],
    isMultishippingCheckoutAvailable: true,
    isGuestCheckoutAllowed: true,
    awSarp2GrandTotalBasicCurrencyMessage: DEFAULT_GRAND_TOTAL_CHARGED_FOR,
    awSarp2GrandTotalYouPayNow: DEFAULT_GRAND_TOTAL_YOU_PAY_NOW,
  };
}

/**
 * Maps RecurBuy storefront checkout/config JSON to Magento checkoutConfig shape.
 * Empty object (no cart_id) maps to benign defaults — same as Magento with no quote.
 *
 * @param {unknown} payload
 * @returns {StorefrontCheckoutConfig}
 */
export function mapStorefrontCheckoutConfigPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return createDefaultStorefrontCheckoutConfig();
  }

  const row = /** @type {Record<string, unknown>} */ (payload);
  if (Object.keys(row).length === 0) {
    return createDefaultStorefrontCheckoutConfig();
  }

  const defaults = createDefaultStorefrontCheckoutConfig();

  return {
    isAwSarp2QuoteSubscription: readBoolean(row.isAwSarp2QuoteSubscription, false),
    isAwSarp2QuoteMixed: readBoolean(row.isAwSarp2QuoteMixed, false),
    awSarp2MixedPaymentMethodList: readStringList(row.awSarp2MixedPaymentMethodList),
    isMultishippingCheckoutAvailable: readBoolean(
      row.isMultishippingCheckoutAvailable,
      defaults.isMultishippingCheckoutAvailable,
    ),
    isGuestCheckoutAllowed: readBoolean(
      row.isGuestCheckoutAllowed,
      defaults.isGuestCheckoutAllowed,
    ),
    awSarp2GrandTotalBasicCurrencyMessage: readString(
      row.awSarp2GrandTotalBasicCurrencyMessage,
      defaults.awSarp2GrandTotalBasicCurrencyMessage,
    ),
    awSarp2GrandTotalYouPayNow: readString(
      row.awSarp2GrandTotalYouPayNow,
      defaults.awSarp2GrandTotalYouPayNow,
    ),
  };
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function readString(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function readStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
