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

const LOGICAL_RECURSION_CAP = 10;

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

    // For through scenes, synthesise the single "Continue" choice
    let choicesForStep;
    if (scene.type === 'through') {
      choicesForStep = [{ label: 'Continue', next: scene.next }];
    } else {
      choicesForStep = getAvailableChoices(
        scene.choices ?? [], state.inventory, state.attributes, state.obtainedItems
      );
    }

    // Validate input: must be a whole-number string or integer
    const parsed = Number(playerInput);
    if (!Number.isInteger(parsed)) {
      throw new RangeError(
        `Invalid input: '${playerInput}'. Expected a whole-number choice index.`
      );
    }
    const pick = parsed - 1; // convert to 0-based
    if (pick < 0 || pick >= choicesForStep.length) {
      throw new RangeError(
        `Choice ${playerInput} is out of range (1–${choicesForStep.length} available).`
      );
    }

    const chosen = choicesForStep[pick];
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

    // 4. Boundary check after choice effects
    if (result.triggerScene) {
      // Attribute condition → redirect to linked scene instead of choice.next
      const nextState = state.copy();
      nextState.sceneId = result.triggerScene;
      return this._enterScene(nextState, messages, choiceSfx);
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
   * Applies on_enter events, handles scene types (through/logical),
   * on_revisit, records the visit, filters choices, returns output.
   *
   * @param {PlayerState} state
   * @param {string[]} priorMessages
   * @param {string[]} [priorSfx] - sfx URLs resolved from the triggering choice
   * @param {number} [logicalDepth] - recursion counter for logical scene chains
   * @returns {GameOutput}
   */
  _enterScene(state, priorMessages, priorSfx = [], logicalDepth = 0) {
    const messages = [...priorMessages];
    const scene = this._scenes[state.sceneId];

    // Resolve assets first — before any branching — so all GameOutput paths carry them
    const sceneAssets = this._resolveAssets(scene.assets ?? null);
    const enterSfx = this._resolveSfxKeys(scene.on_enter?.gives_sfx);
    const allSfx = [...priorSfx, ...enterSfx];

    // ── on_revisit check (before on_enter) ────────────────────────────────────
    const alreadyVisited = state.visited.includes(state.sceneId);
    if (alreadyVisited && scene.on_revisit) {
      if (scene.on_revisit.redirect) {
        // Redirect without firing on_enter or recording this scene
        const redirectState = state.copy();
        redirectState.sceneId = scene.on_revisit.redirect;
        return this._enterScene(redirectState, messages, allSfx, logicalDepth);
      }
      // on_revisit.text handled below after on_enter fires
    }

    // ── Apply scene entry events (on_enter) ───────────────────────────────────
    let result = applySceneEvents(scene, state, this._campaign);
    state = result.newState;
    messages.push(...result.messages);

    // Boundary check after on_enter effects
    if (result.triggerScene) {
      // Attribute condition → redirect (cap at one redirect per turn)
      const redirectState = state.copy();
      redirectState.visited.push(state.sceneId); // record this scene before redirecting
      redirectState.sceneId = result.triggerScene;
      return this._enterScene(redirectState, messages, allSfx, logicalDepth);
    }

    // Auto-fire recipes after on_enter item changes
    result = applyRecipes(state, this._campaign.recipes ?? [], this._campaign);
    state = result.newState;
    messages.push(...result.messages);

    // ── Record visit ──────────────────────────────────────────────────────────
    const visitState = state.copy();
    visitState.visited.push(state.sceneId);
    state = visitState;

    // ── Resolve scene text (on_revisit.text override) ─────────────────────────
    const sceneText = (alreadyVisited && scene.on_revisit?.text)
      ? scene.on_revisit.text
      : scene.text;

    // ── Terminal scene ────────────────────────────────────────────────────────
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

    const sceneType = scene.type ?? 'decision';

    // ── Through scene ─────────────────────────────────────────────────────────
    if (sceneType === 'through') {
      return new GameOutput({
        state,
        sceneText,
        choices: ['Continue'],
        messages,
        assets: sceneAssets,
        sfx: allSfx,
        sceneType: 'through',
      });
    }

    // ── Logical scene ─────────────────────────────────────────────────────────
    if (sceneType === 'logical') {
      if (logicalDepth >= LOGICAL_RECURSION_CAP) {
        // Safety cap: render as a decision scene to prevent infinite loops
        const available = getAvailableChoices(
          scene.choices ?? [], state.inventory, state.attributes, state.obtainedItems
        );
        return new GameOutput({
          state,
          sceneText: scene.text ?? '',
          choices: available.map((c) => c.label ?? ''),
          messages,
          noChoices: available.length === 0,
          assets: sceneAssets,
          sfx: allSfx,
        });
      }

      const available = getAvailableChoices(
        scene.choices ?? [], state.inventory, state.attributes, state.obtainedItems
      );

      if (available.length === 0) {
        return new GameOutput({
          state,
          sceneText: scene.text ?? '',
          choices: [],
          messages,
          noChoices: true,
          assets: sceneAssets,
          sfx: allSfx,
        });
      }

      // Auto-select first available choice and apply its full effects
      const chosen = available[0];
      const choiceSfx = this._resolveSfxKeys(chosen.gives_sfx);
      const sfxSoFar = [...allSfx, ...choiceSfx];

      // Apply choice effects (same sequence as step())
      let r = applyItemGrants(chosen, state, this._campaign);
      state = r.newState; messages.push(...r.messages);

      r = applyItemRemovals(chosen, state, this._campaign);
      state = r.newState;

      r = applyRecipes(state, this._campaign.recipes ?? [], this._campaign);
      state = r.newState; messages.push(...r.messages);

      r = applyNoteGrants(chosen, state);
      state = r.newState; messages.push(...r.messages);

      r = applyAttributeEffects(chosen, state, this._campaign);
      state = r.newState; messages.push(...r.messages);

      if (r.triggerScene) {
        const nextState = state.copy();
        nextState.sceneId = r.triggerScene;
        return this._enterScene(nextState, messages, sfxSoFar, logicalDepth + 1);
      }

      const nextState = state.copy();
      nextState.sceneId = chosen.next;
      return this._enterScene(nextState, messages, sfxSoFar, logicalDepth + 1);
    }

    // ── Decision scene (default) ──────────────────────────────────────────────
    const available = getAvailableChoices(
      scene.choices ?? [], state.inventory, state.attributes, state.obtainedItems
    );

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
