import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  joinEngineUtcDateOnly,
  joinEngineUtcDateTime,
  localCalendarDateYmd,
  splitEngineUtcDateTime,
} from '../src/helpers/engine-utc-datetime.js';
import { renderEditNextPaymentDateForm } from '../src/subscription-edit-next-payment-date-ui.js';

describe('engine utc datetime helpers', () => {
  it('splits hub UTC datetimes and joins Magento date-only as midnight', () => {
    assert.deepEqual(splitEngineUtcDateTime('2026-10-01 12:30:00'), {
      date: '2026-10-01',
      time: '12:30',
    });
    assert.equal(joinEngineUtcDateTime('2026-10-01', '12:30'), '2026-10-01 12:30:00');
    assert.equal(joinEngineUtcDateOnly('2026-10-01'), '2026-10-01 00:00:00');
    assert.equal(joinEngineUtcDateOnly('bad'), null);
  });

  it('formats local calendar min date', () => {
    assert.match(localCalendarDateYmd(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('subscription edit next payment date UI', () => {
  it('renders Magento-like date-only field when edit flag is on', () => {
    const html = renderEditNextPaymentDateForm({
      profile: {
        profile_id: 91,
        increment_id: 'SUB-000000091',
        actions: { is_edit_next_payment_date_available: true },
      },
      date: '2026-11-18',
      minDate: '2026-10-30',
    });

    assert.match(html, /Edit Next Payment Date/);
    assert.match(html, /SUB-000000091/);
    assert.match(html, /name="next_payment_date"/);
    assert.match(html, /value="2026-11-18"/);
    assert.match(html, /min="2026-10-30"/);
    assert.doesNotMatch(html, /name="next_payment_time"/);
    assert.doesNotMatch(html, /Time \(UTC\)/);
    assert.match(html, /#rb\/detail\/91/);
    assert.match(html, />Save</);
  });

  it('shows unavailable when edit next payment date flag is off', () => {
    const html = renderEditNextPaymentDateForm({
      profile: {
        profile_id: 3,
        actions: { is_edit_next_payment_date_available: false },
      },
      date: '2026-11-18',
    });

    assert.match(html, /not available/i);
    assert.doesNotMatch(html, /name="next_payment_date"/);
  });
});
