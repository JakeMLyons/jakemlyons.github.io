/**
 * dashboard.js — DOM wiring for the platform dashboard.
 *
 * Tabs: My Campaigns (default) | Community | Admin (injected when is_admin)
 * Layout: resizable detail panel (left) + campaign grid (right).
 *
 * Clicking a campaign card populates the detail panel.
 * My Campaigns detail: editable metadata, Save Changes, Play, Open in Editor, Delete.
 * Community detail: read-only info, Play, Vote, Report.
 *
 * Data is fetched lazily (first visit to each tab) and only refreshed when the
 * ↺ Refresh button is clicked — tab switches no longer trigger reloads.
 *
 * Offline resilience: all Supabase calls are wrapped in try/catch.
 * XSS: all user content rendered via textContent / createTextNode only.
 */

import { loadCampaign } from './campaign.js';
import { unzipToFiles } from './zip-utils.js';
import { detectFeatures } from './campaign-utils.js';
import {
  getSession, getProfile, signIn, signUp, signOut,
  onAuthStateChange,
  listPublicCampaigns, listMyCampaigns,
  updateCampaign, deleteCampaign,
  castVote, removeVote, getUserVotes,
  reportCampaign, listUnresolvedReports, resolveReport, adminDeleteCampaign,
  listCampaignVersions, restoreFromVersion,
} from './supabase-client.js';

// ─── State ────────────────────────────────────────────────────────────────────

let currentUser    = null;
let currentProfile = null;
let communityPage  = 0;
const PAGE_SIZE    = 24;

let showNsfw               = false;
let nsfwDisclaimerAccepted = false;

let communityData = [];   // campaign rows from listPublicCampaigns
let myData        = [];   // campaign rows from listMyCampaigns
let userVotes     = new Set();
let adminLoaded   = false;

// Detail panel selection
let selectedCampaign = null;  // campaign row currently shown in detail panel
let selectedCard     = null;  // <div class="campaign-card"> element

// Editor draft (from localStorage)
let editorDraft = null;  // { campaign, name, files } or null

// ─── DOM references ───────────────────────────────────────────────────────────

const authLoggedOut  = document.getElementById('auth-logged-out');
const authLoggedIn   = document.getElementById('auth-logged-in');
const authUsername   = document.getElementById('auth-username');
const signinBtn      = document.getElementById('signin-btn');
const signupBtn      = document.getElementById('signup-btn');
const signoutBtn     = document.getElementById('signout-btn');

const tabMy          = document.getElementById('tab-my');
const tabCommunity   = document.getElementById('tab-community');
const panelMy        = document.getElementById('panel-my');
const panelCommunity = document.getElementById('panel-community');
const panelAdmin     = document.getElementById('panel-admin');

const myGrid             = document.getElementById('my-grid');
const communityGrid      = document.getElementById('community-grid');
const communityPagination = document.getElementById('community-pagination');
const nsfwToggle         = document.getElementById('nsfw-toggle');
const uploadBtn          = document.getElementById('upload-campaign-btn');

const dashDetail  = document.getElementById('dash-detail');
const dashResizer = document.getElementById('dash-resizer');

// Sign In modal
const signinModal      = document.getElementById('signin-modal');
const signinModalClose = document.getElementById('signin-modal-close');
const signinEmail      = document.getElementById('signin-email');
const signinPassword   = document.getElementById('signin-password');
const signinError      = document.getElementById('signin-error');
const signinSubmit     = document.getElementById('signin-submit');
const signinToSignup   = document.getElementById('signin-to-signup');

// Sign Up modal
const signupModal      = document.getElementById('signup-modal');
const signupModalClose = document.getElementById('signup-modal-close');
const signupUsername   = document.getElementById('signup-username');
const signupEmail      = document.getElementById('signup-email');
const signupPassword   = document.getElementById('signup-password');
const signupError      = document.getElementById('signup-error');
const signupSubmit     = document.getElementById('signup-submit');
const signupToSignin   = document.getElementById('signup-to-signin');

// Policy modal
const policyModal  = document.getElementById('policy-modal');
const policyCancel = document.getElementById('policy-cancel');
const policyAccept = document.getElementById('policy-accept');
const policyError  = document.getElementById('policy-error');

// Upload modal
const uploadModal      = document.getElementById('upload-modal');
const uploadModalClose = document.getElementById('upload-modal-close');
const uploadZipInput   = document.getElementById('upload-zip-input');
const uploadError      = document.getElementById('upload-error');
const uploadCancel     = document.getElementById('upload-cancel');
const uploadSubmit     = document.getElementById('upload-submit');

// Report modal
const reportModal      = document.getElementById('report-modal');
const reportModalClose = document.getElementById('report-modal-close');
const reportCampaignId = document.getElementById('report-campaign-id');
const reportReason     = document.getElementById('report-reason');
const reportError      = document.getElementById('report-error');
const reportCancel     = document.getElementById('report-cancel');
const reportSubmit     = document.getElementById('report-submit');

const dashToast = document.getElementById('dash-toast');

// ─── Initialisation ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  wireTabs();
  wireAuth();
  wireUpload();
  wireReportModal();
  wirePolicyModal();
  wireNsfwToggle();
  wireRefresh();
  wireDetailResizer();

  // Restore saved detail panel width
  const savedWidth = localStorage.getItem('dashboard_detail_width');
  if (savedWidth) document.documentElement.style.setProperty('--dash-detail-width', savedWidth + 'px');

  // Load editor draft then show placeholder (draft card renders after auth resolves)
  await loadEditorDraft();
  showPlaceholder();

  // Auth state — init silently
  try {
    const { session } = await getSession();
    await applyAuthState(session?.user ?? null);
  } catch {
    await applyAuthState(null);
  }

  // Subscribe to future auth changes
  try {
    onAuthStateChange(async (_event, session) => {
      await applyAuthState(session?.user ?? null);
    });
  } catch { /* offline */ }
});

// ─── Auth state ───────────────────────────────────────────────────────────────

async function applyAuthState(user) {
  currentUser    = user;
  currentProfile = null;

  if (user) {
    authLoggedOut.classList.add('hidden');
    authLoggedIn.classList.remove('hidden');
    authUsername.textContent = '';

    try {
      const { profile } = await getProfile(user.id);
      currentProfile = profile;
      authUsername.textContent = profile?.username ?? user.email;
    } catch {
      authUsername.textContent = user.email ?? '';
    }

    if (currentProfile?.is_admin) injectAdminTab();

    // Always (re)load My Campaigns when auth changes
    myData = [];
    deselectCampaign();
    loadMyCampaigns();

    // Re-render community with updated vote state if already loaded
    if (communityData.length > 0) {
      try {
        const ids = communityData.map((c) => c.id);
        const { votes } = await getUserVotes(ids);
        userVotes = votes;
      } catch { userVotes = new Set(); }
      renderCommunityGrid();
    }
  } else {
    authLoggedOut.classList.remove('hidden');
    authLoggedIn.classList.add('hidden');
    authUsername.textContent = '';
    myData = [];
    deselectCampaign();
    renderMyGrid();
    userVotes = new Set();
    if (communityData.length > 0) renderCommunityGrid();
  }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function wireTabs() {
  tabMy.addEventListener('click', () => switchTab('my'));
  tabCommunity.addEventListener('click', () => switchTab('community'));
}

function switchTab(name) {
  for (const t of document.querySelectorAll('.dash-tab')) {
    t.classList.remove('dash-tab--active');
    t.setAttribute('aria-selected', 'false');
  }
  for (const p of document.querySelectorAll('.dash-panel')) {
    p.classList.add('hidden');
  }
  deselectCampaign();

  if (name === 'my') {
    tabMy.classList.add('dash-tab--active');
    tabMy.setAttribute('aria-selected', 'true');
    panelMy.classList.remove('hidden');
    // Lazy load: only fetch if no data yet
    if (myData.length === 0 && currentUser) loadMyCampaigns();
  } else if (name === 'community') {
    tabCommunity.classList.add('dash-tab--active');
    tabCommunity.setAttribute('aria-selected', 'true');
    panelCommunity.classList.remove('hidden');
    if (communityData.length === 0) loadCommunity();
  } else if (name === 'admin') {
    const adminTab = document.getElementById('tab-admin');
    if (adminTab) {
      adminTab.classList.add('dash-tab--active');
      adminTab.setAttribute('aria-selected', 'true');
    }
    panelAdmin.classList.remove('hidden');
    if (!adminLoaded) loadAdminReports();
  }
}

function injectAdminTab() {
  if (document.getElementById('tab-admin')) return;
  const tab = document.createElement('button');
  tab.className = 'dash-tab';
  tab.id = 'tab-admin';
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', 'false');
  tab.setAttribute('aria-controls', 'panel-admin');
  tab.textContent = 'Admin';
  tab.addEventListener('click', () => switchTab('admin'));
  document.querySelector('.dash-tabs').appendChild(tab);
}

// ─── Refresh buttons ──────────────────────────────────────────────────────────

function wireRefresh() {
  document.getElementById('refresh-my-btn').addEventListener('click', () => {
    myData = [];
    deselectCampaign();
    loadMyCampaigns();
  });
  document.getElementById('refresh-community-btn').addEventListener('click', () => {
    communityData = [];
    communityPage = 0;
    deselectCampaign();
    loadCommunity();
  });
  document.getElementById('refresh-admin-btn').addEventListener('click', () => {
    adminLoaded = false;
    loadAdminReports();
  });
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function selectCampaign(c, type, cardEl) {
  if (selectedCard && selectedCard !== cardEl) {
    selectedCard.classList.remove('campaign-card--selected');
  }
  selectedCampaign = c;
  selectedCard     = cardEl;
  cardEl.classList.add('campaign-card--selected');
  showDetail(c, type);
}

function deselectCampaign() {
  if (selectedCard) selectedCard.classList.remove('campaign-card--selected');
  selectedCampaign = null;
  selectedCard     = null;
  showPlaceholder();
}

function showDetail(c, type) {
  dashDetail.innerHTML = '';
  if (type === 'my') {
    buildDetailMy(c, dashDetail);
  } else if (type === 'community') {
    buildDetailCommunity(c, dashDetail);
  } else if (type === 'draft') {
    buildDetailDraft(c, dashDetail);
  }
}

function showPlaceholder() {
  dashDetail.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'detail-placeholder';
  p.textContent = 'Select a campaign to view details.';
  dashDetail.appendChild(p);
}

// ── Version history ───────────────────────────────────────────────────────────

/**
 * Asynchronously appends a "Version History" section to `container`.
 * Called without await from buildDetailMy so the panel renders immediately
 * while the network fetch runs in the background.
 */
async function buildVersionHistory(campaignId, container) {
  const sectionLabel = document.createElement('div');
  sectionLabel.className = 'detail-label';
  sectionLabel.style.marginTop = '1rem';
  sectionLabel.textContent = 'Version History';
  container.appendChild(sectionLabel);

  const placeholder = document.createElement('div');
  placeholder.className = 'detail-date';
  placeholder.textContent = 'Loading…';
  container.appendChild(placeholder);

  let versions;
  try {
    const result = await listCampaignVersions(campaignId);
    versions = result.versions;
    if (result.error) throw result.error;
  } catch {
    placeholder.textContent = 'Could not load version history.';
    return;
  }

  placeholder.remove();

  if (!versions || versions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'detail-date';
    empty.textContent = 'No previous versions.';
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;';
  container.appendChild(list);

  for (const v of versions) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:0.5rem;';

    const labelEl = document.createElement('span');
    labelEl.className = 'detail-date';
    labelEl.style.flex = '1';
    const dateStr = new Date(v.created_at).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    labelEl.textContent = `v${v.version_num} — ${dateStr}`;

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn btn--ghost btn--small';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', async () => {
      if (!confirm(`Restore to v${v.version_num}? The current campaign ZIP will be overwritten.`)) return;
      restoreBtn.disabled = true;
      restoreBtn.textContent = 'Restoring…';
      try {
        const { error } = await restoreFromVersion(campaignId, v.version_num);
        if (error) { showToast('Restore failed: ' + error.message); return; }
        showToast(`Restored to version ${v.version_num}.`);
      } catch {
        showToast('Could not connect to the platform.');
      } finally {
        restoreBtn.disabled = false;
        restoreBtn.textContent = 'Restore';
      }
    });

    row.appendChild(labelEl);
    row.appendChild(restoreBtn);
    list.appendChild(row);
  }
}

// ── Detail: My Campaigns ──

function buildDetailMy(c, container) {
  // Header
  const header = document.createElement('div');
  header.className = 'detail-header';
  const headerTitle = document.createElement('div');
  headerTitle.className = 'detail-header__title';
  headerTitle.textContent = 'Campaign Details';
  header.appendChild(headerTitle);
  const headerVote = document.createElement('span');
  headerVote.className = 'vote-count';
  headerVote.textContent = '▲ ' + (c.upvote_count ?? 0);
  header.appendChild(headerVote);
  container.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'detail-body';

  // Title field
  const titleField = document.createElement('div');
  titleField.className = 'detail-field';
  const titleLabel = document.createElement('label');
  titleLabel.className = 'detail-label';
  titleLabel.textContent = 'Title';
  const titleInput = document.createElement('input');
  titleInput.className = 'detail-input';
  titleInput.type = 'text';
  titleInput.value = c.title;
  titleInput.maxLength = 200;
  titleField.appendChild(titleLabel);
  titleField.appendChild(titleInput);
  body.appendChild(titleField);

  // Description field
  const descField = document.createElement('div');
  descField.className = 'detail-field';
  const descLabel = document.createElement('label');
  descLabel.className = 'detail-label';
  descLabel.textContent = 'Description';
  const descTextarea = document.createElement('textarea');
  descTextarea.className = 'detail-input';
  descTextarea.rows = 6;
  descTextarea.maxLength = 2000;
  descTextarea.value = c.description ?? '';
  descField.appendChild(descLabel);
  descField.appendChild(descTextarea);
  body.appendChild(descField);

  // Toggles
  const togglesDiv = document.createElement('div');
  togglesDiv.className = 'detail-toggles';

  const publicLabel = document.createElement('label');
  publicLabel.className = 'detail-toggle-label';
  const publicCheck = document.createElement('input');
  publicCheck.type = 'checkbox';
  publicCheck.checked = c.is_public;
  publicLabel.appendChild(publicCheck);
  publicLabel.append(' Public (visible in Community)');
  togglesDiv.appendChild(publicLabel);

  const nsfwLabel = document.createElement('label');
  nsfwLabel.className = 'detail-toggle-label';
  const nsfwCheck = document.createElement('input');
  nsfwCheck.type = 'checkbox';
  nsfwCheck.checked = c.is_nsfw;
  nsfwLabel.appendChild(nsfwCheck);
  nsfwLabel.append(' NSFW (adult content)');
  togglesDiv.appendChild(nsfwLabel);

  body.appendChild(togglesDiv);

  // Badges
  const metaDiv = document.createElement('div');
  metaDiv.className = 'detail-meta';
  if (c.is_nsfw) metaDiv.appendChild(makeBadge('NSFW', 'nsfw'));
  for (const feat of c.features ?? []) metaDiv.appendChild(makeBadge(feat, 'feature'));
  body.appendChild(metaDiv);

  // Error display
  const errorEl = document.createElement('p');
  errorEl.className = 'detail-error hidden';
  body.appendChild(errorEl);

  // Save Changes button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn--small';
  saveBtn.textContent = 'Save Changes';
  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) { showDetailError(errorEl, 'Title is required.'); return; }
    errorEl.classList.add('hidden');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const { error } = await updateCampaign(c.id, {
        title,
        description: descTextarea.value.trim() || null,
        is_public:   publicCheck.checked,
        is_nsfw:     nsfwCheck.checked,
      });
      if (error) { showDetailError(errorEl, error.message); return; }
      // Update in-memory
      Object.assign(c, {
        title,
        description: descTextarea.value.trim() || null,
        is_public:   publicCheck.checked,
        is_nsfw:     nsfwCheck.checked,
      });
      const idx = myData.findIndex((x) => x.id === c.id);
      if (idx >= 0) myData[idx] = c;
      renderMyGrid();
      // Re-select updated card
      const updatedCard = myGrid.querySelector(`[data-campaign-id="${c.id}"]`);
      if (updatedCard) {
        selectedCard = updatedCard;
        updatedCard.classList.add('campaign-card--selected');
      }
      // Invalidate community cache if visibility changed
      communityData = [];
      showToast('Campaign updated.');
    } catch {
      showDetailError(errorEl, 'Could not connect to the platform.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });
  body.appendChild(saveBtn);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'detail-actions';

  const playBtn = document.createElement('button');
  playBtn.className = 'btn btn--small';
  playBtn.textContent = '▶ Play';
  playBtn.addEventListener('click', () => launchFromPlatform(c));
  actions.appendChild(playBtn);

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn--ghost btn--small';
  editBtn.textContent = '✎ Open in Editor';
  editBtn.addEventListener('click', () => launchToEditor(c));
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn--ghost btn--small';
  deleteBtn.style.color = 'var(--ta-danger)';
  deleteBtn.textContent = 'Delete Campaign';
  deleteBtn.addEventListener('click', () => handleDeleteFromPanel(c));
  actions.appendChild(deleteBtn);

  body.appendChild(actions);

  // Version history — async, appends to body after fetch so panel renders immediately
  buildVersionHistory(c.id, body);

  container.appendChild(body);
}

// ── Detail: Community ──

function buildDetailCommunity(c, container) {
  // Header
  const header = document.createElement('div');
  header.className = 'detail-header';
  const headerTitle = document.createElement('div');
  headerTitle.className = 'detail-header__title';
  headerTitle.textContent = c.title;
  header.appendChild(headerTitle);
  const voteCountEl = document.createElement('span');
  voteCountEl.className = 'vote-count';
  voteCountEl.textContent = '▲ ' + (c.upvote_count ?? 0);
  header.appendChild(voteCountEl);
  container.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'detail-body';

  const titleEl = document.createElement('div');
  titleEl.className = 'detail-campaign-title';
  titleEl.textContent = c.title;
  body.appendChild(titleEl);

  const authorEl = document.createElement('div');
  authorEl.className = 'detail-author';
  authorEl.textContent = 'by ' + (c.profiles?.username ?? 'unknown');
  body.appendChild(authorEl);

  if (c.description) {
    const descEl = document.createElement('div');
    descEl.className = 'detail-description';
    descEl.textContent = c.description;
    body.appendChild(descEl);
  }

  const dateEl = document.createElement('div');
  dateEl.className = 'detail-date';
  dateEl.textContent = new Date(c.created_at).toLocaleDateString();
  body.appendChild(dateEl);

  // Badges
  const metaDiv = document.createElement('div');
  metaDiv.className = 'detail-meta';
  if (c.is_nsfw) metaDiv.appendChild(makeBadge('NSFW', 'nsfw'));
  for (const feat of c.features ?? []) metaDiv.appendChild(makeBadge(feat, 'feature'));
  body.appendChild(metaDiv);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'detail-actions';

  const playBtn = document.createElement('button');
  playBtn.className = 'btn btn--small';
  playBtn.textContent = '▶ Play';
  playBtn.addEventListener('click', () => launchFromPlatform(c));
  actions.appendChild(playBtn);

  if (currentUser) {
    const isOwn = currentUser.id === c.user_id;
    if (!isOwn) {
      const voted = userVotes.has(c.id);
      const voteBtn = document.createElement('button');
      voteBtn.className = 'btn btn--ghost btn--small' + (voted ? ' btn--voted' : '');
      voteBtn.textContent = voted ? '▲ Unvote' : '▲ Vote';
      voteBtn.addEventListener('click', () => handleVote(c, voteBtn, voteCountEl));
      actions.appendChild(voteBtn);

      const reportBtn = document.createElement('button');
      reportBtn.className = 'btn btn--ghost btn--small';
      reportBtn.textContent = '⚑ Report';
      reportBtn.addEventListener('click', () => openReportModal(c.id));
      actions.appendChild(reportBtn);
    }
  }

  body.appendChild(actions);
  container.appendChild(body);
}

function showDetailError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── Detail: Draft ──

function buildDetailDraft(draft, container) {
  const c = draft.campaign;

  // Header
  const header = document.createElement('div');
  header.className = 'detail-header';
  const headerTitle = document.createElement('div');
  headerTitle.className = 'detail-header__title';
  headerTitle.textContent = 'Saved Draft';
  header.appendChild(headerTitle);
  container.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'detail-body';

  const titleEl = document.createElement('div');
  titleEl.className = 'detail-campaign-title';
  titleEl.textContent = draft.name;
  body.appendChild(titleEl);

  if (c.metadata?.author) {
    const authorEl = document.createElement('div');
    authorEl.className = 'detail-author';
    authorEl.textContent = 'by ' + c.metadata.author;
    body.appendChild(authorEl);
  }

  if (c.metadata?.description) {
    const descEl = document.createElement('div');
    descEl.className = 'detail-description';
    descEl.textContent = c.metadata.description;
    body.appendChild(descEl);
  }

  if (c.metadata?.version) {
    const verEl = document.createElement('div');
    verEl.className = 'detail-date';
    verEl.textContent = 'Version ' + c.metadata.version;
    body.appendChild(verEl);
  }

  const metaDiv = document.createElement('div');
  metaDiv.className = 'detail-meta';
  metaDiv.appendChild(makeBadge('✎ Draft', 'draft'));
  for (const feat of detectFeatures(c)) {
    metaDiv.appendChild(makeBadge(feat, 'feature'));
  }
  body.appendChild(metaDiv);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'detail-actions';

  const playBtn = document.createElement('button');
  playBtn.className = 'btn btn--small';
  playBtn.textContent = '▶ Play Draft';
  playBtn.addEventListener('click', () => {
    localStorage.setItem('adventure_pending_campaign', JSON.stringify({ campaign: c, name: draft.name }));
    window.location.href = 'index.html';
  });
  actions.appendChild(playBtn);

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn--ghost btn--small';
  editBtn.textContent = '✎ Continue Editing';
  editBtn.addEventListener('click', () => {
    localStorage.setItem('adventure_pending_edit', JSON.stringify({
      campaign: c, name: draft.name, files: draft.files,
    }));
    window.location.href = 'editor.html?edit';
  });
  actions.appendChild(editBtn);

  const discardBtn = document.createElement('button');
  discardBtn.className = 'btn btn--ghost btn--small';
  discardBtn.style.color = 'var(--ta-danger)';
  discardBtn.textContent = 'Discard Draft';
  discardBtn.addEventListener('click', () => {
    if (!confirm(`Discard draft "${draft.name}"? This cannot be undone.`)) return;
    localStorage.removeItem('adventure_editor_draft');
    editorDraft = null;
    deselectCampaign();
    renderMyGrid();
    showToast('Draft discarded.');
  });
  actions.appendChild(discardBtn);

  body.appendChild(actions);
  container.appendChild(body);
}

// ─── Editor draft ─────────────────────────────────────────────────────────────

async function loadEditorDraft() {
  try {
    const raw = localStorage.getItem('adventure_editor_draft');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return;
    // Editor saves as { savedAt, files: { filename: text } }
    const fileMap = parsed.files ?? parsed;
    if (typeof fileMap !== 'object' || fileMap === null) return;
    const files    = Object.entries(fileMap).map(([path, text]) => ({ path, text }));
    const campaign = await loadCampaign(files);
    editorDraft = {
      campaign,
      name:  campaign.metadata?.title ?? 'Untitled Draft',
      files: fileMap,
    };
  } catch {
    editorDraft = null;
  }
}

// ─── Detail panel resizer ─────────────────────────────────────────────────────

function wireDetailResizer() {
  let startX, startW;

  dashResizer.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startW = dashDetail.offsetWidth;
    dashResizer.classList.add('dash-resizer--dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });

  function onMove(e) {
    const newW = Math.max(200, Math.min(480, startW + (e.clientX - startX)));
    document.documentElement.style.setProperty('--dash-detail-width', newW + 'px');
    localStorage.setItem('dashboard_detail_width', newW);
  }

  function onUp() {
    dashResizer.classList.remove('dash-resizer--dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
}

// ─── Auth modals ──────────────────────────────────────────────────────────────

function wireAuth() {
  signinBtn.addEventListener('click', () => openModal(signinModal));
  signupBtn.addEventListener('click', () => openModal(signupModal));
  signoutBtn.addEventListener('click', handleSignOut);

  signinModalClose.addEventListener('click', () => closeModal(signinModal));
  signupModalClose.addEventListener('click', () => closeModal(signupModal));

  signinModal.addEventListener('click', (e) => { if (e.target === signinModal) closeModal(signinModal); });
  signupModal.addEventListener('click', (e) => { if (e.target === signupModal) closeModal(signupModal); });

  signinToSignup.addEventListener('click', () => { closeModal(signinModal); openModal(signupModal); });
  signupToSignin.addEventListener('click', () => { closeModal(signupModal); openModal(signinModal); });

  signinSubmit.addEventListener('click', handleSignIn);
  signupSubmit.addEventListener('click', handleSignUp);
  signinPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSignIn(); });
  signupPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSignUp(); });
}

async function handleSignIn() {
  signinError.classList.add('hidden');
  const email    = signinEmail.value.trim();
  const password = signinPassword.value;
  if (!email || !password) { showModalError(signinError, 'Email and password are required.'); return; }

  signinSubmit.disabled = true;
  signinSubmit.textContent = 'Signing in…';
  try {
    const { error } = await signIn(email, password);
    if (error) { showModalError(signinError, error.message); return; }
    closeModal(signinModal);
    showToast('Signed in.');
  } catch {
    showModalError(signinError, 'Could not connect to the platform.');
  } finally {
    signinSubmit.disabled = false;
    signinSubmit.textContent = 'Sign In';
  }
}

async function handleSignUp() {
  signupError.classList.add('hidden');
  const username = signupUsername.value.trim();
  const email    = signupEmail.value.trim();
  const password = signupPassword.value;
  if (!username || !email || !password) {
    showModalError(signupError, 'All fields are required.');
    return;
  }

  signupSubmit.disabled = true;
  signupSubmit.textContent = 'Creating account…';
  try {
    const { error } = await signUp(email, password, username);
    if (error) { showModalError(signupError, error.message); return; }
    closeModal(signupModal);
    showToast('Account created! Check your email to confirm your address.');
  } catch {
    showModalError(signupError, 'Could not connect to the platform.');
  } finally {
    signupSubmit.disabled = false;
    signupSubmit.textContent = 'Create Account';
  }
}

async function handleSignOut() {
  try { await signOut(); } catch { /* silent */ }
  currentUser    = null;
  currentProfile = null;
  authLoggedIn.classList.add('hidden');
  authLoggedOut.classList.remove('hidden');
  deselectCampaign();
  myData = [];
  renderMyGrid();
  userVotes = new Set();
  if (communityData.length > 0) renderCommunityGrid();
  showToast('Signed out.');
}

// ─── NSFW toggle ──────────────────────────────────────────────────────────────

function wireNsfwToggle() {
  nsfwToggle.addEventListener('change', () => {
    if (nsfwToggle.checked && !nsfwDisclaimerAccepted) {
      const ok = confirm('NSFW campaigns may contain adult themes and content. Show them anyway?');
      if (!ok) { nsfwToggle.checked = false; return; }
      nsfwDisclaimerAccepted = true;
    }
    showNsfw = nsfwToggle.checked;
    communityPage = 0;
    communityData = [];
    deselectCampaign();
    loadCommunity();
  });
}

// ─── Community tab ────────────────────────────────────────────────────────────

async function loadCommunity() {
  communityGrid.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'dash-empty';
  loading.textContent = 'Loading campaigns…';
  communityGrid.appendChild(loading);

  try {
    const { campaigns, error } = await listPublicCampaigns({
      nsfw: showNsfw, page: communityPage, pageSize: PAGE_SIZE,
    });
    if (error) throw error;
    communityData = campaigns ?? [];

    if (currentUser && communityData.length > 0) {
      try {
        const ids = communityData.map((c) => c.id);
        const { votes } = await getUserVotes(ids);
        userVotes = votes;
      } catch { userVotes = new Set(); }
    } else {
      userVotes = new Set();
    }

    renderCommunityGrid();
    renderPagination();
  } catch {
    communityGrid.innerHTML = '';
    const msg = document.createElement('p');
    msg.className = 'dash-empty';
    msg.textContent = 'Could not connect to the platform. ';
    const link = document.createElement('a');
    link.href = 'editor.html?new';
    link.textContent = 'Open Editor';
    msg.appendChild(link);
    communityGrid.appendChild(msg);
  }
}

function renderCommunityGrid() {
  communityGrid.innerHTML = '';
  if (communityData.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'dash-empty';
    msg.textContent = communityPage === 0
      ? 'No campaigns published yet. Be the first!'
      : 'No more campaigns.';
    communityGrid.appendChild(msg);
    return;
  }
  for (const c of communityData) communityGrid.appendChild(buildCommunityCard(c));
}

function buildCommunityCard(c) {
  const card = document.createElement('div');
  card.className = 'campaign-card';
  card.dataset.campaignId = c.id;
  card.style.cursor = 'pointer';

  const titleRow = document.createElement('div');
  titleRow.className = 'campaign-card__title-row';
  const title = document.createElement('div');
  title.className = 'campaign-card__title';
  title.textContent = c.title;
  const voteSpan = document.createElement('span');
  voteSpan.className = 'vote-count';
  voteSpan.textContent = '▲ ' + (c.upvote_count ?? 0);
  titleRow.appendChild(title);
  titleRow.appendChild(voteSpan);
  card.appendChild(titleRow);

  if (c.description) {
    const desc = document.createElement('div');
    desc.className = 'campaign-card__description';
    desc.textContent = c.description;
    card.appendChild(desc);
  }

  const author = document.createElement('div');
  author.className = 'campaign-card__author';
  author.textContent = 'by ' + (c.profiles?.username ?? 'unknown');
  card.appendChild(author);

  const meta = document.createElement('div');
  meta.className = 'campaign-card__meta';
  if (c.is_nsfw) meta.appendChild(makeBadge('NSFW', 'nsfw'));
  for (const feat of c.features ?? []) meta.appendChild(makeBadge(feat, 'feature'));
  card.appendChild(meta);

  card.addEventListener('click', () => selectCampaign(c, 'community', card));
  return card;
}

function renderPagination() {
  communityPagination.innerHTML = '';
  if (communityPage > 0) {
    const prev = document.createElement('button');
    prev.className = 'btn btn--ghost btn--small';
    prev.textContent = '← Previous';
    prev.addEventListener('click', () => { communityPage--; communityData = []; deselectCampaign(); loadCommunity(); });
    communityPagination.appendChild(prev);
  }
  if (communityData.length === PAGE_SIZE) {
    const next = document.createElement('button');
    next.className = 'btn btn--ghost btn--small';
    next.textContent = 'Next →';
    next.addEventListener('click', () => { communityPage++; communityData = []; deselectCampaign(); loadCommunity(); });
    communityPagination.appendChild(next);
  }
}

// ─── Voting ───────────────────────────────────────────────────────────────────

async function handleVote(c, voteBtn, voteCountEl) {
  const wasVoted = userVotes.has(c.id);

  // Optimistic update
  if (wasVoted) {
    userVotes.delete(c.id);
    c.upvote_count = Math.max(0, (c.upvote_count ?? 1) - 1);
  } else {
    userVotes.add(c.id);
    c.upvote_count = (c.upvote_count ?? 0) + 1;
  }
  voteBtn.textContent = wasVoted ? '▲ Vote' : '▲ Unvote';
  voteBtn.classList.toggle('btn--voted', !wasVoted);
  if (voteCountEl) voteCountEl.textContent = '▲ ' + c.upvote_count;
  // Update card vote count too
  const cardEl = communityGrid.querySelector(`[data-campaign-id="${c.id}"] .vote-count`);
  if (cardEl) cardEl.textContent = '▲ ' + c.upvote_count;

  try {
    if (wasVoted) await removeVote(c.id);
    else await castVote(c.id);
  } catch {
    // Revert
    if (wasVoted) { userVotes.add(c.id); c.upvote_count++; }
    else { userVotes.delete(c.id); c.upvote_count = Math.max(0, c.upvote_count - 1); }
    voteBtn.textContent = wasVoted ? '▲ Unvote' : '▲ Vote';
    voteBtn.classList.toggle('btn--voted', wasVoted);
    if (voteCountEl) voteCountEl.textContent = '▲ ' + c.upvote_count;
    if (cardEl) cardEl.textContent = '▲ ' + c.upvote_count;
    showToast('Could not connect to the platform.');
  }
}

// ─── Reporting ────────────────────────────────────────────────────────────────

function wireReportModal() {
  reportModalClose.addEventListener('click', () => closeModal(reportModal));
  reportModal.addEventListener('click', (e) => { if (e.target === reportModal) closeModal(reportModal); });
  reportCancel.addEventListener('click', () => closeModal(reportModal));
  reportSubmit.addEventListener('click', handleReport);
}

function openReportModal(campaignId) {
  reportCampaignId.value = campaignId;
  reportReason.value = '';
  reportError.classList.add('hidden');
  openModal(reportModal);
}

async function handleReport() {
  const id     = reportCampaignId.value;
  const reason = reportReason.value.trim();

  reportSubmit.disabled = true;
  reportSubmit.textContent = 'Submitting…';
  try {
    const { error } = await reportCampaign(id, reason);
    if (error) { showModalError(reportError, error.message); return; }
    closeModal(reportModal);
    showToast('Report submitted. Thank you.');
  } catch {
    showModalError(reportError, 'Could not connect to the platform.');
  } finally {
    reportSubmit.disabled = false;
    reportSubmit.textContent = 'Submit Report';
  }
}

// ─── My Campaigns tab ─────────────────────────────────────────────────────────

async function loadMyCampaigns() {
  if (!currentUser) { renderMyGrid(); return; }

  myGrid.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'dash-empty';
  loading.textContent = 'Loading your campaigns…';
  myGrid.appendChild(loading);

  try {
    const { campaigns, error } = await listMyCampaigns();
    if (error) throw error;
    myData = campaigns ?? [];
    renderMyGrid();
  } catch {
    myData = [];
    renderMyGrid();
    const msg = document.createElement('p');
    msg.className = 'dash-empty';
    msg.textContent = 'Could not connect to the platform.';
    myGrid.appendChild(msg);
  }
}

function renderMyGrid() {
  myGrid.innerHTML = '';

  // '+' card is always first
  myGrid.appendChild(buildNewCampaignCard());

  // Draft card directly after, if a draft exists
  if (editorDraft) {
    myGrid.appendChild(buildDraftCard());
  }

  if (!currentUser) {
    const msg = document.createElement('p');
    msg.className = 'dash-empty';
    msg.textContent = 'Sign in to see your published campaigns.';
    myGrid.appendChild(msg);
    return;
  }

  if (myData.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'dash-empty';
    msg.textContent = 'No published campaigns yet. Upload or create one above.';
    myGrid.appendChild(msg);
    return;
  }

  for (const c of myData) myGrid.appendChild(buildMyCard(c));
}

function buildNewCampaignCard() {
  const card = document.createElement('div');
  card.className = 'campaign-card campaign-card--new';
  card.style.cursor = 'pointer';
  card.setAttribute('aria-label', 'Create new campaign');

  const icon = document.createElement('div');
  icon.className = 'campaign-card__new-icon';
  icon.textContent = '+';
  card.appendChild(icon);

  const label = document.createElement('div');
  label.className = 'campaign-card__new-label';
  label.textContent = 'New Campaign';
  card.appendChild(label);

  card.addEventListener('click', () => {
    window.location.href = 'editor.html?new';
  });

  // Drag-and-drop a ZIP onto the + card to open it in the editor
  let dragDepth = 0;
  card.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    card.classList.add('drag-over');
  });
  card.addEventListener('dragleave', () => {
    dragDepth--;
    if (dragDepth === 0) card.classList.remove('drag-over');
  });
  card.addEventListener('dragover', (e) => { e.preventDefault(); });
  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    card.classList.remove('drag-over');
    const file = [...(e.dataTransfer.files ?? [])].find((f) => f.name.endsWith('.zip'));
    if (!file) { showToast('Drop a .zip campaign file.'); return; }
    if (file.size > 1 * 1024 * 1024) { showToast('ZIP file exceeds the 1 MB limit.'); return; }
    label.textContent = 'Loading…';
    try {
      const files    = await unzipToFiles(await file.arrayBuffer());
      const campaign = await loadCampaign(files);
      localStorage.setItem('adventure_pending_edit', JSON.stringify({
        campaign, name: campaign.metadata?.title ?? file.name, files: null,
      }));
      window.location.href = 'editor.html?edit';
    } catch (err) {
      showToast(err.message ?? 'Could not load that campaign ZIP.');
      label.textContent = 'New Campaign';
    }
  });

  return card;
}

function buildDraftCard() {
  const card = document.createElement('div');
  card.className = 'campaign-card';
  card.dataset.campaignId = '_draft';
  card.style.cursor = 'pointer';

  const title = document.createElement('div');
  title.className = 'campaign-card__title';
  title.textContent = editorDraft.name;
  card.appendChild(title);

  const desc = editorDraft.campaign.metadata?.description;
  if (desc) {
    const descEl = document.createElement('div');
    descEl.className = 'campaign-card__description';
    descEl.textContent = desc;
    card.appendChild(descEl);
  }

  const author = editorDraft.campaign.metadata?.author;
  if (author) {
    const authorEl = document.createElement('div');
    authorEl.className = 'campaign-card__author';
    authorEl.textContent = 'by ' + author;
    card.appendChild(authorEl);
  }

  const meta = document.createElement('div');
  meta.className = 'campaign-card__meta';
  meta.appendChild(makeBadge('✎ Draft', 'draft'));
  for (const feat of detectFeatures(editorDraft.campaign)) {
    meta.appendChild(makeBadge(feat, 'feature'));
  }
  card.appendChild(meta);

  card.addEventListener('click', () => selectCampaign(editorDraft, 'draft', card));
  return card;
}

function buildMyCard(c) {
  const card = document.createElement('div');
  card.className = 'campaign-card';
  card.dataset.campaignId = c.id;
  card.style.cursor = 'pointer';

  const titleRow = document.createElement('div');
  titleRow.className = 'campaign-card__title-row';
  const title = document.createElement('div');
  title.className = 'campaign-card__title';
  title.textContent = c.title;
  const voteSpan = document.createElement('span');
  voteSpan.className = 'vote-count';
  voteSpan.textContent = '▲ ' + (c.upvote_count ?? 0);
  titleRow.appendChild(title);
  titleRow.appendChild(voteSpan);
  card.appendChild(titleRow);

  if (c.description) {
    const desc = document.createElement('div');
    desc.className = 'campaign-card__description';
    desc.textContent = c.description;
    card.appendChild(desc);
  }

  const meta = document.createElement('div');
  meta.className = 'campaign-card__meta';
  meta.appendChild(makeBadge(c.is_public ? 'Public' : 'Private', c.is_public ? 'public' : 'private'));
  if (c.is_nsfw) meta.appendChild(makeBadge('NSFW', 'nsfw'));
  for (const feat of c.features ?? []) meta.appendChild(makeBadge(feat, 'feature'));
  card.appendChild(meta);

  card.addEventListener('click', () => selectCampaign(c, 'my', card));
  return card;
}

// ─── Delete from detail panel ─────────────────────────────────────────────────

async function handleDeleteFromPanel(c) {
  if (!confirm(`Delete "${c.title}"? This cannot be undone.`)) return;

  if (selectedCard) selectedCard.style.opacity = '0.5';
  try {
    const { error } = await deleteCampaign(c.id);
    if (error) {
      showToast('Delete failed: ' + error.message);
      if (selectedCard) selectedCard.style.opacity = '';
      return;
    }
    showToast('Campaign deleted.');
    myData = myData.filter((x) => x.id !== c.id);
    deselectCampaign();
    renderMyGrid();
    communityData = [];
  } catch {
    showToast('Could not connect to the platform.');
    if (selectedCard) selectedCard.style.opacity = '';
  }
}

// ─── Upload campaign modal ────────────────────────────────────────────────────

function wireUpload() {
  uploadBtn.addEventListener('click', () => {
    uploadZipInput.value = '';
    uploadError.classList.add('hidden');
    openModal(uploadModal);
  });
  uploadModalClose.addEventListener('click', () => closeModal(uploadModal));
  uploadModal.addEventListener('click', (e) => { if (e.target === uploadModal) closeModal(uploadModal); });
  uploadCancel.addEventListener('click', () => closeModal(uploadModal));
  uploadSubmit.addEventListener('click', handleUploadSubmit);
}

async function handleUploadSubmit() {
  const file = uploadZipInput.files?.[0];
  if (!file) { showModalError(uploadError, 'Please select a ZIP file.'); return; }
  if (file.size > 1 * 1024 * 1024) {
    showModalError(uploadError, 'ZIP file exceeds the 1 MB limit.');
    return;
  }

  uploadSubmit.disabled = true;
  uploadSubmit.textContent = 'Validating…';
  try {
    const files    = await unzipToFiles(await file.arrayBuffer());
    const campaign = await loadCampaign(files);
    localStorage.setItem('adventure_pending_edit', JSON.stringify({
      campaign, name: campaign.metadata?.title ?? file.name, files: null,
    }));
    window.location.href = 'editor.html?edit';
  } catch (e) {
    showModalError(uploadError, e.message ?? 'Could not load that campaign ZIP.');
  } finally {
    uploadSubmit.disabled = false;
    uploadSubmit.textContent = 'Open in Editor';
  }
}

// ─── Content policy modal ─────────────────────────────────────────────────────

function wirePolicyModal() {
  policyCancel.addEventListener('click', () => closeModal(policyModal));
  policyModal.addEventListener('click', (e) => { if (e.target === policyModal) closeModal(policyModal); });
}

function waitForPolicyAcceptance() {
  return new Promise((resolve) => {
    policyError.classList.add('hidden');
    openModal(policyModal);
    function onAccept() {
      policyAccept.removeEventListener('click', onAccept);
      policyCancel.removeEventListener('click', onCancel);
      closeModal(policyModal);
      resolve(true);
    }
    function onCancel() {
      policyAccept.removeEventListener('click', onAccept);
      policyCancel.removeEventListener('click', onCancel);
      closeModal(policyModal);
      resolve(false);
    }
    policyAccept.addEventListener('click', onAccept);
    policyCancel.addEventListener('click', onCancel);
  });
}

// ─── Launch helpers ───────────────────────────────────────────────────────────

async function launchFromPlatform(c) {
  try {
    const res = await fetch(c.zip_url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const files  = await unzipToFiles(await res.arrayBuffer());
    const loaded = await loadCampaign(files);
    localStorage.setItem('adventure_pending_campaign', JSON.stringify({ campaign: loaded, name: c.title }));
    window.location.href = 'index.html';
  } catch (e) {
    showToast('Could not load campaign: ' + (e.message ?? 'network error'));
  }
}

async function launchToEditor(c) {
  showToast('Loading campaign for editing…');
  try {
    const res = await fetch(c.zip_url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const files  = await unzipToFiles(await res.arrayBuffer());
    const loaded = await loadCampaign(files);
    localStorage.setItem('adventure_pending_edit', JSON.stringify({
      campaign: loaded, name: c.title, files: null,
    }));
    window.location.href = 'editor.html?edit';
  } catch (e) {
    showToast('Could not load campaign: ' + (e.message ?? 'network error'));
  }
}

// ─── Admin: reports ───────────────────────────────────────────────────────────

async function loadAdminReports() {
  const list = document.getElementById('admin-reports-list');
  list.innerHTML = '<p class="dash-empty">Loading reports…</p>';

  try {
    const { reports, error } = await listUnresolvedReports();
    if (error) throw error;
    adminLoaded = true;
    list.innerHTML = '';
    if (reports.length === 0) {
      const msg = document.createElement('p');
      msg.className = 'dash-empty';
      msg.textContent = 'No unresolved reports.';
      list.appendChild(msg);
      return;
    }
    for (const r of reports) list.appendChild(buildReportRow(r));
  } catch {
    list.innerHTML = '<p class="dash-empty">Could not load reports.</p>';
  }
}

function buildReportRow(r) {
  const row = document.createElement('div');
  row.className = 'admin-report';

  const cTitle = document.createElement('div');
  cTitle.className = 'admin-report__campaign';
  cTitle.textContent = r.campaigns?.title ?? r.campaign_id;
  row.appendChild(cTitle);

  const meta = document.createElement('div');
  meta.className = 'admin-report__meta';
  meta.textContent = 'Reported by ' + (r.profiles?.username ?? 'anonymous')
    + ' · ' + new Date(r.created_at).toLocaleDateString();
  row.appendChild(meta);

  if (r.reason) {
    const reason = document.createElement('div');
    reason.className = 'admin-report__reason';
    reason.textContent = r.reason;
    row.appendChild(reason);
  }

  const actions = document.createElement('div');
  actions.className = 'admin-report__actions';

  const resolveBtn = document.createElement('button');
  resolveBtn.className = 'btn btn--ghost btn--small';
  resolveBtn.textContent = '✓ Resolve';
  resolveBtn.addEventListener('click', async () => {
    resolveBtn.disabled = true;
    try {
      const { error } = await resolveReport(r.id);
      if (error) { showToast('Error: ' + error.message); resolveBtn.disabled = false; return; }
      row.remove();
      showToast('Report resolved.');
    } catch {
      showToast('Could not connect to the platform.');
      resolveBtn.disabled = false;
    }
  });
  actions.appendChild(resolveBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn--ghost btn--small';
  delBtn.style.color = 'var(--ta-danger)';
  delBtn.textContent = 'Delete Campaign';
  delBtn.addEventListener('click', async () => {
    if (!confirm('Delete this campaign? Cannot be undone.')) return;
    delBtn.disabled = true;
    try {
      const { error } = await adminDeleteCampaign(r.campaigns?.id ?? r.campaign_id);
      if (error) { showToast('Error: ' + error.message); delBtn.disabled = false; return; }
      row.remove();
      showToast('Campaign deleted.');
      communityData = [];
    } catch {
      showToast('Could not connect to the platform.');
      delBtn.disabled = false;
    }
  });
  actions.appendChild(delBtn);

  row.appendChild(actions);
  return row;
}

// ─── Modal helpers ────────────────────────────────────────────────────────────

function openModal(modal)  { modal.classList.add('modal-overlay--visible'); }
function closeModal(modal) { modal.classList.remove('modal-overlay--visible'); }

function showModalError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;

function showToast(msg) {
  dashToast.textContent = msg;
  dashToast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dashToast.classList.add('hidden'), 3500);
}

// ─── Badge helper ─────────────────────────────────────────────────────────────

function makeBadge(text, modifier) {
  const span = document.createElement('span');
  span.className = 'campaign-card__badge campaign-card__badge--' + modifier;
  span.textContent = text;
  return span;
}
