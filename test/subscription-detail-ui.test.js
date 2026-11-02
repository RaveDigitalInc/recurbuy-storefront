import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderSubscriptionDetail } from '../src/subscription-detail-ui.js';

describe('subscription detail UI', () => {
  it('renders Magento-like rows and action links from storefront detail payload', () => {
    const html = renderSubscriptionDetail({
      profile_id: 91,
      increment_id: 'SUB-000000091',
      status: 'active',
      plan_name: 'Monthly Box',
      is_virtual: false,
      items: [
        {
          item_id: 11, name: 'Coffee', parent_item_id: null, sku: 'c1',
        },
      ],
      shipping_address_html: '<p>1 Main St</p>',
      payment_details: {
        payment_method_title: 'Check / Money Order',
        html: '<div class="payment-details wrapper"><span>Check / Money Order</span></div>',
      },
      details: {
        created_date: 'Jan 1, 2026',
        subscription_end_label: 'Subscription Ends',
        subscription_end_date: 'Unlimited',
        next_payment_info: 'Feb 1, 2026',
        is_show_regular: true,
        regular_label: 'Regular Payment',
        regular_price_and_cycles: '$10.00 / cycle',
        is_show_initial: false,
        is_show_trial: false,
        is_trial_period_active: false,
      },
      actions: {
        is_extend_available: true,
        is_cancel_available: true,
        is_edit_plan_available: true,
        is_edit_next_payment_date_available: true,
        is_skip_this_date_available: true,
        is_edit_address_available: true,
        is_edit_payment_available: true,
        items: [{
          item_id: 11,
          is_edit_item_available: true,
          is_skip_available: false,
          is_unskip_available: false,
          is_remove_available: false,
        }],
      },
    });

    assert.match(html, /recurbuy-subscription-detail__card/);
    assert.match(html, /SUB-000000091/);
    assert.match(html, /Monthly Box/);
    assert.match(html, /Coffee/);
    assert.match(html, /#rb\/edit-plan\/91/);
    assert.match(html, /#rb\/edit-address\/91/);
    assert.match(html, /#rb\/edit-payment\/91/);
    assert.match(html, /#rb\/edit-item\/91\/11/);
    assert.match(html, /data-recurbuy-detail-action="extend"/);
    assert.match(html, /data-recurbuy-detail-action="cancel"/);
    assert.match(html, /data-recurbuy-detail-action="skip-next"/);
    assert.match(html, /1 Main St/);
    assert.match(html, /Check \/ Money Order/);
  });

  it('humanizes raw payment method codes when vault HTML is missing', () => {
    const html = renderSubscriptionDetail({
      profile_id: 1,
      increment_id: 'SUB-1',
      status: 'active',
      plan_name: 'Plan',
      items: [],
      payment_details: {
        payment_method: 'payment_services_paypal_hosted_fields',
        payment_method_title: 'payment_services_paypal_hosted_fields',
        payment_token_id: 5,
      },
      details: {},
      actions: {},
    });
    assert.match(html, /Saved payment method/);
    assert.doesNotMatch(html, /payment_services_paypal_hosted_fields/);
  });

  it('renders AccS credit-card markup from payment_details.details when html is absent', () => {
    const html = renderSubscriptionDetail({
      profile_id: 2,
      increment_id: 'SUB-2',
      status: 'active',
      plan_name: 'Plan',
      items: [],
      payment_details: {
        payment_method: 'payment_services_paypal_vault',
        payment_method_title: 'payment_services_paypal_vault',
        payment_public_hash: 'abc123hash',
        details: { maskedCC: '1111', expirationDate: '12/2028', type: 'VI' },
        label: '•••• 1111',
      },
      details: {},
      actions: {},
    });
    assert.match(html, /credit-card wrapper/);
    assert.match(html, /\*\*\*\*1111/);
    assert.match(html, /12\/2028/);
    assert.doesNotMatch(html, /Saved payment method/);
    assert.doesNotMatch(html, /payment_services_paypal_vault/);
  });

  it('prefers payment_details.details over stale server html', () => {
    const html = renderSubscriptionDetail({
      profile_id: 3,
      increment_id: 'SUB-3',
      status: 'active',
      plan_name: 'Plan',
      items: [],
      payment_details: {
        html: '<div class="credit-card wrapper"><div class="card-number"><span>****9999</span></div><div class="card-type"><span>UNKNOWN</span></div></div>',
        details: { maskedCC: '1111', expirationDate: '12/2028', type: 'UNKNOWN' },
      },
      details: {},
      actions: {},
    });
    assert.match(html, /\*\*\*\*1111/);
    assert.doesNotMatch(html, /\*\*\*\*9999/);
    assert.doesNotMatch(html, /UNKNOWN/i);
  });
});
