/**
 * Magento `Aheadworks\Sarp2\Model\Profile\Source\Status` labels for the account table.
 *
 * @param {string|null|undefined} status
 * @returns {string}
 */
export function formatProfileStatusLabel(status) {
  const code = String(status || '').toLowerCase();
  switch (code) {
    case 'pending':
      return 'Pending';
    case 'waiting':
      return 'Waiting';
    case 'active':
      return 'Active';
    case 'suspended':
      return 'Suspended';
    case 'cancelled':
    case 'canceled':
      return 'Canceled';
    case 'expired':
      return 'Expired';
    default:
      return code ? code.charAt(0).toUpperCase() + code.slice(1) : '';
  }
}

/**
 * Magento `Block\Customer\Subscription::getNextPaymentDateInfo` copy.
 *
 * @param {{
 *   status?: string|null,
 *   next_payment?: {
 *     payment_status?: string|null,
 *     payment_date?: string|null,
 *   }|null,
 * }} row
 * @returns {string}
 */
export function formatNextPaymentDateInfo(row) {
  const status = String(row?.status || '').toLowerCase();
  const next = row?.next_payment && typeof row.next_payment === 'object' ? row.next_payment : null;
  const paymentStatus = String(next?.payment_status || '').toLowerCase();
  const paymentDate = typeof next?.payment_date === 'string' ? next.payment_date.trim() : '';

  const canShowNext = canShowNextPaymentInfo(row);
  if (canShowNext) {
    if (paymentDate) {
      if (paymentStatus === 'reattempt') {
        return `Scheduled payment was failed. The next charge attempt: ${paymentDate}`;
      }
      return paymentDate;
    }
    if (paymentStatus === 'not_synchronized') {
      return 'Scheduling';
    }
    return 'Canceled';
  }

  if (status === 'active') {
    return 'All payments are done';
  }
  if (status === 'expired') {
    return 'Finished';
  }
  return 'Canceled';
}

/**
 * Magento `getNextPaymentAmountHtml` — empty when no next payment / cancelled path.
 *
 * @param {{
 *   status?: string|null,
 *   next_payment?: {
 *     payment_status?: string|null,
 *     amount?: number|string|null,
 *   }|null,
 *   currency_code?: string|null,
 * }} row
 * @param {(amount: number, currency?: string) => string} [formatMoney]
 * @returns {string}
 */
export function formatNextPaymentAmountInfo(row, formatMoney) {
  const next = row?.next_payment && typeof row.next_payment === 'object' ? row.next_payment : null;
  if (!canShowNextPaymentInfo(row)) {
    return '';
  }
  const paymentStatus = String(next?.payment_status || '').toLowerCase();
  if (paymentStatus === 'no_payment') {
    return '';
  }
  const amount = Number(next?.amount);
  if (!Number.isFinite(amount)) {
    return '';
  }
  if (typeof formatMoney === 'function') {
    return formatMoney(amount, row?.currency_code || undefined);
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: row?.currency_code || 'USD',
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

/**
 * Magento `canShowNextPaymentInfo` — hide for cancelled/expired / last-period-holder membership.
 *
 * @param {{
 *   status?: string|null,
 *   next_payment?: {
 *     payment_status?: string|null,
 *     is_membership_next_payment?: boolean,
 *   }|null,
 * }} row
 * @returns {boolean}
 */
function canShowNextPaymentInfo(row) {
  const status = String(row?.status || '').toLowerCase();
  if (status === 'cancelled' || status === 'canceled' || status === 'expired') {
    return false;
  }
  const next = row?.next_payment && typeof row.next_payment === 'object' ? row.next_payment : null;
  const paymentStatus = String(next?.payment_status || '').toLowerCase();
  if (paymentStatus === 'last_period_holder') {
    return false;
  }
  return true;
}
