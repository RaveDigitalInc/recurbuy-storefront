import { parseSubscriptionPeriod } from '../format.js';

/**
 * @param {any} priceVal
 * @returns {number}
 */
function parsePriceValue(priceVal) {
  if (typeof priceVal === 'number') return priceVal;
  if (typeof priceVal === 'string') return parseFloat(priceVal) || 0;
  if (typeof priceVal === 'object' && priceVal !== null) {
    if (typeof priceVal.finalAmount === 'number') return priceVal.finalAmount;
    if (typeof priceVal.amount === 'number') return priceVal.amount;
    if (typeof priceVal.value === 'number') return priceVal.value;
    if (typeof priceVal.finalAmount === 'string') return parseFloat(priceVal.finalAmount) || 0;
    if (typeof priceVal.amount === 'string') return parseFloat(priceVal.amount) || 0;
  }
  return 0;
}

const CURRENCY_SYMBOL_MAP = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '¥': 'JPY',
  'руб.': 'RUB',
  руб: 'RUB',
  BYN: 'BYN',
};

/**
 * Maps a PDP currency code or a currency symbol to an ISO code.
 * @param {string} [currencyFormat]
 * @param {string} [rawCurrency]
 * @param {string} [fallback]
 * @returns {string}
 */
function resolveCurrency(currencyFormat, rawCurrency, fallback = 'USD') {
  if (typeof rawCurrency === 'string' && /^[A-Z]{3}$/i.test(rawCurrency.trim())) {
    return rawCurrency.trim().toUpperCase();
  }

  if (currencyFormat) {
    const match = currencyFormat.match(/([^%s\d\s]+)/);
    const symbol = match ? match[1] : null;
    if (symbol && CURRENCY_SYMBOL_MAP[symbol]) {
      return CURRENCY_SYMBOL_MAP[symbol];
    }
  }

  if (rawCurrency && CURRENCY_SYMBOL_MAP[rawCurrency]) {
    return CURRENCY_SYMBOL_MAP[rawCurrency];
  }

  return fallback;
}

/**
 * Magento planOptions are flat when override-children=Yes (`{ optionId: { title } }`),
 * and nested by product id when override=No (`{ childId: { optionId: { title } } }`).
 * Parity with configurable provider `getPlanOptions(selected_product_id)`.
 *
 * @param {Record<string, unknown>|undefined} planOptions
 * @param {string} optionKey
 * @param {string|undefined} [selectedChildId]
 * @param {string|undefined} [parentProductId]
 * @returns {string|undefined}
 */
function resolvePlanTitle(planOptions, optionKey, selectedChildId, parentProductId) {
  if (!planOptions || typeof planOptions !== 'object') return undefined;

  const flatTitle = readTitle(planOptions[optionKey]);
  if (flatTitle) return flatTitle;

  const preferredIds = [selectedChildId, parentProductId].filter(Boolean);
  const preferredTitle = preferredIds
    .map((productId) => {
      const bucket = planOptions[productId];
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return undefined;
      return readTitle(/** @type {Record<string, unknown>} */ (bucket)[optionKey]);
    })
    .find(Boolean);
  if (preferredTitle) return preferredTitle;

  return Object.values(planOptions)
    .map((bucket) => {
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return undefined;
      if ('title' in bucket || 'plan_id' in bucket) return undefined;
      return readTitle(/** @type {Record<string, unknown>} */ (bucket)[optionKey]);
    })
    .find(Boolean);
}

/**
 * @param {unknown} entry
 * @returns {string|undefined}
 */
function readTitle(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
  const { title } = /** @type {{ title?: unknown }} */ (entry);
  return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}

/**
 * True for Magento's missing-title fallback ("Plan 1"), not a merchant plan name.
 * @param {string|undefined|null} label
 * @returns {boolean}
 */
function isPlaceholderPlanLabel(label) {
  return !label || /^Plan \d+$/i.test(String(label).trim());
}

/**
 * Same period + cycle count that Magento prints in subscription details
 * ("Regular Payments / Monthly" + "12 x $22.50" → "Monthly 12").
 *
 * @param {Record<string, unknown>|undefined} details
 * @returns {string|undefined}
 */
function planLabelFromPaymentDetails(details) {
  const regular = details?.regular_payment;
  if (!regular || typeof regular !== 'object') return undefined;

  const block = /** @type {{ label?: unknown, cycles?: unknown }} */ (regular);
  const label = typeof block.label === 'string' ? block.label : '';
  const period = label.includes('/') ? label.split('/').pop()?.trim() : '';
  const cycles = Number(block.cycles);

  if (period && Number.isFinite(cycles) && cycles > 1) {
    return `${period} ${cycles}`;
  }
  return period || undefined;
}

/**
 * @param {string} optionKey
 * @param {Record<string, unknown>} opt
 * @param {import('./storefront-options-list.js').SubscriptionOptionList|null} optionList
 * @param {Record<string, unknown>|undefined} planOptions
 * @param {Record<string, unknown>} details
 * @param {string|undefined} [selectedChildId]
 * @param {string|undefined} [parentProductId]
 * @returns {string}
 */
function resolvePlanLabel(
  optionKey,
  opt,
  optionList,
  planOptions,
  details,
  selectedChildId,
  parentProductId,
) {
  const candidates = [
    optionList?.titles?.[String(optionKey)],
    resolvePlanTitle(planOptions, optionKey, selectedChildId, parentProductId),
    typeof details?.title === 'string' ? details.title : undefined,
    typeof opt?.label === 'string' ? opt.label : undefined,
    typeof opt?.name === 'string' ? opt.name : undefined,
    planLabelFromPaymentDetails(details),
  ];

  const title = candidates.find(
    (value) => typeof value === 'string' && !isPlaceholderPlanLabel(value),
  );
  return title?.trim() || `Plan ${optionKey}`;
}

/**
 * Nested regularPrices.options[optionId][childId] — Magento only exposes the option for
 * children that own it when override=No.
 * @param {unknown} optionNode
 * @param {string|undefined} selectedChildId
 * @returns {boolean}
 */
function optionExistsForSelectedChild(optionNode, selectedChildId) {
  if (!selectedChildId) return true;
  if (!optionNode || typeof optionNode !== 'object' || Array.isArray(optionNode)) return false;
  const record = /** @type {Record<string, any>} */ (optionNode);
  if (record.finalPrice || record.price) return true;
  return Boolean(record[selectedChildId]);
}

/**
 * Sync check from a cached subscription-config payload: does this child (or simple product)
 * expose any subscription option? Used to skip the loading chrome when Override=No and
 * the selected child has no plans.
 *
 * @param {Record<string, unknown>|null|undefined} payload
 * @param {string|undefined} [selectedChildId]
 * @returns {boolean}
 */
export function configHasSubscriptionPlansForChild(payload, selectedChildId) {
  if (!payload || typeof payload !== 'object') return false;
  const options = /** @type {Record<string, unknown>} */ (
    payload.options || payload.regularPrices?.options || {}
  );
  if (!options || typeof options !== 'object') return false;
  return Object.keys(options).some((key) => {
    if (key === '0') return false;
    return optionExistsForSelectedChild(options[key], selectedChildId);
  });
}

/**
 * Configurable regularPrices/subscriptionDetails nest price boxes under child entity ids
 * (Magento configurable provider + selected_product_id). Prefer the selected child when set.
 * @param {unknown} node
 * @param {string|undefined} [selectedChildId]
 * @returns {Record<string, any>}
 */
function unwrapConfigurableOptionNode(node, selectedChildId) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return {};
  }
  const record = /** @type {Record<string, any>} */ (node);
  if (record.finalPrice || record.price || record.regular_payment || record.first_payment) {
    return record;
  }
  if (selectedChildId && record[selectedChildId] && typeof record[selectedChildId] === 'object') {
    return /** @type {Record<string, any>} */ (record[selectedChildId]);
  }
  const nestedChild = Object.values(record).find((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const child = /** @type {Record<string, any>} */ (value);
    return Boolean(
      child.finalPrice || child.price || child.regular_payment || child.first_payment,
    );
  });
  if (nestedChild) {
    return /** @type {Record<string, any>} */ (nestedChild);
  }
  return record;
}

/**
 * @param {Record<string, unknown>|null|undefined} payload
 * @param {string} sku
 * @param {Record<string, any>|undefined} pdpProduct
 * @param {import('./storefront-options-list.js').SubscriptionOptionList|null} [optionList]
 */
export function mapStorefrontPayloadToEligibility(payload, sku, pdpProduct, optionList = null) {
  const planOptions = payload?.planOptions;
  const options = payload?.options || payload?.regularPrices?.options || {};
  const optionKeys = Object.keys(options);
  const selectedChildId = typeof pdpProduct?.selectedChildExternalId === 'string'
    ? pdpProduct.selectedChildExternalId.trim()
    : undefined;
  const parentProductId = payload?.productId != null ? String(payload.productId) : undefined;

  const subscriptionOptionKeys = optionKeys.filter((key) => {
    if (key === '0') return false;
    return optionExistsForSelectedChild(options[key], selectedChildId);
  });
  const eligible = subscriptionOptionKeys.length > 0;

  const oneTimeNode = options['0'] ?? payload?.regularPrices?.options?.['0'];
  const pricesIncludeOneTime = optionExistsForSelectedChild(oneTimeNode, selectedChildId)
    || (!selectedChildId && ('0' in options || '0' in (payload?.regularPrices?.options || {})));
  const allowOneTime = typeof optionList?.allowOneTime === 'boolean'
    ? optionList.allowOneTime
    : pricesIncludeOneTime;

  const rawDefaultType = payload?.preselectDefault?.subscriptionOptionId
    ? 'subscription'
    : (payload?.defaultPurchaseType || 'one_time');
  const normalizedDefaultType = rawDefaultType === 'one-time' ? 'one_time' : rawDefaultType;
  const defaultPurchaseType = allowOneTime ? normalizedDefaultType : 'subscription';
  const selectedPlanId = asPlanId(
    payload?.selectedSubscriptionOptionId
    || payload?.preselectDefault?.subscriptionOptionId,
  );

  const pdpCurrency = pdpProduct?.prices?.final?.currency
    || pdpProduct?.price?.final?.amount?.currency;
  const currency = resolveCurrency(payload?.currencyFormat, pdpCurrency || payload?.currency);

  const plans = subscriptionOptionKeys.map((key) => {
    const opt = unwrapConfigurableOptionNode(options[key] || {}, selectedChildId);
    const detailsNode = payload?.subscriptionDetails?.[key] || {};
    const details = unwrapConfigurableOptionNode(detailsNode, selectedChildId);

    const regularPriceRaw = opt?.finalPrice?.amount
      ?? opt?.price
      ?? unwrapConfigurableOptionNode(
        payload?.regularPrices?.options?.[key],
        selectedChildId,
      )?.finalPrice?.amount
      ?? payload?.finalPrice?.amount
      ?? 0;
    const regularPriceValue = parsePriceValue(regularPriceRaw);

    const firstPayment = details?.first_payment || details?.regular_payment;
    const initialPriceRaw = (firstPayment && typeof firstPayment === 'object')
      ? (firstPayment.finalAmount ?? firstPayment)
      : (details?.first_payment ?? regularPriceValue);
    const initialPriceValue = parsePriceValue(initialPriceRaw);

    const rawPeriod = opt?.finalPrice?.aw_period || details?.period || opt?.aw_period
      || details?.regular_payment?.period;
    const period = parseSubscriptionPeriod(rawPeriod);

    const label = resolvePlanLabel(
      key,
      opt,
      optionList,
      planOptions,
      details,
      selectedChildId,
      parentProductId,
    );
    // Prefer raw detailsNode so nested override=No child buckets still resolve.
    const facts = mapDetailFacts(detailsNode, selectedChildId);

    return {
      id: String(key),
      label,
      period,
      prices: {
        regular: {
          value: regularPriceValue,
          currency,
        },
        ...(initialPriceValue !== regularPriceValue && {
          initial: {
            value: initialPriceValue,
            currency,
          },
        }),
      },
      ...(facts.length && { facts }),
    };
  });

  const renderer = optionList?.renderer
    || normalizeProductPageRenderer(payload?.renderer);
  const subscribeAndSave = optionList?.subscribeAndSave
    || (payload?.subscribeAndSave && typeof payload.subscribeAndSave === 'object'
      ? payload.subscribeAndSave
      : undefined);

  const productType = typeof payload?.productType === 'string'
    ? payload.productType.trim().toLowerCase()
    : undefined;
  const optionPlanData = payload?.optionPlanData && typeof payload.optionPlanData === 'object'
    ? /** @type {Record<string, { trialPercent?: number, regularPercent?: number }>} */ (
      payload.optionPlanData
    )
    : undefined;
  const isUsedAdvancedPricing = Boolean(payload?.isUsedAdvancedPricing);

  return {
    sku,
    ...(parentProductId && { productId: parentProductId }),
    eligible,
    allowOneTime,
    defaultPurchaseType,
    selectedPlanId,
    plans,
    ...(renderer && { renderer }),
    ...(subscribeAndSave && { subscribeAndSave }),
    ...(productType && { productType }),
    ...(optionPlanData && { optionPlanData }),
    isUsedAdvancedPricing,
    currency,
  };
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function asPlanId(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

/**
 * Magento product_page/subscription_options_renderer (+ configurable-* variants).
 * @param {unknown} renderer
 * @returns {'radiobutton'|'dropdown'|undefined}
 */
function normalizeProductPageRenderer(renderer) {
  if (typeof renderer !== 'string') return undefined;
  const value = renderer.trim().toLowerCase();
  if (value === 'dropdown' || value === 'configurable-dropdown') return 'dropdown';
  if (value === 'radiobutton' || value === 'configurable-radiobutton') return 'radiobutton';
  return undefined;
}

/**
 * Visible Magento detail blocks: first / trial / regular payment, start and end.
 * Nested override=No payloads are keyed by child entity id.
 * @param {Record<string, unknown>|undefined} details
 * @param {string|undefined} [selectedChildId]
 * @returns {Array<{ label: string, value: string }>}
 */
function mapDetailFacts(details, selectedChildId) {
  if (!details || typeof details !== 'object') return [];

  const first = Object.values(details)[0];
  const nestedConfigurable = first
    && typeof first === 'object'
    && !('label' in first)
    && !('isShow' in first)
    && !('type' in first);

  /** @type {unknown[]} */
  let blocks;
  if (nestedConfigurable) {
    const childNode = (selectedChildId && details[selectedChildId] && typeof details[selectedChildId] === 'object')
      ? details[selectedChildId]
      : first;
    blocks = Object.values(/** @type {Record<string, unknown>} */ (childNode || {}));
  } else {
    blocks = Object.values(details);
  }

  return blocks.flatMap((block) => {
    if (!block || typeof block !== 'object') return [];
    if (block.isShow === false) return [];
    const label = typeof block.label === 'string' ? block.label.trim() : '';
    const value = typeof block.value === 'string' ? block.value.trim() : '';
    if (!label || !value) return [];
    return [{ label, value }];
  });
}
