/**
 * Subscription shapes shared by the PDP selector, storefront adapters, and cart UI.
 */

/** @typedef {'day'|'week'|'month'|'year'} PeriodUnit */

/**
 * @typedef {Object} SubscriptionPeriod
 * @property {number} value
 * @property {PeriodUnit} unit
 */

/**
 * @typedef {Object} MoneyAmount
 * @property {number} value
 * @property {string} currency
 */

/**
 * @typedef {Object} SubscriptionDiscount
 * @property {'percent'|'fixed'} type
 * @property {number} value
 */

/**
 * @typedef {Object} SubscriptionPlanPrices
 * @property {MoneyAmount} regular
 * @property {MoneyAmount} [initial]
 */

/**
 * @typedef {Object} SubscriptionPlan
 * @property {string} id
 * @property {string} label
 * @property {SubscriptionPeriod} period
 * @property {SubscriptionDiscount} [discount]
 * @property {SubscriptionPlanPrices} prices
 * @property {SubscriptionPeriod} [trial]
 * @property {string} [description]
 * @property {Array<{ label: string, value: string }>} [facts]
 */

/**
 * @typedef {'one_time'|'subscription'} PurchaseType
 */

/**
 * @typedef {Object} SubscriptionCustomOption
 * @property {string} code
 * @property {string} label
 * @property {boolean} required
 * @property {'select'|'text'|'date'} type
 * @property {Array<{value: string, label: string}>} [options]
 */

/**
 * @typedef {Object} SubscriptionEligibilityRequest
 * @property {string|number} [productId]
 * @property {string} sku
 * @property {string} [subscriptionOptionId]
 * @property {'edit_item'} [context]
 * @property {{ externalId?: string, selectedChildExternalId?: string }} [product]
 */

/**
 * @typedef {Object} SubscriptionEligibility
 * @property {string} [productId]
 * @property {string} sku
 * @property {boolean} eligible
 * @property {boolean} allowOneTime
 * @property {PurchaseType} defaultPurchaseType
 * @property {string} [selectedPlanId]
 * @property {SubscriptionPlan[]} plans
 * @property {SubscriptionCustomOption[]} [customOptions]
 * @property {string} [ineligibilityReason]
 * @property {'radiobutton'|'dropdown'} [renderer]
 * @property {{ text?: string, tooltip?: string, isVisible?: boolean }} [subscribeAndSave]
 * @property {string} [productType] Magento catalog type (`bundle`, `configurable`, …)
 * @property {Record<string, { trialPercent?: number, regularPercent?: number }>} [optionPlanData]
 * @property {boolean} [isUsedAdvancedPricing]
 * @property {string} [currency]
 */

/**
 * @typedef {Object} SubscriptionSelection
 * @property {PurchaseType} purchaseType
 * @property {string} [planId]
 * @property {string} [subscriptionOptionId]
 * @property {SubscriptionPlan} [selectedPlan]
 * @property {Record<string, string>} [customOptionValues]
 */

/**
 * @typedef {Object} CartSubscriptionDetails
 * @property {string} planId
 * @property {string} [subscriptionOptionId]
 * @property {string} planLabel
 * @property {SubscriptionPeriod} period
 * @property {MoneyAmount} price
 * @property {string} [startDate]
 * @property {string} [endsLabel]
 * @property {PurchaseType} purchaseType
 */

/**
 * @typedef {Object} SubscriptionError
 * @property {string} code
 * @property {string} message
 */

/**
 * @typedef {Object} SubscriptionEligibilityResponse
 * @property {SubscriptionEligibility} [data]
 * @property {SubscriptionError} [error]
 */

export const SUBSCRIPTION_ERROR_CODES = {
  NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
  NOT_ELIGIBLE: 'SUBSCRIPTION_NOT_ELIGIBLE',
  NETWORK: 'SUBSCRIPTION_NETWORK_ERROR',
  INVALID_REQUEST: 'SUBSCRIPTION_INVALID_REQUEST',
  SERVER: 'SUBSCRIPTION_SERVER_ERROR',
};

/** Magento cart item attribute the price webhook / place-after reads. */
export const RECURBUY_SUBSCRIPTION_OPTION_ID = 'recurbuy_subscription_option_id';

/**
 * AccS catalog field option sku (Admin REST). Mirrors Magento SARP
 * {@code addCustomOption('aw_sarp2_subscription_type')} for quote-item merge identity.
 */
export const ACCS_CART_MERGE_OPTION_SKU = 'recurbuy_subscription_type';

/** Optional start date on the quote line (`YYYY-MM-DD`). */
export const RECURBUY_SUBSCRIPTION_START_DATE = 'recurbuy_subscription_start_date';

/**
 * Storefront presentation on the quote (AccS `setCustomAttributesOnCartItem`).
 * Cart / mini-cart read these from GraphQL `custom_attributes` — not sessionStorage.
 */
export const RECURBUY_PLAN_LABEL = 'recurbuy_plan_label';

/** Serialized period: `{value}|{unit}` e.g. `1|month`, `2|week`. */
export const RECURBUY_BILLING_PERIOD = 'recurbuy_billing_period';

/** Magento “Subscription End Date” value, e.g. `Cancel Anytime`. */
export const RECURBUY_ENDS_LABEL = 'recurbuy_ends_label';

/**
 * Plan unit stamped at add (`{value}|{currency}`, e.g. `169.25|USD`).
 * AccS dynamic-bundle GraphQL `prices.price` is the selection child sum; when Magento
 * skips selection `save_before`, that sum stays catalog/sale. Cart UI reads this attr
 * after navigation when Magento looks like catalog.
 */
export const RECURBUY_PLAN_UNIT = 'recurbuy_plan_unit';

/**
 * Every quote-line attribute code RecurBuy owns. Any other `custom_attributes`
 * entry on a cart line belongs to the host or another module and is never read.
 */
export const RECURBUY_QUOTE_ATTRIBUTE_CODES = Object.freeze([
  RECURBUY_SUBSCRIPTION_OPTION_ID,
  RECURBUY_SUBSCRIPTION_START_DATE,
  RECURBUY_PLAN_LABEL,
  RECURBUY_BILLING_PERIOD,
  RECURBUY_ENDS_LABEL,
  RECURBUY_PLAN_UNIT,
]);
