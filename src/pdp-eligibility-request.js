import { SUBSCRIPTION_ERROR_CODES } from './contract.js';

/**
 * @typedef {import('@dropins/storefront-pdp/data/models/product-model').ProductModel} ProductModel
 * @typedef {import('@dropins/storefront-pdp/data/models/values-model').ValuesModel} ValuesModel
 * @typedef {import('./contract.js').MoneyAmount} MoneyAmount
 * @typedef {import('./contract.js').SubscriptionEligibility} SubscriptionEligibility
 * @typedef {import('./contract.js').SubscriptionSelection} SubscriptionSelection
 * @typedef {import('./contract.js').SubscriptionError} SubscriptionError
 */

/**
 * Pure eligibility response → next PDP controller fields (no DOM).
 *
 * @param {{
 *   previous: SubscriptionEligibility|null,
 *   selection: SubscriptionSelection,
 *   response: {
 *     data?: SubscriptionEligibility|null,
 *     error?: SubscriptionError|null,
 *   },
 * }} args
 * @returns {{
 *   eligibility: SubscriptionEligibility|null,
 *   error: SubscriptionError|null,
 *   selection: SubscriptionSelection,
 *   viewState: 'hidden'|'error'|'ready',
 * }}
 */
export function deriveEligibilityState({ previous, selection, response }) {
  if (response.error) {
    if (
      response.error.code === SUBSCRIPTION_ERROR_CODES.NOT_FOUND
      || response.error.code === SUBSCRIPTION_ERROR_CODES.NOT_ELIGIBLE
    ) {
      return {
        eligibility: null,
        error: null,
        selection: { purchaseType: 'one_time' },
        viewState: 'hidden',
      };
    }

    return {
      eligibility: null,
      error: response.error,
      selection: { purchaseType: 'one_time' },
      viewState: 'error',
    };
  }

  let eligibility = response.data || null;
  if (!eligibility) {
    return {
      eligibility: null,
      error: null,
      selection: { purchaseType: 'one_time' },
      viewState: 'hidden',
    };
  }

  // options-list can flake on slow AccS; keep merchant PDP copy / renderer.
  if (previous && previous.sku === eligibility.sku) {
    eligibility = {
      ...eligibility,
      renderer: eligibility.renderer || previous.renderer,
      subscribeAndSave: eligibility.subscribeAndSave || previous.subscribeAndSave,
    };
  }

  if (!eligibility.eligible || !eligibility.plans?.length) {
    return {
      eligibility,
      error: null,
      selection: { purchaseType: 'one_time' },
      viewState: 'hidden',
    };
  }

  const defaultPurchaseType = eligibility.allowOneTime === false
    ? 'subscription'
    : (eligibility.defaultPurchaseType || 'one_time');
  const defaultPlanId = eligibility.selectedPlanId || eligibility.plans[0].id;
  const keepPlan = eligibility.plans.some((plan) => plan.id === selection.planId);

  /** @type {SubscriptionSelection} */
  let nextSelection = selection;
  if (!keepPlan) {
    nextSelection = {
      purchaseType: defaultPurchaseType,
      planId: defaultPurchaseType === 'subscription' ? defaultPlanId : undefined,
      customOptionValues: {},
    };
  } else if (
    selection.purchaseType === 'subscription'
    && eligibility.allowOneTime === false
  ) {
    nextSelection = {
      ...selection,
      purchaseType: 'subscription',
    };
  }

  return {
    eligibility,
    error: null,
    selection: nextSelection,
    viewState: 'ready',
  };
}

/**
 * @param {ProductModel} product
 * @param {ValuesModel|null} values
 * @param {import('./contract.js').SubscriptionSelection} [initialSelection]
 * @returns {import('./contract.js').SubscriptionEligibilityRequest & Record<string, any>}
 */
export function buildEligibilityRequest(product, values, initialSelection) {
  const sku = values?.sku || product.variantSku || product.sku;
  const planId = initialSelection?.planId || initialSelection?.subscriptionOptionId;
  const isEditing = initialSelection?.purchaseType === 'subscription' || Boolean(planId);
  // SARP always loads config for the configurable parent; AccS variant
  // selection sets externalId to the child — prefer externalParentId for API.
  const parentExternalId = typeof product.externalParentId === 'string'
    ? product.externalParentId.trim()
    : '';
  const childExternalId = product.externalId ? String(product.externalId) : undefined;
  const catalogExternalId = parentExternalId || childExternalId;
  const selectedChildExternalId = parentExternalId
    && childExternalId
    && parentExternalId !== childExternalId
    ? childExternalId
    : undefined;

  return {
    sku,
    productId: catalogExternalId ? Number(catalogExternalId) : undefined,
    product: {
      ...(catalogExternalId && { externalId: catalogExternalId }),
      ...(selectedChildExternalId && { selectedChildExternalId }),
    },
    ...(planId && { subscriptionOptionId: planId }),
    ...(isEditing && { context: 'edit_item' }),
  };
}

/**
 * @param {{
 *   amount?: number,
 *   currency?: string,
 *   minimumAmount?: number,
 *   maximumAmount?: number,
 * }|null|undefined} price
 * @returns {MoneyAmount|null}
 */
export function toMoney(price) {
  if (!price) return null;

  let value = null;
  if (typeof price.amount === 'number') {
    value = price.amount;
  } else if (typeof price.minimumAmount === 'number') {
    value = price.minimumAmount;
  }

  if (value === null) return null;
  return {
    value,
    currency: price.currency || 'USD',
  };
}
