/**
 * campaign.js — Campaign loading and validation.
 *
 * Direct JS port of adventure/campaign.py.
 *
 * loadCampaign() accepts a { path, text } file list (normalised by the caller
 * from either a folder drop or ZIP extraction) and returns:
 *   { metadata, scenes, items }
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
  'inventory', 'health', 'status', 'save', 'load',
  'look', 'quit', 'help', 'map', 'notes', 'restart', 'examine',
]);

/**
 * Load and merge a campaign from an array of { path, text } file objects.
 *
 * @param {{ path: string, text: string }[]} files
 * @returns {Promise<{ metadata: object, scenes: object, items: object }>}
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

  // Merge scenes and items from all scene files
  const mergedScenes = {};
  const sceneSourceFiles = {};
  const mergedItems = {};
  const itemSourceFiles = {};

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
    for (const [itemName, description] of Object.entries(items)) {
      if (itemName in mergedItems) {
        throw new Error(
          `Duplicate item '${itemName}' in items registry found in '${filename}' and '${itemSourceFiles[itemName]}'.`
        );
      }
      mergedItems[itemName] = description;
      itemSourceFiles[itemName] = filename;
    }
  }

  return {
    metadata,
    scenes: mergedScenes,
    items: mergedItems,
  };
}

/**
 * Validate campaign structure and scene graph.
 *
 * Direct port of validate_campaign() from campaign.py.
 *
 * @param {{ metadata: object, scenes: object, items: object }} campaign
 * @returns {{ level: 'error'|'warning', message: string }[]}
 */
export function validateCampaign(campaign) {
  const results = [];
  const scenes = campaign.scenes ?? {};
  const metadata = campaign.metadata ?? {};
  const itemsRegistry = campaign.items ?? {};

  function err(message) { results.push({ level: 'error', message }); }
  function warn(message) { results.push({ level: 'warning', message }); }

  // ── Metadata checks ──────────────────────────────────────────────────────

  const start = metadata.start;
  if (!start) {
    err('metadata.start is missing.');
  } else if (!(start in scenes)) {
    err(`metadata.start refers to unknown scene: '${start}'`);
  }

  // ── Scene checks ─────────────────────────────────────────────────────────

  const allItemNamesUsed = new Set();

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

      // Collect item names for advisory check
      if (choice.requires_item) allItemNamesUsed.add(choice.requires_item);
      for (const item of choice.requires_items ?? []) allItemNamesUsed.add(item);
      for (const item of choice.gives_items ?? []) allItemNamesUsed.add(item);
    }

    // Collect from on_enter too
    const onEnter = scene.on_enter ?? {};
    for (const item of onEnter.gives_items ?? []) allItemNamesUsed.add(item);
  }

  // ── Reachability check (BFS from start) ──────────────────────────────────

  if (start && start in scenes) {
    const reachable = new Set();
    const queue = [start];
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
