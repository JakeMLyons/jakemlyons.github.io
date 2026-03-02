/**
 * choices.js — Choice filtering based on player inventory.
 *
 * Direct JS port of adventure/choices.py.
 */

/**
 * Returns only choices whose item requirement(s) are all met by inventory.
 *
 * Supports:
 *   requires_item  (string)      — single item requirement
 *   requires_items (string[])    — all listed items must be present
 *
 * Both keys may coexist on the same choice; all conditions must be met.
 * Unmet choices are silently excluded (hidden, not disabled).
 *
 * @param {object[]} choices
 * @param {string[]} inventory
 * @returns {object[]}
 */
export function getAvailableChoices(choices, inventory) {
  if (!choices) return [];
  const available = [];
  for (const choice of choices) {
    const requiredSingle = choice.requires_item;
    const requiredMulti = choice.requires_items ?? [];

    if (requiredSingle && !inventory.includes(requiredSingle)) continue;
    if (requiredMulti.some((item) => !inventory.includes(item))) continue;
    available.push(choice);
  }
  return available;
}
