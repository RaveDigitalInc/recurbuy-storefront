/**
 * Remove RecurBuy account content from da.live + aem.live (inverse of publish-content).
 *
 * 1. IMS auth (same as publish-content)
 * 2. Strip Subscriptions row from customer/sidebar-fragment (keep other menu items)
 * 3. DELETE customer/subscriptions.html from DA
 * 4. DELETE live + preview for the subscriptions path; re-publish sidebar fragment
 */

import { resolveDaToken } from './da-auth.js';
import {
  deleteDaSource,
  getDaSource,
  hlxLifecycle,
  publicUrls,
  putDaSource,
} from './da-client.js';
import { resolveDaSite } from './da-site.js';
import {
  normalizeSidebarDocument,
  removeSubscriptionsSidebarItem,
} from './sidebar-fragment.js';

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
export async function runUnpublishContent(options) {
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

  if (dryRun) {
    if (!skipSidebar) report.push(`[dry-run] would remove Subscriptions from ${SIDEBAR_DA_PATH}`);
    report.push(`[dry-run] would DELETE ${SUBSCRIPTIONS_DA_PATH}`);
    if (!skipPublish) {
      report.push('[dry-run] would DELETE live+preview for customer/subscriptions');
      if (!skipSidebar) report.push('[dry-run] would preview+live sidebar-fragment');
    }
    return { report, warnings, failed: false };
  }

  const { token, source: tokenSource } = await resolveDaToken({
    cwd,
    forceLogin,
    allowBrowser,
    log: (msg) => report.push(msg),
  });
  report.push(`auth: ${tokenSource}`);

  // --- sidebar: remove menu item, keep the fragment ---
  if (!skipSidebar) {
    try {
      const existing = await getDaSource({
        token,
        org: site.org,
        repo: site.repo,
        daPath: SIDEBAR_DA_PATH,
      });
      if (!existing.ok) {
        if (existing.status === 404) {
          report.push(`sidebar: ${SIDEBAR_DA_PATH} not found — nothing to strip`);
        } else {
          throw new Error(`GET sidebar → ${existing.status}`);
        }
      } else {
        const baseHtml = asHtmlString(existing.body);
        const stripped = removeSubscriptionsSidebarItem(baseHtml);
        report.push(`sidebar: ${stripped.reason}`);
        if (stripped.changed) {
          const toPut = normalizeSidebarDocument(baseHtml, stripped.html);
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
      }
    } catch (error) {
      warnings.push(`Sidebar cleanup failed: ${error.message}`);
      warnings.push('Remove the Subscriptions menu row manually in da.live if it remains');
    }
  } else {
    report.push('sidebar: skipped (--skip-sidebar)');
  }

  // --- delete subscriptions page in DA ---
  try {
    const del = await deleteDaSource({
      token,
      org: site.org,
      repo: site.repo,
      daPath: SUBSCRIPTIONS_DA_PATH,
    });
    if (del.missing) {
      report.push(`DELETE ${SUBSCRIPTIONS_DA_PATH}: already absent`);
    } else {
      report.push(`DELETE ${SUBSCRIPTIONS_DA_PATH} → ${del.status}`);
    }
  } catch (error) {
    warnings.push(`Failed to delete subscriptions page: ${error.message}`);
    if (error.status === 403) {
      warnings.push('DA returned 403: this Adobe user cannot write this org/repo.');
      warnings.push('1) Confirm --org/--repo match your site in da.live.');
      warnings.push('2) Ask a DA admin to grant your Adobe email write at https://da.live/config');
      warnings.push('3) Re-auth: npx recurbuy-eds unpublish-content --login --org=… --repo=…');
      warnings.push('See package README → Account page + menu (publish-content).');
    }
    return { report, warnings, failed: true };
  }

  // --- edge: unpublish subscriptions; republish sidebar ---
  if (!skipPublish) {
    for (const action of ['live', 'preview']) {
      try {
        const result = await hlxLifecycle({
          token,
          org: site.org,
          repo: site.repo,
          branch: site.branch,
          pathWithoutHtml: 'customer/subscriptions',
          action,
          method: 'DELETE',
        });
        report.push(
          result.missing
            ? `${action} DELETE customer/subscriptions: already absent`
            : `${action} DELETE customer/subscriptions: ok`,
        );
      } catch (error) {
        warnings.push(`customer/subscriptions ${action} unpublish failed: ${error.message}`);
      }
    }

    if (!skipSidebar) {
      try {
        await hlxLifecycle({
          token,
          org: site.org,
          repo: site.repo,
          branch: site.branch,
          pathWithoutHtml: 'customer/sidebar-fragment',
          action: 'preview',
        });
        await hlxLifecycle({
          token,
          org: site.org,
          repo: site.repo,
          branch: site.branch,
          pathWithoutHtml: 'customer/sidebar-fragment',
          action: 'live',
        });
        report.push('preview+live customer/sidebar-fragment: ok');
      } catch (error) {
        warnings.push(`sidebar-fragment republish failed: ${error.message}`);
      }
    }
  } else {
    report.push('edge unpublish: skipped (--skip-publish); DA source deleted only');
  }

  const urls = publicUrls({
    org: site.org,
    repo: site.repo,
    branch: site.branch,
    pathWithoutHtml: 'customer/subscriptions',
  });
  report.push('');
  report.push(`Removed (or attempted) live page: ${urls.liveUrl}`);
  report.push('Next: npx recurbuy-eds uninstall [--remove-files] to roll back storefront code');

  const failed = warnings.some((w) => /Failed to delete subscriptions/i.test(w));
  return { report, warnings, failed };
}
