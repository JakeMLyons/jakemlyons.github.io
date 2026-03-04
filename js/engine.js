/**
 * engine.js — The core game engine as a pure state machine.
 *
 * Direct JS port of adventure/engine.py.
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
  applyChoiceHealth,
  applyItemGrants,
  applyItemRemovals,
  applyNoteGrants,
  applyRecipes,
  applySceneEvents,
} from './events.js';
import { GameOutput, PlayerState } from './state.js';

export class GameEngine {
  /**
   * @param {{ metadata: object, scenes: object, items: object }} campaign
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
   * is used directly. Otherwise the campaign's default_player_state seeds
   * the session.
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
    let messages = [];

    const itemWeights = this._campaign.itemWeights ?? {};

    // 1. Apply item grants
    let result = applyItemGrants(chosen, state, itemWeights);
    state = result.newState;
    messages.push(...result.messages);

    // 1.5 Apply item removals
    result = applyItemRemovals(chosen, state);
    state = result.newState;

    // 1.6 Auto-fire recipes after item changes
    result = applyRecipes(state, this._campaign.recipes ?? [], itemWeights);
    state = result.newState;
    messages.push(...result.messages);

    // 2. Apply note grants
    result = applyNoteGrants(chosen, state);
    state = result.newState;
    messages.push(...result.messages);

    // 3. Apply choice health
    result = applyChoiceHealth(chosen, state);
    state = result.newState;
    messages.push(...result.messages);

    // 4. Death check after choice effects
    if (state.health !== null && state.health <= 0) {
      return new GameOutput({
        state,
        sceneText: '',
        choices: [],
        messages,
        isTerminal: true,
        terminalReason: 'death',
      });
    }

    // 5. Advance to the next scene
    const nextState = state.copy();
    nextState.sceneId = chosen.next;

    // 6–10 via _enterScene
    return this._enterScene(nextState, messages);
  }

  /**
   * Build a GameOutput for arriving at state.sceneId.
   *
   * Applies on_enter events (step 6), records the visit (step 7),
   * performs death check (step 8), filters choices (step 9), returns output.
   *
   * @param {PlayerState} state
   * @param {string[]} priorMessages
   * @returns {GameOutput}
   */
  _enterScene(state, priorMessages) {
    const messages = [...priorMessages];
    const scene = this._scenes[state.sceneId];

    // 6. Apply scene entry events (on_enter)
    const itemWeights = this._campaign.itemWeights ?? {};
    let result = applySceneEvents(scene, state, itemWeights);
    state = result.newState;
    messages.push(...result.messages);

    // 6.5 Auto-fire recipes after on_enter item changes
    result = applyRecipes(state, this._campaign.recipes ?? [], itemWeights);
    state = result.newState;
    messages.push(...result.messages);

    // 7. Record visit
    const visitState = state.copy();
    visitState.visited.push(state.sceneId);
    state = visitState;

    // 8. Death check after on_enter effects
    if (state.health !== null && state.health <= 0) {
      return new GameOutput({
        state,
        sceneText: scene.text,
        choices: [],
        messages,
        isTerminal: true,
        terminalReason: 'death',
      });
    }

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
      });
    }

    // 9. Filter available choices
    const available = getAvailableChoices(scene.choices ?? [], state.inventory);

    if (available.length === 0) {
      return new GameOutput({
        state,
        sceneText,
        choices: [],
        messages,
        isTerminal: false,
        noChoices: true,
      });
    }

    const choiceLabels = available.map((c) => c.label);

    return new GameOutput({
      state,
      sceneText,
      choices: choiceLabels,
      messages,
    });
  }
}
