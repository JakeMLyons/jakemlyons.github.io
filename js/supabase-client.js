/**
 * supabase-client.js — Supabase auth/DB/storage wrapper module.
 *
 * Pure-logic ES module. No DOM access, no console.log.
 * All Supabase interactions go through this module.
 *
 * The publishable key (formerly "anon key") is intentionally public — all
 * authorization is enforced by Row Level Security policies on the server.
 * The is_admin field cannot be changed via the API (profiles_update WITH CHECK
 * enforces this).
 *
 * SETUP: Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project values
 * from the Supabase Dashboard → Settings → API → Project API keys.
 */

const SUPABASE_URL      = 'https://tfeqgvgjpdfwsehxogdw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_adK_CbYMb-hv4I-89ZUUnQ_jTIrFRXl'; // publishable key

const MAX_CAMPAIGNS_PER_USER  = 20;
const MAX_ZIP_SIZE            = 1 * 1024 * 1024; // 1 MB
const MAX_VERSIONS_PER_CAMPAIGN = 5;

// Lazy-initialised client. createClient() is safe to call without network.
let _client = null;

function getClient() {
  if (!_client) {
    if (!globalThis.supabase?.createClient) {
      throw new Error('Supabase JS library not loaded. Platform features are unavailable.');
    }
    _client = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _client;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Sign up a new user. username is stored in raw_user_meta_data so the
 * handle_new_user trigger can create the profile row automatically.
 * @param {string} email
 * @param {string} password
 * @param {string} username  — must match ^[a-zA-Z0-9_-]+$, length 3-30
 * @returns {{ user, session, error }}
 */
export async function signUp(email, password, username) {
  username = username.trim();
  if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
    return { error: { message: 'Username must be 3–30 characters: letters, numbers, _ or -' } };
  }
  const { data, error } = await getClient().auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  return { user: data?.user ?? null, session: data?.session ?? null, error };
}

/**
 * Sign in with email and password.
 */
export async function signIn(email, password) {
  const { data, error } = await getClient().auth.signInWithPassword({ email, password });
  return { user: data?.user ?? null, session: data?.session ?? null, error };
}

/**
 * Sign out the current user.
 */
export async function signOut() {
  const { error } = await getClient().auth.signOut();
  return { error };
}

/**
 * Get the current session (null if not signed in).
 */
export async function getSession() {
  const { data, error } = await getClient().auth.getSession();
  return { session: data?.session ?? null, error };
}

/**
 * Get the current user (null if not signed in).
 */
export async function getUser() {
  const { data, error } = await getClient().auth.getUser();
  return { user: data?.user ?? null, error };
}

/**
 * Subscribe to auth state changes.
 * @param {function} callback  — called with (event, session)
 * @returns {{ unsubscribe: function }}
 */
export function onAuthStateChange(callback) {
  const { data } = getClient().auth.onAuthStateChange(callback);
  return { unsubscribe: () => data?.subscription?.unsubscribe() };
}

// ── Profiles ──────────────────────────────────────────────────────────────────

/**
 * Fetch a user's public profile.
 */
export async function getProfile(userId) {
  const { data, error } = await getClient()
    .from('profiles')
    .select('id, username, is_admin, policy_accepted_at, created_at')
    .eq('id', userId)
    .single();
  return { profile: data ?? null, error };
}

/**
 * Update the current user's username.
 */
export async function updateUsername(newUsername) {
  newUsername = newUsername.trim();
  if (!/^[a-zA-Z0-9_-]{3,30}$/.test(newUsername)) {
    return { error: { message: 'Username must be 3–30 characters: letters, numbers, _ or -' } };
  }
  const { data: { user }, error: authErr } = await getClient().auth.getUser();
  if (authErr || !user) return { error: authErr ?? { message: 'Not signed in' } };

  const { error } = await getClient()
    .from('profiles')
    .update({ username: newUsername })
    .eq('id', user.id);
  return { error };
}

/**
 * Record that the current user has accepted the content policy.
 */
export async function acceptPolicy() {
  const { data: { user }, error: authErr } = await getClient().auth.getUser();
  if (authErr || !user) return { error: authErr ?? { message: 'Not signed in' } };

  const { error } = await getClient()
    .from('profiles')
    .update({ policy_accepted_at: new Date().toISOString() })
    .eq('id', user.id);
  return { error };
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

/**
 * List all public campaigns, ordered by upvote_count descending.
 * Optionally includes NSFW campaigns.
 * @param {{ nsfw?: boolean, page?: number, pageSize?: number }} opts
 */
export async function listPublicCampaigns({ nsfw = false, page = 0, pageSize = 24 } = {}) {
  let query = getClient()
    .from('campaigns')
    .select(`
      id, title, description, zip_url, is_nsfw, features, upvote_count, created_at, updated_at,
      user_id,
      profiles!campaigns_user_id_fkey ( username )
    `)
    .eq('is_public', true)
    .order('upvote_count', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (!nsfw) {
    query = query.eq('is_nsfw', false);
  }

  const { data, error } = await query;
  return { campaigns: data ?? [], error };
}

/**
 * List all campaigns belonging to the current user (public and private).
 */
export async function listMyCampaigns() {
  const { data, error } = await getClient()
    .from('campaigns')
    .select('id, title, description, zip_url, is_public, is_nsfw, features, upvote_count, created_at, updated_at')
    .order('created_at', { ascending: false });
  return { campaigns: data ?? [], error };
}

/**
 * Get a single campaign by ID.
 */
export async function getCampaign(id) {
  const { data, error } = await getClient()
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .single();
  return { campaign: data ?? null, error };
}

/**
 * How many campaigns the current user has published.
 */
export async function getUserCampaignCount() {
  const { count, error } = await getClient()
    .from('campaigns')
    .select('id', { count: 'exact', head: true });
  return { count: count ?? 0, error };
}

/**
 * Publish a new campaign.
 *
 * Flow:
 *  1. Check soft cap (MAX_CAMPAIGNS_PER_USER)
 *  2. Check ZIP size (MAX_ZIP_SIZE)
 *  3. Generate a UUID for the campaign
 *  4. Upload ZIP to storage at {userId}/{campaignId}/campaign.zip
 *  5. Insert campaign row (is_public: false initially)
 *  6. Return the inserted row
 *
 * @param {Blob}     zipBlob
 * @param {string}   title
 * @param {string}   description
 * @param {boolean}  isNsfw
 * @param {string[]} features
 */
export async function publishCampaign(zipBlob, title, description, isNsfw, features) {
  // Validate inputs
  title = (title ?? '').trim();
  if (!title || title.length > 200) {
    return { campaign: null, error: { message: 'Title must be 1–200 characters.' } };
  }
  if (description && description.length > 2000) {
    return { campaign: null, error: { message: 'Description must be 2000 characters or fewer.' } };
  }
  if (zipBlob.size > MAX_ZIP_SIZE) {
    return { campaign: null, error: { message: 'ZIP file exceeds the 1 MB limit.' } };
  }

  // Auth check
  const { data: { user }, error: authErr } = await getClient().auth.getUser();
  if (authErr || !user) return { campaign: null, error: authErr ?? { message: 'Not signed in.' } };

  // Soft cap
  const { count } = await getUserCampaignCount();
  if (count >= MAX_CAMPAIGNS_PER_USER) {
    return {
      campaign: null,
      error: { message: `Campaign limit reached (${MAX_CAMPAIGNS_PER_USER}). Delete an existing campaign to publish a new one.` },
    };
  }

  // Generate campaign ID
  const campaignId = crypto.randomUUID();

  // Upload ZIP to storage
  const { error: uploadError } = await uploadZip(user.id, campaignId, zipBlob);
  if (uploadError) return { campaign: null, error: uploadError };

  const zipUrl = getZipUrl(user.id, campaignId);

  // Insert campaign row
  const { data, error } = await getClient()
    .from('campaigns')
    .insert({
      id:          campaignId,
      user_id:     user.id,
      title,
      description: description || null,
      zip_url:     zipUrl,
      is_public:   false,
      is_nsfw:     !!isNsfw,
      features:    features ?? [],
    })
    .select()
    .single();

  return { campaign: data ?? null, error };
}

/**
 * Update metadata on an existing campaign.
 * @param {string} id
 * @param {{ title?, description?, is_public?, is_nsfw?, features? }} updates
 */
export async function updateCampaign(id, updates) {
  const allowed = {};
  if ('title'       in updates) allowed.title       = (updates.title ?? '').trim().slice(0, 200);
  if ('description' in updates) allowed.description = updates.description?.slice(0, 2000) ?? null;
  if ('is_public'   in updates) allowed.is_public   = !!updates.is_public;
  if ('is_nsfw'     in updates) allowed.is_nsfw     = !!updates.is_nsfw;
  if ('features'    in updates) allowed.features    = updates.features ?? [];

  const { data, error } = await getClient()
    .from('campaigns')
    .update(allowed)
    .eq('id', id)
    .select()
    .single();
  return { campaign: data ?? null, error };
}

/**
 * Re-upload the ZIP for an existing campaign, snapshotting the current ZIP as
 * a versioned backup first (stored at {userId}/{campaignId}/v{n}.zip).
 *
 * Flow:
 *  1. Fetch all existing versions oldest-first (single query for both max version_num
 *     and the prune list).
 *  2. Copy campaign.zip → v{nextNum}.zip. If this fails (e.g. campaign.zip missing),
 *     skip the snapshot and version insert and proceed to upload — soft failure.
 *  3. Prune oldest version(s) BEFORE inserting the new row so the DB trigger
 *     (enforce_campaign_version_limit) never sees count ≥ MAX from legitimate code.
 *  4. Insert the new campaign_versions row.
 *  5. Upload the new campaign.zip with upsert.
 */
export async function updateCampaignZip(id, zipBlob) {
  if (zipBlob.size > MAX_ZIP_SIZE) {
    return { error: { message: 'ZIP file exceeds the 1 MB limit.' } };
  }
  const { data: { user }, error: authErr } = await getClient().auth.getUser();
  if (authErr || !user) return { error: authErr ?? { message: 'Not signed in.' } };

  const mainPath = `${user.id}/${id}/campaign.zip`;

  // Fetch all existing versions ordered oldest-first (gives max version_num + prune list)
  const { data: allVersions } = await getClient()
    .from('campaign_versions')
    .select('id, version_num')
    .eq('campaign_id', id)
    .order('version_num', { ascending: true });

  const versions    = allVersions ?? [];
  const nextNum     = (versions.at(-1)?.version_num ?? 0) + 1;
  const versionPath = `${user.id}/${id}/v${nextNum}.zip`;

  // Copy current campaign.zip → v{nextNum}.zip (soft: skip snapshot if copy fails)
  const { error: copyErr } = await getClient().storage
    .from('campaigns')
    .copy(mainPath, versionPath);

  if (!copyErr) {
    // Prune oldest version(s) BEFORE inserting so count stays ≤ MAX after insert
    if (versions.length >= MAX_VERSIONS_PER_CAMPAIGN) {
      const excessCount = versions.length - (MAX_VERSIONS_PER_CAMPAIGN - 1);
      const toDelete    = versions.slice(0, excessCount);
      // Delete storage files first (fire-and-forget)
      await getClient().storage.from('campaigns').remove(
        toDelete.map((v) => `${user.id}/${id}/v${v.version_num}.zip`),
      );
      // Delete DB rows (fire-and-forget)
      await getClient()
        .from('campaign_versions')
        .delete()
        .in('id', toDelete.map((v) => v.id));
    }

    // Insert the new version row
    const { data: urlData } = getClient().storage
      .from('campaigns')
      .getPublicUrl(versionPath);
    await getClient()
      .from('campaign_versions')
      .insert({ campaign_id: id, version_num: nextNum, zip_url: urlData.publicUrl });
  }

  // Upload new campaign.zip (upsert)
  const { error: uploadErr } = await getClient().storage
    .from('campaigns')
    .upload(mainPath, zipBlob, { upsert: true, contentType: 'application/zip' });
  if (uploadErr) return { error: uploadErr };

  return { error: null };
}

/**
 * List all saved versions for a campaign, newest first.
 * @param {string} campaignId
 * @returns {{ versions: Array<{ id, version_num, zip_url, created_at }>, error }}
 */
export async function listCampaignVersions(campaignId) {
  const { data, error } = await getClient()
    .from('campaign_versions')
    .select('id, version_num, zip_url, created_at')
    .eq('campaign_id', campaignId)
    .order('version_num', { ascending: false });
  return { versions: data ?? [], error };
}

/**
 * Restore a campaign's live ZIP to a previously saved version.
 *
 * Downloads the version ZIP first so that if the upload fails, campaign.zip
 * is left untouched (no data-loss window from a remove-then-copy approach).
 *
 * Does NOT create a new snapshot before restoring — existing version history
 * (v1–v5) is always preserved; only campaign.zip is overwritten.
 *
 * @param {string} campaignId
 * @param {number} versionNum
 */
export async function restoreFromVersion(campaignId, versionNum) {
  const { data: { user }, error: authErr } = await getClient().auth.getUser();
  if (authErr || !user) return { error: authErr ?? { message: 'Not signed in.' } };

  const mainPath    = `${user.id}/${campaignId}/campaign.zip`;
  const versionPath = `${user.id}/${campaignId}/v${versionNum}.zip`;

  // Download version ZIP first — campaign.zip is untouched if this fails
  const { data: blob, error: downloadErr } = await getClient().storage
    .from('campaigns')
    .download(versionPath);
  if (downloadErr || !blob) {
    return { error: downloadErr ?? { message: 'Version not found.' } };
  }

  // Re-upload as campaign.zip (upsert — no remove needed, no window of absence)
  const { error: uploadErr } = await getClient().storage
    .from('campaigns')
    .upload(mainPath, blob, { upsert: true, contentType: 'application/zip' });
  if (uploadErr) return { error: uploadErr };

  // Bump updated_at so the dashboard's cache-busting fetch sees the restored content
  const { data: updated, error: dbErr } = await getClient()
    .from('campaigns')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .select('updated_at')
    .single();
  return { error: dbErr ?? null, updated_at: updated?.updated_at ?? null };
}

/**
 * Delete a campaign and its storage files (including all versioned ZIPs).
 */
export async function deleteCampaign(id) {
  const { data: { user }, error: authErr } = await getClient().auth.getUser();
  if (authErr || !user) return { error: authErr ?? { message: 'Not signed in.' } };

  // Fetch versioned file paths from DB (user owns the campaign — RLS passes)
  const { data: versions } = await getClient()
    .from('campaign_versions')
    .select('version_num')
    .eq('campaign_id', id);

  const filePaths = [
    `${user.id}/${id}/campaign.zip`,
    `${user.id}/${id}/_previous.zip`,  // legacy artifact — safe to attempt on old campaigns
    ...((versions ?? []).map((v) => `${user.id}/${id}/v${v.version_num}.zip`)),
  ];
  await getClient().storage.from('campaigns').remove(filePaths);

  // Delete DB row (cascade removes votes/reports/versions)
  const { error } = await getClient().from('campaigns').delete().eq('id', id);
  return { error };
}

// ── Votes ─────────────────────────────────────────────────────────────────────

/**
 * Cast a vote for a campaign. Idempotent — duplicate is treated as success.
 */
export async function castVote(campaignId) {
  const { data: { user }, error: authErr } = await getClient().auth.getUser();
  if (authErr || !user) return { error: authErr ?? { message: 'Not signed in.' } };

  const { error } = await getClient().from('votes').insert({ user_id: user.id, campaign_id: campaignId });
  // Postgres 23505 = unique_violation (already voted) → treat as success
  if (error?.code === '23505') return { error: null };
  return { error };
}

/**
 * Remove a vote from a campaign. Idempotent.
 */
export async function removeVote(campaignId) {
  const { data: { user }, error: authErr } = await getClient().auth.getUser();
  if (authErr || !user) return { error: authErr ?? { message: 'Not signed in.' } };

  const { error } = await getClient()
    .from('votes')
    .delete()
    .eq('user_id', user.id)
    .eq('campaign_id', campaignId);
  return { error };
}

/**
 * Get the Set of campaign IDs that the current user has voted for,
 * filtered to the provided campaign ID list.
 * @param {string[]} campaignIds
 * @returns {{ votes: Set<string>, error }}
 */
export async function getUserVotes(campaignIds) {
  if (!campaignIds.length) return { votes: new Set(), error: null };

  const { data: { user }, error: authErr } = await getClient().auth.getUser();
  if (authErr || !user) return { votes: new Set(), error: null };

  const { data, error } = await getClient()
    .from('votes')
    .select('campaign_id')
    .eq('user_id', user.id)
    .in('campaign_id', campaignIds);

  const votes = new Set((data ?? []).map((v) => v.campaign_id));
  return { votes, error };
}

// ── Reports ───────────────────────────────────────────────────────────────────

/**
 * Report a campaign. Duplicate report from same user is silently ignored.
 */
export async function reportCampaign(campaignId, reason) {
  const { data: { user }, error: authErr } = await getClient().auth.getUser();
  if (authErr || !user) return { error: authErr ?? { message: 'Not signed in.' } };

  const { error } = await getClient().from('reports').insert({
    reporter_id: user.id,
    campaign_id: campaignId,
    reason: (reason ?? '').trim().slice(0, 1000) || null,
  });
  if (error?.code === '23505') return { error: null }; // already reported
  return { error };
}

/**
 * List all unresolved reports (admin only — RLS enforces access).
 */
export async function listUnresolvedReports() {
  const { data, error } = await getClient()
    .from('reports')
    .select(`
      id, reason, created_at, resolved,
      reporter_id,
      profiles!reports_reporter_id_fkey ( username ),
      campaigns!reports_campaign_id_fkey ( id, title, user_id )
    `)
    .eq('resolved', false)
    .order('created_at', { ascending: false });
  return { reports: data ?? [], error };
}

/**
 * Mark a report as resolved (admin only).
 */
export async function resolveReport(id) {
  const { error } = await getClient()
    .from('reports')
    .update({ resolved: true })
    .eq('id', id);
  return { error };
}

/**
 * Admin: delete a campaign (uses admin RLS policy).
 *
 * Uses storage.list() to enumerate ALL files under the campaign's folder prefix
 * rather than querying campaign_versions — the admin RLS policy on campaign_versions
 * only grants access to the owner, not admins, so a DB query would return 0 rows
 * and leave versioned ZIPs orphaned in storage.
 */
export async function adminDeleteCampaign(id) {
  // Get the campaign's user_id so we can construct the storage path
  const { data: campaignRow } = await getClient()
    .from('campaigns')
    .select('user_id')
    .eq('id', id)
    .single();

  if (campaignRow?.user_id) {
    const folderPath = `${campaignRow.user_id}/${id}`;
    const { data: objects } = await getClient().storage
      .from('campaigns')
      .list(folderPath);
    const filePaths = (objects ?? []).map((obj) => `${folderPath}/${obj.name}`);
    if (filePaths.length) {
      await getClient().storage.from('campaigns').remove(filePaths);
    }
  }

  const { error } = await getClient().from('campaigns').delete().eq('id', id);
  return { error };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

/**
 * Upload a ZIP blob to {userId}/{campaignId}/campaign.zip.
 */
export async function uploadZip(userId, campaignId, zipBlob) {
  const path = `${userId}/${campaignId}/campaign.zip`;
  const { error } = await getClient().storage
    .from('campaigns')
    .upload(path, zipBlob, { upsert: true, contentType: 'application/zip' });
  return { error };
}

/**
 * Return the public URL for a campaign ZIP.
 */
export function getZipUrl(userId, campaignId) {
  const { data } = getClient().storage
    .from('campaigns')
    .getPublicUrl(`${userId}/${campaignId}/campaign.zip`);
  return data.publicUrl;
}
