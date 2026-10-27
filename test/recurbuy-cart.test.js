import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createRecurbuyCart } from '../src/extend/recurbuy-cart.js';
import {
  addToCartRequest,
  addToCartResponse,
  createClientStub,
  createEventsStub,
  createPrepareStub,
  createProvider,
} from './helpers/stubs.js';

function create(extensions = []) {
  const client = createClientStub();
  const events = createEventsStub();
  const prepare = createPrepareStub();
  const cart = createRecurbuyCart({
    client,
    events,
    refreshCart: async () => {},
    prepareCartItem: prepare.prepareCartItem,
    extensions,
  });
  return {
    cart, client, events, prepare,
  };
}

describe('createRecurbuyCart', () => {
  it('install() is idempotent per instance', () => {
    let installs = 0;
    const { cart, client } = create([() => { installs += 1; }]);

    cart.install();
    cart.install();

    assert.equal(installs, 1);
    assert.equal(client.beforeHooks.length, 1);
    assert.equal(client.afterHooks.length, 1);
  });

  it('gives every extension the instance selection registry', () => {
    const { cart, client, prepare } = create([
      ({ registerSelectionProvider }) => {
        registerSelectionProvider(createProvider());
      },
    ]);
    cart.install();
    return client.roundTrip(addToCartRequest([{ sku: 'sku-a', quantity: 1 }]), addToCartResponse())
      .then(() => assert.equal(prepare.calls.length, 1));
  });

  it('disposes extensions in reverse order, once, and makes hooks pass-through', async () => {
    const order = [];
    const { cart, client, prepare } = create([
      ({ registerSelectionProvider }) => {
        registerSelectionProvider(createProvider());
        return () => order.push('first');
      },
      () => () => order.push('second'),
    ]);
    cart.install();

    cart.dispose();
    cart.dispose();

    assert.deepEqual(order, ['second', 'first']);
    const request = addToCartRequest([{ sku: 'sku-a', quantity: 1 }]);
    const out = await client.roundTrip(request, addToCartResponse());
    assert.equal(out.request, request);
    assert.equal(prepare.calls.length, 0);
  });

  it('cannot be installed after dispose()', () => {
    let installs = 0;
    const { cart, client } = create([() => { installs += 1; }]);
    cart.dispose();
    cart.install();

    assert.equal(installs, 0);
    assert.equal(client.beforeHooks.length, 0);
  });

  it('survives a failing extension and still installs the others', () => {
    const error = mock.method(console, 'error', () => {});
    try {
      let installed = false;
      const { cart } = create([
        () => { throw new Error('no markup on this page'); },
        () => { installed = true; },
      ]);
      cart.install();
      assert.equal(installed, true);
      assert.equal(error.mock.callCount(), 1);
    } finally {
      error.mock.restore();
    }
  });

  it('keeps instances independent', async () => {
    const one = create([
      ({ registerSelectionProvider }) => {
        registerSelectionProvider(createProvider());
      },
    ]);
    const two = create();
    one.cart.install();
    two.cart.install();
    two.cart.dispose();

    const request = addToCartRequest([{ sku: 'sku-a', quantity: 1 }]);
    const out = await one.client.roundTrip(request, addToCartResponse());

    assert.notEqual(out.request, request);
    assert.equal(one.prepare.calls.length, 1);
    assert.equal(two.prepare.calls.length, 0);
  });
});
