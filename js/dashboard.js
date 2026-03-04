/**
 * dashboard.js — DOM wiring for dashboard.html.
 *
 * Self-contained module. Imports only from campaign.js — not from engine.js,
 * ui.js, persistence.js, or widget.js.
 *
 * Manages an in-memory library of up to 10 loaded campaign objects.
 * The library is NOT persisted to localStorage — campaigns must be
 * re-uploaded each browser session.
 */

import { loadCampaign, validateCampaign } from './campaign.js';

// ─── Module-scoped state ──────────────────────────────────────────────────────

/**
 * @type {{ id: string, name: string, campaign: object,
 *          validation: {level: string, message: string}[], loadedAt: Date }[]}
 */
let library = [];
let selectedId = null;
const MAX_LIBRARY = 10;
const OVERFLOW_FADE_MS = 4000;
const PACKAGED_CAMPAIGNS_BASE_URL = 'https://jakemlyons.github.io/campaigns/';

// ─── DOM references ───────────────────────────────────────────────────────────

const newCampaignBtn    = document.getElementById('new-campaign-btn');
const loadCampaignBtn   = document.getElementById('load-campaign-btn');
const loadSubpanel      = document.getElementById('load-subpanel');
const subpanelDropZone  = document.getElementById('subpanel-drop-zone');
const subpanelBrowseBtn = document.getElementById('subpanel-browse-btn');
const subpanelFolderInput = document.getElementById('subpanel-folder-input');
const subpanelZipBtn    = document.getElementById('subpanel-zip-btn');
const subpanelZipInput  = document.getElementById('subpanel-zip-input');
const subpanelStatus    = document.getElementById('subpanel-status');
const subpanelError     = document.getElementById('subpanel-error');
const overflowNotice    = document.getElementById('overflow-notice');
const libraryScroll     = document.getElementById('library-scroll');
const detailPanel       = document.getElementById('detail-panel');

// ─── Initialisation ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  newCampaignBtn.addEventListener('click', () => { window.location.href = 'editor.html?new'; });
  wireLoadSubpanel();
  renderLibrary();
  loadPackagedCampaigns();
});

// ─── Packaged campaign auto-loading ───────────────────────────────────────────

async function loadPackagedCampaigns() {
  let manifest;
  try {
    const res = await fetch(`${PACKAGED_CAMPAIGNS_BASE_URL}manifest.json`);
    if (!res.ok) return;
    manifest = await res.json();
  } catch {
    return; // network error or no manifest — silent
  }

  const zipNames = Array.isArray(manifest?.campaigns) ? manifest.campaigns : [];
  if (zipNames.length === 0) return;

  // Show loading notice while ZIPs are fetched (replaces initial empty state)
  libraryScroll.innerHTML = '';
  const loadingEl = document.createElement('p');
  loadingEl.className = 'dash-library__empty';
  loadingEl.textContent = 'Loading packaged campaigns…';
  libraryScroll.appendChild(loadingEl);

  await Promise.all(zipNames.map(async (zipName) => {
    try {
      const res = await fetch(`${PACKAGED_CAMPAIGNS_BASE_URL}${zipName}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const files = await unzipToFiles(await res.arrayBuffer());
      const name = zipName.replace(/\.zip$/i, '');
      const campaign = await loadCampaign(files);
      const validation = validateCampaign(campaign);
      addToLibrary(name, campaign, validation, files);
    } catch (e) {
      console.warn(`Packaged campaign "${zipName}" failed to load:`, e.message);
    }
  }));

  // Always re-render: clears the loading message if all failed, and restores any
  // campaigns that were manually loaded before auto-loading began.
  renderLibrary();
}


// ─── Load sub-panel wiring ────────────────────────────────────────────────────

function wireLoadSubpanel() {
  // Toggle sub-panel
  loadCampaignBtn.addEventListener('click', () => {
    loadSubpanel.classList.toggle('load-subpanel--visible');
    clearSubpanelFeedback();
  });

  // Drag-and-drop
  subpanelDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    subpanelDropZone.classList.add('load-subpanel__drop--dragover');
  });
  subpanelDropZone.addEventListener('dragleave', () => {
    subpanelDropZone.classList.remove('load-subpanel__drop--dragover');
  });
  subpanelDropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    subpanelDropZone.classList.remove('load-subpanel__drop--dragover');
    const items = e.dataTransfer?.items ?? [];
    const entries = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
    }
    if (entries.length > 0) await handleEntriesDrop(entries, null);
  });

  // Folder browse
  subpanelBrowseBtn.addEventListener('click', () => subpanelFolderInput.click());
  subpanelFolderInput.addEventListener('change', () => {
    if (subpanelFolderInput.files.length > 0) {
      handleFileList(subpanelFolderInput.files, null);
    }
  });

  // ZIP upload
  subpanelZipBtn.addEventListener('click', () => subpanelZipInput.click());
  subpanelZipInput.addEventListener('change', () => {
    if (subpanelZipInput.files[0]) handleZip(subpanelZipInput.files[0]);
  });
}

// ─── File handling ────────────────────────────────────────────────────────────

async function handleEntriesDrop(entries, zipName) {
  setSubpanelStatus('Analysing campaign…');
  clearSubpanelError();
  try {
    const files = await readEntries(entries);
    await processFiles(files, zipName);
  } catch (e) {
    showSubpanelError(e.message);
  }
}

async function handleFileList(fileList, zipName) {
  setSubpanelStatus('Analysing campaign…');
  clearSubpanelError();
  try {
    const files = [];
    for (const file of fileList) {
      if (!file.name.endsWith('.yaml') && file.name !== 'theme.css') continue;
      const text = await file.text();
      files.push({ path: file.webkitRelativePath || file.name, text });
    }
    await processFiles(files, zipName);
  } catch (e) {
    showSubpanelError(e.message);
  }
}

async function unzipToFiles(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const files = [];
  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    const entryName = relativePath.split('/').pop();
    if (!entryName.endsWith('.yaml') && entryName !== 'theme.css') continue;
    const text = await zipEntry.async('string');
    files.push({ path: relativePath, text });
  }
  return files;
}

async function handleZip(zipFile) {
  setSubpanelStatus('Extracting ZIP…');
  clearSubpanelError();
  try {
    const files = await unzipToFiles(await zipFile.arrayBuffer());
    await processFiles(files, zipFile.name.replace(/\.zip$/i, ''));
  } catch (e) {
    showSubpanelError(e.message);
  }
}

async function processFiles(files, zipName) {
  let campaign;
  try {
    campaign = await loadCampaign(files);
  } catch (e) {
    showSubpanelError(e.message);
    return;
  }

  // Derive name
  let name;
  if (zipName) {
    name = zipName;
  } else {
    const firstPath = files[0]?.path ?? '';
    const parts = firstPath.split('/');
    name = parts.length > 1 ? parts[0] : (campaign.metadata?.title ?? 'Campaign');
  }

  const validation = validateCampaign(campaign);
  addToLibrary(name, campaign, validation, files);
  setSubpanelStatus('Campaign loaded.');
  // Hide sub-panel after success
  setTimeout(() => {
    loadSubpanel.classList.remove('load-subpanel--visible');
    clearSubpanelFeedback();
  }, 800);
}

// ─── Library management ───────────────────────────────────────────────────────

function addToLibrary(name, campaign, validation, files) {
  // Check if a campaign with the same name already exists — update in place
  const existingIndex = library.findIndex((e) => e.name === name);
  if (existingIndex !== -1) {
    library[existingIndex] = {
      ...library[existingIndex],
      campaign,
      validation,
      files: files ?? library[existingIndex].files,
      loadedAt: new Date(),
    };
    renderLibrary();
    selectCampaign(library[existingIndex].id);
    return;
  }

  // Overflow: evict oldest if at capacity
  let showOverflow = false;
  if (library.length >= MAX_LIBRARY) {
    library.sort((a, b) => a.loadedAt - b.loadedAt);
    library.shift();
    showOverflow = true;
  }

  const entry = {
    id: `campaign_${Date.now()}`,
    name,
    campaign,
    validation,
    files: files ?? null,
    loadedAt: new Date(),
  };
  library.push(entry);
  renderLibrary();
  selectCampaign(entry.id);

  if (showOverflow) {
    overflowNotice.classList.add('overflow-notice--visible');
    setTimeout(() => overflowNotice.classList.remove('overflow-notice--visible'), OVERFLOW_FADE_MS);
  }
}

function removeFromLibrary(id) {
  library = library.filter((e) => e.id !== id);
  if (selectedId === id) {
    selectedId = null;
    renderDetail(null);
  }
  renderLibrary();
}

// ─── Library rendering ────────────────────────────────────────────────────────

function renderLibrary() {
  libraryScroll.innerHTML = '';

  if (library.length === 0) {
    const p = document.createElement('p');
    p.className = 'dash-library__empty';
    p.textContent = 'No campaigns loaded. Click "+ Load campaign…" to add one.';
    libraryScroll.appendChild(p);
    return;
  }

  for (const entry of library) {
    libraryScroll.appendChild(buildCard(entry));
  }
}

function buildCard(entry) {
  const { id, name, campaign, validation } = entry;
  const scenes = campaign.scenes ?? {};
  const sceneCount = Object.keys(scenes).length;
  const endingCount = Object.values(scenes).filter((s) => s.end).length;
  const hasHealth = Object.keys(campaign.metadata?.attributes ?? {}).length > 0;
  const errorCount = validation.filter((r) => r.level === 'error').length;

  const card = document.createElement('div');
  card.className = 'campaign-card' + (id === selectedId ? ' campaign-card--selected' : '');
  card.addEventListener('click', () => selectCampaign(id));

  // Title
  const title = document.createElement('div');
  title.className = 'campaign-card__title';
  title.textContent = campaign.metadata?.title ?? name;
  card.appendChild(title);

  // Meta row
  const meta = document.createElement('div');
  meta.className = 'campaign-card__meta';
  meta.textContent = `${sceneCount} scenes · ${endingCount} ending${endingCount !== 1 ? 's' : ''}`;

  if (hasHealth) {
    const hBadge = document.createElement('span');
    hBadge.className = 'campaign-card__badge campaign-card__badge--health';
    hBadge.textContent = '♥ health';
    meta.appendChild(hBadge);
  }

  const validBadge = document.createElement('span');
  validBadge.className = 'campaign-card__badge ' +
    (errorCount === 0 ? 'campaign-card__badge--valid' : 'campaign-card__badge--error');
  validBadge.textContent = errorCount === 0
    ? '✓ Valid'
    : `⚠ ${errorCount} error${errorCount !== 1 ? 's' : ''}`;
  meta.appendChild(validBadge);

  card.appendChild(meta);

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'campaign-card__remove';
  removeBtn.textContent = '✕';
  removeBtn.title = 'Remove from library';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeFromLibrary(id);
  });
  card.appendChild(removeBtn);

  return card;
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function selectCampaign(id) {
  selectedId = id;
  // Update card highlight
  for (const card of libraryScroll.querySelectorAll('.campaign-card')) {
    card.classList.remove('campaign-card--selected');
  }
  renderLibrary(); // Re-render to apply selection highlight cleanly
  renderDetail(library.find((e) => e.id === id) ?? null);
}

function renderDetail(entry) {
  detailPanel.innerHTML = '';

  if (!entry) {
    const p = document.createElement('p');
    p.className = 'dash-detail__empty';
    p.textContent = 'Select a campaign from the library to see details.';
    detailPanel.appendChild(p);
    return;
  }

  const { name, campaign, validation } = entry;
  const meta = campaign.metadata ?? {};
  const scenes = campaign.scenes ?? {};
  const items = campaign.items ?? {};

  // ── Metadata section ──
  const metaSection = makeSection('Metadata');
  const grid = document.createElement('div');
  grid.className = 'detail-grid';

  addGridRow(grid, 'Title', meta.title ?? name);
  if (meta.author) addGridRow(grid, 'Author', meta.author);
  if (meta.version) addGridRow(grid, 'Version', meta.version);
  if (meta.description) addGridRow(grid, 'Description', meta.description);
  addGridRow(grid, 'Starting scene', meta.start ?? '—');
  const attrDefs = meta.attributes ?? {};
  const attrKeys = Object.keys(attrDefs);
  if (attrKeys.length > 0) {
    const attrSummary = attrKeys.map((k) => {
      const def = attrDefs[k];
      return `${def.label ?? k}: ${Number(def.value ?? 0)}`;
    }).join(', ');
    addGridRow(grid, 'Attributes', attrSummary);
  }
  addGridRow(grid, 'Starting inventory',
    (meta.inventory?.length > 0) ? meta.inventory.join(', ') : 'Empty');

  if (meta.tags?.length > 0) {
    const tagRow = document.createElement('div');
    tagRow.className = 'detail-grid__label';
    tagRow.textContent = 'Tags';
    grid.appendChild(tagRow);

    const tagsCell = document.createElement('div');
    tagsCell.className = 'detail-grid__value';
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'detail-tags';
    for (const tag of meta.tags) {
      const badge = document.createElement('span');
      badge.className = 'detail-tag';
      badge.textContent = tag;
      tagsDiv.appendChild(badge);
    }
    tagsCell.appendChild(tagsDiv);
    grid.appendChild(tagsCell);
  }

  metaSection.appendChild(grid);
  detailPanel.appendChild(metaSection);

  // ── Statistics section ──
  const sceneList = Object.entries(scenes);
  const terminalCount = sceneList.filter(([, s]) => s.end).length;
  const nonTerminalCount = sceneList.length - terminalCount;
  const withOnEnter = sceneList.filter(([, s]) => s.on_enter).length;

  // Unique items in play
  const itemsInPlay = new Set();
  for (const [, scene] of sceneList) {
    for (const choice of scene.choices ?? []) {
      if (choice.requires_item) itemsInPlay.add(choice.requires_item);
      for (const i of choice.requires_items ?? []) itemsInPlay.add(i);
      for (const i of choice.gives_items ?? []) itemsInPlay.add(i);
    }
    for (const i of scene.on_enter?.gives_items ?? []) itemsInPlay.add(i);
  }

  const statsSection = makeSection('Statistics');
  const statsGrid = document.createElement('div');
  statsGrid.className = 'detail-grid';

  addGridRow(statsGrid, 'Total scenes', String(sceneList.length));
  addGridRow(statsGrid, 'Terminal scenes', String(terminalCount));
  addGridRow(statsGrid, 'Non-terminal scenes', String(nonTerminalCount));
  addGridRow(statsGrid, 'Scenes with on_enter', String(withOnEnter));
  addGridRow(statsGrid, 'Items in registry', String(Object.keys(items).length));
  addGridRow(statsGrid, 'Unique items in play', String(itemsInPlay.size));

  statsSection.appendChild(statsGrid);
  detailPanel.appendChild(statsSection);

  // ── Validation section ──
  const valSection = makeSection('Validation');
  const note = document.createElement('p');
  note.style.cssText = 'font-size:0.78rem;color:var(--ta-text-muted);margin-bottom:0.5rem;';
  note.textContent = 'Validation runs automatically on upload.';
  valSection.appendChild(note);

  if (validation.length === 0) {
    const ok = document.createElement('p');
    ok.className = 'validation-ok';
    ok.textContent = '✓ Campaign is valid.';
    valSection.appendChild(ok);
  } else {
    const ul = document.createElement('ul');
    ul.className = 'validation-list';
    for (const result of validation) {
      const li = document.createElement('li');
      li.className = 'validation-item validation-item--' + result.level;
      li.textContent = result.message;
      ul.appendChild(li);
    }
    valSection.appendChild(ul);
  }

  detailPanel.appendChild(valSection);

  // ── Launch section ──
  const launchSection = makeSection('Launch');
  const launchDiv = document.createElement('div');
  launchDiv.className = 'launch-section';

  const hardErrors = validation.filter((r) => r.level === 'error');

  if (hardErrors.length > 0) {
    const warn = document.createElement('p');
    warn.className = 'launch-warning';
    warn.textContent = 'This campaign has validation errors and may not play correctly.';
    launchDiv.appendChild(warn);
  }

  const playBtn = document.createElement('button');
  playBtn.className = 'btn';
  playBtn.textContent = hardErrors.length > 0 ? '▶ Play anyway' : '▶ Play';
  playBtn.addEventListener('click', () => launchCampaign(entry));
  launchDiv.appendChild(playBtn);

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn--ghost';
  editBtn.textContent = '✎ Edit';
  editBtn.addEventListener('click', () => editCampaign(entry));
  launchDiv.appendChild(editBtn);

  launchSection.appendChild(launchDiv);
  detailPanel.appendChild(launchSection);
}

function makeSection(title) {
  const section = document.createElement('div');
  section.className = 'dash-detail__section';
  const heading = document.createElement('h2');
  heading.className = 'dash-detail__section-title';
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

function addGridRow(grid, label, value) {
  const l = document.createElement('div');
  l.className = 'detail-grid__label';
  l.textContent = label;

  const v = document.createElement('div');
  v.className = 'detail-grid__value';
  v.textContent = value;

  grid.appendChild(l);
  grid.appendChild(v);
}

// ─── Launch ───────────────────────────────────────────────────────────────────

function launchCampaign(entry) {
  const serialised = JSON.stringify({ campaign: entry.campaign, name: entry.name });
  try {
    localStorage.setItem('adventure_pending_campaign', serialised);
    window.location.href = 'index.html';
  } catch {
    const errP = document.createElement('p');
    errP.style.cssText = 'font-size:0.82rem;color:var(--ta-danger);margin-top:0.5rem;';
    errP.textContent =
      'Could not transfer campaign data. Please use the upload button on the game page instead.';
    detailPanel.querySelector('.launch-section')?.appendChild(errP);
  }
}

// ─── Edit ─────────────────────────────────────────────────────────────────────

function editCampaign(entry) {
  const serialised = JSON.stringify({ campaign: entry.campaign, name: entry.name, files: entry.files ?? null });
  try {
    localStorage.setItem('adventure_pending_edit', serialised);
    window.location.href = 'editor.html?edit';
  } catch { /* silent */ }
}

// ─── Entry reading helpers (same as ui.js) ───────────────────────────────────

async function readEntries(entries) {
  const results = [];

  async function walk(entry, basePath) {
    if (entry.isFile) {
      if (!entry.name.endsWith('.yaml') && entry.name !== 'theme.css') return;
      const file = await entryToFile(entry);
      const text = await file.text();
      results.push({ path: basePath + entry.name, text });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const children = await readAllEntries(reader);
      for (const child of children) {
        await walk(child, basePath + entry.name + '/');
      }
    }
  }

  for (const entry of entries) {
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const children = await readAllEntries(reader);
      for (const child of children) {
        await walk(child, entry.name + '/');
      }
    } else {
      await walk(entry, '');
    }
  }

  return results;
}

function entryToFile(fileEntry) {
  return new Promise((resolve, reject) => fileEntry.file(resolve, reject));
}

function readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    let all = [];
    function read() {
      reader.readEntries((entries) => {
        if (entries.length === 0) return resolve(all);
        all = all.concat(entries);
        read();
      }, reject);
    }
    read();
  });
}

// ─── Sub-panel feedback ───────────────────────────────────────────────────────

function setSubpanelStatus(text) {
  subpanelStatus.textContent = text;
}

function clearSubpanelFeedback() {
  subpanelStatus.textContent = '';
  clearSubpanelError();
}

function clearSubpanelError() {
  subpanelError.textContent = '';
  subpanelError.classList.remove('load-subpanel__error--visible');
}

function showSubpanelError(msg) {
  setSubpanelStatus('');
  subpanelError.textContent = msg;
  subpanelError.classList.add('load-subpanel__error--visible');
}
