/**
 * Shared Account content inventory for publish / unpublish / init / doctor.
 * List page stays separate (commerce-subscriptions); these are detail + edit scaffolds.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUBSCRIPTION_ACCOUNT_PAGES } from '../src/account/subscription-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(__dirname, '..', 'templates');

export const SUBSCRIPTIONS_LIST_DA_PATH = 'customer/subscriptions.html';
export const SUBSCRIPTIONS_LIST_DOC_PATH = 'customer/subscriptions';

/**
 * @returns {ReadonlyArray<{
 *   id: string,
 *   path: string,
 *   daPath: string,
 *   docPath: string,
 *   title: string,
 *   templateFile: string,
 * }>}
 */
export function listSubscriptionAccountContentPages() {
  return SUBSCRIPTION_ACCOUNT_PAGES.map((page) => ({
    id: page.id,
    path: page.path,
    daPath: page.daPath,
    docPath: page.path.replace(/^\//, ''),
    title: page.title,
    templateFile: path.join(
      TEMPLATES,
      'content',
      'subscriptions',
      `${page.id}.html`,
    ),
  }));
}

/**
 * All DA documents publish-content uploads (list + account scaffolds).
 * @returns {ReadonlyArray<{
 *   daPath: string,
 *   docPath: string,
 *   templateFile: string,
 *   label: string,
 * }>}
 */
export function listAllSubscriptionContentDocuments() {
  const listTemplate = path.join(TEMPLATES, 'content', 'subscriptions.html');
  const list = {
    daPath: SUBSCRIPTIONS_LIST_DA_PATH,
    docPath: SUBSCRIPTIONS_LIST_DOC_PATH,
    templateFile: listTemplate,
    label: 'My Subscriptions',
  };
  const rest = listSubscriptionAccountContentPages().map((page) => ({
    daPath: page.daPath,
    docPath: page.docPath,
    templateFile: page.templateFile,
    label: page.title,
  }));
  return [list, ...rest];
}

/**
 * @param {string} templateFile
 * @returns {string}
 */
export function readContentTemplateOrThrow(templateFile) {
  if (!fs.existsSync(templateFile)) {
    throw new Error(`Missing package template: ${templateFile}`);
  }
  return fs.readFileSync(templateFile, 'utf8');
}
