import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCheckoutSuccessLoadingMarkup,
  buildCheckoutSuccessMarkup,
  buildCheckoutSuccessRequestUrl,
  createCheckoutSuccessRuntime,
  extractOrderLookup,
  mapCheckoutSuccessPayload,
  orderHasSubscriptionMarker,
} from '../src/extend/checkout-success-runtime.js';

function createFakeEventBus() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  /** @type {Map<string, unknown>} */
  const payloads = new Map();

  return {
    emit(name, payload) {
      payloads.set(name, payload);
      listeners.get(name)?.forEach((fn) => fn(payload));
    },
    lastPayload(name) {
      return payloads.get(name);
    },
    on(name, fn, options) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      if (options?.eager && payloads.has(name)) {
        fn(payloads.get(name));
      }
      return {
        off() {
          listeners.get(name)?.delete(fn);
        },
      };
    },
  };
}

describe('mapCheckoutSuccessPayload', () => {
  it('normalizes snake_case API payload and drops invalid entries', () => {
    const mapped = mapCheckoutSuccessPayload({
      can_view_profiles: true,
      profiles: [
        { profile_id: 58, increment_id: '000000058', view_url: '/aw_sarp2/profile_edit/index/profile_id/58/' },
        { profile_id: null, increment_id: '' },
      ],
    });

    assert.deepEqual(mapped, {
      canViewProfiles: true,
      profiles: [
        { profileId: 58, incrementId: '000000058' },
      ],
    });
  });
});

describe('buildCheckoutSuccessMarkup', () => {
  it('returns empty string when no profiles exist', () => {
    assert.equal(buildCheckoutSuccessMarkup({ canViewProfiles: true, profiles: [] }), '');
    assert.equal(buildCheckoutSuccessMarkup(null), '');
  });

  it('builds accessible loading markup while polling for subscription profile', () => {
    const html = buildCheckoutSuccessLoadingMarkup();
    assert.ok(html.includes('recurbuy-checkout-success__loading'));
    assert.ok(html.includes('recurbuy-checkout-success__spinner'));
    assert.ok(html.includes('role="status"'));
  });

  it('renders a single linked profile for a logged-in shopper', () => {
    const html = buildCheckoutSuccessMarkup({
      canViewProfiles: true,
      profiles: [{ profileId: 58, incrementId: '000000058' }],
    }, { hasShopperSession: true });

    assert.ok(html.includes('Your subscription profile is:'));
    assert.ok(html.includes('href="/customer/subscriptions#rb/detail/58"'));
    assert.ok(html.includes('>000000058</strong></a>'));
  });

  it('renders multiple profiles with plural copy and plain text when guest or cannot view', () => {
    const data = {
      canViewProfiles: false,
      profiles: [
        { profileId: 58, incrementId: '000000058' },
        { profileId: 59, incrementId: '000000059' },
      ],
    };

    const html = buildCheckoutSuccessMarkup(data, { hasShopperSession: true });
    assert.ok(html.includes('Your subscription profiles are:'));
    assert.equal(html.includes('<a '), false);
    assert.ok(html.includes('>000000058</strong>,'));
    assert.ok(html.includes('>000000059</strong>.'));

    const guestHtml = buildCheckoutSuccessMarkup(
      { ...data, canViewProfiles: true },
      { hasShopperSession: false },
    );
    assert.equal(guestHtml.includes('<a '), false);
  });
});

describe('extractOrderLookup', () => {
  it('reads order number from order/placed payload and ignores GraphQL id when number is present', () => {
    assert.deepEqual(extractOrderLookup({ number: '000000378' }), {
      orderId: null,
      incrementId: '000000378',
    });
    assert.deepEqual(extractOrderLookup({ id: '000000579', number: '000000579' }), {
      orderId: null,
      incrementId: '000000579',
    });
    assert.deepEqual(extractOrderLookup({ id: 378, number: '000000378' }), {
      orderId: null,
      incrementId: '000000378',
    });
    assert.deepEqual(extractOrderLookup({ order_id: 378, number: '000000378' }), {
      orderId: 378,
      incrementId: '000000378',
    });
    assert.deepEqual(extractOrderLookup({ id: 378 }), {
      orderId: 378,
      incrementId: '',
    });
    assert.equal(extractOrderLookup({ id: '000000579' }), null);
    assert.deepEqual(extractOrderLookup(null, '?orderRef=000000378'), {
      orderId: null,
      incrementId: '000000378',
    });
    assert.equal(
      extractOrderLookup(null, '?orderRef=long-guest-token-over-twenty-characters-12345'),
      null,
    );
  });
});

describe('buildCheckoutSuccessRequestUrl', () => {
  it('prefers increment_id over order_id and falls back to order_id only when incrementId is empty', () => {
    const withBoth = buildCheckoutSuccessRequestUrl('https://panel.example.com', {
      orderId: 579,
      incrementId: '000000579',
    });
    assert.equal(withBoth.searchParams.get('increment_id'), '000000579');
    assert.equal(withBoth.searchParams.get('order_id'), null);

    const onlyOrderId = buildCheckoutSuccessRequestUrl('https://panel.example.com', {
      orderId: 579,
      incrementId: '',
    });
    assert.equal(onlyOrderId.searchParams.get('order_id'), '579');
    assert.equal(onlyOrderId.searchParams.get('increment_id'), null);
  });
});

describe('createCheckoutSuccessRuntime', () => {
  it('uses short fallback probe for a non-subscription order', async () => {
    const events = createFakeEventBus();
    let calls = 0;
    const runtime = createCheckoutSuccessRuntime({
      events,
      fetchProfiles: async () => {
        calls += 1;
        return { canViewProfiles: true, profiles: [] };
      },
      rootDocument: null,
      pollDelaysMs: [0, 1, 1, 1],
      fallbackPollDelaysMs: [0],
    });
    runtime.install();

    events.emit('cart/data', { items: [{ uid: 'line-1', sku: 'REGULAR' }] });
    events.emit('order/placed', { number: '000000401' });

    await new Promise((resolve) => { setTimeout(resolve, 15); });
    assert.equal(calls, 1);
    runtime.dispose();
  });

  it('polls until profiles arrive after a subscription order is placed', async () => {
    const events = createFakeEventBus();
    let calls = 0;
    const runtime = createCheckoutSuccessRuntime({
      events,
      fetchProfiles: async (lookup) => {
        calls += 1;
        assert.equal(lookup.incrementId, '000000402');
        if (calls < 2) {
          return { canViewProfiles: true, profiles: [] };
        }
        return {
          canViewProfiles: true,
          profiles: [{ profileId: 77, incrementId: '000000077', viewUrl: null }],
        };
      },
      getAuthToken: () => 'shopper-jwt',
      rootDocument: null,
      pollDelaysMs: [0, 1, 1],
    });
    runtime.install();

    events.emit('cart/data', {
      items: [{ uid: 'sub-1', recurbuy: { optionId: 12 } }],
    });
    // Stock checkout clears the cart right before order/placed.
    events.emit('cart/data', { items: [] });
    events.emit('order/placed', { number: '000000402' });

    await new Promise((resolve) => { setTimeout(resolve, 30); });
    assert.equal(calls, 2);
    runtime.dispose();
  });

  it('uses full subscription polling on /checkout when only orderData has Subscription selectedOptions', async () => {
    const events = createFakeEventBus();
    let calls = 0;
    const runtime = createCheckoutSuccessRuntime({
      events,
      fetchProfiles: async (lookup) => {
        calls += 1;
        assert.equal(lookup.incrementId, '000000580');
        if (calls < 3) {
          return { canViewProfiles: true, profiles: [] };
        }
        return {
          canViewProfiles: true,
          profiles: [{ profileId: 161, incrementId: 'SUB-000000161' }],
        };
      },
      getAuthToken: () => 'shopper-jwt',
      rootDocument: null,
      pollDelaysMs: [0, 1, 1, 1],
      fallbackPollDelaysMs: [0],
    });
    runtime.install();

    const orderData = {
      id: '000000580',
      number: '000000580',
      items: [
        {
          sku: 'luna',
          selectedOptions: [{ label: 'Subscription', value: 'test3 [#6]' }],
        },
      ],
    };
    assert.equal(orderHasSubscriptionMarker(orderData), true);
    events.emit('order/placed', orderData);

    await new Promise((resolve) => { setTimeout(resolve, 30); });
    assert.equal(calls, 3);
    runtime.dispose();
  });
});
