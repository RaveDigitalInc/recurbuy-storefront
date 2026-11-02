import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatVaultCardBrand,
  renderVaultCreditCardHtml,
} from '../src/helpers/vault-credit-card-html.js';

describe('renderVaultCreditCardHtml', () => {
  it('renders Magento AccS credit-card wrapper from vault details', () => {
    const html = renderVaultCreditCardHtml({
      maskedCC: '1111',
      expirationDate: '12/2028',
      type: 'VI',
    });
    assert.match(html, /class="credit-card wrapper"/);
    assert.match(html, /Card Number:/);
    assert.match(html, /\*\*\*\*1111/);
    assert.match(html, /Expiration Date:/);
    assert.match(html, /12\/2028/);
    assert.match(html, />Visa</);
    assert.doesNotMatch(html, />VI</);
    assert.doesNotMatch(html, /<img/);
  });

  it('omits UNKNOWN and other placeholder card types', () => {
    const html = renderVaultCreditCardHtml({
      maskedCC: '1111',
      expirationDate: '12/2028',
      type: 'UNKNOWN',
    });
    assert.match(html, /\*\*\*\*1111/);
    assert.doesNotMatch(html, /UNKNOWN/i);
    assert.doesNotMatch(html, /card-type/);
  });

  it('returns empty string without maskedCC', () => {
    assert.equal(renderVaultCreditCardHtml(null), '');
    assert.equal(renderVaultCreditCardHtml({}), '');
    assert.equal(renderVaultCreditCardHtml({ expirationDate: '12/2028' }), '');
  });

  it('escapes vault detail strings', () => {
    const html = renderVaultCreditCardHtml({
      maskedCC: '11<script>',
      expirationDate: '12/<b>',
      type: 'VI',
    });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;b&gt;/);
    assert.match(html, />Visa</);
  });
});

describe('formatVaultCardBrand', () => {
  it('maps known codes and hides placeholders', () => {
    assert.equal(formatVaultCardBrand('MC'), 'Mastercard');
    assert.equal(formatVaultCardBrand('unknown'), null);
    assert.equal(formatVaultCardBrand(''), null);
    assert.equal(formatVaultCardBrand('ZZ'), null);
  });
});
