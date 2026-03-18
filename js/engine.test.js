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

// ─── Through scenes ────────────────────────────────────────────────────────────

describe('GameEngine — through scenes', () => {
  function makeThroughCampaign(overrides = {}) {
    return {
      metadata: { title: 'T', start: 'start', inventory: [] },
      attributes: { health: { value: 100, min: 0, max: 100 } },
      scenes: {
        start: {
          type: 'through',
          text: 'You walk down the corridor.',
          next: 'chamber',
        },
        chamber: {
          text: 'You arrive at the chamber.',
          choices: [{ label: 'Leave', next: 'end_scene' }],
        },
        end_scene: { text: 'You leave.', end: true },
      },
      items: {},
      recipes: [],
      ...overrides,
    };
  }

  it('through scene produces ["Continue"] choice and sceneType "through"', () => {
    const engine = new GameEngine(makeThroughCampaign());
    const output = engine.start();
    assert.deepEqual(output.choices, ['Continue']);
    assert.equal(output.sceneType, 'through');
    assert.equal(output.sceneText, 'You walk down the corridor.');
  });

  it('step("1") on through scene advances to scene.next', () => {
    const engine = new GameEngine(makeThroughCampaign());
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.equal(s2.sceneText, 'You arrive at the chamber.');
    assert.equal(s2.sceneType, 'decision');
  });

  it('through scene on_enter fires before continue', () => {
    const campaign = makeThroughCampaign();
    campaign.scenes.start.on_enter = { affect_attributes: { health: -10 } };
    const engine = new GameEngine(campaign);
    const output = engine.start();
    assert.equal(output.state.attributes.health, 90);
    assert.deepEqual(output.choices, ['Continue']);
  });

  it('through scene on_enter attribute condition redirect works', () => {
    const campaign = makeThroughCampaign();
    campaign.attributes = { health: { value: 0, min: 0, max: 100, conditions: [{ when: '<= 0', scene: 'chamber' }] } };
    campaign.scenes.start.on_enter = { affect_attributes: { health: -1 } };
    const engine = new GameEngine(campaign);
    const s = PlayerState.fromCampaign(campaign);
    const output = engine.start(s);
    // health 0 triggers condition → redirect to chamber before recording start as through
    assert.equal(output.sceneText, 'You arrive at the chamber.');
  });
});

// ─── Logical scenes ────────────────────────────────────────────────────────────

describe('GameEngine — logical scenes', () => {
  function makeLogicalCampaign() {
    return {
      metadata: { title: 'T', start: 'gate', inventory: [] },
      attributes: {},
      scenes: {
        gate: {
          type: 'logical',
          choices: [
            { next: 'gem_end', requires_items: [{ item: 'gem', is: 'owned' }], gives_items: ['medal'] },
            { next: 'plain_end' },
          ],
        },
        gem_end: { text: 'You won!', end: true },
        plain_end: { text: 'You made it.', end: true },
      },
      items: {},
      recipes: [],
    };
  }

  it('logical scene auto-advances to first available choice', () => {
    const engine = new GameEngine(makeLogicalCampaign());
    const state = PlayerState.fromCampaign(makeLogicalCampaign());
    const output = engine.start(state);
    // No gem → falls through to plain_end
    assert.equal(output.sceneText, 'You made it.');
    assert.equal(output.isTerminal, true);
  });

  it('logical scene selects first matching choice based on requirements', () => {
    const campaign = makeLogicalCampaign();
    const engine = new GameEngine(campaign);
    const state = new PlayerState({
      sceneId: 'gate',
      inventory: ['gem'],
      attributes: {},
      visited: [],
      notes: [],
      obtainedItems: ['gem'],
    });
    const output = engine.start(state);
    assert.equal(output.sceneText, 'You won!');
    assert.equal(output.isTerminal, true);
  });

  it('logical scene applies full effects of auto-selected choice', () => {
    const campaign = makeLogicalCampaign();
    const engine = new GameEngine(campaign);
    const state = new PlayerState({
      sceneId: 'gate',
      inventory: ['gem'],
      attributes: {},
      visited: [],
      notes: [],
      obtainedItems: ['gem'],
    });
    const output = engine.start(state);
    // The first choice gives 'medal'
    assert.ok(output.state.inventory.includes('medal'));
  });

  it('logical scene with all requirements unmet returns noChoices', () => {
    const campaign = makeLogicalCampaign();
    campaign.scenes.gate.choices = [
      { next: 'gem_end', requires_items: [{ item: 'gem', is: 'owned' }] },
    ];
    const engine = new GameEngine(campaign);
    const output = engine.start();
    assert.equal(output.noChoices, true);
  });

  it('logical scene chain (logical → logical → decision) — messages accumulated', () => {
    const campaign = {
      metadata: { title: 'T', start: 'gate1', inventory: [] },
      attributes: {},
      scenes: {
        gate1: {
          type: 'logical',
          on_enter: { message: 'Entering gate1.' },
          choices: [{ next: 'gate2' }],
        },
        gate2: {
          type: 'logical',
          on_enter: { message: 'Entering gate2.' },
          choices: [{ next: 'final' }],
        },
        final: { text: 'Arrived!', choices: [{ label: 'End', next: 'done' }] },
        done: { text: 'Done.', end: true },
      },
      items: {},
      recipes: [],
    };
    const engine = new GameEngine(campaign);
    const output = engine.start();
    assert.equal(output.sceneText, 'Arrived!');
    // Messages from both on_enter blocks accumulated
    assert.ok(output.messages.includes('Entering gate1.'));
    assert.ok(output.messages.includes('Entering gate2.'));
  });
});

// ─── on_revisit ────────────────────────────────────────────────────────────────

describe('GameEngine — on_revisit', () => {
  function makeRevisitCampaign() {
    return {
      metadata: { title: 'T', start: 'start', inventory: [] },
      attributes: {},
      scenes: {
        start: {
          text: 'You are at the start.',
          choices: [{ label: 'Go to room', next: 'room' }],
        },
        room: {
          text: 'A treasure room full of gold.',
          on_revisit: { text: 'The room is already looted.' },
          choices: [{ label: 'Back', next: 'start' }],
        },
      },
      items: {},
      recipes: [],
    };
  }

  it('first visit uses scene.text, not on_revisit.text', () => {
    const engine = new GameEngine(makeRevisitCampaign());
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1');
    assert.equal(s2.sceneText, 'A treasure room full of gold.');
  });

  it('revisit uses on_revisit.text', () => {
    const engine = new GameEngine(makeRevisitCampaign());
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1'); // first visit to room
    const s3 = engine.step(s2.state, '1'); // back to start
    const s4 = engine.step(s3.state, '1'); // revisit room
    assert.equal(s4.sceneText, 'The room is already looted.');
  });

  it('scene without on_revisit behaves normally on revisit', () => {
    const engine = new GameEngine(makeRevisitCampaign());
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1'); // first visit to room
    const s3 = engine.step(s2.state, '1'); // back to start (second visit — no on_revisit)
    // start has no on_revisit — second visit shows original text
    assert.equal(s3.sceneText, 'You are at the start.');
  });

  it('on_revisit.redirect — redirected on revisit, on_enter not fired on original', () => {
    const campaign = {
      metadata: { title: 'T', start: 'start', inventory: [] },
      attributes: {},
      scenes: {
        start: {
          text: 'Start.',
          choices: [{ label: 'Go to bridge', next: 'bridge' }],
        },
        bridge: {
          text: 'A rickety bridge.',
          on_enter: { message: 'Bridge creaking.' },
          on_revisit: { redirect: 'collapsed' },
          choices: [{ label: 'Cross', next: 'far_side' }],
        },
        far_side: { text: 'Far side.', choices: [{ label: 'Back to start', next: 'start' }] },
        collapsed: { text: 'The bridge has collapsed.', end: true },
      },
      items: {},
      recipes: [],
    };
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1'); // go to bridge (first visit)
    const s3 = engine.step(s2.state, '1'); // cross to far side
    const s4 = engine.step(s3.state, '1'); // back to start
    const s5 = engine.step(s4.state, '1'); // revisit bridge → redirect to collapsed
    assert.equal(s5.sceneText, 'The bridge has collapsed.');
    assert.equal(s5.isTerminal, true);
  });

  it('on_revisit redirect target records its own visit', () => {
    const campaign = {
      metadata: { title: 'T', start: 'start', inventory: [] },
      attributes: {},
      scenes: {
        start: { text: 'Start.', choices: [{ label: 'Go', next: 'hub' }] },
        hub: {
          text: 'Hub.',
          on_revisit: { redirect: 'alt' },
          choices: [{ label: 'Back', next: 'start' }],
        },
        alt: { text: 'Alt.', choices: [{ label: 'Back', next: 'start' }] },
      },
      items: {},
      recipes: [],
    };
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1'); // visit hub
    const s3 = engine.step(s2.state, '1'); // back to start
    const s4 = engine.step(s3.state, '1'); // revisit hub → redirect to alt
    assert.ok(s4.state.visited.includes('alt'));
  });
});

// ─── obtainedItems integration ────────────────────────────────────────────────

describe('GameEngine — obtainedItems integration', () => {
  it('obtain item → remove it → is: "obtained" choice still visible', () => {
    const campaign = {
      metadata: { title: 'T', start: 'start', inventory: [] },
      attributes: {},
      scenes: {
        start: {
          text: 'Start.',
          choices: [
            { label: 'Take key', next: 'took_key', gives_items: ['key'] },
          ],
        },
        took_key: {
          text: 'Took key.',
          choices: [
            { label: 'Use key', next: 'used_key', removes_items: ['key'] },
          ],
        },
        used_key: {
          text: 'Used key.',
          choices: [
            { label: 'Tell story', next: 'story', requires_items: [{ item: 'key', is: 'obtained' }] },
            { label: 'Walk away', next: 'end_scene' },
          ],
        },
        story: { text: 'You tell the story.', end: true },
        end_scene: { text: 'You leave.', end: true },
      },
      items: {},
      recipes: [],
    };
    const engine = new GameEngine(campaign);
    const s1 = engine.start();
    const s2 = engine.step(s1.state, '1'); // take key
    const s3 = engine.step(s2.state, '1'); // use (remove) key
    // At used_key: key obtained but not owned → 'Tell story' should appear
    assert.deepEqual(s3.choices, ['Tell story', 'Walk away']);
  });

  it('is_not: "obtained" hides choice once item has been obtained', () => {
    const campaign = {
      metadata: { title: 'T', start: 'start', inventory: [] },
      attributes: {},
      scenes: {
        start: {
          text: 'Start.',
          choices: [
            { label: 'Pick up gem', next: 'has_gem', gives_items: ['gem'],
              requires_items: [{ item: 'gem', is_not: 'obtained' }] },
            { label: 'Continue', next: 'has_gem' },
          ],
        },
        has_gem: { text: 'Gem room.', choices: [{ label: 'Back', next: 'start' }] },
      },
      items: {},
      recipes: [],
    };
    const engine = new GameEngine(campaign);
    // First visit: both choices visible
    const s1 = engine.start();
    assert.deepEqual(s1.choices, ['Pick up gem', 'Continue']);

    // After obtaining gem, back to start — 'Pick up gem' hidden
    const s2 = engine.step(s1.state, '1');  // pick up gem
    const s3 = engine.step(s2.state, '1');  // back to start
    assert.deepEqual(s3.choices, ['Continue']);
  });
});
