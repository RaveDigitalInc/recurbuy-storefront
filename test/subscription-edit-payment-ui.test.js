import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderEditPaymentForm } from '../src/subscription-edit-payment-ui.js';

describe('subscription edit payment UI', () => {
  it('renders AccS credit-card markup for current and radio options', () => {
    const html = renderEditPaymentForm({
      profileId: 91,
      incrementId: 'SUB-000000091',
      isEditPaymentAvailable: true,
      currentDetails: { maskedCC: '1111', expirationDate: '12/2028', type: 'VI' },
      currentLabel: '•••• 1111',
      tokens: [
        {
          public_hash: 'abc123hash',
          payment_method_code: 'payment_services_paypal_vault',
          type: 'card',
          details: { maskedCC: '1111', expirationDate: '12/2028', type: 'VI' },
          label: '•••• 1111',
        },
        {
          public_hash: 'def456hash',
          payment_method_code: 'payment_services_paypal_vault',
          type: 'card',
          details: { maskedCC: '4444', expirationDate: '01/2030', type: 'MC' },
          label: '•••• 4444',
        },
      ],
      selectedPublicHash: 'def456hash',
    });

    assert.match(html, /Edit Payment Details/);
    assert.match(html, /SUB-000000091/);
    assert.match(html, /Current payment method/);
    assert.match(html, /Choose a saved card/);
    assert.match(html, /credit-card wrapper/);
    assert.match(html, /\*\*\*\*1111/);
    assert.match(html, /\*\*\*\*4444/);
    assert.match(html, /12\/2028/);
    assert.match(html, /01\/2030/);
    assert.doesNotMatch(html, /Expires 12\/2028/);
    assert.match(html, /name="payment_public_hash"/);
    assert.match(html, /value="abc123hash"/);
    assert.match(html, /value="def456hash"/);
    assert.match(html, /id="recurbuy-edit-payment-def456hash"[^>]*checked/);
    assert.doesNotMatch(html, /id="recurbuy-edit-payment-abc123hash"[^>]*checked/);
    assert.match(html, /#rb\/detail\/91/);
    assert.match(html, />Save</);
  });

  it('does not treat radio preselect as Current when profile has no vault stamp', () => {
    const html = renderEditPaymentForm({
      profileId: 8,
      isEditPaymentAvailable: true,
      tokens: [
        {
          public_hash: 'match-hash',
          label: '•••• 2222',
          details: { maskedCC: '2222', expirationDate: '06/2029', type: 'MC' },
        },
      ],
      selectedPublicHash: 'match-hash',
    });

    assert.match(html, /Current payment method/);
    assert.match(html, /No card on this subscription yet/);
    const currentBody = html.match(
      /recurbuy-edit-payment__current-body">([\s\S]*?)<\/div>\s*<form/,
    )?.[1] ?? '';
    assert.doesNotMatch(currentBody, /\*\*\*\*2222/);
    assert.match(html, /\*\*\*\*2222/); // still listed as a choosable saved card
  });

  it('shows unavailable when edit payment flag is off', () => {
    const html = renderEditPaymentForm({
      profileId: 3,
      isEditPaymentAvailable: false,
      currentLabel: '•••• 1111',
      tokens: [{
        public_hash: 'abc123hash',
        payment_method_code: 'payment_services_paypal_vault',
        type: 'card',
        details: null,
        label: '•••• 1111',
      }],
      selectedPublicHash: 'abc123hash',
    });

    assert.match(html, /not available/i);
    assert.doesNotMatch(html, /name="payment_public_hash"/);
  });

  it('shows empty state when no saved cards exist', () => {
    const html = renderEditPaymentForm({
      profileId: 3,
      isEditPaymentAvailable: true,
      currentLabel: '•••• 1111',
      tokens: [],
    });

    assert.match(html, /No saved cards…/);
    assert.match(html, /disabled/);
  });

  it('ignores stale server html that echoes UNKNOWN when details exist', () => {
    const html = renderEditPaymentForm({
      profileId: 9,
      isEditPaymentAvailable: true,
      currentHtml: '<div class="credit-card wrapper"><div class="card-number"><span>Card Number:</span> <span>****1111</span></div><div class="card-type"><span>UNKNOWN</span></div></div>',
      currentDetails: { maskedCC: '1111', expirationDate: '12/2028', type: 'UNKNOWN' },
      tokens: [{
        public_hash: 'hash-9',
        details: { maskedCC: '1111', expirationDate: '12/2028', type: 'UNKNOWN' },
        label: '•••• 1111',
      }],
      selectedPublicHash: 'hash-9',
    });

    assert.match(html, /\*\*\*\*1111/);
    assert.doesNotMatch(html, /UNKNOWN/i);
  });

  it('prefers selectedPublicHash over first token', () => {
    const html = renderEditPaymentForm({
      profileId: 7,
      isEditPaymentAvailable: true,
      tokens: [
        { public_hash: 'first-hash', label: '•••• 0001', details: null },
        { public_hash: 'second-hash', label: '•••• 0002', details: null },
      ],
      selectedPublicHash: 'second-hash',
    });

    assert.match(html, /id="recurbuy-edit-payment-second-hash"[^>]*checked/);
    assert.doesNotMatch(html, /id="recurbuy-edit-payment-first-hash"[^>]*checked/);
  });
});
