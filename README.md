
# Text Adventure Engine

A browser-based text adventure engine. Play interactive branching stories, build your own campaigns, and embed them anywhere. No install required.

---

## Getting Started

Open **dashboard.html** in your browser (or visit the hosted version [here](http://jakemlyons.github.io "Link to dashboard"))

Five campaigns load automatically — click any card to see details, then click **Launch** to play.

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

In campaigns that track health, certain choices or locations can damage or heal you. Reach 0 health and it's game over.

### The HUD sidebar

| Panel     | What it shows                                                           |
| --------- | ----------------------------------------------------------------------- |
| Inventory | Items you're currently carrying. Click an item to read its description. |
| Health    | Your current health value. Hidden in campaigns that don't track health. |
| Journal   | Notes and discoveries accumulated during your playthrough.              |
| Map       | A list of scenes you have visited, in order.                            |

### Toolbar actions

| Button                | What it does                                                    |
| --------------------- | --------------------------------------------------------------- |
| **Look**        | Redisplay the current scene text                                |
| **Save / Load** | Open the save panel to save, restore, download, or upload saves |
| **Restart**     | Restart the campaign from the beginning                         |
| **Help**        | Show in-game help                                               |

---

## Loading Your Own Campaign

From the **Dashboard**, drag and drop a campaign folder or ZIP onto the library panel, or click **Browse** to pick one. The campaign is added to your library for this session and you can launch it at any time.

You can also load a campaign directly in the game player via the **Browse Folder** or **Upload ZIP** buttons on the drop zone.

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

The dashboard (`dashboard.html`) is the main hub for browsing and launching campaigns.

- The five bundled campaigns load automatically when the dashboard opens.
- Add your own campaigns by dragging folders or ZIPs onto the library panel.
- Click a campaign card to see its metadata, scene list, and validation status.
- Click **Launch** to open a campaign in the game player.
- Click **Edit** to open a campaign in the campaign editor.

The library holds up to 10 campaigns per session. It is not persisted — campaigns you add manually must be re-added each time you open the dashboard. Save data does persist in local storage.

---

## The Campaign Editor

Open **editor.html** to create or edit campaigns. Two modes are available, switchable at any time:

**Code mode** — Write and edit raw YAML directly. A file-tree sidebar lets you switch between files in multi-file campaigns. Line numbers are shown alongside the editor. Good for experienced authors who prefer full control.

**Visual mode** — Edit metadata, scenes, and item descriptions using forms. No YAML knowledge required. A collapsible sidebar lists all scenes so you can jump between them.

Both modes work on the same in-memory campaign. Switching modes converts the data between representations automatically.

A **Validation** panel (toggled from the toolbar) shows errors and warnings in real time: missing scene references, unreachable scenes, reserved name collisions, and more.

When you're done:

- Click **Export ZIP** to download the campaign as a `.zip` archive.
- Click **Play** to launch it directly in the game player without downloading anything.

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
  default_player_state:
    health: 20       # omit this line entirely to disable health tracking
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

**Key rules:**

- `metadata.yaml` is required and contains only metadata — no scenes.
- Scene IDs must be unique across all YAML files in the folder.
- Every non-ending scene must have at least one choice. Ending scenes have `end: true` and no choices.
- `next` on a choice must match an existing scene ID exactly.
- `gives_items` adds items to the player's inventory when a choice is selected.
- `requires_item` hides a choice until the player carries the named item (case-sensitive).
- `requires_items` (a list) hides a choice until the player holds *all* listed items.
- `damage` and `heal` on a choice adjust health immediately. Reaching 0 health ends the game.
- `on_enter` on a scene fires automatically on arrival — useful for traps, automatic discoveries, and environmental effects.
- Omitting `default_player_state.health` disables health tracking for the entire campaign.

---

## The Web Component

You can embed any campaign on your own web page using the `<text-adventure>` custom element:

```html
<script src="vendor/js-yaml.min.js"></script>
<script src="vendor/jszip.min.js"></script>
<script type="module" src="js/widget.js"></script>

<text-adventure src="https://example.com/MyAdventure.zip"></text-adventure>
```

The component runs in a shadow DOM, isolated from the host page's styles. Saves are scoped per `src` URL so multiple instances on the same page don't conflict.

Appearance is controlled via CSS custom properties:

```css
text-adventure {
    --ta-bg:     #1a1a2e;
    --ta-text:   #e0e0e0;
    --ta-accent: #c8a96e;
}
```
