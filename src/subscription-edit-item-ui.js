import { escapeHtml } from './helpers/dom-html.js';
import { subscriptionAccountHref } from './account/subscription-routes.js';
import {
  findMatchingVariant,
  initialConfigurableSelection,
  isConfigurableValueAvailable,
  isConfigurableVariantSelectable,
} from './utils/configurable-configure-utils.js';
import { readInitialConfigurableOptions } from './utils/profile-item-buy-request.js';

export const EDIT_ITEM_LABELS = {
  title: 'Edit Product',
  back: 'Back to Subscription',
  qty: 'Qty',
  update: 'Update Subscription',
  cancel: 'Cancel',
  loading: 'Loading product…',
  error: 'Unable to load product editor.',
  unavailable: 'Editing this product is not available for this subscription.',
  missingProfile: 'Missing profile or item. Open a product from the subscription.',
  configureRequired: 'Please complete product options.',
  configurableRequired: 'Please select all required options.',
  configurableOutOfStock: 'The selected combination is out of stock.',
  bundleRequired: 'Please select required bundle options.',
  groupedQtyRequired: 'Please enter a quantity for at least one product.',
  oneTimeTitle: 'How would you like to apply the changes?',
  permanently: 'Permanently',
  oneTimeOnly: 'For the next order only',
  modalCancel: 'Cancel',
  selection: 'Selected',
};

/**
 * @param {Partial<typeof EDIT_ITEM_LABELS>} [labels]
 * @returns {string}
 */
export function renderEditItemSkeleton(labels = {}) {
  const copy = { ...EDIT_ITEM_LABELS, ...labels };
  return `<div class="recurbuy-edit-item__skeleton message info"><span>${escapeHtml(copy.loading)}</span></div>`;
}

/**
 * @param {object} item
 * @param {Record<string, any>} actions
 * @returns {boolean}
 */
export function isEditItemAvailable(item, actions) {
  const itemId = Number(item?.item_id ?? item?.id);
  const rows = Array.isArray(actions?.items) ? actions.items : [];
  const flags = rows.find((row) => Number(row.item_id) === itemId);
  return Boolean(flags?.is_edit_item_available);
}

/**
 * @param {{
 *   profile: object,
 *   item: object,
 *   configure: object|null,
 *   qty: number|string,
 *   selection: {
 *     configurable?: Record<string, number>,
 *     bundleSelection?: Record<string, number>,
 *     bundleQty?: Record<string, number>,
 *     groupedQty?: Record<string, number>,
 *   },
 *   submitting?: boolean,
 *   error?: string|null,
 *   showOneTimeModal?: boolean,
 *   canOneTimeEdit?: boolean,
 *   labels?: Partial<typeof EDIT_ITEM_LABELS>,
 *   rootLink?: (path: string) => string,
 * }} input
 * @returns {string}
 */
export function renderEditItemForm(input) {
  const labels = { ...EDIT_ITEM_LABELS, ...(input.labels || {}) };
  const profile = input.profile && typeof input.profile === 'object' ? input.profile : {};
  const item = input.item && typeof input.item === 'object' ? input.item : {};
  const profileId = Number(profile.profile_id);
  const itemId = Number(item.item_id ?? item.id);
  const backHref = subscriptionAccountHref('detail', {
    profileId,
    rootLink: input.rootLink,
  });
  const actions = profile.actions && typeof profile.actions === 'object' ? profile.actions : {};
  const canEdit = isEditItemAvailable(item, actions);
  const submitting = Boolean(input.submitting);
  const qty = Number(input.qty) > 0 ? Number(input.qty) : 1;
  const { name, sku } = resolveProductHeading(item, input.configure);
  const errorHtml = input.error
    ? `<div class="message error"><span>${escapeHtml(input.error)}</span></div>`
    : '';

  if (!canEdit) {
    return `
<nav class="recurbuy-edit-item__nav">
  <a class="action back" href="${escapeHtml(backHref)}">${escapeHtml(labels.back)}</a>
</nav>
<div class="message info"><span>${escapeHtml(labels.unavailable)}</span></div>`;
  }

  const optionsHtml = renderConfigureOptions({
    configure: input.configure,
    selection: input.selection || {},
    labels,
  });

  const modalHtml = input.showOneTimeModal && input.canOneTimeEdit
    ? renderOneTimeModal(labels)
    : '';

  return `
<nav class="recurbuy-edit-item__nav">
  <a class="action back" href="${escapeHtml(backHref)}">${escapeHtml(labels.back)}</a>
</nav>
<header class="recurbuy-edit-item__header">
  <h1 class="recurbuy-edit-item__title">${escapeHtml(labels.title)}</h1>
  <p class="recurbuy-edit-item__meta">
    <span class="recurbuy-edit-item__product-name">${escapeHtml(name)}</span>
    ${sku ? `<span class="recurbuy-edit-item__product-sku">${escapeHtml(sku)}</span>` : ''}
  </p>
</header>
${errorHtml}
<form class="recurbuy-edit-item__form" data-recurbuy-edit-item-form="${itemId}" novalidate>
  <input type="hidden" name="item_id" value="${itemId}" />
  <input type="hidden" name="product_id" value="${Number(item.product_id) || 0}" />
  ${optionsHtml}
  <div class="recurbuy-edit-item__row">
    <label class="recurbuy-edit-item__row-label" for="recurbuy-edit-item-qty">${escapeHtml(labels.qty)}</label>
    <input
      type="number"
      name="qty"
      id="recurbuy-edit-item-qty"
      class="recurbuy-edit-item__qty"
      min="1"
      step="1"
      value="${qty}"
      ${submitting ? 'disabled' : ''}
    />
  </div>
  <div class="recurbuy-edit-item__actions">
    <button type="submit" class="button primary" ${submitting ? 'disabled' : ''}>
      ${escapeHtml(labels.update)}
    </button>
    <a class="button secondary" href="${escapeHtml(backHref)}">${escapeHtml(labels.cancel)}</a>
  </div>
</form>
${modalHtml}`;
}

/**
 * Prefer parent catalog name from configure; avoid duplicated "(sku) (sku)".
 *
 * @param {object} item
 * @param {object|null|undefined} configure
 * @returns {{ name: string, sku: string }}
 */
export function resolveProductHeading(item, configure) {
  const sku = typeof item?.sku === 'string' && item.sku.trim() !== '' ? item.sku.trim() : '';
  const parentName = typeof configure?.name === 'string' ? configure.name.trim() : '';
  if (parentName !== '') {
    return { name: parentName, sku };
  }

  let name = typeof item?.name === 'string' ? item.name.trim() : '';
  if (sku !== '' && name.endsWith(` (${sku})`)) {
    name = name.slice(0, -(sku.length + 3)).trim();
  }
  if (name === '') {
    name = `Product #${item?.product_id || ''}`;
  }
  return { name, sku };
}

/**
 * @param {{
 *   configure: object|null,
 *   selection: object,
 *   labels: typeof EDIT_ITEM_LABELS,
 * }} input
 * @returns {string}
 */
function renderConfigureOptions(input) {
  const configure = input.configure;
  if (!configure || typeof configure !== 'object') {
    return '';
  }

  const typeId = String(configure.type_id || '').toLowerCase();
  if (typeId === 'configurable') {
    return renderConfigurableOptions(configure, input.selection, input.labels);
  }
  if (typeId === 'bundle') {
    return renderBundleOptions(configure, input.selection, input.labels);
  }
  if (typeId === 'grouped') {
    return renderGroupedOptions(configure, input.selection, input.labels);
  }
  return '';
}

/**
 * @param {object} configure
 * @param {object} selection
 * @param {typeof EDIT_ITEM_LABELS} labels
 * @returns {string}
 */
function renderConfigurableOptions(configure, selection, labels) {
  const attributes = Array.isArray(configure.attributes) ? configure.attributes : [];
  const variants = Array.isArray(configure.variants) ? configure.variants : [];
  const selected = selection.configurable && typeof selection.configurable === 'object'
    ? selection.configurable
    : {};
  const selectedMap = new Map(
    Object.entries(selected).map(([k, v]) => [String(k), Number(v)]),
  );
  const matched = findMatchingVariant(variants, selectedMap);

  const attrsHtml = attributes.map((attribute) => {
    const attributeId = String(attribute.attribute_id);
    const values = Array.isArray(attribute.values) ? attribute.values : [];
    const current = selectedMap.has(attributeId) ? selectedMap.get(attributeId) : null;
    const options = values.map((value) => {
      const valueIndex = Number(value.value_index);
      const available = isConfigurableValueAvailable(
        variants,
        attributeId,
        valueIndex,
        selectedMap,
      );
      const selectedValue = current === valueIndex;
      const label = String(value.label || valueIndex);
      const presentation = resolveSwatchPresentation(value);
      const classes = [
        'recurbuy-edit-item__swatch',
        `recurbuy-edit-item__swatch--${presentation.type}`,
        selectedValue ? 'is-selected' : '',
        available ? '' : 'is-disabled',
      ].filter(Boolean).join(' ');
      const style = presentation.type === 'color' && presentation.value
        ? ` style="--rb-swatch:${escapeHtml(presentation.value)}"`
        : '';
      return `
<button
  type="button"
  class="${classes}"
  data-recurbuy-configurable-attribute="${escapeHtml(attributeId)}"
  data-value-index="${valueIndex}"
  aria-pressed="${selectedValue ? 'true' : 'false'}"
  ${available ? '' : 'disabled'}
  title="${escapeHtml(label)}"
  ${style}
>
  <span class="recurbuy-edit-item__swatch-label">${escapeHtml(label)}</span>
</button>`;
    }).join('');

    return `
<div class="recurbuy-edit-item__attribute" data-attribute-id="${escapeHtml(attributeId)}">
  <div class="recurbuy-edit-item__row-label">${escapeHtml(String(attribute.label || attributeId))}</div>
  <div class="recurbuy-edit-item__swatches" role="group" aria-label="${escapeHtml(String(attribute.label || attributeId))}">
    ${options}
  </div>
</div>`;
  }).join('');

  const summary = matched
    ? `<p class="recurbuy-edit-item__selection">${escapeHtml(labels.selection)}: ${escapeHtml(formatSelectedVariant(matched))}</p>`
    : '';

  return `<div class="recurbuy-edit-item__configure" data-type="configurable">${attrsHtml}${summary}</div>`;
}

/**
 * Prefer color chip / text. Skip catalog image paths — they often 404 on storefront.
 *
 * @param {{ swatch_type?: string, swatch_value?: string|null, label?: string|number }} value
 * @returns {{ type: 'color'|'text', value: string }}
 */
export function resolveSwatchPresentation(value) {
  const rawType = String(value?.swatch_type || 'text').toLowerCase();
  const rawValue = typeof value?.swatch_value === 'string' ? value.swatch_value.trim() : '';
  const label = String(value?.label || '');

  if (rawType === 'color' && rawValue !== '' && !rawValue.includes('/') && !rawValue.includes('placeholder')) {
    return { type: 'color', value: rawValue };
  }

  if (looksLikeColorLabel(label)) {
    return { type: 'color', value: guessColorHex(label) };
  }

  return { type: 'text', value: '' };
}

/**
 * @param {string} label
 * @returns {boolean}
 */
function looksLikeColorLabel(label) {
  return /black|white|red|blue|green|yellow|orange|purple|gray|grey|brown|pink|navy|beige/i
    .test(label);
}

/**
 * @param {string} label
 * @returns {string}
 */
function guessColorHex(label) {
  const normalized = label.toLowerCase();
  const map = {
    black: '#111111',
    white: '#ffffff',
    red: '#c0392b',
    blue: '#2980b9',
    green: '#27ae60',
    yellow: '#f1c40f',
    orange: '#e67e22',
    purple: '#8e44ad',
    gray: '#95a5a6',
    grey: '#95a5a6',
    brown: '#795548',
    pink: '#fd79a8',
    navy: '#1b2a4a',
    beige: '#d7ccc8',
  };
  for (const [name, hex] of Object.entries(map)) {
    if (normalized.includes(name)) {
      return hex;
    }
  }
  return '#cccccc';
}

/**
 * @param {{ name?: string, sku?: string }} matched
 * @returns {string}
 */
export function formatSelectedVariant(matched) {
  const name = typeof matched?.name === 'string' ? matched.name.trim() : '';
  const sku = typeof matched?.sku === 'string' ? matched.sku.trim() : '';
  if (name && sku && name !== sku && !name.includes(sku)) {
    return `${name} (${sku})`;
  }
  return name || sku || '';
}

/**
 * @param {object} configure
 * @param {object} selection
 * @param {typeof EDIT_ITEM_LABELS} labels
 * @returns {string}
 */
function renderBundleOptions(configure, selection, labels) {
  const options = Array.isArray(configure.bundle_options) ? configure.bundle_options : [];
  const selected = selection.bundleSelection && typeof selection.bundleSelection === 'object'
    ? selection.bundleSelection
    : {};
  const qtyByOption = selection.bundleQty && typeof selection.bundleQty === 'object'
    ? selection.bundleQty
    : {};

  const html = options.map((option) => {
    const optionId = Number(option.option_id);
    const selections = Array.isArray(option.selections) ? option.selections : [];
    const current = Number(selected[String(optionId)]);
    const requiredMark = option.required ? ' *' : '';
    const radios = selections.map((row) => {
      const selectionId = Number(row.selection_id);
      const id = `recurbuy-bundle-${optionId}-${selectionId}`;
      const checked = current === selectionId ? ' checked' : '';
      return `
<label class="recurbuy-edit-item__choice${checked ? ' is-selected' : ''}" for="${escapeHtml(id)}">
  <input
    type="radio"
    name="bundle_option[${optionId}]"
    id="${escapeHtml(id)}"
    value="${selectionId}"
    data-recurbuy-bundle-option="${optionId}"
    ${checked}
  />
  <span>${escapeHtml(String(row.name || row.sku || selectionId))}</span>
</label>`;
    }).join('');

    const canChangeQty = selections.some((row) => row.can_change_quantity);
    const qtyValue = Number(qtyByOption[String(optionId)]) > 0
      ? Number(qtyByOption[String(optionId)])
      : 1;
    const qtyField = canChangeQty
      ? `
<div class="recurbuy-edit-item__row">
  <label class="recurbuy-edit-item__row-label" for="recurbuy-bundle-qty-${optionId}">${escapeHtml(labels.qty)}</label>
  <input
    type="number"
    id="recurbuy-bundle-qty-${optionId}"
    name="bundle_option_qty[${optionId}]"
    data-recurbuy-bundle-qty="${optionId}"
    class="recurbuy-edit-item__qty"
    min="1"
    value="${qtyValue}"
  />
</div>`
      : '';

    return `
<div class="recurbuy-edit-item__bundle-option" data-option-id="${optionId}">
  <div class="recurbuy-edit-item__row-label">${escapeHtml(String(option.title || optionId))}${requiredMark}</div>
  <div class="recurbuy-edit-item__choices">${radios}</div>
  ${qtyField}
</div>`;
  }).join('');

  return `<div class="recurbuy-edit-item__configure" data-type="bundle">${html}</div>`;
}

/**
 * @param {object} configure
 * @param {object} selection
 * @param {typeof EDIT_ITEM_LABELS} labels
 * @returns {string}
 */
function renderGroupedOptions(configure, selection, labels) {
  const rows = Array.isArray(configure.grouped_associated) ? configure.grouped_associated : [];
  const qtyByProduct = selection.groupedQty && typeof selection.groupedQty === 'object'
    ? selection.groupedQty
    : {};

  const html = rows.map((row) => {
    const productId = Number(row.product_id);
    const qty = qtyByProduct[String(productId)] != null
      ? Number(qtyByProduct[String(productId)])
      : Number(row.default_qty) || 0;
    return `
<div class="recurbuy-edit-item__grouped-row" data-product-id="${productId}">
  <label class="recurbuy-edit-item__row-label" for="recurbuy-grouped-qty-${productId}">
    ${escapeHtml(String(row.name || row.sku || productId))}
  </label>
  <input
    type="number"
    id="recurbuy-grouped-qty-${productId}"
    name="super_group[${productId}]"
    data-recurbuy-grouped-qty="${productId}"
    class="recurbuy-edit-item__qty"
    min="0"
    value="${Number.isFinite(qty) ? qty : 0}"
  />
</div>`;
  }).join('');

  return `<div class="recurbuy-edit-item__configure" data-type="grouped">${html}</div>`;
}

/**
 * @param {typeof EDIT_ITEM_LABELS} labels
 * @returns {string}
 */
function renderOneTimeModal(labels) {
  return `
<div class="recurbuy-edit-item__modal" role="dialog" aria-modal="true" aria-labelledby="recurbuy-edit-item-modal-title">
  <div class="recurbuy-edit-item__modal-backdrop" data-recurbuy-one-time="cancel"></div>
  <div class="recurbuy-edit-item__modal-panel">
    <h2 id="recurbuy-edit-item-modal-title">${escapeHtml(labels.oneTimeTitle)}</h2>
    <div class="recurbuy-edit-item__modal-actions">
      <button type="button" class="button primary" data-recurbuy-one-time="0">
        <span>${escapeHtml(labels.permanently)}</span>
      </button>
      <button type="button" class="button secondary" data-recurbuy-one-time="1">
        <span>${escapeHtml(labels.oneTimeOnly)}</span>
      </button>
      <button type="button" class="button secondary" data-recurbuy-one-time="cancel">
        <span>${escapeHtml(labels.modalCancel)}</span>
      </button>
    </div>
  </div>
</div>`;
}

/**
 * Build default selection maps from configure schema + stored item options.
 *
 * @param {object|null} configure
 * @param {object} item
 * @returns {{
 *   configurable: Record<string, number>,
 *   bundleSelection: Record<string, number>,
 *   bundleQty: Record<string, number>,
 *   groupedQty: Record<string, number>,
 * }}
 */
export function buildInitialSelection(configure, item) {
  /** @type {Record<string, number>} */
  const configurable = {};
  /** @type {Record<string, number>} */
  const bundleSelection = {};
  /** @type {Record<string, number>} */
  const bundleQty = {};
  /** @type {Record<string, number>} */
  const groupedQty = {};

  if (!configure || typeof configure !== 'object') {
    return {
      configurable, bundleSelection, bundleQty, groupedQty,
    };
  }

  const typeId = String(configure.type_id || '').toLowerCase();

  if (typeId === 'configurable') {
    const attributes = Array.isArray(configure.attributes) ? configure.attributes : [];
    const variants = Array.isArray(configure.variants) ? configure.variants : [];
    const fromItem = readInitialConfigurableOptions(item?.product_options);
    if (fromItem != null && fromItem.length > 0) {
      for (const row of fromItem) {
        configurable[String(row.option_id)] = Number(row.option_value);
      }
    } else {
      const initial = initialConfigurableSelection(attributes, variants);
      for (const [key, value] of initial.entries()) {
        configurable[key] = value;
      }
    }
  }

  if (typeId === 'bundle') {
    const options = Array.isArray(configure.bundle_options) ? configure.bundle_options : [];
    const info = item?.product_options?.info_buyRequest;
    const storedBundle = info && typeof info === 'object' ? info.bundle_option : null;
    const storedQty = info && typeof info === 'object' ? info.bundle_option_qty : null;
    for (const option of options) {
      const optionId = String(option.option_id);
      const selections = Array.isArray(option.selections) ? option.selections : [];
      let selectionId = null;
      if (storedBundle && typeof storedBundle === 'object') {
        const raw = storedBundle[optionId] ?? storedBundle[Number(optionId)];
        if (Array.isArray(raw) && raw.length > 0) {
          selectionId = Number(raw[0]);
        } else if (raw != null) {
          selectionId = Number(raw);
        }
      }
      if (!Number.isFinite(selectionId) || selectionId <= 0) {
        const defaultRow = selections.find((row) => row.is_default) ?? selections[0];
        selectionId = defaultRow ? Number(defaultRow.selection_id) : null;
      }
      if (Number.isFinite(selectionId) && selectionId > 0) {
        bundleSelection[optionId] = selectionId;
      }
      let qty = 1;
      if (storedQty && typeof storedQty === 'object') {
        const rawQty = Number(storedQty[optionId] ?? storedQty[Number(optionId)]);
        if (Number.isFinite(rawQty) && rawQty > 0) {
          qty = rawQty;
        }
      }
      bundleQty[optionId] = qty;
    }
  }

  if (typeId === 'grouped') {
    const rows = Array.isArray(configure.grouped_associated) ? configure.grouped_associated : [];
    const info = item?.product_options?.info_buyRequest;
    const storedGroup = info && typeof info === 'object' ? info.super_group : null;
    for (const row of rows) {
      const productId = String(row.product_id);
      let qty = Number(row.default_qty) || 0;
      if (storedGroup && typeof storedGroup === 'object') {
        const raw = Number(storedGroup[productId] ?? storedGroup[Number(productId)]);
        if (Number.isFinite(raw) && raw >= 0) {
          qty = raw;
        }
      }
      groupedQty[productId] = qty;
    }
  }

  return {
    configurable, bundleSelection, bundleQty, groupedQty,
  };
}

/**
 * Collect configure result from current selection for buy_request.
 *
 * @param {object|null} configure
 * @param {object} selection
 * @param {typeof EDIT_ITEM_LABELS} labels
 * @returns {{ ok: true, result: object }|{ ok: false, error: string }}
 */
export function collectConfigureResult(configure, selection, labels = EDIT_ITEM_LABELS) {
  if (!configure || typeof configure !== 'object') {
    return { ok: true, result: null };
  }

  const typeId = String(configure.type_id || '').toLowerCase();
  const productId = Number(configure.product_id) > 0 ? Number(configure.product_id) : undefined;

  if (typeId === 'simple' || typeId === 'virtual' || typeId === '') {
    return { ok: true, result: productId ? { product_id: productId, product_options: {} } : null };
  }

  if (typeId === 'configurable') {
    const attributes = Array.isArray(configure.attributes) ? configure.attributes : [];
    const variants = Array.isArray(configure.variants) ? configure.variants : [];
    const selectedMap = new Map(
      Object.entries(selection.configurable || {}).map(([k, v]) => [String(k), Number(v)]),
    );
    if (selectedMap.size < attributes.length) {
      return { ok: false, error: labels.configurableRequired };
    }
    const matched = findMatchingVariant(variants, selectedMap);
    if (!matched || !isConfigurableVariantSelectable(matched)) {
      return { ok: false, error: labels.configurableRequired };
    }
    if (matched.in_stock === false) {
      return { ok: false, error: labels.configurableOutOfStock };
    }
    return {
      ok: true,
      result: {
        product_id: productId,
        selected_product_id: matched.product_id,
        selected_sku: matched.sku,
        selected_name: matched.name,
        product_options: {
          configurable_item_options: matched.configurable_item_options ?? [],
        },
      },
    };
  }

  if (typeId === 'bundle') {
    const options = Array.isArray(configure.bundle_options) ? configure.bundle_options : [];
    /** @type {Array<{ option_id: number, option_qty: number, option_selections: number[] }>} */
    const bundleOptions = [];
    for (const option of options) {
      const optionId = Number(option.option_id);
      const selectionId = Number(selection.bundleSelection?.[String(optionId)]);
      if (!Number.isFinite(selectionId) || selectionId <= 0) {
        if (option.required) {
          return { ok: false, error: labels.bundleRequired };
        }
        continue;
      }
      bundleOptions.push({
        option_id: optionId,
        option_qty: Number(selection.bundleQty?.[String(optionId)]) || 1,
        option_selections: [selectionId],
      });
    }
    return {
      ok: true,
      result: {
        product_id: productId,
        product_options: { bundle_options: bundleOptions },
      },
    };
  }

  if (typeId === 'grouped') {
    const rows = Array.isArray(configure.grouped_associated) ? configure.grouped_associated : [];
    /** @type {Array<{ id: number, qty: number, unit_price: number }>} */
    const groupedOptions = [];
    for (const row of rows) {
      const qty = Number(selection.groupedQty?.[String(row.product_id)]) || 0;
      if (qty > 0) {
        groupedOptions.push({
          id: Number(row.product_id),
          qty,
          unit_price: Number(row.price) || 0,
        });
      }
    }
    if (groupedOptions.length === 0) {
      return { ok: false, error: labels.groupedQtyRequired };
    }
    return {
      ok: true,
      result: {
        product_id: productId,
        product_options: { grouped_options: groupedOptions },
      },
    };
  }

  return { ok: true, result: null };
}
