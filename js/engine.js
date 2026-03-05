/**
 * engine.js — The core game engine as a pure state machine.
 *
 * GameEngine is stateless: it holds only the immutable campaign dict.
 * All mutable state lives in PlayerState, which callers own between turns.
 *
 * Public API:
 *   const engine = new GameEngine(campaign);
 *   const output = engine.start();                   // first turn
 *   const output = engine.start(initialState);        // resume from save
 *   const output = engine.step(state, playerInput);  // advance one turn
 *
 * The engine never calls console.log, alert(), or touches the DOM.
 */

import { getAvailableChoices } from './choices.js';
import {
  applyAttributeEffects,
  applyItemGrants,
  applyItemRemovals,
  applyNoteGrants,
  applyRecipes,
  applySceneEvents,
} from './events.js';
import { GameOutput, PlayerState } from './state.js';

export class GameEngine {
  /**
   * @param {{ metadata: object, scenes: object, items: object, recipes: object[], assets: object }} campaign
   */
  constructor(campaign) {
    this._campaign = campaign;
    this._scenes = campaign.scenes;
    this._metadata = campaign.metadata;
  }

  /**
   * Produce the first GameOutput for a session.
   *
   * If initialState is provided (e.g. loaded from a save file), that state
   * is used directly. Otherwise the campaign's metadata seeds the session.
   *
   * @param {PlayerState|null} [initialState]
   * @returns {GameOutput}
   */
  start(initialState = null) {
    const state = initialState ?? PlayerState.fromCampaign(this._campaign);
    return this._enterScene(state, []);
  }

  /**
   * Advance the game by one turn.
   *
   * @param {PlayerState} state - state from previous start() or step()
   * @param {string|number} playerInput - 1-based choice index (e.g. "1" or 1)
   * @returns {GameOutput}
   * @throws {RangeError} if playerInput is not a valid whole-number index
   */
  step(state, playerInput) {
    const scene = this._scenes[state.sceneId];
    const available = getAvailableChoices(scene.choices ?? [], state.inventory);

    // Validate input: must be a whole-number string or integer
    const parsed = Number(playerInput);
    if (!Number.isInteger(parsed)) {
      throw new RangeError(
        `Invalid input: '${playerInput}'. Expected a whole-number choice index.`
      );
    }
    const pick = parsed - 1; // convert to 0-based
    if (pick < 0 || pick >= available.length) {
      throw new RangeError(
        `Choice ${playerInput} is out of range (1–${available.length} available).`
      );
    }

    const chosen = available[pick];
    const choiceSfx = this._resolveSfxKeys(chosen.gives_sfx);
    let messages = [];

    // 1. Apply item grants
    let result = applyItemGrants(chosen, state, this._campaign);
    state = result.newState;
    messages.push(...result.messages);

    // 1.5 Apply item removals
    result = applyItemRemovals(chosen, state, this._campaign);
    state = result.newState;

    // 1.6 Auto-fire recipes after item changes
    result = applyRecipes(state, this._campaign.recipes ?? [], this._campaign);
    state = result.newState;
    messages.push(...result.messages);

    // 2. Apply note grants
    result = applyNoteGrants(chosen, state);
    state = result.newState;
    messages.push(...result.messages);

    // 3. Apply choice attribute effects
    result = applyAttributeEffects(chosen, state, this._campaign);
    state = result.newState;
    messages.push(...result.messages);

    // 4. Death check after choice effects
    if (result.died) {
      const currentScene = this._scenes[state.sceneId];
      const currentAssets = this._resolveAssets(currentScene.assets ?? null);
      return new GameOutput({
        state,
        sceneText: '',
        choices: [],
        messages,
        isTerminal: true,
        terminalReason: 'death',
        deathMessage: result.deathMessage,
        assets: currentAssets,
        sfx: choiceSfx,
      });
    }

    // 5. Advance to the next scene
    const nextState = state.copy();
    nextState.sceneId = chosen.next;

    // 6–10 via _enterScene
    return this._enterScene(nextState, messages, choiceSfx);
  }

  /**
   * Build a GameOutput for arriving at state.sceneId.
   *
   * Applies on_enter events (step 6), records the visit (step 7),
   * performs death check (step 8), filters choices (step 9), returns output.
   *
   * @param {PlayerState} state
   * @param {string[]} priorMessages
   * @param {string[]} [priorSfx] - sfx URLs resolved from the triggering choice
   * @returns {GameOutput}
   */
  _enterScene(state, priorMessages, priorSfx = []) {
    const messages = [...priorMessages];
    const scene = this._scenes[state.sceneId];

    // Resolve assets first — before any branching — so all GameOutput paths carry them
    const sceneAssets = this._resolveAssets(scene.assets ?? null);
    const enterSfx = this._resolveSfxKeys(scene.on_enter?.gives_sfx);
    const allSfx = [...priorSfx, ...enterSfx];

    // 6. Apply scene entry events (on_enter)
    let result = applySceneEvents(scene, state, this._campaign);
    state = result.newState;
    messages.push(...result.messages);

    // 6.5 Death check after on_enter effects
    if (result.died) {
      return new GameOutput({
        state,
        sceneText: scene.text,
        choices: [],
        messages,
        isTerminal: true,
        terminalReason: 'death',
        deathMessage: result.deathMessage,
        assets: sceneAssets,
        sfx: allSfx,
      });
    }

    // 6.6 Auto-fire recipes after on_enter item changes
    result = applyRecipes(state, this._campaign.recipes ?? [], this._campaign);
    state = result.newState;
    messages.push(...result.messages);

    // 7. Record visit
    const visitState = state.copy();
    visitState.visited.push(state.sceneId);
    state = visitState;

    const sceneText = scene.text;

    // Terminal scene (end: true)
    if (scene.end) {
      return new GameOutput({
        state,
        sceneText,
        choices: [],
        messages,
        isTerminal: true,
        terminalReason: 'end',
        assets: sceneAssets,
        sfx: allSfx,
      });
    }

    // 8. Filter available choices
    const available = getAvailableChoices(scene.choices ?? [], state.inventory);

    if (available.length === 0) {
      return new GameOutput({
        state,
        sceneText,
        choices: [],
        messages,
        isTerminal: false,
        noChoices: true,
        assets: sceneAssets,
        sfx: allSfx,
      });
    }

    const choiceLabels = available.map((c) => c.label);

    return new GameOutput({
      state,
      sceneText,
      choices: choiceLabels,
      messages,
      assets: sceneAssets,
      sfx: allSfx,
    });
  }

  /**
   * Resolve a scene's asset references to concrete URLs.
   *
   * - null/absent sceneAssetBlock  → returns {} (UI treats absent keys as clear)
   * - key with value 'none' or JS null → resolved[key] = null (intentional clear)
   * - key with a string value → looks up registry; undefined if not found (warns)
   *
   * @param {object|null} sceneAssetBlock
   * @returns {{ image?: string|null, music?: string|null }}
   */
  _resolveAssets(sceneAssetBlock) {
    if (!sceneAssetBlock) return {};

    const registry = this._campaign.assets ?? {};
    const resolved = {};

    if ('image' in sceneAssetBlock) {
      const raw = sceneAssetBlock.image;
      const isExplicitClear = raw === 'none' || raw === null;
      if (isExplicitClear) {
        resolved.image = null;
      } else {
        resolved.image = registry.images?.[raw];
        if (resolved.image === undefined) {
          console.warn(`[engine] assets.images key not found: "${raw}"`);
        }
      }
    }

    if ('music' in sceneAssetBlock) {
      const raw = sceneAssetBlock.music;
      const isExplicitClear = raw === 'none' || raw === null;
      if (isExplicitClear) {
        resolved.music = null;
      } else {
        resolved.music = registry.music?.[raw];
        if (resolved.music === undefined) {
          console.warn(`[engine] assets.music key not found: "${raw}"`);
        }
      }
    }

    return resolved;
  }

  /**
   * Resolve gives_sfx key(s) to concrete URLs from the sfx registry.
   * Accepts a single key string, an array of key strings, or null/undefined.
   * Returns an array of resolved URL strings (unknown keys are warned and skipped).
   *
   * @param {string|string[]|null|undefined} gives
   * @returns {string[]}
   */
  _resolveSfxKeys(gives) {
    if (!gives) return [];
    const keys = Array.isArray(gives) ? gives : [gives];
    const registry = this._campaign.assets?.sfx ?? {};
    return keys.flatMap(key => {
      const url = registry[key];
      if (!url) {
        console.warn(`[engine] assets.sfx key not found: "${key}"`);
        return [];
      }
      return [url];
    });
  }
}
