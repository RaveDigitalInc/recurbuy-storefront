/**
 * Merchant configurableConfigureUtils port for storefront edit-item.
 */

/**
 * @typedef {{
 *   value_index: number,
 *   label: string,
 *   swatch_type?: string,
 *   swatch_value?: string|null,
 * }} ConfigurableAttributeValue
 */

/**
 * @typedef {{
 *   attribute_id: string,
 *   attribute_code?: string,
 *   label: string,
 *   position?: number,
 *   values: ConfigurableAttributeValue[],
 * }} ConfigurableAttributeRow
 */

/**
 * @typedef {{
 *   product_id: number,
 *   sku: string,
 *   name: string,
 *   price: number,
 *   in_stock?: boolean,
 *   eligible_for_plan?: boolean,
 *   attributes?: Record<string, number|string>|Array<number|string>,
 *   configurable_item_options?: Array<{ option_id: string, option_value: number }>,
 * }} ConfigurableVariantRow
 */

/**
 * @param {string|number} attributeId
 * @returns {string}
 */
function attributeKey(attributeId) {
  return String(attributeId);
}

/**
 * @param {ConfigurableVariantRow} variant
 * @param {string} attributeId
 * @returns {number|null}
 */
export function variantAttributeValue(variant, attributeId) {
  const itemOptions = variant.configurable_item_options;
  if (Array.isArray(itemOptions)) {
    const match = itemOptions.find(
      (option) => attributeKey(option.option_id) === attributeKey(attributeId),
    );
    if (match != null && Number.isFinite(Number(match.option_value))) {
      return Number(match.option_value);
    }
  }

  const attrs = variant.attributes;
  if (attrs != null && !Array.isArray(attrs) && typeof attrs === 'object') {
    const key = attributeKey(attributeId);
    const raw = attrs[key] ?? attrs[String(Number(key))];
    if (raw != null && raw !== '') {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

/**
 * @param {ConfigurableVariantRow} variant
 * @returns {boolean}
 */
export function isConfigurableVariantSelectable(variant) {
  if (variant.in_stock === false) {
    return false;
  }
  return variant.eligible_for_plan !== false;
}

/**
 * @param {ConfigurableVariantRow[]} variants
 * @param {Map<string, number>|Record<string, number>} selectedByAttribute
 * @returns {ConfigurableVariantRow|null}
 */
export function findMatchingVariant(variants, selectedByAttribute) {
  const selected = selectedByAttribute instanceof Map
    ? selectedByAttribute
    : new Map(Object.entries(selectedByAttribute || {}).map(([k, v]) => [String(k), Number(v)]));

  if (selected.size === 0) {
    return null;
  }

  for (const variant of variants) {
    if (!isConfigurableVariantSelectable(variant)) {
      continue;
    }
    let matches = true;
    for (const [attributeId, valueIndex] of selected.entries()) {
      if (variantAttributeValue(variant, attributeId) !== valueIndex) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return variant;
    }
  }

  return null;
}

/**
 * @param {ConfigurableVariantRow[]} variants
 * @param {string} attributeId
 * @param {number} valueIndex
 * @param {Map<string, number>|Record<string, number>} selectedByAttribute
 * @returns {boolean}
 */
export function isConfigurableValueAvailable(
  variants,
  attributeId,
  valueIndex,
  selectedByAttribute,
) {
  const selected = selectedByAttribute instanceof Map
    ? selectedByAttribute
    : new Map(Object.entries(selectedByAttribute || {}).map(([k, v]) => [String(k), Number(v)]));

  return variants.some((variant) => {
    if (!isConfigurableVariantSelectable(variant)) {
      return false;
    }
    if (variantAttributeValue(variant, attributeId) !== valueIndex) {
      return false;
    }
    for (const [otherAttributeId, otherValueIndex] of selected.entries()) {
      if (otherAttributeId === attributeId) continue;
      if (variantAttributeValue(variant, otherAttributeId) !== otherValueIndex) {
        return false;
      }
    }
    return true;
  });
}

/**
 * @param {ConfigurableAttributeRow[]} attributes
 * @param {ConfigurableVariantRow[]} variants
 * @returns {Map<string, number>}
 */
export function initialConfigurableSelection(attributes, variants) {
  const selection = new Map();
  const firstVariant = variants.find((variant) => isConfigurableVariantSelectable(variant)) ?? null;
  if (!firstVariant) {
    return selection;
  }
  for (const attribute of attributes) {
    const valueIndex = variantAttributeValue(firstVariant, attribute.attribute_id);
    if (valueIndex != null) {
      selection.set(String(attribute.attribute_id), valueIndex);
    }
  }
  return selection;
}
