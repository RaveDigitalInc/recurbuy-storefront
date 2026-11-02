import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ACCOUNT_SUCCESS_FLASH_KEY,
  ACCOUNT_SUCCESS_MESSAGES,
  consumeAccountSuccessFlash,
  getAccountSuccessMessage,
  renderAccountSuccessMessage,
  setAccountSuccessFlash,
  setAccountSuccessFlashForAction,
} from '../src/helpers/account-success-flash.js';
import { renderSubscriptionDetail } from '../src/subscription-detail-ui.js';

/** Minimal in-memory sessionStorage for Node tests. */
function installMemorySessionStorage() {
  /** @type {Map<string, string>} */
  const store = new Map();
  globalThis.sessionStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
  return store;
}

describe('account success flash', () => {
  /** @type {Map<string, string>|null} */
  let store = null;

  beforeEach(() => {
    store = installMemorySessionStorage();
  });

  afterEach(() => {
    store = null;
    // eslint-disable-next-line no-undefined
    globalThis.sessionStorage = undefined;
  });

  it('set/consume stores Magento copy once then clears', () => {
    setAccountSuccessFlash('Payment has been successfully saved.');
    assert.equal(store.get(ACCOUNT_SUCCESS_FLASH_KEY), 'Payment has been successfully saved.');
    assert.equal(consumeAccountSuccessFlash(), 'Payment has been successfully saved.');
    assert.equal(consumeAccountSuccessFlash(), null);
    assert.equal(store.has(ACCOUNT_SUCCESS_FLASH_KEY), false);
  });

  it('setAccountSuccessFlashForAction maps Magento SavePayment copy', () => {
    assert.equal(setAccountSuccessFlashForAction('save-payment'), true);
    assert.equal(
      consumeAccountSuccessFlash(),
      'Payment has been successfully saved.',
    );
  });

  it('exports Magento English constants for all account actions', () => {
    assert.equal(
      ACCOUNT_SUCCESS_MESSAGES['save-payment'],
      'Payment has been successfully saved.',
    );
    assert.equal(
      ACCOUNT_SUCCESS_MESSAGES['save-next-payment-date'],
      'Next Payment Date has been successfully changed.',
    );
    assert.equal(
      ACCOUNT_SUCCESS_MESSAGES['save-plan'],
      'Subscription Plan has been successfully changed.',
    );
    assert.equal(
      ACCOUNT_SUCCESS_MESSAGES['save-item'],
      'The subscription has been updated successfully.',
    );
    assert.equal(
      ACCOUNT_SUCCESS_MESSAGES.cancel,
      'The subscription was successfully canceled.',
    );
    assert.equal(
      ACCOUNT_SUCCESS_MESSAGES.extend,
      'The subscription was successfully extended.',
    );
    assert.equal(
      ACCOUNT_SUCCESS_MESSAGES['skip-next'],
      'The next subscription order was skipped successfully.',
    );
    assert.equal(
      ACCOUNT_SUCCESS_MESSAGES['remove-item'],
      'The product was successfully removed from this subscription.',
    );
    assert.equal(
      ACCOUNT_SUCCESS_MESSAGES['unskip-item'],
      'The product was successfully returned to the subscription.',
    );
    assert.equal(
      ACCOUNT_SUCCESS_MESSAGES['skip-item'],
      'The product will not be included in the next order. Your subscription will go back to regular orders afterward.',
    );
    assert.equal(getAccountSuccessMessage('unknown'), null);
  });

  it('renderAccountSuccessMessage escapes HTML and uses AccS markup', () => {
    const html = renderAccountSuccessMessage('Saved <script>alert(1)</script>');
    assert.match(html, /class="message success"/);
    assert.match(html, /role="status"/);
    assert.match(html, /Saved &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal(renderAccountSuccessMessage(''), '');
  });

  it('detail UI paints success banner above the detail card', () => {
    const html = renderSubscriptionDetail({
      profile_id: 91,
      increment_id: 'SUB-000000091',
      status: 'active',
      plan_name: 'Monthly',
      items: [],
      details: {},
      actions: {},
    }, {
      successMessage: ACCOUNT_SUCCESS_MESSAGES['save-plan'],
    });

    assert.match(html, /class="message success"/);
    assert.match(html, /Subscription Plan has been successfully changed\./);
    const bannerIdx = html.indexOf('message success');
    const cardIdx = html.indexOf('recurbuy-subscription-detail__card');
    assert.ok(bannerIdx > -1 && cardIdx > bannerIdx);
  });
});

describe('edit mount Magento flash action ids', () => {
  it('save-payment / save-plan / save-item / save-next-payment-date constants match Magento', () => {
    assert.equal(
      getAccountSuccessMessage('save-payment'),
      'Payment has been successfully saved.',
    );
    assert.equal(
      getAccountSuccessMessage('save-plan'),
      'Subscription Plan has been successfully changed.',
    );
    assert.equal(
      getAccountSuccessMessage('save-item'),
      'The subscription has been updated successfully.',
    );
    assert.equal(
      getAccountSuccessMessage('save-next-payment-date'),
      'Next Payment Date has been successfully changed.',
    );
  });

  it('edit mounts set flash for Magento action ids before navigate', async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const files = {
      'mount-subscription-edit-payment.js': 'save-payment',
      'mount-subscription-edit-plan.js': 'save-plan',
      'mount-subscription-edit-item.js': 'save-item',
      'mount-subscription-edit-next-payment-date.js': 'save-next-payment-date',
    };
    await Promise.all(Object.entries(files).map(async ([file, actionId]) => {
      const source = await readFile(join(root, file), 'utf8');
      assert.match(source, /setAccountSuccessFlashForAction/);
      assert.match(source, new RegExp(`setAccountSuccessFlashForAction\\('${actionId}'\\)`));
    }));
  });
});
