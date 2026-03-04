/**
 * widget.js — <text-adventure> Web Component.
 *
 * Packages the full game player into a custom element that can be embedded
 * in any webpage with two lines of HTML:
 *
 *   <script type="module" src="widget.js"></script>
 *   <text-adventure src="https://example.com/campaigns/MyGame.zip"></text-adventure>
 *
 * The component fetches the campaign ZIP from the `src` URL, runs the same
 * loading pipeline as index.html, and renders the full game UI inside a
 * shadow DOM.
 *
 * See DESIGN-WIDGET.md for the full specification.
 */

import { GameEngine } from './engine.js';
import { PlayerState } from './state.js';
import { loadCampaign, validateCampaign } from './campaign.js';
import { saveGame, listSaves, loadSaveFromStorage, deleteSave, downloadSave } from './persistence.js';

// ─── FNV-1a 32-bit hash (for default saves-key) ───────────────────────────────

function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ─── Base CSS (inlined from style.css at registration time) ──────────────────
// Widget reads the base styles from a <link> tag in the host document if
// available, or falls back to a minimal embedded stylesheet. The host page
// can also set CSS custom properties on the <text-adventure> element to theme
// the widget (they inherit into the shadow DOM).

const WIDGET_BASE_CSS = `
:host {
  display: block;
  overflow: hidden;
  position: relative;
  --ta-bg:               #1a1a1a;
  --ta-surface:          #242424;
  --ta-surface-raised:   #2e2e2e;
  --ta-text:             #e8e8e8;
  --ta-text-muted:       #999999;
  --ta-accent:           #7a9fbf;
  --ta-accent-hover:     #9bbdd9;
  --ta-accent-text:      #ffffff;
  --ta-danger:           #c0392b;
  --ta-danger-text:      #ffffff;
  --ta-success:          #27ae60;
  --ta-warning:          #e67e22;
  --ta-border:           #333333;
  --ta-focus-ring:       #7a9fbf;
  --ta-font-body:        Georgia, 'Times New Roman', serif;
  --ta-font-ui:          system-ui, -apple-system, sans-serif;
  --ta-font-size-body:   1.05rem;
  --ta-font-size-ui:     0.9rem;
  --ta-line-height:      1.75;
  --ta-line-height-ui:   1.4;
  --ta-radius:           4px;
  --ta-radius-large:     8px;
  --ta-spacing:          1rem;
  --ta-scene-max-width:  65ch;
  --ta-hud-width:        240px;
  --ta-transition:       150ms ease;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.widget-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--ta-bg);
  color: var(--ta-text);
  font-family: var(--ta-font-ui);
  font-size: var(--ta-font-size-ui);
  line-height: var(--ta-line-height-ui);
  overflow: hidden;
}

/* Loading / error states */
.widget-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  flex-direction: column;
  gap: 1rem;
  color: var(--ta-text-muted);
  font-size: 0.9rem;
}

.widget-error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.5rem;
  text-align: center;
  color: var(--ta-text);
}

.widget-error__message { font-size: 0.85rem; color: var(--ta-text-muted); max-width: 40ch; }
.widget-error__title { font-size: 1rem; color: var(--ta-danger); }

/* Header */
.w-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background-color: var(--ta-surface);
  border-bottom: 1px solid var(--ta-border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.w-header__title {
  font-family: var(--ta-font-body);
  font-size: 0.9rem;
  font-weight: normal;
  color: var(--ta-text);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.w-header__nav { display: flex; gap: 0.3rem; flex-wrap: wrap; }

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.35em 0.7em;
  border: 1px solid var(--ta-border);
  border-radius: var(--ta-radius);
  background-color: transparent;
  color: var(--ta-text-muted);
  font-family: var(--ta-font-ui);
  font-size: 0.78rem;
  cursor: pointer;
}
.btn:hover { color: var(--ta-text); background-color: var(--ta-surface-raised); }
.btn--accent {
  background-color: var(--ta-accent);
  color: var(--ta-accent-text);
  border-color: var(--ta-accent);
}
.btn--accent:hover { background-color: var(--ta-accent-hover); border-color: var(--ta-accent-hover); }

/* Save feedback */
.save-feedback { font-size: 0.75rem; display: none; }
.save-feedback--visible { display: inline; }
.save-feedback--success { color: var(--ta-success); }
.save-feedback--warning { color: var(--ta-warning); }
.save-feedback--error { color: var(--ta-danger); }

/* Content: scene + HUD */
.w-content { display: flex; flex: 1; overflow: hidden; min-height: 0; }

/* Scene panel */
.w-scene {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.w-scene__messages { display: flex; flex-direction: column; gap: 0.3rem; }
.w-scene__message {
  font-size: 0.8rem;
  color: var(--ta-text-muted);
}
.w-scene__message::before { content: '[ '; }
.w-scene__message::after { content: ' ]'; }
.w-scene__text {
  font-family: var(--ta-font-body);
  font-size: var(--ta-font-size-body);
  line-height: var(--ta-line-height);
  color: var(--ta-text);
  white-space: pre-wrap;
}
.w-scene__choices { display: flex; flex-direction: column; gap: 0.4rem; }

.choice-btn {
  display: block;
  width: 100%;
  padding: 0.5em 0.75em;
  text-align: left;
  background-color: var(--ta-surface);
  border: 1px solid var(--ta-border);
  border-radius: var(--ta-radius);
  color: var(--ta-accent);
  font-family: var(--ta-font-ui);
  font-size: var(--ta-font-size-ui);
  cursor: pointer;
}
.choice-btn:hover {
  background-color: var(--ta-surface-raised);
  border-color: var(--ta-accent);
}
.choice-btn .choice-num { font-weight: 600; margin-right: 0.4em; }

.w-scene__terminal {
  font-family: var(--ta-font-body);
  font-size: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.w-scene__terminal--death { color: var(--ta-danger); }
.w-scene__no-choices { font-size: 0.85rem; color: var(--ta-text-muted); font-style: italic; }

/* HUD panel */
.w-hud {
  width: var(--ta-hud-width);
  flex-shrink: 0;
  border-left: 1px solid var(--ta-border);
  background-color: var(--ta-surface);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  font-size: 0.82rem;
}
.w-hud-section {
  border-bottom: 1px solid var(--ta-border);
  padding: 0.5rem 0.75rem;
}
.w-hud-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ta-text-muted);
  margin-bottom: 0.3em;
}
.w-hud-value { color: var(--ta-text); }

.inv-item--clickable {
  color: var(--ta-accent);
  cursor: pointer;
  background: none;
  border: none;
  font-family: var(--ta-font-ui);
  font-size: 0.82rem;
  text-decoration: underline dotted;
  padding: 0;
}
.inv-item--clickable:hover { color: var(--ta-accent-hover); }
.item-desc {
  margin-top: 0.3em;
  font-size: 0.76rem;
  color: var(--ta-text-muted);
  font-style: italic;
  padding: 0.3em 0.4em;
  border-left: 2px solid var(--ta-border);
  display: none;
}
.item-desc--visible { display: block; }

/* Collapsible */
.w-collapsible { border-bottom: 1px solid var(--ta-border); }
.w-collapsible__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.45rem 0.75rem;
  cursor: pointer;
  background: none;
  border: none;
  width: 100%;
  text-align: left;
  color: var(--ta-text);
  font-family: var(--ta-font-ui);
  font-size: var(--ta-font-size-ui);
}
.w-collapsible__header:hover { background-color: var(--ta-surface-raised); }
.w-collapsible__title {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ta-text-muted);
  display: flex;
  align-items: center;
  gap: 0.4em;
}
.w-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.3em;
  height: 1.3em;
  padding: 0 0.3em;
  border-radius: 999px;
  background-color: var(--ta-accent);
  color: var(--ta-accent-text);
  font-size: 0.65rem;
  font-weight: 700;
}
.w-collapsible__content { overflow: hidden; max-height: 0; padding: 0 0.75rem; }
.w-collapsible__content--expanded { max-height: 400px; padding-bottom: 0.5rem; }

.w-journal-list { list-style: none; padding-top: 0.3em; display: flex; flex-direction: column; gap: 0.4em; counter-reset: jc; }
.w-journal-entry { font-size: 0.78rem; color: var(--ta-text); padding-left: 1.2em; position: relative; line-height: 1.4; }
.w-journal-entry::before { content: counter(jc) '.'; counter-increment: jc; position: absolute; left: 0; color: var(--ta-text-muted); font-size: 0.72rem; }

.w-map-list { list-style: none; padding-top: 0.3em; display: flex; flex-direction: column; gap: 0.25em; }
.w-map-entry { font-size: 0.78rem; color: var(--ta-text-muted); display: flex; align-items: baseline; gap: 0.3em; }
.w-map-entry--current { color: var(--ta-accent); font-weight: 500; }

.hidden { display: none !important; }
`;

// ─── Web Component ────────────────────────────────────────────────────────────

class TextAdventureElement extends HTMLElement {
  static get observedAttributes() {
    return ['src', 'saves-key', 'autoplay'];
  }

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: 'open' });
    this._engine = null;
    this._campaign = null;
    this._campaignName = '';
    this._currentOutput = null;
    this._savesKey = null;
    this._stepping = false;
    this._journalAutoExpanded = false;
    this._abortController = null;
    this._pendingState = null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  connectedCallback() {
    this._autoplay = this.hasAttribute('autoplay');
    this._loadCampaign();
  }

  disconnectedCallback() {
    this._abortController?.abort();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === 'src' && oldVal !== newVal && this.isConnected) {
      this._abortController?.abort();
      this._loadCampaign();
    }
  }

  // ── Public JS API ──────────────────────────────────────────────────────────

  getSaveState() {
    if (!this._currentOutput) return null;
    return this._currentOutput.state.toDict();
  }

  loadSaveState(stateDict) {
    if (!this._campaign) throw new Error('No campaign loaded');
    if (typeof stateDict !== 'object' || !stateDict?.scene_id) {
      throw new TypeError('stateDict must be a valid save object with scene_id');
    }
    if (!(stateDict.scene_id in this._campaign.scenes)) {
      throw new RangeError(`scene_id "${stateDict.scene_id}" not found in campaign`);
    }
    this._pendingState = PlayerState.fromDict(stateDict);
  }

  resetGame() {
    if (!this._engine) return;
    this._journalAutoExpanded = false;
    this._renderOutput(this._engine.start());
  }

  // ── Campaign loading ───────────────────────────────────────────────────────

  async _loadCampaign() {
    const src = this.getAttribute('src');
    if (!src) {
      this._showError('No campaign URL provided.', 'No src attribute');
      return;
    }

    this._showLoading();
    this._abortController = new AbortController();

    try {
      const response = await fetch(src, { signal: this._abortController.signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch campaign: HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);

      const files = [];
      for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        const name = relativePath.split('/').pop();
        if (!name.endsWith('.yaml') && name !== 'theme.css') continue;
        const text = await zipEntry.async('string');
        files.push({ path: relativePath, text });
      }

      this._campaign = await loadCampaign(files);
      this._campaignName = src.split('/').pop().replace(/\.zip$/i, '');

      // Determine saves key
      const savesKeyAttr = this.getAttribute('saves-key');
      this._savesKey = savesKeyAttr ?? `adventure_saves_w_${fnv1a32(src)}:`;

      // Inject theme.css if present
      const themeFile = files.find((f) => f.path.endsWith('theme.css'));
      this._themeText = themeFile?.text ?? null;
      this._applyTheme(this._themeText);

      // Build engine
      this._engine = new GameEngine(this._campaign);

      // Dispatch adventure:beforestart — callers can delay engine.start via waitUntil()
      const pending = [];
      const beforeStartEvent = new CustomEvent('adventure:beforestart', {
        bubbles: true,
        detail: {
          campaign: this._campaign,
          waitUntil: (p) => pending.push(p),
        },
      });
      this.dispatchEvent(beforeStartEvent);
      await Promise.all(pending);

      // Start game (use pendingState if loadSaveState was called in beforestart)
      const output = this._engine.start(this._pendingState ?? null);
      this._pendingState = null;

      this._buildGameUI();
      this._renderOutput(output);

      this.dispatchEvent(new CustomEvent('adventure:ready', {
        bubbles: true,
        detail: { campaign: this._campaign },
      }));

    } catch (e) {
      if (e.name === 'AbortError') return; // intentional abort on src change

      this._showError(e.message, 'Load failed');
      this.dispatchEvent(new CustomEvent('adventure:error', {
        bubbles: true,
        detail: { message: e.message, error: e },
      }));
    }
  }

  // ── Shadow DOM UI ──────────────────────────────────────────────────────────

  _showLoading() {
    this._shadow.innerHTML = '';
    this._injectBaseStyles();

    if (this._autoplay) return; // suppress loading indicator

    const root = document.createElement('div');
    root.className = 'widget-root';
    const loading = document.createElement('div');
    loading.className = 'widget-loading';
    loading.textContent = 'Loading campaign…';
    root.appendChild(loading);
    this._shadow.appendChild(root);
  }

  _showError(message, title = 'Error') {
    this._shadow.innerHTML = '';
    this._injectBaseStyles();

    const root = document.createElement('div');
    root.className = 'widget-root';
    const errDiv = document.createElement('div');
    errDiv.className = 'widget-error';

    const h = document.createElement('p');
    h.className = 'widget-error__title';
    h.textContent = title;
    errDiv.appendChild(h);

    const p = document.createElement('p');
    p.className = 'widget-error__message';
    p.textContent = message;
    errDiv.appendChild(p);

    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn btn--accent';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => this._loadCampaign());
    errDiv.appendChild(retryBtn);

    root.appendChild(errDiv);
    this._shadow.appendChild(root);
  }

  _injectBaseStyles() {
    const style = document.createElement('style');
    style.textContent = WIDGET_BASE_CSS;
    this._shadow.appendChild(style);
  }

  _applyTheme(cssText) {
    const existing = this._shadow.querySelector('[data-campaign-theme]');
    if (existing) existing.remove();
    if (!cssText) return;
    const style = document.createElement('style');
    style.setAttribute('data-campaign-theme', '');
    style.textContent = cssText;
    this._shadow.appendChild(style);
  }

  _buildGameUI() {
    // Clear shadow root and rebuild
    this._shadow.innerHTML = '';
    this._injectBaseStyles();
    // Re-inject theme if present
    if (this._themeText) this._applyTheme(this._themeText);

    const root = document.createElement('div');
    root.className = 'widget-root';

    // Header
    const header = document.createElement('header');
    header.className = 'w-header';
    const titleEl = document.createElement('h1');
    titleEl.className = 'w-header__title';
    titleEl.textContent = this._campaign.metadata?.title ?? 'Text Adventure';
    header.appendChild(titleEl);

    const nav = document.createElement('nav');
    nav.className = 'w-header__nav';

    const saveFb = document.createElement('span');
    saveFb.className = 'save-feedback';
    this._saveFeedback = saveFb;
    nav.appendChild(saveFb);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => this._handleSave());
    nav.appendChild(saveBtn);

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => this._handleLoad());
    nav.appendChild(loadBtn);

    const restartBtn = document.createElement('button');
    restartBtn.className = 'btn';
    restartBtn.textContent = 'Restart';
    restartBtn.addEventListener('click', () => this.resetGame());
    nav.appendChild(restartBtn);

    header.appendChild(nav);
    root.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.className = 'w-content';

    // Scene panel
    const scene = document.createElement('main');
    scene.className = 'w-scene';
    this._sceneMessages = document.createElement('div');
    this._sceneMessages.className = 'w-scene__messages';
    this._sceneText = document.createElement('p');
    this._sceneText.className = 'w-scene__text';
    this._sceneChoices = document.createElement('div');
    this._sceneChoices.className = 'w-scene__choices';
    scene.appendChild(this._sceneMessages);
    scene.appendChild(this._sceneText);
    scene.appendChild(this._sceneChoices);
    content.appendChild(scene);

    // HUD panel
    const hud = document.createElement('aside');
    hud.className = 'w-hud';

    // Inventory
    const invSection = document.createElement('div');
    invSection.className = 'w-hud-section';
    const invLabel = document.createElement('div');
    invLabel.className = 'w-hud-label';
    invLabel.textContent = 'Inventory';
    this._inventoryList = document.createElement('ul');
    this._inventoryList.style.listStyle = 'none';
    invSection.appendChild(invLabel);
    invSection.appendChild(this._inventoryList);
    hud.appendChild(invSection);

    // Attributes (generic — populated dynamically on each render)
    this._hudAttributes = document.createElement('div');
    this._hudAttributes.className = 'w-hud-attributes';
    hud.appendChild(this._hudAttributes);

    // Journal collapsible
    const journal = this._buildCollapsible('Journal');
    this._journalBadge = journal.badge;
    this._journalToggle = journal.toggle;
    this._journalContent = journal.content;
    this._journalList = document.createElement('ol');
    this._journalList.className = 'w-journal-list';
    journal.content.appendChild(this._journalList);
    hud.appendChild(journal.container);

    // Map collapsible
    const map = this._buildCollapsible('Map');
    this._mapBadge = map.badge;
    this._mapToggle = map.toggle;
    this._mapContent = map.content;
    this._mapList = document.createElement('ul');
    this._mapList.className = 'w-map-list';
    map.content.appendChild(this._mapList);
    hud.appendChild(map.container);

    content.appendChild(hud);
    root.appendChild(content);
    this._shadow.appendChild(root);
  }

  _buildCollapsible(title) {
    const container = document.createElement('div');
    container.className = 'w-collapsible';

    const toggle = document.createElement('button');
    toggle.className = 'w-collapsible__header';
    toggle.setAttribute('aria-expanded', 'false');

    const titleSpan = document.createElement('span');
    titleSpan.className = 'w-collapsible__title';
    titleSpan.textContent = title + ' ';

    const badge = document.createElement('span');
    badge.className = 'w-badge';
    badge.textContent = '0';
    titleSpan.appendChild(badge);

    const arrow = document.createElement('span');
    arrow.textContent = '▼';

    toggle.appendChild(titleSpan);
    toggle.appendChild(arrow);

    const content = document.createElement('div');
    content.className = 'w-collapsible__content';

    toggle.addEventListener('click', () => {
      const expanded = content.classList.toggle('w-collapsible__content--expanded');
      arrow.textContent = expanded ? '▲' : '▼';
      toggle.setAttribute('aria-expanded', String(expanded));
    });

    container.appendChild(toggle);
    container.appendChild(content);
    return { container, toggle, content, badge, arrow };
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  _renderOutput(output) {
    this._currentOutput = output;
    this._renderMessages(output.messages);
    this._sceneText.textContent = output.sceneText;
    this._renderChoices(output);
    this._renderHUD(output.state);

    if (output.isTerminal) {
      this.dispatchEvent(new CustomEvent('adventure:terminal', {
        bubbles: true,
        detail: { reason: output.terminalReason, state: output.state },
      }));
    }
  }

  _renderMessages(messages) {
    this._sceneMessages.innerHTML = '';
    for (const msg of messages) {
      const div = document.createElement('div');
      div.className = 'w-scene__message';
      div.textContent = msg;
      this._sceneMessages.appendChild(div);
    }
  }

  _renderChoices(output) {
    this._sceneChoices.innerHTML = '';

    if (output.isTerminal) {
      const term = document.createElement('div');
      term.className = 'w-scene__terminal' +
        (output.terminalReason === 'death' ? ' w-scene__terminal--death' : '');
      const msg = document.createElement('p');
      msg.textContent = output.terminalReason === 'end'
        ? 'The End.'
        : 'You have died. Game over.';
      term.appendChild(msg);

      const btn = document.createElement('button');
      btn.className = 'btn btn--accent';
      btn.textContent = 'Play Again';
      btn.addEventListener('click', () => this.resetGame());
      term.appendChild(btn);
      this._sceneChoices.appendChild(term);
      return;
    }

    if (output.noChoices) {
      const p = document.createElement('p');
      p.className = 'w-scene__no-choices';
      p.textContent = 'No choices available — your journey ends here.';
      this._sceneChoices.appendChild(p);
      return;
    }

    for (let i = 0; i < output.choices.length; i++) {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';

      const numSpan = document.createElement('span');
      numSpan.className = 'choice-num';
      numSpan.textContent = `${i + 1}.`;
      btn.appendChild(numSpan);
      btn.appendChild(document.createTextNode(output.choices[i]));

      const idx = String(i + 1);
      btn.addEventListener('click', () => {
        if (this._stepping) return;
        this._stepping = true;
        try {
          const next = this._engine.step(this._currentOutput.state, idx);
          this._renderOutput(next);
          this.dispatchEvent(new CustomEvent('adventure:step', {
            bubbles: true,
            detail: { state: next.state, output: next },
          }));
        } finally {
          this._stepping = false;
        }
      });

      this._sceneChoices.appendChild(btn);
    }
  }

  _renderHUD(state) {
    // Inventory
    this._inventoryList.innerHTML = '';
    if (state.inventory.length === 0) {
      const li = document.createElement('li');
      li.style.cssText = 'color:var(--ta-text-muted);font-style:italic;font-size:0.82rem;';
      li.textContent = 'Empty';
      this._inventoryList.appendChild(li);
    } else {
      for (const itemName of state.inventory) {
        const li = document.createElement('li');
        const hasDesc = itemName in (this._campaign?.items ?? {});
        if (hasDesc) {
          const btn = document.createElement('button');
          btn.className = 'inv-item--clickable';
          btn.textContent = itemName;
          const desc = document.createElement('div');
          desc.className = 'item-desc';
          btn.addEventListener('click', () => {
            desc.classList.toggle('item-desc--visible');
            if (!desc.textContent) {
              const itemEntry = this._campaign.items[itemName];
              const itemDesc = typeof itemEntry === 'string' ? itemEntry : (itemEntry?.description ?? '');
              desc.textContent = itemDesc || 'No further description.';
            }
          });
          li.appendChild(btn);
          li.appendChild(desc);
        } else {
          li.style.fontSize = '0.82rem';
          li.textContent = itemName;
        }
        this._inventoryList.appendChild(li);
      }
    }

    // Attributes
    this._hudAttributes.innerHTML = '';
    const attrDefs = this._campaign?.metadata?.attributes ?? {};
    for (const [attrName, def] of Object.entries(attrDefs)) {
      const val = state.attributes?.[attrName] ?? 0;
      const label = def.label ?? attrName;
      const maxStr = def.max != null ? ` / ${Number(def.max)}` : '';
      const row = document.createElement('div');
      row.className = 'w-hud-section';
      const rowLabel = document.createElement('div');
      rowLabel.className = 'w-hud-label';
      rowLabel.textContent = label;
      const rowValue = document.createElement('div');
      rowValue.className = 'w-hud-value';
      rowValue.textContent = `${val}${maxStr}`;
      row.appendChild(rowLabel);
      row.appendChild(rowValue);
      this._hudAttributes.appendChild(row);
    }
    if (Object.keys(attrDefs).length === 0) {
      this._hudAttributes.classList.add('hidden');
    } else {
      this._hudAttributes.classList.remove('hidden');
    }

    // Journal
    const prevNotes = parseInt(this._journalBadge.textContent, 10) || 0;
    const newNotes = state.notes.length;
    this._journalBadge.textContent = String(newNotes);
    if (newNotes > prevNotes && !this._journalAutoExpanded && newNotes > 0) {
      this._journalAutoExpanded = true;
      this._journalContent.classList.add('w-collapsible__content--expanded');
    }
    this._journalList.innerHTML = '';
    for (const note of state.notes) {
      const li = document.createElement('li');
      li.className = 'w-journal-entry';
      li.textContent = note;
      this._journalList.appendChild(li);
    }

    // Map
    const deduped = [...new Set(state.visited)];
    this._mapBadge.textContent = String(deduped.length);
    this._mapList.innerHTML = '';
    for (const sceneId of deduped) {
      const scene = this._campaign?.scenes?.[sceneId];
      const label = scene?.title || scene?.text?.slice(0, 50) || sceneId;
      const isCurrent = sceneId === state.sceneId;
      const li = document.createElement('li');
      li.className = 'w-map-entry' + (isCurrent ? ' w-map-entry--current' : '');
      if (isCurrent) {
        const marker = document.createElement('span');
        marker.textContent = '◄ ';
        li.appendChild(marker);
      }
      li.appendChild(document.createTextNode(label));
      this._mapList.appendChild(li);
    }
  }

  // ── Save / Load ────────────────────────────────────────────────────────────

  async _handleSave() {
    if (!this._currentOutput) return;
    const result = await saveGame(
      this._campaignName,
      this._currentOutput.state,
      this._savesKey
    );
    if (!result.ok) {
      this._showSaveFeedback('Storage full — downloading save.', 'error');
      downloadSave(this._currentOutput.state, this._campaignName);
    } else if (result.quotaWarning) {
      this._showSaveFeedback('Saved. Storage is getting full.', 'warning', 0);
    } else {
      this._showSaveFeedback('Game saved.', 'success', 2000);
    }
  }

  async _handleLoad() {
    const saves = await listSaves(this._savesKey);
    if (saves.length === 0) {
      this._showSaveFeedback('No saved games found.', 'warning', 3000);
      return;
    }
    // Load the most recent save for this campaign
    const match = saves.find((s) => s.campaign === this._campaignName);
    if (!match) {
      this._showSaveFeedback('No saves for this campaign.', 'warning', 3000);
      return;
    }
    try {
      const { state } = loadSaveFromStorage(match.key);
      if (!(state.sceneId in this._campaign.scenes)) {
        this._showSaveFeedback('Save scene not found in campaign.', 'error', 3000);
        return;
      }
      this._journalAutoExpanded = false;
      this._renderOutput(this._engine.start(state));
    } catch (e) {
      this._showSaveFeedback(e.message, 'error', 3000);
    }
  }

  _showSaveFeedback(msg, type, autoDismissMs = 0) {
    if (!this._saveFeedback) return;
    this._saveFeedback.textContent = msg;
    this._saveFeedback.className = `save-feedback save-feedback--visible save-feedback--${type}`;
    if (autoDismissMs > 0) {
      setTimeout(() => {
        this._saveFeedback?.classList.remove('save-feedback--visible');
      }, autoDismissMs);
    }
  }
}

// ─── Register the custom element ──────────────────────────────────────────────

customElements.define('text-adventure', TextAdventureElement);
