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
   */
  constructor({ sceneId, inventory = [], attributes = {}, visited = [], notes = [] }) {
    this.sceneId = sceneId;
    this.inventory = inventory;
    this.attributes = attributes; // { health: 20, carry_weight: 0, ... }
    this.visited = visited;
    this.notes = notes;
  }

  /** Returns an independent shallow copy — all arrays and objects cloned. */
  copy() {
    return new PlayerState({
      sceneId: this.sceneId,
      inventory: [...this.inventory],
      attributes: { ...this.attributes },
      visited: [...this.visited],
      notes: [...this.notes],
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
    };
  }

  /**
   * Deserialises from a plain dict (e.g. loaded from a JSON save).
   * Defaults visited and notes to [] for saves created before those fields
   * were added, so old saves load without error.
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
    });
  }

  /**
   * Builds the default starting state from campaign metadata.
   * Initialises each attribute to its declared starting value.
   * @param {object} campaign - { metadata, scenes, items }
   * @returns {PlayerState}
   */
  static fromCampaign(campaign) {
    const meta = campaign.metadata ?? {};
    const attrDefs = meta.attributes ?? {};
    const attributes = {};
    for (const [name, def] of Object.entries(attrDefs)) {
      attributes[name] = Number(def.value ?? 0);
    }
    return new PlayerState({
      sceneId: meta.start,
      inventory: [...(meta.inventory ?? [])],
      attributes,
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
   * @param {'end'|'death'|null} [opts.terminalReason]
   * @param {boolean} [opts.noChoices]
   * @param {string|null} [opts.deathMessage]
   */
  constructor({
    state,
    sceneText,
    choices = [],
    messages = [],
    isTerminal = false,
    terminalReason = null,
    noChoices = false,
    deathMessage = null,
  }) {
    this.state = state;
    this.sceneText = sceneText;
    this.choices = choices;
    this.messages = messages;
    this.isTerminal = isTerminal;
    this.terminalReason = terminalReason;
    this.noChoices = noChoices;
    this.deathMessage = deathMessage; // min_message from attribute that triggered death
  }
}
