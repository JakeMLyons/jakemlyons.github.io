/**
 * events.js — Effect application functions.
 *
 * All functions are pure transforms: they take state + data, apply effects,
 * and return { newState, messages } (or { newState, messages, died, deathMessage, triggerScene }
 * for functions that can trigger boundary effects). They never mutate the input state
 * (call state.copy() first) and never touch the DOM.
 *
 * YAML integer coercion: because the campaign loader uses FAILSAFE_SCHEMA,
 * numeric fields (affect_attributes values) arrive as strings. All arithmetic
 * in this module coerces with Number() before use.
 */

import { PlayerState } from './state.js';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Apply affect_attributes from an item on pickup.
 * Clamps to [min, max] but never triggers death and never rejects the item.
 * @param {string} itemName
 * @param {PlayerState} state
 * @param {object} campaign
 * @returns {{ newState: PlayerState }}
 */
function applyItemAttributeGrant(itemName, state, campaign) {
  const item = campaign.items?.[itemName];
  const affects = item?.affect_attributes ?? {};
  if (Object.keys(affects).length === 0) return { newState: state };

  const newState = state.copy();
  const attrDefs = campaign.attributes ?? campaign.metadata?.attributes ?? {};

  for (const [attrName, delta] of Object.entries(affects)) {
    if (!(attrName in newState.attributes)) continue; // unknown attribute, skip
    let newVal = newState.attributes[attrName] + Number(delta);
    const def = attrDefs[attrName] ?? {};
    if (def.max != null) newVal = Math.min(newVal, Number(def.max));
    if (def.min != null) newVal = Math.max(newVal, Number(def.min));
    newState.attributes[attrName] = newVal;
    // no death check — items never kill on pickup
  }

  return { newState };
}

/**
 * Reverse item's affect_attributes on removal. Clamps to [min, max], never kills.
 * @param {string} itemName
 * @param {PlayerState} state
 * @param {object} campaign
 * @returns {{ newState: PlayerState }}
 */
function applyItemAttributeRemoval(itemName, state, campaign) {
  const item = campaign.items?.[itemName];
  const affects = item?.affect_attributes ?? {};
  if (Object.keys(affects).length === 0) return { newState: state };

  const newState = state.copy();
  const attrDefs = campaign.attributes ?? campaign.metadata?.attributes ?? {};

  for (const [attrName, delta] of Object.entries(affects)) {
    if (!(attrName in newState.attributes)) continue;
    let newVal = newState.attributes[attrName] - Number(delta); // SUBTRACT to reverse grant
    const def = attrDefs[attrName] ?? {};
    if (def.max != null) newVal = Math.min(newVal, Number(def.max));
    if (def.min != null) newVal = Math.max(newVal, Number(def.min));
    newState.attributes[attrName] = newVal;
    // no death check — items never kill on removal
  }

  return { newState };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Apply affect_attributes deltas from a choice or on_enter block.
 * Clamps each attribute to [min, max]; checks for boundary breaches.
 *
 * When an attribute reaches its min and has a min_scene, triggerScene is set
 * to that scene ID. When min is reached without min_scene, old-style death
 * fires (died=true). max_scene works the same way for the upper bound.
 * First attribute (in definition order) whose boundary is reached wins.
 *
 * @param {object} data - choice or on_enter block
 * @param {PlayerState} state
 * @param {object} campaign
 * @returns {{ newState: PlayerState, messages: string[], died: boolean, deathMessage: string|null, triggerScene: string|null }}
 */
export function applyAttributeEffects(data, state, campaign) {
  const affects = data.affect_attributes ?? {};
  if (Object.keys(affects).length === 0) {
    return { newState: state, messages: [], died: false, deathMessage: null, triggerScene: null };
  }

  const newState = state.copy();
  const attrDefs = campaign.attributes ?? campaign.metadata?.attributes ?? {};
  const messages = [];
  let died = false;
  let deathMessage = null;
  let triggerScene = null;

  for (const [attrName, delta] of Object.entries(affects)) {
    if (!(attrName in newState.attributes)) continue; // unknown attribute, skip
    const rawVal = newState.attributes[attrName] + Number(delta);
    let newVal = rawVal;
    const def = attrDefs[attrName] ?? {};

    // Clamp to boundaries
    if (def.max != null) newVal = Math.min(newVal, Number(def.max));
    if (def.min != null) newVal = Math.max(newVal, Number(def.min));
    newState.attributes[attrName] = newVal;

    // Boundary checks — first attribute wins
    if (!died && !triggerScene) {
      if (def.min != null && newVal <= Number(def.min)) {
        if (def.min_scene) {
          triggerScene = def.min_scene;
        } else {
          died = true;
          deathMessage = def.min_message ?? null;
        }
      } else if (def.max != null && rawVal >= Number(def.max)) {
        if (def.max_message) messages.push(def.max_message);
        if (def.max_scene) triggerScene = def.max_scene;
      }
    }
  }

  return { newState, messages, died, deathMessage, triggerScene };
}

/**
 * Add any items granted by a choice to inventory.
 * Skips items already held. Items are always accepted — no attribute blocks grants.
 * Applies affect_attributes for each accepted item (clamped, never kills).
 *
 * @param {object} choice
 * @param {PlayerState} state
 * @param {object} campaign
 * @returns {{ newState: PlayerState, messages: string[] }}
 */
export function applyItemGrants(choice, state, campaign) {
  const granted = choice.gives_items ?? [];
  const newItems = granted.filter((item) => !state.inventory.includes(item));

  if (newItems.length === 0) return { newState: state, messages: [] };

  let newState = state.copy();
  newState.inventory.push(...newItems);
  const messages = [`You obtained: ${newItems.join(', ')}`];

  for (const itemName of newItems) {
    const result = applyItemAttributeGrant(itemName, newState, campaign);
    newState = result.newState;
  }

  return { newState, messages };
}

/**
 * Remove any items consumed by a choice or on_enter block from inventory.
 * Silently skips items not currently held.
 * Reverses affect_attributes for removed items (clamped, never kills).
 *
 * @param {object} data - choice or on_enter block
 * @param {PlayerState} state
 * @param {object} campaign
 * @returns {{ newState: PlayerState, messages: string[] }}
 */
export function applyItemRemovals(data, state, campaign) {
  const toRemove = data.removes_items ?? [];
  const held = toRemove.filter((item) => state.inventory.includes(item));
  if (held.length === 0) return { newState: state, messages: [] };

  let newState = state.copy();
  newState.inventory = newState.inventory.filter((item) => !held.includes(item));

  for (const itemName of held) {
    const result = applyItemAttributeRemoval(itemName, newState, campaign);
    newState = result.newState;
  }

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
 * Process the on_enter block for a scene.
 *
 * Fires before scene text is displayed. Supported on_enter keys:
 *   message:           string    — displayed to the player (first in output order)
 *   gives_items:       string[]  — items added automatically
 *   removes_items:     string[]  — items consumed automatically (silent, skips missing)
 *   gives_notes:       string[]  — journal notes added automatically
 *   affect_attributes: object    — attribute deltas applied on entry; can trigger death
 *
 * @param {object} scene
 * @param {PlayerState} state
 * @param {object} campaign
 * @returns {{ newState: PlayerState, messages: string[], died: boolean, deathMessage: string|null, triggerScene: string|null }}
 */
export function applySceneEvents(scene, state, campaign) {
  const onEnter = scene.on_enter;
  if (!onEnter) return { newState: state, messages: [], died: false, deathMessage: null, triggerScene: null };

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
    for (const itemName of newItems) {
      const result = applyItemAttributeGrant(itemName, newState, campaign);
      newState = result.newState;
    }
  }

  // Auto-remove consumed items
  const removeResult = applyItemRemovals(onEnter, newState, campaign);
  newState = removeResult.newState;

  // Auto-grant notes
  const noteResult = applyNoteGrants(onEnter, newState);
  newState = noteResult.newState;
  messages.push(...noteResult.messages);

  // Attribute effects (may trigger death)
  const attrResult = applyAttributeEffects(onEnter, newState, campaign);
  newState = attrResult.newState;
  messages.push(...attrResult.messages);

  return { newState, messages, died: attrResult.died, deathMessage: attrResult.deathMessage, triggerScene: attrResult.triggerScene };
}

/**
 * Auto-fire any recipes whose inputs are all present in inventory.
 * Loops until no recipe fires (handles chains). Consumes inputs and grants
 * the output item. Items are always accepted — no attribute blocks grants.
 *
 * Recipe shape: { inputs: string[], output: string, message?: string }
 *
 * @param {PlayerState} state
 * @param {object[]} recipes
 * @param {object} campaign
 * @returns {{ newState: PlayerState, messages: string[] }}
 */
export function applyRecipes(state, recipes, campaign) {
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
      let next = current.copy();
      next.inventory = next.inventory.filter((item) => !inputs.includes(item));

      // Reverse attribute effects for consumed inputs
      for (const inputName of inputs) {
        const result = applyItemAttributeRemoval(inputName, next, campaign);
        next = result.newState;
      }

      const output = recipe.output;
      if (output && !next.inventory.includes(output)) {
        next.inventory.push(output);
        // Apply attribute effects for output item
        const result = applyItemAttributeGrant(output, next, campaign);
        next = result.newState;
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
