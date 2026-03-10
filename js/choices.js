/**
 * choices.js — Choice filtering based on player inventory and attributes.
 *
 * Direct JS port of adventure/choices.py.
 */

/**
 * Returns only choices whose item and attribute requirements are all met.
 *
 * Supports:
 *   requires_item       (string)    — single item requirement
 *   requires_items      (string[])  — all listed items must be present
 *   requires_attributes (object[])  — array of { attr, op, value } conditions;
 *                                     all must pass (AND logic)
 *
 * Valid ops for requires_attributes: '>', '>=', '<', '<=', '='
 * Unmet choices are silently excluded (hidden, not disabled).
 *
 * @param {object[]} choices
 * @param {string[]} inventory
 * @param {Record<string,number>} [attributes]
 * @returns {object[]}
 */
export function getAvailableChoices(choices, inventory, attributes = {}) {
  if (!choices) return [];
  const available = [];
  for (const choice of choices) {
    const requiredSingle = choice.requires_item;
    const requiredMulti  = choice.requires_items ?? [];

    if (requiredSingle && !inventory.includes(requiredSingle)) continue;
    if (requiredMulti.some((item) => !inventory.includes(item))) continue;

    const attrConditions = choice.requires_attributes ?? [];
    let conditionsMet = true;
    for (const cond of attrConditions) {
      const current = Number(attributes[cond.attr] ?? 0);
      const target  = Number(cond.value);
      const op      = cond.op;
      let passes;
      if      (op === '>')  passes = current > target;
      else if (op === '>=') passes = current >= target;
      else if (op === '<')  passes = current < target;
      else if (op === '<=') passes = current <= target;
      else                  passes = current === target; // '=' or unknown op
      if (!passes) { conditionsMet = false; break; }
    }
    if (!conditionsMet) continue;

    available.push(choice);
  }
  return available;
}
