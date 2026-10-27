/**
 * Plan title/label helpers for storefront PDP eligibility mapping.
 */

/**
 * planOptions are flat when override-children=Yes (`{ optionId: { title } }`),
 * and nested by product id when override=No (`{ childId: { optionId: { title } } }`).
 * Parity with configurable provider `getPlanOptions(selected_product_id)`.
 *
 * @param {Record<string, unknown>|undefined} planOptions
 * @param {string} optionKey
 * @param {string|undefined} [selectedChildId]
 * @param {string|undefined} [parentProductId]
 * @returns {string|undefined}
 */
function resolvePlanTitle(planOptions, optionKey, selectedChildId, parentProductId) {
  if (!planOptions || typeof planOptions !== 'object') return undefined;

  const flatTitle = readTitle(planOptions[optionKey]);
  if (flatTitle) return flatTitle;

  const preferredIds = [selectedChildId, parentProductId].filter(Boolean);
  const preferredTitle = preferredIds
    .map((productId) => {
      const bucket = planOptions[productId];
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return undefined;
      return readTitle(/** @type {Record<string, unknown>} */ (bucket)[optionKey]);
    })
    .find(Boolean);
  if (preferredTitle) return preferredTitle;

  return Object.values(planOptions)
    .map((bucket) => {
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return undefined;
      if ('title' in bucket || 'plan_id' in bucket) return undefined;
      return readTitle(/** @type {Record<string, unknown>} */ (bucket)[optionKey]);
    })
    .find(Boolean);
}

/**
 * @param {unknown} entry
 * @returns {string|undefined}
 */
function readTitle(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
  const { title } = /** @type {{ title?: unknown }} */ (entry);
  return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}

/**
 * True for the missing-title fallback ("Plan 1"), not a merchant plan name.
 * @param {string|undefined|null} label
 * @returns {boolean}
 */
function isPlaceholderPlanLabel(label) {
  return !label || /^Plan \d+$/i.test(String(label).trim());
}

/**
 * Same period + cycle count printed in subscription details
 * ("Regular Payments / Monthly" + "12 x $22.50" → "Monthly 12").
 *
 * @param {Record<string, unknown>|undefined} details
 * @returns {string|undefined}
 */
function planLabelFromPaymentDetails(details) {
  const regular = details?.regular_payment;
  if (!regular || typeof regular !== 'object') return undefined;

  const block = /** @type {{ label?: unknown, cycles?: unknown }} */ (regular);
  const label = typeof block.label === 'string' ? block.label : '';
  const period = label.includes('/') ? label.split('/').pop()?.trim() : '';
  const cycles = Number(block.cycles);

  if (period && Number.isFinite(cycles) && cycles > 1) {
    return `${period} ${cycles}`;
  }
  return period || undefined;
}

/**
 * @param {string} optionKey
 * @param {Record<string, unknown>} opt
 * @param {import('./storefront-options-list.js').SubscriptionOptionList|null} optionList
 * @param {Record<string, unknown>|undefined} planOptions
 * @param {Record<string, unknown>} details
 * @param {string|undefined} [selectedChildId]
 * @param {string|undefined} [parentProductId]
 * @returns {string}
 */
export function resolvePlanLabel(
  optionKey,
  opt,
  optionList,
  planOptions,
  details,
  selectedChildId,
  parentProductId,
) {
  const candidates = [
    optionList?.titles?.[String(optionKey)],
    resolvePlanTitle(planOptions, optionKey, selectedChildId, parentProductId),
    typeof details?.title === 'string' ? details.title : undefined,
    typeof opt?.label === 'string' ? opt.label : undefined,
    typeof opt?.name === 'string' ? opt.name : undefined,
    planLabelFromPaymentDetails(details),
  ];

  const title = candidates.find(
    (value) => typeof value === 'string' && !isPlaceholderPlanLabel(value),
  );
  return title?.trim() || `Plan ${optionKey}`;
}
