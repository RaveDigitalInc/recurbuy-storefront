/**
 * @typedef {import('../contract.js').CartSubscriptionDetails} CartSubscriptionDetails
 */

/**
 * @param {string|undefined} planLabel
 * @returns {boolean}
 */
export function isPlaceholderPlanLabel(planLabel) {
  return !planLabel || /^Plan \d+$/.test(planLabel);
}
