/**
 * persistence.test.js — Unit tests for persistence.js
 *
 * Uses an in-memory localStorage mock — no browser environment needed.
 * Run with: node --test persistence.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  saveGame,
  listSaves,
  loadSaveFromStorage,
  deleteSave,
  setStorageForTesting,
  loadSaveFromFile,
} from './persistence.js';
import { PlayerState } from './state.js';

// ─── In-memory localStorage mock ─────────────────────────────────────────────

function makeStorageMock(initialData = {}) {
  const store = { ...initialData };
  return {
    _store: store,
    getItem(key) { return key in store ? store[key] : null; },
    setItem(key, value) {
      if (this._throwOnSet) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      store[key] = String(value);
    },
    removeItem(key) { delete store[key]; },
    get length() { return Object.keys(store).length; },
    key(i) { return Object.keys(store)[i] ?? null; },
    _throwOnSet: false,
  };
}

function makeState(overrides = {}) {
  return new PlayerState({
    sceneId: 'forest',
    inventory: ['lantern'],
    attributes: { health: 75 },
    visited: ['start', 'forest'],
    notes: ['A clue.'],
    ...overrides,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('saveGame() + loadSaveFromStorage()', () => {
  beforeEach(() => {
    setStorageForTesting(makeStorageMock());
  });

  it('serialises correctly; loadSaveFromStorage() deserialises to matching PlayerState', async () => {
    const state = makeState();
    await saveGame('TheDarkForest', state);

    const saves = await listSaves();
    assert.equal(saves.length, 1);

    const { campaignName, state: loaded } = loadSaveFromStorage(saves[0].key);
    assert.equal(campaignName, 'TheDarkForest');
    assert.equal(loaded.sceneId, 'forest');
    assert.deepEqual(loaded.inventory, ['lantern']);
    assert.equal(loaded.attributes.health, 75);
    assert.deepEqual(loaded.visited, ['start', 'forest']);
    assert.deepEqual(loaded.notes, ['A clue.']);
  });

  it('save payload matches Python format (snake_case keys)', async () => {
    const storage = makeStorageMock();
    setStorageForTesting(storage);
    const state = makeState();
    await saveGame('TestCampaign', state);

    const key = Object.keys(storage._store)[0];
    const data = JSON.parse(storage._store[key]);
    assert.ok('scene_id' in data);
    assert.ok('saved_at' in data);
    assert.ok('campaign' in data);
    assert.equal(data.campaign, 'TestCampaign');
    assert.equal(data.scene_id, 'forest');
  });
});

describe('listSaves()', () => {
  beforeEach(() => {
    setStorageForTesting(makeStorageMock());
  });

  it('returns saves sorted newest-first', async () => {
    // Insert fake saves with different timestamps
    const storage = makeStorageMock({
      'adventure_saves:A:20260101_120000': JSON.stringify({
        campaign: 'A', saved_at: '2026-01-01T12:00:00.000Z', scene_id: 'x',
        inventory: [], health: null, visited: [], notes: [],
      }),
      'adventure_saves:B:20260102_120000': JSON.stringify({
        campaign: 'B', saved_at: '2026-01-02T12:00:00.000Z', scene_id: 'y',
        inventory: [], health: null, visited: [], notes: [],
      }),
    });
    setStorageForTesting(storage);

    const saves = await listSaves();
    assert.equal(saves.length, 2);
    assert.equal(saves[0].campaign, 'B'); // newest first
    assert.equal(saves[1].campaign, 'A');
  });

  it('key field is accepted by loadSaveFromStorage()', async () => {
    const state = makeState({ health: null });
    await saveGame('MyCampaign', state);
    const saves = await listSaves();
    assert.ok(saves.length > 0);
    const { campaignName } = loadSaveFromStorage(saves[0].key);
    assert.equal(campaignName, 'MyCampaign');
  });

  it('ignores non-save localStorage keys', async () => {
    const storage = makeStorageMock({
      'some_other_key': 'some value',
      'adventure_saves:X:20260101_000000': JSON.stringify({
        campaign: 'X', saved_at: '2026-01-01T00:00:00.000Z', scene_id: 'a',
        inventory: [], health: null, visited: [], notes: [],
      }),
    });
    setStorageForTesting(storage);
    const saves = await listSaves();
    assert.equal(saves.length, 1);
  });
});

describe('Quota warnings', () => {
  it('returns quotaWarning: "soft" when usage >= 70%', async () => {
    // Pre-fill storage with data that takes up ~72% of 5MB
    const store = {};
    const filler = 'x'.repeat(1000);
    // 3,800 keys × 1000 chars ≈ 3.8M / 5.24M ≈ 72.5%
    for (let i = 0; i < 3800; i++) {
      const k = `filler_${i}`;
      store[k] = filler;
    }
    const storage = makeStorageMock(store);
    setStorageForTesting(storage);

    const state = makeState();
    const result = await saveGame('Test', state);
    assert.equal(result.ok, true);
    assert.equal(result.quotaWarning, 'soft');
  });

  it('returns quotaWarning: "hard" when usage >= 90%', async () => {
    const store = {};
    const filler = 'x'.repeat(1000);
    // 4,800 keys × 1000 chars ≈ 4.8M / 5.24M ≈ 91.6%
    for (let i = 0; i < 4800; i++) {
      const k = `filler_${i}`;
      store[k] = filler;
    }
    const storage = makeStorageMock(store);
    setStorageForTesting(storage);

    const state = makeState();
    const result = await saveGame('Test', state);
    assert.equal(result.ok, true);
    assert.equal(result.quotaWarning, 'hard');
  });

  it('returns { ok: false, quotaWarning: "exceeded" } on write failure', async () => {
    const storage = makeStorageMock();
    storage._throwOnSet = true;
    setStorageForTesting(storage);

    const state = makeState();
    const result = await saveGame('Test', state);
    assert.equal(result.ok, false);
    assert.equal(result.quotaWarning, 'exceeded');
  });

  it('returns null quotaWarning when well under quota', async () => {
    setStorageForTesting(makeStorageMock());
    const state = makeState();
    const result = await saveGame('Test', state);
    assert.equal(result.ok, true);
    assert.equal(result.quotaWarning, null);
  });
});

describe('loadSaveFromFile()', () => {
  it('returns correct structure for a valid save', async () => {
    const data = {
      campaign: 'TheDarkForest',
      saved_at: '2026-01-01T00:00:00.000Z',
      scene_id: 'hermit_camp',
      inventory: ['lantern'],
      health: 75,
      visited: ['start', 'hermit_camp'],
      notes: [],
    };

    // Mock a File object using Blob-like structure
    const mockFile = {
      text: async () => JSON.stringify(data),
    };

    const { campaignName, state } = await loadSaveFromFile(mockFile);
    assert.equal(campaignName, 'TheDarkForest');
    assert.equal(state.sceneId, 'hermit_camp');
    assert.deepEqual(state.inventory, ['lantern']);
  });

  it('throws for a file missing required keys', async () => {
    const mockFile = {
      text: async () => JSON.stringify({ scene_id: 'x' }), // missing campaign + inventory
    };
    await assert.rejects(
      () => loadSaveFromFile(mockFile),
      (e) => e.message.includes("missing required field: 'campaign'")
    );
  });

  it('throws for invalid JSON', async () => {
    const mockFile = { text: async () => 'not json {{' };
    await assert.rejects(
      () => loadSaveFromFile(mockFile),
      (e) => e.message.includes('invalid JSON')
    );
  });
});

describe('deleteSave()', () => {
  beforeEach(() => {
    setStorageForTesting(makeStorageMock());
  });

  it('removes the save from storage', async () => {
    const state = makeState();
    await saveGame('Test', state);
    const saves = await listSaves();
    assert.equal(saves.length, 1);

    deleteSave(saves[0].key);
    const after = await listSaves();
    assert.equal(after.length, 0);
  });
});
