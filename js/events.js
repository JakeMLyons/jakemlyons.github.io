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
 * Compute total carry weight from an inventory list and item weight table.
 * @param {string[]} inventory
 * @param {object} itemWeights - { itemName: number }
 * @returns {number}
 */
function computeCarryWeight(inventory, itemWeights) {
  return inventory.reduce((sum, item) => sum + Number(itemWeights[item] ?? 0), 0);
}

/**
 * Split items into accepted (fit under maxCarryWeight) and rejected (too heavy).
 * If maxCarryWeight is null, all items are accepted.
 * @param {string[]} items
 * @param {PlayerState} state
 * @param {object} itemWeights
 * @returns {{ accepted: string[], rejected: string[] }}
 */
function weighedGrant(items, state, itemWeights) {
  if (state.maxCarryWeight === null) return { accepted: items, rejected: [] };

  const accepted = [];
  const rejected = [];
  let running = computeCarryWeight(state.inventory, itemWeights);

  for (const item of items) {
    const w = Number(itemWeights[item] ?? 0);
    if (running + w <= state.maxCarryWeight) {
      accepted.push(item);
      running += w;
    } else {
      rejected.push(item);
    }
  }
  return { accepted, rejected };
}

/**
 * Add any items granted by a choice to inventory.
 * Skips items already held. Respects maxCarryWeight if set.
 *
 * @param {object} choice
 * @param {PlayerState} state
 * @param {object} [itemWeights] - { itemName: number }
 * @returns {{ newState: PlayerState, messages: string[] }}
 */
export function applyItemGrants(choice, state, itemWeights = {}) {
  const granted = choice.gives_items ?? [];
  const newItems = granted.filter((item) => !state.inventory.includes(item));

  if (newItems.length === 0) return { newState: state, messages: [] };

  const { accepted, rejected } = weighedGrant(newItems, state, itemWeights);
  const messages = [];

  if (rejected.length > 0) {
    messages.push(`Too heavy to carry: ${rejected.join(', ')}`);
  }
  if (accepted.length === 0) {
    return { newState: state, messages };
  }

  const newState = state.copy();
  newState.inventory.push(...accepted);
  messages.push(`You obtained: ${accepted.join(', ')}`);
  return { newState, messages };
}

/**
 * Remove any items consumed by a choice or on_enter block from inventory.
 * Silently skips items not currently held.
 *
 * @param {object} data - choice or on_enter block
 * @param {PlayerState} state
 * @returns {{ newState: PlayerState, messages: string[] }}
 */
export function applyItemRemovals(data, state) {
  const toRemove = data.removes_items ?? [];
  const held = toRemove.filter((item) => state.inventory.includes(item));
  if (held.length === 0) return { newState: state, messages: [] };

  const newState = state.copy();
  newState.inventory = newState.inventory.filter((item) => !held.includes(item));
  return { newState, messages: [] };
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
    const armor = Number(newState.armor ?? 0);
    const effectiveDamage = Math.max(0, damage - armor);
    newState.health -= effectiveDamage;
    if (effectiveDamage > 0) {
      messages.push(`You took ${effectiveDamage} damage! Health: ${newState.health}`);
    } else {
      messages.push(`Your armor absorbed the damage!`);
    }
  }
  if (heal) {
    newState.health += heal;
    if (newState.maxHealth !== null) {
      newState.health = Math.min(newState.health, newState.maxHealth);
    }
    messages.push(`You recovered ${heal} health! Health: ${newState.health}`);
  }

  return { newState, messages };
}

/**
 * Process the on_enter block for a scene.
 *
 * Fires before scene text is displayed. Supported on_enter keys:
 *   message:      string     — displayed to the player (first in output order)
 *   gives_items:  string[]   — items added automatically
 *   removes_items: string[]  — items consumed automatically (silent, skips missing)
 *   gives_notes:  string[]   — journal notes added automatically
 *   damage:       number     — subtracted from health
 *   heal:         number     — added to health
 *
 * Health effects are silently ignored when state.health === null.
 *
 * @param {object} scene
 * @param {PlayerState} state
 * @param {object} [itemWeights] - { itemName: number }
 * @returns {{ newState: PlayerState, messages: string[] }}
 */
export function applySceneEvents(scene, state, itemWeights = {}) {
  const onEnter = scene.on_enter;
  if (!onEnter) return { newState: state, messages: [] };

  let newState = state.copy();
  const messages = [];

  // Narrative message shown first
  if (onEnter.message) {
    messages.push(onEnter.message);
  }

  // Auto-grant items (respects carry weight)
  const granted = onEnter.gives_items ?? [];
  const newItems = granted.filter((item) => !newState.inventory.includes(item));
  if (newItems.length > 0) {
    const { accepted, rejected } = weighedGrant(newItems, newState, itemWeights);
    if (accepted.length > 0) {
      newState.inventory.push(...accepted);
      messages.push(`You found: ${accepted.join(', ')}`);
    }
    if (rejected.length > 0) {
      messages.push(`Too heavy to carry: ${rejected.join(', ')}`);
    }
  }

  // Auto-remove consumed items
  const removeResult = applyItemRemovals(onEnter, newState);
  newState = removeResult.newState;

  // Auto-grant notes
  const noteResult = applyNoteGrants(onEnter, newState);
  newState = noteResult.newState;
  messages.push(...noteResult.messages);

  // Health effects (only if health is tracked)
  if (newState.health !== null) {
    const damage = Number(onEnter.damage ?? 0);
    const heal = Number(onEnter.heal ?? 0);
    if (damage) {
      const armor = Number(newState.armor ?? 0);
      const effectiveDamage = Math.max(0, damage - armor);
      newState.health -= effectiveDamage;
      if (effectiveDamage > 0) {
        messages.push(`You took ${effectiveDamage} damage! Health: ${newState.health}`);
      } else {
        messages.push(`Your armor absorbed the damage!`);
      }
    }
    if (heal) {
      newState.health += heal;
      if (newState.maxHealth !== null) {
        newState.health = Math.min(newState.health, newState.maxHealth);
      }
      messages.push(`You recovered ${heal} health! Health: ${newState.health}`);
    }
  }

  return { newState, messages };
}

/**
 * Auto-fire any recipes whose inputs are all present in inventory.
 * Loops until no recipe fires (handles chains). Consumes inputs and grants
 * the output item. Respects maxCarryWeight if set.
 *
 * Recipe shape: { inputs: string[], output: string, message?: string }
 *
 * @param {PlayerState} state
 * @param {object[]} recipes
 * @param {object} [itemWeights]
 * @returns {{ newState: PlayerState, messages: string[] }}
 */
export function applyRecipes(state, recipes, itemWeights = {}) {
  if (!recipes || recipes.length === 0) return { newState: state, messages: [] };

  let current = state;
  const messages = [];
  let fired = true;

  while (fired) {
    fired = false;
    for (const recipe of recipes) {
      const inputs = Array.isArray(recipe.inputs) ? recipe.inputs : [];
      if (inputs.length === 0) continue;
      if (!inputs.every((item) => current.inventory.includes(item))) continue;

      fired = true;
      const next = current.copy();
      next.inventory = next.inventory.filter((item) => !inputs.includes(item));

      const output = recipe.output;
      if (output && !next.inventory.includes(output)) {
        const { accepted, rejected } = weighedGrant([output], next, itemWeights);
        next.inventory.push(...accepted);
        if (rejected.length > 0) {
          messages.push(recipe.message ?? `You combined: ${inputs.join(', ')}.`);
          messages.push(`Too heavy to carry: ${rejected.join(', ')}`);
          current = next;
          continue;
        }
      }

      if (recipe.message) {
        messages.push(recipe.message);
      } else {
        messages.push(`You combined ${inputs.join(' + ')} → ${output}.`);
      }
      current = next;
    }
  }

  return { newState: current, messages };
}
