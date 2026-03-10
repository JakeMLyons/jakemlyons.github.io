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
  applyAttributeEffects,
  applySceneEvents,
} from './events.js';

function makeState(overrides = {}) {
  return new PlayerState({
    sceneId: 'test',
    inventory: [],
    attributes: {},
    visited: [],
    notes: [],
    ...overrides,
  });
}

/** Campaign with a single health attribute (min 0, max 100). */
function makeCampaign(attrDefs = { health: { value: 100, min: 0, max: 100 } }) {
  return { metadata: {}, attributes: attrDefs, items: {} };
}

// ─── applyItemGrants ─────────────────────────────────────────────────────────

describe('applyItemGrants()', () => {
  it('grants items not already held', () => {
    const state = makeState();
    const { newState, messages } = applyItemGrants(
      { gives_items: ['lantern', 'key'] },
      state,
      {}
    );
    assert.deepEqual(newState.inventory, ['lantern', 'key']);
    assert.deepEqual(messages, ['You obtained: lantern, key']);
  });

  it('skips items already held', () => {
    const state = makeState({ inventory: ['lantern'] });
    const { newState, messages } = applyItemGrants(
      { gives_items: ['lantern', 'key'] },
      state,
      {}
    );
    assert.deepEqual(newState.inventory, ['lantern', 'key']);
    assert.deepEqual(messages, ['You obtained: key']);
  });

  it('returns empty messages when no new items', () => {
    const state = makeState({ inventory: ['lantern'] });
    const { newState, messages } = applyItemGrants(
      { gives_items: ['lantern'] },
      state,
      {}
    );
    assert.deepEqual(messages, []);
    assert.deepEqual(newState.inventory, ['lantern']);
  });

  it('does not mutate input state', () => {
    const state = makeState();
    applyItemGrants({ gives_items: ['sword'] }, state, {});
    assert.deepEqual(state.inventory, []);
  });

  it('handles missing gives_items gracefully', () => {
    const state = makeState();
    const { newState, messages } = applyItemGrants({}, state, {});
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
      state,
      {}
    );
    assert.deepEqual(newState.inventory, ['key']);
    assert.deepEqual(messages, []);
  });

  it('removes multiple items at once', () => {
    const state = makeState({ inventory: ['lantern', 'key', 'map'] });
    const { newState } = applyItemRemovals(
      { removes_items: ['lantern', 'map'] },
      state,
      {}
    );
    assert.deepEqual(newState.inventory, ['key']);
  });

  it('silently skips items not currently held', () => {
    const state = makeState({ inventory: ['lantern'] });
    const { newState, messages } = applyItemRemovals(
      { removes_items: ['key'] },
      state,
      {}
    );
    assert.deepEqual(newState.inventory, ['lantern']);
    assert.deepEqual(messages, []);
  });

  it('produces no messages', () => {
    const state = makeState({ inventory: ['lantern'] });
    const { messages } = applyItemRemovals(
      { removes_items: ['lantern'] },
      state,
      {}
    );
    assert.deepEqual(messages, []);
  });

  it('handles missing removes_items gracefully', () => {
    const state = makeState({ inventory: ['lantern'] });
    const { newState, messages } = applyItemRemovals({}, state, {});
    assert.deepEqual(newState.inventory, ['lantern']);
    assert.deepEqual(messages, []);
  });

  it('does not mutate input state', () => {
    const state = makeState({ inventory: ['lantern'] });
    applyItemRemovals({ removes_items: ['lantern'] }, state, {});
    assert.deepEqual(state.inventory, ['lantern']);
  });

  it('returns original state reference when nothing removed', () => {
    const state = makeState({ inventory: ['lantern'] });
    const { newState } = applyItemRemovals({ removes_items: ['key'] }, state, {});
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

// ─── applyAttributeEffects ───────────────────────────────────────────────────

describe('applyAttributeEffects()', () => {
  it('applies a negative delta (damage)', () => {
    const state = makeState({ attributes: { health: 100 } });
    const { newState, died } = applyAttributeEffects(
      { affect_attributes: { health: -10 } },
      state,
      makeCampaign()
    );
    assert.equal(newState.attributes.health, 90);
    assert.equal(died, false);
  });

  it('applies a positive delta (heal)', () => {
    const state = makeState({ attributes: { health: 80 } });
    const { newState, died } = applyAttributeEffects(
      { affect_attributes: { health: 10 } },
      state,
      makeCampaign()
    );
    assert.equal(newState.attributes.health, 90);
    assert.equal(died, false);
  });

  it('clamps value at max', () => {
    const state = makeState({ attributes: { health: 90 } });
    const { newState } = applyAttributeEffects(
      { affect_attributes: { health: 50 } },
      state,
      makeCampaign({ health: { value: 100, min: 0, max: 100 } })
    );
    assert.equal(newState.attributes.health, 100);
  });

  it('clamps value at min and sets died=true', () => {
    const state = makeState({ attributes: { health: 5 } });
    const { newState, died, deathMessage } = applyAttributeEffects(
      { affect_attributes: { health: -20 } },
      state,
      makeCampaign({ health: { value: 100, min: 0, max: 100 } })
    );
    assert.equal(newState.attributes.health, 0);
    assert.equal(died, true);
    assert.equal(deathMessage, null); // no min_message defined
  });

  it('uses min_message as deathMessage when defined', () => {
    const state = makeState({ attributes: { health: 1 } });
    const { died, deathMessage } = applyAttributeEffects(
      { affect_attributes: { health: -100 } },
      state,
      makeCampaign({ health: { value: 100, min: 0, min_message: 'You have perished.' } })
    );
    assert.equal(died, true);
    assert.equal(deathMessage, 'You have perished.');
  });

  it('no-ops when affect_attributes is absent', () => {
    const state = makeState({ attributes: { health: 50 } });
    const { newState, died } = applyAttributeEffects({}, state, makeCampaign());
    assert.equal(newState.attributes.health, 50);
    assert.equal(died, false);
  });

  it('silently skips unknown attributes', () => {
    const state = makeState({ attributes: {} });
    const { newState, died } = applyAttributeEffects(
      { affect_attributes: { health: -10 } },
      state,
      {}
    );
    assert.deepEqual(newState.attributes, {});
    assert.equal(died, false);
  });

  it('coerces string delta values', () => {
    const state = makeState({ attributes: { health: 100 } });
    const { newState } = applyAttributeEffects(
      { affect_attributes: { health: '-5' } },
      state,
      makeCampaign()
    );
    assert.equal(newState.attributes.health, 95);
  });

  it('always returns empty messages array', () => {
    const state = makeState({ attributes: { health: 100 } });
    const { messages } = applyAttributeEffects(
      { affect_attributes: { health: -10 } },
      state,
      makeCampaign()
    );
    assert.deepEqual(messages, []);
  });

  it('does not mutate input state', () => {
    const state = makeState({ attributes: { health: 100 } });
    applyAttributeEffects({ affect_attributes: { health: -10 } }, state, makeCampaign());
    assert.equal(state.attributes.health, 100);
  });

  it('returns triggerScene when min_scene is defined', () => {
    const state = makeState({ attributes: { health: 5 } });
    const campaign = makeCampaign({ health: { value: 100, min: 0, max: 100, min_scene: 'death_scene' } });
    const { triggerScene, died } = applyAttributeEffects(
      { affect_attributes: { health: -20 } },
      state,
      campaign
    );
    assert.equal(triggerScene, 'death_scene');
    assert.equal(died, false);
  });

  it('returns triggerScene for max_scene when max is reached', () => {
    const state = makeState({ attributes: { power: 8 } });
    const campaign = makeCampaign({ power: { value: 0, max: 10, max_scene: 'ascend' } });
    const { triggerScene } = applyAttributeEffects(
      { affect_attributes: { power: 5 } },
      state,
      campaign
    );
    assert.equal(triggerScene, 'ascend');
  });

  it('returns null triggerScene when no boundary scenes defined', () => {
    const state = makeState({ attributes: { health: 100 } });
    const { triggerScene } = applyAttributeEffects(
      { affect_attributes: { health: -10 } },
      state,
      makeCampaign()
    );
    assert.equal(triggerScene, null);
  });
});

// ─── applySceneEvents ────────────────────────────────────────────────────────

describe('applySceneEvents()', () => {
  it('returns unchanged state and empty messages when no on_enter', () => {
    const state = makeState();
    const { newState, messages } = applySceneEvents({}, state, {});
    assert.deepEqual(messages, []);
    assert.deepEqual(newState.inventory, []);
  });

  it('processes full on_enter block in display order: message, items, notes', () => {
    const scene = {
      on_enter: {
        message: 'A trap springs!',
        gives_items: ['map fragment'],
        gives_notes: ['Wall inscription: three keys.'],
        affect_attributes: { health: -10 },
      },
    };
    const campaign = makeCampaign();
    const state = makeState({ attributes: { health: 100 } });
    const { newState, messages } = applySceneEvents(scene, state, campaign);

    assert.equal(messages[0], 'A trap springs!');
    assert.equal(messages[1], 'You found: map fragment');
    assert.equal(messages[2], 'Journal updated.');
    assert.equal(messages.length, 3);
    assert.deepEqual(newState.inventory, ['map fragment']);
    assert.equal(newState.attributes.health, 90);
  });

  it('gives_items in on_enter uses "You found:" (not "You obtained:")', () => {
    const scene = { on_enter: { gives_items: ['lantern'] } };
    const { messages } = applySceneEvents(scene, makeState(), {});
    assert.equal(messages[0], 'You found: lantern');
  });

  it('affect_attributes on unknown attribute is silently skipped', () => {
    const scene = { on_enter: { affect_attributes: { health: -99 } } };
    const state = makeState(); // no attributes
    const { newState, messages } = applySceneEvents(scene, state, {});
    assert.deepEqual(newState.attributes, {});
    assert.deepEqual(messages, []);
  });

  it('does not mutate input state', () => {
    const scene = {
      on_enter: {
        gives_items: ['sword'],
        affect_attributes: { health: -5 },
      },
    };
    const campaign = makeCampaign();
    const state = makeState({ attributes: { health: 100 } });
    applySceneEvents(scene, state, campaign);
    assert.deepEqual(state.inventory, []);
    assert.equal(state.attributes.health, 100);
  });

  it('coerces string affect_attributes delta values', () => {
    const scene = { on_enter: { affect_attributes: { health: '-10' } } };
    const campaign = makeCampaign();
    const state = makeState({ attributes: { health: 100 } });
    const { newState } = applySceneEvents(scene, state, campaign);
    assert.equal(newState.attributes.health, 90);
  });

  it('removes items listed in removes_items', () => {
    const scene = { on_enter: { removes_items: ['lantern'] } };
    const state = makeState({ inventory: ['lantern', 'key'] });
    const { newState, messages } = applySceneEvents(scene, state, {});
    assert.deepEqual(newState.inventory, ['key']);
    assert.deepEqual(messages, []);
  });

  it('processes removes_items after gives_items (grant then consume in same on_enter)', () => {
    const scene = {
      on_enter: { gives_items: ['potion'], removes_items: ['potion'] },
    };
    const state = makeState();
    const { newState } = applySceneEvents(scene, state, {});
    assert.deepEqual(newState.inventory, []);
  });
});
