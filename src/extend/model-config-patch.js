/**
 * Reversible patch of one drop-in model hook (`config.models[Model][hook]`).
 * The host's own hook is always kept: ours wraps it and, on dispose, the
 * previous value is put back.
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
  return Boolean(value) && typeof value === 'object';
}

/**
 * @param {Record<string, any>} config
 * @param {string} model
 * @param {string} hook
 * @returns {Function|null}
 */
function readHook(config, model, hook) {
  const fn = config?.models?.[model]?.[hook];
  return typeof fn === 'function' ? fn : null;
}

/**
 * @param {Record<string, any>} config
 * @param {string} model
 * @param {string} hook
 * @param {Function|null} fn `null` removes the hook key
 * @returns {Record<string, any>}
 */
function withHook(config, model, hook, fn) {
  const models = isObject(config.models) ? config.models : {};
  const { [hook]: _dropped, ...rest } = isObject(models[model]) ? models[model] : {};
  return {
    ...config,
    models: {
      ...models,
      [model]: fn ? { ...rest, [hook]: fn } : rest,
    },
  };
}

/**
 * @param {{ getConfig: () => any, setConfig: (config: any) => void }} configApi
 *   a drop-in `config` object
 * @param {{
 *   model: string,
 *   hook: string,
 *   create: (prior: Function|null) => Function,
 *   passThrough?: Function,
 * }} options
 *   `create` builds the active hook around the host's prior one.
 *   `passThrough` is what remains when the host composed another hook on top
 *   of ours and we can no longer be removed from the chain: it delegates to
 *   the prior hook (or to `passThrough` itself when there was none).
 * @returns {() => void} dispose
 */
export function patchModelHook(configApi, {
  model, hook, create, passThrough = () => undefined,
}) {
  if (typeof configApi?.getConfig !== 'function' || typeof configApi?.setConfig !== 'function') {
    return () => {};
  }

  const previous = configApi.getConfig() || {};
  const prior = readHook(previous, model, hook);
  const active = create(prior);
  let live = true;

  const ours = (...args) => {
    if (live) return active(...args);
    return prior ? prior(...args) : passThrough(...args);
  };

  configApi.setConfig(withHook(previous, model, hook, ours));

  return () => {
    if (!live) return;
    live = false;
    const current = configApi.getConfig() || {};
    if (readHook(current, model, hook) !== ours) return;
    configApi.setConfig(withHook(current, model, hook, prior));
  };
}
