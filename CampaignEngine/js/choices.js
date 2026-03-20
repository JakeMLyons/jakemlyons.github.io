/**
 * choices.js — Choice filtering based on player inventory and attributes.
 *
 * Direct JS port of adventure/choices.py.
 */

/**
 * Evaluate a requires_attributes condition string against a current value.
 * Format: "{op} {number}", e.g. ">= 18", "= 0", "!= 5".
 * Returns true if the condition is met.
 * @param {string} condStr - e.g. ">= 18"
 * @param {number} current
 * @returns {boolean}
 */
function evalAttrCondition(condStr, current) {
  const match = String(condStr).trim().match(/^(<=|>=|<|>|=|!=)\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return false;
  const op = match[1];
  const target = Number(match[2]);
  const val = Number(current);
  switch (op) {
    case '<=': return val <= target;
    case '>=': return val >= target;
    case '<':  return val < target;
    case '>':  return val > target;
    case '=':  return val === target;
    case '!=': return val !== target;
    default:   return false;
  }
}

/**
 * Returns only choices whose item and attribute requirements are all met.
 *
 * Supports:
 *   requires_item       (string)         — single item; shorthand for is: owned
 *   requires_items      (mixed[])        — array of strings or structured objects:
 *                                          { item, is: "owned"|"obtained" }
 *                                          { item, is_not: "owned"|"obtained" }
 *                                          plain strings → is: "owned" (legacy)
 *   requires_attributes (object|array)  — dict format: { attrName: ">= 18" }
 *                                          or legacy array: [{ attr, op, value }]
 *
 * @param {object[]} choices
 * @param {string[]} inventory
 * @param {Record<string,number>} [attributes]
 * @param {string[]} [obtainedItems]
 * @returns {object[]}
 */
export function getAvailableChoices(choices, inventory, attributes = {}, obtainedItems = []) {
  if (!choices) return [];
  const available = [];
  for (const choice of choices) {
    // ── Item requirements ────────────────────────────────────────────────────

    const requiredSingle = choice.requires_item;
    const requiredMulti  = choice.requires_items ?? [];

    // Normalise all item requirements into structured entries
    const itemReqs = [];
    if (requiredSingle) {
      itemReqs.push({ item: requiredSingle, is: 'owned' });
    }
    for (const entry of requiredMulti) {
      if (typeof entry === 'string') {
        itemReqs.push({ item: entry, is: 'owned' });
      } else {
        itemReqs.push(entry);
      }
    }

    // Evaluate each item requirement
    let itemsMet = true;
    for (const req of itemReqs) {
      const itemName = req.item;
      if ('is' in req) {
        const mode = req.is;
        if (mode === 'owned' && !inventory.includes(itemName)) { itemsMet = false; break; }
        if (mode === 'obtained' && !obtainedItems.includes(itemName)) { itemsMet = false; break; }
      } else if ('is_not' in req) {
        const mode = req.is_not;
        if (mode === 'owned' && inventory.includes(itemName)) { itemsMet = false; break; }
        if (mode === 'obtained' && obtainedItems.includes(itemName)) { itemsMet = false; break; }
      }
    }
    if (!itemsMet) continue;

    // ── Attribute requirements ───────────────────────────────────────────────

    const attrConditions = choice.requires_attributes;
    if (attrConditions) {
      let conditionsMet = true;

      if (Array.isArray(attrConditions)) {
        // Legacy array format: [{ attr, op, value }]
        for (const cond of attrConditions) {
          const current = Number(attributes[cond.attr] ?? 0);
          const target  = Number(cond.value);
          const op      = cond.op;
          let passes;
          if      (op === '>')  passes = current > target;
          else if (op === '>=') passes = current >= target;
          else if (op === '<')  passes = current < target;
          else if (op === '<=') passes = current <= target;
          else if (op === '!=') passes = current !== target;
          else                  passes = current === target; // '=' or unknown op
          if (!passes) { conditionsMet = false; break; }
        }
      } else {
        // Dict format: { attrName: ">= 18" } or { attrName: ">= 18, <= 45" }
        for (const [attrName, condStr] of Object.entries(attrConditions)) {
          const current = Number(attributes[attrName] ?? 0);
          const parts = String(condStr).split(',');
          for (const part of parts) {
            if (!evalAttrCondition(part.trim(), current)) {
              conditionsMet = false;
              break;
            }
          }
          if (!conditionsMet) break;
        }
      }

      if (!conditionsMet) continue;
    }

    available.push(choice);
  }
  return available;
}
