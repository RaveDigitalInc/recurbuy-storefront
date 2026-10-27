/**
 * Resolve an Adobe IMS token for admin.da.live / admin.hlx.page.
 *
 * Priority:
 * 1. `DA_TOKEN` env (CI / one-shot)
 * 2. Valid cache: `<cwd>/.hlx/.da-token.json` (aem-cli) then `~/.aem/da-token.json` (da-auth-helper)
 * 3. Interactive browser login via `npx github:adobe-rnd/da-auth-helper token`
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SKEW_MS = 60_000;

/**
 * @param {string} filePath
 * @returns {{ access_token: string, expires_at?: number } | null}
 */
function readTokenFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data?.access_token || typeof data.access_token !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * @param {{ access_token: string, expires_at?: number }} stored
 */
function isUsable(stored) {
  if (typeof stored.expires_at === 'number') {
    return Date.now() < stored.expires_at - SKEW_MS;
  }
  // Legacy / env paste without expiry — accept and let API return 401 if dead
  return true;
}

/**
 * @param {string} cwd
 * @returns {string[]}
 */
export function tokenCachePaths(cwd) {
  return [
    path.join(cwd, '.hlx', '.da-token.json'),
    path.join(os.homedir(), '.aem', 'da-token.json'),
  ];
}

/**
 * @param {string} cwd
 * @returns {{ token: string, source: string } | null}
 */
export function readCachedDaToken(cwd) {
  for (const filePath of tokenCachePaths(cwd)) {
    const stored = readTokenFile(filePath);
    if (stored && isUsable(stored)) {
      return { token: stored.access_token, source: filePath };
    }
  }
  return null;
}

/**
 * Opens the browser IMS flow via Adobe's da-auth-helper and caches at ~/.aem/da-token.json.
 * @param {{ log?: (msg: string) => void, timeoutMs?: number }} [options]
 * @returns {Promise<string>}
 */
export async function loginViaDaAuthHelper(options = {}) {
  const log = options.log || ((msg) => console.error(msg));
  const timeoutMs = options.timeoutMs ?? 300_000;

  log('Opening Adobe IMS login in your browser (da-auth-helper)…');
  log('Complete sign-in; the token is saved to ~/.aem/da-token.json');

  const result = spawnSync(
    'npx',
    ['-y', 'github:adobe-rnd/da-auth-helper', 'token'],
    {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      shell: process.platform === 'win32',
    },
  );

  if (result.error) {
    throw new Error(`da-auth-helper failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = `${result.stderr || ''}${result.stdout || ''}`.trim();
    throw new Error(`da-auth-helper exited ${result.status}${detail ? `\n${detail}` : ''}`);
  }

  const token = (result.stdout || '').trim().split(/\s+/).pop();
  if (!token || !token.startsWith('eyJ')) {
    throw new Error('da-auth-helper did not print a JWT access token on stdout');
  }
  return token;
}

/**
 * Clear cached tokens so the next resolve triggers browser login.
 * @param {string} cwd
 */
export function clearDaTokenCaches(cwd) {
  for (const filePath of tokenCachePaths(cwd)) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
  try {
    execFileSync('npx', ['-y', 'github:adobe-rnd/da-auth-helper', 'logout'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      shell: process.platform === 'win32',
    });
  } catch {
    // optional cleanup
  }
}

/**
 * @param {{
 *   cwd: string,
 *   forceLogin?: boolean,
 *   allowBrowser?: boolean,
 *   log?: (msg: string) => void,
 * }} options
 * @returns {Promise<{ token: string, source: string }>}
 */
export async function resolveDaToken(options) {
  const {
    cwd,
    forceLogin = false,
    allowBrowser = true,
    log = (msg) => console.error(msg),
  } = options;

  if (!forceLogin) {
    const fromEnv = process.env.DA_TOKEN?.trim();
    if (fromEnv) {
      return { token: fromEnv, source: 'env:DA_TOKEN' };
    }
    const cached = readCachedDaToken(cwd);
    if (cached) {
      log(`Using DA token from ${cached.source}`);
      return cached;
    }
  } else {
    clearDaTokenCaches(cwd);
  }

  if (!allowBrowser) {
    throw new Error(
      'No valid DA token. Set DA_TOKEN, run with a browser available, or: npx github:adobe-rnd/da-auth-helper token',
    );
  }

  const token = await loginViaDaAuthHelper({ log });
  return { token, source: 'da-auth-helper (browser)' };
}
