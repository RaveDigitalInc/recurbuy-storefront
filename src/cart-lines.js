/**
 * Pure helpers over cart lines. No drop-in imports, so they run in Node tests.
 *
 * Accepts both shapes the package sees:
 * - drop-in `CartModel`: `cart.items`
 * - raw GraphQL cart:    `cart.itemsV2.items`
 */

/**
 * @typedef {Object} CartLine
 * @property {string} [uid]
 * @property {string} [sku]
 * @property {string} [topLevelSku]
 * @property {number} [quantity]
 * @property {string[]|Record<string, string>} [selectedOptionsUIDs]
 */

/**
 * @param {Object|null|undefined} cart
 * @returns {CartLine[]}
 */
export function cartLines(cart) {
  // Raw AccS carts often carry both `items` (deprecated, first page, oldest
  // first) and `itemsV2.items` (the full quote). Prefer the full list so a
  // subscription add is not resolved against a stale host line.
  const fromV2 = cart?.itemsV2?.items;
  if (Array.isArray(fromV2) && fromV2.length > 0) {
    return fromV2;
  }
  const items = cart?.items;
  return Array.isArray(items) ? items : [];
}

/**
 * @param {Object|null|undefined} cart
 * @param {string|null|undefined} uid
 * @returns {CartLine|null}
 */
export function findLineByUid(cart, uid) {
  if (!uid) return null;
  return cartLines(cart).find((line) => line?.uid === uid) || null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeSku(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Every SKU a line may expose. Configurable adds send the parent SKU, while the
 * line's own `sku` is the variant (parent is `topLevelSku` / `product.sku`).
 *
 * @param {Object|null|undefined} line
 * @returns {string[]}
 */
function skuCandidates(line) {
  if (!line || typeof line !== 'object') return [];

  const configured = line.configuredVariant || line.configured_variant || {};
  const product = line.product || {};

  return [
    line.sku,
    line.topLevelSku,
    line.parentSku,
    product.sku,
    product.topLevelSku,
    configured.sku,
  ].map(normalizeSku).filter(Boolean);
}

/**
 * Finds the line for an update flow, where the uid is not known up front.
 * A parent-SKU match counts only when it is unambiguous (single line).
 *
 * @param {Object|null|undefined} cart
 * @param {string} sku Parent or simple SKU passed to the add.
 * @param {string} [parentSku]
 * @returns {string|null}
 */
export function findLineUidBySku(cart, sku, parentSku) {
  const wanted = normalizeSku(sku);
  if (!wanted) return null;

  const parent = normalizeSku(parentSku);
  const lines = cartLines(cart).filter((line) => line?.uid);

  const exact = lines.filter((line) => normalizeSku(line.sku) === wanted);
  if (exact.length === 1) return exact[0].uid;

  const related = lines.filter((line) => skuCandidates(line)
    .some((candidate) => candidate === wanted || (parent !== '' && candidate === parent)));

  return related.length === 1 ? related[0].uid : null;
}

/**
 * @param {unknown} value
 * @returns {string[]} sorted, trimmed, non-empty option uids
 */
function optionUids(value) {
  let list = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (value && typeof value === 'object') {
    list = Object.values(value);
  }

  return list
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean)
    .sort();
}

/**
 * @param {string[]} left
 * @param {string[]} right
 * @returns {boolean}
 */
function sameOptions(left, right) {
  return left.length > 0
    && left.length === right.length
    && left.every((uid, index) => uid === right[index]);
}

/**
 * Identity of the line created or grown by the add that just happened.
 * A brand-new uid wins over a same-SKU host line whose quantity stayed the
 * same (subscription adds keep a separate line via entered_options). Quantity
 * growth is used only when no new uid appeared. Configurable children share
 * the parent SKU, so option uids are the variant key.
 *
 * @param {Object|null|undefined} beforeCart
 * @param {Object|null|undefined} afterCart
 * @param {{ sku?: string, parentSku?: string, optionsUIDs?: string[] }} [requested]
 * @returns {string|null}
 */
export function resolveAddedLineUid(beforeCart, afterCart, requested) {
  const after = cartLines(afterCart).filter((line) => line?.uid);
  if (after.length === 0) return null;

  const before = new Map(
    cartLines(beforeCart)
      .filter((line) => line?.uid)
      .map((line) => [line.uid, Number(line.quantity) || 0]),
  );

  const changed = before.size === 0
    ? after
    : after.filter((line) => !before.has(line.uid)
      || (Number(line.quantity) || 0) > before.get(line.uid));

  if (changed.length === 0) return null;

  const newcomers = changed.filter((line) => !before.has(line.uid));
  const pool = newcomers.length > 0 ? newcomers : changed;

  const wantedOptions = optionUids(requested?.optionsUIDs);
  if (wantedOptions.length > 0) {
    const withOptions = pool.filter((line) => lineOptionUids(line).length > 0);
    if (withOptions.length > 0) {
      const byOptions = withOptions.filter((line) => sameOptions(
        lineOptionUids(line),
        wantedOptions,
      ));
      if (byOptions.length === 1) return byOptions[0].uid;
      if (byOptions.length > 1) return null;
    }
  }

  const wantedSku = normalizeSku(requested?.sku);
  const wantedParent = normalizeSku(requested?.parentSku);
  if (wantedSku || wantedParent) {
    const bySku = pool.filter((line) => skuCandidates(line).some((candidate) => (
      candidate === wantedSku || (wantedParent !== '' && candidate === wantedParent)
    )));
    if (bySku.length === 1) return bySku[0].uid;
  }

  return pool.length === 1 ? pool[0].uid : null;
}

/**
 * Configurable option value uids from a CartModel line or a raw GraphQL item.
 *
 * @param {Object|null|undefined} line
 * @returns {string[]}
 */
function lineOptionUids(line) {
  const fromModel = optionUids(line?.selectedOptionsUIDs);
  if (fromModel.length > 0) return fromModel;

  const configurable = line?.configurable_options || line?.configurableOptions;
  if (!Array.isArray(configurable)) return [];

  return optionUids(configurable.map((entry) => (
    entry?.configurable_product_option_value_uid
    || entry?.configurableProductOptionValueUid
    || entry?.value_uid
    || entry?.uid
  )));
}
