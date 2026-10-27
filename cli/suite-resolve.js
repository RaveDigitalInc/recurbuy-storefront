/**
 * Resolve which patches/<suite>/ folder to use for a merchant storefront.
 *
 * Suite folders are named after the Adobe boilerplate package.json version
 * (e.g. 11.0.0). Git tags are only used by authors when cloning the theme
 * (see verify:install --ref); they are not suite folder names.
 */

import fs from 'node:fs';
import {
  DEFAULT_SUITE,
  listSuites,
  loadManifest,
} from './apply-patches.js';
import { readInstallState } from './install-state.js';
import { readText, resolvePath } from './lib.js';

/**
 * Read Adobe boilerplate version from the merchant storefront package.json.
 * Returns null when cwd is this RecurBuy package (not a storefront).
 * @param {string} cwd
 * @returns {{ name: string, version: string } | null}
 */
export function readBoilerplateIdentity(cwd) {
  const filePath = resolvePath(cwd, 'package.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    const pkg = JSON.parse(readText(filePath));
    const name = String(pkg.name || '');
    const version = String(pkg.version || '');
    if (!version) return null;
    // This package's own package.json is not a storefront theme.
    if (name === '@recurbuy/storefront-eds') return null;
    return { name, version };
  } catch {
    return null;
  }
}

/**
 * Candidate suite folder names for a semver (exact, then x.y.0, x.y, x).
 * @param {string} version
 */
export function suiteCandidatesForVersion(version) {
  const parts = String(version).split('.');
  const out = [version];
  if (parts.length >= 2) {
    out.push(`${parts[0]}.${parts[1]}.0`);
    out.push(`${parts[0]}.${parts[1]}`);
  }
  if (parts.length >= 1) out.push(parts[0]);
  return [...new Set(out)];
}

/**
 * Find a shipped suite whose manifest.match / folder name covers this boilerplate version.
 * @param {{ name?: string, version: string }} identity
 * @returns {string | null}
 */
export function suiteForBoilerplate(identity) {
  if (!identity?.version) return null;
  const suites = listSuites();
  const candidates = suiteCandidatesForVersion(identity.version);
  const name = identity.name || '';

  for (const suite of suites) {
    const manifest = loadManifest(suite);
    if (!manifest) continue;
    const match = manifest.match || {};
    const expectedName = match.packageName ? String(match.packageName) : '';
    // Skip when cwd is not the Adobe boilerplate (e.g. this RecurBuy package itself).
    if (expectedName && name && name !== expectedName) continue;

    const versions = [
      ...(Array.isArray(match.packageVersions) ? match.packageVersions : []),
      ...(match.packageVersion ? [match.packageVersion] : []),
    ].map(String);

    if (versions.some((v) => candidates.includes(v) || v === identity.version)) {
      return suite;
    }
  }

  const looksLikeBoilerplate = !name
    || name === '@adobe/aem-boilerplate-commerce'
    || name.includes('aem-boilerplate');
  if (looksLikeBoilerplate) {
    for (const candidate of candidates) {
      if (suites.includes(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * Priority:
 * 1. explicit --suite=
 * 2. detect from storefront package.json version
 * 3. .recurbuy-eds.json suite
 * 4. DEFAULT_SUITE
 *
 * @param {{
 *   cwd: string,
 *   explicitSuite?: string,
 * }} options
 * @returns {{
 *   suite: string,
 *   source: string,
 *   boilerplate: { name: string, version: string } | null,
 *   warning?: string,
 * }}
 */
export function resolveSuite(options) {
  const { cwd, explicitSuite } = options;
  const boilerplate = readBoilerplateIdentity(cwd);
  const state = readInstallState(cwd);

  if (explicitSuite) {
    return {
      suite: explicitSuite,
      source: `flag --suite=${explicitSuite}`,
      boilerplate,
    };
  }

  const detected = boilerplate ? suiteForBoilerplate(boilerplate) : null;
  if (detected) {
    const stateSuite = state?.suite || null;
    if (stateSuite && stateSuite !== detected) {
      return {
        suite: detected,
        source: `storefront package.json ${boilerplate.version}`,
        boilerplate,
        warning:
          `State had suite ${stateSuite}, but storefront looks like ${boilerplate.version} → using ${detected}.`,
      };
    }
    return {
      suite: detected,
      source: `storefront package.json ${boilerplate?.version}`,
      boilerplate,
    };
  }

  if (state?.suite) {
    return {
      suite: state.suite,
      source: `.recurbuy-eds.json (${state.suite})`,
      boilerplate,
      warning: boilerplate
        ? `No patch suite matched storefront ${boilerplate.version}; using state suite ${state.suite}.`
        : undefined,
    };
  }

  return {
    suite: DEFAULT_SUITE,
    source: `default (${DEFAULT_SUITE})`,
    boilerplate,
    warning: boilerplate
      ? `No patch suite for storefront ${boilerplate.version}; falling back to ${DEFAULT_SUITE}.`
      : undefined,
  };
}
