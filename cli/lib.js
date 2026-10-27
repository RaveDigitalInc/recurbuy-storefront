import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_DEP_KEY = '@dropins/storefront-recurbuy';
export const PACKAGE_NAME = '@recurbuy/storefront-eds';

/** The only values a merchant must enter, in `config.json` -> `public.default`. */
export const REQUIRED_CONFIG_KEYS = {
  'subscriptions-storefront-url': 'URL of your RecurBuy panel, e.g. https://panel.example.com',
  'subscriptions-connection-token': 'storefront token of this store\'s Connection (RecurBuy panel)',
};
const PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

export const IMPORT_MAP_ENTRIES = {
  '@dropins/storefront-recurbuy/': '/scripts/__dropins__/storefront-recurbuy/',
  '@dropins/storefront-recurbuy': '/scripts/__dropins__/storefront-recurbuy/api.js',
};

/**
 * @param {string} cwd
 * @param {string[]} parts
 */
export function resolvePath(cwd, ...parts) {
  return path.join(cwd, ...parts);
}

/**
 * @param {string} filePath
 */
export function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * @param {string} filePath
 * @param {string} contents
 */
export function writeText(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

/**
 * @param {string} cwd
 */
export function loadPackageJson(cwd) {
  const filePath = resolvePath(cwd, 'package.json');
  return {
    filePath,
    data: JSON.parse(readText(filePath)),
  };
}

/**
 * @param {Record<string, unknown>} pkg
 */
export function ensureAliasDependency(pkg) {
  const deps = { ...(pkg.dependencies || {}) };
  let changed = false;
  if (deps[DEFAULT_DEP_KEY]) {
    return { dependencies: deps, changed: false };
  }
  // Prefer local file path if merchant already has @recurbuy/storefront-eds
  if (deps[PACKAGE_NAME]) {
    deps[DEFAULT_DEP_KEY] = deps[PACKAGE_NAME];
    delete deps[PACKAGE_NAME];
    changed = true;
  } else {
    deps[DEFAULT_DEP_KEY] = `npm:${PACKAGE_NAME}@${PACKAGE_VERSION}`;
    changed = true;
  }
  return { dependencies: deps, changed };
}

/**
 * @param {string} headHtml
 */
export function ensureImportMap(headHtml) {
  let next = headHtml;
  let changed = false;
  for (const [key, value] of Object.entries(IMPORT_MAP_ENTRIES)) {
    const needle = `"${key}"`;
    if (next.includes(needle)) {
      continue;
    }
    // Insert before closing of imports object — after last @dropins/tools line if present
    const toolsLine = /("@dropins\/tools\/"\s*:\s*"[^"]+")/;
    if (toolsLine.test(next)) {
      next = next.replace(toolsLine, `$1,\n            "${key}": "${value}"`);
      changed = true;
      continue;
    }
    const importsClose = /("imports"\s*:\s*\{)([\s\S]*?)(\n\s*\})/;
    if (!importsClose.test(next)) {
      return { source: headHtml, changed: false, missingAnchor: true };
    }
    next = next.replace(importsClose, (full, open, body, close) => {
      const trimmed = body.trimEnd().replace(/,\s*$/, '');
      const addition = trimmed
        ? `${trimmed},\n            "${key}": "${value}"`
        : `\n            "${key}": "${value}"`;
      return `${open}${addition}${close}`;
    });
    changed = true;
  }
  return { source: next, changed };
}

const BUILD_MJS_OPERATION = 'CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION';
const BUILD_MJS_IMPORT = `import { ${BUILD_MJS_OPERATION} } from '${DEFAULT_DEP_KEY}/graphql.js';\n`;

/**
 * Fill the stock `@dropins/storefront-cart` entry (`operations: []`) of `build.mjs`
 * with the RecurBuy CART_ITEM fragment override (`custom_attributes` +
 * `product.uid`). Comments and the other entries stay untouched.
 * @param {string} buildMjs
 */
export function ensureBuildMjsCartFragment(buildMjs) {
  if (buildMjs.includes(BUILD_MJS_OPERATION)) {
    return { source: buildMjs, changed: false, alreadyPresent: true };
  }
  const cartOperations = /(npm:\s*'@dropins\/storefront-cart'[\s\S]*?operations:\s*\[)\s*(\])/;
  if (!cartOperations.test(buildMjs)) {
    return { source: buildMjs, changed: false, missingAnchor: true };
  }
  const next = buildMjs
    .replace(cartOperations, `$1${BUILD_MJS_OPERATION}$2`)
    .replace(/^(import [^\n]+\n)/, `$1${BUILD_MJS_IMPORT}`);
  return { source: next, changed: true };
}

/**
 * Inverse of `ensureBuildMjsCartFragment`.
 * @param {string} buildMjs
 */
export function removeBuildMjsCartFragment(buildMjs) {
  const next = buildMjs
    .replace(BUILD_MJS_IMPORT, '')
    .replace(`operations: [${BUILD_MJS_OPERATION}]`, 'operations: []');
  return { source: next, changed: next !== buildMjs };
}
