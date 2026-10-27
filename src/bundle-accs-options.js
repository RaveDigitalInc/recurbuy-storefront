/**
 * AccS / Catalog Service bundle option UID decoding and selection readers.
 *
 * AccS encodes bundle picks as base64 `bundle/{optionId}/{selectionId}/{qty}`.
 */

/**
 * @typedef {Object} AccsBundleSelection
 * @property {number} selection_id
 * @property {string} [uid]
 * @property {number} price
 * @property {number} qty
 * @property {boolean} is_default
 */

/**
 * @typedef {Object} AccsBundleOption
 * @property {number} option_id
 * @property {AccsBundleSelection[]} selections
 */

/**
 * @param {string|null|undefined} uid
 * @returns {{ optionId: number, selectionId: number, qty: number }|null}
 */
function decodeAccsBundleOptionUid(uid) {
  if (typeof uid !== 'string' || !uid.trim()) return null;
  try {
    const decoded = atob(uid.trim());
    const match = /^bundle\/(\d+)\/(\d+)\/(\d+)$/i.exec(decoded);
    if (!match) return null;
    return {
      optionId: Number(match[1]),
      selectionId: Number(match[2]),
      qty: Number(match[3]) || 1,
    };
  } catch {
    return null;
  }
}

/**
 * @param {string[]|null|undefined} optionsUIDs
 * @returns {Record<number, number>}
 */
export function selectionStateFromAccsOptionUids(optionsUIDs) {
  /** @type {Record<number, number>} */
  const state = {};
  if (!Array.isArray(optionsUIDs)) return state;

  optionsUIDs.forEach((uid) => {
    const decoded = decodeAccsBundleOptionUid(uid);
    if (!decoded) return;
    state[decoded.optionId] = decoded.selectionId;
  });
  return state;
}

/**
 * Child SKUs for the current AccS bundle pick (PDP price calc).
 * Prefers explicit lists on values/selection; otherwise matches `optionsUIDs`
 * against AccS PDP option items (`product.sku`).
 *
 * @param {Record<string, unknown>|null|undefined} values
 * @param {any} [product] AccS `pdp/data` product model
 * @param {{ selectionSkus?: unknown }|null|undefined} [selection]
 * @returns {string[]}
 */
export function selectionSkusFromAccsValues(values, product = null, selection = null) {
  const explicit = firstSkuList(
    selection?.selectionSkus,
    values?.selectionSkus,
    values?.selection_skus,
  );
  if (explicit.length > 0) return explicit;

  const optionsUIDs = Array.isArray(values?.optionsUIDs) ? values.optionsUIDs : [];
  if (optionsUIDs.length === 0 || !product || typeof product !== 'object') {
    return [];
  }

  const wanted = new Set();
  optionsUIDs.forEach((uid) => {
    const decoded = decodeAccsBundleOptionUid(
      typeof uid === 'string' ? uid : String(uid ?? ''),
    );
    if (decoded) {
      wanted.add(`${decoded.optionId}:${decoded.selectionId}`);
    }
  });
  if (wanted.size === 0) return [];

  const options = Array.isArray(product.options) ? product.options : [];
  /** @type {string[]} */
  const skus = [];

  options.forEach((option) => {
    const optionId = Number(option?.id);
    if (!Number.isFinite(optionId) || optionId <= 0) return;

    let items = [];
    if (Array.isArray(option.items)) {
      items = option.items;
    } else if (Array.isArray(option.values)) {
      items = option.values;
    }

    items.forEach((item) => {
      let uid = '';
      if (typeof item?.id === 'string') {
        uid = item.id;
      } else if (typeof item?.value === 'string') {
        uid = item.value;
      }
      const decoded = decodeAccsBundleOptionUid(uid);
      const selectionId = decoded?.selectionId
        ?? Number(item?.selection_id)
        ?? 0;
      if (!selectionId || !wanted.has(`${optionId}:${selectionId}`)) return;

      const sku = readSelectionProductSku(item);
      if (sku && !skus.includes(sku)) {
        skus.push(sku);
      }
    });
  });

  return skus;
}

/**
 * @param {...unknown} candidates
 * @returns {string[]}
 */
function firstSkuList(...candidates) {
  const match = candidates.find((candidate) => {
    if (!Array.isArray(candidate)) return false;
    return candidate.some((entry) => typeof entry === 'string' && entry.trim() !== '');
  });
  if (!match) return [];

  return match
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry !== '');
}

/**
 * @param {any} item
 * @returns {string}
 */
function readSelectionProductSku(item) {
  const product = item?.product;
  if (product && typeof product === 'object') {
    if (typeof product.sku === 'string' && product.sku.trim() !== '') {
      return product.sku.trim();
    }
  }
  if (typeof item?.sku === 'string' && item.sku.trim() !== '') {
    return item.sku.trim();
  }
  return '';
}

/**
 * Read native bundle options from AccS PDP product model (`pdp/data`).
 *
 * @param {any} product AccS ProductModel / GraphQL-shaped complex product
 * @param {boolean} [useAdvancedPricing] When false, use regular (old) price
 *   like mixin `_cancelAdvancedPrices`
 * @returns {AccsBundleOption[]}
 */
export function extractAccsBundleOptions(product, useAdvancedPricing = false) {
  const options = product?.options;
  if (!Array.isArray(options) || options.length === 0) return [];

  return options.flatMap((option) => {
    const optionId = Number(option?.id);
    if (!Number.isFinite(optionId) || optionId <= 0) return [];

    let items = [];
    if (Array.isArray(option.items)) {
      items = option.items;
    } else if (Array.isArray(option.values)) {
      items = option.values;
    }
    if (!items.length) return [];

    const selections = items.flatMap((item) => {
      let uid = '';
      if (typeof item?.id === 'string') {
        uid = item.id;
      } else if (typeof item?.value === 'string') {
        uid = item.value;
      }
      const decoded = decodeAccsBundleOptionUid(uid);
      const selectionId = decoded?.selectionId
        ?? Number(item?.selection_id)
        ?? 0;
      if (!selectionId) return [];

      const qty = decoded?.qty
        || Number(item?.quantity)
        || Number(item?.qty)
        || 1;
      const unitPrice = readAccsSelectionUnitPrice(item, useAdvancedPricing);
      if (unitPrice == null) return [];

      return [{
        selection_id: selectionId,
        uid,
        price: unitPrice,
        qty: qty > 0 ? qty : 1,
        is_default: Boolean(
          item?.isDefault
          || item?.is_default
          || item?.selected,
        ),
      }];
    });

    return selections.length ? [{ option_id: optionId, selections }] : [];
  });
}

/**
 * @param {any} item
 * @param {boolean} useAdvancedPricing
 * @returns {number|null}
 */
function readAccsSelectionUnitPrice(item, useAdvancedPricing) {
  const product = item?.product;
  if (!product || typeof product !== 'object') return null;

  const finalAmount = readMoneyAmount(
    product.price?.final?.amount
    ?? product.prices?.final
    ?? product.price?.final,
  );
  const regularAmount = readMoneyAmount(
    product.price?.regular?.amount
    ?? product.prices?.regular
    ?? product.price?.regular,
  );

  // Without advanced pricing, subscription math uses old/regular.
  if (!useAdvancedPricing && regularAmount != null) return regularAmount;
  if (finalAmount != null) return finalAmount;
  return regularAmount;
}

/**
 * @param {any} raw
 * @returns {number|null}
 */
function readMoneyAmount(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === 'object') {
    if (typeof raw.value === 'number' && Number.isFinite(raw.value)) return raw.value;
    if (typeof raw.amount === 'number' && Number.isFinite(raw.amount)) return raw.amount;
  }
  return null;
}
