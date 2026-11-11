/**
 * Host tokens that are safe inside the customer iframe (16px root).
 * Do not copy --type-* font shorthands or html font-size: those use rem
 * against EDS 62.5% and would shrink/enlarge iframe rem rules.
 */

export const HOST_THEME_PROPS = Object.freeze([
  '--type-base-font-family',
  '--color-brand-500',
  '--color-brand-600',
  '--color-brand-700',
  '--color-neutral-50',
  '--color-neutral-100',
  '--color-neutral-200',
  '--color-neutral-300',
  '--color-neutral-400',
  '--color-neutral-500',
  '--color-neutral-600',
  '--color-neutral-700',
  '--color-neutral-800',
  '--color-positive-500',
  '--color-positive-800',
  '--color-informational-500',
  '--color-warning-500',
  '--color-alert-500',
  '--spacing-xxsmall',
  '--spacing-xsmall',
  '--spacing-small',
  '--spacing-medium',
  '--spacing-big',
  '--shape-border-width-1',
  '--shape-border-width-2',
  '--shape-border-radius-1',
  '--shape-border-radius-2',
]);

/**
 * @returns {Record<string, string>}
 */
export function collectHostTheme() {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return {};
  }

  const computed = getComputedStyle(document.documentElement);
  /** @type {Record<string, string>} */
  const theme = {};

  HOST_THEME_PROPS.forEach((name) => {
    const value = computed.getPropertyValue(name).trim();
    if (value) theme[name] = value;
  });

  return theme;
}
