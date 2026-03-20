/**
 * campaign-utils.js — Shared campaign analysis utilities.
 *
 * Used by dashboard.js (badge display) and editor.js (publish payload).
 * Extracted from dashboard.js to eliminate duplication.
 */

/**
 * Detect which optional features a campaign uses.
 * Returns an array of display strings used as feature badge labels.
 *
 * @param {object} campaign  — loaded campaign object from loadCampaign()
 * @returns {string[]}       — e.g. ['⚙ attributes', '⚔ items', '⚗ recipes']
 */
export function detectFeatures(campaign) {
  const badges  = [];
  const scenes  = campaign.scenes  ?? {};
  const attrs   = campaign.attributes ?? campaign.metadata?.attributes ?? {};
  const items   = campaign.items   ?? {};
  const recipes = campaign.recipes ?? [];
  const assets  = campaign.assets  ?? {};

  if (Object.keys(attrs).length > 0) badges.push('⚙ attributes');
  if (Object.keys(items).length > 0) badges.push('⚔ items');
  if (recipes.length > 0) badges.push('⚗ recipes');

  const hasAssets = ['images', 'music', 'sfx'].some(
    (b) => assets[b] && Object.keys(assets[b]).length > 0,
  );
  if (hasAssets) badges.push('♫ assets');

  const hasJournal = Object.values(scenes).some((scene) => {
    if (scene.on_enter?.gives_notes?.length > 0) return true;
    return (scene.choices ?? []).some((c) => c.gives_notes?.length > 0);
  });
  if (hasJournal) badges.push('✐ journal');

  return badges;
}
