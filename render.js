/**
 * Adobe-style render provider: `provider.render(Container, props)(el)`.
 * Containers expose `{ mount(el, props) }` (DOM mount; not full Preact UIProvider).
 */

export const render = {
  /**
   * @param {{ mount: (el: HTMLElement, props?: object) => unknown }} Container
   * @param {object} [props]
   * @returns {(el: HTMLElement) => unknown}
   */
  render(Container, props = {}) {
    return (el) => {
      if (!el) {
        throw new Error('RecurBuy render: target element is required');
      }
      if (!Container || typeof Container.mount !== 'function') {
        throw new Error('RecurBuy render: container must provide mount(el, props)');
      }
      return Container.mount(el, props);
    };
  },
};
