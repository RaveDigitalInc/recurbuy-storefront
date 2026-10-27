/**
 * Publish RecurBuy account content to da.live + aem.live (Variant B).
 *
 * 1. IMS token via env / cache / browser (da-auth-helper)
 * 2. PUT customer/subscriptions.html
 * 3. Ensure /customer/subscriptions row in customer/sidebar-fragment
 * 4. preview + live on admin.hlx.page
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDaToken } from './da-auth.js';
import {
  getDaSource, hlxLifecycle, publicUrls, putDaSource,
} from './da-client.js';
import { resolveDaSite } from './da-site.js';
import {
  ensureSubscriptionsSidebarItem,
  normalizeSidebarDocument,
  SUBSCRIPTIONS_PATH,
} from './sidebar-fragment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(__dirname, '..', 'templates');

const SUBSCRIPTIONS_DA_PATH = 'customer/subscriptions.html';
const SIDEBAR_DA_PATH = 'customer/sidebar-fragment.html';

/**
 * @param {string} text
 */
function asHtmlString(text) {
  if (text == null) return '';
  if (typeof text === 'string') return text;
  return JSON.stringify(text);
}

/**
 * @param {{
 *   cwd: string,
 *   dryRun?: boolean,
 *   forceLogin?: boolean,
 *   skipPublish?: boolean,
 *   skipSidebar?: boolean,
 *   org?: string,
 *   repo?: string,
 *   branch?: string,
 *   allowBrowser?: boolean,
 * }} options
 */
export async function runPublishContent(options) {
  const {
    cwd,
    dryRun = false,
    forceLogin = false,
    skipPublish = false,
    skipSidebar = false,
    allowBrowser = true,
    org,
    repo,
    branch,
  } = options;

  const report = [];
  const warnings = [];

  const site = resolveDaSite({
    cwd, org, repo, branch,
  });
  report.push(`site: ${site.org}/${site.repo} branch=${site.branch} (${site.source})`);

  const templatePath = path.join(TEMPLATES, 'content', 'subscriptions.html');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Missing package template: ${templatePath}`);
  }
  const subscriptionsHtml = fs.readFileSync(templatePath, 'utf8');

  if (dryRun) {
    report.push(`[dry-run] would PUT ${SUBSCRIPTIONS_DA_PATH}`);
    if (!skipSidebar) report.push(`[dry-run] would ensure ${SUBSCRIPTIONS_PATH} in ${SIDEBAR_DA_PATH}`);
    if (!skipPublish) {
      report.push('[dry-run] would preview+live both documents');
    }
    const urls = publicUrls({
      org: site.org,
      repo: site.repo,
      branch: site.branch,
      pathWithoutHtml: 'customer/subscriptions',
    });
    report.push(`preview: ${urls.previewUrl}`);
    report.push(`live:    ${urls.liveUrl}`);
    return { report, warnings, failed: false };
  }

  const { token, source: tokenSource } = await resolveDaToken({
    cwd,
    forceLogin,
    allowBrowser,
    log: (msg) => report.push(msg),
  });
  report.push(`auth: ${tokenSource}`);

  // --- subscriptions page ---
  try {
    const put = await putDaSource({
      token,
      org: site.org,
      repo: site.repo,
      daPath: SUBSCRIPTIONS_DA_PATH,
      content: subscriptionsHtml,
      mime: 'text/html',
    });
    report.push(`PUT ${SUBSCRIPTIONS_DA_PATH} → ${put.status}`);
  } catch (error) {
    warnings.push(`Failed to upload subscriptions page: ${error.message}`);
    if (error.status === 401) {
      warnings.push('Token rejected (401). Re-run with --login');
    }
    if (error.status === 403) {
      warnings.push('DA returned 403: this Adobe user cannot write this org/repo.');
      warnings.push('1) Confirm --org/--repo match your site in da.live.');
      warnings.push('2) Ask a DA admin to grant your Adobe email write at https://da.live/config');
      warnings.push('3) Re-auth: npx recurbuy-eds publish-content --login --org=… --repo=…');
      warnings.push('See package README → Account page + menu (publish-content).');
    }
    return { report, warnings, failed: true };
  }

  // --- sidebar fragment ---
  if (!skipSidebar) {
    try {
      const existing = await getDaSource({
        token,
        org: site.org,
        repo: site.repo,
        daPath: SIDEBAR_DA_PATH,
      });

      let baseHtml = '';
      if (existing.ok) {
        baseHtml = asHtmlString(existing.body);
        report.push(`GET ${SIDEBAR_DA_PATH} → ${existing.status}`);
      } else if (existing.status === 404) {
        warnings.push(`${SIDEBAR_DA_PATH} not found — creating a minimal fragment (Site Creator pages may differ)`);
        baseHtml = '';
      } else {
        throw new Error(`GET sidebar → ${existing.status}`);
      }

      const merged = ensureSubscriptionsSidebarItem(baseHtml);
      report.push(`sidebar: ${merged.reason}`);
      if (merged.changed) {
        const toPut = normalizeSidebarDocument(baseHtml, merged.html);
        const put = await putDaSource({
          token,
          org: site.org,
          repo: site.repo,
          daPath: SIDEBAR_DA_PATH,
          content: toPut,
          mime: 'text/html',
        });
        report.push(`PUT ${SIDEBAR_DA_PATH} → ${put.status}`);
      }
    } catch (error) {
      warnings.push(`Sidebar update failed: ${error.message}`);
      warnings.push('Subscriptions page was uploaded; add the Account menu link manually in da.live if needed');
    }
  } else {
    report.push('sidebar: skipped (--skip-sidebar)');
  }

  // --- preview + publish ---
  const pathsToPublish = ['customer/subscriptions'];
  if (!skipSidebar) pathsToPublish.push('customer/sidebar-fragment');

  if (!skipPublish) {
    for (const docPath of pathsToPublish) {
      try {
        await hlxLifecycle({
          token,
          org: site.org,
          repo: site.repo,
          branch: site.branch,
          pathWithoutHtml: docPath,
          action: 'preview',
        });
        report.push(`preview ${docPath}: ok`);
        await hlxLifecycle({
          token,
          org: site.org,
          repo: site.repo,
          branch: site.branch,
          pathWithoutHtml: docPath,
          action: 'live',
        });
        report.push(`live ${docPath}: ok`);
      } catch (error) {
        warnings.push(`${docPath} publish failed: ${error.message}`);
        if (error.status === 401 || error.status === 403) {
          warnings.push('Your IMS user may lack Edge Delivery preview/publish rights (separate from DA edit)');
        }
      }
    }
  } else {
    report.push('publish: skipped (--skip-publish); content is in DA only');
  }

  const urls = publicUrls({
    org: site.org,
    repo: site.repo,
    branch: site.branch,
    pathWithoutHtml: 'customer/subscriptions',
  });
  report.push('');
  report.push(`edit:    ${urls.editUrl}`);
  report.push(`preview: ${urls.previewUrl}`);
  report.push(`live:    ${urls.liveUrl}`);

  const failed = warnings.some((w) => /Failed to upload subscriptions/i.test(w));
  return { report, warnings, failed };
}
