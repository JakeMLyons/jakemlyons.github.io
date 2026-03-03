# Text Adventure Engine

A browser-based text adventure engine. Load a campaign, read, choose, survive (or don't). No install required.

[Link to Dashboard](http://jakemlyons.github.io "Link to dashboard")

---

## Creating Your Own Campaign

A campaign is a folder containing a required `metadata.yaml` file and one or more scene `*.yaml` files. Here's a minimal example:

```
MyAdventure/
    metadata.yaml
    scenes.yaml
```

**metadata.yaml:**

```yaml
metadata:
  title: "My Adventure"
  description: "A short description."
  tags:
    - fantasy
  start: begin
  default_player_state:
    health: 20         # optional — omit to disable health tracking entirely
    inventory: []
```

**scenes.yaml** (or split across multiple files however you like):

```yaml
scenes:
  begin:
    text: "You wake up in a strange room."
    choices:
      - label: "Look around"
        next: look
      - label: "Go back to sleep"
        next: sleep_end

  look:
    title: "The Strange Room"           # optional — shown in the map panel
    text: "You spot a rusty key on the floor."
    on_enter:
      message: "The air smells of damp stone."   # printed before scene text
      gives_notes:
        - "You woke in a strange room. Something doesn't feel right."
    choices:
      - label: "Pick up the key"
        next: have_key
        gives_items:
          - rusty key
        gives_notes:
          - "You found a rusty key on the floor of the room."
      - label: "Leave it"
        next: sleep_end

  have_key:
    text: "There's a locked door. The key might fit."
    choices:
      - label: "Use the rusty key on the door"
        next: escaped
        requires_item: "rusty key"

  escaped:
    text: "The door swings open. You're free."
    end: true

  sleep_end:
    text: "You close your eyes. You never wake up."
    end: true

items:
  rusty key: "A small iron key, orange with age. Fits most simple locks."
```

**The key things to know:**

* A campaign is always a folder. Even a single-file campaign needs a folder with `metadata.yaml` and one scene file.
* `metadata.yaml` contains only metadata — no scenes. All `*.yaml` files other than `metadata.yaml` are treated as scene files and merged into a single flat namespace.
* Scene files can be named and ordered however you like. Splitting by act, location, or chapter is encouraged for larger campaigns.
* Scene IDs must be unique across all scene files in the folder. A duplicate ID is reported as an error.
* Every scene needs a unique ID (the key under `scenes:`).
* Non-ending scenes must have at least one `choices` entry.
* `next` must match an existing scene ID exactly — scenes can reference each other freely across files.
* Mark dead-end scenes with `end: true` — no choices needed on these.
* `title` on a scene is optional and used by the map panel. Without it, the map shows the first 50 characters of the scene text.
* `gives_items` on a choice adds items to the player's inventory when that choice is selected.
* `gives_notes` on a choice (or in an `on_enter` block) adds journal entries. Duplicate entries are silently skipped.
* `requires_item` on a choice hides it from the player until they're carrying the named item. Item names are case-sensitive.
* `requires_items` (a list) hides a choice until the player holds *all* listed items. `requires_item` and `requires_items` can coexist on the same choice.
* `damage` and `heal` on a choice adjust health when that choice is selected. If health hits 0, the game ends immediately.
* `on_enter` on a scene fires automatically when the player arrives, before the scene text is shown. It supports `message`, `gives_items`, `gives_notes`, `damage`, and `heal`. Use it for environmental effects (traps, healing springs, automatic discoveries) rather than deliberate player choices.
* `default_player_state.health` sets the starting health value. Omit it entirely and health tracking is disabled for the whole campaign — `damage`, `heal`, and health effects in `on_enter` are all silently ignored.
* The `start` field in `metadata` sets which scene the game begins on.
* The optional `items:` block (in any scene file) maps item names to descriptions shown when you click an item in the inventory panel. Item descriptions are purely flavour — they have no effect on game mechanics.
* To check a campaign for errors before playing, load it in the dashboard and click **Validate**. The validator checks reachability, missing scene references, and reserved name collisions, and shows advisory warnings for items with no description.
