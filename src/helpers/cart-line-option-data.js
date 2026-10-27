/**
 * Pure helpers for AccS cart-line Subscription option (no drop-in imports).
 */

/** @type {Set<string>} */
const hiddenUids = new Set();

/**
 * @param {unknown} value
 * @returns {string}
 */
export function asCartLineUid(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : '';
}

/**
 * Resolve server-built cart line value from planOptions (flat or nested by product id).
 *
 * @param {unknown} planOptions
 * @param {string|number|null|undefined} optionId
 * @returns {string}
 */
export function cartLineValueFromPlanOptions(planOptions, optionId) {
  const key = String(optionId ?? '').trim();
  if (!key || key === '0' || !planOptions || typeof planOptions !== 'object') {
    return '';
  }

  const record = /** @type {Record<string, unknown>} */ (planOptions);
  const direct = readCartLineValue(record[key]);
  if (direct) return direct;

  return Object.values(record)
    .map((bucket) => {
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
        return '';
      }
      const nested = /** @type {Record<string, unknown>} */ (bucket);
      // Flat option payloads have title/plan_id/cartLineValue at this level.
      if (
        ('title' in nested || 'cartLineValue' in nested || 'plan_id' in nested)
        && !Object.prototype.hasOwnProperty.call(nested, key)
      ) {
        return '';
      }
      return readCartLineValue(nested[key]);
    })
    .find((value) => value !== '') || '';
}

/**
 * @param {unknown} entry
 * @returns {string}
 */
function readCartLineValue(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return '';
  }
  const { cartLineValue } = /** @type {{ cartLineValue?: unknown }} */ (entry);
  return typeof cartLineValue === 'string' && cartLineValue.trim() !== ''
    ? cartLineValue.trim()
    : '';
}

/**
 * @param {Record<string, unknown>|null|undefined} config
 * @returns {{ uid: string, hide: boolean, rootSku: string, title: string }|null}
 */
export function readCartLineOption(config) {
  const block = config?.cartLineOption;
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    return null;
  }
  const raw = /** @type {Record<string, unknown>} */ (block);
  const uid = asCartLineUid(raw.uid);
  if (!uid) return null;
  return {
    uid,
    hide: raw.hide === true,
    rootSku: typeof raw.rootSku === 'string' ? raw.rootSku : '',
    title: typeof raw.title === 'string' ? raw.title : '',
  };
}

/**
 * @param {string} uid
 */
export function rememberHiddenCartLineUid(uid) {
  const key = asCartLineUid(uid);
  if (key) hiddenUids.add(key);
}

const MERGE_VALUE_ID_RE = /\[#(\d+)\]\s*$/;

/**
 * True when a customizable option of a cart line is the AccS merge field
 * (e.g. {@code Subscription: Monthly 12 (50%) [#14]}) of RecurBuy.
 *
 * The caller has already established that the line is a RecurBuy line
 * ({@code lineOptionId} is that line's own subscription option id). The option
 * is then ours only when its uid is a known cart-line uid, or one of its values
 * ends with {@code [#<lineOptionId>]}. Titles never decide: a host option
 * called "Subscription" or a value like "Gift [#5]" stays untouched.
 *
 * @param {{
 *   customizable_option_uid?: unknown,
 *   values?: Array<{ value?: unknown, label?: unknown }>|null,
 * }|null|undefined} option raw GraphQL {@code customizable_options} entry
 * @param {string} lineOptionId the line's own subscription option id marker
 * @returns {boolean}
 */
export function isCartLineOptionConfiguration(option, lineOptionId) {
  if (!option || typeof option !== 'object') return false;
  const { customizable_option_uid: uid } = option;
  if (isHiddenCartLineOptionUid(typeof uid === 'string' ? uid : '')) return true;

  const id = typeof lineOptionId === 'string' ? lineOptionId.trim() : '';
  if (!id || id === '0' || !Array.isArray(option.values)) return false;
  return option.values.some((entry) => {
    const value = entry?.value ?? entry?.label;
    return typeof value === 'string' && MERGE_VALUE_ID_RE.exec(value.trim())?.[1] === id;
  });
}

/**
 * @param {string|null|undefined} uid
 * @returns {boolean}
 */
export function isHiddenCartLineOptionUid(uid) {
  const key = asCartLineUid(uid);
  return key !== '' && hiddenUids.has(key);
}

/**
 * Filter PDP options by cart-line uid (data level). Titles never decide.
 *
 * @template {{ id?: string, uid?: string }} T
 * @param {T[]|null|undefined} options
 * @returns {T[]|null|undefined}
 */
export function filterHiddenCartLineOptions(options) {
  if (!Array.isArray(options) || hiddenUids.size === 0) {
    return options;
  }
  const kept = options.filter((option) => {
    if (!option || typeof option !== 'object') return true;
    const id = asCartLineUid(option.id) || asCartLineUid(option.uid);
    return !id || !hiddenUids.has(id);
  });
  // Same reference when nothing is hidden, so nothing downstream sees a change.
  return kept.length === options.length ? options : kept;
}

/**
 * @param {Array<{ uid?: string, value?: string }>|null|undefined} enteredOptions
 * @returns {Array<{ uid: string, value: string }>}
 */
export function withoutHiddenCartLineEnteredOptions(enteredOptions) {
  if (!Array.isArray(enteredOptions)) return [];
  return enteredOptions
    .filter((option) => option && typeof option === 'object' && asCartLineUid(option.uid))
    .filter((option) => !isHiddenCartLineOptionUid(option.uid))
    .map((option) => ({
      uid: asCartLineUid(option.uid),
      value: String(option.value ?? ''),
    }));
}

/**
 * Build entered_options row for a subscription plan from subscription-config.
 * Returns null when uid or server cartLineValue is missing (EDS must not invent value).
 *
 * @param {Record<string, unknown>|null|undefined} config
 * @param {string|number|null|undefined} subscriptionOptionId
 * @returns {{ uid: string, value: string }|null}
 */
export function resolveCartLineEnteredOption(config, subscriptionOptionId) {
  const cartLine = readCartLineOption(config);
  if (!cartLine) return null;
  const value = cartLineValueFromPlanOptions(config?.planOptions, subscriptionOptionId);
  if (!value) return null;
  return { uid: cartLine.uid, value };
}

/** @visibleForTesting */
export function resetCartLineOptionHideStateForTests() {
  hiddenUids.clear();
}
