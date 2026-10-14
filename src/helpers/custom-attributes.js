function appendAttributeRow(list, label, value, extraClass) {
  const row = document.createElement('div');
  row.className = extraClass
    ? `custom-attrs__row ${extraClass}`
    : 'custom-attrs__row';

  const term = document.createElement('dt');
  term.className = 'custom-attrs__label';
  term.textContent = `${label}:`;

  const detail = document.createElement('dd');
  detail.className = 'custom-attrs__value';
  detail.textContent = value;

  row.append(term, detail);
  list.appendChild(row);
}

function cartAttributeValue(attr) {
  if (attr?.value) return String(attr.value);
  if (attr?.selected_options?.length) {
    return attr.selected_options.map((option) => option.label).filter(Boolean).join(', ');
  }
  return '';
}

/**
 * Renders a list of attributes into a container.
 * @param {HTMLElement} container - Render container
 * @param {Array} attributes - Array of attributes [{ label/code, value, selected_options }]
 * @param {'pdp'|'cart'} format - Data format
 * @param {Object} [options] - Additional parameters (e.g. { sku: '...' })
 */
export function renderCustomAttributes(container, attributes = [], format = 'pdp', options = {}) {
  container.className = `custom-attrs custom-attrs--${format}`;
  container.replaceChildren();

  const list = document.createElement('dl');
  list.className = 'custom-attrs__list';

  if (options.sku) {
    appendAttributeRow(list, 'SKU', String(options.sku), 'custom-attrs__row--sku');
  }

  if (Array.isArray(attributes)) {
    attributes.forEach((attr) => {
      if (format === 'pdp') {
        const label = attr?.label || attr?.code || '';
        const value = attr?.value ? String(attr.value) : '';
        if (label && value) appendAttributeRow(list, label, value);
        return;
      }

      const label = attr?.code || attr?.label || '';
      const value = cartAttributeValue(attr);
      if (label && value) appendAttributeRow(list, label, value);
    });
  }

  if (list.children.length > 0) {
    container.appendChild(list);
  } else {
    const empty = document.createElement('div');
    empty.className = 'custom-attrs__empty';
    container.appendChild(empty);
  }
}
