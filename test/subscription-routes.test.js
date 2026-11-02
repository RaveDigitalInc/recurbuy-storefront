import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveSubscriptionAccountPageId,
  subscriptionAccountHref,
  readSubscriptionAccountQuery,
  SUBSCRIPTION_ACCOUNT_PAGES,
  SUBSCRIPTIONS_LIST_PATH,
} from '../src/account/subscription-routes.js';

describe('subscription account routes', () => {
  it('lists Magento-parity edit scaffolds', () => {
    assert.deepEqual(
      SUBSCRIPTION_ACCOUNT_PAGES.map((page) => page.id),
      [
        'detail',
        'edit-plan',
        'edit-address',
        'edit-payment',
        'edit-next-payment-date',
        'edit-item',
      ],
    );
  });

  it('resolves page id from #rb/ hash (single DA document)', () => {
    assert.equal(
      resolveSubscriptionAccountPageId(
        '/customer/subscriptions',
        '',
        '#rb/detail/91',
      ),
      'detail',
    );
    assert.equal(
      resolveSubscriptionAccountPageId(
        '/customer/subscriptions',
        '',
        '#rb/edit-plan/91',
      ),
      'edit-plan',
    );
    assert.equal(
      resolveSubscriptionAccountPageId('/customer/subscriptions', '', ''),
      null,
    );
  });

  it('still resolves legacy ?page= and path overlays', () => {
    assert.equal(
      resolveSubscriptionAccountPageId(
        '/customer/subscriptions',
        '?page=detail&profile_id=91',
        '',
      ),
      'detail',
    );
    assert.equal(
      resolveSubscriptionAccountPageId('/customer/subscriptions/edit-plan'),
      'edit-plan',
    );
  });

  it('builds hash hrefs and reads ids from hash', () => {
    assert.equal(
      subscriptionAccountHref('detail', { profileId: 91 }),
      '/customer/subscriptions#rb/detail/91',
    );
    assert.equal(
      subscriptionAccountHref('edit-item', { profileId: 9, itemId: 3 }),
      '/customer/subscriptions#rb/edit-item/9/3',
    );
    assert.equal(subscriptionAccountHref('list'), SUBSCRIPTIONS_LIST_PATH);
    assert.deepEqual(
      readSubscriptionAccountQuery('', '#rb/edit-item/9/3'),
      { profileId: '9', itemId: '3' },
    );
  });
});
