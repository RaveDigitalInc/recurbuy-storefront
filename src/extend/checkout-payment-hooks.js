/**
 * Subscription checkout save-card flag through the same FetchGraphQL client
 * the cart add-on uses. Stock checkout keeps calling placeOrder.
 *
 * Payment Services creates the PayPal order with its own fetch (not the
 * drop-in client). That response is only remembered. The before-hook on
 * placeOrder sends setPaymentMethodOnCart with the enabler when the cart has
 * a subscription line and createPaymentOrder was sent with vaultIntent true
 * (the Save card checkbox). An unchecked box does not send the flag. AccS
 * returns an error after the flag is already stored, so that error must not reject placeOrder.
 */

import { hasRecurbuyLines } from '../recurbuy-line.js';
import { RECURBUY_SUBSCRIPTION_OPTION_ID } from '../contract.js';

const CREATE_PAYMENT_ORDER = 'createPaymentOrder';
const PLACE_ORDER = 'placeOrder';
const FETCH_OBSERVER = Symbol.for('recurbuy.checkoutPaymentFetch');

const ENABLER_QUERY = `mutation RecurBuySetVaultEnabler($cartId: String!, $paypal: String!, $mp: String!) {
  setPaymentMethodOnCart(input: {
    cart_id: $cartId
    payment_method: {
      code: "payment_services_paypal_hosted_fields"
      payment_services_paypal_hosted_fields: {
        payment_source: "cc"
        paypal_order_id: $paypal
        payments_order_id: $mp
        is_active_payment_token_enabler: true
      }
    }
  }) { cart { selected_payment_method { code } } }
}`;

/**
 * @param {RequestInit|null|undefined} requestInit
 * @returns {{ query: string, variables: Record<string, any> }|null}
 */
function readGraphqlPayload(requestInit) {
  if (typeof requestInit?.body !== 'string') return null;
  try {
    const payload = JSON.parse(requestInit.body);
    return typeof payload?.query === 'string' ? payload : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ query?: string }|null|undefined} payload
 * @param {string} operation
 * @returns {boolean}
 */
function queryHas(payload, operation) {
  return typeof payload?.query === 'string' && payload.query.includes(operation);
}

/**
 * Save-card checkbox. Payment Services puts it on createPaymentOrder as
 * vaultIntent. Missing or false means the shopper did not agree to store the card.
 *
 * @param {Record<string, any>|null|undefined} payload
 * @returns {boolean}
 */
function saveCardChecked(payload) {
  const variables = payload?.variables;
  if (!variables || typeof variables !== 'object') return false;
  if (variables.vaultIntent === true || variables.input?.vaultIntent === true) return true;
  return false;
}

/**
 * @param {Record<string, any>|null|undefined} payload
 * @returns {string}
 */
function cartIdFrom(payload) {
  const variables = payload?.variables;
  if (!variables || typeof variables !== 'object') return '';
  const direct = variables.cartId || variables.cart_id;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const { input } = variables;
  const nested = input?.cartId || input?.cart_id;
  return typeof nested === 'string' ? nested.trim() : '';
}

/**
 * @param {{ data?: Record<string, any> }|null|undefined} response
 * @returns {{ paypalOrderId: string, paymentsOrderId: string }|null}
 */
function paymentOrderFrom(response) {
  const order = response?.data?.createPaymentOrder;
  const paypalOrderId = typeof order?.id === 'string' ? order.id.trim() : '';
  const paymentsOrderId = typeof order?.mp_order_id === 'string' ? order.mp_order_id.trim() : '';
  if (!paypalOrderId || !paymentsOrderId) return null;
  return { paypalOrderId, paymentsOrderId };
}

/**
 * CartModel lines, raw GraphQL attributes, or a Magento subscription marker.
 *
 * @param {unknown} cart
 * @returns {boolean}
 */
export function cartNeedsVaultEnabler(cart) {
  if (!cart || typeof cart !== 'object') return false;
  if (hasRecurbuyLines(cart)) return true;
  try {
    const serialized = JSON.stringify(cart);
    return serialized.includes(RECURBUY_SUBSCRIPTION_OPTION_ID)
      || serialized.includes('aw_sarp2_subscription_type');
  } catch {
    return false;
  }
}

/**
 * AccS copies a webhook exception into both `placeOrder.errors` and the
 * top-level GraphQL `errors`. The order drop-in throws on the top-level list
 * first, as a plain Error, and checkout replaces that with the generic
 * unexpected-order sentence. Drop the top-level list when `placeOrder.errors`
 * already has the text, so checkout shows that text.
 *
 * @param {RequestInit|null|undefined} requestInit
 * @param {{ data?: Record<string, any>, errors?: Array<{ message?: string }> }} response
 */
export function showPlaceOrderMessage(requestInit, response) {
  const payload = readGraphqlPayload(requestInit);
  if (!queryHas(payload, PLACE_ORDER) || !response || typeof response !== 'object') return response;
  const placeErrors = response.data?.placeOrder?.errors;
  const hasPlaceMessage = Array.isArray(placeErrors)
    && placeErrors.some((entry) => typeof entry?.message === 'string' && entry.message.trim());
  const messages = (Array.isArray(response.errors) ? response.errors : [])
    .map((entry) => (typeof entry?.message === 'string' ? entry.message.trim() : ''))
    .filter(Boolean);
  if (!hasPlaceMessage && !messages.length) return response;
  if (hasPlaceMessage) {
    if (!messages.length) return response;
    const next = { ...response };
    delete next.errors;
    return next;
  }
  return {
    data: {
      ...(response.data || {}),
      placeOrder: {
        ...(response.data?.placeOrder || {}),
        errors: messages.map((message) => ({ code: 'UNDEFINED', message })),
      },
    },
  };
}

/**
 * @param {{ fetchGraphQl?: Function }} client
 * @param {{ cartId: string, paypalOrderId: string, paymentsOrderId: string }} order
 */

export async function sendVaultEnabler(client, order) {
  if (typeof client?.fetchGraphQl !== 'function') return;
  await client.fetchGraphQl(ENABLER_QUERY, {
    variables: {
      cartId: order.cartId,
      paypal: order.paypalOrderId,
      mp: order.paymentsOrderId,
    },
  });
}

/**
 * @param {{
 *   client: { addBeforeHook: Function, addAfterHook: Function, fetchGraphQl?: Function },
 *   events: { lastPayload?: (name: string) => unknown },
 *   requestPaymentMethod?: (order: {
 *     cartId: string,
 *     paypalOrderId: string,
 *     paymentsOrderId: string,
 *   }) => Promise<void>,
 *   fetchHost?: { fetch: Function }|null,
 * }} deps
 */
export function createCheckoutPaymentHooks({
  client,
  events,
  requestPaymentMethod,
  fetchHost = null,
}) {
  /**
   * @typedef {{
   *   cartId: string,
   *   paypalOrderId: string,
   *   paymentsOrderId: string,
   *   replay?: { url?: string, headers?: HeadersInit },
   * }} PendingPaymentOrder
   */

  /** @type {PendingPaymentOrder|null} */
  let pending = null;
  let enabled = true;
  let installed = false;
  /** @type {((input: RequestInfo, init?: RequestInit) => Promise<Response>)|null} */
  let originalFetch = null;
  /** @type {(() => void)|null} */
  let restoreFetch = null;

  const currentCart = () => (
    typeof events?.lastPayload === 'function' ? events.lastPayload('cart/data') : null
  );

  /**
   * @param {PendingPaymentOrder} order
   */
  const send = async (order) => {
    const ids = {
      cartId: order.cartId,
      paypalOrderId: order.paypalOrderId,
      paymentsOrderId: order.paymentsOrderId,
    };
    if (requestPaymentMethod) {
      await requestPaymentMethod(ids);
      return;
    }
    if (order.replay?.url && originalFetch) {
      await originalFetch(order.replay.url, {
        method: 'POST',
        headers: order.replay.headers,
        body: JSON.stringify({
          query: ENABLER_QUERY,
          variables: {
            cartId: ids.cartId,
            paypal: ids.paypalOrderId,
            mp: ids.paymentsOrderId,
          },
        }),
      });
      return;
    }
    await sendVaultEnabler(client, ids);
  };

  /**
   * @param {RequestInit|null|undefined} requestInit
   * @param {{ data?: Record<string, any> }|null|undefined} response
   * @param {{ url?: string, headers?: HeadersInit }} [replay]
   */
  const rememberPaymentOrder = (requestInit, response, replay) => {
    if (!enabled) return;
    const payload = readGraphqlPayload(requestInit);
    if (!queryHas(payload, CREATE_PAYMENT_ORDER) || queryHas(payload, 'setPaymentMethodOnCart')) return;
    if (!saveCardChecked(payload)) {
      pending = null;
      return;
    }
    const order = paymentOrderFrom(response);
    const cartId = cartIdFrom(payload);
    if (!order || !cartId || !cartNeedsVaultEnabler(currentCart())) return;
    pending = {
      cartId,
      ...order,
      replay: replay?.url ? replay : pending?.replay,
    };
  };

  /**
   * @param {RequestInit} requestInit
   * @returns {Promise<RequestInit>}
   */
  const beforePlaceOrder = async (requestInit) => {
    if (!enabled || !pending) return requestInit;
    const payload = readGraphqlPayload(requestInit);
    if (!queryHas(payload, PLACE_ORDER)) return requestInit;
    const placeCartId = cartIdFrom(payload);
    if (placeCartId && placeCartId !== pending.cartId) return requestInit;
    if (!cartNeedsVaultEnabler(currentCart())) {
      pending = null;
      return requestInit;
    }
    const order = pending;
    pending = null;
    try {
      await send(order);
    } catch (error) {
      console.warn('RecurBuy save-card flag was not confirmed:', error);
    }
    return requestInit;
  };

  /**
   * @param {RequestInit} requestInit
   * @param {{ data?: Record<string, any>, errors?: Array<{ message?: string }> }} response
   */
  const afterPaymentOrder = async (requestInit, response) => {
    rememberPaymentOrder(requestInit, response);
    return showPlaceOrderMessage(requestInit, response);
  };

  const installFetchObserver = () => {
    if (!fetchHost || typeof fetchHost.fetch !== 'function') return;
    if (fetchHost.fetch[FETCH_OBSERVER]) return;
    const original = fetchHost.fetch.bind(fetchHost);
    originalFetch = original;
    const wrapped = async (input, init) => {
      const response = await original(input, init);
      const body = typeof init?.body === 'string' ? init.body : '';
      if (!body.includes(CREATE_PAYMENT_ORDER)) return response;
      try {
        const json = await response.clone().json();
        const url = typeof input === 'string' ? input : input?.url;
        rememberPaymentOrder(init, json, { url, headers: init?.headers });
      } catch (error) {
        console.warn('RecurBuy could not read the payment order:', error);
      }
      return response;
    };
    Object.defineProperty(wrapped, FETCH_OBSERVER, { value: true });
    fetchHost.fetch = wrapped;
    restoreFetch = () => {
      if (fetchHost.fetch === wrapped) fetchHost.fetch = original;
    };
  };

  return {
    install() {
      if (!client || installed || !enabled) return;
      installed = true;
      client.addBeforeHook(beforePlaceOrder);
      client.addAfterHook(afterPaymentOrder);
      installFetchObserver();
    },

    dispose() {
      enabled = false;
      pending = null;
      restoreFetch?.();
      restoreFetch = null;
    },
  };
}
