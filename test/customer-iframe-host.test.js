import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CUSTOMER_CONTEXT,
  CUSTOMER_EMBED_PATH,
  CUSTOMER_READY,
  CUSTOMER_RESIZE,
  CUSTOMER_UNAUTHENTICATED,
  customerEmbedUrl,
  customerPanelOrigin,
} from '../src/customer-iframe-protocol.js';

describe('customer iframe host', () => {
  it('builds /dist/storefront/index.html from the panel storefront URL without query tokens', () => {
    assert.equal(
      customerEmbedUrl('https://panel.example.com/'),
      'https://panel.example.com/dist/storefront/index.html',
    );
    assert.equal(CUSTOMER_EMBED_PATH, '/dist/storefront/index.html');
    assert.equal(
      customerPanelOrigin('https://panel.example.com/app'),
      'https://panel.example.com',
    );
    assert.doesNotMatch(customerEmbedUrl('https://panel.example.com'), /token=/i);
  });

  it('uses the panel handshake message types', () => {
    assert.equal(CUSTOMER_READY, 'recurbuy-customer-ready');
    assert.equal(CUSTOMER_CONTEXT, 'recurbuy-customer-context');
    assert.equal(CUSTOMER_RESIZE, 'recurbuy-customer-resize');
    assert.equal(CUSTOMER_UNAUTHENTICATED, 'recurbuy-customer-unauthenticated');
  });
});
