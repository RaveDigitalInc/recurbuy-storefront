import fs from 'node:fs';
import {
  DEFAULT_DEP_KEY,
  IMPORT_MAP_ENTRIES,
  PACKAGE_NAME,
  REQUIRED_CONFIG_KEYS,
  loadPackageJson,
  readText,
  resolvePath,
} from './lib.js';

/**
 * @param {{ cwd: string }} options
 */
export function runDoctor(options) {
  const { cwd } = options;
  const ok = [];
  const fail = [];
  const warn = [];

  const pkg = loadPackageJson(cwd);
  const deps = pkg.data.dependencies || {};
  if (deps[DEFAULT_DEP_KEY]) {
    ok.push(`dependency ${DEFAULT_DEP_KEY}`);
  } else if (deps[PACKAGE_NAME]) {
    warn.push(`has ${PACKAGE_NAME} but not alias ${DEFAULT_DEP_KEY} (stock postinstall will not vendor it)`);
  } else {
    fail.push(`missing ${DEFAULT_DEP_KEY} (or ${PACKAGE_NAME})`);
  }

  const dropinDir = resolvePath(cwd, 'scripts', '__dropins__', 'storefront-recurbuy');
  if (fs.existsSync(dropinDir)) {
    ok.push('scripts/__dropins__/storefront-recurbuy present');
    if (!fs.existsSync(resolvePath(dropinDir, 'api.js'))) {
      warn.push('vendored package missing api.js — re-run npm run install:dropins');
    }
  } else {
    fail.push('scripts/__dropins__/storefront-recurbuy missing — run npm run install:dropins');
  }

  const headPath = resolvePath(cwd, 'head.html');
  if (fs.existsSync(headPath)) {
    const head = readText(headPath);
    for (const key of Object.keys(IMPORT_MAP_ENTRIES)) {
      if (head.includes(`"${key}"`)) ok.push(`import map ${key}`);
      else warn.push(`import map missing ${key}`);
    }
  } else {
    fail.push('head.html missing');
  }

  const buildPath = resolvePath(cwd, 'build.mjs');
  if (fs.existsSync(buildPath)) {
    const build = readText(buildPath);
    if (build.includes('CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION')) {
      ok.push('build.mjs custom_attributes');
    } else {
      fail.push('build.mjs missing cart custom_attributes fragment');
    }
  } else {
    fail.push('build.mjs missing');
  }

  const cartInit = resolvePath(cwd, 'scripts', 'initializers', 'cart.js');

  if (fs.existsSync(resolvePath(cwd, 'scripts', 'initializers', 'recurbuy.js'))) {
    ok.push('scripts/initializers/recurbuy.js');
  } else {
    warn.push('scripts/initializers/recurbuy.js missing');
  }

  if (fs.existsSync(resolvePath(cwd, 'blocks', 'commerce-subscriptions', 'commerce-subscriptions.js'))) {
    ok.push('blocks/commerce-subscriptions');
  } else {
    fail.push('blocks/commerce-subscriptions missing');
  }

  const cartInitSource = fs.existsSync(cartInit) ? readText(cartInit) : '';
  if (cartInitSource.includes("import './recurbuy.js';")) {
    ok.push('cart initializer loads scripts/initializers/recurbuy.js');
  } else {
    fail.push("scripts/initializers/cart.js missing import './recurbuy.js' — run init");
  }

  const configPath = resolvePath(cwd, 'config.json');
  const examplePath = resolvePath(cwd, 'config.example.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(readText(configPath));
      const defaults = config?.public?.default || config?.default || {};
      for (const key of Object.keys(REQUIRED_CONFIG_KEYS)) {
        if (defaults[key]) ok.push(`config ${key}`);
        else fail.push(`config.json missing public.default.${key}`);
      }
    } catch {
      fail.push('config.json is not valid JSON');
    }
  } else if (fs.existsSync(examplePath)) {
    warn.push('config.json missing (example present) — copy and fill subscriptions-* keys');
  } else {
    warn.push('config.json missing');
  }

  return {
    ok, warn, fail, exitCode: fail.length ? 1 : 0,
  };
}
