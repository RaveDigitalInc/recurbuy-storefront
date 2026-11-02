import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCheckoutPaymentHooks } from '../src/extend/checkout-payment-hooks.js';
import { createClientStub } from './helpers/stubs.js';

function paymentOrderRequest(cartId = 'cart-1', vaultIntent = true) {
  return {
    method: 'POST',
    body: JSON.stringify({
      query: 'mutation { createPaymentOrder(input: { cartId: $cartId, vaultIntent: $vaultIntent }) { id mp_order_id } }',
      variables: { cartId, input: { cartId, vaultIntent } },
    }),
  };
}

function paymentOrderResponse(id = 'PAYPAL-1', mp = 'mp-order-1') {
  return { data: { createPaymentOrder: { id, mp_order_id: mp } } };
}

function placeOrderRequest(cartId = 'cart-1') {
  return {
    method: 'POST',
    body: JSON.stringify({
      query: 'mutation PLACE_ORDER_MUTATION($cartId: String!) { placeOrder(input: { cart_id: $cartId }) { order { number } } }',
      variables: { cartId },
    }),
  };
}

function setup({ cart, send } = {}) {
  const client = createClientStub();
  const events = {
    lastPayload(name) {
      return name === 'cart/data' ? cart : null;
    },
  };
  const calls = [];
  const hooks = createCheckoutPaymentHooks({
    client,
    events,
    requestPaymentMethod: send || (async (order) => { calls.push(order); }),
  });
  hooks.install();
  return { client, hooks, calls };
}

const subscriptionCart = {
  items: [{
    uid: 'line-1',
    recurbuy: { optionId: '14' },
  }],
};

describe('checkout payment hooks', () => {
  it('sends the enabler before placeOrder when the cart has a subscription', async () => {
    const { client, calls } = setup({ cart: subscriptionCart });

    await client.roundTrip(paymentOrderRequest(), paymentOrderResponse());
    const place = placeOrderRequest();
    const out = await client.roundTrip(place, { data: { placeOrder: { order: { number: '1' } } } });

    assert.equal(out.request, place);
    assert.deepEqual(calls, [{
      cartId: 'cart-1',
      paypalOrderId: 'PAYPAL-1',
      paymentsOrderId: 'mp-order-1',
    }]);
  });

  it('does not send the enabler when save-card is unchecked', async () => {
    const { client, calls } = setup({ cart: subscriptionCart });

    await client.roundTrip(paymentOrderRequest('cart-1', true), paymentOrderResponse());
    await client.roundTrip(paymentOrderRequest('cart-1', false), paymentOrderResponse('PAYPAL-2', 'mp-order-2'));
    await client.roundTrip(placeOrderRequest(), { data: { placeOrder: {} } });

    assert.equal(calls.length, 0);
  });

  it('does not send the enabler for a one-off cart', async () => {
    const { client, calls } = setup({ cart: { items: [{ uid: 'line-1', sku: 'simple' }] } });

    await client.roundTrip(paymentOrderRequest(), paymentOrderResponse());
    await client.roundTrip(placeOrderRequest(), { data: { placeOrder: {} } });

    assert.equal(calls.length, 0);
  });

  it('does not send the enabler when the payment order has no ids', async () => {
    const { client, calls } = setup({ cart: subscriptionCart });

    await client.roundTrip(paymentOrderRequest(), { data: { createPaymentOrder: { id: 'PAYPAL-1' } } });
    await client.roundTrip(placeOrderRequest(), { data: { placeOrder: {} } });

    assert.equal(calls.length, 0);
  });

  it('sends the enabler once', async () => {
    const { client, calls } = setup({ cart: subscriptionCart });

    await client.roundTrip(paymentOrderRequest(), paymentOrderResponse());
    await client.roundTrip(placeOrderRequest(), { data: { placeOrder: {} } });
    await client.roundTrip(placeOrderRequest(), { data: { placeOrder: {} } });

    assert.equal(calls.length, 1);
  });

  it('still places the order when the enabler request fails', async () => {
    const { client, calls } = setup({
      cart: subscriptionCart,
      send: async () => {
        calls.push('failed');
        throw new Error('Internal server error');
      },
    });

    await client.roundTrip(paymentOrderRequest(), paymentOrderResponse());
    const out = await client.roundTrip(placeOrderRequest(), { data: { placeOrder: {} } });

    assert.equal(calls.length, 1);
    assert.equal(out.response.data.placeOrder !== undefined, true);
  });

  it('moves a placeOrder GraphQL error onto placeOrder.errors so checkout can show it', async () => {
    const { client } = setup({ cart: subscriptionCart });
    const message = 'You have to allow saving CC details for purchasing subscriptions';

    const out = await client.roundTrip(placeOrderRequest(), {
      errors: [{ code: 'UNDEFINED', message }],
      data: { placeOrder: null },
    });

    assert.equal(out.response.errors, undefined);
    assert.deepEqual(out.response.data.placeOrder.errors, [{ code: 'UNDEFINED', message }]);
  });

  it('drops the duplicate top-level placeOrder error so checkout shows placeOrder.errors', async () => {
    const { client } = setup({ cart: subscriptionCart });
    const message = 'You have to allow saving CC details for purchasing subscriptions';
    const placeErrors = [{ code: 'UNDEFINED', message }];

    const out = await client.roundTrip(placeOrderRequest(), {
      data: { placeOrder: { errors: placeErrors, orderV2: null } },
      errors: [{
        message,
        path: ['placeOrder'],
        extensions: { error_code: 'UNDEFINED' },
      }],
    });

    assert.equal(out.response.errors, undefined);
    assert.deepEqual(out.response.data.placeOrder.errors, placeErrors);
    assert.equal(out.response.data.placeOrder.orderV2, null);
  });

  it('remembers a Payment SDK createPaymentOrder fetch that bypasses the client', async () => {
    const client = createClientStub();
    const calls = [];
    const fetchHost = {
      async fetch() {
        return {
          clone() {
            return {
              async json() {
                return paymentOrderResponse('PAYPAL-SDK', 'mp-sdk');
              },
            };
          },
        };
      },
    };
    const hooks = createCheckoutPaymentHooks({
      client,
      events: { lastPayload: () => subscriptionCart },
      requestPaymentMethod: async (order) => { calls.push(order); },
      fetchHost,
    });
    hooks.install();

    await fetchHost.fetch('https://example.test/graphql', {
      method: 'POST',
      body: paymentOrderRequest().body,
    });
    await client.roundTrip(placeOrderRequest(), { data: { placeOrder: {} } });

    assert.deepEqual(calls, [{
      cartId: 'cart-1',
      paypalOrderId: 'PAYPAL-SDK',
      paymentsOrderId: 'mp-sdk',
    }]);
    hooks.dispose();
  });
});
