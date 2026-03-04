/**
 * state.js — Core data structures for the adventure engine.
 *
 * Direct JS port of adventure/state.py.
 * PlayerState fields use camelCase internally; toDict() serialises to
 * snake_case to match the Python-compatible save file format.
 */

export class PlayerState {
  /**
   * @param {object} opts
   * @param {string} opts.sceneId
   * @param {string[]} [opts.inventory]
   * @param {number|null} [opts.health]
   * @param {number|null} [opts.maxHealth]
   * @param {number} [opts.armor]
   * @param {number|null} [opts.maxCarryWeight]
   * @param {string[]} [opts.visited]
   * @param {string[]} [opts.notes]
   */
  constructor({ sceneId, inventory = [], health = null, maxHealth = null, armor = 0, maxCarryWeight = null, visited = [], notes = [] }) {
    this.sceneId = sceneId;
    this.inventory = inventory;
    this.health = health;
    this.maxHealth = maxHealth;
    this.armor = armor;
    this.maxCarryWeight = maxCarryWeight;
    this.visited = visited;
    this.notes = notes;
  }

  /** Returns an independent shallow copy — all arrays cloned. */
  copy() {
    return new PlayerState({
      sceneId: this.sceneId,
      inventory: [...this.inventory],
      health: this.health,
      maxHealth: this.maxHealth,
      armor: this.armor,
      maxCarryWeight: this.maxCarryWeight,
      visited: [...this.visited],
      notes: [...this.notes],
    });
  }

  /** Returns a plain object suitable for JSON.stringify (snake_case keys). */
  toDict() {
    return {
      scene_id: this.sceneId,
      inventory: [...this.inventory],
      health: this.health,
      max_health: this.maxHealth,
      armor: this.armor,
      max_carry_weight: this.maxCarryWeight,
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
      health: data.health ?? null,
      maxHealth: data.max_health ?? null,
      armor: data.armor ?? 0,
      maxCarryWeight: data.max_carry_weight ?? null,
      visited: [...(data.visited ?? [])],
      notes: [...(data.notes ?? [])],
    });
  }

  /**
   * Builds the default starting state from campaign metadata.
   * @param {object} campaign - { metadata, scenes, items }
   * @returns {PlayerState}
   */
  static fromCampaign(campaign) {
    const def = campaign.metadata?.default_player_state ?? {};
    const rawHealth = def.health;
    const rawMaxHealth = def.max_health;
    const rawArmor = def.armor;
    const rawMaxCarry = def.max_carry_weight;
    return new PlayerState({
      sceneId: campaign.metadata.start,
      inventory: [...(def.inventory ?? [])],
      health: rawHealth != null ? Number(rawHealth) : null,
      maxHealth: rawMaxHealth != null ? Number(rawMaxHealth) : null,
      armor: rawArmor != null ? Number(rawArmor) : 0,
      maxCarryWeight: rawMaxCarry != null ? Number(rawMaxCarry) : null,
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
   */
  constructor({
    state,
    sceneText,
    choices = [],
    messages = [],
    isTerminal = false,
    terminalReason = null,
    noChoices = false,
  }) {
    this.state = state;
    this.sceneText = sceneText;
    this.choices = choices;
    this.messages = messages;
    this.isTerminal = isTerminal;
    this.terminalReason = terminalReason;
    this.noChoices = noChoices;
  }
}
