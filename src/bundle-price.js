/**
 * Bundle price parity for AccS EDS.
 *
 * Selections + unit prices come from Commerce Catalog Service on `pdp/data`
 * (native bundle options) — not from RecurBuy. RecurBuy only supplies
 * `optionPlanData` percents via `subscription-config`.
 *
 * Scale each selection line by plan percent (PHP-like round), then sum.
 */

export {
  extractAccsBundleOptions,
  selectionSkusFromAccsValues,
  selectionStateFromAccsOptionUids,
} from './bundle-accs-options.js';

/**
 * @typedef {import('./bundle-accs-options.js').AccsBundleOption} AccsBundleOption
 * @typedef {import('./bundle-accs-options.js').AccsBundleSelection} AccsBundleSelection
 */

/**
 * @param {AccsBundleOption[]} bundleOptions
 * @returns {Record<number, number>}
 */
export function defaultSelectionState(bundleOptions) {
  /** @type {Record<number, number>} */
  const state = {};
  if (!Array.isArray(bundleOptions)) return state;

  bundleOptions.forEach((option) => {
    const defaultSelection = option.selections?.find((row) => row.is_default)
      || option.selections?.[0];
    if (defaultSelection) {
      state[option.option_id] = defaultSelection.selection_id;
    }
  });
  return state;
}

/**
 * Same bias as PHP round (`_improvedRoundAmount`).
 * @param {number} num
 * @param {number} dec
 * @returns {number}
 */
function improvedRoundAmount(num, dec) {
  const sign = num >= 0 ? 1 : -1;
  return parseFloat(
    (Math.round((num * (10 ** dec)) + (sign * 0.0001)) / (10 ** dec)).toFixed(dec),
  );
}

/**
 * round(amount * percent, 0) / 100 per price amount.
 * @param {number} amount
 * @param {number} percent
 * @returns {number}
 */
function applyPlanPercent(amount, percent) {
  if (!Number.isFinite(amount) || !Number.isFinite(percent)) return amount;
  return improvedRoundAmount(amount * percent, 0) / 100;
}

/**
 * One-off configured total (price-bundle sum before subscription %).
 *
 * @param {AccsBundleOption[]} bundleOptions
 * @param {Record<number, number>} selectionState
 * @returns {number}
 */
export function calculateConfiguredTotal(bundleOptions, selectionState) {
  if (!Array.isArray(bundleOptions)) return 0;

  const total = bundleOptions.reduce((sum, option) => {
    const selectionId = selectionState[option.option_id];
    if (selectionId == null) return sum;
    const selection = option.selections?.find((row) => row.selection_id === selectionId);
    if (!selection) return sum;
    const qty = selection.qty > 0 ? selection.qty : 1;
    return sum + (Math.max(0, selection.price) * qty);
  }, 0);

  return Math.max(0, total);
}

/**
 * Apply percent on each selection line, then sum.
 *
 * @param {AccsBundleOption[]} bundleOptions
 * @param {Record<number, number>} selectionState
 * @param {number} percent
 * @returns {number}
 */
function calculateScaledConfiguredTotal(bundleOptions, selectionState, percent) {
  if (!Number.isFinite(percent)) {
    return calculateConfiguredTotal(bundleOptions, selectionState);
  }

  if (!Array.isArray(bundleOptions)) return 0;

  const total = bundleOptions.reduce((sum, option) => {
    const selectionId = selectionState[option.option_id];
    if (selectionId == null) return sum;
    const selection = option.selections?.find((row) => row.selection_id === selectionId);
    if (!selection) return sum;
    const qty = selection.qty > 0 ? selection.qty : 1;
    const line = Math.max(0, selection.price) * qty;
    return sum + applyPlanPercent(line, percent);
  }, 0);

  return Math.max(0, improvedRoundAmount(total, 2));
}

/**
 * @param {AccsBundleOption[]} bundleOptions
 * @param {Record<number, number>} selectionState
 * @param {number} subscriptionOptionId
 * @param {Record<string, {
 *   trialPercent?: number,
 *   regularPercent?: number,
 * }>|undefined} optionPlanData
 * @returns {number}
 */
export function calculateSubscriptionPrice(
  bundleOptions,
  selectionState,
  subscriptionOptionId,
  optionPlanData,
) {
  const configuredTotal = calculateConfiguredTotal(bundleOptions, selectionState);
  if (!(subscriptionOptionId > 0)) return configuredTotal;
  const plan = optionPlanData?.[String(subscriptionOptionId)];
  const percent = plan?.regularPercent;
  if (percent == null || !Number.isFinite(percent)) return configuredTotal;
  return calculateScaledConfiguredTotal(bundleOptions, selectionState, percent);
}

/**
 * @param {AccsBundleOption[]} bundleOptions
 * @param {Record<number, number>} selectionState
 * @param {number} subscriptionOptionId
 * @param {Record<string, {
 *   trialPercent?: number,
 *   regularPercent?: number,
 * }>|undefined} optionPlanData
 * @returns {number|null}
 */
export function calculateTrialPrice(
  bundleOptions,
  selectionState,
  subscriptionOptionId,
  optionPlanData,
) {
  if (!(subscriptionOptionId > 0)) return null;
  const plan = optionPlanData?.[String(subscriptionOptionId)];
  const percent = plan?.trialPercent;
  // Missing/0 trial percent = no trial price box (do not emit $0 initial).
  if (percent == null || !Number.isFinite(percent) || percent <= 0) return null;
  return calculateScaledConfiguredTotal(bundleOptions, selectionState, percent);
}

/**
 * Replace `$…` money tokens in detail strings when selection totals change.
 *
 * @param {Array<{ label: string, value: string }>|undefined} facts
 * @param {number} newAmount
 * @param {string} currency
 * @param {string} [locale]
 * @returns {Array<{ label: string, value: string }>|undefined}
 */
export function rewriteFactMoneyAmounts(facts, newAmount, currency, locale = 'en-US') {
  if (!Array.isArray(facts) || !facts.length) return facts;
  if (!Number.isFinite(newAmount)) return facts;

  let formatted;
  try {
    formatted = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(newAmount);
  } catch {
    formatted = `$${newAmount.toFixed(2)}`;
  }

  return facts.map((fact) => ({
    ...fact,
    value: String(fact.value).replace(/\$[\d,]+(?:\.\d{1,2})?/g, formatted),
  }));
}
