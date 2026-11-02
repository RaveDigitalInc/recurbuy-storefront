import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderEditPlanForm } from '../src/subscription-edit-plan-ui.js';

describe('subscription edit plan UI', () => {
  it('renders selectable plans and posts via form new_plan_id', () => {
    const html = renderEditPlanForm({
      profile: {
        profile_id: 91,
        increment_id: 'SUB-000000091',
        plan_name: 'Monthly 12 (50%)',
        items: [
          { item_id: 1, name: 'Configurable-black-L', parent_item_id: null },
          { item_id: 2, name: 'child', parent_item_id: 1 },
        ],
        actions: { is_edit_plan_available: true },
      },
      plans: [
        { id: 7, name: 'Weekly' },
        { id: 9, name: 'Annual' },
      ],
      selectedPlanId: 7,
    });

    assert.match(html, /Change Subscription Plan/);
    assert.match(html, /SUB-000000091/);
    assert.match(html, /Monthly 12 \(50%\)/);
    assert.match(html, /Configurable-black-L/);
    assert.doesNotMatch(html, />child</);
    assert.match(html, /name="new_plan_id"/);
    assert.match(html, /value="7"/);
    assert.match(html, /value="9"/);
    assert.match(html, /#rb\/detail\/91/);
    assert.match(html, /Save Subscription/);
  });

  it('shows unavailable when edit plan flag is off', () => {
    const html = renderEditPlanForm({
      profile: {
        profile_id: 3,
        plan_name: 'Monthly',
        actions: { is_edit_plan_available: false },
      },
      plans: [{ id: 2, name: 'Weekly' }],
    });

    assert.match(html, /not available/i);
    assert.doesNotMatch(html, /name="new_plan_id"/);
  });

  it('shows empty state when no alternate plans exist', () => {
    const html = renderEditPlanForm({
      profile: {
        profile_id: 3,
        plan_name: 'Monthly',
        actions: { is_edit_plan_available: true },
      },
      plans: [],
    });

    assert.match(html, /No other plans are available/);
    assert.match(html, /disabled/);
  });
});
