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
      inventory: [],
    },
    attributes: { health: { value: 100, min: 0 } },
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
    recipes: [],
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

  it('lethal on_enter damage with no condition just clamps health and continues', () => {
    const campaign = makeCampaign();
    campaign.scenes.start.on_enter = { affect_attributes: { health: -200 } };
    const engine = new GameEngine(campaign);
    const output = engine.start();
    assert.equal(output.isTerminal, false);
    assert.equal(output.state.attributes.health, 0);
  });

  it('resumes from initialState at the correct scene', () => {
    const engine = new GameEngine(makeCampaign());
    const saved = new PlayerState({
      sceneId: 'forest',
      inventory: [],
      attributes: { health: 80 },
      visited: ['start', 'forest'],
      notes: [],
    });
    const output = engine.start(saved);
    assert.equal(output.sceneText, 'You are in the forest.');
    assert.equal(output.state.attributes.health, 80);
  });

  it('start(initialState) re-fires on_enter; item grants are deduplicated', () => {
    const campaign = makeCampaign();
    campaign.scenes.forest.on_enter = { gives_items: ['magic herb'] };
    const engine = new GameEngine(campaign);
    const saved = new PlayerState({
      sceneId: 'forest',
      inventory: ['magic herb'], // already held
      attributes: { health: 100 },
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

// ─── Attribute conditions ─────────────────────────────────────────────────────

describe('Attribute conditions', () => {
  it('no condition: lethal damage just clamps health and advances to next scene', () => {
    const campaign = makeCampaign();
    campaign.scenes.start.choices = [
      { label: 'Take damage', next: 'forest', affect_attributes: { health: -200 } },
    ];
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.equal(s2.isTerminal, false);
    assert.equal(s2.state.attributes.health, 0);
    assert.equal(s2.sceneText, 'You are in the forest.');
  });

  it('condition scene redirects instead of advancing to choice.next', () => {
    const campaign = makeCampaign({
      attributes: { health: { value: 100, min: 0, conditions: [{ when: '<= 0', scene: 'game_over' }] } },
      scenes: {
        start: {
          text: 'Start.',
          choices: [{ label: 'Die', next: 'forest', affect_attributes: { health: -200 } }],
        },
        forest: { text: 'Forest.', end: true },
        game_over: { text: 'You collapsed.', end: true },
      },
    });
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.equal(s2.sceneText, 'You collapsed.');
    assert.equal(s2.isTerminal, true);
    assert.equal(s2.terminalReason, 'end');
    assert.equal(s2.state.sceneId, 'game_over');
  });

  it('condition message appears in messages when threshold reached', () => {
    const campaign = makeCampaign({
      attributes: { health: { value: 100, min: 0, conditions: [{ when: '<= 0', message: 'You are defeated.' }] } },
    });
    campaign.scenes.start.choices = [
      { label: 'Take damage', next: 'forest', affect_attributes: { health: -200 } },
    ];
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.equal(s2.isTerminal, false);
    assert.ok(s2.messages.includes('You are defeated.'));
  });

  it('on_enter condition redirect works', () => {
    const campaign = makeCampaign({
      attributes: { health: { value: 100, min: 0, conditions: [{ when: '<= 0', scene: 'dead_end' }] } },
      scenes: {
        start: {
          text: 'Start.',
          choices: [{ label: 'Go', next: 'trap' }],
        },
        trap: {
          text: 'A trap!',
          on_enter: { affect_attributes: { health: -200 } },
          choices: [{ label: 'Back', next: 'start' }],
        },
        dead_end: { text: 'Your journey ends here.', end: true },
      },
    });
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.equal(s2.sceneText, 'Your journey ends here.');
    assert.equal(s2.state.sceneId, 'dead_end');
  });

  it('condition target can be a non-terminal scene with choices', () => {
    const campaign = makeCampaign({
      attributes: { health: { value: 100, min: 0, conditions: [{ when: '<= 0', scene: 'revival' }] } },
      scenes: {
        start: {
          text: 'Start.',
          choices: [{ label: 'Die', next: 'forest', affect_attributes: { health: -200 } }],
        },
        forest: { text: 'Forest.', end: true },
        revival: {
          text: 'You awaken somewhere new.',
          choices: [{ label: 'Continue', next: 'forest' }],
        },
      },
    });
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.equal(s2.sceneText, 'You awaken somewhere new.');
    assert.equal(s2.isTerminal, false);
    assert.deepEqual(s2.choices, ['Continue']);
  });

  it('upper-bound condition redirects when max is reached', () => {
    const campaign = makeCampaign({
      attributes: { power: { value: 5, max: 10, conditions: [{ when: '>= 10', scene: 'ascend' }] } },
      scenes: {
        start: {
          text: 'Start.',
          choices: [{ label: 'Power up', next: 'forest', affect_attributes: { power: 10 } }],
        },
        forest: { text: 'Forest.', end: true },
        ascend: { text: 'You ascended.', end: true },
      },
    });
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.equal(s2.sceneText, 'You ascended.');
    assert.equal(s2.state.sceneId, 'ascend');
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

// ─── Assets — Phase 2 ─────────────────────────────────────────────────────────

function makeCampaignWithAssets(overrides = {}) {
  return {
    metadata: { title: 'Test', start: 'start', attributes: {}, inventory: [] },
    scenes: {
      start: {
        text: 'You are at the start.',
        assets: { image: 'shore_img', music: 'calm_music' },
        choices: [{ label: 'Go forward', next: 'forest' }],
      },
      forest: {
        text: 'You are in the forest.',
        choices: [{ label: 'Return', next: 'start' }],
      },
    },
    items: {},
    recipes: [],
    assets: {
      images: { shore_img: 'assets/shore.jpg' },
      music: { calm_music: 'assets/calm.mp3' },
      sfx: { step: 'assets/step.mp3', click: 'assets/click.mp3' },
    },
    ...overrides,
  };
}

describe('Assets — GameOutput defaults', () => {
  it('output.assets defaults to {} when scene has no assets block', () => {
    const campaign = makeCampaignWithAssets();
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1'); // forest has no assets block
    assert.deepEqual(s2.assets, {});
  });

  it('output.sfx defaults to [] when no gives_sfx', () => {
    const engine = new GameEngine(makeCampaignWithAssets());
    const output = engine.start();
    assert.deepEqual(output.sfx, []);
  });
});

describe('Assets — _resolveAssets', () => {
  it('resolves image and music keys to URLs', () => {
    const engine = new GameEngine(makeCampaignWithAssets());
    const output = engine.start();
    assert.equal(output.assets.image, 'assets/shore.jpg');
    assert.equal(output.assets.music, 'assets/calm.mp3');
  });

  it('"none" sentinel resolves to null for image', () => {
    const campaign = makeCampaignWithAssets();
    campaign.scenes.start.assets = { image: 'none', music: 'calm_music' };
    const engine = new GameEngine(campaign);
    const output = engine.start();
    assert.equal(output.assets.image, null);
    assert.equal(output.assets.music, 'assets/calm.mp3');
  });

  it('"none" sentinel resolves to null for music', () => {
    const campaign = makeCampaignWithAssets();
    campaign.scenes.start.assets = { image: 'shore_img', music: 'none' };
    const engine = new GameEngine(campaign);
    const output = engine.start();
    assert.equal(output.assets.image, 'assets/shore.jpg');
    assert.equal(output.assets.music, null);
  });

  it('JS null resolves to null (programmatic clear)', () => {
    const campaign = makeCampaignWithAssets();
    campaign.scenes.start.assets = { image: null };
    const engine = new GameEngine(campaign);
    const output = engine.start();
    assert.equal(output.assets.image, null);
  });

  it('absent image key is not present in resolved assets', () => {
    const campaign = makeCampaignWithAssets();
    campaign.scenes.start.assets = { music: 'calm_music' }; // no image
    const engine = new GameEngine(campaign);
    const output = engine.start();
    assert.equal('image' in output.assets, false);
    assert.equal(output.assets.music, 'assets/calm.mp3');
  });
});

describe('Assets — _resolveSfxKeys', () => {
  it('sfx from choice gives_sfx (single key)', () => {
    const campaign = makeCampaignWithAssets();
    campaign.scenes.start.choices[0].gives_sfx = 'step';
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.deepEqual(s2.sfx, ['assets/step.mp3']);
  });

  it('sfx from choice gives_sfx (array of keys)', () => {
    const campaign = makeCampaignWithAssets();
    campaign.scenes.start.choices[0].gives_sfx = ['step', 'click'];
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.deepEqual(s2.sfx, ['assets/step.mp3', 'assets/click.mp3']);
  });

  it('sfx from on_enter gives_sfx', () => {
    const campaign = makeCampaignWithAssets();
    campaign.scenes.forest.on_enter = { gives_sfx: 'click' };
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.deepEqual(s2.sfx, ['assets/click.mp3']);
  });

  it('choice sfx and on_enter sfx are concatenated in order', () => {
    const campaign = makeCampaignWithAssets();
    campaign.scenes.start.choices[0].gives_sfx = 'step';
    campaign.scenes.forest.on_enter = { gives_sfx: 'click' };
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.deepEqual(s2.sfx, ['assets/step.mp3', 'assets/click.mp3']);
  });
});

describe('Assets — all GameOutput paths carry assets', () => {
  it('terminal (end) scene carries assets', () => {
    const campaign = makeCampaignWithAssets();
    campaign.scenes.start.choices = [{ label: 'End', next: 'ending' }];
    campaign.scenes.ending = {
      text: 'The end.',
      end: true,
      assets: { image: 'shore_img' },
    };
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.equal(s2.isTerminal, true);
    assert.equal(s2.terminalReason, 'end');
    assert.equal(s2.assets.image, 'assets/shore.jpg');
  });

  it('noChoices scene carries assets', () => {
    const campaign = makeCampaignWithAssets();
    campaign.scenes.forest.choices = [
      { label: 'Locked', next: 'start', requires_item: 'key' },
    ];
    campaign.scenes.forest.assets = { music: 'calm_music' };
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.equal(s2.noChoices, true);
    assert.equal(s2.assets.music, 'assets/calm.mp3');
  });
});
