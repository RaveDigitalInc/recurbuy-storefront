/**
 * Mount roots that exist in the document only while RecurBuy has something to
 * show. A product without subscription plans therefore never gets a (hidden,
 * empty) wrapper node next to the host's own markup.
 *
 * DOM-free by contract: it only needs `isConnected` / `remove()` on the roots.
 */

/**
 * @param {{
 *   roots: Array<{ isConnected: boolean, remove: () => void }>,
 *   attach: () => void,
 * }} options `attach` inserts every root at its place in the host markup
 * @returns {{ setVisible: (visible: boolean) => void, dispose: () => void }}
 */
export function createDeferredRoots({ roots, attach }) {
  const detach = () => roots.forEach((root) => {
    if (root.isConnected) root.remove();
  });

  return {
    setVisible(visible) {
      if (!visible) {
        detach();
        return;
      }
      if (!roots.every((root) => root.isConnected)) attach();
    },
    dispose: detach,
  };
}
