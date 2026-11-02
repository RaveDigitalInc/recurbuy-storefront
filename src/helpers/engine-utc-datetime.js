const ENGINE_UTC_DATETIME_PATTERN =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/;

/**
 * Split a hub UTC `Y-m-d H:i:s` instant into date + time fields (no store TZ math).
 *
 * @param {string|null|undefined} value
 * @returns {{ date: string, time: string }}
 */
export function splitEngineUtcDateTime(value) {
  if (value == null || String(value).trim() === '') {
    return { date: '', time: '' };
  }

  const match = ENGINE_UTC_DATETIME_PATTERN.exec(String(value).trim());
  if (match == null) {
    return { date: '', time: '' };
  }

  return { date: match[1], time: match[2] };
}

/**
 * Join date + time fields into UTC `Y-m-d H:i:s` for next-payment-date writes.
 *
 * @param {string} date
 * @param {string} time
 * @returns {string|null}
 */
export function joinEngineUtcDateTime(date, time) {
  const trimmedDate = String(date || '').trim();
  const trimmedTime = String(time || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
    return null;
  }

  const timeMatch = /^(\d{2}:\d{2})(?::(\d{2}))?$/.exec(trimmedTime);
  if (timeMatch == null) {
    return null;
  }

  const seconds = timeMatch[2] ?? '00';
  return `${trimmedDate} ${timeMatch[1]}:${seconds}`;
}

/**
 * Magento shopper calendar is date-only; SaveNextPaymentDate reformats to DATETIME.
 * RecurBuy POST still needs UTC `Y-m-d H:i:s` — use midnight like Magento date→datetime.
 *
 * @param {string} date
 * @returns {string|null}
 */
export function joinEngineUtcDateOnly(date) {
  return joinEngineUtcDateTime(date, '00:00:00');
}

/**
 * Local calendar day as `Y-m-d` for HTML date `min` (hub rejects past midnights).
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function localCalendarDateYmd(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
