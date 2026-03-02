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
      health: 10,
      visited: ['a'],
      notes: ['note1'],
    });
    const c = s.copy();
    c.inventory.push('shield');
    c.visited.push('b');
    c.notes.push('note2');
    c.sceneId = 'b';
    c.health = 5;

    assert.deepEqual(s.inventory, ['sword']);
    assert.deepEqual(s.visited, ['a']);
    assert.deepEqual(s.notes, ['note1']);
    assert.equal(s.sceneId, 'a');
    assert.equal(s.health, 10);
  });
});

describe('PlayerState.toDict() / fromDict()', () => {
  it('round-trips all fields including health', () => {
    const s = new PlayerState({
      sceneId: 'forest',
      inventory: ['lantern', 'key'],
      health: 75,
      visited: ['start', 'forest'],
      notes: ['A hidden door to the north.'],
    });
    const d = s.toDict();
    const s2 = PlayerState.fromDict(d);

    assert.equal(s2.sceneId, 'forest');
    assert.deepEqual(s2.inventory, ['lantern', 'key']);
    assert.equal(s2.health, 75);
    assert.deepEqual(s2.visited, ['start', 'forest']);
    assert.deepEqual(s2.notes, ['A hidden door to the north.']);
  });

  it('toDict() uses snake_case keys matching Python format', () => {
    const s = new PlayerState({ sceneId: 'x' });
    const d = s.toDict();
    assert.ok('scene_id' in d);
    assert.ok(!('sceneId' in d));
  });

  it('health null round-trips correctly', () => {
    const s = new PlayerState({ sceneId: 'x', health: null });
    const d = s.toDict();
    assert.equal(d.health, null);
    const s2 = PlayerState.fromDict(d);
    assert.equal(s2.health, null);
  });
});

describe('PlayerState.fromDict() backward compatibility', () => {
  it('defaults visited to [] when absent', () => {
    const s = PlayerState.fromDict({ scene_id: 'x', inventory: [], health: null });
    assert.deepEqual(s.visited, []);
  });

  it('defaults notes to [] when absent', () => {
    const s = PlayerState.fromDict({ scene_id: 'x', inventory: [], health: null });
    assert.deepEqual(s.notes, []);
  });
});

describe('PlayerState.fromCampaign()', () => {
  it('reads metadata.default_player_state correctly', () => {
    const campaign = {
      metadata: {
        start: 'begin',
        default_player_state: {
          health: 100,
          inventory: ['torch'],
        },
      },
      scenes: {},
      items: {},
    };
    const s = PlayerState.fromCampaign(campaign);
    assert.equal(s.sceneId, 'begin');
    assert.equal(s.health, 100);
    assert.deepEqual(s.inventory, ['torch']);
  });

  it('handles missing default_player_state', () => {
    const campaign = {
      metadata: { start: 'begin' },
      scenes: {},
      items: {},
    };
    const s = PlayerState.fromCampaign(campaign);
    assert.equal(s.sceneId, 'begin');
    assert.equal(s.health, null);
    assert.deepEqual(s.inventory, []);
  });

  it('coerces string health to number', () => {
    const campaign = {
      metadata: {
        start: 'begin',
        default_player_state: { health: '50' },
      },
      scenes: {},
      items: {},
    };
    const s = PlayerState.fromCampaign(campaign);
    assert.equal(s.health, 50);
    assert.equal(typeof s.health, 'number');
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
  });
});
