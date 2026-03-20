/**
 * choices.test.js — Unit tests for choices.js
 * Run with: node --test choices.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAvailableChoices } from './choices.js';

const CHOICE_A = { label: 'A', next: 'a' };
const CHOICE_B = { label: 'B', next: 'b', requires_item: 'key' };
const CHOICE_C = { label: 'C', next: 'c', requires_items: ['sword', 'shield'] };
const CHOICE_D = {
  label: 'D',
  next: 'd',
  requires_item: 'key',
  requires_items: ['torch'],
};

describe('getAvailableChoices()', () => {
  it('empty inventory returns only unconditional choices', () => {
    const result = getAvailableChoices([CHOICE_A, CHOICE_B], []);
    assert.deepEqual(result, [CHOICE_A]);
  });

  it('returns all choices when requirements met', () => {
    const result = getAvailableChoices([CHOICE_A, CHOICE_B], ['key']);
    assert.deepEqual(result, [CHOICE_A, CHOICE_B]);
  });

  it('requires_item met', () => {
    assert.equal(getAvailableChoices([CHOICE_B], ['key']).length, 1);
  });

  it('requires_item unmet', () => {
    assert.equal(getAvailableChoices([CHOICE_B], []).length, 0);
  });

  it('requires_items all present', () => {
    assert.equal(
      getAvailableChoices([CHOICE_C], ['sword', 'shield']).length,
      1
    );
  });

  it('requires_items partially present', () => {
    assert.equal(getAvailableChoices([CHOICE_C], ['sword']).length, 0);
  });

  it('requires_items all absent', () => {
    assert.equal(getAvailableChoices([CHOICE_C], []).length, 0);
  });

  it('requires_item and requires_items coexisting — both conditions met', () => {
    assert.equal(
      getAvailableChoices([CHOICE_D], ['key', 'torch']).length,
      1
    );
  });

  it('requires_item and requires_items coexisting — only requires_item met', () => {
    assert.equal(getAvailableChoices([CHOICE_D], ['key']).length, 0);
  });

  it('requires_item and requires_items coexisting — only requires_items met', () => {
    assert.equal(getAvailableChoices([CHOICE_D], ['torch']).length, 0);
  });

  it('returns [] for null/undefined choices', () => {
    assert.deepEqual(getAvailableChoices(null, []), []);
    assert.deepEqual(getAvailableChoices(undefined, []), []);
  });

  it('preserves order of available choices', () => {
    const result = getAvailableChoices([CHOICE_A, CHOICE_B, CHOICE_C], ['key']);
    assert.deepEqual(result, [CHOICE_A, CHOICE_B]);
  });
});

// ─── requires_items structured format ────────────────────────────────────────

describe('getAvailableChoices() — structured requires_items', () => {
  it('is: "owned" — passes when item in inventory', () => {
    const choice = { label: 'X', next: 'x', requires_items: [{ item: 'torch', is: 'owned' }] };
    assert.equal(getAvailableChoices([choice], ['torch']).length, 1);
  });

  it('is: "owned" — fails when item not in inventory', () => {
    const choice = { label: 'X', next: 'x', requires_items: [{ item: 'torch', is: 'owned' }] };
    assert.equal(getAvailableChoices([choice], []).length, 0);
  });

  it('is_not: "owned" — passes when item NOT in inventory', () => {
    const choice = { label: 'X', next: 'x', requires_items: [{ item: 'torch', is_not: 'owned' }] };
    assert.equal(getAvailableChoices([choice], []).length, 1);
  });

  it('is_not: "owned" — fails when item IS in inventory', () => {
    const choice = { label: 'X', next: 'x', requires_items: [{ item: 'torch', is_not: 'owned' }] };
    assert.equal(getAvailableChoices([choice], ['torch']).length, 0);
  });

  it('is: "obtained" — passes when item in obtainedItems', () => {
    const choice = { label: 'X', next: 'x', requires_items: [{ item: 'key', is: 'obtained' }] };
    assert.equal(getAvailableChoices([choice], [], {}, ['key']).length, 1);
  });

  it('is: "obtained" — fails when item not in obtainedItems', () => {
    const choice = { label: 'X', next: 'x', requires_items: [{ item: 'key', is: 'obtained' }] };
    assert.equal(getAvailableChoices([choice], [], {}, []).length, 0);
  });

  it('is_not: "obtained" — passes when item NOT in obtainedItems', () => {
    const choice = { label: 'X', next: 'x', requires_items: [{ item: 'gem', is_not: 'obtained' }] };
    assert.equal(getAvailableChoices([choice], [], {}, []).length, 1);
  });

  it('is_not: "obtained" — fails when item IS in obtainedItems', () => {
    const choice = { label: 'X', next: 'x', requires_items: [{ item: 'gem', is_not: 'obtained' }] };
    assert.equal(getAvailableChoices([choice], [], {}, ['gem']).length, 0);
  });

  it('plain string entry treated as is: "owned" (backward compat)', () => {
    const choice = { label: 'X', next: 'x', requires_items: ['key'] };
    assert.equal(getAvailableChoices([choice], ['key']).length, 1);
    assert.equal(getAvailableChoices([choice], []).length, 0);
  });

  it('mixed: string and object entries in same requires_items — AND logic', () => {
    const choice = {
      label: 'X', next: 'x',
      requires_items: [
        'torch',
        { item: 'key', is: 'obtained' },
      ],
    };
    assert.equal(getAvailableChoices([choice], ['torch'], {}, ['key']).length, 1);
    assert.equal(getAvailableChoices([choice], ['torch'], {}, []).length, 0); // obtained unmet
    assert.equal(getAvailableChoices([choice], [], {}, ['key']).length, 0);   // owned unmet
  });

  it('obtained check passes even if item was removed from inventory', () => {
    // inventory empty (item was removed), but obtainedItems still has it
    const choice = { label: 'X', next: 'x', requires_items: [{ item: 'key', is: 'obtained' }] };
    assert.equal(getAvailableChoices([choice], [], {}, ['key']).length, 1);
  });
});

// ─── requires_attributes dict format ─────────────────────────────────────────

describe('getAvailableChoices() — dict requires_attributes', () => {
  it('single condition passes', () => {
    const choice = { label: 'X', next: 'x', requires_attributes: { health: '>= 50' } };
    assert.equal(getAvailableChoices([choice], [], { health: 75 }).length, 1);
  });

  it('single condition fails', () => {
    const choice = { label: 'X', next: 'x', requires_attributes: { health: '>= 50' } };
    assert.equal(getAvailableChoices([choice], [], { health: 30 }).length, 0);
  });

  it('"= 0" exact match passes', () => {
    const choice = { label: 'X', next: 'x', requires_attributes: { flag: '= 0' } };
    assert.equal(getAvailableChoices([choice], [], { flag: 0 }).length, 1);
  });

  it('"!= 5" passes when value is not 5', () => {
    const choice = { label: 'X', next: 'x', requires_attributes: { rep: '!= 5' } };
    assert.equal(getAvailableChoices([choice], [], { rep: 3 }).length, 1);
    assert.equal(getAvailableChoices([choice], [], { rep: 5 }).length, 0);
  });

  it('comma-separated multi-condition — in range', () => {
    const choice = { label: 'X', next: 'x', requires_attributes: { rep: '>= 10, <= 90' } };
    assert.equal(getAvailableChoices([choice], [], { rep: 50 }).length, 1);
    assert.equal(getAvailableChoices([choice], [], { rep: 9 }).length, 0);
    assert.equal(getAvailableChoices([choice], [], { rep: 91 }).length, 0);
  });

  it('legacy array format still works alongside dict tests', () => {
    const choice = {
      label: 'X', next: 'x',
      requires_attributes: [{ attr: 'health', op: '>=', value: 50 }],
    };
    assert.equal(getAvailableChoices([choice], [], { health: 75 }).length, 1);
    assert.equal(getAvailableChoices([choice], [], { health: 30 }).length, 0);
  });

  it('unknown attribute defaults to 0', () => {
    const choice = { label: 'X', next: 'x', requires_attributes: { sanity: '>= 1' } };
    assert.equal(getAvailableChoices([choice], [], {}).length, 0);
  });
});
