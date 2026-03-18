/**
 * state.js — Core data structures for the adventure engine.
 *
 * PlayerState fields use camelCase internally; toDict() serialises to
 * snake_case to match the save file format.
 */

export class PlayerState {
  /**
   * @param {object} opts
   * @param {string} opts.sceneId
   * @param {string[]} [opts.inventory]
   * @param {Record<string,number>} [opts.attributes]
   * @param {string[]} [opts.visited]
   * @param {string[]} [opts.notes]
   * @param {string[]} [opts.obtainedItems]
   */
  constructor({ sceneId, inventory = [], attributes = {}, visited = [], notes = [], obtainedItems = [] }) {
    this.sceneId = sceneId;
    this.inventory = inventory;
    this.attributes = attributes; // { health: 20, carry_weight: 0, ... }
    this.visited = visited;
    this.notes = notes;
    this.obtainedItems = obtainedItems; // all items ever granted (never removed)
  }

  /** Returns an independent shallow copy — all arrays and objects cloned. */
  copy() {
    return new PlayerState({
      sceneId: this.sceneId,
      inventory: [...this.inventory],
      attributes: { ...this.attributes },
      visited: [...this.visited],
      notes: [...this.notes],
      obtainedItems: [...this.obtainedItems],
    });
  }

  /** Returns a plain object suitable for JSON.stringify (snake_case keys). */
  toDict() {
    return {
      scene_id: this.sceneId,
      inventory: [...this.inventory],
      attributes: { ...this.attributes },
      visited: [...this.visited],
      notes: [...this.notes],
      obtained_items: [...this.obtainedItems],
    };
  }

  /**
   * Deserialises from a plain dict (e.g. loaded from a JSON save).
   * Defaults visited, notes, and obtainedItems to [] for older saves.
   * @param {object} data
   * @returns {PlayerState}
   */
  static fromDict(data) {
    return new PlayerState({
      sceneId: data.scene_id,
      inventory: [...(data.inventory ?? [])],
      attributes: { ...(data.attributes ?? {}) },
      visited: [...(data.visited ?? [])],
      notes: [...(data.notes ?? [])],
      obtainedItems: [...(data.obtained_items ?? [])],
    });
  }

  /**
   * Builds the default starting state from campaign metadata.
   * Initialises each attribute to its declared starting value.
   * Seeds obtainedItems from the starting inventory.
   * @param {object} campaign - { metadata, scenes, items, attributes }
   * @returns {PlayerState}
   */
  static fromCampaign(campaign) {
    const meta = campaign.metadata ?? {};
    const attrDefs = campaign.attributes ?? meta.attributes ?? {};
    const attributes = {};
    for (const [name, def] of Object.entries(attrDefs)) {
      attributes[name] = Number(def.value ?? 0);
    }
    const inventory = [...(meta.inventory ?? [])];
    return new PlayerState({
      sceneId: meta.start,
      inventory,
      attributes,
      obtainedItems: [...inventory],
    });
  }
}

export class GameOutput {
  /**
   * @param {object} opts
   * @param {PlayerState} opts.state
   * @param {string} opts.sceneText
   * @param {string[]} [opts.choices]
   * @param {string[]} [opts.messages]
   * @param {boolean} [opts.isTerminal]
   * @param {'end'|null} [opts.terminalReason]
   * @param {boolean} [opts.noChoices]
   * @param {object} [opts.assets] - resolved scene assets { image?: string|null, music?: string|null }
   * @param {string[]} [opts.sfx] - resolved sfx URLs to play once this turn, in order
   * @param {'decision'|'through'|'logical'} [opts.sceneType]
   */
  constructor({
    state,
    sceneText,
    choices = [],
    messages = [],
    isTerminal = false,
    terminalReason = null,
    noChoices = false,
    assets = {},
    sfx = [],
    sceneType = 'decision',
  }) {
    this.state = state;
    this.sceneText = sceneText;
    this.choices = choices;
    this.messages = messages;
    this.isTerminal = isTerminal;
    this.terminalReason = terminalReason;
    this.noChoices = noChoices;
    this.assets = assets; // { image?: string|null, music?: string|null }
    this.sfx = sfx;       // string[] — resolved sfx URLs to play once this turn
    this.sceneType = sceneType; // 'decision' | 'through' | 'logical'
  }
}
