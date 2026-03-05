/**
 * campaign.test.js — Unit tests for campaign.js (validateCampaign only).
 *
 * loadCampaign() depends on js-yaml and is a filesystem/async function;
 * it is best verified manually or with integration tests.
 *
 * Run with: node --test campaign.test.js
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Bootstrap js-yaml into globalThis so campaign.js can use it
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const jsyaml = require(path.join(__dirname, '../vendor/js-yaml.min.js'));
globalThis.jsyaml = jsyaml;

import { validateCampaign, loadCampaign } from './campaign.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMinimalCampaign() {
  return {
    metadata: { start: 'start' },
    scenes: {
      start: {
        text: 'You stand at the beginning.',
        choices: [{ label: 'Continue', next: 'end' }],
      },
      end: { text: 'The end.', end: true },
    },
    items: {},
  };
}

// ─── validateCampaign ─────────────────────────────────────────────────────────

describe('validateCampaign()', () => {
  it('passes for a minimal valid campaign', () => {
    const results = validateCampaign(makeMinimalCampaign());
    const errors = results.filter((r) => r.level === 'error');
    assert.equal(errors.length, 0);
  });

  it('result entries have { level, message } shape', () => {
    const campaign = makeMinimalCampaign();
    // Force an advisory by adding an item reference without registry entry
    campaign.scenes.start.choices[0].requires_item = 'unknown item';
    const results = validateCampaign(campaign);
    assert.ok(results.length > 0);
    for (const r of results) {
      assert.ok('level' in r, 'missing level');
      assert.ok('message' in r, 'missing message');
      assert.ok(r.level === 'error' || r.level === 'warning', `unexpected level: ${r.level}`);
    }
  });

  it('reports missing metadata.start', () => {
    const campaign = makeMinimalCampaign();
    delete campaign.metadata.start;
    const errors = validateCampaign(campaign).filter((r) => r.level === 'error');
    assert.ok(errors.some((r) => r.message.includes('metadata.start is missing')));
  });

  it('reports unknown metadata.start', () => {
    const campaign = makeMinimalCampaign();
    campaign.metadata.start = 'nonexistent';
    const errors = validateCampaign(campaign).filter((r) => r.level === 'error');
    assert.ok(errors.some((r) => r.message.includes("metadata.start refers to unknown scene: 'nonexistent'")));
  });

  it('reports unknown next target on a choice', () => {
    const campaign = makeMinimalCampaign();
    campaign.scenes.start.choices[0].next = 'ghost_scene';
    const errors = validateCampaign(campaign).filter((r) => r.level === 'error');
    assert.ok(errors.some((r) => r.message.includes("'next' refers to unknown scene: 'ghost_scene'")));
  });

  it('reports scene with no choices and no end: true', () => {
    const campaign = makeMinimalCampaign();
    campaign.scenes.dead_end = { text: 'Stuck.' };
    // Make it reachable
    campaign.scenes.start.choices.push({ label: 'Go', next: 'dead_end' });
    const errors = validateCampaign(campaign).filter((r) => r.level === 'error');
    assert.ok(errors.some((r) => r.message.includes("Scene 'dead_end' has no 'choices'")));
  });

  it('reports unreachable scene', () => {
    const campaign = makeMinimalCampaign();
    campaign.scenes.orphan = {
      text: 'Never reached.',
      choices: [{ label: 'X', next: 'start' }],
    };
    const errors = validateCampaign(campaign).filter((r) => r.level === 'error');
    assert.ok(errors.some((r) => r.message.includes("Scene 'orphan' is not reachable")));
  });

  it('reports reserved command name collision as error', () => {
    const campaign = makeMinimalCampaign();
    // 'help' is a reserved name
    campaign.scenes.help = { text: 'Help scene.', end: true };
    campaign.scenes.start.choices.push({ label: 'Help', next: 'help' });
    const errors = validateCampaign(campaign).filter((r) => r.level === 'error');
    assert.ok(errors.some((r) => r.message.includes("Scene ID 'help' conflicts with a reserved command name")));
  });

  it('reports item used but absent from registry as level warning', () => {
    const campaign = makeMinimalCampaign();
    campaign.scenes.start.choices[0].gives_items = ['magic orb'];
    const warnings = validateCampaign(campaign).filter((r) => r.level === 'warning');
    assert.ok(warnings.some((r) => r.message.includes("item 'magic orb'")));
  });

  it('does not report advisory when item is in registry', () => {
    const campaign = makeMinimalCampaign();
    campaign.scenes.start.choices[0].gives_items = ['magic orb'];
    campaign.items['magic orb'] = 'A glowing orb.';
    const warnings = validateCampaign(campaign).filter((r) => r.level === 'warning');
    assert.ok(!warnings.some((r) => r.message.includes("item 'magic orb'")));
  });
});

// ─── loadCampaign ─────────────────────────────────────────────────────────────

describe('loadCampaign()', () => {
  it('throws when metadata.yaml is missing', async () => {
    const files = [{ path: 'scenes.yaml', text: 'scenes:\n  start:\n    text: hi\n    end: true\n' }];
    await assert.rejects(
      () => loadCampaign(files),
      (e) => e.message.includes('No metadata.yaml found')
    );
  });

  it('throws when no scene files found', async () => {
    const files = [
      {
        path: 'metadata.yaml',
        text: 'metadata:\n  start: start\n  title: Test\n',
      },
    ];
    await assert.rejects(
      () => loadCampaign(files),
      (e) => e.message.includes('No scene files found')
    );
  });

  it('throws on duplicate scene IDs across files', async () => {
    const files = [
      { path: 'metadata.yaml', text: 'metadata:\n  start: start\n' },
      { path: 'a.yaml', text: 'scenes:\n  start:\n    text: A\n    end: true\n' },
      { path: 'b.yaml', text: 'scenes:\n  start:\n    text: B\n    end: true\n' },
    ];
    await assert.rejects(
      () => loadCampaign(files),
      (e) => e.message.includes("Duplicate scene ID 'start'")
    );
  });

  it('merges scenes and items from multiple files', async () => {
    const files = [
      { path: 'metadata.yaml', text: 'metadata:\n  start: start\n  title: Test\n' },
      {
        path: 'scenes1.yaml',
        text: 'scenes:\n  start:\n    text: Begin.\n    choices:\n      - label: Go\n        next: end\n',
      },
      {
        path: 'scenes2.yaml',
        text: 'scenes:\n  end:\n    text: End.\n    end: true\nitems:\n  sword: A sharp blade.\n',
      },
    ];
    const campaign = await loadCampaign(files);
    assert.ok('start' in campaign.scenes);
    assert.ok('end' in campaign.scenes);
    assert.equal(campaign.items.sword.description, 'A sharp blade.');
  });

  it('handles folder-style paths with a root prefix', async () => {
    const files = [
      { path: 'MyCampaign/metadata.yaml', text: 'metadata:\n  start: start\n  title: Test\n' },
      {
        path: 'MyCampaign/scenes.yaml',
        text: 'scenes:\n  start:\n    text: Start.\n    end: true\n',
      },
    ];
    const campaign = await loadCampaign(files);
    assert.ok('start' in campaign.scenes);
  });

  it('returns assets with empty buckets when no assets block present', async () => {
    const files = [
      { path: 'metadata.yaml', text: 'metadata:\n  start: start\n' },
      { path: 'scenes.yaml', text: 'scenes:\n  start:\n    text: Hi.\n    end: true\n' },
    ];
    const campaign = await loadCampaign(files);
    assert.deepEqual(campaign.assets, { images: {}, music: {}, sfx: {} });
  });

  it('loads assets block and returns resolved registry', async () => {
    const files = [
      { path: 'metadata.yaml', text: 'metadata:\n  start: start\n' },
      {
        path: 'scenes.yaml',
        text: 'scenes:\n  start:\n    text: Hi.\n    end: true\nassets:\n  images:\n    bg: assets/bg.jpg\n  music:\n    theme: assets/theme.mp3\n',
      },
    ];
    const campaign = await loadCampaign(files);
    assert.equal(campaign.assets.images.bg, 'assets/bg.jpg');
    assert.equal(campaign.assets.music.theme, 'assets/theme.mp3');
  });

  it('merges assets across multiple files', async () => {
    const files = [
      { path: 'metadata.yaml', text: 'metadata:\n  start: start\n' },
      {
        path: 'scenes.yaml',
        text: 'scenes:\n  start:\n    text: Hi.\n    end: true\nassets:\n  images:\n    bg: assets/bg.jpg\n',
      },
      {
        path: 'sfx.yaml',
        text: 'scenes:\n  other:\n    text: Other.\n    end: true\nassets:\n  sfx:\n    click: assets/click.mp3\n',
      },
    ];
    const campaign = await loadCampaign(files);
    assert.equal(campaign.assets.images.bg, 'assets/bg.jpg');
    assert.equal(campaign.assets.sfx.click, 'assets/click.mp3');
  });

  it('throws on duplicate asset key within the same bucket across files', async () => {
    const files = [
      { path: 'metadata.yaml', text: 'metadata:\n  start: start\n' },
      {
        path: 'a.yaml',
        text: 'scenes:\n  start:\n    text: Hi.\n    end: true\nassets:\n  images:\n    bg: a.jpg\n',
      },
      {
        path: 'b.yaml',
        text: 'scenes:\n  end:\n    text: End.\n    end: true\nassets:\n  images:\n    bg: b.jpg\n',
      },
    ];
    await assert.rejects(
      () => loadCampaign(files),
      (e) => e.message.includes('Duplicate asset key "bg"') && e.message.includes('"images"')
    );
  });

  it('sets assetsInMetadata true when metadata.yaml has an assets block', async () => {
    const files = [
      {
        path: 'metadata.yaml',
        text: 'metadata:\n  start: start\nassets:\n  images:\n    bg: bg.jpg\n',
      },
      { path: 'scenes.yaml', text: 'scenes:\n  start:\n    text: Hi.\n    end: true\n' },
    ];
    const campaign = await loadCampaign(files);
    assert.equal(campaign.assetsInMetadata, true);
  });

  it('sets assetsInMetadata false when no assets block in metadata.yaml', async () => {
    const files = [
      { path: 'metadata.yaml', text: 'metadata:\n  start: start\n' },
      {
        path: 'scenes.yaml',
        text: 'scenes:\n  start:\n    text: Hi.\n    end: true\nassets:\n  images:\n    bg: bg.jpg\n',
      },
    ];
    const campaign = await loadCampaign(files);
    assert.equal(campaign.assetsInMetadata, false);
  });

  it('throws when asset key is named "none"', async () => {
    const files = [
      { path: 'metadata.yaml', text: 'metadata:\n  start: start\n' },
      {
        path: 'scenes.yaml',
        text: 'scenes:\n  start:\n    text: Hi.\n    end: true\nassets:\n  images:\n    none: bad.jpg\n',
      },
    ];
    await assert.rejects(
      () => loadCampaign(files),
      (e) => e.message.includes('"none"') && e.message.includes('reserved')
    );
  });
});

// ─── validateCampaign — asset checks ─────────────────────────────────────────

describe('validateCampaign() — assets', () => {
  function makeAssetCampaign() {
    return {
      metadata: { start: 'start' },
      scenes: {
        start: { text: 'Begin.', choices: [{ label: 'Go', next: 'end' }] },
        end: { text: 'End.', end: true },
      },
      items: {},
      assets: {
        images: { bg: 'assets/bg.jpg' },
        music: { theme: 'assets/theme.mp3' },
        sfx: { click: 'assets/click.mp3' },
      },
    };
  }

  it('passes for campaign with valid asset references', () => {
    const campaign = makeAssetCampaign();
    campaign.scenes.start.assets = { image: 'bg', music: 'theme' };
    campaign.scenes.start.choices[0].gives_sfx = 'click';
    const errors = validateCampaign(campaign).filter((r) => r.level === 'error');
    assert.equal(errors.length, 0);
  });

  it('reports error for unknown image key in scene.assets', () => {
    const campaign = makeAssetCampaign();
    campaign.scenes.start.assets = { image: 'ghost_image' };
    const errors = validateCampaign(campaign).filter((r) => r.level === 'error');
    assert.ok(errors.some((r) => r.message.includes('"ghost_image"')));
  });

  it('reports error for unknown music key in scene.assets', () => {
    const campaign = makeAssetCampaign();
    campaign.scenes.start.assets = { music: 'ghost_music' };
    const errors = validateCampaign(campaign).filter((r) => r.level === 'error');
    assert.ok(errors.some((r) => r.message.includes('"ghost_music"')));
  });

  it('reports error for unknown sfx key on choice.gives_sfx', () => {
    const campaign = makeAssetCampaign();
    campaign.scenes.start.choices[0].gives_sfx = 'ghost_sfx';
    const errors = validateCampaign(campaign).filter((r) => r.level === 'error');
    assert.ok(errors.some((r) => r.message.includes('"ghost_sfx"')));
  });

  it('reports error for unknown sfx key on on_enter.gives_sfx', () => {
    const campaign = makeAssetCampaign();
    campaign.scenes.start.on_enter = { gives_sfx: 'ghost_sfx' };
    const errors = validateCampaign(campaign).filter((r) => r.level === 'error');
    assert.ok(errors.some((r) => r.message.includes('"ghost_sfx"')));
  });

  it('accepts none as image/music sentinel — no error', () => {
    const campaign = makeAssetCampaign();
    campaign.scenes.start.assets = { image: 'none', music: 'none' };
    const errors = validateCampaign(campaign).filter((r) => r.level === 'error');
    assert.equal(errors.length, 0);
  });

  it('warns on non-image extension in images bucket', () => {
    const campaign = makeAssetCampaign();
    campaign.assets.images.bad = 'assets/oops.mp3';
    // mark it as used so unused warning doesn't fire
    campaign.scenes.end.assets = { image: 'bad' };
    const warnings = validateCampaign(campaign).filter((r) => r.level === 'warning');
    assert.ok(warnings.some((r) => r.message.includes('"bad"') && r.message.includes('non-image')));
  });

  it('warns on non-audio extension in music bucket', () => {
    const campaign = makeAssetCampaign();
    campaign.assets.music.bad = 'assets/oops.png';
    campaign.scenes.end.assets = { music: 'bad' };
    const warnings = validateCampaign(campaign).filter((r) => r.level === 'warning');
    assert.ok(warnings.some((r) => r.message.includes('"bad"') && r.message.includes('non-audio')));
  });

  it('warns on invalid key name with spaces', () => {
    const campaign = makeAssetCampaign();
    campaign.assets.images['my bg'] = 'assets/bg.jpg';
    const warnings = validateCampaign(campaign).filter((r) => r.level === 'warning');
    assert.ok(warnings.some((r) => r.message.includes('"my bg"') && r.message.includes('invalid characters')));
  });

  it('warns on unused declared asset', () => {
    const campaign = makeAssetCampaign();
    // bg, theme, click are declared but never referenced
    const warnings = validateCampaign(campaign).filter((r) => r.level === 'warning');
    assert.ok(warnings.some((r) => r.message.includes('"bg"') && r.message.includes('never referenced')));
  });

  it('no unused warning when asset is referenced', () => {
    const campaign = makeAssetCampaign();
    campaign.scenes.start.assets = { image: 'bg', music: 'theme' };
    campaign.scenes.start.choices[0].gives_sfx = 'click';
    const warnings = validateCampaign(campaign).filter(
      (r) => r.level === 'warning' && r.message.includes('never referenced')
    );
    assert.equal(warnings.length, 0);
  });

  it('warns when assetsInMetadata is true', () => {
    const campaign = makeAssetCampaign();
    campaign.assetsInMetadata = true;
    // Mark declared assets as used so we only see the metadata warning
    campaign.scenes.start.assets = { image: 'bg', music: 'theme' };
    campaign.scenes.start.choices[0].gives_sfx = 'click';
    const warnings = validateCampaign(campaign).filter((r) => r.level === 'warning');
    assert.ok(warnings.some((r) => r.message.includes('metadata.yaml') && r.message.includes('assets')));
  });

  it('no metadata.yaml assets warning when assetsInMetadata is false', () => {
    const campaign = makeAssetCampaign();
    campaign.assetsInMetadata = false;
    campaign.scenes.start.assets = { image: 'bg', music: 'theme' };
    campaign.scenes.start.choices[0].gives_sfx = 'click';
    const warnings = validateCampaign(campaign).filter(
      (r) => r.level === 'warning' && r.message.includes('metadata.yaml')
    );
    assert.equal(warnings.length, 0);
  });

  it('accepts gives_sfx as an array and validates all keys', () => {
    const campaign = makeAssetCampaign();
    campaign.scenes.start.choices[0].gives_sfx = ['click', 'missing_key'];
    const errors = validateCampaign(campaign).filter((r) => r.level === 'error');
    assert.ok(errors.some((r) => r.message.includes('"missing_key"')));
    assert.ok(!errors.some((r) => r.message.includes('"click"')));
  });
});
