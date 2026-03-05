/**
 * ui.js — DOM wiring for index.html.
 *
 * All game logic lives in engine.js and its dependencies. This module only
 * calls those functions and renders GameOutput to the DOM. It never touches
 * PlayerState directly — all state comes back through GameOutput.
 *
 * Dependency order (imports only):
 *   ui.js → engine.js → events.js, choices.js, state.js
 *   ui.js → campaign.js
 *   ui.js → persistence.js
 */

import { GameEngine } from './engine.js';
import { validateCampaign } from './campaign.js';
import {
  saveGame,
  listSaves,
  loadSaveFromStorage,
  deleteSave,
  downloadSave,
  loadSaveFromFile,
} from './persistence.js';

// ─── Module-scoped state ──────────────────────────────────────────────────────

let campaign = null;      // { metadata, scenes, items }
let engine = null;        // GameEngine instance
let currentOutput = null; // last GameOutput from start() or step()
let campaignName = '';    // folder/ZIP name for save keys
let launchedFromDashboard = false;

// Tracks whether the journal has been auto-expanded at least once this session
let journalAutoExpanded = false;

// Tracks last rendered attribute values to detect changes for animation
let lastRenderedAttributes = {};

// Prevents double-submission of choices
let stepping = false;

// Music state
let currentMusicUrl = null;
let isMuted = false;

// ─── DOM references ───────────────────────────────────────────────────────────

const gameScreen      = document.getElementById('game-screen');

const gameTitle       = document.getElementById('game-title');
const dashboardLinkGame = document.getElementById('dashboard-link-game');
const saveFeedback    = document.getElementById('save-feedback');
const saveBtn         = document.getElementById('save-btn');
const loadBtn         = document.getElementById('load-btn');
const restartBtn      = document.getElementById('restart-btn');
const helpBtn         = document.getElementById('help-btn');
const helpPanel       = document.getElementById('help-panel');
const restartConfirm  = document.getElementById('restart-confirm');
const restartYesBtn   = document.getElementById('restart-yes-btn');
const restartNoBtn    = document.getElementById('restart-no-btn');

const scenePanel      = document.getElementById('scene-panel');
const sceneMessages   = document.getElementById('scene-messages');
const sceneText       = document.getElementById('scene-text');
const sceneChoices    = document.getElementById('scene-choices');

const inventoryList   = document.getElementById('inventory-list');
const hudAttributes   = document.getElementById('hud-attributes');

const journalToggle   = document.getElementById('journal-toggle');
const journalArrow    = document.getElementById('journal-arrow');
const journalContent  = document.getElementById('journal-content');
const journalBadge    = document.getElementById('journal-badge');
const journalList     = document.getElementById('journal-list');

const mapToggle       = document.getElementById('map-toggle');
const mapArrow        = document.getElementById('map-arrow');
const mapContent      = document.getElementById('map-content');
const mapGraph        = document.getElementById('map-graph');

const historyToggle   = document.getElementById('history-toggle');
const historyArrow    = document.getElementById('history-arrow');
const historyContent  = document.getElementById('history-content');
const mapBadge        = document.getElementById('map-badge');
const mapList         = document.getElementById('map-list');

const sceneImage      = document.getElementById('scene-image');
const sceneMusic      = document.getElementById('scene-music');
const muteBtn         = document.getElementById('mute-btn');
const musicResumeBtn  = document.getElementById('music-resume-btn');

const loadModal       = document.getElementById('load-modal');
const loadModalBody   = document.getElementById('load-modal-body');
const loadModalClose  = document.getElementById('load-modal-close');

// ─── Initialisation ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  wireButtons();
  wireCollapsibles();
  wireMedia();
  checkDashboardHandoff();
});

// ─── Dashboard handoff ────────────────────────────────────────────────────────

function checkDashboardHandoff() {
  const url = new URL(window.location.href);

  if (url.searchParams.has('handoff') && typeof BroadcastChannel !== 'undefined') {
    // BroadcastChannel path: notify dashboard we're ready
    const ch = new BroadcastChannel('adventure_handoff');
    ch.postMessage({ type: 'ready' });

    const timeout = setTimeout(() => {
      ch.close();
      // Fallback: check localStorage
      tryLocalStorageHandoff();
    }, 5000);

    ch.onmessage = (e) => {
      if (e.data?.type === 'campaign') {
        clearTimeout(timeout);
        ch.close();
        launchedFromDashboard = true;
        dashboardLinkGame.classList.remove('hidden');
        receiveCampaignData(e.data.data, e.data.name);
      }
    };
  } else {
    // No handoff URL param; try localStorage fallback
    tryLocalStorageHandoff();
  }
}

function tryLocalStorageHandoff() {
  const raw = localStorage.getItem('adventure_pending_campaign');
  if (!raw) {
    window.location.replace('dashboard.html');
    return;
  }

  localStorage.removeItem('adventure_pending_campaign');
  let data;
  try { data = JSON.parse(raw); } catch { return; }

  if (!data?.campaign?.metadata || !data?.campaign?.scenes) return;

  launchedFromDashboard = true;
  dashboardLinkGame.classList.remove('hidden');
  receiveCampaignData(data.campaign, data.name);
}

async function receiveCampaignData(data, name) {
  // data is already a parsed campaign dict (not file objects)
  // Validate and start
  campaign = data;
  campaignName = name ?? campaign.metadata?.title ?? 'Campaign';
  const errors = validateCampaign(campaign);
  const hardErrors = errors.filter((r) => r.level === 'error');
  const warnings = errors.filter((r) => r.level === 'warning');

  if (hardErrors.length > 0) {
    alert('Campaign has validation errors:\n' + hardErrors.map((r) => '• ' + r.message).join('\n'));
    window.location.replace('dashboard.html');
    return;
  }

  startNewGame();
}

// ─── Game lifecycle ───────────────────────────────────────────────────────────

function startNewGame() {
  engine = new GameEngine(campaign);
  journalAutoExpanded = false;
  currentMusicUrl = null;

  // Reset collapsibles
  collapseSection('journal', true);
  collapseSection('map', true);
  collapseSection('history', true);

  const title = campaign.metadata?.title ?? 'Text Adventure';
  gameTitle.textContent = title;
  document.title = title;

  transitionToGame();
  renderOutput(engine.start());
}

function transitionToGame() {
  gameScreen.classList.add('active');
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderOutput(output) {
  currentOutput = output;

  renderAssets(output);
  renderSfx(output.sfx);
  renderMessages(output.messages);
  renderSceneText(output.sceneText);
  renderChoicesOrTerminal(output);
  renderHUD(output.state);
}

function renderMessages(messages) {
  sceneMessages.innerHTML = '';
  for (const msg of messages) {
    const div = document.createElement('div');
    div.className = 'scene-panel__message';
    div.textContent = msg;
    sceneMessages.appendChild(div);
  }
}

function renderSceneText(text) {
  renderRichText(sceneText, text);
}

/**
 * Renders text with [effect:content] inline spans into a container element.
 * Supported effects: shake, glow, flash, large.
 * Builds DOM nodes directly — never uses innerHTML with raw content.
 *
 * @param {HTMLElement} container
 * @param {string} text
 */
function renderRichText(container, text) {
  container.innerHTML = '';
  const VALID_EFFECTS = new Set(['shake', 'glow', 'flash', 'large']);
  const regex = /\[(\w+):([^\]]+)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const [fullMatch, effect, content] = match;
    if (VALID_EFFECTS.has(effect)) {
      const span = document.createElement('span');
      span.className = `ta-fx ta-fx--${effect}`;
      span.textContent = content;
      container.appendChild(span);
    } else {
      container.appendChild(document.createTextNode(fullMatch));
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

function renderChoicesOrTerminal(output) {
  sceneChoices.innerHTML = '';

  if (output.isTerminal) {
    if (output.sceneText || output.terminalReason === 'end') {
      // Scene text already rendered above; add terminal message + play again
      const term = document.createElement('div');
      term.className = 'scene-panel__terminal' +
        (output.terminalReason === 'death' ? ' scene-panel__terminal--death' : '');

      const msg = document.createElement('p');
      if (output.terminalReason === 'end') {
        msg.textContent = 'The End.';
      } else {
        msg.textContent = output.deathMessage ?? 'You have died.';
      }
      term.appendChild(msg);

      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Play Again';
      btn.addEventListener('click', () => {
        journalAutoExpanded = false;
        renderOutput(engine.start());
      });
      term.appendChild(btn);
      sceneChoices.appendChild(term);
    }
    return;
  }

  if (output.noChoices) {
    const p = document.createElement('p');
    p.className = 'scene-panel__no-choices';
    p.textContent = 'No choices available — your journey ends here.';
    sceneChoices.appendChild(p);
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

    const choiceIndex = String(i + 1);
    btn.addEventListener('click', () => {
      if (stepping) return;
      stepping = true;
      try {
        const next = engine.step(currentOutput.state, choiceIndex);
        renderOutput(next);
      } finally {
        stepping = false;
      }
    });

    sceneChoices.appendChild(btn);
  }
}

// ─── Asset rendering ──────────────────────────────────────────────────────────

function getVolume() {
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--ta-music-volume')
  ) || 1.0;
  return Math.max(0, Math.min(1, v));
}

function renderAssets(output) {
  const placement = (
    getComputedStyle(document.documentElement)
      .getPropertyValue('--ta-image-placement').trim()
  ) || 'above';

  const imageUrl = output.assets?.image;
  const showImage = typeof imageUrl === 'string' && imageUrl.length > 0;

  // Image
  if (placement === 'none') {
    sceneImage.classList.remove('scene-image--visible');
    sceneImage.src = '';
    scenePanel.style.backgroundImage = '';
    scenePanel.classList.remove('scene-panel--bg-image');
  } else if (placement === 'background') {
    sceneImage.classList.remove('scene-image--visible');
    sceneImage.src = '';
    if (showImage) {
      scenePanel.style.backgroundImage = `url(${JSON.stringify(imageUrl)})`;
      scenePanel.classList.add('scene-panel--bg-image');
    } else {
      scenePanel.style.backgroundImage = '';
      scenePanel.classList.remove('scene-panel--bg-image');
    }
  } else {
    // 'above' (default)
    scenePanel.style.backgroundImage = '';
    scenePanel.classList.remove('scene-panel--bg-image');
    if (showImage) {
      sceneImage.src = imageUrl;
      sceneImage.classList.add('scene-image--visible');
    } else {
      sceneImage.classList.remove('scene-image--visible');
      sceneImage.src = '';
    }
  }

  // Music
  const musicUrl = output.assets?.music;
  applyMusic(musicUrl);
}

function applyMusic(musicUrl) {
  const hasMusic = typeof musicUrl === 'string' && musicUrl.length > 0;
  if (hasMusic) {
    if (musicUrl === currentMusicUrl) return; // same track — seamless, do nothing
    currentMusicUrl = musicUrl;
    sceneMusic.src = musicUrl;
    sceneMusic.volume = isMuted ? 0 : getVolume();
    sceneMusic.play().then(() => {
      musicResumeBtn.classList.add('hidden');
    }).catch(() => {
      musicResumeBtn.classList.remove('hidden');
    });
  } else {
    if (currentMusicUrl !== null) {
      sceneMusic.pause();
      sceneMusic.src = '';
      currentMusicUrl = null;
    }
    musicResumeBtn.classList.add('hidden');
  }
}

function renderSfx(sfx) {
  if (!sfx?.length) return;
  const vol = isMuted ? 0 : getVolume();
  for (const url of sfx) {
    const audio = new Audio(url);
    audio.volume = vol;
    audio.play().catch(() => {
      console.warn(`[player] Failed to play sfx: ${url}`);
    });
  }
}

// ─── Media wiring (image onerror, audio error, mute, resume) ─────────────────

function wireMedia() {
  sceneImage.onerror = () => {
    console.warn(`[player] Failed to load scene image: ${sceneImage.src}`);
    sceneImage.classList.remove('scene-image--visible');
    sceneImage.src = '';
  };

  sceneMusic.addEventListener('error', () => {
    console.warn(`[player] Failed to load scene music: ${sceneMusic.src}`);
    sceneMusic.src = '';
    currentMusicUrl = null;
    musicResumeBtn.classList.add('hidden');
  });

  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
    sceneMusic.volume = isMuted ? 0 : getVolume();
  });

  musicResumeBtn.addEventListener('click', () => {
    sceneMusic.play().then(() => {
      musicResumeBtn.classList.add('hidden');
    }).catch(() => {});
  });
}

// ─── HUD rendering ────────────────────────────────────────────────────────────

function renderHUD(state) {
  renderInventory(state);
  renderAttributes(state);
  renderJournal(state);
  renderMap(state);
  if (mapContent.classList.contains('hud-collapsible__content--expanded')) {
    renderGraph(state);
  }
}

function renderInventory(state) {
  inventoryList.innerHTML = '';

  if (state.inventory.length === 0) {
    const li = document.createElement('li');
    li.className = 'inventory-item';
    li.style.color = 'var(--ta-text-muted)';
    li.style.fontStyle = 'italic';
    li.textContent = 'Empty';
    inventoryList.appendChild(li);
    return;
  }

  for (const itemName of state.inventory) {
    const li = document.createElement('li');
    li.className = 'inventory-item';

    const itemEntry = campaign?.items?.[itemName];
    const hasDescription = itemEntry != null;
    const itemDesc = typeof itemEntry === 'string' ? itemEntry : (itemEntry?.description ?? '');

    if (hasDescription) {
      const btn = document.createElement('button');
      btn.className = 'inventory-item--clickable';
      btn.textContent = itemName;

      const descDiv = document.createElement('div');
      descDiv.className = 'item-description';

      btn.addEventListener('click', () => {
        descDiv.classList.toggle('item-description--visible');
        if (descDiv.classList.contains('item-description--visible') && !descDiv.textContent) {
          descDiv.textContent = itemDesc || 'No further description.';
        }
      });

      li.appendChild(btn);
      li.appendChild(descDiv);
    } else {
      const span = document.createElement('span');
      span.textContent = itemName;
      li.appendChild(span);
    }

    // Add a separator comma for display
    inventoryList.appendChild(li);
  }
}

function renderAttributes(state) {
  const attrDefs = campaign?.metadata?.attributes ?? {};
  const attrEntries = Object.entries(attrDefs);

  if (attrEntries.length === 0) {
    hudAttributes.classList.add('hidden');
    return;
  }

  hudAttributes.classList.remove('hidden');
  hudAttributes.innerHTML = '';

  for (const [attrName, def] of attrEntries) {
    const val = state.attributes?.[attrName] ?? 0;
    const label = def.label || attrName;

    const section = document.createElement('div');
    section.className = 'hud-section hud-attr-row';
    section.dataset.attr = attrName;

    const labelDiv = document.createElement('div');
    labelDiv.className = 'hud-section__label';
    labelDiv.textContent = label;
    section.appendChild(labelDiv);

    const valueDiv = document.createElement('div');
    valueDiv.className = 'hud-section__value';
    const maxStr = def.max != null ? ` / ${def.max}` : '';
    valueDiv.textContent = `${val}${maxStr}`;
    section.appendChild(valueDiv);

    // Change animation
    const prev = lastRenderedAttributes[attrName];
    if (prev != null && val !== prev) {
      const cls = val < prev ? 'hud-attr--damage' : 'hud-attr--heal';
      section.classList.add(cls);
    }

    hudAttributes.appendChild(section);
  }

  lastRenderedAttributes = { ...state.attributes };
}

function renderJournal(state) {
  const prevCount = parseInt(journalBadge.textContent, 10) || 0;
  const newCount = state.notes.length;
  journalBadge.textContent = String(newCount);

  // Pulse badge on new note
  if (newCount > prevCount && prevCount >= 0) {
    journalBadge.classList.remove('hud-badge--pulse');
    void journalBadge.offsetWidth; // reflow to re-trigger animation
    journalBadge.classList.add('hud-badge--pulse');

    // Auto-expand on first note grant of session only
    if (!journalAutoExpanded && newCount > 0) {
      journalAutoExpanded = true;
      expandSection('journal', true);
    }
  }

  journalList.innerHTML = '';
  for (const note of state.notes) {
    const li = document.createElement('li');
    li.className = 'journal-entry';
    li.textContent = note;
    journalList.appendChild(li);
  }
}

function renderMap(state) {
  // Deduplicate with insertion-order preserved
  const deduplicated = [...new Set(state.visited)];
  mapBadge.textContent = String(deduplicated.length);

  mapList.innerHTML = '';
  for (const sceneId of deduplicated) {
    const scene = campaign?.scenes?.[sceneId];
    const label = scene?.title || (scene?.text?.slice(0, 50) ?? sceneId);
    const isCurrent = sceneId === state.sceneId;

    const li = document.createElement('li');
    li.className = 'map-entry' + (isCurrent ? ' map-entry--current' : '');
    if (scene?.text) li.title = scene.text;

    if (isCurrent) {
      const marker = document.createElement('span');
      marker.className = 'map-entry__marker';
      marker.textContent = '◄';
      li.appendChild(marker);
    }

    const nameSpan = document.createElement('span');
    nameSpan.textContent = label;
    li.appendChild(nameSpan);

    mapList.appendChild(li);
  }
}

// ─── Scene graph view ─────────────────────────────────────────────────────────

const NODE_W  = 90;
const NODE_H  = 26;
const H_GAP   = 48;   // gap between columns
const V_GAP   = 12;   // gap between rows
const GRAPH_PAD = 14; // padding around the SVG content
const SVG_NS  = 'http://www.w3.org/2000/svg';

/**
 * Compute the set of revealed scenes: all visited scenes plus their immediate
 * choice destinations (one step ahead, even if not yet visited).
 */
function computeRevealedScenes(scenes, visitedSet) {
  const revealed = new Set(visitedSet);
  for (const sceneId of visitedSet) {
    for (const choice of scenes[sceneId]?.choices ?? []) {
      if (choice.next && choice.next in scenes) revealed.add(choice.next);
    }
  }
  return revealed;
}

/**
 * BFS from startId over allowedSet; assigns {col, row} to each allowed scene.
 * Returns Map<sceneId, {col, row}>. Returns empty Map if startId not in allowedSet.
 */
function computeSceneLayout(scenes, startId, allowedSet) {
  if (!allowedSet || !allowedSet.has(startId)) return new Map();
  const assigned = new Set([startId]);
  const colOf = new Map([[startId, 0]]);
  const colRows = new Map([[0, [startId]]]);
  const queue = [startId];

  while (queue.length > 0) {
    const id = queue.shift();
    const col = colOf.get(id);
    for (const choice of scenes[id]?.choices ?? []) {
      const next = choice.next;
      if (!next || assigned.has(next) || !(next in scenes)) continue;
      if (!allowedSet.has(next)) continue;
      assigned.add(next);
      const nextCol = col + 1;
      colOf.set(next, nextCol);
      if (!colRows.has(nextCol)) colRows.set(nextCol, []);
      colRows.get(nextCol).push(next);
      queue.push(next);
    }
  }

  const positions = new Map();
  for (const [col, ids] of colRows) {
    ids.forEach((id, row) => positions.set(id, { col, row }));
  }
  return positions;
}

function renderGraph(state) {
  mapGraph.innerHTML = '';

  const scenes = campaign?.scenes ?? {};
  const startId = campaign?.metadata?.start;
  if (!startId || !(startId in scenes)) return;

  const visited  = new Set(state.visited);
  const revealed = computeRevealedScenes(scenes, visited);
  const positions = computeSceneLayout(scenes, startId, revealed);
  if (positions.size === 0) return;

  const currentId = state.sceneId;

  // SVG dimensions
  let maxCol = 0, maxRow = 0;
  for (const { col, row } of positions.values()) {
    if (col > maxCol) maxCol = col;
    if (row > maxRow) maxRow = row;
  }
  const svgW = GRAPH_PAD + (maxCol + 1) * (NODE_W + H_GAP) - H_GAP + GRAPH_PAD;
  const svgH = GRAPH_PAD + (maxRow + 1) * (NODE_H + V_GAP) - V_GAP + GRAPH_PAD;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.classList.add('map-graph__svg');

  const nodeLeft  = (col) => GRAPH_PAD + col * (NODE_W + H_GAP);
  const nodeMidY  = (row) => GRAPH_PAD + row * (NODE_H + V_GAP) + NODE_H / 2;

  // Edges (rendered first so nodes draw on top)
  for (const [id, { col, row }] of positions) {
    for (const choice of scenes[id]?.choices ?? []) {
      const pos = positions.get(choice.next);
      if (!pos) continue;
      const x1 = nodeLeft(col) + NODE_W;
      const y1 = nodeMidY(row);
      const x2 = nodeLeft(pos.col);
      const y2 = nodeMidY(pos.row);
      const mx = (x1 + x2) / 2;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
      path.classList.add('map-graph__edge');
      svg.appendChild(path);
    }
  }

  // Nodes
  for (const [id, { col, row }] of positions) {
    const x = nodeLeft(col);
    const y = GRAPH_PAD + row * (NODE_H + V_GAP);
    const isCurrent = id === currentId;
    const isVisited = visited.has(id);

    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('map-graph__node');
    if (isCurrent) g.classList.add('map-graph__node--current');
    else if (isVisited) g.classList.add('map-graph__node--visited');

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', NODE_W);
    rect.setAttribute('height', NODE_H);
    rect.setAttribute('rx', 4);
    g.appendChild(rect);

    const scene = scenes[id];
    const rawLabel = scene?.title || scene?.text || id;
    const label = rawLabel.replace(/\s+/g, ' ').slice(0, 14);
    const clipped = rawLabel.replace(/\s+/g, ' ').length > 14 ? label + '…' : label;

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', x + NODE_W / 2);
    text.setAttribute('y', y + NODE_H / 2 + 4);
    text.setAttribute('text-anchor', 'middle');
    text.classList.add('map-graph__label');
    text.textContent = clipped;
    g.appendChild(text);

    svg.appendChild(g);
  }

  mapGraph.appendChild(svg);
}

// ─── Collapsible sections ─────────────────────────────────────────────────────

function getSectionRefs(name) {
  if (name === 'journal') return { content: journalContent, arrow: journalArrow, toggle: journalToggle };
  if (name === 'map')     return { content: mapContent,     arrow: mapArrow,     toggle: mapToggle };
  if (name === 'history') return { content: historyContent, arrow: historyArrow, toggle: historyToggle };
  throw new Error(`Unknown section: ${name}`);
}

function wireCollapsibles() {
  journalToggle.addEventListener('click', () => toggleSection('journal'));
  mapToggle.addEventListener('click', () => {
    toggleSection('map');
    if (mapContent.classList.contains('hud-collapsible__content--expanded') && currentOutput) {
      renderGraph(currentOutput.state);
    }
  });
  historyToggle.addEventListener('click', () => toggleSection('history'));
}

function toggleSection(name) {
  const { content } = getSectionRefs(name);
  content.classList.contains('hud-collapsible__content--expanded')
    ? collapseSection(name, true) : expandSection(name, true);
}

function expandSection(name, updateArrow) {
  const { content, arrow, toggle } = getSectionRefs(name);
  content.classList.add('hud-collapsible__content--expanded');
  if (updateArrow) arrow.textContent = '▲';
  toggle.setAttribute('aria-expanded', 'true');
}

function collapseSection(name, updateArrow) {
  const { content, arrow, toggle } = getSectionRefs(name);
  content.classList.remove('hud-collapsible__content--expanded');
  if (updateArrow) arrow.textContent = '▼';
  toggle.setAttribute('aria-expanded', 'false');
}

// ─── Header buttons ───────────────────────────────────────────────────────────

function wireButtons() {
  document.addEventListener('keydown', (e) => {
    if (stepping) return;
    if (!currentOutput || currentOutput.isTerminal) return;
    if (loadModal.classList.contains('modal-overlay--visible')) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9) {
      const buttons = sceneChoices.querySelectorAll('.choice-btn');
      const btn = buttons[n - 1];
      if (btn) btn.click();
    }
  });

  saveBtn.addEventListener('click', handleSave);
  loadBtn.addEventListener('click', handleOpenLoadModal);
  loadModalClose.addEventListener('click', closeLoadModal);
  loadModal.addEventListener('click', (e) => {
    if (e.target === loadModal) closeLoadModal();
  });
  restartBtn.addEventListener('click', handleRestartClick);
  restartYesBtn.addEventListener('click', handleRestartConfirm);
  restartNoBtn.addEventListener('click', () => {
    restartConfirm.classList.remove('restart-confirm--visible');
  });
  helpBtn.addEventListener('click', () => {
    helpPanel.classList.toggle('help-panel--visible');
  });
}

async function handleSave() {
  if (!campaign || !currentOutput) {
    showSaveFeedback('No game in progress.', 'error');
    return;
  }

  const result = await saveGame(campaignName, currentOutput.state);

  if (!result.ok) {
    showSaveFeedback('Storage full — downloading save file.', 'error');
    downloadSave(currentOutput.state, campaignName);
    return;
  }

  if (result.quotaWarning === 'hard') {
    showSaveFeedback(
      'Game saved. Storage is almost full — download your saves now.',
      'warning',
      0
    );
  } else if (result.quotaWarning === 'soft') {
    showSaveFeedback(
      'Game saved. Storage is getting full — consider downloading saves.',
      'warning',
      0
    );
  } else {
    showSaveFeedback('Game saved.', 'success', 2000);
  }
}

function showSaveFeedback(msg, type, autoDismissMs = 0) {
  saveFeedback.textContent = msg;
  saveFeedback.className = `save-feedback save-feedback--visible save-feedback--${type}`;
  if (autoDismissMs > 0) {
    setTimeout(() => {
      saveFeedback.classList.remove('save-feedback--visible');
    }, autoDismissMs);
  }
}

async function handleOpenLoadModal() {
  loadModalBody.innerHTML = '';

  const saves = await listSaves();

  if (saves.length === 0) {
    const p = document.createElement('p');
    p.className = 'modal__empty';
    p.textContent = 'No saved games found.';
    loadModalBody.appendChild(p);
  } else {
    const list = document.createElement('div');
    list.className = 'save-list';

    for (const meta of saves) {
      const row = buildSaveRow(meta);
      list.appendChild(row);
    }
    loadModalBody.appendChild(list);
  }

  // File upload option
  const uploadRow = document.createElement('div');
  uploadRow.className = 'modal__upload-row';

  const uploadLabel = document.createElement('span');
  uploadLabel.className = 'modal__upload-label';
  uploadLabel.textContent = 'Load from file:';
  uploadRow.appendChild(uploadLabel);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json';
  fileInput.style.display = 'none';
  uploadRow.appendChild(fileInput);

  const browseBtn = document.createElement('button');
  browseBtn.className = 'btn btn--ghost btn--small';
  browseBtn.textContent = 'Upload save file…';
  browseBtn.addEventListener('click', () => fileInput.click());
  uploadRow.appendChild(browseBtn);

  const fileError = document.createElement('p');
  fileError.className = 'modal__error';
  uploadRow.appendChild(fileError);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const { campaignName: savedName, state } = await loadSaveFromFile(file);
      validateAndLoadSave(savedName, state, fileError);
    } catch (e) {
      fileError.textContent = e.message;
    }
  });

  loadModalBody.appendChild(uploadRow);
  loadModal.classList.add('modal-overlay--visible');
}

function buildSaveRow(meta) {
  const row = document.createElement('div');
  row.className = 'save-row';

  const info = document.createElement('div');
  info.className = 'save-row__info';

  const campaign = document.createElement('div');
  campaign.className = 'save-row__campaign';
  campaign.textContent = meta.campaign;
  info.appendChild(campaign);

  const metaLine = document.createElement('div');
  metaLine.className = 'save-row__meta';
  const date = new Date(meta.saved_at);
  metaLine.textContent = `${date.toLocaleString()} · Scene: ${meta.scene_id}`;
  info.appendChild(metaLine);
  row.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'save-row__actions';

  // Load button
  const loadRowBtn = document.createElement('button');
  loadRowBtn.className = 'btn btn--small';
  loadRowBtn.textContent = 'Load';
  loadRowBtn.addEventListener('click', () => {
    const rowError = row.querySelector('.modal__error') || document.createElement('p');
    try {
      const { campaignName: savedName, state } = loadSaveFromStorage(meta.key);
      validateAndLoadSave(savedName, state, rowError);
    } catch (e) {
      rowError.className = 'modal__error';
      rowError.textContent = e.message;
      row.appendChild(rowError);
    }
  });
  actions.appendChild(loadRowBtn);

  // Download button
  const dlBtn = document.createElement('button');
  dlBtn.className = 'btn btn--ghost btn--small';
  dlBtn.textContent = 'Download';
  dlBtn.addEventListener('click', () => {
    try {
      const { campaignName: savedName, state } = loadSaveFromStorage(meta.key);
      downloadSave(state, savedName);
    } catch (e) { /* ignore */ }
  });
  actions.appendChild(dlBtn);

  // Delete button
  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn--danger btn--small';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', () => {
    deleteSave(meta.key);
    row.remove();
  });
  actions.appendChild(delBtn);

  row.appendChild(actions);
  return row;
}

function validateAndLoadSave(savedName, state, errorEl) {
  // Check campaign match
  if (!campaign) {
    errorEl.textContent = 'No campaign is loaded. Load a campaign first.';
    return;
  }
  if (savedName !== campaignName) {
    errorEl.textContent = `This save is for "${savedName}", but you have "${campaignName}" loaded.`;
    return;
  }
  // Check scene_id exists
  if (!(state.sceneId in campaign.scenes)) {
    errorEl.textContent = `Scene "${state.sceneId}" does not exist in the current campaign.`;
    return;
  }

  closeLoadModal();
  journalAutoExpanded = false;
  renderOutput(engine.start(state));
}

function closeLoadModal() {
  loadModal.classList.remove('modal-overlay--visible');
}

function handleRestartClick() {
  if (!campaign) return;

  // If currently terminal, no confirmation needed
  if (currentOutput?.isTerminal) {
    doRestart();
    return;
  }

  restartConfirm.classList.add('restart-confirm--visible');
}

function handleRestartConfirm() {
  restartConfirm.classList.remove('restart-confirm--visible');
  doRestart();
}

function doRestart() {
  journalAutoExpanded = false;
  renderOutput(engine.start());
}

// ─── Theme injection ──────────────────────────────────────────────────────────

function applyTheme(cssText) {
  // Remove any previously injected campaign theme
  const existing = document.querySelector('[data-campaign-theme]');
  if (existing) existing.remove();

  if (!cssText) return;

  const style = document.createElement('style');
  style.setAttribute('data-campaign-theme', '');
  style.textContent = cssText;
  document.head.appendChild(style);
}


