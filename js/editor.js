/**
 * editor.js — DOM wiring and mode coordination for editor.html.
 *
 * Imports: campaign.js (loadCampaign, validateCampaign, RESERVED_COMMAND_NAMES)
 *          serialise.js (serialiseCampaign)
 *
 * Architecture:
 *   Code mode   — fileMap (Map<filename, string>) is source of truth.
 *   Form mode   — campaign object is source of truth (structured form editor).
 *   Visual mode — campaign object is source of truth (Cytoscape flowchart).
 *   Modes sync on switch: Code→Form/Visual parses fileMap; Form/Visual→Code serialises campaign.
 */

import { loadCampaign, validateCampaign, RESERVED_COMMAND_NAMES } from './campaign.js';
import { serialiseCampaign } from './serialise.js';
import { initFlowEditor, destroyFlowEditor, cancelEdgeSource, getNodePositions, focusNode } from './visual-editor.js';
import { unzipToFiles } from './zip-utils.js';
import { detectFeatures } from './campaign-utils.js';
import {
  getUser, signIn as sbSignIn, getProfile, acceptPolicy as sbAcceptPolicy,
  publishCampaign,
  listMyCampaigns,
  updateCampaignZip,
  updateCampaign as updateCampaignMeta,
} from './supabase-client.js';

// ─── Module-scoped state ──────────────────────────────────────────────────────

let fileMap  = new Map();   // Code mode source of truth: filename → YAML text
let campaign = null;        // Visual mode source of truth: { metadata, scenes, items }
let activeFile  = null;     // selected filename in file tree (Code mode)
let activeScene = null;     // selected scene ID in visual editor
let mode = 'code';          // 'code' | 'form' | 'visual'
let isDirty = false;        // unsaved changes since last ZIP export or campaign load
let sceneFileMap = new Map();    // sceneId → filename (for validation navigation)
let pendingValidation = [];      // last validateCampaign() results
let pendingParseErr   = null;    // last parse error from runValidation()

// ─── DOM references ───────────────────────────────────────────────────────────

// Screens
const editorBlank   = document.getElementById('editor-blank');
const editorLoading = document.getElementById('editor-loading');
const editorShell   = document.getElementById('editor-shell');

// Blank state
const blankDropZone    = document.getElementById('blank-drop-zone');
const blankBrowseBtn   = document.getElementById('blank-browse-btn');
const blankFolderInput = document.getElementById('blank-folder-input');
const blankZipBtn      = document.getElementById('blank-zip-btn');
const blankZipInput    = document.getElementById('blank-zip-input');
const blankStatus      = document.getElementById('blank-status');
const blankError       = document.getElementById('blank-error');
const blankNewBtn      = document.getElementById('blank-new-btn');
const edDraftBanner  = document.getElementById('ed-draft-banner');
const edDraftInfo    = document.getElementById('ed-draft-info');
const edDraftRestore = document.getElementById('ed-draft-restore');
const edDraftDismiss = document.getElementById('ed-draft-dismiss');

// Top bar
const edTitle        = document.getElementById('ed-title');
const edSidebarToggle = document.getElementById('ed-sidebar-toggle');
const edValToggle    = document.getElementById('ed-val-toggle');
const edSaveBtn      = document.getElementById('ed-save-btn');
const edValidateBtn  = document.getElementById('ed-validate-btn');
const edPlayBtn      = document.getElementById('ed-play-btn');
const edZipBtn       = document.getElementById('ed-zip-btn');
const edPublishBtn   = document.getElementById('ed-publish-btn');

// Sidebar
const edSidebar      = document.getElementById('ed-sidebar');
const edFiletree     = document.getElementById('ed-filetree');
const edFiletreeList = document.getElementById('ed-filetree__list');
const edAddFileBtn   = document.getElementById('ed-add-file');
const edScenelist    = document.getElementById('ed-scenelist');
const edScenelistList = document.getElementById('ed-scenelist__list');
const edAddSceneBtn  = document.getElementById('ed-add-scene');
const edItemsNav     = document.getElementById('ed-items-nav');
const edMetaNav      = document.getElementById('ed-meta-nav');
const edScenesNav    = document.getElementById('ed-scenes-nav');

// Mode toggle
const edModeCode   = document.getElementById('ed-mode-code');
const edModeForm   = document.getElementById('ed-mode-form');
const edModeVisual = document.getElementById('ed-mode-visual');

// Code pane
const edCodePane   = document.getElementById('ed-code-pane');
const edParseError = document.getElementById('ed-parse-error');
const edLineNums   = document.getElementById('ed-line-nums');
const edTextarea   = document.getElementById('ed-textarea');

// Form pane (was: Visual pane)
const edVisualPane  = document.getElementById('ed-visual-pane');
const edMetaForm    = document.getElementById('ed-meta-form');
const edSceneForm   = document.getElementById('ed-scene-form');
const edItemsForm   = document.getElementById('ed-items-form');
const edSceneGraph    = document.getElementById('ed-scene-graph');
const edSceneGraphSvg = document.getElementById('ed-scene-graph-svg');

// Flow (Visual) pane
const edFlowPane        = document.getElementById('ed-flow-pane');
const edFlowCy          = document.getElementById('ed-flow-cy');
const edFlowFitBtn      = document.getElementById('ed-flow-fit');
const edFlowContextMenu = document.getElementById('ed-flow-context-menu');

// Choice context menu (shown on right-click of an edge)
const edFlowChoiceContextMenu = document.getElementById('ed-flow-choice-context-menu');

// File tree context menu (shown on right-click of a file in code mode)
const edFileContextMenu = document.getElementById('ed-file-context-menu');

// Metadata form fields
const edMetaTitle          = document.getElementById('ed-meta-title');
const edMetaAuthor         = document.getElementById('ed-meta-author');
const edMetaVersion        = document.getElementById('ed-meta-version');
const edMetaDesc           = document.getElementById('ed-meta-description');
const edMetaTagsCtr        = document.getElementById('ed-meta-tags-container');
const edMetaStart          = document.getElementById('ed-meta-start');
const edMetaAttrsList      = document.getElementById('ed-meta-attributes-list');
const edMetaAddAttr        = document.getElementById('ed-meta-add-attr');
const edMetaInvCtr         = document.getElementById('ed-meta-inventory-container');

// Scene form fields
const edSceneIdLabel  = document.getElementById('ed-scene-id-label');
const edSceneRenameBtn = document.getElementById('ed-scene-rename-btn');
const edSceneTitle    = document.getElementById('ed-scene-title');
const edSceneText     = document.getElementById('ed-scene-text');
const edSceneTerminal = document.getElementById('ed-scene-terminal');
const edOnEnterDetails = document.getElementById('ed-on-enter-details');
const edOeMessage         = document.getElementById('ed-oe-message');
const edOeAffectAttrsCtr  = document.getElementById('ed-oe-affect-attrs-container');
const edOeGivesItemsCtr   = document.getElementById('ed-oe-gives-items-container');
const edOeRemovesItemsCtr = document.getElementById('ed-oe-removes-items-container');
const edOeGivesNotesCtr   = document.getElementById('ed-oe-gives-notes-container');
const edChoicesSection = document.getElementById('ed-choices-section');
const edAddChoiceBtn   = document.getElementById('ed-add-choice');
const edExpandAllBtn   = document.getElementById('ed-expand-all-choices');
const edCollapseAllBtn = document.getElementById('ed-collapse-all-choices');
const edChoicesList    = document.getElementById('ed-choices-list');

// Items form
const edItemsList  = document.getElementById('ed-items-list');
const edAddItem    = document.getElementById('ed-add-item');

// Attributes form
const edAttributesNav  = document.getElementById('ed-attributes-nav');
const edAttributesForm = document.getElementById('ed-attributes-form');

// Recipes form
const edRecipesNav  = document.getElementById('ed-recipes-nav');
const edRecipesForm = document.getElementById('ed-recipes-form');
const edRecipesList = document.getElementById('ed-recipes-list');
const edAddRecipe   = document.getElementById('ed-add-recipe');

// Assets form
const edAssetsNav  = document.getElementById('ed-assets-nav');
const edAssetsForm = document.getElementById('ed-assets-form');
const edAssetsList = document.getElementById('ed-assets-list');

// Scene assets selects
const edSceneAssetImage  = document.getElementById('ed-scene-asset-image');
const edSceneAssetMusic  = document.getElementById('ed-scene-asset-music');
const edOeGivesSfxCtr    = document.getElementById('ed-oe-gives-sfx-container');

// Validation panel
const edValidation     = document.getElementById('ed-validation');
const edValidationBody = document.getElementById('ed-validation__body');

// Rename modal
const edRenameModal   = document.getElementById('ed-rename-modal');
const edRenameInput   = document.getElementById('ed-rename-input');
const edRenameError   = document.getElementById('ed-rename-error');
const edRenameConfirm = document.getElementById('ed-rename-confirm');
const edRenameCancel  = document.getElementById('ed-rename-cancel');
const edRenameCancel2 = document.getElementById('ed-rename-cancel-2');

// Toast
const edToast = document.getElementById('ed-toast');

// Shared item autocomplete datalist
const edItemDatalist = document.getElementById('ed-item-datalist');

// ─── Initialisation ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  wireBlankState();
  wireTopbar();
  wireModeToggle();
  wireCodePane();
  wireVisualPane();
  wireFlowPane();
  wireValidationPanel();
  wireModals();
  wirePublishModals();
  wireResizer();
  checkEditorHandoff();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && !editorShell.classList.contains('hidden')) {
    e.preventDefault();
    saveDraft();
  }
});

// ─── Entry point: BroadcastChannel + localStorage handoff ─────────────────────

function checkEditorHandoff() {
  const url = new URL(window.location.href);

  if (url.searchParams.has('edit')) {
    tryLocalStorageHandoff();
  } else if (url.searchParams.has('new')) {
    localStorage.removeItem('adventure_editor_draft');
    initNewCampaign();
  } else {
    // No ?edit or ?new → blank state; check for a saved draft to offer restore
    checkDraftRestore();
    showBlank();
  }
}

function tryLocalStorageHandoff() {
  const raw = localStorage.getItem('adventure_pending_edit');
  if (!raw) { showBlank(); return; }
  localStorage.removeItem('adventure_pending_edit');
  localStorage.removeItem('adventure_editor_draft');
  try {
    const data = JSON.parse(raw);
    if (data?.campaign) receiveCampaignData(data.campaign, data.name ?? '', data.files ?? null);
    else showBlank();
  } catch {
    showBlank();
  }
}

// ─── Screen visibility ────────────────────────────────────────────────────────

function showBlank() {
  editorBlank.classList.remove('hidden');
  editorLoading.classList.add('hidden');
  editorShell.classList.add('hidden');
}

function showLoading() {
  editorBlank.classList.add('hidden');
  editorLoading.classList.remove('hidden');
  editorShell.classList.add('hidden');
}

function showShell() {
  editorBlank.classList.add('hidden');
  editorLoading.classList.add('hidden');
  editorShell.classList.remove('hidden');
  edSaveBtn.disabled = false;
}

// ─── Campaign loading ─────────────────────────────────────────────────────────

/**
 * Receive a parsed campaign object (from dashboard handoff or new-campaign scaffold).
 * When files (array of {path,text}) are provided, builds the fileMap from the original
 * file texts to preserve the author's multi-file layout. Otherwise synthesises via serialiseCampaign.
 */
function receiveCampaignData(campaignObj, name, files) {
  campaign = campaignObj;
  if (files && files.length > 0) {
    fileMap = new Map();
    for (const { path, text } of files) {
      const filename = path.includes('/') ? path.split('/').pop() : path;
      fileMap.set(filename, text);
    }
  } else {
    fileMap = serialiseCampaign(campaignObj, null);
  }
  activeScene = null;
  mode = 'code';
  buildSceneFileMap();
  showShell();
  clearDirty();
  activateCodeMode(/* selectFirst */ true);
  scheduleValidation();
}

/**
 * Load campaign from an array of { path, text } file objects (folder drop / ZIP).
 * Preserves original file texts for Code mode and provenance tracking.
 */
async function loadFromFiles(files) {
  let parsed;
  try {
    parsed = await loadCampaign(files);
  } catch (e) {
    showBlankError(e.message);
    return;
  }

  campaign = parsed;
  // Build fileMap from the original file texts (preserves author YAML)
  fileMap = new Map();
  for (const { path, text } of files) {
    const filename = path.includes('/') ? path.split('/').pop() : path;
    fileMap.set(filename, text);
  }
  localStorage.removeItem('adventure_editor_draft');
  activeScene = null;
  mode = 'code';
  buildSceneFileMap();
  showShell();
  clearDirty();
  activateCodeMode(/* selectFirst */ true);
  scheduleValidation();
}

function initNewCampaign() {
  const metaYaml = [
    '# Generated by Campaign Editor',
    'metadata:',
    '  title: Untitled Campaign',
    '  start: start',
    '',
  ].join('\n');

  const scenesYaml = [
    '# Generated by Campaign Editor',
    'scenes:',
    '  start:',
    "    text: ''",
    '    choices: []',
    '',
  ].join('\n');

  fileMap = new Map([
    ['metadata.yaml', metaYaml],
    ['scenes.yaml', scenesYaml],
  ]);

  campaign = {
    metadata: { title: 'Untitled Campaign', start: 'start' },
    scenes: { start: { text: '', choices: [] } },
    items: {},
  };

  activeScene = null;
  mode = 'code';
  buildSceneFileMap();
  showShell();
  clearDirty();
  activateCodeMode(/* selectFirst */ true, /* selectScenes */ true);
  scheduleValidation();
}

// ─── Blank state wiring ───────────────────────────────────────────────────────

function wireBlankState() {
  blankNewBtn.addEventListener('click', initNewCampaign);

  edDraftRestore.addEventListener('click', async () => {
    const raw = localStorage.getItem('adventure_editor_draft');
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      const map = new Map(Object.entries(draft.files ?? {}));
      localStorage.removeItem('adventure_editor_draft');
      edDraftBanner.classList.add('hidden');
      await loadFromFileMap(map);
    } catch (e) {
      showBlankError('Could not restore draft.');
    }
  });

  edDraftDismiss.addEventListener('click', () => {
    localStorage.removeItem('adventure_editor_draft');
    edDraftBanner.classList.add('hidden');
  });

  blankBrowseBtn.addEventListener('click', () => blankFolderInput.click());
  blankFolderInput.addEventListener('change', () => {
    if (blankFolderInput.files.length > 0) handleFileList(blankFolderInput.files);
  });

  blankZipBtn.addEventListener('click', () => blankZipInput.click());
  blankZipInput.addEventListener('change', () => {
    if (blankZipInput.files[0]) handleZip(blankZipInput.files[0]);
  });

  blankDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    blankDropZone.classList.add('drop-zone--dragover');
  });
  blankDropZone.addEventListener('dragleave', () => {
    blankDropZone.classList.remove('drop-zone--dragover');
  });
  blankDropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    blankDropZone.classList.remove('drop-zone--dragover');
    const items = e.dataTransfer?.items ?? [];
    const entries = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
    }
    if (entries.length > 0) {
      setBlankStatus('Analysing campaign…');
      try {
        const files = await readEntries(entries);
        await loadFromFiles(files);
      } catch (e) {
        showBlankError(e.message);
      }
    }
  });
}

async function handleFileList(fileList) {
  setBlankStatus('Analysing campaign…');
  clearBlankError();
  const files = [];
  for (const file of fileList) {
    if (!file.name.endsWith('.yaml') && file.name !== 'theme.css') continue;
    const text = await file.text();
    files.push({ path: file.webkitRelativePath || file.name, text });
  }
  await loadFromFiles(files);
}

async function handleZip(zipFile) {
  setBlankStatus('Extracting ZIP…');
  clearBlankError();
  try {
    const files = await unzipToFiles(await zipFile.arrayBuffer());
    await loadFromFiles(files);
  } catch (e) {
    showBlankError(e.message);
  }
}

function setBlankStatus(text) { blankStatus.textContent = text; }
function clearBlankError() {
  blankError.textContent = '';
  blankError.classList.remove('drop-zone__error--visible');
}
function showBlankError(msg) {
  setBlankStatus('');
  blankError.textContent = msg;
  blankError.classList.add('drop-zone__error--visible');
}

// ─── Top bar wiring ───────────────────────────────────────────────────────────

function wireResizer() {
  const resizer = document.getElementById('ed-resizer');
  const edBody  = document.querySelector('.ed-body');
  if (!resizer || !edBody) return;

  // Restore saved width
  const saved = localStorage.getItem('editor_sidebar_width');
  if (saved) edBody.style.setProperty('--sidebar-width', `${saved}px`);

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizer.classList.add('ed-resizer--dragging');
    const startX     = e.clientX;
    const startWidth = edSidebar.getBoundingClientRect().width;

    function onMove(e) {
      const newWidth = Math.max(120, Math.min(400, startWidth + e.clientX - startX));
      edBody.style.setProperty('--sidebar-width', `${newWidth}px`);
    }

    function onUp() {
      resizer.classList.remove('ed-resizer--dragging');
      const finalWidth = Math.round(edSidebar.getBoundingClientRect().width);
      try { localStorage.setItem('editor_sidebar_width', String(finalWidth)); } catch { /* silent */ }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Right-side validation panel resizer
  const valResizer = document.getElementById('ed-val-resizer');
  if (!valResizer || !edValidation) return;

  const savedVal = localStorage.getItem('editor_validation_width');
  if (savedVal) edBody.style.setProperty('--val-width', `${savedVal}px`);

  valResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    valResizer.classList.add('ed-resizer--dragging');
    const startX     = e.clientX;
    const startWidth = edValidation.getBoundingClientRect().width;

    function onMove(e) {
      const newWidth = Math.max(120, Math.min(500, startWidth - (e.clientX - startX)));
      edBody.style.setProperty('--val-width', `${newWidth}px`);
    }

    function onUp() {
      valResizer.classList.remove('ed-resizer--dragging');
      const finalWidth = Math.round(edValidation.getBoundingClientRect().width);
      try { localStorage.setItem('editor_validation_width', String(finalWidth)); } catch { /* silent */ }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function wireTopbar() {
  edSaveBtn.addEventListener('click', saveDraft);

  // Temp removed validation button
  // edValidateBtn.addEventListener('click', () => {
  //   runValidation();
  //   edValidation.classList.add('ed-validation--pulse');
  //   edValidation.addEventListener('animationend', () => {
  //     edValidation.classList.remove('ed-validation--pulse');
  //   }, { once: true });
  // });

  edPlayBtn.addEventListener('click', playCampaign);
  edZipBtn.addEventListener('click', downloadZip);
  edPublishBtn.addEventListener('click', handlePublish);

  edSidebarToggle.addEventListener('click', () => {
    edSidebar.classList.toggle('ed-sidebar--open');
  });
  edValToggle.addEventListener('click', () => {
    edValidation.classList.toggle('ed-validation--open');
  });
}

function updateTitle() {
  const title = campaign?.metadata?.title || 'Untitled Campaign';
  edTitle.textContent = isDirty ? `· ${title}` : title;
  document.title = `${title} — Campaign Editor`;
}

function markDirty() {
  isDirty = true;
  updateTitle();
  debouncedAutosave();
}

function clearDirty() {
  isDirty = false;
  updateTitle();
}

function saveDraft() {
  if (!campaign) return;
  const map = (mode === 'code') ? fileMap : serialiseCampaign(campaign, fileMap);
  // Note: both 'form' and 'visual' modes use campaign as source of truth
  const draft = {
    savedAt: new Date().toISOString(),
    files:   Object.fromEntries(map),
  };
  try {
    localStorage.setItem('adventure_editor_draft', JSON.stringify(draft));
    showToast('Draft saved.');
    clearDirty();
  } catch {
    showToast('Could not save draft — storage full.');
  }
}

function checkDraftRestore() {
  const raw = localStorage.getItem('adventure_editor_draft');
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    const ts = new Date(draft.savedAt).toLocaleString();
    edDraftInfo.textContent = `Unsaved draft from ${ts}`;
    edDraftBanner.classList.remove('hidden');
  } catch {
    localStorage.removeItem('adventure_editor_draft');
  }
}

async function loadFromFileMap(map) {
  const files = [...map.entries()].map(([name, text]) => ({ path: name, text }));
  await loadFromFiles(files);
}

// ─── Mode toggle wiring ───────────────────────────────────────────────────────

function wireModeToggle() {
  edModeCode.addEventListener('click', () => {
    if (mode === 'code') return;
    switchToCode();
  });

  edModeForm.addEventListener('click', () => {
    if (mode === 'form') return;
    if (mode === 'code') attemptSwitchToForm();
    else { mode = 'form'; activateFormMode(); scheduleValidation(); }
  });

  edModeVisual.addEventListener('click', () => {
    if (mode === 'visual') return;
    if (mode === 'code') attemptSwitchToVisual();
    else { mode = 'visual'; activateVisualMode(); scheduleValidation(); }
  });
}

// Flush any pending textarea edit to fileMap before switching away from Code mode.
// onTextareaInput is debounced, so a fast click could leave fileMap stale.
function flushTextarea() {
  if (activeFile) {
    const text = edTextarea.value;
    fileMap.set(activeFile, text);
    checkParseError(text);
  }
}

async function attemptSwitchToForm() {
  flushTextarea();

  // Block if parse errors exist
  if (!edParseError.classList.contains('hidden')) {
    showToast('Fix parse errors before switching to Form mode.');
    return;
  }

  try {
    campaign = await loadCampaign(filesToArray(fileMap));
  } catch (e) {
    showToast('Cannot switch: ' + e.message);
    return;
  }

  mode = 'form';
  activateFormMode();
  scheduleValidation();
}

async function attemptSwitchToVisual() {
  flushTextarea();

  // Block if parse errors exist
  if (!edParseError.classList.contains('hidden')) {
    showToast('Fix parse errors before switching to Visual mode.');
    return;
  }

  try {
    campaign = await loadCampaign(filesToArray(fileMap));
  } catch (e) {
    showToast('Cannot switch: ' + e.message);
    return;
  }

  mode = 'visual';
  activateVisualMode();
  scheduleValidation();
}

function switchToCode() {
  destroyFlowEditor();
  fileMap = serialiseCampaign(campaign, fileMap);
  buildSceneFileMap();
  mode = 'code';
  activateCodeMode(/* selectFirst */ false);
  scheduleValidation();
}

function activateCodeMode(selectFirst, preferScenes = false) {
  // Toggle sidebar
  edFiletree.classList.remove('hidden');
  edScenelist.classList.add('hidden');
  // Toggle panes
  edCodePane.classList.remove('hidden');
  edVisualPane.classList.add('hidden');
  edFlowPane.classList.add('hidden');
  // Toggle mode buttons
  edModeCode.classList.add('ed-mode-btn--active');
  edModeCode.setAttribute('aria-selected', 'true');
  edModeForm.classList.remove('ed-mode-btn--active');
  edModeForm.setAttribute('aria-selected', 'false');
  edModeVisual.classList.remove('ed-mode-btn--active');
  edModeVisual.setAttribute('aria-selected', 'false');

  renderFileTree();

  if (selectFirst) {
    // Prefer scenes.yaml, otherwise first key
    const preferred = preferScenes && fileMap.has('scenes.yaml') ? 'scenes.yaml' : null;
    const first = preferred ?? [...fileMap.keys()][0] ?? null;
    if (first) selectFile(first);
  } else if (activeFile && fileMap.has(activeFile)) {
    selectFile(activeFile);
  } else {
    const first = [...fileMap.keys()][0] ?? null;
    if (first) selectFile(first);
  }
}

// When in Visual mode, switches to Form before executing a sidebar action.
function ensureFormMode() {
  if (mode !== 'visual') return;
  mode = 'form';
  activateFormMode();
  scheduleValidation();
}

function activateFormMode() {
  // Toggle sidebar
  edFiletree.classList.add('hidden');
  edScenelist.classList.remove('hidden');
  // Toggle panes
  edCodePane.classList.add('hidden');
  edVisualPane.classList.remove('hidden');
  edFlowPane.classList.add('hidden');
  // Toggle mode buttons
  edModeForm.classList.add('ed-mode-btn--active');
  edModeForm.setAttribute('aria-selected', 'true');
  edModeCode.classList.remove('ed-mode-btn--active');
  edModeCode.setAttribute('aria-selected', 'false');
  edModeVisual.classList.remove('ed-mode-btn--active');
  edModeVisual.setAttribute('aria-selected', 'false');

  refreshItemDatalist();
  populateMetadataForm();
  renderSceneList();

  // Show metadata form by default
  showMetadataForm();
}

function activateVisualMode() {
  // Toggle sidebar
  edFiletree.classList.add('hidden');
  edScenelist.classList.remove('hidden');
  // Toggle panes
  edCodePane.classList.add('hidden');
  edVisualPane.classList.add('hidden');
  edFlowPane.classList.remove('hidden');
  // Toggle mode buttons
  edModeVisual.classList.add('ed-mode-btn--active');
  edModeVisual.setAttribute('aria-selected', 'true');
  edModeCode.classList.remove('ed-mode-btn--active');
  edModeCode.setAttribute('aria-selected', 'false');
  edModeForm.classList.remove('ed-mode-btn--active');
  edModeForm.setAttribute('aria-selected', 'false');

  renderFlowEditor();
  if (activeScene) focusNode(activeScene);
}

// ─── Code mode ────────────────────────────────────────────────────────────────

function wireCodePane() {
  edTextarea.addEventListener('input', onTextareaInput);
  edTextarea.addEventListener('scroll', renderLineNums);
  edTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = edTextarea.selectionStart;
      const e2 = edTextarea.selectionEnd;
      const v = edTextarea.value;
      edTextarea.value = v.slice(0, s) + '  ' + v.slice(e2);
      edTextarea.selectionStart = edTextarea.selectionEnd = s + 2;
      edTextarea.dispatchEvent(new Event('input'));
    }
  });

  edAddFileBtn.addEventListener('click', addFile);
}

const onTextareaInput = debounce(() => {
  if (!activeFile) return;
  const text = edTextarea.value;
  fileMap.set(activeFile, text);
  markDirty();
  checkParseError(text);
  buildSceneFileMap();
  scheduleValidation();
}, 300);

function selectFile(filename) {
  activeFile = filename;
  renderFileTree();
  renderTextarea();
  renderLineNums();
  clearParseError();
  // Re-check after render
  checkParseError(edTextarea.value);
}

function renderFileTree() {
  edFiletreeList.innerHTML = '';
  for (const filename of fileMap.keys()) {
    const li = document.createElement('li');
    li.className = 'ed-filetree__item' + (filename === activeFile ? ' ed-filetree__item--active' : '');

    const name = document.createElement('span');
    name.className = 'ed-filetree__name';
    name.textContent = filename;
    li.appendChild(name);

    if (filename !== 'metadata.yaml') {
      const del = document.createElement('button');
      del.className = 'ed-filetree__delete';
      del.textContent = '✕';
      del.title = `Delete ${filename}`;
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteFile(filename); });
      li.appendChild(del);
    }

    li.addEventListener('click', () => selectFile(filename));
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      hideFileContextMenu();
      showFileContextMenu(filename, e.clientX, e.clientY);
    });
    edFiletreeList.appendChild(li);
  }
}

function renderTextarea() {
  edTextarea.value = fileMap.get(activeFile) ?? '';
}

function renderLineNums() {
  const lineCount = (edTextarea.value.match(/\n/g) ?? []).length + 1;
  // Only rebuild if count changed
  if (edLineNums.children.length !== lineCount) {
    edLineNums.innerHTML = '';
    for (let i = 1; i <= lineCount; i++) {
      const span = document.createElement('span');
      span.textContent = i;
      edLineNums.appendChild(span);
    }
  }
  edLineNums.scrollTop = edTextarea.scrollTop;
}

function checkParseError(text) {
  try {
    globalThis.jsyaml.load(text, { schema: globalThis.jsyaml.FAILSAFE_SCHEMA });
    clearParseError();
  } catch (e) {
    showParseError(e.message);
  }
}

function showParseError(msg) {
  edParseError.textContent = msg;
  edParseError.classList.remove('hidden');
}

function clearParseError() {
  edParseError.classList.add('hidden');
  edParseError.textContent = '';
}

function addFile() {
  const name = prompt('New file name (must end in .yaml, cannot be metadata.yaml):');
  if (!name) return;
  if (!name.endsWith('.yaml')) { alert('File name must end in .yaml'); return; }
  if (name === 'metadata.yaml') { alert('Cannot create another metadata.yaml'); return; }
  if (fileMap.has(name)) { alert(`File '${name}' already exists`); return; }
  fileMap.set(name, '# Campaign file — add scenes below\nscenes:\n');
  renderFileTree();
  selectFile(name);
}

function deleteFile(filename) {
  if (!confirm(`Delete '${filename}'? This cannot be undone.`)) return;
  fileMap.delete(filename);
  buildSceneFileMap();
  // Select first remaining file
  const remaining = [...fileMap.keys()];
  if (remaining.length > 0) {
    selectFile(remaining[0]);
  } else {
    activeFile = null;
    edTextarea.value = '';
    edLineNums.innerHTML = '';
  }
  renderFileTree();
  scheduleValidation();
}

// ─── Scene→file map ───────────────────────────────────────────────────────────

function buildSceneFileMap() {
  sceneFileMap = new Map();
  for (const [filename, text] of fileMap) {
    if (filename === 'metadata.yaml') continue;
    const re = /^  ([\w][\w_-]*):/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!sceneFileMap.has(m[1])) sceneFileMap.set(m[1], filename);
    }
  }
}

// ─── Visual mode wiring ───────────────────────────────────────────────────────

function wireVisualPane() {
  // Mark dirty on any input/change anywhere in the visual pane
  edVisualPane.addEventListener('input', markDirty);
  edVisualPane.addEventListener('change', markDirty);

  // Metadata fields
  edMetaTitle.addEventListener('input', () => {
    campaign.metadata.title = edMetaTitle.value;
    updateTitle();
    scheduleValidation();
  });
  edMetaAuthor.addEventListener('input', () => {
    campaign.metadata.author = edMetaAuthor.value || undefined;
  });
  edMetaVersion.addEventListener('input', () => {
    campaign.metadata.version = edMetaVersion.value || undefined;
  });
  edMetaDesc.addEventListener('input', () => {
    campaign.metadata.description = edMetaDesc.value || undefined;
  });
  edMetaStart.addEventListener('change', () => {
    campaign.metadata.start = edMetaStart.value || undefined;
    renderSceneList(); // update ▶ marker
    scheduleValidation();
  });
  edMetaAddAttr.addEventListener('click', () => {
    if (!campaign.attributes) campaign.attributes = {};
    let n = 1;
    while (campaign.attributes[`attr_${n}`] !== undefined) n++;
    const name = `attr_${n}`;
    campaign.attributes[name] = { value: 0 };
    renderAttributesEditor();
    scheduleValidation();
    markDirty();
  });

  // Scene list controls
  // Sidebar nav always shows the Form pane; if currently in Visual mode, switch first.
  edMetaNav.addEventListener('click', () => { ensureFormMode(); showMetadataForm(); });
  edAttributesNav.addEventListener('click', () => { ensureFormMode(); showAttributesForm(); });
  edScenesNav.addEventListener('click', () => { ensureFormMode(); showScenesView(); });
  edAddSceneBtn.addEventListener('click', addScene);
  edItemsNav.addEventListener('click', () => { ensureFormMode(); showItemsForm(); });
  edRecipesNav.addEventListener('click', () => { ensureFormMode(); showRecipesForm(); });
  edAddRecipe.addEventListener('click', addRecipeRow);
  edAssetsNav.addEventListener('click', () => { ensureFormMode(); showAssetsForm(); });

  // Scene form controls
  edSceneRenameBtn.addEventListener('click', openRenameModal);
  edSceneTitle.addEventListener('input', () => {
    if (!activeScene) return;
    campaign.scenes[activeScene].title = edSceneTitle.value || undefined;
  });
  edSceneText.addEventListener('input', () => {
    if (!activeScene) return;
    campaign.scenes[activeScene].text = edSceneText.value;
    scheduleValidation();
  });
  edSceneTerminal.addEventListener('change', () => {
    if (!activeScene) return;
    campaign.scenes[activeScene].end = edSceneTerminal.checked ? true : undefined;
    edChoicesSection.classList.toggle('hidden', edSceneTerminal.checked);
    scheduleValidation();
  });

  // on_enter fields
  edOeMessage.addEventListener('input', () => writeOnEnterField('message', edOeMessage.value || undefined));

  // Add choice button
  edAddChoiceBtn.addEventListener('click', addChoice);

  // Expand / Collapse all choices
  edExpandAllBtn.addEventListener('click', () => {
    for (const card of edChoicesList.querySelectorAll('.ed-choice-card')) {
      const body = card.querySelector('.ed-choice-card__body');
      const toggle = card.querySelector('.ed-choice-card__btn');
      if (body) body.style.display = '';
      if (toggle) toggle.textContent = '▲';
    }
  });
  edCollapseAllBtn.addEventListener('click', () => {
    for (const card of edChoicesList.querySelectorAll('.ed-choice-card')) {
      const body = card.querySelector('.ed-choice-card__body');
      const toggle = card.querySelector('.ed-choice-card__btn');
      if (body) body.style.display = 'none';
      if (toggle) toggle.textContent = '▼';
    }
  });

  // Items registry
  edAddItem.addEventListener('click', addItemRow);
}

// ─── Visual mode: metadata form ───────────────────────────────────────────────

function populateMetadataForm() {
  const meta = campaign.metadata ?? {};

  edMetaTitle.value   = meta.title ?? '';
  edMetaAuthor.value  = meta.author ?? '';
  edMetaVersion.value = meta.version ?? '';
  edMetaDesc.value    = meta.description ?? '';

  // Tags pill input
  edMetaTagsCtr.innerHTML = '';
  makePillInput(edMetaTagsCtr, meta.tags ?? [], (items) => {
    campaign.metadata.tags = items.length ? items : undefined;
  });

  // Start scene select
  populateStartSelect();
  edMetaStart.value = meta.start ?? '';

  // Inventory pill input
  edMetaInvCtr.innerHTML = '';
  makePillInput(edMetaInvCtr, meta.inventory ?? [], (items) => {
    campaign.metadata.inventory = items.length ? items : undefined;
  }, 'ed-item-datalist');
}

function populateStartSelect() {
  const current = edMetaStart.value;
  edMetaStart.innerHTML = '<option value="">(none)</option>';
  for (const id of Object.keys(campaign.scenes ?? {})) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    edMetaStart.appendChild(opt);
  }
  edMetaStart.value = current || (campaign.metadata?.start ?? '');
}

// ─── Visual mode: scene list ──────────────────────────────────────────────────

function renderSceneGraph() {
  const NS = 'http://www.w3.org/2000/svg';
  const scenes  = campaign.scenes ?? {};
  const startId = campaign.metadata?.start;

  const NODE_W = 140, NODE_H = 46, H_GAP = 70, V_GAP = 18, PAD = 20;

  // ── BFS layout ─────────────────────────────────────────────────────────────
  const layers     = new Map(); // sceneId → layerIndex
  const layerGroups = [];       // layerGroups[i] = [sceneId, ...]
  const visited    = new Set();
  const queue      = [];

  if (startId && scenes[startId]) {
    queue.push(startId);
    layers.set(startId, 0);
    visited.add(startId);
  }

  while (queue.length > 0) {
    const id    = queue.shift();
    const layer = layers.get(id);
    if (!layerGroups[layer]) layerGroups[layer] = [];
    layerGroups[layer].push(id);

    for (const choice of scenes[id]?.choices ?? []) {
      if (choice.next && scenes[choice.next] && !visited.has(choice.next)) {
        visited.add(choice.next);
        layers.set(choice.next, layer + 1);
        queue.push(choice.next);
      }
    }
  }

  // Unreachable scenes go in a final column
  const unreachable = Object.keys(scenes).filter(id => !visited.has(id));
  if (unreachable.length > 0) {
    layerGroups.push(unreachable);
    const ux = layerGroups.length - 1;
    for (const id of unreachable) layers.set(id, ux);
  }

  // ── Node positions ──────────────────────────────────────────────────────────
  const nodePos = new Map(); // sceneId → { x, y }
  for (let li = 0; li < layerGroups.length; li++) {
    const group = layerGroups[li];
    for (let ri = 0; ri < group.length; ri++) {
      nodePos.set(group[ri], {
        x: li * (NODE_W + H_GAP),
        y: ri * (NODE_H + V_GAP),
      });
    }
  }

  // ── SVG dimensions ──────────────────────────────────────────────────────────
  const totalCols = layerGroups.length;
  const maxRows   = Math.max(0, ...layerGroups.map(g => g.length));
  const svgW = totalCols * (NODE_W + H_GAP) - H_GAP + PAD * 2;
  const svgH = maxRows  * (NODE_H + V_GAP) - V_GAP + PAD * 2;

  const svg = edSceneGraphSvg;
  svg.setAttribute('width',  String(Math.max(svgW, 1)));
  svg.setAttribute('height', String(Math.max(svgH, 1)));
  svg.innerHTML = '';

  if (layerGroups.length === 0) return; // nothing to draw

  // ── Arrowhead marker ────────────────────────────────────────────────────────
  const defs   = document.createElementNS(NS, 'defs');
  const marker = document.createElementNS(NS, 'marker');
  marker.setAttribute('id',           'sg-arrow');
  marker.setAttribute('markerWidth',  '8');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('refX',         '7');
  marker.setAttribute('refY',         '3');
  marker.setAttribute('orient',       'auto');
  const poly = document.createElementNS(NS, 'polygon');
  poly.setAttribute('points', '0,0 8,3 0,6');
  poly.setAttribute('fill',   'var(--ta-text-muted)');
  marker.appendChild(poly);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const edgesG = document.createElementNS(NS, 'g');
  const nodesG = document.createElementNS(NS, 'g');

  // ── Edges ───────────────────────────────────────────────────────────────────
  // Deduplicate edges (multiple choices to the same target → one arrow)
  const drawn = new Set();
  for (const [fromId, scene] of Object.entries(scenes)) {
    const from = nodePos.get(fromId);
    if (!from) continue;
    for (const choice of scene.choices ?? []) {
      const edgeKey = `${fromId}→${choice.next}`;
      if (!choice.next || !nodePos.has(choice.next) || drawn.has(edgeKey)) continue;
      drawn.add(edgeKey);

      const to = nodePos.get(choice.next);
      const x1 = from.x + NODE_W + PAD;
      const y1 = from.y + NODE_H / 2 + PAD;
      const x2 = to.x + PAD;
      const y2 = to.y + NODE_H / 2 + PAD;

      // Back-edge: bows rightward so it doesn't cut across nodes
      const isBack = (to.x <= from.x);
      const cpx = isBack
        ? Math.max(x1, x2) + H_GAP * 0.9
        : (x1 + x2) / 2;

      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d',           `M ${x1} ${y1} C ${cpx} ${y1}, ${cpx} ${y2}, ${x2} ${y2}`);
      path.setAttribute('stroke',      'var(--ta-border)');
      path.setAttribute('stroke-width','1.5');
      path.setAttribute('fill',        'none');
      path.setAttribute('marker-end',  'url(#sg-arrow)');
      edgesG.appendChild(path);
    }
  }

  // ── Nodes ───────────────────────────────────────────────────────────────────
  for (const [sceneId, scene] of Object.entries(scenes)) {
    const pos = nodePos.get(sceneId);
    if (!pos) continue;

    const isActive      = sceneId === activeScene;
    const isEnd         = !!scene.end;
    const isStart       = sceneId === startId;
    const isUnreachable = !visited.has(sceneId);

    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class',     'sg-node');
    g.setAttribute('transform', `translate(${pos.x + PAD},${pos.y + PAD})`);
    g.addEventListener('click', () => selectScene(sceneId));

    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('width',        String(NODE_W));
    rect.setAttribute('height',       String(NODE_H));
    rect.setAttribute('rx',           '5');
    rect.setAttribute('stroke-width', isStart && !isActive ? '2' : '1.5');

    if (isActive) {
      rect.setAttribute('fill',   'var(--ta-accent)');
      rect.setAttribute('stroke', 'var(--ta-accent)');
    } else if (isEnd) {
      rect.setAttribute('fill',   'var(--ta-surface)');
      rect.setAttribute('stroke', 'var(--ta-danger)');
    } else if (isUnreachable) {
      rect.setAttribute('fill',   'var(--ta-surface)');
      rect.setAttribute('stroke', 'var(--ta-warning)');
    } else if (isStart) {
      rect.setAttribute('fill',   'var(--ta-surface)');
      rect.setAttribute('stroke', 'var(--ta-accent)');
    } else {
      rect.setAttribute('fill',   'var(--ta-surface)');
      rect.setAttribute('stroke', 'var(--ta-border)');
    }
    g.appendChild(rect);

    const textFill   = isActive ? 'var(--ta-bg)' : 'var(--ta-text)';
    const mutedFill  = isActive ? 'var(--ta-bg)' : 'var(--ta-text-muted)';
    const fontFamily = 'var(--ta-font-ui, system-ui, sans-serif)';

    const idLabel = sceneId.length > 16 ? sceneId.slice(0, 15) + '…' : sceneId;
    const idText  = document.createElementNS(NS, 'text');
    idText.setAttribute('x',           '8');
    idText.setAttribute('y',           '18');
    idText.setAttribute('fill',        textFill);
    idText.setAttribute('font-size',   '11');
    idText.setAttribute('font-weight', '600');
    idText.setAttribute('font-family', fontFamily);
    idText.textContent = idLabel;
    g.appendChild(idText);

    const raw = (scene.title || scene.text || '').replace(/\n/g, ' ');
    if (raw) {
      const preview = raw.length > 22 ? raw.slice(0, 21) + '…' : raw;
      const preText = document.createElementNS(NS, 'text');
      preText.setAttribute('x',         '8');
      preText.setAttribute('y',         '33');
      preText.setAttribute('fill',      mutedFill);
      preText.setAttribute('font-size', '9');
      preText.setAttribute('font-family', fontFamily);
      preText.textContent = preview;
      g.appendChild(preText);
    }

    // Asset badges: 🖼 image, 🎵 music, 🔊 sfx
    const hasSfx = !!(scene.on_enter?.gives_sfx ||
      (scene.choices ?? []).some(c => c.gives_sfx));
    const badges = [];
    if (scene.assets?.image && scene.assets.image !== 'none') badges.push('\uD83D\uDDBC');
    if (scene.assets?.music && scene.assets.music !== 'none') badges.push('\uD83C\uDFB5');
    if (hasSfx) badges.push('\uD83D\uDD0A');
    if (badges.length > 0) {
      const badgeText = document.createElementNS(NS, 'text');
      badgeText.setAttribute('x',         String(NODE_W - 4));
      badgeText.setAttribute('y',         '13');
      badgeText.setAttribute('fill',      mutedFill);
      badgeText.setAttribute('font-size', '9');
      badgeText.setAttribute('font-family', fontFamily);
      badgeText.setAttribute('text-anchor', 'end');
      badgeText.textContent = badges.join('');
      g.appendChild(badgeText);
    }

    nodesG.appendChild(g);
  }

  svg.appendChild(edgesG);
  svg.appendChild(nodesG);
}

function renderSceneList() {
  edScenelistList.innerHTML = '';
  const startId = campaign.metadata?.start;
  for (const [sceneId, sceneData] of Object.entries(campaign.scenes ?? {})) {
    const li = buildSceneListItem(sceneId, sceneData, sceneId === startId);
    edScenelistList.appendChild(li);
  }
}

function buildSceneListItem(sceneId, sceneData, isStart) {
  const li = document.createElement('li');
  li.className = 'ed-scenelist__item' + (sceneId === activeScene ? ' ed-scenelist__item--active' : '');
  li.dataset.sceneId = sceneId;

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:0.3em;width:100%';

  if (isStart) {
    const marker = document.createElement('span');
    marker.className = 'ed-scenelist__start-marker';
    marker.textContent = '▶';
    marker.title = 'Starting scene';
    row.appendChild(marker);
  }

  const idSpan = document.createElement('span');
  idSpan.className = 'ed-scenelist__id';
  idSpan.textContent = sceneId;
  row.appendChild(idSpan);

  const del = document.createElement('button');
  del.className = 'ed-scenelist__delete';
  del.textContent = '✕';
  del.title = `Delete scene '${sceneId}'`;
  del.addEventListener('click', (e) => { e.stopPropagation(); deleteScene(sceneId); });
  row.appendChild(del);

  li.appendChild(row);

  if (sceneData.text) li.title = sceneData.text.slice(0, 200) + (sceneData.text.length > 200 ? '…' : '');

  li.addEventListener('click', () => { ensureFormMode(); selectScene(sceneId); });
  return li;
}


function selectScene(sceneId) {
  activeScene = sceneId;
  // Update active class in list
  for (const li of edScenelistList.querySelectorAll('.ed-scenelist__item')) {
    li.classList.toggle('ed-scenelist__item--active', li.dataset.sceneId === sceneId);
  }
  // Activate Scenes nav, deactivate others
  edScenesNav.classList.add('ed-nav-section__hdr--active');
  edAttributesNav.classList.remove('ed-nav-section__hdr--active');
  edItemsNav.classList.remove('ed-nav-section__hdr--active');
  edRecipesNav.classList.remove('ed-nav-section__hdr--active');
  edAssetsNav.classList.remove('ed-nav-section__hdr--active');
  edMetaNav.classList.remove('ed-nav-section__hdr--active');
  // Show only scene form
  edMetaForm.classList.add('hidden');
  edAttributesForm.classList.add('hidden');
  edSceneForm.classList.remove('hidden');
  edItemsForm.classList.add('hidden');
  edRecipesForm.classList.add('hidden');
  edAssetsForm.classList.add('hidden');
  edSceneGraph.classList.add('hidden');
  renderSceneForm(sceneId);
}

function showScenesView() {
  activeScene = null;
  edScenesNav.classList.add('ed-nav-section__hdr--active');
  edAttributesNav.classList.remove('ed-nav-section__hdr--active');
  edMetaNav.classList.remove('ed-nav-section__hdr--active');
  edItemsNav.classList.remove('ed-nav-section__hdr--active');
  edRecipesNav.classList.remove('ed-nav-section__hdr--active');
  edAssetsNav.classList.remove('ed-nav-section__hdr--active');
  for (const li of edScenelistList.querySelectorAll('.ed-scenelist__item')) {
    li.classList.remove('ed-scenelist__item--active');
  }
  edMetaForm.classList.add('hidden');
  edAttributesForm.classList.add('hidden');
  edSceneForm.classList.add('hidden');
  edItemsForm.classList.add('hidden');
  edRecipesForm.classList.add('hidden');
  edAssetsForm.classList.add('hidden');
  edSceneGraph.classList.remove('hidden');
  renderSceneGraph();
}

function showMetadataForm() {
  activeScene = null;
  edSceneForm.classList.add('hidden');
  edAttributesForm.classList.add('hidden');
  edItemsForm.classList.add('hidden');
  edRecipesForm.classList.add('hidden');
  edAssetsForm.classList.add('hidden');
  edSceneGraph.classList.add('hidden');
  edMetaForm.classList.remove('hidden');
  edScenesNav.classList.remove('ed-nav-section__hdr--active');
  edAttributesNav.classList.remove('ed-nav-section__hdr--active');
  edItemsNav.classList.remove('ed-nav-section__hdr--active');
  edRecipesNav.classList.remove('ed-nav-section__hdr--active');
  edAssetsNav.classList.remove('ed-nav-section__hdr--active');
  edMetaNav.classList.add('ed-nav-section__hdr--active');
  for (const li of edScenelistList.querySelectorAll('.ed-scenelist__item')) {
    li.classList.remove('ed-scenelist__item--active');
  }
  refreshItemDatalist();
}

function showAttributesForm() {
  activeScene = null;
  edMetaNav.classList.remove('ed-nav-section__hdr--active');
  edScenesNav.classList.remove('ed-nav-section__hdr--active');
  edItemsNav.classList.remove('ed-nav-section__hdr--active');
  edRecipesNav.classList.remove('ed-nav-section__hdr--active');
  edAssetsNav.classList.remove('ed-nav-section__hdr--active');
  edAttributesNav.classList.add('ed-nav-section__hdr--active');
  for (const li of edScenelistList.querySelectorAll('.ed-scenelist__item')) {
    li.classList.remove('ed-scenelist__item--active');
  }
  edMetaForm.classList.add('hidden');
  edSceneForm.classList.add('hidden');
  edItemsForm.classList.add('hidden');
  edRecipesForm.classList.add('hidden');
  edAssetsForm.classList.add('hidden');
  edSceneGraph.classList.add('hidden');
  edAttributesForm.classList.remove('hidden');
  renderAttributesEditor();
}

function addScene() {
  const id = prompt('Scene ID (no spaces, not a reserved word):');
  if (!id) return;
  if (/\s/.test(id)) { alert('Scene ID cannot contain spaces'); return; }
  if (RESERVED_COMMAND_NAMES.has(id)) { alert(`'${id}' is a reserved command name`); return; }
  if (campaign.scenes[id]) { alert(`Scene '${id}' already exists`); return; }
  campaign.scenes[id] = { text: '', choices: [] };
  populateStartSelect();
  renderSceneList();
  selectScene(id);
  scheduleValidation();
}

function deleteScene(sceneId) {
  // Check for incoming references
  const refs = [];
  for (const [sid, scene] of Object.entries(campaign.scenes)) {
    if (sid === sceneId) continue;
    for (const choice of scene.choices ?? []) {
      if (choice.next === sceneId) refs.push(sid);
    }
  }
  let msg = `Delete scene '${sceneId}'?`;
  if (refs.length > 0) {
    msg += `\n\nWarning: Referenced by choices in: ${[...new Set(refs)].join(', ')}`;
  }
  if (!confirm(msg)) return;
  delete campaign.scenes[sceneId];
  if (activeScene === sceneId) {
    activeScene = null;
    showMetadataForm();
  }
  if (campaign.metadata?.start === sceneId) {
    campaign.metadata.start = undefined;
  }
  populateStartSelect();
  renderSceneList();
  scheduleValidation();
}

// ─── Visual mode: scene form ──────────────────────────────────────────────────

function renderSceneForm(sceneId) {
  const scene = campaign.scenes[sceneId];
  if (!scene) return;

  edSceneIdLabel.textContent = sceneId;
  edSceneTitle.value    = scene.title ?? '';
  edSceneText.value     = scene.text ?? '';
  edSceneTerminal.checked = !!scene.end;
  edChoicesSection.classList.toggle('hidden', !!scene.end);

  // on_enter
  const oe = scene.on_enter ?? {};
  const oeHasContent = !!(oe.message ||
    (oe.affect_attributes && Object.keys(oe.affect_attributes).length > 0) ||
    oe.gives_items?.length || oe.removes_items?.length || oe.gives_notes?.length ||
    oe.gives_sfx);
  edOnEnterDetails.open = oeHasContent;

  edOeMessage.value = oe.message ?? '';

  makeAffectAttributesEditor(edOeAffectAttrsCtr, oe.affect_attributes, (val) => {
    writeOnEnterField('affect_attributes', val);
  });

  edOeGivesItemsCtr.innerHTML = '';
  makePillInput(edOeGivesItemsCtr, oe.gives_items ?? [], (items) => {
    writeOnEnterField('gives_items', items.length ? items : undefined);
  });

  edOeRemovesItemsCtr.innerHTML = '';
  makePillInput(edOeRemovesItemsCtr, oe.removes_items ?? [], (items) => {
    writeOnEnterField('removes_items', items.length ? items : undefined);
  });

  edOeGivesNotesCtr.innerHTML = '';
  makeNotesList(edOeGivesNotesCtr, oe.gives_notes ?? [], (notes) => {
    writeOnEnterField('gives_notes', notes.length ? notes : undefined);
  });

  // on_enter gives_sfx
  edOeGivesSfxCtr.innerHTML = '';
  makeSfxPillInput(edOeGivesSfxCtr, normaliseSfxToArray(oe.gives_sfx), (keys) => {
    writeOnEnterField('gives_sfx', keys.length === 0 ? undefined : keys.length === 1 ? keys[0] : keys);
  });

  // Scene-level assets (image / music dropdowns)
  populateAssetSelect(edSceneAssetImage, 'images', scene.assets?.image ?? '');
  edSceneAssetImage.onchange = () => {
    writeSceneAssets('image', edSceneAssetImage.value || undefined);
  };
  populateAssetSelect(edSceneAssetMusic, 'music', scene.assets?.music ?? '');
  edSceneAssetMusic.onchange = () => {
    writeSceneAssets('music', edSceneAssetMusic.value || undefined);
  };

  // Auto-open assets details if any asset is set
  const sceneAssetsDetails = document.getElementById('ed-scene-assets-details');
  if (sceneAssetsDetails) {
    sceneAssetsDetails.open = !!(scene.assets?.image || scene.assets?.music);
  }

  // Choices
  renderChoicesList(sceneId);
}

/**
 * Populate an asset key dropdown for a given bucket.
 * Options: "— not set —" (empty), all registered keys, "none" (explicit clear).
 */
function populateAssetSelect(selectEl, bucket, currentValue) {
  selectEl.innerHTML = '';
  const notSetOpt = document.createElement('option');
  notSetOpt.value = '';
  notSetOpt.textContent = '— not set —';
  selectEl.appendChild(notSetOpt);

  const keys = Object.keys(campaign.assets?.[bucket] ?? {});
  for (const k of keys) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k;
    selectEl.appendChild(opt);
  }

  const noneOpt = document.createElement('option');
  noneOpt.value = 'none';
  noneOpt.textContent = 'none (explicit clear)';
  selectEl.appendChild(noneOpt);

  selectEl.value = currentValue || '';
}

function writeSceneAssets(field, value) {
  if (!activeScene) return;
  const scene = campaign.scenes[activeScene];
  if (value === undefined) {
    if (scene.assets) {
      delete scene.assets[field];
      if (Object.keys(scene.assets).length === 0) delete scene.assets;
    }
  } else {
    if (!scene.assets) scene.assets = {};
    scene.assets[field] = value;
  }
  markDirty();
  scheduleValidation();
}

/** Normalise gives_sfx (string | string[] | undefined) → string[] */
function normaliseSfxToArray(gives_sfx) {
  if (!gives_sfx) return [];
  return Array.isArray(gives_sfx) ? gives_sfx : [gives_sfx];
}

/**
 * Pill input restricted to sfx keys from the asset registry.
 * Behaves like makePillInput but uses a datalist for autocomplete.
 */
function makeSfxPillInput(container, initialKeys, onChange) {
  makePillInput(container, initialKeys, onChange, 'ed-sfx-datalist');
  refreshSfxDatalist();
}

function refreshSfxDatalist() {
  let dl = document.getElementById('ed-sfx-datalist');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'ed-sfx-datalist';
    document.body.appendChild(dl);
  }
  dl.innerHTML = '';
  for (const key of Object.keys(campaign.assets?.sfx ?? {})) {
    const opt = document.createElement('option');
    opt.value = key;
    dl.appendChild(opt);
  }
}

function writeOnEnterField(field, value) {
  if (!activeScene) return;
  if (!campaign.scenes[activeScene].on_enter) campaign.scenes[activeScene].on_enter = {};
  if (value === undefined) {
    delete campaign.scenes[activeScene].on_enter[field];
    // Clean up empty on_enter object
    if (Object.keys(campaign.scenes[activeScene].on_enter).length === 0) {
      delete campaign.scenes[activeScene].on_enter;
    }
  } else {
    campaign.scenes[activeScene].on_enter[field] = value;
  }
  scheduleValidation();
}

// ─── Visual mode: choices ─────────────────────────────────────────────────────

function renderChoicesList(sceneId) {
  edChoicesList.innerHTML = '';
  const choices = campaign.scenes[sceneId]?.choices ?? [];
  for (let i = 0; i < choices.length; i++) {
    edChoicesList.appendChild(buildChoiceCard(sceneId, i));
  }
}

function buildChoiceCard(sceneId, index) {
  const choice = campaign.scenes[sceneId].choices[index];
  const card = document.createElement('div');
  card.className = 'ed-choice-card';
  card.draggable = true;
  card.dataset.choiceIndex = String(index);

  // Drag-and-drop handlers
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    requestAnimationFrame(() => card.classList.add('ed-choice-card--dragging'));
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('ed-choice-card--dragging');
    for (const el of edChoicesList.querySelectorAll('.ed-choice-card--drag-over')) {
      el.classList.remove('ed-choice-card--drag-over');
    }
  });
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    card.classList.add('ed-choice-card--drag-over');
  });
  card.addEventListener('dragleave', (e) => {
    if (!card.contains(e.relatedTarget)) {
      card.classList.remove('ed-choice-card--drag-over');
    }
  });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('ed-choice-card--drag-over');
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const toIndex   = parseInt(card.dataset.choiceIndex, 10);
    if (fromIndex === toIndex || isNaN(fromIndex) || isNaN(toIndex)) return;
    moveChoice(sceneId, fromIndex, toIndex);
  });

  // Header row (drag handle, toggle, reorder, delete)
  const header = document.createElement('div');
  header.className = 'ed-choice-card__header';

  const dragHandle = document.createElement('span');
  dragHandle.className = 'ed-choice-card__drag-handle';
  dragHandle.textContent = '⠿';
  dragHandle.title = 'Drag to reorder';
  dragHandle.setAttribute('aria-hidden', 'true');

  const toggle = document.createElement('button');
  toggle.className = 'ed-choice-card__btn';
  toggle.textContent = '▲';
  toggle.title = 'Toggle';

  const numSpan = document.createElement('span');
  numSpan.className = 'ed-choice-card__num';
  numSpan.textContent = `${index + 1}.`;

  const labelSpan = document.createElement('span');
  labelSpan.className = 'ed-choice-card__label' + (!choice.label ? ' ed-choice-card__label--empty' : '');
  labelSpan.textContent = choice.label || '(empty)';

  const upBtn = document.createElement('button');
  upBtn.className = 'ed-choice-card__btn';
  upBtn.textContent = '▲';
  upBtn.title = 'Move up';
  upBtn.disabled = index === 0;
  upBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moveChoice(sceneId, index, index - 1);
  });

  const downBtn = document.createElement('button');
  downBtn.className = 'ed-choice-card__btn';
  downBtn.textContent = '▼';
  downBtn.title = 'Move down';
  downBtn.disabled = index === campaign.scenes[sceneId].choices.length - 1;
  downBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moveChoice(sceneId, index, index + 1);
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'ed-choice-card__btn ed-choice-card__btn--danger';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete choice';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm('Delete this choice?')) return;
    campaign.scenes[sceneId].choices.splice(index, 1);
    markDirty();
    renderChoicesList(sceneId);
    scheduleValidation();
  });

  header.appendChild(dragHandle);
  header.appendChild(toggle);
  header.appendChild(numSpan);
  header.appendChild(labelSpan);
  header.appendChild(upBtn);
  header.appendChild(downBtn);
  header.appendChild(delBtn);

  // Body (collapsible — expanded by default)
  const body = document.createElement('div');
  body.className = 'ed-choice-card__body';

  toggle.addEventListener('click', () => {
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : '';
    toggle.textContent = isOpen ? '▼' : '▲';
  });

  // Choice fields grid
  const grid = document.createElement('div');
  grid.className = 'ed-field-grid';

  function addField(labelText, element, targetGrid = grid) {
    const lbl = document.createElement('label');
    lbl.className = 'ed-label';
    lbl.textContent = labelText;
    targetGrid.appendChild(lbl);
    targetGrid.appendChild(element);
  }

  // Label
  const labelInput = makeInput('text', choice.label ?? '', 'Choice text shown to the player');
  labelInput.addEventListener('input', () => {
    choice.label = labelInput.value;
    labelSpan.textContent = choice.label || '(empty)';
    labelSpan.className = 'ed-choice-card__label' + (!choice.label ? ' ed-choice-card__label--empty' : '');
    scheduleValidation();
  });
  addField('Label', labelInput);

  // Next scene
  const nextSelect = document.createElement('select');
  nextSelect.className = 'ed-select';
  const blankOpt = document.createElement('option');
  blankOpt.value = '';
  blankOpt.textContent = '(select scene)';
  nextSelect.appendChild(blankOpt);
  for (const sid of Object.keys(campaign.scenes)) {
    const opt = document.createElement('option');
    opt.value = sid;
    opt.textContent = sid;
    nextSelect.appendChild(opt);
  }
  nextSelect.value = choice.next ?? '';
  nextSelect.addEventListener('change', () => {
    choice.next = nextSelect.value || undefined;
    goBtn.disabled = !nextSelect.value;
    scheduleValidation();
  });

  const goBtn = document.createElement('button');
  goBtn.className = 'btn btn--ghost btn--small ed-choice-goto';
  goBtn.textContent = '→';
  goBtn.title = 'Go to scene';
  goBtn.disabled = !choice.next;
  goBtn.addEventListener('click', () => {
    if (nextSelect.value) selectScene(nextSelect.value);
  });

  const nextWrap = document.createElement('div');
  nextWrap.className = 'ed-choice-next-wrap';
  nextWrap.appendChild(nextSelect);
  nextWrap.appendChild(goBtn);
  addField('Next scene', nextWrap);

  // Gives notes — below Next scene, above SFX and Items group
  const givesNotesCtr = document.createElement('div');
  givesNotesCtr.className = 'ed-notes-list';
  makeNotesList(givesNotesCtr, choice.gives_notes ?? [], (notes) => {
    choice.gives_notes = notes.length ? notes : undefined;
  });
  addField('Gives notes', givesNotesCtr);

  // SFX — below Gives notes, above Items group
  const sfxCtr = document.createElement('div');
  sfxCtr.className = 'ed-pill-container';
  makeSfxPillInput(sfxCtr, normaliseSfxToArray(choice.gives_sfx), (keys) => {
    choice.gives_sfx = keys.length === 0 ? undefined : keys.length === 1 ? keys[0] : keys;
    scheduleValidation();
  });
  addField('SFX', sfxCtr);

  // Helper: create a collapsible section group spanning full width inside the main grid
  function makeGroup(title, startOpen) {
    const hdr = document.createElement('div');
    hdr.className = 'ed-choice-group__header';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = title;

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'ed-collapsible__toggle';
    toggleBtn.type = 'button';
    toggleBtn.textContent = startOpen ? '−' : '+';

    hdr.appendChild(titleSpan);
    hdr.appendChild(toggleBtn);
    grid.appendChild(hdr);

    const body = document.createElement('div');
    body.className = 'ed-choice-group__body';
    body.style.display = startOpen ? '' : 'none';

    const innerGrid = document.createElement('div');
    innerGrid.className = 'ed-field-grid';
    body.appendChild(innerGrid);
    grid.appendChild(body);

    toggleBtn.addEventListener('click', () => {
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : '';
      toggleBtn.textContent = isOpen ? '+' : '−';
    });

    return innerGrid;
  }

  // ── Items group ──────────────────────────────────────────────────────────────
  const knownItems = Object.keys(campaign.items ?? {});
  const hasItems = !!(choice.requires_item || choice.requires_items?.length ||
                      choice.gives_items?.length || choice.removes_items?.length);
  const itemsInner = makeGroup('Items', hasItems);

  // Requires items — merge requires_item (single) and requires_items (array)
  const risCtr = document.createElement('div');
  risCtr.className = 'ed-pill-container';
  const risSeed = [
    ...(choice.requires_item ? [choice.requires_item] : []),
    ...(choice.requires_items ?? []),
  ];
  makePillInput(risCtr, risSeed, (items) => {
    delete choice.requires_item;
    choice.requires_items = items.length ? items : undefined;
    scheduleValidation();
  }, knownItems);
  addField('Requires items', risCtr, itemsInner);

  // Gives items
  const givesItemsCtr = document.createElement('div');
  givesItemsCtr.className = 'ed-pill-container';
  makePillInput(givesItemsCtr, choice.gives_items ?? [], (items) => {
    choice.gives_items = items.length ? items : undefined;
    scheduleValidation();
  }, knownItems);
  addField('Gives items', givesItemsCtr, itemsInner);

  // Removes items
  const removesItemsCtr = document.createElement('div');
  removesItemsCtr.className = 'ed-pill-container';
  makePillInput(removesItemsCtr, choice.removes_items ?? [], (items) => {
    choice.removes_items = items.length ? items : undefined;
    scheduleValidation();
  }, knownItems);
  addField('Removes items', removesItemsCtr, itemsInner);

  // ── Attributes group ─────────────────────────────────────────────────────────
  const attrDefs = campaign.attributes ?? campaign.metadata?.attributes ?? {};
  const attrNames = Object.keys(attrDefs);
  const ATTR_OPS = ['>', '>=', '<', '<=', '='];

  if (attrNames.length > 0) {
    const hasAttrs = !!(choice.requires_attributes?.length ||
                        (choice.affect_attributes &&
                         Object.values(choice.affect_attributes).some(v => Number(v) !== 0)));
    const attrsInner = makeGroup('Attributes', hasAttrs);

    // Requires attributes
    const racCtr = document.createElement('div');
    racCtr.className = 'ed-req-attrs';

    const racDlId = 'req-attr-dl-' + Math.random().toString(36).slice(2, 8);
    const racDl = document.createElement('datalist');
    racDl.id = racDlId;
    for (const name of attrNames) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = attrDefs[name].label || name;
      racDl.appendChild(o);
    }
    racCtr.appendChild(racDl);

    function buildOpSelect(selectedOp) {
      const sel = document.createElement('select');
      sel.className = 'ed-input ed-req-attrs__op';
      for (const op of ATTR_OPS) {
        const opt = document.createElement('option');
        opt.value = op; opt.textContent = op;
        opt.selected = op === selectedOp;
        sel.appendChild(opt);
      }
      return sel;
    }

    let pendingAttrName = null;

    function refreshConditions() {
      racCtr.innerHTML = '';
      racCtr.appendChild(racDl);

      const conditions = choice.requires_attributes ?? [];
      for (let ci = 0; ci < conditions.length; ci++) {
        const cond = conditions[ci];
        const row = document.createElement('div');
        row.className = 'ed-req-attrs__row';

        const badge = document.createElement('span');
        badge.className = 'ed-req-attrs__attr-badge';
        badge.textContent = attrDefs[cond.attr]?.label || cond.attr;

        const opSel = buildOpSelect(cond.op ?? '>=');
        opSel.addEventListener('change', () => { cond.op = opSel.value; markDirty(); scheduleValidation(); });

        const valInput = makeInput('number', cond.value != null ? String(Number(cond.value)) : '0', '0');
        valInput.className += ' ed-req-attrs__val';
        valInput.addEventListener('input', () => {
          cond.value = valInput.value !== '' ? Number(valInput.value) : 0;
          markDirty(); scheduleValidation();
        });

        const rmBtn = document.createElement('button');
        rmBtn.className = 'ed-btn--icon';
        rmBtn.type = 'button';
        rmBtn.textContent = '✕';
        rmBtn.title = 'Remove condition';
        rmBtn.addEventListener('click', () => {
          conditions.splice(ci, 1);
          choice.requires_attributes = conditions.length ? conditions : undefined;
          markDirty(); scheduleValidation();
          refreshConditions();
        });

        row.appendChild(badge);
        row.appendChild(opSel);
        row.appendChild(valInput);
        row.appendChild(rmBtn);
        racCtr.appendChild(row);
      }

      if (pendingAttrName === null) {
        const picker = document.createElement('input');
        picker.className = 'pill-input';
        picker.placeholder = 'Add attribute condition…';
        picker.setAttribute('list', racDlId);

        function commitPicker() {
          const val = picker.value.trim();
          if (attrNames.includes(val)) {
            pendingAttrName = val;
            refreshConditions();
          } else {
            picker.value = '';
          }
        }

        picker.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitPicker(); }
        });
        picker.addEventListener('change', () => commitPicker());
        racCtr.appendChild(picker);
      } else {
        const composerRow = document.createElement('div');
        composerRow.className = 'ed-req-attrs__composer';

        const badge = document.createElement('span');
        badge.className = 'ed-req-attrs__attr-badge';
        badge.textContent = attrDefs[pendingAttrName]?.label || pendingAttrName;

        const opSel = buildOpSelect('>=');
        const valInput = makeInput('number', '1', '0');
        valInput.className += ' ed-req-attrs__val';

        const addBtn = document.createElement('button');
        addBtn.className = 'ed-btn--icon ed-req-attrs__add';
        addBtn.type = 'button';
        addBtn.textContent = '＋';
        addBtn.title = 'Add condition';
        addBtn.addEventListener('click', () => {
          const newCond = {
            attr: pendingAttrName,
            op: opSel.value,
            value: valInput.value !== '' ? Number(valInput.value) : 0,
          };
          choice.requires_attributes = [...(choice.requires_attributes ?? []), newCond];
          pendingAttrName = null;
          markDirty(); scheduleValidation();
          refreshConditions();
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'ed-btn--icon';
        cancelBtn.type = 'button';
        cancelBtn.textContent = '✕';
        cancelBtn.title = 'Cancel';
        cancelBtn.addEventListener('click', () => { pendingAttrName = null; refreshConditions(); });

        composerRow.appendChild(badge);
        composerRow.appendChild(opSel);
        composerRow.appendChild(valInput);
        composerRow.appendChild(addBtn);
        composerRow.appendChild(cancelBtn);
        racCtr.appendChild(composerRow);
        setTimeout(() => valInput.focus(), 0);
      }
    }

    refreshConditions();
    addField('Requires attributes', racCtr, attrsInner);

    // Affect attributes — always expanded within the Attributes group
    const aaCtr = document.createElement('div');
    aaCtr.className = 'ed-affect-attrs-editor';
    addField('Affect attributes', aaCtr, attrsInner);
    makeAffectAttributesEditor(aaCtr, choice.affect_attributes, (val) => {
      choice.affect_attributes = val;
    }, { noToggle: true });
  }

  body.appendChild(grid);
  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function addChoice() {
  if (!activeScene) return;
  if (!campaign.scenes[activeScene].choices) campaign.scenes[activeScene].choices = [];
  campaign.scenes[activeScene].choices.push({ label: '', next: '' });
  renderChoicesList(activeScene);
  scheduleValidation();
}

function moveChoice(sceneId, from, to) {
  const choices = campaign.scenes[sceneId].choices;
  if (to < 0 || to >= choices.length) return;
  const [item] = choices.splice(from, 1);
  choices.splice(to, 0, item);
  markDirty();
  renderChoicesList(sceneId);
}

// ─── Visual mode: items registry ─────────────────────────────────────────────

function showItemsForm() {
  activeScene = null;
  edItemsNav.classList.add('ed-nav-section__hdr--active');
  edAttributesNav.classList.remove('ed-nav-section__hdr--active');
  edScenesNav.classList.remove('ed-nav-section__hdr--active');
  edRecipesNav.classList.remove('ed-nav-section__hdr--active');
  edAssetsNav.classList.remove('ed-nav-section__hdr--active');
  edMetaNav.classList.remove('ed-nav-section__hdr--active');
  for (const li of edScenelistList.querySelectorAll('.ed-scenelist__item')) {
    li.classList.remove('ed-scenelist__item--active');
  }
  edMetaForm.classList.add('hidden');
  edAttributesForm.classList.add('hidden');
  edSceneForm.classList.add('hidden');
  edRecipesForm.classList.add('hidden');
  edAssetsForm.classList.add('hidden');
  edSceneGraph.classList.add('hidden');
  edItemsForm.classList.remove('hidden');
  renderItemsView();
  refreshItemDatalist();
}

function renderItemsView() {
  edItemsList.innerHTML = '';
  if (!campaign.items) campaign.items = {};

  // Collect all item names used in the campaign (for dead-entry detection)
  const usedItems = collectUsedItems();

  for (const [itemName, itemDesc] of Object.entries(campaign.items)) {
    edItemsList.appendChild(buildItemRow(itemName, itemDesc, usedItems));
  }
}

function collectUsedItems() {
  const used = new Set();
  for (const scene of Object.values(campaign.scenes ?? {})) {
    for (const choice of scene.choices ?? []) {
      if (choice.requires_item) used.add(choice.requires_item);
      for (const i of choice.requires_items ?? []) used.add(i);
      for (const i of choice.gives_items ?? []) used.add(i);
      for (const i of choice.removes_items ?? []) used.add(i);
    }
    const oe = scene.on_enter ?? {};
    for (const i of oe.gives_items ?? []) used.add(i);
    for (const i of oe.removes_items ?? []) used.add(i);
  }
  for (const i of campaign.metadata?.inventory ?? []) used.add(i);
  return used;
}

function buildItemRow(itemName, itemData, usedItems) {
  const entry = document.createElement('div');
  entry.className = 'ed-item-entry';

  // Main row: name | desc | warn | delete
  const row = document.createElement('div');
  row.className = 'ed-item-row';

  const nameInput = makeInput('text', itemName, 'item name');
  nameInput.className += ' ed-item-row__name';

  const descInput = makeInput('text', itemData?.description ?? '', 'description');
  descInput.className += ' ed-item-row__desc';

  let currentName = itemName;
  nameInput.addEventListener('change', () => {
    const newName = nameInput.value.trim();
    if (!newName || newName === currentName) return;
    if (campaign.items[newName]) {
      nameInput.value = currentName;
      return;
    }
    const data = campaign.items[currentName];
    delete campaign.items[currentName];
    campaign.items[newName] = data;
    currentName = newName;
    renderItemsView();
    scheduleValidation();
  });

  descInput.addEventListener('input', () => {
    if (!campaign.items[currentName] || typeof campaign.items[currentName] !== 'object') {
      campaign.items[currentName] = { description: '', affect_attributes: {} };
    }
    campaign.items[currentName].description = descInput.value;
  });

  // Icon dropdown (select from assets.images)
  const imageKeys = Object.keys(campaign.assets?.images ?? {});
  let iconSelect = null;
  if (imageKeys.length > 0) {
    iconSelect = document.createElement('select');
    iconSelect.className = 'ed-select ed-select--small ed-item-row__icon';
    iconSelect.title = 'Item icon (from assets.images)';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '(no icon)';
    iconSelect.appendChild(noneOpt);
    for (const key of imageKeys) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = key;
      iconSelect.appendChild(opt);
    }
    iconSelect.value = itemData?.icon ?? '';
    iconSelect.addEventListener('change', () => {
      if (!campaign.items[currentName] || typeof campaign.items[currentName] !== 'object') {
        campaign.items[currentName] = { description: descInput.value, affect_attributes: {} };
      }
      campaign.items[currentName].icon = iconSelect.value || null;
      markDirty();
      scheduleValidation();
    });
  }

  const delBtn = document.createElement('button');
  delBtn.className = 'ed-item-row__delete';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete item';
  delBtn.addEventListener('click', () => {
    delete campaign.items[currentName];
    renderItemsView();
    scheduleValidation();
  });

  row.appendChild(nameInput);
  row.appendChild(descInput);
  if (iconSelect) row.appendChild(iconSelect);

  if (!usedItems.has(itemName)) {
    const warn = document.createElement('span');
    warn.className = 'ed-item-row__warn';
    warn.textContent = '⚠ unused';
    warn.title = 'This item is never granted in the campaign';
    row.appendChild(warn);
  }

  row.appendChild(delBtn);
  entry.appendChild(row);

  // Affect attributes section — only show entries already set + inline "add" button in main row
  const attrDefs = campaign.attributes ?? campaign.metadata?.attributes ?? {};
  const attrDefNames = Object.keys(attrDefs);
  if (attrDefNames.length > 0) {
    const aaSection = document.createElement('div');
    aaSection.className = 'ed-item-row__attrs';
    const current = Object.assign({}, itemData?.affect_attributes ?? {});

    // "Add" button lives in the main row, before the delete button
    const addAttrBtn = document.createElement('button');
    addAttrBtn.className = 'btn btn--ghost btn--small ed-item-row__addattr';
    addAttrBtn.textContent = '+ attr';
    addAttrBtn.title = 'Add attribute effect';

    function syncAttrs() {
      if (!campaign.items[currentName] || typeof campaign.items[currentName] !== 'object') {
        campaign.items[currentName] = { description: descInput.value, affect_attributes: {} };
      }
      campaign.items[currentName].affect_attributes = { ...current };
    }

    function updateAddBtn() {
      const remaining = attrDefNames.filter(n => !(n in current));
      addAttrBtn.style.display = remaining.length > 0 ? '' : 'none';
    }

    function rebuildAttrs() {
      aaSection.innerHTML = '';
      // One row per attribute already set on this item
      for (const attrName of Object.keys(current)) {
        const def = attrDefs[attrName];
        if (!def) continue; // campaign attr deleted; skip
        const attrRow = document.createElement('div');
        attrRow.className = 'ed-item-attr-row';
        const lbl = document.createElement('span');
        lbl.className = 'ed-item-attr-row__label';
        lbl.textContent = (def.label || attrName) + ':';
        const numInput = makeInput('number', String(Number(current[attrName] ?? 0)), '0');
        numInput.className += ' ed-item-attr-row__input';
        numInput.addEventListener('input', () => {
          current[attrName] = Number(numInput.value) || 0;
          syncAttrs();
          markDirty();
        });
        const rmBtn = document.createElement('button');
        rmBtn.className = 'ed-item-attr-row__remove';
        rmBtn.textContent = '✕';
        rmBtn.title = 'Remove effect';
        rmBtn.addEventListener('click', () => {
          delete current[attrName];
          syncAttrs();
          rebuildAttrs();
          markDirty();
        });
        attrRow.appendChild(lbl);
        attrRow.appendChild(numInput);
        attrRow.appendChild(rmBtn);
        aaSection.appendChild(attrRow);
      }
      updateAddBtn();
    }

    addAttrBtn.addEventListener('click', () => {
      const remaining = attrDefNames.filter(n => !(n in current));
      if (remaining.length === 0) return;
      if (remaining.length === 1) {
        // Only one option — add it directly
        current[remaining[0]] = 0;
        syncAttrs();
        rebuildAttrs();
        markDirty();
      } else {
        // Multiple options — show a picker in aaSection (dismiss any existing one)
        aaSection.querySelector('.ed-item-attr-pick')?.remove();
        const picker = document.createElement('div');
        picker.className = 'ed-item-attr-add ed-item-attr-pick';
        const sel = document.createElement('select');
        sel.className = 'ed-select ed-select--small';
        for (const n of remaining) {
          const opt = document.createElement('option');
          opt.value = n;
          opt.textContent = attrDefs[n].label || n;
          sel.appendChild(opt);
        }
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn--ghost btn--small';
        confirmBtn.textContent = 'Add';
        confirmBtn.addEventListener('click', () => {
          const n = sel.value;
          if (n && !(n in current)) {
            current[n] = 0;
            syncAttrs();
            rebuildAttrs();
            markDirty();
          }
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn--ghost btn--small';
        cancelBtn.textContent = '✕';
        cancelBtn.addEventListener('click', () => picker.remove());
        picker.appendChild(sel);
        picker.appendChild(confirmBtn);
        picker.appendChild(cancelBtn);
        aaSection.appendChild(picker);
      }
    });

    rebuildAttrs();
    row.insertBefore(addAttrBtn, delBtn);
    entry.appendChild(aaSection);
  }

  return entry;
}

function addItemRow() {
  if (!campaign.items) campaign.items = {};
  let n = 1;
  while (campaign.items[`new_item_${n}`] !== undefined) n++;
  campaign.items[`new_item_${n}`] = { description: '', affect_attributes: {} };
  renderItemsView();
}

// ─── Visual mode: recipes ──────────────────────────────────────────────────────

function showRecipesForm() {
  activeScene = null;
  edRecipesNav.classList.add('ed-nav-section__hdr--active');
  edAttributesNav.classList.remove('ed-nav-section__hdr--active');
  edItemsNav.classList.remove('ed-nav-section__hdr--active');
  edScenesNav.classList.remove('ed-nav-section__hdr--active');
  edAssetsNav.classList.remove('ed-nav-section__hdr--active');
  edMetaNav.classList.remove('ed-nav-section__hdr--active');
  for (const li of edScenelistList.querySelectorAll('.ed-scenelist__item')) {
    li.classList.remove('ed-scenelist__item--active');
  }
  edMetaForm.classList.add('hidden');
  edAttributesForm.classList.add('hidden');
  edSceneForm.classList.add('hidden');
  edItemsForm.classList.add('hidden');
  edAssetsForm.classList.add('hidden');
  edSceneGraph.classList.add('hidden');
  edRecipesForm.classList.remove('hidden');
  renderRecipesView();
  refreshItemDatalist();
}

function renderRecipesView() {
  edRecipesList.innerHTML = '';
  if (!campaign.recipes) campaign.recipes = [];
  for (let i = 0; i < campaign.recipes.length; i++) {
    edRecipesList.appendChild(buildRecipeCard(campaign.recipes[i], i));
  }
}

function buildRecipeCard(recipe, index) {
  const card = document.createElement('div');
  card.className = 'ed-recipe-card';

  const delBtn = document.createElement('button');
  delBtn.className = 'ed-recipe-card__delete';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete recipe';
  delBtn.addEventListener('click', () => {
    campaign.recipes.splice(index, 1);
    renderRecipesView();
    markDirty();
    scheduleValidation();
  });
  card.appendChild(delBtn);

  const grid = document.createElement('div');
  grid.className = 'ed-recipe-card__grid';

  // Inputs
  const inputsLabel = document.createElement('span');
  inputsLabel.className = 'ed-recipe-card__label';
  inputsLabel.textContent = 'Inputs';
  grid.appendChild(inputsLabel);

  const inputsCtr = document.createElement('div');
  inputsCtr.className = 'ed-pill-container';
  makePillInput(inputsCtr, recipe.inputs ?? [], (items) => {
    recipe.inputs = items;
    markDirty();
    scheduleValidation();
  }, 'ed-item-datalist');
  grid.appendChild(inputsCtr);

  // Output
  const outputLabel = document.createElement('span');
  outputLabel.className = 'ed-recipe-card__label';
  outputLabel.textContent = 'Output';
  grid.appendChild(outputLabel);

  const outputInput = makeInput('text', recipe.output ?? '', 'item name');
  outputInput.setAttribute('list', 'ed-item-datalist');
  outputInput.addEventListener('input', () => {
    recipe.output = outputInput.value.trim() || undefined;
    markDirty();
    scheduleValidation();
  });
  grid.appendChild(outputInput);

  // Message (optional)
  const msgLabel = document.createElement('span');
  msgLabel.className = 'ed-recipe-card__label';
  msgLabel.textContent = 'Message';
  grid.appendChild(msgLabel);

  const msgInput = makeInput('text', recipe.message ?? '', 'optional craft message');
  msgInput.addEventListener('input', () => {
    recipe.message = msgInput.value || undefined;
    markDirty();
  });
  grid.appendChild(msgInput);

  card.appendChild(grid);
  return card;
}

function addRecipeRow() {
  if (!campaign.recipes) campaign.recipes = [];
  campaign.recipes.push({ inputs: [], output: '' });
  renderRecipesView();
  markDirty();
}

// ─── Visual mode: asset registry ──────────────────────────────────────────────

function showAssetsForm() {
  activeScene = null;
  edAssetsNav.classList.add('ed-nav-section__hdr--active');
  edMetaNav.classList.remove('ed-nav-section__hdr--active');
  edAttributesNav.classList.remove('ed-nav-section__hdr--active');
  edItemsNav.classList.remove('ed-nav-section__hdr--active');
  edRecipesNav.classList.remove('ed-nav-section__hdr--active');
  edScenesNav.classList.remove('ed-nav-section__hdr--active');
  for (const li of edScenelistList.querySelectorAll('.ed-scenelist__item')) {
    li.classList.remove('ed-scenelist__item--active');
  }
  edMetaForm.classList.add('hidden');
  edAttributesForm.classList.add('hidden');
  edSceneForm.classList.add('hidden');
  edItemsForm.classList.add('hidden');
  edRecipesForm.classList.add('hidden');
  edSceneGraph.classList.add('hidden');
  edAssetsForm.classList.remove('hidden');
  renderAssetsView();
}

function renderAssetsView() {
  edAssetsList.innerHTML = '';
  if (!campaign.assets) campaign.assets = {};
  edAssetsList.appendChild(buildAssetBucketSection('images', 'Images', '+ Add Image'));
  edAssetsList.appendChild(buildAssetBucketSection('music', 'Music', '+ Add Track'));
  edAssetsList.appendChild(buildAssetBucketSection('sfx', 'Sound Effects', '+ Add SFX'));
}

function buildAssetBucketSection(bucket, label, addLabel) {
  const section = document.createElement('div');
  section.className = 'ed-asset-bucket';

  const header = document.createElement('div');
  header.className = 'ed-asset-bucket__header';

  const title = document.createElement('span');
  title.className = 'ed-asset-bucket__title';
  title.textContent = label;

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn--ghost btn--small';
  addBtn.textContent = addLabel;
  addBtn.addEventListener('click', () => {
    if (!campaign.assets[bucket]) campaign.assets[bucket] = {};
    let n = 1;
    while (campaign.assets[bucket][`new_asset_${n}`] !== undefined) n++;
    campaign.assets[bucket][`new_asset_${n}`] = '';
    renderAssetsView();
    markDirty();
    scheduleValidation();
  });

  header.appendChild(title);
  header.appendChild(addBtn);
  section.appendChild(header);

  const entries = Object.entries(campaign.assets[bucket] ?? {});
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'ed-asset-bucket__empty';
    empty.textContent = 'No assets declared.';
    section.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'ed-asset-bucket__list';
    for (const [key, url] of entries) {
      list.appendChild(buildAssetRow(bucket, key, url));
    }
    section.appendChild(list);
  }

  return section;
}

function buildAssetRow(bucket, key, url) {
  const row = document.createElement('div');
  row.className = 'ed-asset-row';

  let currentKey = key;

  const keyInput = makeInput('text', key, 'asset_key');
  keyInput.className += ' ed-asset-row__key';
  keyInput.addEventListener('change', () => {
    const newKey = keyInput.value.trim();
    if (!newKey || newKey === currentKey) { keyInput.value = currentKey; return; }
    if (newKey === 'none') {
      keyInput.value = currentKey;
      showToast('"none" is a reserved key name.');
      return;
    }
    if (campaign.assets[bucket]?.[newKey] !== undefined) {
      keyInput.value = currentKey;
      showToast(`Key "${newKey}" already exists in this bucket.`);
      return;
    }
    const val = campaign.assets[bucket][currentKey];
    delete campaign.assets[bucket][currentKey];
    campaign.assets[bucket][newKey] = val;
    currentKey = newKey;
    markDirty();
    scheduleValidation();
  });

  const urlInput = makeInput('text', url, 'assets/image.jpg');
  urlInput.className += ' ed-asset-row__url';
  urlInput.addEventListener('input', () => {
    campaign.assets[bucket][currentKey] = urlInput.value;
    markDirty();
    scheduleValidation();
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'ed-asset-row__delete';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete asset';
  delBtn.addEventListener('click', () => {
    const refs = findAssetReferences(bucket, currentKey);
    if (refs.length > 0) {
      const refList = refs.map(r => `  \u2022 ${r}`).join('\n');
      const msg = `Delete "${currentKey}"?\n\nThis key is referenced by ${refs.length} location${refs.length !== 1 ? 's' : ''}:\n${refList}\n\nDeleting it will leave those scenes with an unknown key (validator error). Delete anyway?`;
      if (!confirm(msg)) return;
    }
    delete campaign.assets[bucket][currentKey];
    renderAssetsView();
    markDirty();
    scheduleValidation();
  });

  row.appendChild(keyInput);
  row.appendChild(urlInput);
  row.appendChild(delBtn);
  return row;
}

/**
 * Find all scene/choice locations that reference a given asset key in the given bucket.
 * Returns an array of human-readable location strings.
 */
function findAssetReferences(bucket, key) {
  const refs = [];
  for (const [sceneId, scene] of Object.entries(campaign.scenes ?? {})) {
    if (bucket === 'images' && scene.assets?.image === key) {
      refs.push(`${sceneId} (image)`);
    }
    if (bucket === 'music' && scene.assets?.music === key) {
      refs.push(`${sceneId} (music)`);
    }
    if (bucket === 'sfx') {
      if (sfxRefIncludes(scene.on_enter?.gives_sfx, key)) {
        refs.push(`${sceneId} on_enter`);
      }
      for (const choice of scene.choices ?? []) {
        if (sfxRefIncludes(choice.gives_sfx, key)) {
          refs.push(`${sceneId} → "${choice.label || '?'}"`);
        }
      }
    }
  }
  return refs;
}

function sfxRefIncludes(gives_sfx, key) {
  if (!gives_sfx) return false;
  return Array.isArray(gives_sfx) ? gives_sfx.includes(key) : gives_sfx === key;
}

// ─── Visual mode: attributes registry editor ──────────────────────────────────

function renderAttributesEditor() {
  edMetaAttrsList.innerHTML = '';
  const attrs = campaign.attributes ?? campaign.metadata?.attributes ?? {};
  for (const [attrName, attrDef] of Object.entries(attrs)) {
    edMetaAttrsList.appendChild(buildAttributeCard(attrName, attrDef));
  }
}

function buildAttributeCard(attrName, attrDef) {
  const card = document.createElement('div');
  card.className = 'ed-attr-card';

  // Name row
  const nameRow = document.createElement('div');
  nameRow.className = 'ed-attr-card__name-row';

  let currentName = attrName;
  const nameInput = makeInput('text', attrName, 'attribute_name');
  nameInput.className += ' ed-attr-card__name';
  nameInput.addEventListener('change', () => {
    const newName = nameInput.value.trim();
    if (!newName || newName === currentName) return;
    if (campaign.attributes[newName]) { nameInput.value = currentName; return; }
    const def = campaign.attributes[currentName];
    delete campaign.attributes[currentName];
    campaign.attributes[newName] = def;
    currentName = newName;
    scheduleValidation();
    markDirty();
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'ed-attr-card__delete';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete attribute';
  delBtn.addEventListener('click', () => {
    delete campaign.attributes[currentName];
    renderAttributesEditor();
    scheduleValidation();
    markDirty();
  });

  nameRow.appendChild(nameInput);
  nameRow.appendChild(delBtn);
  card.appendChild(nameRow);

  // Field grid
  const grid = document.createElement('div');
  grid.className = 'ed-attr-card__grid';

  function addAttrField(labelText, element) {
    const lbl = document.createElement('label');
    lbl.className = 'ed-label';
    lbl.textContent = labelText;
    grid.appendChild(lbl);
    grid.appendChild(element);
  }

  // Starting value
  const valueInput = makeInput('number', String(Number(attrDef.value ?? 0)), '0');
  valueInput.addEventListener('input', () => {
    attrDef.value = Number(valueInput.value) || 0;
    markDirty();
  });
  addAttrField('Starting value', valueInput);

  // Label (optional)
  const labelInput = makeInput('text', attrDef.label ?? '', 'Display label (optional)');
  labelInput.addEventListener('input', () => {
    attrDef.label = labelInput.value || undefined;
    markDirty();
  });
  addAttrField('Label', labelInput);

  // Hidden toggle — spans both grid columns; checkbox + label kept together
  const hiddenRow = document.createElement('label');
  hiddenRow.className = 'ed-attr-boundary-row ed-attr-hidden-row';
  const hiddenCheck = document.createElement('input');
  hiddenCheck.type = 'checkbox';
  hiddenCheck.checked = !!attrDef.is_hidden;
  hiddenCheck.addEventListener('change', () => {
    attrDef.is_hidden = hiddenCheck.checked || undefined;
    markDirty();
  });
  hiddenRow.appendChild(hiddenCheck);
  hiddenRow.appendChild(document.createTextNode(' Hidden — don\'t show in HUD'));
  grid.appendChild(hiddenRow);

  // Min — boundary row: [checkbox Min] [value]
  const hasMin = attrDef.min != null;

  const minCheck = document.createElement('input');
  minCheck.type = 'checkbox';
  minCheck.checked = hasMin;

  const minInput = makeInput('number', hasMin ? String(Number(attrDef.min)) : '0', '0');
  minInput.className += ' ed-input--narrow';
  if (!hasMin) minInput.classList.add('hidden');

  const minBoundaryRow = document.createElement('label');
  minBoundaryRow.className = 'ed-attr-boundary-row';
  minBoundaryRow.appendChild(minCheck);
  minBoundaryRow.appendChild(document.createTextNode(' Min'));
  minBoundaryRow.appendChild(minInput);
  grid.appendChild(minBoundaryRow);

  minCheck.addEventListener('change', () => {
    const en = minCheck.checked;
    minInput.classList.toggle('hidden', !en);
    if (en) {
      attrDef.min = Number(minInput.value) || 0;
      if (!minInput.value) minInput.value = '0';
    } else {
      delete attrDef.min;
      minInput.value = '0';
    }
    markDirty();
    scheduleValidation();
  });
  minInput.addEventListener('input', () => {
    attrDef.min = minInput.value !== '' ? Number(minInput.value) : undefined;
    markDirty();
  });

  // Max — boundary row: [checkbox Max] [value]
  const hasMax = attrDef.max != null;

  const maxCheck = document.createElement('input');
  maxCheck.type = 'checkbox';
  maxCheck.checked = hasMax;

  const maxInput = makeInput('number', hasMax ? String(Number(attrDef.max)) : '100', '100');
  maxInput.className += ' ed-input--narrow';
  if (!hasMax) maxInput.classList.add('hidden');

  const maxBoundaryRow = document.createElement('label');
  maxBoundaryRow.className = 'ed-attr-boundary-row';
  maxBoundaryRow.appendChild(maxCheck);
  maxBoundaryRow.appendChild(document.createTextNode(' Max'));
  maxBoundaryRow.appendChild(maxInput);
  grid.appendChild(maxBoundaryRow);

  maxCheck.addEventListener('change', () => {
    const en = maxCheck.checked;
    maxInput.classList.toggle('hidden', !en);
    if (en) {
      attrDef.max = Number(maxInput.value) || 100;
      if (!maxInput.value) maxInput.value = String(attrDef.max);
    } else {
      delete attrDef.max;
      maxInput.value = '100';
    }
    markDirty();
    scheduleValidation();
  });
  maxInput.addEventListener('input', () => {
    attrDef.max = maxInput.value !== '' ? Number(maxInput.value) : undefined;
    markDirty();
  });

  card.appendChild(grid);

  // ─── Conditions section ─────────────────────────────────────────────────────
  const COND_OPS = ['<=', '>=', '<', '>', '=', '!='];

  const condSection = document.createElement('div');
  condSection.className = 'ed-attr-card__conditions';

  const condHdr = document.createElement('div');
  condHdr.className = 'ed-attr-card__conditions-hdr';
  const condLbl = document.createElement('span');
  condLbl.className = 'ed-label';
  condLbl.textContent = 'Conditions';
  const condAddBtn = document.createElement('button');
  condAddBtn.type = 'button';
  condAddBtn.className = 'btn btn--ghost btn--small';
  condAddBtn.textContent = '+ Add condition';
  condHdr.appendChild(condLbl);
  condHdr.appendChild(condAddBtn);
  condSection.appendChild(condHdr);

  const condList = document.createElement('div');
  condList.className = 'ed-attr-card__cond-list';
  condSection.appendChild(condList);

  function refreshAttrConditions() {
    condList.innerHTML = '';
    const conds = attrDef.conditions ?? [];
    for (let ci = 0; ci < conds.length; ci++) {
      const cond = conds[ci];
      const row = document.createElement('div');
      row.className = 'ed-attr-cond-row';

      // Parse `when` string into op + number
      const m = String(cond.when ?? '<= 0').trim().match(/^(<=|>=|<|>|=|!=)\s*(-?\d+(?:\.\d+)?)$/);
      const op0 = m ? m[1] : '<=';
      const val0 = m ? m[2] : '0';

      const opSel = document.createElement('select');
      opSel.className = 'ed-input ed-attr-cond-row__op';
      for (const op of COND_OPS) {
        const opt = document.createElement('option');
        opt.value = op; opt.textContent = op;
        opt.selected = op === op0;
        opSel.appendChild(opt);
      }

      const valInput = makeInput('number', val0, '0');
      valInput.className += ' ed-attr-cond-row__val';

      function updateWhen() {
        cond.when = `${opSel.value} ${valInput.value !== '' ? valInput.value : '0'}`;
        markDirty(); scheduleValidation();
      }
      opSel.addEventListener('change', updateWhen);
      valInput.addEventListener('input', updateWhen);

      // Scene redirect (optional)
      const sceneSelect = document.createElement('select');
      sceneSelect.className = 'ed-select ed-attr-cond-row__scene';
      const blankSceneOpt = document.createElement('option');
      blankSceneOpt.value = '';
      blankSceneOpt.textContent = '(no redirect)';
      sceneSelect.appendChild(blankSceneOpt);
      for (const sid of Object.keys(campaign.scenes ?? {})) {
        const opt = document.createElement('option');
        opt.value = sid; opt.textContent = sid;
        sceneSelect.appendChild(opt);
      }
      sceneSelect.value = cond.scene ?? '';
      sceneSelect.addEventListener('change', () => {
        cond.scene = sceneSelect.value || undefined;
        markDirty(); scheduleValidation();
      });

      // Message (optional)
      const msgInput = makeInput('text', cond.message ?? '', 'Message (optional)');
      msgInput.className += ' ed-attr-cond-row__msg';
      msgInput.addEventListener('input', () => {
        cond.message = msgInput.value || undefined;
        markDirty(); scheduleValidation();
      });

      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'ed-attr-card__delete';
      rmBtn.textContent = '✕';
      rmBtn.title = 'Remove condition';
      rmBtn.addEventListener('click', () => {
        attrDef.conditions.splice(ci, 1);
        if (!attrDef.conditions.length) delete attrDef.conditions;
        markDirty(); scheduleValidation();
        refreshAttrConditions();
      });

      row.appendChild(opSel);
      row.appendChild(valInput);
      row.appendChild(sceneSelect);
      row.appendChild(msgInput);
      row.appendChild(rmBtn);
      condList.appendChild(row);
    }
  }

  condAddBtn.addEventListener('click', () => {
    if (!attrDef.conditions) attrDef.conditions = [];
    attrDef.conditions.push({ when: '<= 0' });
    markDirty(); scheduleValidation();
    refreshAttrConditions();
  });

  refreshAttrConditions();
  card.appendChild(condSection);
  return card;
}

/**
 * Render an affect_attributes editor into container.
 * Shows one signed number input per attribute defined in campaign.attributes.
 * @param {HTMLElement} container
 * @param {object|undefined} currentAttrs  — current affect_attributes dict (may be sparse)
 * @param {function(object|undefined): void} onChange
 * @param {{ labelEl?: HTMLElement }} [opts]  — if labelEl provided, toggle button is appended
 *   there instead of creating a standalone collapsible wrapper (inline toggle mode)
 */
function makeAffectAttributesEditor(container, currentAttrs, onChange, opts = {}) {
  container.innerHTML = '';
  const attrDefs = campaign.attributes ?? campaign.metadata?.attributes ?? {};
  const attrNames = Object.keys(attrDefs);

  if (attrNames.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'ed-hint';
    hint.textContent = 'No attributes defined in metadata.';
    container.appendChild(hint);
    return;
  }

  const noToggle = !!opts.noToggle;
  const hasValues = currentAttrs && Object.values(currentAttrs).some((v) => Number(v) !== 0);

  // In noToggle mode, write directly into container; otherwise use a collapsible body
  let toggle = null;
  let root;
  if (noToggle) {
    root = container;
  } else {
    toggle = document.createElement('button');
    toggle.className = 'ed-collapsible__toggle';
    toggle.type = 'button';
    toggle.textContent = hasValues ? '−' : '+';

    root = document.createElement('div');
    root.className = 'ed-collapsible__body';
    root.style.display = hasValues ? '' : 'none';

    toggle.addEventListener('click', () => {
      const isOpen = root.style.display !== 'none';
      root.style.display = isOpen ? 'none' : '';
      toggle.textContent = isOpen ? '+' : '−';
    });
  }

  const current = { ...(currentAttrs ?? {}) };

  // Inline datalist for the attribute picker
  const aaDlId = 'affect-attr-dl-' + Math.random().toString(36).slice(2, 8);
  const aaDl = document.createElement('datalist');
  aaDl.id = aaDlId;
  for (const name of attrNames) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = attrDefs[name].label || name;
    aaDl.appendChild(o);
  }

  function notifyChange() {
    const filtered = {};
    for (const [k, v] of Object.entries(current)) {
      if (Number(v) !== 0) filtered[k] = v;
    }
    onChange(Object.keys(filtered).length > 0 ? filtered : undefined);
  }

  function refresh() {
    root.innerHTML = '';
    root.appendChild(aaDl);

    // Render rows for each attribute that has been explicitly added (non-undefined)
    for (const attrName of attrNames) {
      if (current[attrName] === undefined) continue;
      const def = attrDefs[attrName];
      const displayLabel = def.label || attrName;

      const row = document.createElement('div');
      row.className = 'ed-req-attrs__row';

      const badge = document.createElement('span');
      badge.className = 'ed-req-attrs__attr-badge';
      badge.textContent = displayLabel;

      const input = makeInput('number', String(Number(current[attrName])), '0');
      input.className += ' ed-req-attrs__val';
      input.dataset.attr = attrName;
      input.addEventListener('input', () => {
        current[attrName] = input.value !== '' ? Number(input.value) : 0;
        notifyChange();
      });

      const rmBtn = document.createElement('button');
      rmBtn.className = 'ed-btn--icon';
      rmBtn.type = 'button';
      rmBtn.textContent = '✕';
      rmBtn.title = 'Remove';
      rmBtn.addEventListener('click', () => {
        delete current[attrName];
        notifyChange();
        refresh();
        if (!noToggle && Object.keys(current).length === 0) {
          root.style.display = 'none';
          toggle.textContent = '+';
        }
      });

      row.appendChild(badge);
      row.appendChild(input);
      row.appendChild(rmBtn);
      root.appendChild(row);
    }

    // Attribute picker — text input with datalist
    const picker = document.createElement('input');
    picker.className = 'pill-input';
    picker.placeholder = 'Add attribute…';
    picker.setAttribute('list', aaDlId);

    function commitPicker() {
      const val = picker.value.trim();
      if (!attrNames.includes(val)) { picker.value = ''; return; }
      if (current[val] === undefined) current[val] = 0;
      notifyChange();
      picker.value = '';
      refresh();
      if (!noToggle) {
        root.style.display = '';
        toggle.textContent = '−';
      }
      root.querySelector(`[data-attr="${val}"]`)?.focus();
    }

    picker.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitPicker(); }
    });
    picker.addEventListener('change', () => {
      if (attrNames.includes(picker.value.trim())) commitPicker();
    });

    root.appendChild(picker);
  }

  refresh();

  if (noToggle) {
    // root IS container — already populated by refresh()
  } else if (opts.labelEl) {
    opts.labelEl.appendChild(toggle);
    container.appendChild(root);
  } else {
    const wrapper = document.createElement('div');
    wrapper.className = 'ed-collapsible';
    wrapper.appendChild(toggle);
    wrapper.appendChild(root);
    container.appendChild(wrapper);
  }
}

// ─── Flow (Visual) pane wiring ────────────────────────────────────────────────

function wireFlowPane() {
  edFlowFitBtn.addEventListener('click', () => {
    if (mode === 'visual') renderFlowEditor(/* refit */ true);
  });

  // Context menu item dispatch
  edFlowContextMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    hideFlowContextMenu();
    const action  = btn.dataset.action;
    const sceneId = edFlowContextMenu.dataset.sceneId;
    if (!sceneId || !campaign) return;
    if (action === 'rename') {
      activeScene = sceneId;
      openRenameModal(sceneId);
    } else if (action === 'set-start') {
      campaign.metadata.start = sceneId;
      markDirty();
      scheduleValidation();
      renderFlowEditor();
    } else if (action === 'set-terminal') {
      campaign.scenes[sceneId].end = true;
      markDirty();
      scheduleValidation();
      renderFlowEditor();
      showToast(`Scene '${sceneId}' marked as terminal.`);
    } else if (action === 'delete') {
      if (Object.keys(campaign.scenes).length <= 1) {
        showToast('Cannot delete the only scene.');
        return;
      }
      const refs = countRefsToScene(sceneId);
      if (refs > 0 && !confirm(`Delete '${sceneId}'? It is referenced by ${refs} choice${refs !== 1 ? 's' : ''}.`)) return;
      deleteSceneAndRefs(sceneId);
      markDirty();
      scheduleValidation();
      renderFlowEditor();
      showToast(`Scene '${sceneId}' deleted.`);
    }
  });

  // Choice context menu actions
  edFlowChoiceContextMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const sceneId   = edFlowChoiceContextMenu.dataset.sceneId;
    const choiceIdx = Number(edFlowChoiceContextMenu.dataset.choiceIdx);
    hideChoiceContextMenu();
    if (!sceneId || !campaign?.scenes?.[sceneId]) return;
    if (btn.dataset.action === 'retarget') {
      const choices = campaign.scenes[sceneId].choices ?? [];
      if (choiceIdx < 0 || choiceIdx >= choices.length) return;
      const current = choices[choiceIdx].next ?? '';
      const newTarget = prompt('Target scene ID:', current);
      if (newTarget === null) return;
      const trimmed = newTarget.trim();
      if (!trimmed) { showToast('Target scene ID cannot be empty.'); return; }
      if (!campaign.scenes[trimmed]) { showToast(`Scene '${trimmed}' does not exist.`); return; }
      choices[choiceIdx].next = trimmed;
      markDirty();
      scheduleValidation();
      renderFlowEditor();
    } else if (btn.dataset.action === 'delete') {
      const choices = campaign.scenes[sceneId].choices ?? [];
      if (choiceIdx < 0 || choiceIdx >= choices.length) return;
      choices.splice(choiceIdx, 1);
      markDirty();
      scheduleValidation();
      renderFlowEditor();
    }
  });

  // Dismiss overlays on outside click
  document.addEventListener('click', (e) => {
    if (!edFlowContextMenu.classList.contains('hidden') &&
        !edFlowContextMenu.contains(e.target)) hideFlowContextMenu();
    if (!edFlowChoiceContextMenu.classList.contains('hidden') &&
        !edFlowChoiceContextMenu.contains(e.target)) hideChoiceContextMenu();
    if (!edFileContextMenu.classList.contains('hidden') &&
        !edFileContextMenu.contains(e.target)) hideFileContextMenu();
  });

  // Escape — cancel edge draw and close overlays
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideFlowContextMenu();
      hideChoiceContextMenu();
      hideFileContextMenu();
      if (mode === 'visual') cancelEdgeSource();
    }
  });

  // File context menu actions
  edFileContextMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const filename = edFileContextMenu.dataset.filename;
    hideFileContextMenu();
    if (!filename) return;

    if (btn.dataset.action === 'rename') {
      const newName = prompt('Rename file to (must end in .yaml):', filename);
      if (!newName || newName === filename) return;
      if (!newName.endsWith('.yaml')) { showToast('File name must end in .yaml'); return; }
      if (newName === 'metadata.yaml') { showToast('Cannot rename to metadata.yaml'); return; }
      if (fileMap.has(newName)) { showToast(`File '${newName}' already exists`); return; }
      // Rebuild fileMap preserving insertion order
      const entries = [...fileMap.entries()].map(([k, v]) => [k === filename ? newName : k, v]);
      fileMap.clear();
      for (const [k, v] of entries) fileMap.set(k, v);
      buildSceneFileMap();
      markDirty();
      scheduleValidation();
      selectFile(newName);
    } else if (btn.dataset.action === 'duplicate') {
      let candidate = `copy_of_${filename}`;
      // Increment suffix if already taken
      let suffix = 2;
      while (fileMap.has(candidate)) {
        candidate = `copy_of_${filename.replace(/\.yaml$/, '')}_${suffix}.yaml`;
        suffix++;
      }
      fileMap.set(candidate, fileMap.get(filename));
      markDirty();
      scheduleValidation();
      renderFileTree();
      selectFile(candidate);
    } else if (btn.dataset.action === 'save') {
      const blob = new Blob([fileMap.get(filename) ?? ''], { type: 'text/yaml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } else if (btn.dataset.action === 'delete') {
      deleteFile(filename);
    }
  });
}

function hideFlowContextMenu() {
  edFlowContextMenu.classList.add('hidden');
}

function showFlowContextMenu(sceneId, x, y) {
  edFlowContextMenu.dataset.sceneId = sceneId;
  edFlowContextMenu.style.left = x + 'px';
  edFlowContextMenu.style.top  = y + 'px';
  edFlowContextMenu.classList.remove('hidden');
  const isStart = campaign?.metadata?.start === sceneId;
  const setStartBtn = edFlowContextMenu.querySelector('[data-action="set-start"]');
  if (setStartBtn) setStartBtn.disabled = isStart;
}

function showChoiceContextMenu(sceneId, choiceIdx, x, y) {
  if (!campaign?.scenes?.[sceneId]?.choices?.[choiceIdx]) return;
  edFlowChoiceContextMenu.dataset.sceneId   = sceneId;
  edFlowChoiceContextMenu.dataset.choiceIdx = choiceIdx;
  edFlowChoiceContextMenu.style.left = x + 'px';
  edFlowChoiceContextMenu.style.top  = y + 'px';
  edFlowChoiceContextMenu.classList.remove('hidden');
}

function hideChoiceContextMenu() {
  edFlowChoiceContextMenu.classList.add('hidden');
}

function showFileContextMenu(filename, x, y) {
  edFileContextMenu.dataset.filename = filename;
  edFileContextMenu.style.left = x + 'px';
  edFileContextMenu.style.top  = y + 'px';
  edFileContextMenu.classList.remove('hidden');
  // Hide the Delete option for metadata.yaml
  const deleteBtn = edFileContextMenu.querySelector('[data-action="delete"]');
  if (deleteBtn) deleteBtn.style.display = filename === 'metadata.yaml' ? 'none' : '';
  // Hide Rename and Duplicate for metadata.yaml
  const renameBtn = edFileContextMenu.querySelector('[data-action="rename"]');
  if (renameBtn) renameBtn.style.display = filename === 'metadata.yaml' ? 'none' : '';
  const dupBtn = edFileContextMenu.querySelector('[data-action="duplicate"]');
  if (dupBtn) dupBtn.style.display = filename === 'metadata.yaml' ? 'none' : '';
}

function hideFileContextMenu() {
  edFileContextMenu.classList.add('hidden');
}

function renderFlowEditor(refit = false) {
  if (!campaign) return;

  // Snapshot current node positions before rebuild so the layout never resets.
  const livePositions = getNodePositions();
  if (Object.keys(livePositions).length > 0) {
    campaign._editorMeta = campaign._editorMeta ?? {};
    campaign._editorMeta.positions = { ...campaign._editorMeta.positions, ...livePositions };
  }

  const flowCallbacks = {
    onNodeDblClick(sceneId) {
      mode = 'form';
      activateFormMode();
      selectScene(sceneId);
    },
    onNodeRightClick(sceneId, x, y) {
      hideChoiceContextMenu();
      showFlowContextMenu(sceneId, x, y);
    },
    onEdgeCreated(fromId, toId) {
      const label = prompt(`Choice label from '${fromId}' to '${toId}':`, 'Go forward');
      if (!label) return;
      const scene = campaign.scenes[fromId];
      if (!scene) return;
      scene.choices = scene.choices ?? [];
      scene.choices.push({ label, next: toId });
      markDirty();
      scheduleValidation();
      renderFlowEditor();
    },
    onChoiceRetarget(sceneId, choiceIdx, newTargetId) {
      const choices = campaign.scenes[sceneId]?.choices;
      if (!choices || choiceIdx < 0 || choiceIdx >= choices.length) return;
      if (!campaign.scenes[newTargetId]) return;
      choices[choiceIdx].next = newTargetId;
      markDirty();
      scheduleValidation();
      renderFlowEditor();
    },
    onChoiceClick() {
      // Left-click just highlights the edge (handled in visual-editor.js); no overlay shown.
      hideFlowContextMenu();
      hideChoiceContextMenu();
    },
    onChoiceDblClick(sceneId, choiceIdx) {
      hideChoiceContextMenu();
      hideFlowContextMenu();
      mode = 'form';
      activateFormMode();
      selectScene(sceneId);
      requestAnimationFrame(() => {
        const cards = edChoicesList.querySelectorAll('.ed-choice-card');
        if (cards[choiceIdx]) cards[choiceIdx].scrollIntoView({ block: 'nearest' });
      });
    },
    onChoiceRightClick(sceneId, choiceIdx, x, y) {
      hideFlowContextMenu();
      showChoiceContextMenu(sceneId, choiceIdx, x, y);
    },
    onEdgeDroppedOnCanvas(fromId, x, y) {
      // Ctrl+drag from a node released on empty canvas — create new scene + connecting choice
      const id = promptNewSceneId();
      if (!id) return;
      campaign.scenes[id] = { text: '', choices: [] };
      campaign._editorMeta = campaign._editorMeta ?? {};
      campaign._editorMeta.positions = campaign._editorMeta.positions ?? {};
      campaign._editorMeta.positions[id] = { x, y };
      const label = prompt(`Choice label from '${fromId}' to '${id}':`, 'Go forward');
      if (label) {
        const fromScene = campaign.scenes[fromId];
        if (fromScene) {
          fromScene.choices = fromScene.choices ?? [];
          fromScene.choices.push({ label, next: id });
        }
      }
      markDirty();
      scheduleValidation();
      renderFlowEditor();
      showToast(`Scene '${id}' created.`);
    },
    onCreateScene(x, y) {
      const id = promptNewSceneId();
      if (!id) return;
      campaign.scenes[id] = { text: '', choices: [] };
      campaign._editorMeta = campaign._editorMeta ?? {};
      campaign._editorMeta.positions = campaign._editorMeta.positions ?? {};
      campaign._editorMeta.positions[id] = { x, y };
      markDirty();
      scheduleValidation();
      renderFlowEditor();
      showToast(`Scene '${id}' created.`);
    },
    onPositionsChanged(positions) {
      campaign._editorMeta = campaign._editorMeta ?? {};
      campaign._editorMeta.positions = positions;
    },
    onBackgroundClick() {
      hideChoiceContextMenu();
      hideFlowContextMenu();
    },
  };

  const savedPositions = campaign._editorMeta?.positions ?? {};
  initFlowEditor(edFlowCy, campaign, flowCallbacks, savedPositions, refit);
}

function promptNewSceneId() {
  const raw = prompt('New scene ID (letters, digits, underscores):');
  if (!raw) return null;
  const id = raw.trim();
  if (!id) { showToast('Scene ID cannot be empty.'); return null; }
  if (/\s/.test(id)) { showToast('Scene ID cannot contain spaces.'); return null; }
  if (RESERVED_COMMAND_NAMES.has(id)) { showToast(`'${id}' is a reserved name.`); return null; }
  if (campaign.scenes[id]) { showToast(`Scene '${id}' already exists.`); return null; }
  return id;
}

function countRefsToScene(sceneId) {
  let count = 0;
  for (const scene of Object.values(campaign.scenes)) {
    for (const choice of scene.choices ?? []) {
      if (choice.next === sceneId) count++;
    }
  }
  return count;
}

function deleteSceneAndRefs(sceneId) {
  delete campaign.scenes[sceneId];
  if (campaign.metadata?.start === sceneId) campaign.metadata.start = undefined;
  // Remove choices pointing to deleted scene
  for (const scene of Object.values(campaign.scenes)) {
    scene.choices = (scene.choices ?? []).filter(c => c.next !== sceneId);
  }
  // Clean up _editorMeta positions
  if (campaign._editorMeta?.positions) {
    delete campaign._editorMeta.positions[sceneId];
  }
}

// ─── Validation panel ─────────────────────────────────────────────────────────

function wireValidationPanel() {
  // No additional wiring needed; scheduleValidation() drives it.
}

const scheduleValidation = debounce(runValidation, 500);

async function runValidation() {
  let results = [];
  let parseErr = null;

  if (mode === 'code') {
    try {
      const parsed = await loadCampaign(filesToArray(fileMap));
      results = validateCampaign(parsed);
    } catch (e) {
      parseErr = e.message;
    }
  } else {
    if (campaign) results = validateCampaign(campaign);
  }

  pendingValidation = results;
  pendingParseErr   = parseErr;
  renderValidationPanel(parseErr, results);
  updateActionButtons();
}

function renderValidationPanel(parseErr, results) {
  edValidationBody.innerHTML = '';

  if (parseErr) {
    const item = document.createElement('button');
    item.className = 'ed-validation__item ed-validation__item--parse';
    item.textContent = parseErr;
    edValidationBody.appendChild(item);
    return;
  }

  const errors   = results.filter(r => r.level === 'error');
  const warnings = results.filter(r => r.level === 'warning');

  if (results.length === 0) {
    const ok = document.createElement('p');
    ok.className = 'ed-validation__ok';
    ok.textContent = '✓ No issues found';
    edValidationBody.appendChild(ok);
    return;
  }

  const summary = document.createElement('p');
  summary.className = 'ed-validation__summary';
  const parts = [];
  if (errors.length)   parts.push(`${errors.length} error${errors.length !== 1 ? 's' : ''}`);
  if (warnings.length) parts.push(`${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`);
  summary.textContent = parts.join('  ');
  edValidationBody.appendChild(summary);

  for (const r of [...errors, ...warnings]) {
    const btn = document.createElement('button');
    btn.className = `ed-validation__item ed-validation__item--${r.level}`;

    const bullet = document.createElement('span');
    bullet.className = 'ed-validation__bullet';
    bullet.textContent = r.level === 'error' ? '●' : '△';
    btn.appendChild(bullet);

    const msg = document.createElement('span');
    msg.textContent = r.message;
    btn.appendChild(msg);

    btn.addEventListener('click', () => navigateToValidationItem(r));
    edValidationBody.appendChild(btn);
  }
}

function navigateToValidationItem(result) {
  // Extract scene ID from message (heuristic: first quoted word)
  const match = result.message.match(/'([\w][\w_-]*)'/);
  const sceneId = match?.[1];

  if (mode === 'code' && sceneId) {
    const filename = sceneFileMap.get(sceneId);
    if (filename && filename !== activeFile) selectFile(filename);
    // Scroll textarea to first occurrence of the scene ID
    const text = edTextarea.value;
    const idx = text.indexOf(sceneId);
    if (idx !== -1) {
      const linesBefore = text.slice(0, idx).split('\n').length - 1;
      const lineHeight = parseFloat(getComputedStyle(edTextarea).lineHeight) || 20;
      edTextarea.scrollTop = linesBefore * lineHeight;
    }
  } else if ((mode === 'form' || mode === 'visual') && sceneId && campaign.scenes?.[sceneId]) {
    if (mode === 'visual') { mode = 'form'; activateFormMode(); }
    selectScene(sceneId);
  }
}

function updateActionButtons() {
  edPlayBtn.disabled    = false;
  edZipBtn.disabled     = false;
  edPublishBtn.disabled = false;
  edPlayBtn.title    = '';
  edZipBtn.title     = '';
  edPublishBtn.title = '';
}

// ─── Export & Play ────────────────────────────────────────────────────────────

function confirmDespiteIssues(action) {
  const hasErrors   = !!pendingParseErr || pendingValidation.some(r => r.level === 'error');
  const hasWarnings = pendingValidation.some(r => r.level === 'warning');
  if (!hasErrors && !hasWarnings) return true;
  const kind = hasErrors ? 'errors' : 'warnings';
  return confirm(`This campaign has validation ${kind}. ${action} anyway?`);
}

async function downloadZip() {
  if (!confirmDespiteIssues('Download')) return;
  const map = (mode === 'code')
    ? fileMap
    : serialiseCampaign(campaign, fileMap);

  const zip = new JSZip();
  for (const [filename, text] of map) {
    zip.file(filename, text);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = sanitiseZipName(campaign?.metadata?.title) + '.zip';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  clearDirty();
}

function sanitiseZipName(title) {
  return (title ?? 'campaign')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    || 'campaign';
}

async function playCampaign() {
  // Save before playing
  saveDraft();

  if (!confirmDespiteIssues('Play')) return;
  let c = campaign;
  if (mode === 'code') {
    try { c = await loadCampaign(filesToArray(fileMap)); }
    catch { return; }
  }
  // 'form' and 'visual' modes both use campaign object directly

  const name       = c?.metadata?.title ?? 'Campaign';
  const serialised = JSON.stringify({ campaign: c, name });

  try {
    localStorage.setItem('adventure_pending_campaign', serialised);
    window.location.href = 'index.html';
  } catch { /* silent */ }
}

// ─── Rename modal ─────────────────────────────────────────────────────────────

function wireModals() {
  const closeRenameModal = () => {
    edRenameModal.classList.remove('modal-overlay--visible');
    edRenameError.classList.add('hidden');
    edRenameError.textContent = '';
  };
  edRenameCancel.addEventListener('click', closeRenameModal);
  edRenameCancel2.addEventListener('click', closeRenameModal);

  edRenameConfirm.addEventListener('click', () => {
    const newId = edRenameInput.value.trim();
    const oldId = activeScene;
    if (!newId) { showRenameError('Scene ID cannot be empty'); return; }
    if (/\s/.test(newId)) { showRenameError('Scene ID cannot contain spaces'); return; }
    if (RESERVED_COMMAND_NAMES.has(newId)) { showRenameError(`'${newId}' is a reserved name`); return; }
    if (newId !== oldId && campaign.scenes[newId]) { showRenameError(`Scene '${newId}' already exists`); return; }
    if (newId === oldId) { closeRenameModal(); return; }

    // Perform refactor rename
    campaign.scenes[newId] = campaign.scenes[oldId];
    delete campaign.scenes[oldId];

    // Rewrite all next: references
    let refCount = 0;
    for (const scene of Object.values(campaign.scenes)) {
      for (const choice of scene.choices ?? []) {
        if (choice.next === oldId) { choice.next = newId; refCount++; }
      }
    }
    if (campaign.metadata?.start === oldId) campaign.metadata.start = newId;

    activeScene = newId;
    closeRenameModal();
    // Rekey _editorMeta positions if present
    if (campaign._editorMeta?.positions?.[oldId]) {
      campaign._editorMeta.positions[newId] = campaign._editorMeta.positions[oldId];
      delete campaign._editorMeta.positions[oldId];
    }
    scheduleValidation();
    if (mode === 'visual') {
      renderFlowEditor();
    } else {
      populateStartSelect();
      renderSceneList();
      selectScene(newId);
    }
    showToast(`Renamed '${oldId}' → '${newId}'. ${refCount} reference${refCount !== 1 ? 's' : ''} updated.`);
  });

  edRenameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') edRenameConfirm.click();
    if (e.key === 'Escape') edRenameCancel.click();
  });

}

function openRenameModal() {
  if (!activeScene) return;
  edRenameInput.value = activeScene;
  edRenameError.classList.add('hidden');
  edRenameModal.classList.add('modal-overlay--visible');
  edRenameInput.focus();
  edRenameInput.select();
}

function showRenameError(msg) {
  edRenameError.textContent = msg;
  edRenameError.classList.remove('hidden');
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimeout = null;
function showToast(msg, durationMs = 3000) {
  edToast.textContent = msg;
  edToast.classList.remove('hidden', 'ed-toast--hiding');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    edToast.classList.add('ed-toast--hiding');
    setTimeout(() => edToast.classList.add('hidden'), 300);
  }, durationMs);
}

// ─── Item autocomplete ────────────────────────────────────────────────────────

/**
 * Repopulate the shared #ed-item-datalist with current item names.
 * Call whenever the items registry changes or a form that uses item inputs is shown.
 */
function refreshItemDatalist() {
  edItemDatalist.innerHTML = '';
  for (const name of Object.keys(campaign?.items ?? {})) {
    const opt = document.createElement('option');
    opt.value = name;
    edItemDatalist.appendChild(opt);
  }
}

// ─── Shared widget: pill input ────────────────────────────────────────────────

/**
 * Render a pill-based multi-value input into `container`.
 * @param {HTMLElement} container
 * @param {string[]} initialItems
 * @param {function(string[]): void} onChange
 * @param {string|null} listId  optional datalist id for autocomplete
 */
function makePillInput(container, initialItems, onChange, datalistIdOrOptions = null) {
  // Support: string = existing datalist ID; array = generate an inline datalist
  let listId = null;
  if (typeof datalistIdOrOptions === 'string') {
    listId = datalistIdOrOptions;
  } else if (Array.isArray(datalistIdOrOptions) && datalistIdOrOptions.length > 0) {
    listId = 'pill-dl-' + Math.random().toString(36).slice(2, 8);
    const dl = document.createElement('datalist');
    dl.id = listId;
    for (const opt of datalistIdOrOptions) {
      const o = document.createElement('option');
      o.value = opt;
      dl.appendChild(o);
    }
    container.appendChild(dl);
  }

  let items = [...initialItems];

  function render() {
    // Remove old pills and input but keep the datalist element if present
    const dl = container.querySelector('datalist');
    container.innerHTML = '';
    if (dl) container.appendChild(dl);

    for (const item of items) {
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = item;

      const rm = document.createElement('button');
      rm.className = 'pill__remove';
      rm.textContent = '×';
      rm.title = `Remove '${item}'`;
      rm.addEventListener('click', () => {
        items = items.filter(i => i !== item);
        onChange(items);
        render();
      });
      pill.appendChild(rm);
      container.appendChild(pill);
    }

    const input = document.createElement('input');
    input.className = 'pill-input';
    input.placeholder = 'Add…';
    if (listId) input.setAttribute('list', listId);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        commit(input.value);
      }
      if (e.key === 'Backspace' && input.value === '' && items.length > 0) {
        items = items.slice(0, -1);
        onChange(items);
        render();
        container.querySelector('.pill-input')?.focus();
      }
    });
    input.addEventListener('blur', () => {
      if (input.value.trim()) commit(input.value);
    });
    container.appendChild(input);
  }

  function commit(raw) {
    const value = raw.trim().replace(/,+$/, '');
    if (!value || items.includes(value)) {
      container.querySelector('.pill-input').value = '';
      return;
    }
    items = [...items, value];
    onChange(items);
    render();
    container.querySelector('.pill-input')?.focus();
  }

  render();
}

// ─── Shared widget: ordered notes list ───────────────────────────────────────

/**
 * Render an ordered notes list into `container`.
 * @param {HTMLElement} container
 * @param {string[]} initialNotes
 * @param {function(string[]): void} onChange
 */
function makeNotesList(container, initialNotes, onChange) {
  let notes = [...initialNotes];

  function render() {
    container.innerHTML = '';
    for (let i = 0; i < notes.length; i++) {
      const row = document.createElement('div');
      row.className = 'ed-note-row';

      const input = makeInput('text', notes[i], 'Note text…');
      input.className += ' ed-note-row__input';
      input.addEventListener('input', () => { notes[i] = input.value; onChange(notes); });

      const upBtn = document.createElement('button');
      upBtn.className = 'ed-note-row__btn';
      upBtn.textContent = '▲';
      upBtn.disabled = i === 0;
      upBtn.addEventListener('click', () => {
        if (i === 0) return;
        [notes[i - 1], notes[i]] = [notes[i], notes[i - 1]];
        onChange(notes);
        render();
      });

      const downBtn = document.createElement('button');
      downBtn.className = 'ed-note-row__btn';
      downBtn.textContent = '▼';
      downBtn.disabled = i === notes.length - 1;
      downBtn.addEventListener('click', () => {
        if (i === notes.length - 1) return;
        [notes[i], notes[i + 1]] = [notes[i + 1], notes[i]];
        onChange(notes);
        render();
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'ed-note-row__btn ed-note-row__btn--danger';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', () => {
        notes.splice(i, 1);
        onChange(notes);
        render();
      });

      row.appendChild(input);
      row.appendChild(upBtn);
      row.appendChild(downBtn);
      row.appendChild(delBtn);
      container.appendChild(row);
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn--ghost btn--small ed-add-note-btn';
    addBtn.textContent = '+ Add note';
    addBtn.addEventListener('click', () => {
      notes = [...notes, ''];
      onChange(notes);
      render();
      // Focus the new input
      const inputs = container.querySelectorAll('.ed-note-row__input');
      inputs[inputs.length - 1]?.focus();
    });
    container.appendChild(addBtn);
  }

  render();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function filesToArray(map) {
  return [...map.entries()].map(([path, text]) => ({ path, text }));
}

function debounce(fn, ms) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function makeInput(type, value, placeholder) {
  const input = document.createElement('input');
  input.type = type;
  input.className = 'ed-input';
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  return input;
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length <= maxLen ? str : str.slice(0, maxLen) + '…';
}

// ─── File I/O helpers ─────────────────────────────────────────────────────────
// Note: unzipToFiles is imported from zip-utils.js

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
      for (const child of children) await walk(child, basePath + entry.name + '/');
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const children = await readAllEntries(reader);
      for (const child of children) await walk(child, entry.name + '/');
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

// ─── Publish flow ─────────────────────────────────────────────────────────────

// Module-level ref to the currently signed-in user (populated lazily on publish click).
let publishUser = null;

function wirePublishModals() {
  // Auth modal
  const edAuthModal    = document.getElementById('ed-auth-modal');
  const edAuthCancel   = document.getElementById('ed-auth-cancel');
  const edAuthSubmit   = document.getElementById('ed-auth-submit');
  const edAuthEmail    = document.getElementById('ed-auth-email');
  const edAuthPassword = document.getElementById('ed-auth-password');
  const edAuthError    = document.getElementById('ed-auth-error');

  if (edAuthCancel) {
    edAuthCancel.addEventListener('click', () => edAuthModal.classList.remove('modal-overlay--visible'));
    edAuthModal.addEventListener('click', (e) => {
      if (e.target === edAuthModal) edAuthModal.classList.remove('modal-overlay--visible');
    });
  }

  if (edAuthSubmit) {
    const doSignIn = async () => {
      edAuthError.classList.add('hidden');
      const email    = edAuthEmail.value.trim();
      const password = edAuthPassword.value;
      if (!email || !password) { showEdAuthError('Email and password are required.'); return; }

      edAuthSubmit.disabled = true;
      edAuthSubmit.textContent = 'Signing in…';
      try {
        const { user, error } = await sbSignIn(email, password);
        if (error) { showEdAuthError(error.message); return; }
        publishUser = user;
        edAuthModal.classList.remove('modal-overlay--visible');
        // Re-trigger publish now that we're signed in
        handlePublish();
      } catch {
        showEdAuthError('Could not connect to the platform.');
      } finally {
        edAuthSubmit.disabled = false;
        edAuthSubmit.textContent = 'Sign In';
      }
    };
    edAuthSubmit.addEventListener('click', doSignIn);
    edAuthPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSignIn(); });
  }

  // Publish success modal
  const edPublishSuccessModal  = document.getElementById('ed-publish-success-modal');
  const edPublishSuccessClose  = document.getElementById('ed-publish-success-close');
  const edPublishSuccessClose2 = document.getElementById('ed-publish-success-close-2');
  if (edPublishSuccessClose)  edPublishSuccessClose.addEventListener('click',  () => edPublishSuccessModal.classList.remove('modal-overlay--visible'));
  if (edPublishSuccessClose2) edPublishSuccessClose2.addEventListener('click', () => edPublishSuccessModal.classList.remove('modal-overlay--visible'));
}

function showEdAuthError(msg) {
  const el = document.getElementById('ed-auth-error');
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

/**
 * Returns true if the current user has accepted the content policy;
 * shows the policy modal and waits for acceptance if not.
 */
async function checkPolicyAccepted() {
  if (!publishUser) return false;

  let profile;
  try {
    const result = await getProfile(publishUser.id);
    profile = result.profile;
  } catch { return false; }

  if (profile?.policy_accepted_at) return true;

  // Show policy modal and wait
  return new Promise((resolve) => {
    const modal   = document.getElementById('ed-policy-modal');
    const accept  = document.getElementById('ed-policy-accept');
    const cancel  = document.getElementById('ed-policy-cancel');
    if (!modal || !accept || !cancel) { resolve(false); return; }

    modal.classList.add('modal-overlay--visible');

    function onAccept() {
      accept.removeEventListener('click', onAccept);
      cancel.removeEventListener('click', onCancel);
      modal.classList.remove('modal-overlay--visible');
      sbAcceptPolicy().catch(() => {});
      resolve(true);
    }
    function onCancel() {
      accept.removeEventListener('click', onAccept);
      cancel.removeEventListener('click', onCancel);
      modal.classList.remove('modal-overlay--visible');
      resolve(false);
    }
    accept.addEventListener('click', onAccept);
    cancel.addEventListener('click', onCancel);
  });
}

/**
 * Show the publish/update choice modal when the user has existing campaigns.
 *
 * Resolves with:
 *   undefined — user cancelled (X or overlay click)
 *   null      — "Publish as New Campaign" chosen
 *   string    — UUID of the campaign to update
 *
 * @param {Array<{ id: string, title: string }>} campaigns
 * @returns {Promise<string|null|undefined>}
 */
function showPublishChoiceModal(campaigns) {
  return new Promise((resolve) => {
    const modal      = document.getElementById('ed-publish-choice-modal');
    const select     = document.getElementById('ed-publish-choice-select');
    const updateBtn  = document.getElementById('ed-publish-choice-update-btn');
    const newBtn     = document.getElementById('ed-publish-choice-new-btn');
    const cancelBtn  = document.getElementById('ed-publish-choice-cancel');
    const updateSect = document.getElementById('ed-publish-choice-update-section');
    if (!modal) { resolve(null); return; }

    // Populate select
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value    = '';
    placeholder.textContent = '— choose a campaign —';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
    for (const c of campaigns) {
      const opt = document.createElement('option');
      opt.value       = c.id;
      opt.textContent = c.title;
      select.appendChild(opt);
    }
    // Pre-select if only one exists
    if (campaigns.length === 1) select.value = campaigns[0].id;

    // Hide update section if no campaigns (shouldn't happen, but guard)
    updateSect.classList.toggle('hidden', campaigns.length === 0);

    modal.classList.add('modal-overlay--visible');

    function cleanup() {
      cancelBtn.removeEventListener('click', onCancel);
      updateBtn.removeEventListener('click', onUpdate);
      newBtn.removeEventListener('click', onNew);
      modal.removeEventListener('click', onOverlay);
      modal.classList.remove('modal-overlay--visible');
    }
    function onCancel()  { cleanup(); resolve(undefined); }
    function onNew()     { cleanup(); resolve(null); }
    function onUpdate()  {
      const id = select.value;
      if (!id) return; // no campaign selected yet
      cleanup();
      resolve(id);
    }
    function onOverlay(e) { if (e.target === modal) { cleanup(); resolve(undefined); } }

    cancelBtn.addEventListener('click', onCancel);
    updateBtn.addEventListener('click', onUpdate);
    newBtn.addEventListener('click', onNew);
    modal.addEventListener('click', onOverlay);
  });
}

/**
 * Main publish handler. All Supabase calls live here so the editor
 * initialises identically whether online or offline.
 *
 * Flow:
 *  1. Check login → show auth modal if not signed in
 *  2. Validate campaign (warn on errors/warnings)
 *  3. Check content policy → show policy modal if not yet accepted
 *  4. Build ZIP in memory
 *  5. Check ZIP size (≤ 1 MB)
 *  6. Fetch existing campaigns; show choice modal if any exist
 *     6a. Update existing → updateCampaignZip + updateCampaignMeta → toast
 *     6b. Publish new    → publishCampaign → success modal
 */
async function handlePublish() {
  if (!campaign) return;

  // 1. Check login
  if (!publishUser) {
    try {
      const { user } = await getUser();
      publishUser = user;
    } catch { /* offline */ }
  }

  if (!publishUser) {
    const authModal = document.getElementById('ed-auth-modal');
    if (authModal) authModal.classList.add('modal-overlay--visible');
    return;
  }

  // 2. Validate (warn but allow)
  if (!confirmDespiteIssues('Publish')) return;

  // 3. Policy check
  const policyOk = await checkPolicyAccepted();
  if (!policyOk) return;

  // 4. Build ZIP (same as downloadZip)
  let c = campaign;
  if (mode === 'code') {
    try { c = await loadCampaign(filesToArray(fileMap)); }
    catch { showToast('Fix parse errors before publishing.'); return; }
  }

  const map  = (mode === 'code') ? fileMap : serialiseCampaign(campaign, fileMap);
  const zip  = new JSZip();
  for (const [filename, text] of map) {
    zip.file(filename, text);
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });

  // 5. Size check
  const MAX_ZIP = 1 * 1024 * 1024;
  if (zipBlob.size > MAX_ZIP) {
    showToast(`Campaign ZIP is ${(zipBlob.size / 1024).toFixed(0)} KB — exceeds the 1 MB limit.`);
    return;
  }

  const title       = c.metadata?.title ?? 'Untitled';
  const description = c.metadata?.description ?? null;
  // FAILSAFE_SCHEMA: coerce nsfw flag explicitly
  const isNsfw      = c.metadata?.nsfw === true || c.metadata?.nsfw === 'true';
  const features    = detectFeatures(c);

  // 6. Offer update choice if user has existing campaigns
  let targetId = null;
  try {
    const { campaigns: existing } = await listMyCampaigns();
    if (existing.length > 0) {
      targetId = await showPublishChoiceModal(existing);
      if (targetId === undefined) return; // user cancelled
    }
  } catch { /* offline — fall through to publish-new */ }

  edPublishBtn.disabled = true;

  if (targetId) {
    // 6a. Update existing campaign
    edPublishBtn.textContent = 'Updating…';
    try {
      const { error: zipErr } = await updateCampaignZip(targetId, zipBlob);
      if (zipErr) { showToast('Update failed: ' + zipErr.message); return; }
      // Metadata update is best-effort — ZIP is already committed if this fails
      await updateCampaignMeta(targetId, { title, description, is_nsfw: isNsfw, features });
      try { localStorage.removeItem('adventure_editor_draft'); } catch { /* silent */ }
      clearDirty();
      showToast('Campaign updated.');
    } catch {
      showToast('Could not connect to the platform. Export your campaign as a ZIP instead.');
    } finally {
      edPublishBtn.disabled = false;
      edPublishBtn.textContent = 'Publish';
    }
    return;
  }

  // 6b. Publish as new campaign
  edPublishBtn.textContent = 'Publishing…';
  try {
    const { error } = await publishCampaign(zipBlob, title, description, isNsfw, features);
    if (error) {
      showToast('Publish failed: ' + error.message);
      return;
    }
    try { localStorage.removeItem('adventure_editor_draft'); } catch { /* silent */ }
    clearDirty();
    const successModal = document.getElementById('ed-publish-success-modal');
    if (successModal) successModal.classList.add('modal-overlay--visible');
  } catch {
    showToast('Could not connect to the platform. Export your campaign as a ZIP instead.');
  } finally {
    edPublishBtn.disabled = false;
    edPublishBtn.textContent = 'Publish';
  }
}

// ─── Autosave (Phase 2A) ──────────────────────────────────────────────────────

function saveDraftSilently() {
  if (!campaign) return;
  const map = (mode === 'code') ? fileMap : serialiseCampaign(campaign, fileMap);
  try {
    localStorage.setItem('adventure_editor_draft', JSON.stringify({
      savedAt: new Date().toISOString(),
      files:   Object.fromEntries(map),
    }));
  } catch { /* silent — quota exceeded */ }
}

const debouncedAutosave = debounce(saveDraftSilently, 2000);
