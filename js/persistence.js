/**
 * persistence.js — Save state management backed by localStorage.
 *
 * Direct JS port of adventure/persistence.py, adapted for the browser.
 *
 * This module has no DOM access and no knowledge of the currently loaded
 * campaign. It operates purely on PlayerState dicts and localStorage.
 *
 * All functions that may be extended to async backends (IndexedDB, remote)
 * are declared async, even though the v1 body is synchronous.
 */

import { PlayerState } from './state.js';

// localStorage key prefix for save entries
const SAVES_PREFIX = 'adventure_saves:';

// Conservative localStorage capacity cap (5 MB expressed as characters).
// Treats each character as one byte — underestimates UTF-16 storage but
// is a consistent baseline that matches the design spec.
const QUOTA_CAP = 5_242_880;
const SOFT_THRESHOLD = 0.70;
const HARD_THRESHOLD = 0.90;

/**
 * Serialise PlayerState to JSON and write to localStorage.
 *
 * @param {string} campaignName - folder/ZIP name (used in key and payload)
 * @param {PlayerState} state
 * @param {string} [savesKey] - localStorage key prefix (unused in v1; kept for API compat)
 * @returns {Promise<{ ok: boolean, quotaWarning: null|'soft'|'hard'|'exceeded' }>}
 */
export async function saveGame(campaignName, state, savesKey = SAVES_PREFIX) {
  const now = new Date();
  const timestamp = formatTimestamp(now);
  const isoTimestamp = now.toISOString();

  const payload = {
    campaign: campaignName,
    saved_at: isoTimestamp,
    scene_id: state.sceneId,
    inventory: [...state.inventory],
    health: state.health,
    visited: [...state.visited],
    notes: [...state.notes],
  };

  const keyName = escapeCampaignName(campaignName);
  const key = `${SAVES_PREFIX}${keyName}:${timestamp}`;
  const value = JSON.stringify(payload);

  // Estimate quota usage before writing
  const { usage, capacity } = estimateLocalStorageUsage();
  const afterUsage = usage + key.length + value.length;
  const ratio = afterUsage / capacity;

  try {
    getStorage().setItem(key, value);
  } catch {
    return { ok: false, quotaWarning: 'exceeded' };
  }

  let quotaWarning = null;
  if (ratio >= HARD_THRESHOLD) quotaWarning = 'hard';
  else if (ratio >= SOFT_THRESHOLD) quotaWarning = 'soft';

  return { ok: true, quotaWarning };
}

/**
 * Return save metadata sorted newest-first.
 *
 * @param {string} [savesKey] - unused in v1; kept for API compat
 * @returns {Promise<{ key: string, campaign: string, saved_at: string, scene_id: string }[]>}
 */
export async function listSaves(savesKey = SAVES_PREFIX) {
  const storage = getStorage();
  const saves = [];

  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(SAVES_PREFIX)) continue;

    try {
      const raw = storage.getItem(key);
      const data = JSON.parse(raw);
      saves.push({
        key,
        campaign: data.campaign,
        saved_at: data.saved_at,
        scene_id: data.scene_id,
      });
    } catch {
      // Skip malformed saves
    }
  }

  // Sort newest-first
  saves.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  return saves;
}

/**
 * Retrieve and deserialise a save from localStorage by its key.
 *
 * @param {string} saveKey - exact localStorage key (from listSaves())
 * @returns {{ campaignName: string, state: PlayerState }}
 * @throws {Error} if key does not exist or JSON is malformed
 */
export function loadSaveFromStorage(saveKey) {
  const raw = getStorage().getItem(saveKey);
  if (raw == null) {
    throw new Error(`Save not found: '${saveKey}'`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Malformed save data for key '${saveKey}'`);
  }

  const campaignName = data.campaign;
  const state = PlayerState.fromDict(data);
  return { campaignName, state };
}

/**
 * Delete a save from localStorage by its exact key.
 *
 * @param {string} saveKey
 */
export function deleteSave(saveKey) {
  getStorage().removeItem(saveKey);
}

/**
 * Trigger a browser download of a .json save file.
 *
 * Called on quota failure, or when the player clicks [Download] in the Load modal.
 * NOT called automatically on a successful [Save].
 *
 * @param {PlayerState} state
 * @param {string} campaignName
 */
export function downloadSave(state, campaignName) {
  const now = new Date();
  const timestamp = formatTimestamp(now);
  const isoTimestamp = now.toISOString();

  const payload = {
    campaign: campaignName,
    saved_at: isoTimestamp,
    scene_id: state.sceneId,
    inventory: [...state.inventory],
    health: state.health,
    visited: [...state.visited],
    notes: [...state.notes],
  };

  const filename = `${campaignName}_${timestamp}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Read a .json File object and return the deserialised save.
 *
 * Does NOT validate scene_id against the loaded campaign — that is ui.js's
 * responsibility after receiving the result.
 *
 * @param {File} file
 * @returns {Promise<{ campaignName: string, state: PlayerState }>}
 * @throws {Error} if the file is malformed or missing required keys
 */
export async function loadSaveFromFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Could not parse save file: invalid JSON.');
  }

  // Validate required keys
  const required = ['campaign', 'scene_id', 'inventory'];
  for (const key of required) {
    if (!(key in data)) {
      throw new Error(`Save file is missing required field: '${key}'`);
    }
  }

  const campaignName = data.campaign;
  const state = PlayerState.fromDict(data);
  return { campaignName, state };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Return the storage object to use. Uses globalThis.localStorage in the browser;
 * can be overridden via setStorageForTesting() in tests.
 */
let _storage = null;

export function setStorageForTesting(mock) {
  _storage = mock;
}

function getStorage() {
  return _storage ?? globalThis.localStorage;
}

/**
 * Estimate current localStorage usage by summing key + value lengths.
 */
function estimateLocalStorageUsage() {
  const storage = getStorage();
  let usage = 0;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key) {
      usage += key.length + (storage.getItem(key)?.length ?? 0);
    }
  }
  return { usage, capacity: QUOTA_CAP };
}

/**
 * Format a Date as YYYYMMDD_HHMMSS — matches the Python CLI filename format.
 */
function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Escape colons in campaign name to keep localStorage keys unambiguously parseable.
 */
function escapeCampaignName(name) {
  return name.replace(/:/g, '_');
}
