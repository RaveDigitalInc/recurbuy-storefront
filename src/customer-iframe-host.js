import { getShopperAuthToken } from './auth.js';
import { getValidSubscriptionConfig } from './config.js';
import {
  CUSTOMER_CONTEXT,
  CUSTOMER_READY,
  CUSTOMER_RESIZE,
  CUSTOMER_UNAUTHENTICATED,
  customerEmbedUrl,
  customerPanelOrigin,
} from './customer-iframe-protocol.js';

const MIN_FRAME_HEIGHT_PX = 240;

/**
 * Panel customer iframe for My Subscriptions / account pages.
 * Tokens go over postMessage after `recurbuy-customer-ready`, never in the URL.
 *
 * @param {HTMLElement} rootEl
 * @param {{
 *   page?: unknown,
 *   getAuthToken?: () => string|undefined,
 *   onUnauthenticated?: () => void,
 * }} [options]
 * @returns {{ destroy: () => void, refresh: () => void }}
 */
export function mountCustomerIframe(rootEl, options = {}) {
  if (!(rootEl instanceof HTMLElement)) {
    throw new Error('[RecurBuy] customer iframe requires a DOM element.');
  }

  const getAuthToken = typeof options.getAuthToken === 'function'
    ? options.getAuthToken
    : getShopperAuthToken;
  const { storefrontUrl, connectionToken } = getValidSubscriptionConfig();
  const embedSrc = customerEmbedUrl(storefrontUrl);
  const panelOrigin = customerPanelOrigin(storefrontUrl);
  const page = options.page === undefined ? 'list' : options.page;

  /** @type {HTMLIFrameElement} */
  const iframe = document.createElement('iframe');
  iframe.className = 'recurbuy-customer-frame';
  iframe.title = 'Subscriptions';
  iframe.setAttribute('scrolling', 'no');
  iframe.src = embedSrc;
  iframe.style.cssText = [
    'width:100%',
    'border:0',
    'display:block',
    `min-height:${MIN_FRAME_HEIGHT_PX}px`,
    'overflow:hidden',
  ].join(';');

  let destroyed = false;
  let handshakeDone = false;

  rootEl.classList.add('recurbuy-customer-host');
  rootEl.replaceChildren(iframe);

  /**
   * @param {MessageEvent} event
   */
  function onMessage(event) {
    if (destroyed) return;
    if (event.origin !== panelOrigin) return;
    if (event.source !== iframe.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === CUSTOMER_READY) {
      sendContext();
      return;
    }
    if (data.type === CUSTOMER_RESIZE) {
      const height = Number(data.height);
      if (!Number.isFinite(height) || height < 0) return;
      iframe.style.height = `${Math.max(MIN_FRAME_HEIGHT_PX, Math.ceil(height))}px`;
      return;
    }
    if (data.type === CUSTOMER_UNAUTHENTICATED) {
      options.onUnauthenticated?.();
    }
  }

  function sendContext() {
    const customerToken = getAuthToken();
    if (!customerToken) {
      options.onUnauthenticated?.();
      return;
    }
    iframe.contentWindow?.postMessage({
      type: CUSTOMER_CONTEXT,
      connectionToken,
      customerToken,
      page,
    }, panelOrigin);
    handshakeDone = true;
  }

  window.addEventListener('message', onMessage);

  return {
    destroy() {
      destroyed = true;
      window.removeEventListener('message', onMessage);
      rootEl.replaceChildren();
      rootEl.classList.remove('recurbuy-customer-host');
    },
    refresh() {
      if (destroyed) return;
      if (handshakeDone) {
        sendContext();
        return;
      }
      iframe.src = embedSrc;
    },
  };
}
