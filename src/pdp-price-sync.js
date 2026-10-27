import { events } from '@dropins/tools/event-bus.js';
import * as pdpApi from '@dropins/storefront-pdp/api.js';
import {
  calculateConfiguredTotal,
  calculateSubscriptionPrice,
  calculateTrialPrice,
  defaultSelectionState,
  extractAccsBundleOptions,
  rewriteFactMoneyAmounts,
  selectionStateFromAccsOptionUids,
} from './bundle-price.js';
import { toMoney } from './pdp-eligibility-request.js';
import {
  clearSubscriptionPriceBox,
  renderSubscriptionPriceBox,
} from './subscription-price-box.js';
import { clearSubscriptionDetails } from './subscription-selector.js';

/**
 * @typedef {import('./contract.js').SubscriptionEligibility} SubscriptionEligibility
 * @typedef {import('./contract.js').SubscriptionSelection} SubscriptionSelection
 * @typedef {import('@dropins/storefront-pdp/data/models/product-model').ProductModel} ProductModel
 * @typedef {import('@dropins/storefront-pdp/data/models/values-model').ValuesModel} ValuesModel
 */

/**
 * Host price node is hidden only while the subscription price box replaces it,
 * and restored only if RecurBuy hid it.
 *
 * @param {HTMLElement|null|undefined} productPriceRoot
 * @returns {{ setProductPriceVisibility: (showSubscriptionPrice: boolean) => void }}
 */
export function createProductPriceVisibility(productPriceRoot) {
  let priceHiddenByUs = false;

  const setProductPriceVisibility = (showSubscriptionPrice) => {
    if (!productPriceRoot) return;
    if (showSubscriptionPrice) {
      if (priceHiddenByUs || productPriceRoot.hidden) return;
      productPriceRoot.hidden = true;
      priceHiddenByUs = true;
      return;
    }
    if (!priceHiddenByUs) return;
    priceHiddenByUs = false;
    productPriceRoot.hidden = false;
  };

  return { setProductPriceVisibility };
}

/**
 * @param {Record<string, unknown>|undefined} scopeEventOptions
 * @returns {{
 *   standardPrice: import('./contract.js').MoneyAmount|null,
 *   standardRegularPrice: import('./contract.js').MoneyAmount|null,
 * }}
 */
function getStandardPrices(scopeEventOptions) {
  const product = /** @type {ProductModel|null} */ (
    events.lastPayload('pdp/data', scopeEventOptions) ?? null
  );
  return {
    standardPrice: toMoney(product?.prices?.final),
    standardRegularPrice: toMoney(product?.prices?.regular),
  };
}

/**
 * @param {import('./bundle-price.js').AccsBundleOption[]} bundleOptions
 * @param {Record<string, unknown>|undefined} scopeEventOptions
 * @param {Record<string, unknown>|undefined} pdpApiOptions
 * @returns {Record<number, number>}
 */
function resolveBundleSelectionState(
  bundleOptions,
  scopeEventOptions,
  pdpApiOptions,
) {
  const values = /** @type {ValuesModel|null} */ (
    pdpApi.getProductConfigurationValues(pdpApiOptions)
    || events.lastPayload('pdp/values', scopeEventOptions)
    || null
  );
  const product = /** @type {ProductModel|null} */ (
    events.lastPayload('pdp/data', scopeEventOptions) ?? null
  );
  const uids = values?.optionsUIDs
    || /** @type {{ optionUIDs?: string[] }} */ (product)?.optionUIDs
    || [];
  const fromUids = selectionStateFromAccsOptionUids(
    Array.isArray(uids) ? uids : [],
  );
  if (Object.keys(fromUids).length > 0) return fromUids;

  return defaultSelectionState(bundleOptions);
}

/**
 * Bundles: AccS GraphQL priceRange is a catalog min/max, not configured
 * selection × optionPlanData. Selections come from Commerce on `pdp/data`;
 * RecurBuy only supplies percents. Recalc like storefront bundle-options mixin.
 *
 * One-time must keep AccS final/sale selection totals. Subscription % still
 * follows isUsedAdvancedPricing (regular when off). Do not paint one-time with
 * link/regular sum.
 *
 * @param {SubscriptionEligibility|null} eligibility
 * @param {Record<string, unknown>|undefined} scopeEventOptions
 * @param {Record<string, unknown>|undefined} pdpApiOptions
 * @returns {{
 *   eligibilityForUi: SubscriptionEligibility|null,
 *   standardPrice: import('./contract.js').MoneyAmount|null,
 *   standardRegularPrice: import('./contract.js').MoneyAmount|null,
 * }}
 */
export function resolveBundlePricedView(
  eligibility,
  scopeEventOptions,
  pdpApiOptions,
) {
  const catalogPrices = getStandardPrices(scopeEventOptions);
  const product = /** @type {ProductModel|null} */ (
    events.lastPayload('pdp/data', scopeEventOptions) ?? null
  );
  const useAdvanced = Boolean(eligibility?.isUsedAdvancedPricing);
  const planBundleOptions = eligibility?.productType === 'bundle'
    ? extractAccsBundleOptions(product, useAdvanced)
    : [];

  if (eligibility?.productType !== 'bundle' || !planBundleOptions.length) {
    return {
      eligibilityForUi: eligibility,
      standardPrice: catalogPrices.standardPrice,
      standardRegularPrice: catalogPrices.standardRegularPrice,
    };
  }

  const currency = eligibility.currency
    || catalogPrices.standardPrice?.currency
    || 'USD';
  const selectionState = resolveBundleSelectionState(
    planBundleOptions,
    scopeEventOptions,
    pdpApiOptions,
  );
  // AccS already paints product.prices.final with specials for the current
  // configuration. Selection rows often only expose regular/link — do not
  // replace AccS final with that sum.
  const oneTimeBundleOptions = useAdvanced
    ? planBundleOptions
    : extractAccsBundleOptions(product, true);
  const computedOneTimeTotal = calculateConfiguredTotal(
    oneTimeBundleOptions.length ? oneTimeBundleOptions : planBundleOptions,
    selectionState,
  );
  const regularConfiguredTotal = calculateConfiguredTotal(
    planBundleOptions,
    selectionState,
  );
  const accsFinal = catalogPrices.standardPrice;
  const accsFinalValue = accsFinal?.value;
  // When advanced pricing is off, selection rows usually only expose
  // regular/link, so computed "final" collapses to the link sum — keep AccS
  // parent final instead.
  const childrenLackSale = !useAdvanced
    && Math.abs(computedOneTimeTotal - regularConfiguredTotal) < 0.02;
  const oneTimeTotal = (
    typeof accsFinalValue === 'number'
    && Number.isFinite(accsFinalValue)
    && accsFinalValue > 0
    && childrenLackSale
  )
    ? accsFinalValue
    : computedOneTimeTotal;

  const plans = (eligibility.plans || []).map((plan) => {
    const optionId = Number(plan.id);
    const regularValue = calculateSubscriptionPrice(
      planBundleOptions,
      selectionState,
      optionId,
      eligibility.optionPlanData,
    );
    const trialValue = calculateTrialPrice(
      planBundleOptions,
      selectionState,
      optionId,
      eligibility.optionPlanData,
    );

    /** @type {import('./contract.js').SubscriptionPlan} */
    const priced = {
      ...plan,
      prices: {
        regular: { value: regularValue, currency },
        // Prefer regular when there is no real trial;
        // $0 trialPercent must not become display initial.
        ...(trialValue != null
          && trialValue > 0
          && trialValue !== regularValue
          ? { initial: { value: trialValue, currency } }
          : {}),
      },
      facts: rewriteFactMoneyAmounts(plan.facts, regularValue, currency),
    };

    const percent = eligibility.optionPlanData?.[String(plan.id)]?.regularPercent;
    if (percent != null && Number.isFinite(percent) && percent < 100) {
      priced.discount = { type: 'percent', value: 100 - percent };
    }

    return priced;
  });

  return {
    eligibilityForUi: {
      ...eligibility,
      plans,
    },
    standardPrice: { value: oneTimeTotal, currency },
    standardRegularPrice: !useAdvanced
      && regularConfiguredTotal > oneTimeTotal + 0.009
      ? { value: regularConfiguredTotal, currency }
      : (catalogPrices.standardRegularPrice || null),
  };
}

/**
 * Sync price box + host product price visibility from current selection.
 *
 * @param {{
 *   viewState: string,
 *   priceRoot: HTMLElement,
 *   detailsRoot?: HTMLElement|null,
 *   selection: SubscriptionSelection,
 *   standardPrice: import('./contract.js').MoneyAmount|null,
 *   standardRegularPrice: import('./contract.js').MoneyAmount|null,
 *   selectedPlan: import('./contract.js').SubscriptionPlan|null,
 *   setProductPriceVisibility: (show: boolean) => void,
 * }} args
 */
export function syncPdpPriceUi({
  viewState,
  priceRoot,
  detailsRoot = null,
  selection,
  standardPrice,
  standardRegularPrice,
  selectedPlan,
  setProductPriceVisibility,
}) {
  if (viewState === 'ready') {
    renderSubscriptionPriceBox(priceRoot, {
      purchaseType: selection.purchaseType,
      plan: selection.purchaseType === 'subscription' ? selectedPlan : null,
      standardPrice,
      standardRegularPrice,
    });
    setProductPriceVisibility(true);
    return;
  }

  clearSubscriptionPriceBox(priceRoot);
  clearSubscriptionDetails(detailsRoot);
  setProductPriceVisibility(false);
}
