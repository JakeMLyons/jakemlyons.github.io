/**
 * state.test.js — Unit tests for state.js
 * Run with: node --test state.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerState, GameOutput } from './state.js';

describe('PlayerState.copy()', () => {
  it('produces independent copies of all array fields', () => {
    const s = new PlayerState({
      sceneId: 'a',
      inventory: ['sword'],
      attributes: { health: 10 },
      visited: ['a'],
      notes: ['note1'],
    });
    const c = s.copy();
    c.inventory.push('shield');
    c.visited.push('b');
    c.notes.push('note2');
    c.sceneId = 'b';
    c.attributes.health = 5;

    assert.deepEqual(s.inventory, ['sword']);
    assert.deepEqual(s.visited, ['a']);
    assert.deepEqual(s.notes, ['note1']);
    assert.equal(s.sceneId, 'a');
    assert.equal(s.attributes.health, 10);
  });
});

describe('PlayerState.toDict() / fromDict()', () => {
  it('round-trips all fields including attributes', () => {
    const s = new PlayerState({
      sceneId: 'forest',
      inventory: ['lantern', 'key'],
      attributes: { health: 75, sanity: 8 },
      visited: ['start', 'forest'],
      notes: ['A hidden door to the north.'],
    });
    const d = s.toDict();
    const s2 = PlayerState.fromDict(d);

    assert.equal(s2.sceneId, 'forest');
    assert.deepEqual(s2.inventory, ['lantern', 'key']);
    assert.deepEqual(s2.attributes, { health: 75, sanity: 8 });
    assert.deepEqual(s2.visited, ['start', 'forest']);
    assert.deepEqual(s2.notes, ['A hidden door to the north.']);
  });

  it('toDict() uses snake_case keys matching save format', () => {
    const s = new PlayerState({ sceneId: 'x' });
    const d = s.toDict();
    assert.ok('scene_id' in d);
    assert.ok(!('sceneId' in d));
    assert.ok('attributes' in d);
  });

  it('empty attributes dict round-trips correctly', () => {
    const s = new PlayerState({ sceneId: 'x', attributes: {} });
    const d = s.toDict();
    assert.deepEqual(d.attributes, {});
    const s2 = PlayerState.fromDict(d);
    assert.deepEqual(s2.attributes, {});
  });
});

describe('PlayerState.fromDict() backward compatibility', () => {
  it('defaults visited to [] when absent', () => {
    const s = PlayerState.fromDict({ scene_id: 'x', inventory: [] });
    assert.deepEqual(s.visited, []);
  });

  it('defaults notes to [] when absent', () => {
    const s = PlayerState.fromDict({ scene_id: 'x', inventory: [] });
    assert.deepEqual(s.notes, []);
  });

  it('defaults attributes to {} when absent', () => {
    const s = PlayerState.fromDict({ scene_id: 'x', inventory: [] });
    assert.deepEqual(s.attributes, {});
  });
});

describe('PlayerState.fromCampaign()', () => {
  it('reads campaign.attributes and inventory correctly', () => {
    const campaign = {
      metadata: {
        start: 'begin',
        inventory: ['torch'],
      },
      attributes: {
        health: { value: 100 },
        sanity: { value: 10 },
      },
      scenes: {},
      items: {},
    };
    const s = PlayerState.fromCampaign(campaign);
    assert.equal(s.sceneId, 'begin');
    assert.equal(s.attributes.health, 100);
    assert.equal(s.attributes.sanity, 10);
    assert.deepEqual(s.inventory, ['torch']);
  });

  it('handles missing attributes block', () => {
    const campaign = {
      metadata: { start: 'begin' },
      attributes: {},
      scenes: {},
      items: {},
    };
    const s = PlayerState.fromCampaign(campaign);
    assert.equal(s.sceneId, 'begin');
    assert.deepEqual(s.attributes, {});
    assert.deepEqual(s.inventory, []);
  });

  it('coerces string attribute values to numbers', () => {
    const campaign = {
      metadata: { start: 'begin' },
      attributes: { health: { value: '50' } },
      scenes: {},
      items: {},
    };
    const s = PlayerState.fromCampaign(campaign);
    assert.equal(s.attributes.health, 50);
    assert.equal(typeof s.attributes.health, 'number');
  });
});

describe('GameOutput constructor', () => {
  it('has sane defaults', () => {
    const s = new PlayerState({ sceneId: 'x' });
    const o = new GameOutput({ state: s, sceneText: 'Hello.' });
    assert.deepEqual(o.choices, []);
    assert.deepEqual(o.messages, []);
    assert.equal(o.isTerminal, false);
    assert.equal(o.terminalReason, null);
    assert.equal(o.noChoices, false);
    assert.equal(o.sceneType, 'decision');
  });

  it('sceneType is preserved', () => {
    const s = new PlayerState({ sceneId: 'x' });
    const o = new GameOutput({ state: s, sceneText: 'Go.', sceneType: 'through' });
    assert.equal(o.sceneType, 'through');
  });
});

// ─── obtainedItems ────────────────────────────────────────────────────────────

describe('PlayerState.copy() — obtainedItems', () => {
  it('clones obtainedItems independently', () => {
    const s = new PlayerState({ sceneId: 'x', obtainedItems: ['sword'] });
    const c = s.copy();
    c.obtainedItems.push('shield');
    assert.deepEqual(s.obtainedItems, ['sword']);
  });
});

describe('PlayerState.toDict() / fromDict() — obtainedItems', () => {
  it('serialises as obtained_items', () => {
    const s = new PlayerState({ sceneId: 'x', obtainedItems: ['key', 'map'] });
    const d = s.toDict();
    assert.deepEqual(d.obtained_items, ['key', 'map']);
  });

  it('round-trips obtained_items', () => {
    const s = new PlayerState({ sceneId: 'x', obtainedItems: ['key'] });
    const s2 = PlayerState.fromDict(s.toDict());
    assert.deepEqual(s2.obtainedItems, ['key']);
  });

  it('defaults obtainedItems to [] when absent (old saves)', () => {
    const s = PlayerState.fromDict({ scene_id: 'x', inventory: [] });
    assert.deepEqual(s.obtainedItems, []);
  });
});

describe('PlayerState.fromCampaign() — obtainedItems', () => {
  it('seeds obtainedItems from starting inventory', () => {
    const campaign = {
      metadata: { start: 'begin', inventory: ['torch', 'map'] },
      attributes: {},
      scenes: {},
      items: {},
    };
    const s = PlayerState.fromCampaign(campaign);
    assert.deepEqual(s.obtainedItems, ['torch', 'map']);
  });

  it('obtainedItems is [] when no starting inventory', () => {
    const campaign = {
      metadata: { start: 'begin' },
      attributes: {},
      scenes: {},
      items: {},
    };
    const s = PlayerState.fromCampaign(campaign);
    assert.deepEqual(s.obtainedItems, []);
  });
});
