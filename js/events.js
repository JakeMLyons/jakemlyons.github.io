/**
 * events.js — Effect application functions.
 *
 * Direct JS port of adventure/events.py.
 *
 * All functions are pure transforms: they take state + data, apply effects,
 * and return { newState, messages }. They never mutate the input state
 * (call state.copy() first) and never touch the DOM.
 *
 * YAML integer coercion: because the campaign loader uses FAILSAFE_SCHEMA,
 * numeric fields (damage, heal, health) arrive as strings. All arithmetic
 * in this module coerces with Number() before use.
 */

import { PlayerState } from './state.js';

/**
 * Add any items granted by a choice to inventory.
 * Skips items already held (deduplication is case/whitespace-sensitive).
 *
 * @param {object} choice
 * @param {PlayerState} state
 * @returns {{ newState: PlayerState, messages: string[] }}
 */
export function applyItemGrants(choice, state) {
  const granted = choice.gives_items ?? [];
  const newItems = granted.filter((item) => !state.inventory.includes(item));

  if (newItems.length === 0) return { newState: state, messages: [] };

  const newState = state.copy();
  newState.inventory.push(...newItems);
  return { newState, messages: [`You obtained: ${newItems.join(', ')}`] };
}

/**
 * Add any journal notes granted by a choice or on_enter block.
 * Duplicate notes (exact string match) are silently skipped.
 *
 * @param {object} data - choice or on_enter block
 * @param {PlayerState} state
 * @returns {{ newState: PlayerState, messages: string[] }}
 */
export function applyNoteGrants(data, state) {
  const granted = data.gives_notes ?? [];
  const newNotes = granted.filter((note) => !state.notes.includes(note));

  if (newNotes.length === 0) return { newState: state, messages: [] };

  const newState = state.copy();
  newState.notes.push(...newNotes);
  return { newState, messages: ['Journal updated.'] };
}

/**
 * Apply damage and heal declared on a choice.
 * Silently no-ops if state.health === null (campaign does not track health).
 *
 * @param {object} choice
 * @param {PlayerState} state
 * @returns {{ newState: PlayerState, messages: string[] }}
 */
export function applyChoiceHealth(choice, state) {
  if (state.health === null) return { newState: state, messages: [] };

  const damage = Number(choice.damage ?? 0);
  const heal = Number(choice.heal ?? 0);

  if (!damage && !heal) return { newState: state, messages: [] };

  const newState = state.copy();
  const messages = [];

  if (damage) {
    newState.health -= damage;
    messages.push(`You took ${damage} damage! Health: ${newState.health}`);
  }
  if (heal) {
    newState.health += heal;
    messages.push(`You recovered ${heal} health! Health: ${newState.health}`);
  }

  return { newState, messages };
}

/**
 * Process the on_enter block for a scene.
 *
 * Fires before scene text is displayed. Supported on_enter keys:
 *   message:     string     — displayed to the player (first in output order)
 *   gives_items: string[]   — items added automatically
 *   gives_notes: string[]   — journal notes added automatically
 *   damage:      number     — subtracted from health
 *   heal:        number     — added to health
 *
 * Health effects are silently ignored when state.health === null.
 *
 * @param {object} scene
 * @param {PlayerState} state
 * @returns {{ newState: PlayerState, messages: string[] }}
 */
export function applySceneEvents(scene, state) {
  const onEnter = scene.on_enter;
  if (!onEnter) return { newState: state, messages: [] };

  let newState = state.copy();
  const messages = [];

  // Narrative message shown first
  if (onEnter.message) {
    messages.push(onEnter.message);
  }

  // Auto-grant items
  const granted = onEnter.gives_items ?? [];
  const newItems = granted.filter((item) => !newState.inventory.includes(item));
  if (newItems.length > 0) {
    newState.inventory.push(...newItems);
    messages.push(`You found: ${newItems.join(', ')}`);
  }

  // Auto-grant notes
  const noteResult = applyNoteGrants(onEnter, newState);
  newState = noteResult.newState;
  messages.push(...noteResult.messages);

  // Health effects (only if health is tracked)
  if (newState.health !== null) {
    const damage = Number(onEnter.damage ?? 0);
    const heal = Number(onEnter.heal ?? 0);
    if (damage) {
      newState.health -= damage;
      messages.push(`You took ${damage} damage! Health: ${newState.health}`);
    }
    if (heal) {
      newState.health += heal;
      messages.push(`You recovered ${heal} health! Health: ${newState.health}`);
    }
  }

  return { newState, messages };
}
