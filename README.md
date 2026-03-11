# Text Adventure Engine

A browser-based text adventure engine. Play interactive branching stories, build your own campaigns, and embed them anywhere. No install required.

---

## Getting Started

Open **dashboard.html** in your browser (or visit the hosted version [here](http://jakemlyons.github.io "Link to dashboard"))

Switch to the **Community** tab to browse published campaigns. Click any card to see details in the left panel, then click **▶ Play** to launch it.

> **Tip:** If you're running this locally, serve the folder with a static file server rather than opening files directly. Browser security restrictions can block local file loading.
>
> ```bash
> python -m http.server 8080
> # then open http://localhost:8080
> ```

---

## Playing a Campaign

### The basics

When a scene loads, you'll see story text followed by a list of choices. Click a choice to advance. Some choices only appear if you're carrying the right item — explore carefully and pick things up when you can.

In campaigns that track attributes like health, certain choices or locations can change those values. If a stat reaches its minimum value (e.g. health hits 0), the game ends.

### The HUD sidebar

The sidebar is resizable — drag its right edge to adjust the width (persisted across sessions).

| Panel      | What it shows                                                                           |
| ---------- | --------------------------------------------------------------------------------------- |
| Inventory  | Items you're currently carrying. Click an item to read its description. Items may show an icon if the campaign provides one. |
| Attributes | Stats tracked by the campaign (e.g. Health, Carry Weight). Hidden if none are defined.  |
| Journal    | Notes and discoveries accumulated during your playthrough.                              |
| History    | Scenes you have visited, in order. Click any entry to reveal its full text.             |
| Map        | A graph view of explored scenes and their connections.                                  |

### Toolbar actions

| Button          | What it does                                                    |
| --------------- | --------------------------------------------------------------- |
| **Save**        | Save your current position                                      |
| **Load**        | Open the load panel to restore, download, or upload saves       |
| **Restart**     | Restart the campaign from the beginning                         |
| **Mute**        | Toggle music and sound effects                                  |
| **Help**        | Show in-game help                                               |

---

## Loading Your Own Campaign

From the **Dashboard**, click **Upload ZIP** in the My Campaigns toolbar and select a campaign ZIP file. The campaign opens immediately in the editor, where you can review and play it.

---

## Saving Your Progress

Saves are stored in your browser's local storage, named after the campaign and the time they were created. They persist across sessions as long as you don't clear your browser's site data.

From the **Save / Load** panel you can:

- **Save** — save your current position
- **Load** — restore a previous save
- **Download** — export a save as a `.json` file (useful for backup or moving between devices)
- **Upload** — import a previously downloaded `.json` save

> **Note:** Clearing browser storage (cookies, site data, local storage) will delete your saves. Download important saves if you want to keep them long-term.

---

## The Dashboard

The dashboard (`dashboard.html`) is the main hub for browsing, creating, and publishing campaigns. It has three tabs:

**My Campaigns** — your local tools and published campaigns.
- Click the **+** card to create a new campaign in the editor.
- If you have a saved editor draft, it appears as a card here — click it to play, continue editing, or discard it.
- Click **Upload ZIP** to open any campaign ZIP in the editor (no sign-in required).
- Sign in to see your published campaigns. Click a card to open its detail panel (left side), where you can edit the title, description, public/NSFW toggles, and view **Version History**. Up to five previous versions are kept automatically — click **Restore** to roll back. Action buttons: **▶ Play**, **✎ Open in Editor**, **Delete Campaign**.
- Click **↺ Refresh** to reload your published campaigns from the platform.

**Community** — publicly published campaigns from all users.
- Click any card to see its details (author, description, feature badges) and **▶ Play** it.
- Sign in to vote (▲) or report campaigns.

**Admin** — visible only to users with `is_admin = true` in their profile. Lists unresolved content reports with Resolve and Delete Campaign actions.

Campaign cards show feature badges (⚙ attributes, ⚔ items, ⚗ recipes, ♫ assets, ✐ journal) for a quick overview of what a campaign uses.

The detail panel on the left is resizable — drag the divider to adjust its width (persisted across sessions). Clicking a card a second time deselects it.

---

## The Campaign Editor

Open **editor.html** to create or edit campaigns. Three modes are available, switchable at any time:

**Code mode** — Write and edit raw YAML directly. A file-tree sidebar lets you switch between files in multi-file campaigns. Line numbers are shown alongside the editor. Good for experienced authors who prefer full control.

**Form mode** — Edit metadata, attributes, scenes, item descriptions, and assets using forms. No YAML knowledge required. The sidebar has sections — **Metadata**, **Attributes**, **Items**, **Assets**, and **Scenes** — each opening the relevant form. Choices are expanded by default with **Expand All** / **Collapse All** buttons. Each choice has a **→** button next to "Next scene" to jump to the target scene. The `affect_attributes` section is collapsible.

**Visual mode** — A Cytoscape.js flowchart showing how all scenes connect. Click any node to open that scene in Form mode. Right-click a node for context actions (edit, rename, set start, delete). Double-click the canvas to create a new scene.

All three modes work on the same in-memory campaign. Switching converts the data between representations automatically.

A **Validation** panel (toggled from the toolbar) shows errors and warnings in real time: missing scene references, unreachable scenes, reserved name collisions, and more.

When you're done:

- Click **Export ZIP** to download the campaign as a `.zip` archive.
- Click **Play** to launch it directly in the game player without downloading anything.
- Click **Publish** to upload the campaign to the community platform (requires a free account). If you have existing published campaigns, a modal lets you choose to update one of them or publish as a new entry.

---

## Creating Your Own Campaign

A campaign is a folder containing a `metadata.yaml` file and one or more scene `*.yaml` files. You can write these by hand or use the **Visual mode** in the editor.

**Minimal structure:**

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
  start: begin
  attributes:          # optional — omit entirely if you don't need stat tracking
    health:
      value: 20        # starting value
      min: 0           # reaching this ends the game
      label: "Health"
  inventory: []
```

**scenes.yaml:**

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
    text: "You spot a rusty key on the floor."
    choices:
      - label: "Pick up the key"
        next: have_key
        gives_items:
          - rusty key
      - label: "Leave it"
        next: sleep_end

  have_key:
    text: "There's a locked door. The key might fit."
    choices:
      - label: "Use the key"
        next: escaped
        requires_item: "rusty key"

  escaped:
    text: "The door swings open. You're free."
    end: true

  sleep_end:
    text: "You close your eyes. You never wake up."
    end: true

items:
  rusty key: "A small iron key, orange with age."
```

Items can also use the extended format with an icon (from `assets.images`) and attribute effects:

```yaml
items:
  lantern:
    description: "A tin lantern with a cracked glass panel."
    icon: "lantern_icon"          # optional — shown in inventory
    affect_attributes:
      carry_weight: 3
```

**Key rules:**

- `metadata.yaml` is required and contains only metadata — no scenes.
- Scene IDs must be unique across all YAML files in the folder.
- Every non-ending scene must have at least one choice. Ending scenes have `end: true` and no choices.
- `next` on a choice must match an existing scene ID exactly.
- `gives_items` adds items to the player's inventory when a choice is selected.
- `requires_item` hides a choice until the player carries the named item (case-sensitive).
- `requires_items` (a list) hides a choice until the player holds *all* listed items.
- `affect_attributes` on a choice applies numeric deltas to named attributes. If any attribute reaches its declared `min`, the game ends before entering the next scene.
- `on_enter` on a scene fires automatically on arrival — useful for traps, automatic discoveries, and environmental effects. It also supports `affect_attributes`.
- Omitting the `attributes:` block in `metadata.yaml` disables all stat tracking for the entire campaign.

### Assets (images, music, sound effects)

Campaigns can optionally declare media assets in an `assets.yaml` file (or any scene YAML file). Assets are registered once in typed buckets and referenced by key from individual scenes and choices.

**assets.yaml:**

```yaml
assets:
  images:
    shore_stormy:      "assets/shore-stormy.jpg"
    lighthouse_inside: "assets/lighthouse-inside.jpg"
  music:
    wind_and_waves:    "assets/wind-and-waves.mp3"
    iron_creak:        "assets/iron-creak.mp3"
  sfx:
    chest_creak:       "assets/sfx/chest-creak.mp3"
    coin_jingle:       "assets/sfx/coins.mp3"
```

Asset keys follow the same conventions as item names: lowercase, underscores, unique within their bucket. The key `none` is reserved.

**Scene-level assets** — declare which image to show and which music to loop on entry:

```yaml
  shore:
    text: "You claw your way onto wet rocks..."
    assets:
      image: shore_stormy    # key from assets.images
      music: wind_and_waves  # key from assets.music
```

Set a value to `none` to explicitly clear the image or silence the music on a scene:

```yaml
  dream_sequence:
    text: "Everything goes white and silent..."
    assets:
      image: none
      music: none
```

**Sound effects** — one-shot audio triggered on a choice or scene entry, via `gives_sfx`:

```yaml
  treasury:
    text: "The chest swings open."
    on_enter:
      gives_sfx: chest_creak         # plays on entry
    choices:
      - label: "Take the gold"
        next: escape_hall
        gives_sfx: coin_jingle       # plays when this choice is made
```

`gives_sfx` accepts a single key string or a list of keys (all play simultaneously). Assets are entirely optional — omitting the `assets` block on a scene clears any image and stops any music.

