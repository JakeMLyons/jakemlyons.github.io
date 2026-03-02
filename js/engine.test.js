/**
 * engine.test.js — Unit tests for engine.js
 * Run with: node --test engine.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from './engine.js';
import { PlayerState } from './state.js';

// ─── Minimal campaign helpers ─────────────────────────────────────────────────

function makeCampaign(overrides = {}) {
  return {
    metadata: {
      title: 'Test',
      start: 'start',
      default_player_state: { health: 100, inventory: [] },
    },
    scenes: {
      start: {
        text: 'You are at the start.',
        choices: [{ label: 'Go forward', next: 'forest' }],
      },
      forest: {
        text: 'You are in the forest.',
        choices: [{ label: 'Return', next: 'start' }],
      },
    },
    items: {},
    ...overrides,
  };
}

// ─── start() ─────────────────────────────────────────────────────────────────

describe('GameEngine.start()', () => {
  it('returns correct first scene text', () => {
    const engine = new GameEngine(makeCampaign());
    const output = engine.start();
    assert.equal(output.sceneText, 'You are at the start.');
    assert.deepEqual(output.choices, ['Go forward']);
    assert.equal(output.isTerminal, false);
  });

  it('records starting scene in visited', () => {
    const engine = new GameEngine(makeCampaign());
    const output = engine.start();
    assert.deepEqual(output.state.visited, ['start']);
  });

  it('performs death check: starting scene with lethal on_enter damage', () => {
    const campaign = makeCampaign();
    campaign.scenes.start.on_enter = { damage: 200 };
    const engine = new GameEngine(campaign);
    const output = engine.start();
    assert.equal(output.isTerminal, true);
    assert.equal(output.terminalReason, 'death');
  });

  it('resumes from initialState at the correct scene', () => {
    const engine = new GameEngine(makeCampaign());
    const saved = new PlayerState({
      sceneId: 'forest',
      inventory: [],
      health: 80,
      visited: ['start', 'forest'],
      notes: [],
    });
    const output = engine.start(saved);
    assert.equal(output.sceneText, 'You are in the forest.');
    assert.equal(output.state.health, 80);
  });

  it('start(initialState) re-fires on_enter; item grants are deduplicated', () => {
    const campaign = makeCampaign();
    campaign.scenes.forest.on_enter = { gives_items: ['magic herb'] };
    const engine = new GameEngine(campaign);
    const saved = new PlayerState({
      sceneId: 'forest',
      inventory: ['magic herb'], // already held
      health: 100,
      visited: ['start', 'forest'],
      notes: [],
    });
    const output = engine.start(saved);
    // should not duplicate the item
    assert.deepEqual(
      output.state.inventory.filter((x) => x === 'magic herb'),
      ['magic herb']
    );
  });
});

// ─── step() ──────────────────────────────────────────────────────────────────

describe('GameEngine.step()', () => {
  it('advances scene and returns correct output', () => {
    const engine = new GameEngine(makeCampaign());
    const first = engine.start();
    const second = engine.step(first.state, '1');
    assert.equal(second.sceneText, 'You are in the forest.');
    assert.deepEqual(second.choices, ['Return']);
  });

  it('accepts both string "1" and number 1 as equivalent', () => {
    const engine = new GameEngine(makeCampaign());
    const first = engine.start();
    const a = engine.step(first.state, '1');
    const b = engine.step(first.state, 1);
    assert.equal(a.sceneText, b.sceneText);
    assert.deepEqual(a.state.sceneId, b.state.sceneId);
  });

  it('throws RangeError on non-numeric input', () => {
    const engine = new GameEngine(makeCampaign());
    const first = engine.start();
    assert.throws(() => engine.step(first.state, 'foo'), RangeError);
  });

  it('throws RangeError on float string input "1.5"', () => {
    const engine = new GameEngine(makeCampaign());
    const first = engine.start();
    assert.throws(() => engine.step(first.state, '1.5'), RangeError);
  });

  it('throws RangeError on out-of-range choice number', () => {
    const engine = new GameEngine(makeCampaign());
    const first = engine.start();
    assert.throws(() => engine.step(first.state, '99'), RangeError);
    assert.throws(() => engine.step(first.state, '0'), RangeError);
  });

  it('appends to visited on every step including revisits', () => {
    const engine = new GameEngine(makeCampaign());
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');   // → forest
    const s3 = engine.step(s2.state, '1');   // → start (revisit)
    assert.deepEqual(s3.state.visited, ['start', 'forest', 'start']);
  });
});

// ─── Item grants and gates ────────────────────────────────────────────────────

describe('Item grants and gates', () => {
  it('grants item on choice and makes gated choice available', () => {
    const campaign = makeCampaign();
    campaign.scenes.start.choices = [
      { label: 'Pick up key', next: 'forest', gives_items: ['key'] },
      { label: 'Use key', next: 'vault', requires_item: 'key' },
    ];
    campaign.scenes.vault = { text: 'The vault.', end: true };
    const engine = new GameEngine(campaign);

    const s1 = engine.start();
    // Only one choice visible (no key yet)
    assert.equal(s1.choices.length, 1);
    assert.equal(s1.choices[0], 'Pick up key');

    const s2 = engine.step(s1.state, '1');
    // Now we're in forest with the key
    assert.ok(s2.state.inventory.includes('key'));

    // Go back to start
    const s3 = engine.step(s2.state, '1');
    // Now both choices visible
    assert.equal(s3.choices.length, 2);
  });
});

// ─── Death handling ───────────────────────────────────────────────────────────

describe('Death handling', () => {
  it('death from choice: sceneText is ""', () => {
    const campaign = makeCampaign();
    campaign.scenes.start.choices = [
      { label: 'Walk into lava', next: 'lava', damage: 200 },
    ];
    campaign.scenes.lava = { text: 'Lava scene.', end: true };
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.equal(s2.isTerminal, true);
    assert.equal(s2.terminalReason, 'death');
    assert.equal(s2.sceneText, '');
  });

  it('death from on_enter: sceneText is scene.text', () => {
    const campaign = makeCampaign();
    campaign.scenes.forest.on_enter = { damage: 200 };
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.equal(s2.isTerminal, true);
    assert.equal(s2.terminalReason, 'death');
    assert.equal(s2.sceneText, 'You are in the forest.');
  });
});

// ─── Terminal scenes ──────────────────────────────────────────────────────────

describe('Terminal scenes', () => {
  it('returns isTerminal=true, terminalReason="end" for end: true scenes', () => {
    const campaign = makeCampaign();
    campaign.scenes.start.choices = [
      { label: 'End it', next: 'ending' },
    ];
    campaign.scenes.ending = { text: 'The end.', end: true };
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.equal(s2.isTerminal, true);
    assert.equal(s2.terminalReason, 'end');
    assert.deepEqual(s2.choices, []);
  });
});

// ─── noChoices ────────────────────────────────────────────────────────────────

describe('noChoices', () => {
  it('returns noChoices=true when all choices locked', () => {
    const campaign = makeCampaign();
    campaign.scenes.start.choices = [
      { label: 'Locked', next: 'forest', requires_item: 'key' },
    ];
    const engine = new GameEngine(campaign);
    const output = engine.start();
    assert.equal(output.noChoices, true);
    assert.equal(output.isTerminal, false);
  });

  it('returns noChoices=true when scene has no choices array', () => {
    const campaign = makeCampaign();
    delete campaign.scenes.start.choices;
    // not an end scene, just missing choices
    const engine = new GameEngine(campaign);
    const output = engine.start();
    assert.equal(output.noChoices, true);
    assert.equal(output.isTerminal, false);
  });
});

// ─── Note grants ─────────────────────────────────────────────────────────────

describe('Note grants', () => {
  it('grants notes from choices', () => {
    const campaign = makeCampaign();
    campaign.scenes.start.choices[0].gives_notes = ['A clue was found.'];
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.ok(s2.state.notes.includes('A clue was found.'));
  });

  it('grants notes from on_enter', () => {
    const campaign = makeCampaign();
    campaign.scenes.forest.on_enter = { gives_notes: ['Forest note.'] };
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.ok(s2.state.notes.includes('Forest note.'));
  });

  it('does not accumulate duplicate notes', () => {
    const campaign = makeCampaign();
    campaign.scenes.start.choices[0].gives_notes = ['A clue.'];
    campaign.scenes.forest.choices[0].gives_notes = ['A clue.']; // same note
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    const s3 = engine.step(s2.state, '1');
    assert.equal(s3.state.notes.filter((n) => n === 'A clue.').length, 1);
  });
});

// ─── Engine statelesness ──────────────────────────────────────────────────────

describe('Engine statelesness', () => {
  it('two step() calls with the same state return identical output', () => {
    const engine = new GameEngine(makeCampaign());
    const s1 = engine.start();
    const a = engine.step(s1.state, '1');
    const b = engine.step(s1.state, '1');
    assert.equal(a.sceneText, b.sceneText);
    assert.deepEqual(a.state.visited, b.state.visited);
    assert.deepEqual(a.state.inventory, b.state.inventory);
  });
});

// ─── Map deduplication ────────────────────────────────────────────────────────

describe('Map deduplication', () => {
  it('[...new Set(visited)] deduplicates with insertion-order preserved', () => {
    const engine = new GameEngine(makeCampaign());
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1'); // forest
    const s3 = engine.step(s2.state, '1'); // start (revisit)
    // raw visited includes duplicate
    assert.deepEqual(s3.state.visited, ['start', 'forest', 'start']);
    // deduplicated for display
    assert.deepEqual([...new Set(s3.state.visited)], ['start', 'forest']);
  });
});
