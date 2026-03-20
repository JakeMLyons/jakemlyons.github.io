/**
 * test_parity.js — Cross-implementation parity test.
 *
 * Replays fixed choice sequences through the JS engine and compares output
 * field-by-field against the Python engine (invoked via child_process).
 *
 * Run with: node CampaignEngine/js/test_parity.js
 *
 * Requires: Python 3 in PATH, pyyaml installed, adventure package importable.
 * Run from the project root: node CampaignEngine/js/test_parity.js
 */

import { execSync } from 'node:child_process';
import { GameEngine } from './engine.js';
import { PlayerState } from './state.js';

// ─── Pre-flight: verify Python is available ───────────────────────────────────

try {
  execSync('python --version', { stdio: 'pipe' });
} catch {
  try {
    execSync('python3 --version', { stdio: 'pipe' });
  } catch {
    console.error(
      'ERROR: Python not found in PATH.\n' +
        'The parity test requires Python 3 with pyyaml installed.\n' +
        'Install Python from https://python.org and run: pip install pyyaml'
    );
    process.exit(1);
  }
}

// Determine which python command to use
let PYTHON_CMD = 'python';
try {
  execSync('python --version', { stdio: 'pipe' });
} catch {
  PYTHON_CMD = 'python3';
}

// ─── Python runner ────────────────────────────────────────────────────────────

/**
 * Run a sequence of choices through the Python engine for the given campaign
 * dict and return the array of GameOutput-equivalent dicts.
 */
function runPython(campaign, choices) {
  const script = `
import json, sys
sys.path.insert(0, '.')
from adventure.engine import GameEngine
from adventure.state import PlayerState

campaign = json.loads(sys.argv[1])
choices = json.loads(sys.argv[2])

# Normalise: Python engine expects integer health in default_player_state
meta = campaign.get('metadata', {})
dps = meta.get('default_player_state', {})
if dps.get('health') is not None:
    dps['health'] = int(dps['health'])

engine = GameEngine(campaign)
output = engine.start()

results = []

def serialise(out):
    return {
        'sceneText': out.scene_text,
        'choices': out.choices,
        'messages': out.messages,
        'isTerminal': out.is_terminal,
        'terminalReason': out.terminal_reason,
        'noChoices': out.no_choices,
        'state': out.state.to_dict(),
    }

results.append(serialise(output))

for choice in choices:
    try:
        output = engine.step(output.state, str(choice))
        results.append(serialise(output))
    except Exception as e:
        results.append({'error': str(e)})
        break

print(json.dumps(results))
`.trim();

  const campaignJson = JSON.stringify(campaign);
  const choicesJson = JSON.stringify(choices);

  const result = execSync(
    `${PYTHON_CMD} -c "${script.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" "${campaignJson.replace(/"/g, '\\"')}" "${choicesJson.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8', stdio: 'pipe' }
  );
  return JSON.parse(result.trim());
}

/**
 * Run the same sequence through the JS engine and return comparable output.
 */
function runJS(campaign, choices) {
  const engine = new GameEngine(campaign);
  let output = engine.start();
  const results = [serializeOutput(output)];

  for (const choice of choices) {
    try {
      output = engine.step(output.state, String(choice));
      results.push(serializeOutput(output));
    } catch (e) {
      results.push({ error: e.message });
      break;
    }
  }
  return results;
}

function serializeOutput(output) {
  return {
    sceneText: output.sceneText,
    choices: output.choices,
    messages: output.messages,
    isTerminal: output.isTerminal,
    terminalReason: output.terminalReason,
    noChoices: output.noChoices,
    state: output.state.toDict(),
  };
}

// ─── Comparison helper ────────────────────────────────────────────────────────

function compare(pythonOutputs, jsOutputs, label) {
  let passed = 0;
  let failed = 0;

  const len = Math.max(pythonOutputs.length, jsOutputs.length);
  for (let i = 0; i < len; i++) {
    const py = pythonOutputs[i];
    const js = jsOutputs[i];
    const stepLabel = `${label} step ${i}`;

    if (!py) {
      console.error(`FAIL [${stepLabel}]: Python produced no output at step ${i}`);
      failed++;
      continue;
    }
    if (!js) {
      console.error(`FAIL [${stepLabel}]: JS produced no output at step ${i}`);
      failed++;
      continue;
    }

    const fields = [
      'sceneText',
      'isTerminal',
      'terminalReason',
      'noChoices',
      'messages',
      'choices',
    ];
    let stepFailed = false;

    for (const field of fields) {
      const pyVal = JSON.stringify(py[field]);
      const jsVal = JSON.stringify(js[field]);
      if (pyVal !== jsVal) {
        console.error(
          `FAIL [${stepLabel}] field '${field}':\n  Python: ${pyVal}\n  JS:     ${jsVal}`
        );
        stepFailed = true;
      }
    }

    // Compare visited and inventory in state
    for (const stateField of ['visited', 'inventory', 'notes']) {
      const pyVal = JSON.stringify(py.state?.[stateField]);
      const jsVal = JSON.stringify(js.state?.[stateField]);
      if (pyVal !== jsVal) {
        console.error(
          `FAIL [${stepLabel}] state.${stateField}:\n  Python: ${pyVal}\n  JS:     ${jsVal}`
        );
        stepFailed = true;
      }
    }

    if (stepFailed) {
      failed++;
    } else {
      passed++;
    }
  }

  return { passed, failed };
}

// ─── Test cases ───────────────────────────────────────────────────────────────

const tests = [
  {
    label: 'Basic navigation',
    campaign: {
      metadata: {
        title: 'Parity Test',
        start: 'start',
        default_player_state: { health: 100, inventory: [] },
      },
      scenes: {
        start: {
          text: 'You stand at the beginning.',
          choices: [
            { label: 'Go to forest', next: 'forest' },
            { label: 'Go to cave', next: 'cave' },
          ],
        },
        forest: {
          text: 'The forest is dark.',
          choices: [{ label: 'Return', next: 'start' }],
        },
        cave: {
          text: 'The cave is cold.',
          end: true,
        },
      },
      items: {},
    },
    choices: [1, 1, 2],
  },

  {
    label: 'Item grants and gates',
    campaign: {
      metadata: {
        title: 'Item Test',
        start: 'start',
        default_player_state: { health: 100, inventory: [] },
      },
      scenes: {
        start: {
          text: 'A rusty key glints in the dirt.',
          choices: [
            { label: 'Pick up the key', next: 'start_with_key', gives_items: ['rusty key'] },
            { label: 'Ignore it', next: 'locked_door' },
          ],
        },
        start_with_key: {
          text: 'You now hold the key.',
          choices: [
            { label: 'Go to locked door', next: 'locked_door' },
          ],
        },
        locked_door: {
          text: 'A locked door stands before you.',
          choices: [
            { label: 'Use the key', next: 'beyond', requires_item: 'rusty key' },
            { label: 'Walk away', next: 'end_no_key' },
          ],
        },
        beyond: { text: 'You passed through.', end: true },
        end_no_key: { text: 'You left without the key.', end: true },
      },
      items: {},
    },
    choices: [1, 1, 1],
  },

  {
    label: 'Note grants',
    campaign: {
      metadata: {
        title: 'Note Test',
        start: 'start',
        default_player_state: { inventory: [] },
      },
      scenes: {
        start: {
          text: 'An ancient inscription.',
          choices: [
            {
              label: 'Read the inscription',
              next: 'forest',
              gives_notes: ['The inscription reads: Turn back.'],
            },
          ],
        },
        forest: {
          text: 'The forest.',
          on_enter: { gives_notes: ['The trees whisper warnings.'] },
          choices: [{ label: 'Continue', next: 'end' }],
        },
        end: { text: 'The end.', end: true },
      },
      items: {},
    },
    choices: [1, 1],
  },

  {
    label: 'Health: damage, heal, death from choice',
    campaign: {
      metadata: {
        title: 'Health Test',
        start: 'start',
        default_player_state: { health: 50, inventory: [] },
      },
      scenes: {
        start: {
          text: 'You feel healthy.',
          choices: [
            { label: 'Take damage', next: 'mid', damage: 10 },
          ],
        },
        mid: {
          text: 'You are wounded.',
          choices: [
            { label: 'Heal', next: 'healed', heal: 5 },
            { label: 'Take fatal damage', next: 'never', damage: 200 },
          ],
        },
        healed: {
          text: 'You feel better.',
          choices: [{ label: 'End', next: 'end_scene' }],
        },
        never: { text: 'Should not reach this.', end: true },
        end_scene: { text: 'You survived.', end: true },
      },
      items: {},
    },
    choices: [1, 2],
  },

  {
    label: 'on_enter damage and death from on_enter',
    campaign: {
      metadata: {
        title: 'OnEnter Test',
        start: 'start',
        default_player_state: { health: 20, inventory: [] },
      },
      scenes: {
        start: {
          text: 'A trap awaits.',
          choices: [{ label: 'Step forward', next: 'trap' }],
        },
        trap: {
          text: 'The trap fires!',
          on_enter: { message: 'Click!', damage: 30 },
          choices: [{ label: 'Continue', next: 'end_scene' }],
        },
        end_scene: { text: 'You made it.', end: true },
      },
      items: {},
    },
    choices: [1],
  },

  {
    label: 'on_enter items and visited tracking',
    campaign: {
      metadata: {
        title: 'OnEnter Items Test',
        start: 'start',
        default_player_state: { inventory: [] },
      },
      scenes: {
        start: {
          text: 'A treasure chest.',
          on_enter: { gives_items: ['gold coin'] },
          choices: [
            { label: 'Go to market', next: 'market' },
          ],
        },
        market: {
          text: 'The market.',
          choices: [{ label: 'Return', next: 'start' }],
        },
      },
      items: {},
    },
    choices: [1, 1],
  },
];

// ─── Run all tests ────────────────────────────────────────────────────────────

let totalPassed = 0;
let totalFailed = 0;

console.log('Running cross-implementation parity tests...\n');

for (const test of tests) {
  process.stdout.write(`  ${test.label} ... `);

  let pythonOutputs;
  try {
    pythonOutputs = runPython(test.campaign, test.choices);
  } catch (e) {
    console.error(`\nERROR running Python engine: ${e.message}`);
    totalFailed++;
    continue;
  }

  const jsOutputs = runJS(test.campaign, test.choices);
  const { passed, failed } = compare(pythonOutputs, jsOutputs, test.label);

  if (failed === 0) {
    console.log(`✓ (${passed} steps)`);
    totalPassed += passed;
  } else {
    console.log(`✗ (${failed} failures)`);
    totalFailed += failed;
    totalPassed += passed;
  }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(
  `Parity test complete: ${totalPassed} passed, ${totalFailed} failed.`
);

if (totalFailed > 0) {
  process.exit(1);
}
