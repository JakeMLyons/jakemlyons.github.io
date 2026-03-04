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

// Tracks last rendered health value to detect changes for animation
let lastRenderedHealth = null;

// Prevents double-submission of choices
let stepping = false;

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

const sceneMessages   = document.getElementById('scene-messages');
const sceneText       = document.getElementById('scene-text');
const sceneChoices    = document.getElementById('scene-choices');

const inventoryList   = document.getElementById('inventory-list');
const hudHealth       = document.getElementById('hud-health');
const healthValue     = document.getElementById('health-value');
const hudArmor        = document.getElementById('hud-armor');
const armorValue      = document.getElementById('armor-value');
const hudCarry        = document.getElementById('hud-carry');
const carryValue      = document.getElementById('carry-value');

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

const loadModal       = document.getElementById('load-modal');
const loadModalBody   = document.getElementById('load-modal-body');
const loadModalClose  = document.getElementById('load-modal-close');

// ─── Initialisation ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  wireButtons();
  wireCollapsibles();
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
        msg.textContent = 'You have died. Game over.';
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

// ─── HUD rendering ────────────────────────────────────────────────────────────

function renderHUD(state) {
  renderInventory(state);
  renderHealth(state);
  renderArmor(state);
  renderCarryWeight(state);
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

    const hasDescription = itemName in (campaign?.items ?? {});

    if (hasDescription) {
      const btn = document.createElement('button');
      btn.className = 'inventory-item--clickable';
      btn.textContent = itemName;

      const descDiv = document.createElement('div');
      descDiv.className = 'item-description';

      btn.addEventListener('click', () => {
        descDiv.classList.toggle('item-description--visible');
        if (descDiv.classList.contains('item-description--visible') && !descDiv.textContent) {
          descDiv.textContent = campaign.items[itemName] || 'No further description.';
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

function renderHealth(state) {
  if (state.health === null) {
    hudHealth.classList.add('hidden');
    lastRenderedHealth = null;
  } else {
    hudHealth.classList.remove('hidden');
    const max = state.maxHealth !== null ? ` / ${state.maxHealth}` : '';
    healthValue.textContent = `${state.health}${max}`;

    if (lastRenderedHealth !== null && state.health !== lastRenderedHealth) {
      const cls = state.health < lastRenderedHealth ? 'hud-health--damage' : 'hud-health--heal';
      hudHealth.classList.remove('hud-health--damage', 'hud-health--heal');
      void hudHealth.offsetWidth; // reflow to re-trigger animation
      hudHealth.classList.add(cls);
    }
    lastRenderedHealth = state.health;
  }
}

function renderArmor(state) {
  if (!state.armor) {
    hudArmor.classList.add('hidden');
  } else {
    hudArmor.classList.remove('hidden');
    armorValue.textContent = String(state.armor);
  }
}

function renderCarryWeight(state) {
  if (state.maxCarryWeight === null) {
    hudCarry.classList.add('hidden');
  } else {
    hudCarry.classList.remove('hidden');
    const weights = campaign?.itemWeights ?? {};
    const current = state.inventory.reduce((sum, item) => sum + Number(weights[item] ?? 0), 0);
    carryValue.textContent = `${current} / ${state.maxCarryWeight}`;
  }
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


