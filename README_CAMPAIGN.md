# Text Adventure Engine — Campaign Tools Reference

---

## 1. File Structure

Campaign files are written in YAML. All `.yaml` files in a campaign folder are merged on load, so you can split content across as many files as you like. The only requirement is that `metadata.yaml` is present — without it the engine will not load the campaign.

A typical layout looks like this:

```
my-campaign/
├── metadata.yaml       ← required
├── attributes.yaml
├── items.yaml
├── recipes.yaml
├── assets.yaml
└── scenes/
    ├── intro.yaml
    ├── forest.yaml
    └── cave.yaml
```

All files are merged into a single document at load time. Because of this, every key across all files must be unique — defining `scenes:` in two separate files is fine (they will be merged), but defining the same scene ID twice is not.

### metadata.yaml

`metadata` is the only block that is **not** merged and must live in its own file. It configures the campaign's title, description, entry point, and the player's starting state.

```yaml
metadata:
  title: "The Lost Keep"
  description: "A dark fantasy adventure in a crumbling fortress."
  start: intro
  default_player_state:
    inventory:
      - torch
```

| Key | Type | Description |
|-----|------|-------------|
| `title` | string | The campaign's display name |
| `description` | string | A short summary shown on the campaign select screen |
| `start` | string | The scene ID the player begins in |
| `default_player_state` | object | Initial inventory and attribute values |
| `default_player_state.inventory` | string[] | Items the player starts with |

---

## 2. Attributes

Defined under `attributes:`. Each attribute is a named numeric stat tracked on the player throughout the campaign.

```yaml
attributes:
  health:
    value: 100
    min: 0
    max: 100
    conditions:
      - when: "<= 0"
        message: "Your wounds are fatal. The darkness takes you."
        scene: game_over
      - when: "<= 20"
        message: "You are gravely wounded."
  sanity:
    value: 10
    min: 0
    max: 10
    conditions:
      - when: "<= 0"
        message: "Your mind shatters completely."
        scene: madness_end
      - when: ">= 10"
        message: "A rare clarity washes over you."
  strength:
    value: 5
    min: 0
    max: 10
```

| Key | Description |
|-----|-------------|
| `value` | Starting value for the attribute. Defaults to `0` if omitted |
| `min` / `max` | Clamp the attribute's value to this range |
| `conditions` | A list of threshold checks; the first match wins |
| `conditions[].when` | Condition expression — see operator table below |
| `conditions[].message` | Message shown to the player when the condition triggers |
| `conditions[].scene` | Scene ID to redirect to (optional — omit to show the message without redirecting) |

> **Note:** Conditions are checked any time the attribute's value changes — whether from a choice, an `on_enter` block, or a passive item effect.

### `affect_attributes`

Used in choices, `on_enter` blocks, and item definitions. Values are quoted strings combining an operator with a number.

```yaml
affect_attributes:
  health: "+ 20"       # add 20
  sanity: "- 1"        # subtract 1
  day_state: "= 2"     # set to exactly 2
```

| Operator | Effect | Example |
|----------|--------|---------|
| `+ N` | Add N to the attribute | `health: "+ 10"` |
| `- N` | Subtract N from the attribute | `health: "- 10"` |
| `= N` | Set the attribute to exactly N | `day_state: "= 0"` |

### `requires_attributes`

Used in choices. A mapping of attribute names to condition strings. Multiple conditions on the same attribute can be combined with a comma for range checks. All conditions across all attributes must pass for the choice to be visible.

```yaml
requires_attributes:
  health: ">= 50"               # single condition
  sanity: ">= 4"                # multiple attributes — all must pass
  jo_affection: ">= 10, <= 30"  # range — both conditions must pass
```

| Operator | Meaning |
|----------|---------|
| `>=` | Greater than or equal to |
| `<=` | Less than or equal to |
| `>` | Greater than |
| `<` | Less than |
| `=` | Equal to |
| `!=` | Not equal to |

---

## 3. Items

Defined under `items:`. Items live in the player's inventory and can optionally carry passive stat modifiers while held.

```yaml
items:
  # Shorthand — just a description string
  worn scarf: "A dull scarf tattered by age."

  # Full form — description only
  rusty key:
    description: "A small iron key, orange with age."

  # Passive attribute bonus while held (reversed automatically on removal)
  enchanted shield:
    description: "A shield that hums with protective magic."
    affect_attributes:
      health: "+ 20"

  # Passive attribute drain while held
  cursed amulet:
    description: "It feels wrong to hold."
    affect_attributes:
      sanity: "- 3"
```

| Key | Type | Description |
|-----|------|-------------|
| `description` | string | Shown when the player inspects the item in their inventory |
| `affect_attributes` | object | Passive stat modifier while the item is held; reversed automatically when removed. Uses the same syntax as the `affect_attributes` operator table above |

### `requires_items`

Used in choices to gate visibility based on the player's item history. Each entry is an object with an `item` name and either an `is` or `is_not` check. All entries must pass for the choice to be visible.

```yaml
requires_items:
  - item: iron key
    is: owned          # currently in inventory

  - item: torch
    is_not: owned      # NOT currently in inventory

  - item: rusty key
    is: obtained       # held at any point, even if since removed or consumed

  - item: magic gem
    is_not: obtained   # never been in inventory
```

| Field | Values | Description |
|-------|--------|-------------|
| `item` | string | The item name to check |
| `is` | `owned` / `obtained` | Pass if the item **is** currently held (`owned`) or has ever been held (`obtained`) |
| `is_not` | `owned` / `obtained` | Pass if the item **is not** currently held (`owned`) or has never been held (`obtained`) |

| Check | Meaning |
|-------|---------|
| `is: owned` | Item is currently in inventory |
| `is_not: owned` | Item is NOT currently in inventory |
| `is: obtained` | Item has been in inventory at some point, even if since removed or consumed |
| `is_not: obtained` | Item has never been in inventory |

### Recipes

Defined as a list under `recipes:`. Recipes fire automatically whenever the player's inventory changes. If the player holds all `inputs`, they are consumed and the `output` is added.

```yaml
recipes:
  - inputs:
      - candle
      - matches
    output: lit candle
    message: "You strike a match and touch it to the wick. The candle flickers to life."

  - inputs:
      - rope
      - hook
    output: grappling hook
    # message is optional — defaults to "You combined rope + hook → grappling hook."

  - inputs:
      - grappling hook
      - lit candle
    output: spelunking kit
    message: "Everything you need to descend into the dark."
```

| Key | Type | Description |
|-----|------|-------------|
| `inputs` | string[] | Items consumed (all must be present to trigger) |
| `output` | string | Item produced and added to inventory |
| `message` | string | Optional; defaults to `"You combined X + Y → Z."` |

> **Chaining:** Recipes fire in sequence. If the output of one recipe satisfies the inputs of another, both trigger automatically in the same pass.

---

## 4. Assets

Defined under `assets:`. Register all media by key here, then reference them by name inside scenes. Assets are split into three categories: `images`, `music`, and `sfx`.

```yaml
assets:
  images:
    town: "https://example.com/images/town.jpg"
    forest: "https://example.com/images/forest.jpg"
    cave: "https://example.com/images/cave.jpg"
  music:
    theme: "https://example.com/audio/theme.mp3"
    tension: "https://example.com/audio/tension.mp3"
  sfx:
    door_creak: "https://example.com/audio/door.mp3"
    sword_clash: "https://example.com/audio/sword.mp3"
    thunder: "https://example.com/audio/thunder.mp3"
```

### Per-Scene Assignment

Set or clear assets in any scene's `assets:` block. Image and music state persists across scenes until explicitly changed or cleared.

```yaml
scenes:
  dark_cave:
    assets:
      image: cave         # key from assets.images
      music: tension      # key from assets.music
    text: "The cave is pitch black."

  peaceful_meadow:
    assets:
      image: none         # explicitly clears the current image
      music: none         # explicitly stops the music
    text: "You emerge blinking into warm sunlight."

  keep_approach:
    assets:
      image: keep_exterior
      # music absent — previous track continues unchanged
    text: "The keep looms over you."
```

| Value | Effect |
|-------|--------|
| A registered key string | Displays / plays that asset |
| `none` | Explicitly clears the image or stops the music |
| *(absent)* | No change — the previous image/music continues |

### `gives_sfx`

Sound effects are triggered by `gives_sfx` in choices or `on_enter` blocks. Unlike music, SFX are one-shot — they play once and do not persist. A single key or a list of keys can be provided; lists play in sequence.

```yaml
# Single SFX
gives_sfx: door_creak

# Multiple SFX played in sequence
gives_sfx:
  - sword_clash
  - thunder
```

---

## 5. Journal

The journal is a read-only log visible to the player. It has no mechanical effect on the engine — it cannot gate choices or modify attributes — but it is a powerful authoring tool for delivering lore, tracking story beats, and hiding secrets for attentive players to find.

Entries are added via `gives_notes` in a choice or `on_enter` block. Once added, an entry persists for the rest of the playthrough.

```yaml
# Added when a choice is selected
choices:
  - label: "Read the inscription"
    next: inscription_scene
    gives_notes:
      - "The inscription reads: 'The third bell opens the way.'"

# Added automatically on scene entry
on_enter:
  gives_notes:
    - "The keep's lower levels smell of salt water — strange, this far inland."
```

Because journal entries are plain strings with no schema, they can contain anything: cryptic clues, in-world documents, NPC dialogue transcripts, or puzzle hints. A player who reads carefully may unlock an understanding that a player who skims will miss entirely — without any branching logic required.

```yaml
# A note that hints at a hidden recipe without spelling it out
gives_notes:
  - "The old alchemist's margin reads: 'Flame without risk — seal the wick first, then strike.'"

# An in-world document delivered as a note
gives_notes:
  - |
    NOTICE — By order of the Warden:
    The eastern vault is sealed until the debt is satisfied.
    Key held by the steward. Do not inquire further.
```

> **Design note:** Journal entries are a good place to plant information that rewards exploration. A note found in an optional scene can hint at a combination of items that triggers a recipe, or describe a character's weakness that unlocks a `requires_attributes` check the player would not otherwise know to attempt.

---

## 6. Scenes

Scenes are the core unit of the engine. Each scene has a unique ID (the YAML key), an optional `title` shown in the player's history tab, optional assets, a text body, and either a `choices` list or `end: true`. An optional `type` field controls how the engine presents and processes the scene.

### Scene types

| Type | Description |
|------|-------------|
| `decision` | **(default)** Shows text and a list of player choices. If `type` is omitted, this is assumed. |
| `through` | Narrative passthrough — shows text and a single "Continue" button. No choices are authored; use `next` to set the destination. |
| `logical` | Invisible routing scene — the player never sees it. The engine evaluates the choices' requirements and automatically navigates to the first one that passes. Choices in a `logical` scene do not have a `label`. |

#### `type: decision` (default)

The standard scene. Omitting `type` is equivalent to setting `type: decision`.

```yaml
scenes:
  tavern:
    text: "You enter the tavern. A barkeep polishes glasses behind the counter."
    choices:
      - label: "Talk to the barkeep"
        next: barkeep_chat
      - label: "Sit in the corner"
        next: corner_seat
```

#### `type: through`

Use for narrative beats and pacing moments where no player decision is needed. The engine shows the text and a "Continue" button, then moves to `next`.

```yaml
scenes:
  corridor:
    type: through
    text: "You walk down the dark corridor. Water drips from the ceiling above."
    next: chamber
```

#### `type: logical`

Use for invisible routing based on conditions. The player never sees this scene — the engine silently evaluates the choices in order and follows the first one whose requirements are met. Choices do not have a `label`. An `on_enter` block can still fire side effects before routing occurs.

```yaml
scenes:
  check_gem:
    type: logical
    on_enter:
      affect_attributes:
        quest_progress: "+ 1"
    choices:
      - next: good_ending
        requires_items:
          - item: magic gem
            is: owned
        gives_items:
          - hero's medal
      - next: neutral_ending
        requires_attributes:
          reputation: ">= 50"
      - next: bad_ending   # fallback — no requirements, always matches
```

> **Design note:** The last choice in a `logical` scene should typically have no requirements, acting as a guaranteed fallback. If no choice matches and there is no fallback, the engine will stall.

### Minimal scene

```yaml
scenes:
  crossroads:
    title: "The Crossroads"
    text: "Three paths lead into the forest."
    choices:
      - label: "Take the left path"
        next: left_path
      - label: "Take the right path"
        next: right_path
```

### Terminal scenes

Terminal scenes end a branch of the story — they display their text and stop. Use them for endings, death states, or any scene the player cannot leave. Attribute conditions (such as health dropping to zero) typically redirect to a terminal scene.

```yaml
scenes:
  game_over:
    assets:
      music: none
    text: "Your wounds are fatal. The darkness takes you."
    end: true
```

### `on_enter`

An optional block that fires when the player arrives at a scene, before the scene text is displayed. Useful for granting items, triggering effects, or setting up state on arrival.

```yaml
on_enter:
  message: "The door swings open with a groan."
  gives_items:
    - iron key
  removes_items:
    - torch               # consumed on entry (e.g. used to light a brazier)
  gives_notes:
    - "Found a key in the gatehouse."
  gives_sfx:
    - door_creak
    - thunder
  affect_attributes:
    health: "- 5"         # e.g. falling debris
    sanity: "- 1"
```

| Key | Type | Description |
|-----|------|-------------|
| `message` | string | Narrative text shown on arrival, before the main scene text |
| `gives_items` | string[] | Auto-grant items on entry |
| `removes_items` | string[] | Auto-consume items on entry |
| `gives_notes` | string[] | Auto-add journal entries on entry |
| `gives_sfx` | string / string[] | Play a sound effect (or list of effects) on entry |
| `affect_attributes` | object | Modify stats on entry; can trigger a scene redirect if a condition threshold is met |

### `on_revisit`

An optional block that activates when the player returns to a previously visited scene, in place of the normal scene text. Applies to any scene type. Two behaviours are available: replacing the displayed text, or silently redirecting to a different scene.

```yaml
scenes:
  # Replace the scene text on revisit
  treasure_room:
    text: "A glittering treasure room full of gold and jewels!"
    on_revisit:
      text: "The room has already been looted. Nothing remains."
    choices:
      - label: "Take the gold"
        next: rich
        gives_items:
          - gold

  # Redirect to a different scene entirely on revisit
  old_bridge:
    text: "A rickety wooden bridge spans the chasm."
    on_revisit:
      redirect: collapsed_bridge
    choices:
      - label: "Cross carefully"
        next: other_side
```

| Key | Type | Description |
|-----|------|-------------|
| `text` | string | Replaces the scene's text on revisit. The normal `choices` still apply |
| `redirect` | string | Silently navigates to a different scene ID on revisit, bypassing the current scene entirely |

> **Note:** `text` and `redirect` are mutually exclusive — use one or the other. `on_enter` still fires on revisits; `on_revisit` takes effect after it.

### Choices

The `choices` list defines the options presented to the player. Choices with unmet `requires_items` or `requires_attributes` conditions are hidden from the player entirely. In `logical` scenes, choices have no `label` and are never shown to the player — the engine selects the first matching one automatically.

```yaml
choices:
  # Basic choice
  - label: "Open the door"
    next: hallway

  # Give and remove items
  - label: "Trade the rusty key for a lantern"
    next: trader_thanks
    gives_items:
      - lantern
    removes_items:
      - rusty key

  # Grant a journal entry and play a SFX
  - label: "Examine the inscription"
    next: inscription_scene
    gives_notes:
      - "The inscription reads: 'None who seek shall find.'"
    gives_sfx: door_creak

  # Modify attributes and play multiple SFX
  - label: "Attack the guard"
    next: combat_scene
    gives_sfx:
      - sword_clash
      - thunder
    affect_attributes:
      health: "- 15"

  # Item must currently be in inventory (owned)
  - label: "Unlock the gate"
    next: courtyard
    requires_items:
      - item: iron key
        is: owned
    removes_items:
      - iron key

  # Item must NOT currently be in inventory — e.g. hide a pick-up option once collected
  - label: "Pick up the torch"
    next: lit_corridor
    requires_items:
      - item: torch
        is_not: owned

  # Item must have been obtained at some point, even if since consumed
  - label: "Tell the hermit about the key"
    next: hermit_secret
    requires_items:
      - item: rusty key
        is: obtained

  # Item must never have entered inventory — e.g. lock out a path once a one-time item is found
  - label: "Search for the gem"
    next: gem_cave
    requires_items:
      - item: magic gem
        is_not: obtained

  # Multiple item conditions (all must pass) and an attribute condition
  - label: "Navigate by map and lantern"
    next: secret_passage
    requires_items:
      - item: map
        is: owned
      - item: lantern
        is: owned

  # Require an attribute condition
  - label: "Force the door open"
    next: inner_sanctum
    requires_attributes:
      strength: ">= 7"

  # Require multiple attribute conditions (all must pass)
  - label: "Intimidate the cultist"
    next: cultist_flees
    requires_attributes:
      strength: ">= 5"
      sanity: ">= 4"

  # Range check on a single attribute
  - label: "Attempt the delicate negotiation"
    next: negotiation_success
    requires_attributes:
      jo_affection: ">= 10, <= 30"

  # Combine item requirement, attribute requirement, and stat effects
  - label: "Perform the ritual"
    next: ritual_success
    requires_items:
      - item: ancient tome
        is: owned
    requires_attributes:
      sanity: ">= 6"
    affect_attributes:
      sanity: "- 3"
      day_state: "= 2"
```

| Key | Type | Description |
|-----|------|-------------|
| `label` | string | The text shown to the player. Omitted in `logical` scenes |
| `next` | string | Scene ID to navigate to |
| `gives_items` | string[] | Add items to the player's inventory |
| `removes_items` | string[] | Consume items from the player's inventory |
| `gives_notes` | string[] | Add entries to the player's journal |
| `gives_sfx` | string / string[] | Play a sound effect on selection (single key or list) |
| `affect_attributes` | object | Modify stats when this choice is selected |
| `requires_items` | object[] | Hide this choice unless all listed item conditions pass — see [`requires_items`](#requires_items) in §3 |
| `requires_attributes` | object | Hide this choice unless all listed attribute conditions pass |

---

## 7. Example Campaign

A small but fully-featured campaign demonstrating every engine option at least once.

### metadata.yaml
```yaml
metadata:
  title: "The Ruined Keep"
  description: "Explore a crumbling fortress and survive its secrets."
  start: village_gate
  default_player_state:
    inventory: []
```

### attributes.yaml
```yaml
attributes:
  health:
    value: 100
    min: 0
    max: 100
    conditions:
      - when: "<= 0"
        message: "Your wounds are fatal."
        scene: game_over
      - when: "<= 25"
        message: "You are badly hurt."
  sanity:
    value: 10
    min: 0
    max: 10
    conditions:
      - when: "<= 0"
        message: "Your mind gives way entirely."
        scene: madness_end
      - when: "= 10"
        message: "Your thoughts are unusually clear."
  strength:
    value: 5
    min: 0
    max: 10
```

### items.yaml
```yaml
items:
  rusty key:
    description: "A small iron key, orange with age."
  cursed amulet:
    description: "It pulses with a sickly light."
    affect_attributes:
      sanity: "- 2"
  rope: "A coil of sturdy rope."
  hook: "A heavy iron hook."
  grappling hook:
    description: "Rope and hook — fashioned into a climbing tool."
  candle: "A short wax candle."
  matches: "A small box of matches."
  lit candle:
    description: "A candle with a small, wavering flame."
  ancient tome:
    description: "Dense script fills every margin."
```

### recipes.yaml
```yaml
recipes:
  - inputs:
      - candle
      - matches
    output: lit candle
    message: "You strike a match. The candle catches."

  - inputs:
      - rope
      - hook
    output: grappling hook
    message: "You lash the hook to the rope. A rough but serviceable grapple."

  - inputs:
      - grappling hook
      - lit candle
    output: spelunking kit
    message: "You bundle your tools together. Ready to descend."
```

### assets.yaml
```yaml
assets:
  images:
    village: "https://example.com/images/village.jpg"
    keep_gate: "https://example.com/images/keep_gate.jpg"
    great_hall: "https://example.com/images/great_hall.jpg"
    pit: "https://example.com/images/pit.jpg"
  music:
    theme: "https://example.com/audio/theme.mp3"
    tension: "https://example.com/audio/tension.mp3"
  sfx:
    door_creak: "https://example.com/audio/door.mp3"
    thunder: "https://example.com/audio/thunder.mp3"
    coin_clink: "https://example.com/audio/coin.mp3"
    sword_clash: "https://example.com/audio/sword.mp3"
```

### scenes.yaml
```yaml
scenes:
  village_gate:
    title: "The Village Gate"
    assets:
      image: village
      music: theme
    text: >
      The keep rises above the treeline. The villagers have given you what
      little they could spare.
    on_enter:
      message: "A cold wind carries the smell of rain."
      gives_items:
        - candle
        - matches
        - rope
      gives_notes:
        - "Set out for the keep. The villagers fear it."
      gives_sfx: thunder
      affect_attributes:
        sanity: "- 1"
    choices:
      - label: "Approach the keep"
        next: keep_gate

  keep_gate:
    title: "The Keep Gate"
    assets:
      image: keep_gate
      music: tension
    text: "The portcullis is raised. The courtyard beyond is silent."
    on_enter:
      message: "Something skitters in the shadows."
      gives_sfx:
        - door_creak
        - thunder
      affect_attributes:
        sanity: "- 1"
    choices:
      - label: "Enter the keep"
        next: great_hall
      - label: "Search the gatehouse"
        next: gatehouse

  gatehouse:
    title: "The Gatehouse"
    assets:
      image: keep_gate
    text: "A cramped room. A hook hangs on the wall. A chest sits in the corner."
    on_revisit:
      redirect: gatehouse_empty
    choices:
      - label: "Take the hook"
        next: gatehouse_hook
        gives_items:
          - hook
        gives_notes:
          - "Found a hook in the gatehouse."
        gives_sfx: coin_clink
      - label: "Open the chest"
        next: gatehouse_chest
      - label: "Leave"
        next: keep_gate

  gatehouse_empty:
    type: through
    text: "The gatehouse is bare. You've already taken everything."
    next: keep_gate

  gatehouse_chest:
    type: through
    text: >
      Inside the chest lies a strange amulet. It feels wrong to touch,
      but you pocket it anyway.
    on_enter:
      gives_items:
        - cursed amulet
      gives_notes:
        - "Found an amulet in the gatehouse chest. Something about it unsettles me."
    next: keep_gate

  gatehouse_hook:
    type: through
    text: "Hook in hand, you eye the rope you were given. You fashion a grappling hook."
    next: keep_gate

  great_hall:
    title: "The Great Hall"
    assets:
      image: great_hall
      music: tension
    text: >
      Rotting banners hang from the rafters. A pit gapes in the centre of
      the floor. A locked door stands to the north.
    choices:
      - label: "Examine the pit"
        next: pit_edge
      - label: "Unlock the north door"
        next: inner_sanctum
        requires_items:
          - item: rusty key
            is: owned
        removes_items:
          - rusty key
        gives_sfx: door_creak

  pit_edge:
    title: "The Pit"
    assets:
      image: pit
    text: "The pit drops into blackness. You can't tell how deep it goes."
    choices:
      - label: "Descend into the pit"
        next: pit_bottom
        requires_items:
          - item: grappling hook
            is: owned
          - item: lit candle
            is: owned
        removes_items:
          - grappling hook
          - lit candle
      - label: "Force yourself to peer in (risky)"
        next: pit_edge
        affect_attributes:
          sanity: "- 2"
      - label: "Go back"
        next: great_hall

  pit_bottom:
    title: "The Pit Floor"
    text: "At the bottom you find a rusty key and an ancient tome."
    on_enter:
      gives_items:
        - rusty key
        - ancient tome
      gives_notes:
        - "Recovered a key and a tome from the pit."
    on_revisit:
      text: "The pit floor is bare. You already took everything of value."
    choices:
      - label: "Climb back up"
        next: great_hall

  inner_sanctum:
    title: "The Inner Sanctum"
    assets:
      image: great_hall
      music: none
    text: "A ritual circle is carved into the stone floor."
    choices:
      - label: "Perform the ritual"
        next: ritual_success
        requires_items:
          - item: ancient tome
            is: owned
        requires_attributes:
          sanity: ">= 5"
        affect_attributes:
          sanity: "- 3"
      - label: "Smash the altar"
        next: altar_smashed
        requires_attributes:
          strength: ">= 7"
          sanity: ">= 3"
        gives_sfx: sword_clash
        affect_attributes:
          health: "- 10"

  ritual_success:
    title: "The Curse Broken"
    assets:
      music: theme
    text: "Light floods the room. The keep's curse is broken."
    choices:
      - label: "Walk into the dawn"
        next: check_outcome

  altar_smashed:
    title: "The Altar Falls"
    text: "The altar collapses in a shower of stone dust. Something lifts."
    choices:
      - label: "Leave the keep"
        next: check_outcome

  check_outcome:
    type: logical
    choices:
      - next: cursed_ending
        requires_items:
          - item: cursed amulet
            is: owned
      - next: good_ending

  good_ending:
    title: "Epilogue"
    assets:
      image: village
      music: none
    text: "You emerge into the morning light. Behind you, the keep is silent at last."
    end: true

  cursed_ending:
    title: "Epilogue"
    assets:
      music: none
    text: >
      You step into the dawn — but the amulet around your neck grows cold.
      Whatever you broke in that keep, something followed you out.
    end: true

  game_over:
    title: "Game Over"
    assets:
      music: none
    text: "You have died. The keep claims another."
    end: true

  madness_end:
    title: "Game Over"
    assets:
      music: none
    text: "They find you three days later, muttering to the stones."
    end: true
```
