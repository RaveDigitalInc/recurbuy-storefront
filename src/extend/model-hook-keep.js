/**
 * Keep a drop-in model hook alive across Adobe `setConfig` wipes.
 * Pure — no drop-in imports (safe for Node unit tests).
 */

/**
 * @param {{
 *   getConfig: () => any,
 *   setConfig: (config: any) => void,
 * }} configApi
 * @param {{
 *   attach: () => () => void,
 *   hasHook: () => boolean,
 *   on?: (name: string, handler: Function, opts?: object) => { off: () => void },
 * }} options
 * @returns {() => void} dispose
 */
export function keepModelHookAcrossSetConfig(configApi, {
  attach,
  hasHook,
  on = null,
}) {
  let disposeHook = attach();
  let reapplying = false;

  const reapply = () => {
    reapplying = true;
    try {
      disposeHook?.();
      disposeHook = attach();
    } finally {
      reapplying = false;
    }
  };

  const hostSetConfig = configApi.setConfig.bind(configApi);
  configApi.setConfig = (next) => {
    hostSetConfig(next);
    if (!reapplying && !hasHook()) {
      reapply();
    }
  };

  const initialized = typeof on === 'function'
    ? on('cart/initialized', () => {
      if (!hasHook()) reapply();
    }, { eager: true })
    : null;

  return () => {
    initialized?.off?.();
    configApi.setConfig = hostSetConfig;
    disposeHook?.();
    disposeHook = null;
  };
}
