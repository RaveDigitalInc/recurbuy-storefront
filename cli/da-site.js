/**
 * Resolve DA/EDS { org, repo, branch } for content publish.
 *
 * Does **not** use git origin — a boilerplate code clone often points at Adobe's
 * template repo, which is not the merchant's Document Authoring site.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} remote
 * @returns {{ org: string, repo: string } | null}
 */
export function parseGithubRemote(remote) {
  if (!remote || typeof remote !== 'string') return null;
  const cleaned = remote.trim().replace(/\.git$/i, '');

  let match = cleaned.match(/github\.com[:/]([^/]+)\/([^/]+)$/i);
  if (match) {
    return { org: match[1], repo: match[2] };
  }

  match = cleaned.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (match) {
    return { org: match[1], repo: match[2] };
  }

  return null;
}

/**
 * Best-effort parse of fstab.yaml mount URL:
 * `https://main--repo--org.aem.page` or `.aem.live`
 * @param {string} text
 * @returns {{ org: string, repo: string, branch: string } | null}
 */
export function parseFstabMount(text) {
  if (!text) return null;
  const match = text.match(
    /https?:\/\/([a-z0-9-]+)--([a-z0-9-]+)--([a-z0-9-]+)\.aem\.(?:page|live)/i,
  );
  if (!match) return null;
  return { branch: match[1], repo: match[2], org: match[3] };
}

/**
 * @param {string} cwd
 * @returns {{ org: string, repo: string, branch: string } | null}
 */
function readFstab(cwd) {
  for (const name of ['fstab.yaml', 'fstab.yml']) {
    const filePath = path.join(cwd, name);
    if (!fs.existsSync(filePath)) continue;
    try {
      return parseFstabMount(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {{
 *   cwd: string,
 *   org?: string,
 *   repo?: string,
 *   branch?: string,
 * }} options
 * @returns {{ org: string, repo: string, branch: string, source: string }}
 */
export function resolveDaSite(options) {
  const { cwd } = options;
  let org = options.org || process.env.DA_ORG || process.env.AEM_ORG || '';
  let repo = options.repo || process.env.DA_REPO || process.env.AEM_REPO || '';
  let branch = options.branch || process.env.DA_BRANCH || process.env.AEM_BRANCH || '';
  let source = 'flags/env';

  if (!org || !repo) {
    const fstab = readFstab(cwd);
    if (fstab) {
      org = org || fstab.org;
      repo = repo || fstab.repo;
      branch = branch || fstab.branch;
      source = 'fstab.yaml';
    }
  }

  if (!branch) branch = 'main';

  if (!org || !repo) {
    throw new Error(
      'Could not resolve DA org/repo. Pass --org=… --repo=… from your da.live URL '
      + '(https://da.live/#/{org}/{repo}/…), or set DA_ORG / DA_REPO, or add fstab.yaml.',
    );
  }

  return { org, repo, branch, source };
}
