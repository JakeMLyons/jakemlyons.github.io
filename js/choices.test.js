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
