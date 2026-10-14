import { fetchGraphQl } from '@dropins/storefront-cart/api.js';
import {
  RECURBUY_BILLING_PERIOD,
  RECURBUY_ENDS_LABEL,
  RECURBUY_PLAN_LABEL,
  RECURBUY_PLAN_UNIT,
  RECURBUY_SUBSCRIPTION_OPTION_ID,
  RECURBUY_SUBSCRIPTION_START_DATE,
} from './contract.js';
import { serializeSubscriptionPeriod } from './format.js';

const SET_CUSTOM_ATTRIBUTES_MUTATION = `
  mutation SetCustomAttributesOnCartItem($input: CartItemCustomAttributesInput!) {
    setCustomAttributesOnCartItem(input: $input) {
      cart {
        id
        itemsV2 {
          items {
            uid
            custom_attributes {
              attribute_code
              value
            }
          }
        }
      }
    }
  }
`;

const UPDATE_CART_ITEMS_MUTATION = `
  mutation UpdateCartItems($cartId: String!, $cartItems: [CartItemUpdateInput!]!) {
    updateCartItems(input: { cart_id: $cartId, cart_items: $cartItems }) {
      cart {
        id
      }
    }
  }
`;

/**
 * Collect SKU strings AccS/drop-in may expose on a cart line.
 * Configurable adds use parent SKU in the mutation; cart lines expose the
 * child as `sku` and the parent as `topLevelSku` (drop-in) / `product.sku` (GQL).
 *
 * @param {Object|null|undefined} item
 * @returns {string[]}
 */
function cartItemSkuCandidates(item) {
  if (!item || typeof item !== 'object') {
    return [];
  }

  const configured = item.configuredVariant || item.configured_variant || {};
  const product = item.product || {};

  return [
    item.sku,
    item.topLevelSku,
    item.parentSku,
    product.sku,
    product.topLevelSku,
    configured.sku,
  ]
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim().toLowerCase());
}

/**
 * Finds the GraphQL UID of a cart item matching the given SKU.
 * Works with drop-in `cart.items` and raw GraphQL `cart.itemsV2.items`.
 *
 * AccS configurable: add with parent SKU (`Configurable-1`); cart item `sku` is
 * the variant (`Configurable-black-L`) and parent is `topLevelSku`.
 *
 * @param {Object} cart Drop-in cart object
 * @param {string} sku Product SKU passed to add (parent or simple)
 * @param {string} [parentSku] Optional parent SKU when `sku` is a variant
 * @returns {string|null} Cart item UID or null if not found
 */
export function findItemUid(cart, sku, parentSku) {
  if (!cart || !sku) {
    return null;
  }

  const items = cart.items || cart.itemsV2?.items || [];
  if (!Array.isArray(items)) {
    return null;
  }

  const wanted = sku.trim().toLowerCase();
  const parent = typeof parentSku === 'string' ? parentSku.trim().toLowerCase() : '';

  const exact = items.filter((item) => {
    if (!item?.uid) return false;
    const own = typeof item.sku === 'string' ? item.sku.trim().toLowerCase() : '';
    return own !== '' && own === wanted;
  });
  if (exact.length === 1) {
    return exact[0].uid;
  }

  // Configurable children share the parent SKU. A parent match is safe only
  // when the cart has a single line for that parent.
  const parentMatches = items.filter((item) => {
    if (!item?.uid) return false;
    return cartItemSkuCandidates(item).some((candidate) => (
      candidate === wanted || (parent !== '' && candidate === parent)
    ));
  });

  return parentMatches.length === 1 ? parentMatches[0].uid : null;
}

/**
 * Sets RecurBuy subscription custom attributes on a cart item via GraphQL.
 * Option id is required for place-after; plan label / period / ends live on the
 * quote so cart and mini-cart read presentation without sessionStorage.
 *
 * @param {string} cartId Masked Commerce cart ID
 * @param {string} itemUid GraphQL item UID (e.g., "MjE1")
 * @param {number|string} optionId RecurBuy subscription option ID
 * @param {string|{
 *   startDate?: string,
 *   planLabel?: string,
 *   period?: import('./contract.js').SubscriptionPeriod,
 *   endsLabel?: string,
 * }} [startDateOrPresentation] YYYY-MM-DD string (legacy) or presentation bag
 * @returns {Promise<Object>} GraphQL response data
 */
export async function setSubscriptionAttributes(
  cartId,
  itemUid,
  optionId,
  startDateOrPresentation,
) {
  if (!cartId || !itemUid || !optionId) {
    throw new Error('[RecurBuy] Missing required parameters for setSubscriptionAttributes.');
  }

  const presentation = normalizePresentation(startDateOrPresentation);

  const customAttributes = [
    {
      attribute_code: RECURBUY_SUBSCRIPTION_OPTION_ID,
      value: String(optionId),
    },
  ];

  pushAttribute(customAttributes, RECURBUY_SUBSCRIPTION_START_DATE, presentation.startDate);
  pushAttribute(customAttributes, RECURBUY_PLAN_LABEL, presentation.planLabel);
  pushAttribute(
    customAttributes,
    RECURBUY_BILLING_PERIOD,
    serializeSubscriptionPeriod(presentation.period),
  );
  pushAttribute(customAttributes, RECURBUY_ENDS_LABEL, presentation.endsLabel);
  pushAttribute(customAttributes, RECURBUY_PLAN_UNIT, serializePlanUnit(presentation.planUnit));

  const response = await fetchGraphQl(SET_CUSTOM_ATTRIBUTES_MUTATION, {
    variables: {
      input: {
        cart_id: cartId,
        cart_item_id: itemUid,
        custom_attributes: customAttributes,
      },
    },
  });

  return readGraphQlData(response, 'setting custom attributes');
}

/**
 * @param {string|{
 *   startDate?: string,
 *   planLabel?: string,
 *   period?: import('./contract.js').SubscriptionPeriod,
 *   endsLabel?: string,
 * }|null|undefined} value
 * @returns {{
 *   startDate: string,
 *   planLabel: string,
 *   period: import('./contract.js').SubscriptionPeriod|null,
 *   endsLabel: string,
 * }}
 */
function normalizePresentation(value) {
  if (typeof value === 'string') {
    return {
      startDate: value.trim(),
      planLabel: '',
      period: null,
      endsLabel: '',
      planUnit: null,
    };
  }

  if (!value || typeof value !== 'object') {
    return {
      startDate: '',
      planLabel: '',
      period: null,
      endsLabel: '',
      planUnit: null,
    };
  }

  return {
    startDate: typeof value.startDate === 'string' ? value.startDate.trim() : '',
    planLabel: typeof value.planLabel === 'string' ? value.planLabel.trim() : '',
    period: value.period && typeof value.period === 'object' ? value.period : null,
    endsLabel: typeof value.endsLabel === 'string' ? value.endsLabel.trim() : '',
    planUnit: value.planUnit && typeof value.planUnit === 'object' ? value.planUnit : null,
  };
}

/**
 * @param {{ value?: number, currency?: string }|null|undefined} planUnit
 * @returns {string}
 */
function serializePlanUnit(planUnit) {
  const value = typeof planUnit?.value === 'number' && Number.isFinite(planUnit.value)
    ? planUnit.value
    : null;
  if (value == null) return '';
  const currency = typeof planUnit?.currency === 'string' && planUnit.currency.trim()
    ? planUnit.currency.trim()
    : 'USD';
  return `${value}|${currency}`;
}

/**
 * @param {Array<{ attribute_code: string, value: string }>} list
 * @param {string} code
 * @param {string} value
 */
function pushAttribute(list, code, value) {
  if (typeof value !== 'string' || value.trim() === '') return;
  list.push({ attribute_code: code, value: value.trim() });
}

/**
 * Nudges cart item quantity to trigger save_before observer in Magento.
 * Acts as a price recalculation safety net if pending or first save was one-off.
 *
 * @param {string} cartId Masked Commerce cart ID
 * @param {string} itemUid GraphQL item UID (e.g., "MjE1")
 * @param {number} qty Current item quantity
 * @returns {Promise<Object>} GraphQL response data
 */
export async function nudgeQuantity(cartId, itemUid, qty) {
  if (!cartId || !itemUid || !qty) {
    throw new Error('[RecurBuy] Missing required parameters for nudgeQuantity.');
  }

  return setCartItemQuantity(cartId, itemUid, qty);
}

/**
 * Sets cart item quantity (use {@code 0} to remove the line).
 *
 * @param {string} cartId Masked Commerce cart ID
 * @param {string} itemUid GraphQL item UID
 * @param {number} qty New quantity ({@code 0} removes)
 * @returns {Promise<Object>} GraphQL response data
 */
async function setCartItemQuantity(cartId, itemUid, qty) {
  if (!cartId || !itemUid || qty == null || Number(qty) < 0) {
    throw new Error('[RecurBuy] Missing required parameters for setCartItemQuantity.');
  }

  const response = await fetchGraphQl(UPDATE_CART_ITEMS_MUTATION, {
    variables: {
      cartId,
      cartItems: [
        {
          cart_item_uid: itemUid,
          quantity: Number(qty),
        },
      ],
    },
  });

  return readGraphQlData(response, 'updating cart item quantity');
}

/**
 * @param {{ errors?: Array<{ message?: string }> }|null|undefined} response
 * @param {string} action
 * @returns {Object|undefined}
 */
function readGraphQlData(response, action) {
  if (response?.errors?.length) {
    const message = response.errors.map((err) => err.message).join(', ');
    throw new Error(`[RecurBuy] GraphQL error ${action}: ${message}`);
  }

  return response?.data;
}
