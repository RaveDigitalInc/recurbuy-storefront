/**
 * Magento Save/Item buy_request builder (merchant buildProfileItemBuyRequest port).
 */

export const SUBSCRIPTION_OPTION_ID_KEY = 'recurbuy_subscription_option_id';
export const MAGENTO_SUBSCRIPTION_TYPE_KEY = 'aw_sarp2_subscription_type';

/**
 * @typedef {{
 *   product_id?: number,
 *   selected_product_id?: number,
 *   product_options?: {
 *     configurable_item_options?: Array<{ option_id: string, option_value: number }>,
 *     bundle_options?: Array<{ option_id: number, option_qty: number, option_selections: number[] }>,
 *     grouped_options?: Array<{ id: number, qty: number }>,
 *   },
 * }} ProfileItemConfigureResult
 */

/**
 * @param {number} productId
 * @param {number} qty
 * @param {ProfileItemConfigureResult|null|undefined} configure
 * @returns {Record<string, unknown>}
 */
export function buildProfileItemBuyRequest(productId, qty, configure) {
  const catalogProductId = configure?.product_id != null && Number(configure.product_id) > 0
    ? Number(configure.product_id)
    : productId;

  /** @type {Record<string, unknown>} */
  const buyRequest = {
    product: catalogProductId,
    qty,
  };

  if (configure == null) {
    return buyRequest;
  }

  const configurable = configure.product_options?.configurable_item_options;
  if (Array.isArray(configurable) && configurable.length > 0) {
    /** @type {Record<string, number>} */
    const superAttribute = {};
    for (const option of configurable) {
      const optionId = String(option.option_id ?? '').trim();
      const optionValue = Number(option.option_value);
      if (optionId !== '' && Number.isFinite(optionValue)) {
        superAttribute[optionId] = optionValue;
      }
    }
    buyRequest.super_attribute = superAttribute;
  }

  const bundleOptions = configure.product_options?.bundle_options;
  if (Array.isArray(bundleOptions) && bundleOptions.length > 0) {
    /** @type {Record<string, number[]>} */
    const bundleOption = {};
    /** @type {Record<string, number>} */
    const bundleOptionQty = {};
    for (const option of bundleOptions) {
      const optionId = String(option.option_id);
      bundleOption[optionId] = Array.isArray(option.option_selections)
        ? option.option_selections.map(Number)
        : [];
      bundleOptionQty[optionId] = Number(option.option_qty) || 1;
    }
    buyRequest.bundle_option = bundleOption;
    buyRequest.bundle_option_qty = bundleOptionQty;
  }

  const groupedOptions = configure.product_options?.grouped_options;
  if (Array.isArray(groupedOptions) && groupedOptions.length > 0) {
    /** @type {Record<string, number>} */
    const superGroup = {};
    for (const row of groupedOptions) {
      superGroup[String(row.id)] = Number(row.qty) || 0;
    }
    buyRequest.super_group = superGroup;
  }

  if (configure.selected_product_id != null && Number(configure.selected_product_id) > 0) {
    buyRequest.super_product_config = {
      product_id: Number(configure.selected_product_id),
    };
  }

  return buyRequest;
}

/**
 * Magento SaveItem: array_merge(old info_buyRequest, POST).
 *
 * @param {Record<string, unknown>|null|undefined} storedInfoBuyRequest
 * @param {Record<string, unknown>} formBuyRequest
 * @param {number|null|undefined} subscriptionOptionId
 * @returns {Record<string, unknown>}
 */
export function mergeProfileItemBuyRequest(
  storedInfoBuyRequest,
  formBuyRequest,
  subscriptionOptionId,
) {
  const base = storedInfoBuyRequest && typeof storedInfoBuyRequest === 'object'
    ? { ...storedInfoBuyRequest }
    : {};
  const merged = {
    ...base,
    ...formBuyRequest,
  };

  const optionId = Number(subscriptionOptionId);
  if (Number.isFinite(optionId) && optionId > 0) {
    if (merged[SUBSCRIPTION_OPTION_ID_KEY] == null) {
      merged[SUBSCRIPTION_OPTION_ID_KEY] = optionId;
    }
    if (merged[MAGENTO_SUBSCRIPTION_TYPE_KEY] == null) {
      merged[MAGENTO_SUBSCRIPTION_TYPE_KEY] = optionId;
    }
  }

  return merged;
}

/**
 * Prefill configurable options from stored product_options / info_buyRequest.
 *
 * @param {Record<string, unknown>|null|undefined} productOptions
 * @returns {Array<{ option_id: string, option_value: number }>|null}
 */
export function readInitialConfigurableOptions(productOptions) {
  if (productOptions == null || typeof productOptions !== 'object') {
    return null;
  }

  const extension = productOptions.extension_attributes;
  const fromExtension = extension != null
    && typeof extension === 'object'
    && !Array.isArray(extension)
    ? extension.configurable_item_options
    : null;
  const fromInfo = productOptions.info_buyRequest
    && typeof productOptions.info_buyRequest === 'object'
    ? productOptions.info_buyRequest.super_attribute
    : null;
  const raw = (Array.isArray(fromExtension) ? fromExtension : null)
    ?? (Array.isArray(productOptions.configurable_item_options)
      ? productOptions.configurable_item_options
      : null);

  if (raw != null) {
    /** @type {Array<{ option_id: string, option_value: number }>} */
    const options = [];
    for (const row of raw) {
      if (row == null || typeof row !== 'object') continue;
      const optionId = String(row.option_id ?? '').trim();
      const optionValue = Number(row.option_value);
      if (optionId === '' || !Number.isFinite(optionValue)) continue;
      options.push({ option_id: optionId, option_value: optionValue });
    }
    return options.length > 0 ? options : null;
  }

  if (fromInfo != null && typeof fromInfo === 'object' && !Array.isArray(fromInfo)) {
    /** @type {Array<{ option_id: string, option_value: number }>} */
    const options = [];
    for (const [optionId, value] of Object.entries(fromInfo)) {
      const optionValue = Number(value);
      if (!Number.isFinite(optionValue)) continue;
      options.push({ option_id: String(optionId), option_value: optionValue });
    }
    return options.length > 0 ? options : null;
  }

  return null;
}

/**
 * @param {Record<string, unknown>|null|undefined} productOptions
 * @returns {Record<string, unknown>|null}
 */
export function readStoredInfoBuyRequest(productOptions) {
  if (productOptions == null || typeof productOptions !== 'object') {
    return null;
  }
  const info = productOptions.info_buyRequest;
  return info != null && typeof info === 'object' && !Array.isArray(info)
    ? /** @type {Record<string, unknown>} */ (info)
    : null;
}

/**
 * Hidden Magento aw_sarp2_subscription_type from the line.
 *
 * @param {Record<string, unknown>|null|undefined} item
 * @returns {number|null}
 */
export function readSubscriptionOptionId(item) {
  if (item == null || typeof item !== 'object') {
    return null;
  }
  const direct = Number(item.subscription_option_id);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const info = readStoredInfoBuyRequest(
    /** @type {Record<string, unknown>|null} */ (item.product_options),
  );
  if (info) {
    for (const key of [MAGENTO_SUBSCRIPTION_TYPE_KEY, 'aw_sarp_subscription_type', SUBSCRIPTION_OPTION_ID_KEY]) {
      const value = Number(info[key]);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
  }
  return null;
}
