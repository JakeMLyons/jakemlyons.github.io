/**
 * events.test.js — Unit tests for events.js
 * Run with: node --test events.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerState } from './state.js';
import {
  applyItemGrants,
  applyItemRemovals,
  applyNoteGrants,
  applyChoiceHealth,
  applySceneEvents,
} from './events.js';

function makeState(overrides = {}) {
  return new PlayerState({
    sceneId: 'test',
    inventory: [],
    health: 100,
    visited: [],
    notes: [],
    ...overrides,
  });
}

// ─── applyItemGrants ─────────────────────────────────────────────────────────

describe('applyItemGrants()', () => {
  it('grants items not already held', () => {
    const state = makeState();
    const { newState, messages } = applyItemGrants(
      { gives_items: ['lantern', 'key'] },
      state
    );
    assert.deepEqual(newState.inventory, ['lantern', 'key']);
    assert.deepEqual(messages, ['You obtained: lantern, key']);
  });

  it('skips items already held', () => {
    const state = makeState({ inventory: ['lantern'] });
    const { newState, messages } = applyItemGrants(
      { gives_items: ['lantern', 'key'] },
      state
    );
    assert.deepEqual(newState.inventory, ['lantern', 'key']);
    assert.deepEqual(messages, ['You obtained: key']);
  });

  it('returns empty messages when no new items', () => {
    const state = makeState({ inventory: ['lantern'] });
    const { newState, messages } = applyItemGrants(
      { gives_items: ['lantern'] },
      state
    );
    assert.deepEqual(messages, []);
    assert.deepEqual(newState.inventory, ['lantern']);
  });

  it('does not mutate input state', () => {
    const state = makeState();
    applyItemGrants({ gives_items: ['sword'] }, state);
    assert.deepEqual(state.inventory, []);
  });

  it('handles missing gives_items gracefully', () => {
    const state = makeState();
    const { newState, messages } = applyItemGrants({}, state);
    assert.deepEqual(messages, []);
    assert.deepEqual(newState.inventory, []);
  });
});

// ─── applyItemRemovals ───────────────────────────────────────────────────────

describe('applyItemRemovals()', () => {
  it('removes held items', () => {
    const state = makeState({ inventory: ['lantern', 'key'] });
    const { newState, messages } = applyItemRemovals(
      { removes_items: ['lantern'] },
      state
    );
    assert.deepEqual(newState.inventory, ['key']);
    assert.deepEqual(messages, []);
  });

  it('removes multiple items at once', () => {
    const state = makeState({ inventory: ['lantern', 'key', 'map'] });
    const { newState } = applyItemRemovals(
      { removes_items: ['lantern', 'map'] },
      state
    );
    assert.deepEqual(newState.inventory, ['key']);
  });

  it('silently skips items not currently held', () => {
    const state = makeState({ inventory: ['lantern'] });
    const { newState, messages } = applyItemRemovals(
      { removes_items: ['key'] },
      state
    );
    assert.deepEqual(newState.inventory, ['lantern']);
    assert.deepEqual(messages, []);
  });

  it('produces no messages', () => {
    const state = makeState({ inventory: ['lantern'] });
    const { messages } = applyItemRemovals(
      { removes_items: ['lantern'] },
      state
    );
    assert.deepEqual(messages, []);
  });

  it('handles missing removes_items gracefully', () => {
    const state = makeState({ inventory: ['lantern'] });
    const { newState, messages } = applyItemRemovals({}, state);
    assert.deepEqual(newState.inventory, ['lantern']);
    assert.deepEqual(messages, []);
  });

  it('does not mutate input state', () => {
    const state = makeState({ inventory: ['lantern'] });
    applyItemRemovals({ removes_items: ['lantern'] }, state);
    assert.deepEqual(state.inventory, ['lantern']);
  });

  it('returns original state reference when nothing removed', () => {
    const state = makeState({ inventory: ['lantern'] });
    const { newState } = applyItemRemovals({ removes_items: ['key'] }, state);
    assert.equal(newState, state);
  });
});

// ─── applyNoteGrants ─────────────────────────────────────────────────────────

describe('applyNoteGrants()', () => {
  it('grants new notes', () => {
    const state = makeState();
    const { newState, messages } = applyNoteGrants(
      { gives_notes: ['A hidden door to the north.'] },
      state
    );
    assert.deepEqual(newState.notes, ['A hidden door to the north.']);
    assert.deepEqual(messages, ['Journal updated.']);
  });

  it('skips duplicate notes', () => {
    const state = makeState({ notes: ['A hidden door to the north.'] });
    const { newState, messages } = applyNoteGrants(
      { gives_notes: ['A hidden door to the north.'] },
      state
    );
    assert.deepEqual(messages, []);
    assert.deepEqual(newState.notes, ['A hidden door to the north.']);
  });

  it('does not mutate input state', () => {
    const state = makeState();
    applyNoteGrants({ gives_notes: ['note'] }, state);
    assert.deepEqual(state.notes, []);
  });

  it('handles missing gives_notes gracefully', () => {
    const state = makeState();
    const { messages } = applyNoteGrants({}, state);
    assert.deepEqual(messages, []);
  });
});

// ─── applyChoiceHealth ───────────────────────────────────────────────────────

describe('applyChoiceHealth()', () => {
  it('applies damage', () => {
    const state = makeState({ health: 100 });
    const { newState, messages } = applyChoiceHealth({ damage: 10 }, state);
    assert.equal(newState.health, 90);
    assert.deepEqual(messages, ['You took 10 damage! Health: 90']);
  });

  it('applies heal', () => {
    const state = makeState({ health: 80 });
    const { newState, messages } = applyChoiceHealth({ heal: 20 }, state);
    assert.equal(newState.health, 100);
    assert.deepEqual(messages, ['You recovered 20 health! Health: 100']);
  });

  it('applies both damage and heal', () => {
    const state = makeState({ health: 50 });
    const { newState, messages } = applyChoiceHealth(
      { damage: 10, heal: 5 },
      state
    );
    assert.equal(newState.health, 45);
    assert.equal(messages.length, 2);
  });

  it('no-ops when neither damage nor heal', () => {
    const state = makeState({ health: 50 });
    const { newState, messages } = applyChoiceHealth({}, state);
    assert.equal(newState.health, 50);
    assert.deepEqual(messages, []);
  });

  it('silently no-ops when health is null', () => {
    const state = makeState({ health: null });
    const { newState, messages } = applyChoiceHealth({ damage: 10 }, state);
    assert.equal(newState.health, null);
    assert.deepEqual(messages, []);
  });

  it('coerces string "5" damage correctly', () => {
    const state = makeState({ health: 100 });
    const { newState } = applyChoiceHealth({ damage: '5' }, state);
    assert.equal(newState.health, 95);
  });

  it('does not mutate input state', () => {
    const state = makeState({ health: 100 });
    applyChoiceHealth({ damage: 10 }, state);
    assert.equal(state.health, 100);
  });
});

// ─── applySceneEvents ────────────────────────────────────────────────────────

describe('applySceneEvents()', () => {
  it('returns unchanged state and empty messages when no on_enter', () => {
    const state = makeState();
    const { newState, messages } = applySceneEvents({}, state);
    assert.deepEqual(messages, []);
    assert.deepEqual(newState.inventory, []);
  });

  it('processes full on_enter block in display order: message, items, notes, health', () => {
    const scene = {
      on_enter: {
        message: 'A trap springs!',
        gives_items: ['map fragment'],
        gives_notes: ['Wall inscription: three keys.'],
        damage: 10,
      },
    };
    const state = makeState({ health: 100 });
    const { newState, messages } = applySceneEvents(scene, state);

    assert.equal(messages[0], 'A trap springs!');
    assert.equal(messages[1], 'You found: map fragment');
    assert.equal(messages[2], 'Journal updated.');
    assert.equal(messages[3], 'You took 10 damage! Health: 90');
    assert.deepEqual(newState.inventory, ['map fragment']);
    assert.equal(newState.health, 90);
  });

  it('gives_items in on_enter uses "You found:" (not "You obtained:")', () => {
    const scene = { on_enter: { gives_items: ['lantern'] } };
    const { messages } = applySceneEvents(scene, makeState());
    assert.equal(messages[0], 'You found: lantern');
  });

  it('silently no-ops health when health is null', () => {
    const scene = { on_enter: { damage: 99 } };
    const state = makeState({ health: null });
    const { newState, messages } = applySceneEvents(scene, state);
    assert.equal(newState.health, null);
    assert.deepEqual(messages, []);
  });

  it('does not mutate input state', () => {
    const scene = { on_enter: { gives_items: ['sword'], damage: 5 } };
    const state = makeState({ health: 100 });
    applySceneEvents(scene, state);
    assert.deepEqual(state.inventory, []);
    assert.equal(state.health, 100);
  });

  it('coerces string "10" damage correctly', () => {
    const scene = { on_enter: { damage: '10' } };
    const state = makeState({ health: 100 });
    const { newState } = applySceneEvents(scene, state);
    assert.equal(newState.health, 90);
  });

  it('removes items listed in removes_items', () => {
    const scene = { on_enter: { removes_items: ['lantern'] } };
    const state = makeState({ inventory: ['lantern', 'key'] });
    const { newState, messages } = applySceneEvents(scene, state);
    assert.deepEqual(newState.inventory, ['key']);
    assert.deepEqual(messages, []);
  });

  it('processes removes_items after gives_items (grant then consume in same on_enter)', () => {
    const scene = {
      on_enter: { gives_items: ['potion'], removes_items: ['potion'] },
    };
    const state = makeState();
    const { newState } = applySceneEvents(scene, state);
    assert.deepEqual(newState.inventory, []);
  });
});
