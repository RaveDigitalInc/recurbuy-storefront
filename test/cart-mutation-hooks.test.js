import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, mock } from 'node:test';
import { createCartMutationHooks } from '../src/extend/cart-mutation-hooks.js';
import {
  addToCartRequest,
  addToCartResponse,
  createClientStub,
  createEventsStub,
  createPrepareStub,
  createProvider,
} from './helpers/stubs.js';

function setup({ finalize, refreshCart } = {}) {
  const client = createClientStub();
  const events = createEventsStub();
  const refreshCalls = [];
  const prepare = createPrepareStub({ finalize });
  const hooks = createCartMutationHooks({
    client,
    events,
    refreshCart: refreshCart || (async () => { refreshCalls.push(Date.now()); }),
    prepareCartItem: prepare.prepareCartItem,
  });
  hooks.install();
  return {
    client, events, hooks, refreshCalls, prepare,
  };
}

const item = { sku: 'sku-a', quantity: 1 };

describe('cart mutation hooks: pass-through for non-RecurBuy traffic', () => {
  it('leaves the request and response untouched when no provider is registered', async () => {
    const { client, prepare } = setup();
    const request = addToCartRequest([item]);
    const response = addToCartResponse();
    const snapshot = structuredClone(response);

    const out = await client.roundTrip(request, response);

    assert.equal(out.request, request);
    assert.equal(out.response, response);
    assert.deepEqual(out.response, snapshot);
    assert.equal(prepare.calls.length, 0);
  });

  it('leaves a request whose SKU matches no provider untouched', async () => {
    const { client, hooks, prepare } = setup();
    hooks.registerSelectionProvider(createProvider({ skus: ['other'] }));
    const request = addToCartRequest([item]);

    const out = await client.roundTrip(request, addToCartResponse());

    assert.equal(out.request, request);
    assert.equal(prepare.calls.length, 0);
  });

  it('leaves non add-to-cart requests untouched', async () => {
    const { client, hooks } = setup();
    hooks.registerSelectionProvider(createProvider());
    const request = { method: 'POST', body: JSON.stringify({ query: 'query { cart { id } }' }) };
    const nonJson = { method: 'POST', body: 'not json ADD_PRODUCTS_TO_CART_MUTATION' };
    const response = { data: { cart: { id: 'cart-1' } } };

    const first = await client.roundTrip(request, response);
    const second = await client.roundTrip(nonJson, response);

    assert.equal(first.request, request);
    assert.equal(first.response, response);
    assert.equal(second.request, nonJson);
  });

  it('leaves a one-time add untouched even when a provider matches the SKU', async () => {
    const {
      client, hooks, events, prepare, refreshCalls,
    } = setup();
    hooks.registerSelectionProvider(createProvider({ purchaseType: 'one_time' }));
    const request = addToCartRequest([item]);
    const response = addToCartResponse();
    const snapshot = structuredClone(response);

    const out = await client.roundTrip(request, response);
    events.emit('cart/data', {});

    assert.equal(out.request, request);
    assert.equal(out.response, response);
    assert.deepEqual(out.response, snapshot);
    assert.equal(prepare.calls.length, 0);
    assert.equal(events.listenerCount('cart/data'), 0);
    assert.equal(refreshCalls.length, 0);
  });

  it('only rewrites the subscription item of a mixed add', async () => {
    const { client, hooks } = setup();
    hooks.registerSelectionProvider(createProvider({ skus: ['sku-a'] }));
    const plain = { sku: 'sku-b', quantity: 2 };
    const request = addToCartRequest([item, plain]);

    const out = await client.roundTrip(request, addToCartResponse());

    const items = JSON.parse(out.request.body).variables.cartItems;
    assert.deepEqual(items[1], plain);
  });

  it('does not inject parent_sku when PDP parent only differs by case from cart sku', async () => {
    const client = createClientStub();
    const events = createEventsStub();
    const prepare = createPrepareStub({
      adobeExtras: {
        parentSku: 'Configurable-1',
        enteredOptions: [{ uid: 'opt-1', value: 'TEST [#20]' }],
      },
    });
    const hooks = createCartMutationHooks({
      client,
      events,
      refreshCart: async () => {},
      prepareCartItem: prepare.prepareCartItem,
    });
    hooks.install();
    hooks.registerSelectionProvider({
      matches: (skus) => skus.includes('configurable-1'),
      getSelection: () => ({ purchaseType: 'subscription', planId: 20 }),
      isSelectionValid: () => true,
      getProductData: () => ({ sku: 'Configurable-1', externalId: '99', id: '99' }),
    });

    const request = addToCartRequest([{
      sku: 'configurable-1',
      quantity: 1,
      selected_options: ['Y29uZmlndXJhYmxlLzkzLzMz'],
    }]);
    const out = await client.roundTrip(request, addToCartResponse());
    const cartItem = JSON.parse(out.request.body).variables.cartItems[0];

    assert.equal(cartItem.sku, 'configurable-1');
    assert.equal(cartItem.parent_sku, undefined);
    assert.deepEqual(cartItem.entered_options, [{ uid: 'opt-1', value: 'TEST [#20]' }]);
  });

  it('still sets parent_sku when the cart line sku is a distinct child', async () => {
    const client = createClientStub();
    const events = createEventsStub();
    const prepare = createPrepareStub({
      adobeExtras: {
        parentSku: 'Configurable-1',
        enteredOptions: [{ uid: 'opt-1', value: 'TEST [#20]' }],
      },
    });
    const hooks = createCartMutationHooks({
      client,
      events,
      refreshCart: async () => {},
      prepareCartItem: prepare.prepareCartItem,
    });
    hooks.install();
    hooks.registerSelectionProvider({
      matches: (skus) => skus.includes('configurable-black-xl'),
      getSelection: () => ({ purchaseType: 'subscription', planId: 20 }),
      isSelectionValid: () => true,
      getProductData: () => ({ sku: 'Configurable-1', externalId: '99', id: '99' }),
    });

    const request = addToCartRequest([{
      sku: 'Configurable-black-XL',
      quantity: 1,
    }]);
    const out = await client.roundTrip(request, addToCartResponse());
    const cartItem = JSON.parse(out.request.body).variables.cartItems[0];

    assert.equal(cartItem.parent_sku, 'Configurable-1');
    assert.deepEqual(cartItem.entered_options, [{ uid: 'opt-1', value: 'TEST [#20]' }]);
  });

  it('turns into a pass-through after dispose()', async () => {
    const {
      client, hooks, prepare, events,
    } = setup();
    hooks.registerSelectionProvider(createProvider());
    hooks.dispose();
    const request = addToCartRequest([item]);
    const response = addToCartResponse();
    const snapshot = structuredClone(response);

    const out = await client.roundTrip(request, response);

    assert.equal(out.request, request);
    assert.equal(out.response, response);
    assert.deepEqual(out.response, snapshot);
    assert.equal(prepare.calls.length, 0);
    assert.equal(events.listenerCount('cart/data'), 0);
  });
});

describe('cart mutation hooks: subscription add and refresh', () => {
  it('finalizes the line and refreshes once, only after cart/data', async () => {
    const finalizeCalls = [];
    const {
      client, hooks, events, refreshCalls,
    } = setup({
      finalize: async (args) => {
        finalizeCalls.push(args);
        return 'uid-1';
      },
    });
    hooks.registerSelectionProvider(createProvider());

    const request = addToCartRequest([item]);
    const out = await client.roundTrip(request, addToCartResponse());

    assert.notEqual(out.request.body, request.body, 'plan option rides on the rewritten body');
    assert.equal(finalizeCalls.length, 1);
    assert.equal(refreshCalls.length, 0, 'no refresh before the drop-in published cart/data');
    assert.equal(events.listenerCount('cart/data'), 1);

    events.emit('cart/data', { id: 'cart-1' });
    await Promise.resolve();

    assert.equal(refreshCalls.length, 1);
    assert.equal(events.listenerCount('cart/data'), 0);

    events.emit('cart/data', { id: 'cart-1' });
    assert.equal(refreshCalls.length, 1, 'one-shot');
  });

  it('first frame: a just-added subscription line shows no merge row, foreign lines keep theirs', async () => {
    const { client, hooks } = setup({ finalize: async () => 'uid-1' });
    hooks.registerSelectionProvider(createProvider());

    const response = addToCartResponse();
    const { items } = response.data.addProductsToCart.cart.itemsV2;
    // Merge row exactly as the add response returns it: no marker on the line yet.
    items[0].customizable_options = [
      { label: 'Subscription', values: [{ value: 'Every month [#42]' }] },
      { label: 'Engraving', values: [{ value: 'Hi' }] },
    ];
    items.push({
      uid: 'native',
      quantity: 1,
      prices: { price: { value: 5, currency: 'USD' }, row_total: { value: 5, currency: 'USD' } },
      custom_attributes: [],
      customizable_options: [
        { label: 'Subscription', values: [{ value: 'Every month [#42]' }] },
      ],
    });

    const out = await client.roundTrip(addToCartRequest([item]), response);
    const [added, native] = out.response.data.addProductsToCart.cart.itemsV2.items;

    assert.deepEqual(added.customizable_options.map((option) => option.label), ['Engraving']);
    assert.equal(
      added.custom_attributes.find((entry) => entry.attribute_code === 'recurbuy_subscription_option_id')?.value,
      '42',
    );
    assert.deepEqual(native.customizable_options.map((option) => option.label), ['Subscription']);
    assert.equal(native.custom_attributes.length, 0);
  });

  it('keeps at most one pending refresh listener', async () => {
    const {
      client, hooks, events, refreshCalls,
    } = setup();
    hooks.registerSelectionProvider(createProvider());

    await client.roundTrip(addToCartRequest([item]), addToCartResponse());
    await client.roundTrip(addToCartRequest([{ ...item, quantity: 2 }]), addToCartResponse());

    assert.equal(events.listenerCount('cart/data'), 1);
    events.emit('cart/data', {});
    await Promise.resolve();
    assert.equal(refreshCalls.length, 1);
  });

  it('does not schedule a refresh when the add failed', async () => {
    const { client, hooks, events } = setup();
    hooks.registerSelectionProvider(createProvider());
    const response = addToCartResponse();
    response.data.addProductsToCart.user_errors = [{ message: 'Out of stock' }];

    await client.roundTrip(addToCartRequest([item]), response);

    assert.equal(events.listenerCount('cart/data'), 0);
  });

  it('drops the pending refresh on dispose()', async () => {
    const {
      client, hooks, events, refreshCalls,
    } = setup();
    hooks.registerSelectionProvider(createProvider());
    await client.roundTrip(addToCartRequest([item]), addToCartResponse());
    assert.equal(events.listenerCount('cart/data'), 1);

    hooks.dispose();
    events.emit('cart/data', {});
    await Promise.resolve();

    assert.equal(events.listenerCount('cart/data'), 0);
    assert.equal(refreshCalls.length, 0);
  });

  it('warns instead of throwing when the refresh fails', async () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      const { client, hooks, events } = setup({
        refreshCart: async () => { throw new Error('network'); },
      });
      hooks.registerSelectionProvider(createProvider());
      await client.roundTrip(addToCartRequest([item]), addToCartResponse());

      events.emit('cart/data', {});
      await new Promise((resolve) => { setImmediate(resolve); });

      assert.equal(warn.mock.callCount(), 1);
    } finally {
      warn.mock.restore();
    }
  });

  it('keeps the Magento add response when finalize throws (stamp must not abort ATC)', async () => {
    const warn = mock.method(console, 'warn', () => {});
    try {
      const { client, hooks } = setup({
        finalize: async () => { throw new Error('UID not found'); },
      });
      hooks.registerSelectionProvider(createProvider());
      const response = addToCartResponse();

      const out = await client.roundTrip(addToCartRequest([item]), response);

      assert.equal(out.response, response);
      assert.equal(warn.mock.callCount(), 1);
      assert.match(String(warn.mock.calls[0].arguments[0]), /finalize failed/);
    } finally {
      warn.mock.restore();
    }
  });

  it('still finalizes when a later before-hook rewrites body without keeping the Symbol', async () => {
    const finalizeCalls = [];
    const { client, hooks } = setup({
      finalize: async () => {
        finalizeCalls.push(1);
        return 'uid-1';
      },
    });
    hooks.registerSelectionProvider(createProvider());
    // Simulate a host before-hook that returns a fresh requestInit (body only).
    client.addBeforeHook(async (requestInit) => ({
      method: requestInit.method,
      body: requestInit.body,
    }));

    await client.roundTrip(addToCartRequest([item]), addToCartResponse());

    assert.equal(finalizeCalls.length, 1);
  });

  it('rejects a subscription add with an invalid selection', async () => {
    const { client, hooks } = setup();
    hooks.registerSelectionProvider(createProvider({ valid: false }));

    await assert.rejects(
      client.roundTrip(addToCartRequest([item]), addToCartResponse()),
      /choose a subscription option/,
    );
  });

  it('uses no timers', () => {
    ['cart-mutation-hooks.js', 'recurbuy-cart.js'].forEach((file) => {
      const source = readFileSync(new URL(`../src/extend/${file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /setTimeout|setInterval/, file);
    });
  });
});

describe('cart mutation hooks: instance isolation', () => {
  it('does not share providers or finalizers between instances', async () => {
    const events = createEventsStub();
    const a = setup();
    const clientB = createClientStub();
    const prepareB = createPrepareStub();
    const refreshB = [];
    const hooksB = createCartMutationHooks({
      client: clientB,
      events,
      refreshCart: async () => { refreshB.push(1); },
      prepareCartItem: prepareB.prepareCartItem,
    });
    hooksB.install();
    a.hooks.registerSelectionProvider(createProvider());

    // B has no provider: A's registration must not leak into it.
    const request = addToCartRequest([item]);
    const outB = await clientB.roundTrip(request, addToCartResponse());
    assert.equal(outB.request, request);
    assert.equal(prepareB.calls.length, 0);

    // A's pending finalizers must not be consumed by B's after-hook.
    const outA = await a.client.roundTrip(request, addToCartResponse());
    const responseForB = addToCartResponse();
    const snapshot = structuredClone(responseForB);
    await clientB.afterHooks[0](outA.request, responseForB);
    assert.deepEqual(responseForB, snapshot);
    assert.equal(a.events.listenerCount('cart/data'), 1);

    // Disposing B leaves A working.
    hooksB.dispose();
    const second = await a.client.roundTrip(request, addToCartResponse());
    assert.notEqual(second.request.body, request.body);
  });

  it('attaches hooks once per instance', () => {
    const { client, hooks } = setup();
    hooks.install();
    hooks.install();
    assert.equal(client.beforeHooks.length, 1);
    assert.equal(client.afterHooks.length, 1);
  });

  it('unregisters a provider', async () => {
    const { client, hooks, prepare } = setup();
    const unregister = hooks.registerSelectionProvider(createProvider());
    unregister();
    const request = addToCartRequest([item]);

    const out = await client.roundTrip(request, addToCartResponse());

    assert.equal(out.request, request);
    assert.equal(prepare.calls.length, 0);
  });
});
