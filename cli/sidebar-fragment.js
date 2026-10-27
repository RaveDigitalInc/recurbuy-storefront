/**
 * Helpers to add a RecurBuy "Subscriptions" item to /customer/sidebar-fragment.
 *
 * Adobe commerce-account-sidebar reads nested <ol><li> rows:
 *   title
 *   <ol><li>subtitle</li><li>/path</li><li>IconName</li></ol>
 */

export const SUBSCRIPTIONS_PATH = '/customer/subscriptions';

export const SUBSCRIPTIONS_SIDEBAR_ITEM_HTML = `<li>
      <p>Subscriptions</p>
      <ol>
        <li>Manage your subscriptions</li>
        <li>${SUBSCRIPTIONS_PATH}</li>
        <li>PendingPayment</li>
      </ol>
    </li>`;

/**
 * @param {string} html
 */
export function sidebarHasSubscriptionsLink(html) {
  if (!html) return false;
  return /\/customer\/subscriptions\b/i.test(html);
}

/**
 * Insert the subscriptions menu item before the closing tag of the outer <ol>.
 * If no outer ol is found, append a minimal fragment wrapper.
 * @param {string} html
 * @returns {{ html: string, changed: boolean, reason: string }}
 */
export function ensureSubscriptionsSidebarItem(html) {
  if (sidebarHasSubscriptionsLink(html)) {
    return { html, changed: false, reason: 'Subscriptions link already present' };
  }

  const source = (html || '').trim();
  if (!source) {
    const wrapped = `<div>
  <ol>
    ${SUBSCRIPTIONS_SIDEBAR_ITEM_HTML}
  </ol>
</div>
`;
    return { html: wrapped, changed: true, reason: 'Created new sidebar-fragment with Subscriptions' };
  }

  // Insert before the OUTER list's closing </ol> (not the last nested </ol>).
  const closeOl = findOuterListCloseIndex(source);
  if (closeOl === -1) {
    const wrapped = `${source}\n<div>\n  <ol>\n    ${SUBSCRIPTIONS_SIDEBAR_ITEM_HTML}\n  </ol>\n</div>\n`;
    return { html: wrapped, changed: true, reason: 'Appended ol wrapper with Subscriptions (no outer </ol> found)' };
  }

  const next = `${source.slice(0, closeOl)}    ${SUBSCRIPTIONS_SIDEBAR_ITEM_HTML}\n${source.slice(closeOl)}`;
  return { html: next, changed: true, reason: 'Inserted Subscriptions before outer </ol>' };
}

/**
 * Index of the `</ol>` that closes the first top-level `<ol>`, or -1.
 * @param {string} html
 */
function findOuterListCloseIndex(html) {
  const openRe = /<ol\b[^>]*>/gi;
  const closeRe = /<\/ol>/gi;
  const firstOpen = openRe.exec(html);
  if (!firstOpen) return -1;

  let depth = 1;
  let pos = firstOpen.index + firstOpen[0].length;
  while (depth > 0 && pos < html.length) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) return -1;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      if (depth === 0) return nextClose.index;
      pos = nextClose.index + nextClose[0].length;
    }
  }
  return -1;
}

/**
 * Remove top-level sidebar <li> blocks that contain /customer/subscriptions
 * (depth-aware — nested lists must not glue Orders + Subscriptions into one match).
 * @param {string} html
 * @returns {{ html: string, changed: boolean, reason: string }}
 */
export function removeSubscriptionsSidebarItem(html) {
  const source = html || '';
  if (!sidebarHasSubscriptionsLink(source)) {
    return { html: source, changed: false, reason: 'Subscriptions link not present' };
  }

  const ranges = findTopLevelLiRanges(source);
  const toRemove = ranges.filter((range) => (
    /\/customer\/subscriptions\b/i.test(source.slice(range.start, range.end))
  ));

  if (!toRemove.length) {
    return {
      html: source,
      changed: false,
      reason: 'Subscriptions path found but could not safely remove the <li> — edit sidebar-fragment in da.live',
    };
  }

  let next = source;
  // Remove from the end so earlier offsets stay valid
  for (const range of [...toRemove].reverse()) {
    next = `${next.slice(0, range.start)}${next.slice(range.end)}`;
  }

  const cleaned = next.replace(/\n{3,}/g, '\n\n');
  return {
    html: cleaned,
    changed: true,
    reason: `Removed ${toRemove.length} Subscriptions sidebar item(s)`,
  };
}

/**
 * Byte ranges of each top-level <li>…</li> inside the first outer <ol>.
 * @param {string} html
 * @returns {{ start: number, end: number }[]}
 */
function findTopLevelLiRanges(html) {
  const openOl = /<ol\b[^>]*>/i.exec(html);
  if (!openOl) return [];

  const ranges = [];
  let i = openOl.index + openOl[0].length;
  let olDepth = 1;
  let liDepth = 0;
  let liStart = -1;

  while (i < html.length && olDepth > 0) {
    const slice = html.slice(i);
    const openLi = slice.match(/^<li\b[^>]*>/i);
    const closeLi = slice.match(/^<\/li>/i);
    const openNestedOl = slice.match(/^<ol\b[^>]*>/i);
    const closeOl = slice.match(/^<\/ol>/i);

    if (openLi) {
      if (olDepth === 1 && liDepth === 0) liStart = i;
      liDepth += 1;
      i += openLi[0].length;
      continue;
    }
    if (closeLi) {
      liDepth -= 1;
      i += closeLi[0].length;
      if (olDepth === 1 && liDepth === 0 && liStart >= 0) {
        ranges.push({ start: liStart, end: i });
        liStart = -1;
      }
      continue;
    }
    if (openNestedOl) {
      olDepth += 1;
      i += openNestedOl[0].length;
      continue;
    }
    if (closeOl) {
      olDepth -= 1;
      i += closeOl[0].length;
      continue;
    }
    i += 1;
  }

  return ranges;
}

/**
 * If DA returns a full document, keep head/body; if fragment-only, wrap for PUT.
 * We PUT whatever shape GET returned when possible.
 * @param {string} existingHtml
 * @param {string} mergedInnerOrFull
 */
export function normalizeSidebarDocument(existingHtml, mergedInnerOrFull) {
  const existing = (existingHtml || '').trim();
  const merged = mergedInnerOrFull;

  if (/<html[\s>]/i.test(existing) || /<body[\s>]/i.test(existing)) {
    // Full document: replace body inner if we only mutated the list region already in merged
    return merged.includes('<html') ? merged : existing.replace(
      /<body[^>]*>[\s\S]*<\/body>/i,
      `<body>\n${merged}\n</body>`,
    );
  }

  // Fragment-only sources are valid in DA for sidebar-fragment
  if (/<html[\s>]/i.test(merged)) return merged;
  return merged;
}
