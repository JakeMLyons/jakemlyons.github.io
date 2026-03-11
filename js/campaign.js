/**
 * campaign.js — Campaign loading and validation.
 *
 * loadCampaign() accepts a { path, text } file list (normalised by the caller
 * from either a folder drop or ZIP extraction) and returns:
 *   { metadata, scenes, items, recipes, assets, attributes, assetsInMetadata }
 *
 * items shape:      { name: { description: string, affect_attributes: object } }
 * assets shape:     { images: { key: url }, music: { key: url }, sfx: { key: url } }
 * attributes shape: { name: { value, min?, max?, min_message?, min_scene?, max_scene?, label? } }
 * assetsInMetadata: boolean — true if metadata.yaml contained a top-level `assets:` block (should be a warning)
 *
 * validateCampaign() returns an array of { level: 'error'|'warning', message }
 * objects. An empty array means the campaign is valid.
 *
 * Depends on js-yaml loaded as a global (window.jsyaml in the browser, or
 * injected in Node tests via globalThis.jsyaml).
 */

// Reserved CLI command names — must stay in sync with Python RESERVED_COMMAND_NAMES
// and the COMMANDS dict in cli.py.
export const RESERVED_COMMAND_NAMES = new Set([
  'inventory', 'status', 'save', 'load',
  'look', 'quit', 'help', 'map', 'notes', 'restart', 'examine',
]);

/**
 * Load and merge a campaign from an array of { path, text } file objects.
 *
 * @param {{ path: string, text: string }[]} files
 * @returns {Promise<{ metadata: object, scenes: object, items: object, recipes: object[], assets: object }>}
 * @throws {Error} for missing metadata.yaml, no scene files, duplicates, parse errors
 */
export async function loadCampaign(files) {
  // Normalise paths to forward slashes and strip any leading directory prefix
  // so that both folder drops and ZIP extractions produce consistent paths.
  const normalised = files.map((f) => ({
    ...f,
    path: f.path.replace(/\\/g, '/'),
  }));

  // Find metadata.yaml — it must be at the root level (no subdirectory)
  const metadataFile = normalised.find(
    (f) => f.path === 'metadata.yaml' || f.path.endsWith('/metadata.yaml')
  );

  if (!metadataFile) {
    throw new Error(
      'No metadata.yaml found. Is this a valid campaign folder?'
    );
  }

  // Determine root prefix (the directory containing metadata.yaml)
  const metaPath = metadataFile.path;
  const rootPrefix =
    metaPath === 'metadata.yaml'
      ? ''
      : metaPath.substring(0, metaPath.lastIndexOf('/') + 1);

  // Parse metadata
  let metadataDoc;
  try {
    metadataDoc = parseYaml(metadataFile.text) ?? {};
  } catch (e) {
    throw new Error(`Could not parse metadata.yaml: ${e.message}`);
  }
  const metadata = metadataDoc.metadata ?? metadataDoc;
  const assetsInMetadata = Boolean(metadataDoc.assets);

  // Top-level attributes block in metadata.yaml (outside 'metadata:')
  let mergedAttributes = {};
  if (metadataDoc.attributes && typeof metadataDoc.attributes === 'object') {
    Object.assign(mergedAttributes, metadataDoc.attributes);
  }

  // Collect scene files: all *.yaml at the root level except metadata.yaml
  const sceneFiles = normalised.filter((f) => {
    if (!f.path.startsWith(rootPrefix)) return false;
    const rel = f.path.substring(rootPrefix.length);
    // Must be a direct root-level .yaml file, not in a subdirectory
    return (
      rel.endsWith('.yaml') &&
      !rel.includes('/') &&
      rel !== 'metadata.yaml'
    );
  });

  if (sceneFiles.length === 0) {
    throw new Error(
      'No scene files found — the folder needs at least one .yaml file besides metadata.yaml.'
    );
  }

  // Merge scenes, items, recipes, and assets from all scene files
  const mergedScenes = {};
  const sceneSourceFiles = {};
  const mergedItems = {};
  const itemSourceFiles = {};
  const mergedRecipes = [];
  const mergedAssets = { images: {}, music: {}, sfx: {} };
  const assetSourceFiles = {}; // { bucket: { key: filename } }

  for (const file of sceneFiles) {
    const filename = file.path.substring(rootPrefix.length);
    let doc;
    try {
      doc = parseYaml(file.text) ?? {};
    } catch (e) {
      throw new Error(`Could not parse ${filename}: ${e.message}`);
    }

    const scenes = doc.scenes ?? {};
    for (const [sceneId, sceneData] of Object.entries(scenes)) {
      if (sceneId in mergedScenes) {
        throw new Error(
          `Duplicate scene ID '${sceneId}' found in '${filename}' and '${sceneSourceFiles[sceneId]}'.`
        );
      }
      mergedScenes[sceneId] = sceneData;
      sceneSourceFiles[sceneId] = filename;
    }

    const items = doc.items ?? {};
    for (const [itemName, value] of Object.entries(items)) {
      if (itemName in mergedItems) {
        throw new Error(
          `Duplicate item '${itemName}' in items registry found in '${filename}' and '${itemSourceFiles[itemName]}'.`
        );
      }
      mergedItems[itemName] = value;
      itemSourceFiles[itemName] = filename;
    }

    // Merge recipes (append; no deduplication — order matters)
    const recipes = doc.recipes ?? [];
    if (Array.isArray(recipes)) {
      mergedRecipes.push(...recipes.filter((r) => r && r.inputs && r.output));
    }

    // Merge top-level attributes block from scene files
    const attrBlock = doc.attributes ?? {};
    if (attrBlock && typeof attrBlock === 'object') {
      for (const [attrName, attrDef] of Object.entries(attrBlock)) {
        if (attrName in mergedAttributes) {
          throw new Error(
            `Duplicate attribute '${attrName}' found in '${filename}' (already defined elsewhere).`
          );
        }
        mergedAttributes[attrName] = attrDef;
      }
    }

    // Merge assets — deep per-bucket; throw immediately on duplicate keys
    const assetBlock = doc.assets ?? {};
    for (const [bucket, entries] of Object.entries(assetBlock)) {
      if (!entries || typeof entries !== 'object') continue;
      mergedAssets[bucket] ??= {};
      assetSourceFiles[bucket] ??= {};
      for (const [key, url] of Object.entries(entries)) {
        if (key === 'none') {
          throw new Error(
            `Asset key "none" is reserved and cannot be used as an asset name (in "${filename}", bucket "${bucket}").`
          );
        }
        if (key in mergedAssets[bucket]) {
          throw new Error(
            `Duplicate asset key "${key}" in bucket "${bucket}" found in "${filename}" and "${assetSourceFiles[bucket][key]}".`
          );
        }
        mergedAssets[bucket][key] = String(url ?? '');
        assetSourceFiles[bucket][key] = filename;
      }
    }
  }

  // Normalise items: accept both string values (simple format) and
  // { description, affect_attributes } dicts (extended format).
  // Always normalise to { description: string, affect_attributes: object }.
  for (const [name, value] of Object.entries(mergedItems)) {
    if (typeof value === 'object' && value !== null) {
      mergedItems[name] = {
        description: String(value.description ?? ''),
        affect_attributes: value.affect_attributes ?? {},
        icon: value.icon ?? null,
      };
    } else {
      mergedItems[name] = {
        description: String(value ?? ''),
        affect_attributes: {},
        icon: null,
      };
    }
  }

  // Backward compatibility: if no top-level attributes were found,
  // fall back to metadata.attributes (old location).
  if (Object.keys(mergedAttributes).length === 0 && metadata.attributes) {
    mergedAttributes = { ...metadata.attributes };
  }

  return {
    metadata,
    scenes: mergedScenes,
    items: mergedItems,
    recipes: mergedRecipes,
    assets: mergedAssets,
    attributes: mergedAttributes,
    assetsInMetadata,
  };
}

/**
 * Validate campaign structure and scene graph.
 *
 * @param {{ metadata: object, scenes: object, items: object }} campaign
 * @returns {{ level: 'error'|'warning', message: string }[]}
 */
export function validateCampaign(campaign) {
  const results = [];
  const scenes = campaign.scenes ?? {};
  const metadata = campaign.metadata ?? {};
  const itemsRegistry = campaign.items ?? {};
  const attrDefs = campaign.attributes ?? {};
  const assetRegistry = campaign.assets ?? {};

  function err(message) { results.push({ level: 'error', message }); }
  function warn(message) { results.push({ level: 'warning', message }); }

  // ── Metadata checks ──────────────────────────────────────────────────────

  const start = metadata.start;
  if (!start) {
    err('metadata.start is missing.');
  } else if (!(start in scenes)) {
    err(`metadata.start refers to unknown scene: '${start}'`);
  }

  // ── Attribute definition checks ──────────────────────────────────────────

  for (const [attrName, def] of Object.entries(attrDefs)) {
    if (def.min != null && def.max != null && Number(def.min) >= Number(def.max)) {
      warn(`Attribute '${attrName}': min (${def.min}) is >= max (${def.max}).`);
    }
    if (def.min_scene && !(def.min_scene in scenes)) {
      err(`Attribute '${attrName}': min_scene refers to unknown scene '${def.min_scene}'.`);
    }
    if (def.max_scene && !(def.max_scene in scenes)) {
      err(`Attribute '${attrName}': max_scene refers to unknown scene '${def.max_scene}'.`);
    }
  }

  // ── Scene checks ─────────────────────────────────────────────────────────

  const allItemNamesUsed = new Set();
  const allGrantedItems = new Set();
  const allRemovedItems = new Set();

  // Starting inventory is implicitly "granted" for dead-removal analysis
  for (const item of metadata.inventory ?? []) {
    allGrantedItems.add(item);
  }

  /**
   * Validate affect_attributes references in a block (choice or on_enter).
   * @param {object} block
   * @param {string} context - description for warning messages
   */
  function checkAffectAttributes(block, context) {
    const affects = block.affect_attributes ?? {};
    for (const attrName of Object.keys(affects)) {
      if (!(attrName in attrDefs)) {
        warn(`${context}: 'affect_attributes' references unknown attribute '${attrName}'.`);
      }
    }
  }

  for (const [sceneId, scene] of Object.entries(scenes)) {
    if (typeof scene !== 'object' || scene === null) {
      err(`Scene '${sceneId}' is not a valid mapping.`);
      continue;
    }
    if (!scene.text) {
      err(`Scene '${sceneId}' is missing 'text'.`);
    }

    // Reserved command name collision
    if (RESERVED_COMMAND_NAMES.has(sceneId)) {
      err(
        `Scene ID '${sceneId}' conflicts with a reserved command name and may be unreachable via the CLI.`
      );
    }

    // requires_item at scene level is a schema violation
    if (scene.requires_item != null) {
      warn(
        `Scene '${sceneId}' has 'requires_item' at scene level — this field is only read on choices and will be silently ignored.`
      );
    }

    if (scene.end) continue; // Terminal scenes need nothing else

    const choices = scene.choices;
    if (!choices || choices.length === 0) {
      err(
        `Scene '${sceneId}' has no 'choices' and is not marked 'end: true'.`
      );
      continue;
    }

    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      const prefix = `Scene '${sceneId}', choice ${i + 1}`;
      if (!choice.label) {
        err(`${prefix}: missing 'label'.`);
      }
      const nextId = choice.next;
      if (!nextId) {
        err(`${prefix}: missing 'next'.`);
      } else if (!(nextId in scenes)) {
        err(`${prefix}: 'next' refers to unknown scene: '${nextId}'`);
      }

      checkAffectAttributes(choice, prefix);

      // Validate requires_attributes conditions
      const VALID_OPS = new Set(['>', '>=', '<', '<=', '=']);
      for (const [ci, cond] of (choice.requires_attributes ?? []).entries()) {
        const cpfx = `${prefix} requires_attributes[${ci}]`;
        if (!cond.attr) {
          err(`${cpfx}: missing 'attr'.`);
        } else if (attrDefs && !(cond.attr in attrDefs)) {
          err(`${cpfx}: 'attr' references unknown attribute '${cond.attr}'.`);
        }
        if (!cond.op) {
          err(`${cpfx}: missing 'op'.`);
        } else if (!VALID_OPS.has(cond.op)) {
          err(`${cpfx}: 'op' must be one of >, >=, <, <=, = (got '${cond.op}').`);
        }
        if (cond.value == null || isNaN(Number(cond.value))) {
          err(`${cpfx}: 'value' must be a number.`);
        }
      }

      // Collect item names for advisory checks
      if (choice.requires_item) allItemNamesUsed.add(choice.requires_item);
      for (const item of choice.requires_items ?? []) allItemNamesUsed.add(item);
      for (const item of choice.gives_items ?? []) {
        allItemNamesUsed.add(item);
        allGrantedItems.add(item);
      }
      for (const item of choice.removes_items ?? []) {
        allItemNamesUsed.add(item);
        allRemovedItems.add(item);
      }
    }

    // Collect from on_enter too
    const onEnter = scene.on_enter ?? {};
    checkAffectAttributes(onEnter, `Scene '${sceneId}' on_enter`);
    for (const item of onEnter.gives_items ?? []) {
      allItemNamesUsed.add(item);
      allGrantedItems.add(item);
    }
    for (const item of onEnter.removes_items ?? []) {
      allItemNamesUsed.add(item);
      allRemovedItems.add(item);
    }
  }

  // ── Check items affect_attributes references ──────────────────────────────

  for (const [itemName, item] of Object.entries(itemsRegistry)) {
    const affects = item?.affect_attributes ?? {};
    for (const attrName of Object.keys(affects)) {
      if (!(attrName in attrDefs)) {
        warn(`Item '${itemName}': 'affect_attributes' references unknown attribute '${attrName}'.`);
      }
    }
  }

  // ── Warn if affect_attributes is used but no attributes are defined ────────

  const hasAnyAffects = (
    Object.values(itemsRegistry).some(item => Object.keys(item?.affect_attributes ?? {}).length > 0) ||
    Object.values(scenes).some(scene => {
      if (scene.on_enter?.affect_attributes && Object.keys(scene.on_enter.affect_attributes).length > 0) return true;
      return (scene.choices ?? []).some(c => Object.keys(c.affect_attributes ?? {}).length > 0);
    })
  );
  if (hasAnyAffects && Object.keys(attrDefs).length === 0) {
    warn("'affect_attributes' is used but no attributes are defined.");
  }

  // ── Reachability check (BFS from start) ──────────────────────────────────

  if (start && start in scenes) {
    const reachable = new Set();
    const queue = [start];
    // min_scene / max_scene are reachable via attribute thresholds, not choice links
    for (const def of Object.values(attrDefs)) {
      if (def.min_scene) queue.push(def.min_scene);
      if (def.max_scene) queue.push(def.max_scene);
    }
    while (queue.length > 0) {
      const sid = queue.pop();
      if (reachable.has(sid) || !(sid in scenes)) continue;
      reachable.add(sid);
      for (const choice of scenes[sid].choices ?? []) {
        if (choice.next) queue.push(choice.next);
      }
    }
    for (const sceneId of Object.keys(scenes)) {
      if (!reachable.has(sceneId)) {
        err(
          `Scene '${sceneId}' is not reachable from metadata.start (possible orphan or draft).`
        );
      }
    }
  }

  // ── Advisory: item names with no registry description ────────────────────

  for (const itemName of [...allItemNamesUsed].sort()) {
    if (!(itemName in itemsRegistry)) {
      warn(
        `Advisory: item '${itemName}' is used in the campaign but has no description in the items registry.`
      );
    }
  }

  // ── Advisory: item icon references ──────────────────────────────────────

  for (const [itemName, item] of Object.entries(itemsRegistry)) {
    if (item?.icon && !(item.icon in (assetRegistry.images ?? {}))) {
      warn(`Item '${itemName}': icon '${item.icon}' not found in assets.images.`);
    }
  }

  // ── Advisory: registered items that are never granted ────────────────────

  for (const itemName of Object.keys(itemsRegistry).sort()) {
    if (!allGrantedItems.has(itemName)) {
      warn(
        `Advisory: registered item '${itemName}' is never granted by any gives_items — dead registry entry.`
      );
    }
  }

  // ── Advisory: removes_items entries that are never granted ───────────────

  for (const itemName of [...allRemovedItems].sort()) {
    if (!allGrantedItems.has(itemName)) {
      warn(
        `Advisory: item '${itemName}' appears in removes_items but is never granted anywhere — removal is always a no-op.`
      );
    }
  }

  // ── Asset registry checks ─────────────────────────────────────────────────

  if (campaign.assetsInMetadata) {
    warn('An "assets" block was found in metadata.yaml — asset declarations should live in a scene YAML file alongside the scenes that reference them.');
  }

  const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico']);
  const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav', '.flac', '.aac', '.m4a', '.opus']);
  const VALID_KEY_RE = /^[a-zA-Z0-9_]+$/;

  function extOf(url) {
    const m = String(url).match(/\.([^./?#]+)(?:[?#]|$)/);
    return m ? '.' + m[1].toLowerCase() : '';
  }

  // Registry-level checks: reserved key, invalid key name, wrong extension
  for (const [bucket, entries] of Object.entries(assetRegistry)) {
    if (!entries || typeof entries !== 'object') continue;
    for (const [key, url] of Object.entries(entries)) {
      if (key === 'none') {
        err(`Asset bucket "${bucket}": key "none" is reserved and cannot be used as an asset name.`);
        continue;
      }
      if (!VALID_KEY_RE.test(key)) {
        warn(`Asset bucket "${bucket}": key "${key}" contains invalid characters (only letters, digits, and underscores are allowed).`);
      }
      const ext = extOf(url);
      if (bucket === 'images' && ext && !IMAGE_EXTENSIONS.has(ext)) {
        warn(`Asset "${key}" in images bucket has a non-image extension ("${ext}").`);
      } else if ((bucket === 'music' || bucket === 'sfx') && ext && !AUDIO_EXTENSIONS.has(ext)) {
        warn(`Asset "${key}" in ${bucket} bucket has a non-audio extension ("${ext}").`);
      }
    }
  }

  // Scene-level asset reference checks + collect used keys
  const usedImageKeys = new Set();
  const usedMusicKeys = new Set();
  const usedSfxKeys = new Set();
  const imageKeys = new Set(Object.keys(assetRegistry.images ?? {}));
  const musicKeys = new Set(Object.keys(assetRegistry.music ?? {}));
  const sfxKeys = new Set(Object.keys(assetRegistry.sfx ?? {}));

  function checkSfxRef(sfx, context) {
    const keys = Array.isArray(sfx) ? sfx : [sfx];
    for (const key of keys) {
      if (!key) continue;
      usedSfxKeys.add(key);
      if (!sfxKeys.has(key)) {
        err(`${context}: gives_sfx references unknown sfx key "${key}".`);
      }
    }
  }

  for (const [sceneId, scene] of Object.entries(scenes)) {
    if (typeof scene !== 'object' || scene === null) continue;

    const sceneAssets = scene.assets;
    if (sceneAssets && typeof sceneAssets === 'object') {
      if ('image' in sceneAssets) {
        const key = sceneAssets.image;
        if (key !== 'none' && key !== null) {
          usedImageKeys.add(key);
          if (!imageKeys.has(key)) {
            err(`Scene '${sceneId}': assets.image references unknown key "${key}".`);
          }
        }
      }
      if ('music' in sceneAssets) {
        const key = sceneAssets.music;
        if (key !== 'none' && key !== null) {
          usedMusicKeys.add(key);
          if (!musicKeys.has(key)) {
            err(`Scene '${sceneId}': assets.music references unknown key "${key}".`);
          }
        }
      }
    }

    const onEnter = scene.on_enter;
    if (onEnter?.gives_sfx) {
      checkSfxRef(onEnter.gives_sfx, `Scene '${sceneId}' on_enter`);
    }

    for (let i = 0; i < (scene.choices ?? []).length; i++) {
      const choice = scene.choices[i];
      if (choice?.gives_sfx) {
        checkSfxRef(choice.gives_sfx, `Scene '${sceneId}', choice ${i + 1}`);
      }
    }
  }

  // Unused asset warnings
  for (const key of imageKeys) {
    if (!usedImageKeys.has(key)) {
      warn(`Advisory: asset "${key}" in images bucket is declared but never referenced by any scene.`);
    }
  }
  for (const key of musicKeys) {
    if (!usedMusicKeys.has(key)) {
      warn(`Advisory: asset "${key}" in music bucket is declared but never referenced by any scene.`);
    }
  }
  for (const key of sfxKeys) {
    if (!usedSfxKeys.has(key)) {
      warn(`Advisory: asset "${key}" in sfx bucket is declared but never referenced by any choice or on_enter.`);
    }
  }

  return results;
}

// ─── Internal helper ──────────────────────────────────────────────────────────

/**
 * Parse YAML text using js-yaml with FAILSAFE_SCHEMA.
 * Relies on jsyaml being available as a global (browser or injected in tests).
 */
function parseYaml(text) {
  const yaml = globalThis.jsyaml;
  if (!yaml) throw new Error('js-yaml not loaded (expected as globalThis.jsyaml)');
  return yaml.load(text, { schema: yaml.FAILSAFE_SCHEMA });
}
