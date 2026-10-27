/**
 * Browser-free stubs for the cart add-on tests.
 */

/**
 * FetchGraphQL stand-in that only records the attached hooks.
 */
export function createClientStub() {
  const client = {
    beforeHooks: [],
    afterHooks: [],
    addBeforeHook(fn) {
      client.beforeHooks.push(fn);
    },
    addAfterHook(fn) {
      client.afterHooks.push(fn);
    },
    /** Run a request/response pair through the attached hooks like FetchGraphQL does. */
    async roundTrip(requestInit, response) {
      const request = await client.beforeHooks.reduce(
        async (previous, hook) => hook(await previous),
        Promise.resolve(requestInit),
      );
      const result = await client.afterHooks.reduce(
        async (previous, hook) => hook(request, await previous),
        Promise.resolve(response),
      );
      return { request, response: result };
    },
  };
  return client;
}

/**
 * Event bus stand-in. Like the real one, `eager` would replay a stale
 * payload at once, so using it here is a test failure.
 */
export function createEventsStub() {
  const listeners = new Map();
  return {
    on(name, callback, options = {}) {
      if (options.eager) throw new Error('eager listeners replay a stale payload');
      const set = listeners.get(name) || new Set();
      set.add(callback);
      listeners.set(name, set);
      return { off: () => set.delete(callback) };
    },
    emit(name, payload) {
      [...(listeners.get(name) || [])].forEach((callback) => callback(payload));
    },
    listenerCount(name) {
      return listeners.get(name)?.size || 0;
    },
  };
}

export function addToCartRequest(items) {
  return {
    method: 'POST',
    body: JSON.stringify({
      query: 'mutation ADD_PRODUCTS_TO_CART_MUTATION($cartItems: [CartItemInput!]!) { x }',
      variables: { cartId: 'cart-1', cartItems: items },
    }),
  };
}

export function addToCartResponse() {
  const money = (value) => ({ value, currency: 'USD' });
  return {
    data: {
      addProductsToCart: {
        user_errors: [],
        cart: {
          id: 'cart-1',
          prices: {
            subtotal_excluding_tax: money(20),
            subtotal_including_tax: money(20),
            grand_total: money(20),
          },
          itemsV2: {
            items: [{
              uid: 'uid-1',
              quantity: 1,
              prices: { price: money(20), row_total: money(20) },
              custom_attributes: [],
            }],
          },
        },
      },
    },
  };
}

/**
 * @param {{ purchaseType?: string, skus?: string[], valid?: boolean }} [options]
 */
export function createProvider({ purchaseType = 'subscription', skus = ['sku-a'], valid = true } = {}) {
  return {
    matches: (candidates) => candidates.some((sku) => skus.includes(sku)),
    getSelection: () => ({ purchaseType, planId: 42 }),
    isSelectionValid: () => valid,
    getProductData: () => ({ sku: skus[0], externalId: '7', id: '7' }),
  };
}

/**
 * @param {{ finalize?: Function }} [options]
 */
export function createPrepareStub({ finalize } = {}) {
  const calls = [];
  const prepareCartItem = async (args) => {
    calls.push(args);
    return {
      adobeExtras: { enteredOptions: [{ uid: 'opt-1', value: 'Every month [#42]' }] },
      finalize: finalize || (async () => 'uid-1'),
      planUnit: { value: 9.5, currency: 'USD' },
    };
  };
  return { prepareCartItem, calls };
}
