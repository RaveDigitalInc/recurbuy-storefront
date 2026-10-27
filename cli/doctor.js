import fs from 'node:fs';
import {
  DEFAULT_SUITE,
  listPendingPatches,
  loadManifest,
} from './apply-patches.js';
import { publicUrls } from './da-client.js';
import { resolveDaSite } from './da-site.js';
import {
  compareVersions,
  readInstallState,
  readPackageIdentity,
  STATE_FILE,
} from './install-state.js';
import {
  DEFAULT_DEP_KEY,
  IMPORT_MAP_ENTRIES,
  PACKAGE_NAME,
  REQUIRED_CONFIG_KEYS,
  loadPackageJson,
  readText,
  resolvePath,
} from './lib.js';
import {
  readBoilerplateIdentity,
  resolveSuite,
} from './suite-resolve.js';

/**
 * @typedef {{
 *   id: string,
 *   status: 'ok' | 'warn' | 'fail',
 *   label: string,
 *   fix?: string,
 * }} DoctorCheck
 */

/**
 * @param {string} url
 * @returns {Promise<{ ok: boolean, status: number, text: string }>}
 */
async function fetchPublic(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { Accept: 'text/html,*/*' },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (error) {
    return { ok: false, status: 0, text: error.message || 'network error' };
  }
}

/**
 * @param {{
 *   cwd: string,
 *   org?: string,
 *   repo?: string,
 *   branch?: string,
 *   skipContent?: boolean,
 * }} options
 * @returns {Promise<{
 *   checks: DoctorCheck[],
 *   ok: string[],
 *   warn: string[],
 *   fail: string[],
 *   fixes: string[],
 *   exitCode: number,
 * }>}
 */
export async function runDoctor(options) {
  const {
    cwd,
    org,
    repo,
    branch,
    skipContent = false,
  } = options;
  /** @type {DoctorCheck[]} */
  const checks = [];

  /**
   * @param {Omit<DoctorCheck, 'status'> & { status: DoctorCheck['status'] }} check
   */
  const add = (check) => {
    checks.push(check);
  };

  const pkg = loadPackageJson(cwd);
  const deps = pkg.data.dependencies || {};
  if (deps[DEFAULT_DEP_KEY]) {
    add({
      id: 'dependency',
      status: 'ok',
      label: `dependency ${DEFAULT_DEP_KEY}`,
    });
  } else if (deps[PACKAGE_NAME]) {
    add({
      id: 'dependency',
      status: 'warn',
      label: `has ${PACKAGE_NAME} but not alias ${DEFAULT_DEP_KEY} (stock postinstall will not vendor it)`,
      fix: `In package.json set "${DEFAULT_DEP_KEY}": "npm:${PACKAGE_NAME}@x.y.z" (or run: npx recurbuy-eds init), then npm install && npm run install:dropins`,
    });
  } else {
    add({
      id: 'dependency',
      status: 'fail',
      label: `missing ${DEFAULT_DEP_KEY} (or ${PACKAGE_NAME})`,
      fix: `Add to package.json dependencies: "${DEFAULT_DEP_KEY}": "npm:${PACKAGE_NAME}@x.y.z" — or run: npx recurbuy-eds init && npm install && npm run install:dropins`,
    });
  }

  const dropinDir = resolvePath(cwd, 'scripts', '__dropins__', 'storefront-recurbuy');
  if (fs.existsSync(dropinDir)) {
    add({
      id: 'vendored',
      status: 'ok',
      label: 'scripts/__dropins__/storefront-recurbuy present',
    });
    if (!fs.existsSync(resolvePath(dropinDir, 'api.js'))) {
      add({
        id: 'vendored-api',
        status: 'warn',
        label: 'vendored package missing api.js',
        fix: 'Re-run: npm run install:dropins',
      });
    }
  } else {
    add({
      id: 'vendored',
      status: 'fail',
      label: 'scripts/__dropins__/storefront-recurbuy missing',
      fix: 'Run: npm run install:dropins  (requires the @dropins/storefront-recurbuy alias in package.json)',
    });
  }

  const headPath = resolvePath(cwd, 'head.html');
  if (fs.existsSync(headPath)) {
    const head = readText(headPath);
    for (const key of Object.keys(IMPORT_MAP_ENTRIES)) {
      if (head.includes(`"${key}"`)) {
        add({ id: `import-map:${key}`, status: 'ok', label: `import map ${key}` });
      } else {
        add({
          id: `import-map:${key}`,
          status: 'warn',
          label: `import map missing ${key}`,
          fix: 'Run: npx recurbuy-eds init  (patches head.html import map)',
        });
      }
    }
  } else {
    add({
      id: 'head',
      status: 'fail',
      label: 'head.html missing',
      fix: 'Run doctor from the storefront project root (where head.html lives).',
    });
  }

  const buildPath = resolvePath(cwd, 'build.mjs');
  if (fs.existsSync(buildPath)) {
    const build = readText(buildPath);
    if (build.includes('CART_ITEM_CUSTOM_ATTRIBUTES_OPERATION')) {
      add({
        id: 'build-mjs',
        status: 'ok',
        label: 'build.mjs cart fragment (custom_attributes + product.uid)',
      });
    } else {
      add({
        id: 'build-mjs',
        status: 'fail',
        label: 'build.mjs missing cart CART_ITEM fragment override',
        fix: 'Run: npx recurbuy-eds init  then: npm run install:dropins',
      });
    }
  } else {
    add({
      id: 'build-mjs',
      status: 'fail',
      label: 'build.mjs missing',
      fix: 'Run doctor from the storefront project root (where build.mjs lives).',
    });
  }

  if (fs.existsSync(resolvePath(cwd, 'scripts', 'initializers', 'recurbuy.js'))) {
    add({
      id: 'recurbuy-init',
      status: 'ok',
      label: 'scripts/initializers/recurbuy.js',
    });
  } else {
    add({
      id: 'recurbuy-init',
      status: 'fail',
      label: 'scripts/initializers/recurbuy.js missing',
      fix: 'Run: npx recurbuy-eds init',
    });
  }

  const blockJs = resolvePath(cwd, 'blocks', 'commerce-subscriptions', 'commerce-subscriptions.js');
  if (fs.existsSync(blockJs)) {
    add({ id: 'block', status: 'ok', label: 'blocks/commerce-subscriptions' });
  } else {
    add({
      id: 'block',
      status: 'fail',
      label: 'blocks/commerce-subscriptions missing',
      fix: 'Run: npx recurbuy-eds init  (copies blocks/commerce-subscriptions from the package). Needed for the /customer/subscriptions page block.',
    });
  }

  const cartInit = resolvePath(cwd, 'scripts', 'initializers', 'cart.js');
  const cartInitSource = fs.existsSync(cartInit) ? readText(cartInit) : '';
  if (cartInitSource.includes("import './recurbuy.js';")) {
    add({
      id: 'cart-loader',
      status: 'ok',
      label: 'cart initializer loads scripts/initializers/recurbuy.js',
    });
  } else if (!fs.existsSync(cartInit)) {
    add({
      id: 'cart-loader',
      status: 'fail',
      label: 'scripts/initializers/cart.js missing',
      fix: 'Expected stock Adobe cart initializer. Are you in the storefront root?',
    });
  } else {
    add({
      id: 'cart-loader',
      status: 'fail',
      label: "scripts/initializers/cart.js missing import './recurbuy.js'",
      fix: 'Run: npx recurbuy-eds init  (patches cart.js). If the suite patch fails, add manually: import \'./recurbuy.js\';',
    });
  }

  const configPath = resolvePath(cwd, 'config.json');
  const examplePath = resolvePath(cwd, 'config.example.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(readText(configPath));
      const defaults = config?.public?.default || config?.default || {};
      for (const [key, description] of Object.entries(REQUIRED_CONFIG_KEYS)) {
        if (defaults[key]) {
          add({ id: `config:${key}`, status: 'ok', label: `config ${key}` });
        } else {
          add({
            id: `config:${key}`,
            status: 'fail',
            label: `config.json missing public.default.${key}`,
            fix: `Set public.default["${key}"] in config.json — ${description}`,
          });
        }
      }
    } catch {
      add({
        id: 'config',
        status: 'fail',
        label: 'config.json is not valid JSON',
        fix: 'Fix JSON syntax in config.json (or restore from config.example.json / demo-config.json)',
      });
    }
  } else if (fs.existsSync(examplePath)) {
    add({
      id: 'config',
      status: 'warn',
      label: 'config.json missing (example present)',
      fix: 'Copy config.example.json (or demo-config.json) to config.json, then set subscriptions-storefront-url and subscriptions-connection-token',
    });
  } else {
    add({
      id: 'config',
      status: 'warn',
      label: 'config.json missing',
      fix: 'Create config.json from the boilerplate demo-config.json and set the two subscriptions-* keys',
    });
  }

  // --- Install state / patch upgrade drift ---
  const identity = readPackageIdentity();
  const state = readInstallState(cwd);
  const resolved = resolveSuite({ cwd });
  const boilerplate = readBoilerplateIdentity(cwd);

  if (boilerplate?.version) {
    add({
      id: 'boilerplate',
      status: 'ok',
      label: `storefront boilerplate ${boilerplate.version} → suite ${resolved.suite} (${resolved.source})`,
    });
  } else {
    add({
      id: 'boilerplate',
      status: 'warn',
      label: 'storefront package.json version unknown',
      fix: 'Ensure package.json has "version" (Adobe boilerplate semver, e.g. 11.0.0)',
    });
  }
  if (resolved.warning) {
    add({
      id: 'suite-resolve',
      status: 'warn',
      label: resolved.warning,
      fix: 'npx recurbuy-eds upgrade',
    });
  }

  if (!state) {
    add({
      id: 'state',
      status: 'warn',
      label: `${STATE_FILE} missing (patch upgrade tracking)`,
      fix: 'Run: npx recurbuy-eds init   (or upgrade once) — writes suite + applied patch ids',
    });
  } else {
    add({
      id: 'state',
      status: 'ok',
      label: `${STATE_FILE} suite=${state.suite || '?'} package=${state.packageVersion || '?'}`,
    });

    if (state.packageVersion
      && compareVersions(identity.version, state.packageVersion) > 0) {
      add({
        id: 'state-package',
        status: 'warn',
        label: `package newer than state (${state.packageVersion} → ${identity.version})`,
        fix: 'Run: npx recurbuy-eds upgrade && npm run install:dropins',
      });
    } else {
      add({
        id: 'state-package',
        status: 'ok',
        label: `package version aligned (${identity.version})`,
      });
    }

    const suite = resolved.suite || state.suite || DEFAULT_SUITE;

    if (!loadManifest(suite)) {
      add({
        id: 'state-suite',
        status: 'fail',
        label: `suite "${suite}" has no patches in this package`,
        fix: 'Install a RecurBuy package that includes patches for this theme version, then: npx recurbuy-eds upgrade',
      });
    } else {
      const pending = listPendingPatches(suite, state);
      if (pending.length) {
        add({
          id: 'state-patches',
          status: 'warn',
          label: `pending stock patches: ${pending.map((p) => `${p.id}@${p.to}`).join(', ')}`,
          fix: 'Run: npx recurbuy-eds upgrade\n'
            + '      (or upgrade --repatch if stock drifted)',
        });
      } else {
        add({
          id: 'state-patches',
          status: 'ok',
          label: `stock patches current for suite ${suite}`,
        });
      }
    }
  }

  // --- DA / live Account content (optional; needs org/repo) ---
  if (skipContent) {
    add({
      id: 'content-skip',
      status: 'warn',
      label: 'live Account content check skipped (--skip-content)',
    });
  } else {
    let site;
    try {
      site = resolveDaSite({
        cwd, org, repo, branch,
      });
    } catch {
      site = null;
    }

    if (!site) {
      add({
        id: 'content-site',
        status: 'warn',
        label: 'live Account page not checked (pass --org / --repo)',
        fix: 'Copy {org}/{repo} from da.live (https://da.live/#/{org}/{repo}/…), then:\n'
          + '      npx recurbuy-eds doctor --org=YOUR_ORG --repo=YOUR_REPO\n'
          + '      npx recurbuy-eds publish-content --org=YOUR_ORG --repo=YOUR_REPO',
      });
    } else {
      const pageUrls = publicUrls({
        org: site.org,
        repo: site.repo,
        branch: site.branch,
        pathWithoutHtml: 'customer/subscriptions',
      });
      const sidebarPlain = `https://${site.branch}--${site.repo}--${site.org}.aem.live/customer/sidebar-fragment.plain.html`;

      add({
        id: 'content-site',
        status: 'ok',
        label: `content site ${site.org}/${site.repo} (${site.branch})`,
      });

      const page = await fetchPublic(pageUrls.liveUrl);
      if (page.ok) {
        add({
          id: 'content-page',
          status: 'ok',
          label: `live page ${pageUrls.liveUrl}`,
        });
      } else {
        add({
          id: 'content-page',
          status: 'warn',
          label: `live subscriptions page not published (${page.status || 'error'})`,
          fix: `Run: npx recurbuy-eds publish-content --org=${site.org} --repo=${site.repo} --branch=${site.branch}\n`
            + `      Expected: ${pageUrls.liveUrl}`,
        });
      }

      const sidebar = await fetchPublic(sidebarPlain);
      if (!sidebar.ok) {
        add({
          id: 'content-sidebar',
          status: 'warn',
          label: `live Account sidebar not reachable (${sidebar.status || 'error'})`,
          fix: `Open ${sidebarPlain} or run publish-content (it updates sidebar-fragment). Site Creator pages may use a different path.`,
        });
      } else if (/\/customer\/subscriptions\b/i.test(sidebar.text)) {
        add({
          id: 'content-sidebar',
          status: 'ok',
          label: 'live Account sidebar includes /customer/subscriptions',
        });
      } else {
        add({
          id: 'content-sidebar',
          status: 'warn',
          label: 'live Account sidebar has no Subscriptions link',
          fix: `Run: npx recurbuy-eds publish-content --org=${site.org} --repo=${site.repo} --branch=${site.branch}\n`
            + '      Or add the menu row manually in da.live → customer/sidebar-fragment',
        });
      }
    }
  }

  const ok = checks.filter((c) => c.status === 'ok').map((c) => c.label);
  const warn = checks.filter((c) => c.status === 'warn').map((c) => c.label);
  const fail = checks.filter((c) => c.status === 'fail').map((c) => c.label);
  const fixes = checks
    .filter((c) => c.status !== 'ok' && c.fix)
    .map((c) => `${c.label}\n      → ${c.fix}`);

  return {
    checks,
    ok,
    warn,
    fail,
    fixes,
    exitCode: fail.length ? 1 : 0,
  };
}
