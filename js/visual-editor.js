/**
 * visual-editor.js — Cytoscape.js flowchart editor for the Visual tab.
 *
 * Public API:
 *   initFlowEditor(container, campaign, callbacks, savedPositions, refit)
 *   destroyFlowEditor()
 *   cancelEdgeSource()            — cancel active edge draw (called on Escape)
 *
 * Callbacks (all optional):
 *   onNodeDblClick(sceneId)              — double-click node → open Form editor
 *   onNodeRightClick(sceneId, x, y)      — right-click node → context menu
 *   onEdgeCreated(fromId, toId)          — user completed a drag connection (new choice)
 *   onChoiceRetarget(sceneId, idx, newTargetId) — user Ctrl+dragged an edge to a new target
 *   onEdgeCancelled()                   — drag released on empty canvas (no edge made)
 *   onEdgeDroppedOnCanvas(fromId, x, y) — Ctrl+drag from node released on empty canvas
 *   onChoiceClick(sceneId, idx, x, y)    — single-click edge → choice popover
 *   onChoiceDblClick(sceneId, idx)       — double-click edge → open choice in Form
 *   onChoiceRightClick(sceneId, idx, x, y) — right-click edge → choice context menu
 *   onCreateScene(x, y)                  — double-click empty canvas
 *   onPositionsChanged(positions)        — after node drag ends
 *   onBackgroundClick()                  — single tap on empty canvas
 *
 * Requires globalThis.cytoscape             (vendor/cytoscape.min.js)
 * Requires globalThis.cytoscapeEdgehandles  (vendor/cytoscape-edgehandles.js)
 */

// ─── Module state ─────────────────────────────────────────────────────────────

let cy             = null;
let eh             = null;      // cytoscape-edgehandles instance
let callbacks      = {};
let singleTapTimer = null;
let edgeTapTimer   = null;
let retargetInfo   = null;      // {sceneId, choiceIdx} when Ctrl+dragging an existing edge
let ctrlDragFrom   = null;      // nodeId when Ctrl+drag on a node starts (for canvas-drop)
let lastCyPos      = { x: 0, y: 0 }; // last known cursor position in Cytoscape model coords

// ─── Public API ───────────────────────────────────────────────────────────────

export function initFlowEditor(container, campaign, cbs, savedPositions = {}, refit = false) {
  callbacks = cbs ?? {};

  if (cy) {
    cy.batch(() => {
      cy.elements().remove();
      cy.add(buildElements(campaign, savedPositions));
    });
    applyLayout(cy, savedPositions, refit);
    return;
  }

  cy = globalThis.cytoscape({
    container,
    elements: buildElements(campaign, savedPositions),
    style:    buildStyle(),
    layout:   { name: 'preset' },
    wheelSensitivity: 0.3,
    minZoom:  0.1,
    maxZoom:  4,
  });

  // Ctrl+drag on a node — register BEFORE edgehandles so this tapstart fires first,
  // enabling draw mode in time for edgehandles' own tapstart handler to see it.
  cy.on('tapstart', 'node', e => {
    if (e.originalEvent?.ctrlKey) {
      ctrlDragFrom = e.target.id(); // remember which node started this ctrl+drag
      eh?.enableDrawMode();
    }
  });

  // Ctrl+drag on an edge — retarget that choice to a new scene.
  // Registered before edgehandles so we can call start() ourselves.
  cy.on('tapstart', 'edge', e => {
    if (!e.originalEvent?.ctrlKey || !eh) return;
    const parsed = parseEdgeId(e.target.id());
    if (!parsed) return; // skip edgehandles internal edges
    retargetInfo = parsed;
    eh.enableDrawMode();
    eh.start(e.target.source());
  });

  // Edgehandles — drag from a node to another node to connect (requires draw mode)
  if (globalThis.cytoscapeEdgehandles) {
    eh = cy.edgehandles({
      snap: true,
      snapThreshold: 50,
      snapFrequency: 15,
      hoverDelay: 0,
      edgeType(sourceNode, targetNode) {
        return sourceNode.id() !== targetNode.id() ? 'flat' : null;
      },
      loopAllowed() { return false; },
      handlePosition() { return 'middle top'; },
      ghostEdgeParams() { return {}; },
    });

    cy.on('ehcomplete', (_event, sourceNode, targetNode, addedEles) => {
      addedEles.remove(); // remove temp edge — graph is rebuilt from campaign data
      eh.disableDrawMode();
      ctrlDragFrom = null; // completed normally — no canvas-drop action needed
      if (retargetInfo) {
        const { sceneId, choiceIdx } = retargetInfo;
        retargetInfo = null;
        callbacks.onChoiceRetarget?.(sceneId, choiceIdx, targetNode.id());
      } else {
        callbacks.onEdgeCreated?.(sourceNode.id(), targetNode.id());
      }
    });

    cy.on('ehcancel', () => {
      const fromId = ctrlDragFrom;
      retargetInfo = null;
      ctrlDragFrom = null;
      eh.disableDrawMode();
      if (fromId) {
        // Ctrl+drag from a node released on empty canvas → let editor create a new scene
        callbacks.onEdgeDroppedOnCanvas?.(fromId, lastCyPos.x, lastCyPos.y);
      } else {
        callbacks.onEdgeCancelled?.();
      }
    });
  }

  applyLayout(cy, savedPositions, refit);
  wireEvents();
}

export function destroyFlowEditor() {
  clearTimeout(singleTapTimer);
  clearTimeout(edgeTapTimer);
  singleTapTimer = null;
  edgeTapTimer   = null;
  retargetInfo   = null;
  ctrlDragFrom   = null;
  lastCyPos      = { x: 0, y: 0 };
  if (cy) { cy.destroy(); cy = null; }
  eh = null;
}

export function enableDrawMode() {
  eh?.enableDrawMode();
}

export function cancelEdgeSource() {
  eh?.disableDrawMode();
}

export function focusNode(sceneId) {
  if (!cy) return;
  const node = cy.$id(sceneId);
  if (node.nonempty()) highlightNode(node);
}

export function getNodePositions() {
  if (!cy) return {};
  const out = {};
  cy.nodes().forEach(n => { const p = n.position(); out[n.id()] = { x: p.x, y: p.y }; });
  return out;
}

// ─── Graph construction ───────────────────────────────────────────────────────

function buildElements(campaign, savedPositions) {
  const nodes   = [];
  const edges   = [];
  const scenes  = campaign.scenes  ?? {};
  const startId = campaign.metadata?.start;
  const ids     = Object.keys(scenes);
  const cols    = Math.max(1, Math.ceil(Math.sqrt(ids.length)));

  ids.forEach((id, i) => {
    const scene = scenes[id];
    const pos = savedPositions[id]
      ? { x: savedPositions[id].x, y: savedPositions[id].y }
      : { x: 80 + (i % cols) * 200, y: 80 + Math.floor(i / cols) * 200 };

    nodes.push({
      data: { id, label: scene.title || id, isStart: id === startId, isTerminal: !!scene.end },
      position: pos,
    });

    for (let j = 0; j < (scene.choices ?? []).length; j++) {
      const choice = scene.choices[j];
      if (!choice.next || !scenes[choice.next]) continue;
      edges.push({ data: { id: `${id}__${j}`, source: id, target: choice.next } });
    }
  });

  return [...nodes, ...edges];
}

function buildStyle() {
  return [
    {
      selector: 'node',
      style: {
        'label':            'data(label)',
        'text-valign':      'center',
        'text-halign':      'center',
        'text-wrap':        'wrap',
        'text-max-width':   '110px',
        'width':            '130px',
        'height':           '48px',
        'shape':            'roundrectangle',
        'background-color': '#1e2a36',
        'border-color':     '#3a4f65',
        'border-width':     1.5,
        'color':            '#c8d6e5',
        'font-size':        '11px',
        'font-family':      'ui-monospace, Consolas, monospace',
      },
    },
    { selector: 'node[?isStart]',    style: { 'background-color': '#1a3a4f', 'border-color': '#4fc3f7', 'border-width': 2.5, 'color': '#e0f7fa' } },
    { selector: 'node[?isTerminal]', style: { 'background-color': '#3a1f2a', 'border-color': '#c77',    'border-width': 2,   'color': '#f5c6c6' } },
    { selector: 'node.highlighted',  style: { 'border-color': '#7ecfff', 'border-width': 3, 'background-color': '#1f3a52' } },
    { selector: 'node.hl-neighbor',  style: { 'border-color': '#4a7a9a', 'border-width': 2 } },
    { selector: 'node.dimmed',       style: { 'opacity': 0.45 } },
    { selector: 'node.choice-active', style: { 'border-color': '#f0c040', 'border-width': 2.5 } },
    {
      selector: 'edge',
      style: {
        'curve-style':        'bezier',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': '#4a6375',
        'line-color':         '#4a6375',
        'width':              1.5,
        'arrow-scale':        0.9,
      },
    },
    { selector: 'edge.highlighted',  style: { 'line-color': '#7ecfff', 'target-arrow-color': '#7ecfff', 'width': 2.5 } },
    { selector: 'edge.dimmed',       style: { 'opacity': 0.25 } },
    { selector: 'edge.choice-active', style: { 'line-color': '#f0c040', 'target-arrow-color': '#f0c040', 'width': 2.5 } },
    // ── edgehandles styles ──────────────────────────────────────────────────
    {
      selector: '.eh-handle',
      style: {
        'background-color': '#f0c040',
        'width':            12,
        'height':           12,
        'shape':            'ellipse',
        'overlay-opacity':  0,
        'border-width':     0,
        'label':            '',
      },
    },
    {
      selector: '.eh-hover',
      style: {
        'background-color': '#1f3a52',
        'border-color':     '#7ecfff',
        'border-width':     2,
      },
    },
    {
      selector: '.eh-source',
      style: {
        'border-color': '#f0c040',
        'border-width': 3,
      },
    },
    {
      selector: '.eh-target',
      style: {
        'border-color': '#4fc3f7',
        'border-width': 3,
      },
    },
    {
      selector: '.eh-preview, .eh-ghost-edge',
      style: {
        'line-color':         '#f0c040',
        'target-arrow-color': '#f0c040',
        'source-arrow-color': '#f0c040',
        'line-style':         'dashed',
      },
    },
    {
      selector: '.eh-ghost-edge.eh-preview-active',
      style: { 'opacity': 0 },
    },
  ];
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function applyLayout(cy, savedPositions, refit) {
  if (Object.keys(savedPositions).length === 0) {
    cy.layout({ name: 'breadthfirst', directed: true, padding: 60, spacingFactor: 1.5, animate: false }).run();
  }
  if (refit || Object.keys(savedPositions).length === 0) cy.fit(cy.nodes(), 60);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseEdgeId(edgeId) {
  const sep = edgeId.lastIndexOf('__');
  if (sep === -1) return null;
  const choiceIdx = parseInt(edgeId.slice(sep + 2), 10);
  if (isNaN(choiceIdx)) return null;
  return { sceneId: edgeId.slice(0, sep), choiceIdx };
}

// ─── Cytoscape event wiring ───────────────────────────────────────────────────

function wireEvents() {
  // Single tap on node — highlight (with 220ms debounce for double-tap)
  cy.on('tap', 'node', e => {
    cy.elements().removeClass('choice-active dimmed');
    const node = e.target;

    clearTimeout(singleTapTimer);
    singleTapTimer = setTimeout(() => {
      singleTapTimer = null;
      highlightNode(node);
    }, 220);
  });

  // Double-tap on node — open Form editor
  cy.on('dbltap', 'node', e => {
    clearTimeout(singleTapTimer);
    singleTapTimer = null;
    cy.elements().removeClass('highlighted dimmed hl-neighbor');
    callbacks.onNodeDblClick?.(e.target.id());
  });

  // Tap on edge — highlight choice + dim unrelated elements; debounced popover
  cy.on('tap', 'edge', e => {
    const parsed = parseEdgeId(e.target.id());
    if (!parsed) return;

    cy.elements().removeClass('highlighted dimmed hl-neighbor choice-active');
    e.target.addClass('choice-active');
    e.target.source().addClass('choice-active');
    e.target.target().addClass('choice-active');
    cy.nodes().not(e.target.source()).not(e.target.target()).addClass('dimmed');
    cy.edges().not(e.target).addClass('dimmed');

    clearTimeout(edgeTapTimer);
    edgeTapTimer = setTimeout(() => {
      edgeTapTimer = null;
      const rp = e.renderedPosition;
      const rc = cy.container().getBoundingClientRect();
      callbacks.onChoiceClick?.(parsed.sceneId, parsed.choiceIdx, rc.left + rp.x, rc.top + rp.y);
    }, 220);
  });

  // Double-tap on edge — open choice in Form editor
  cy.on('dbltap', 'edge', e => {
    clearTimeout(edgeTapTimer);
    edgeTapTimer = null;
    const parsed = parseEdgeId(e.target.id());
    if (!parsed) return;
    cy.elements().removeClass('choice-active dimmed');
    callbacks.onChoiceDblClick?.(parsed.sceneId, parsed.choiceIdx);
  });

  // Right-click on edge — choice context menu
  cy.on('cxttap', 'edge', e => {
    const parsed = parseEdgeId(e.target.id());
    if (!parsed) return;

    cy.elements().removeClass('highlighted dimmed hl-neighbor choice-active');
    e.target.addClass('choice-active');
    e.target.source().addClass('choice-active');
    e.target.target().addClass('choice-active');
    cy.nodes().not(e.target.source()).not(e.target.target()).addClass('dimmed');
    cy.edges().not(e.target).addClass('dimmed');

    const rp = e.renderedPosition ?? e.position;
    const rc = cy.container().getBoundingClientRect();
    callbacks.onChoiceRightClick?.(parsed.sceneId, parsed.choiceIdx, rc.left + rp.x, rc.top + rp.y);
  });

  // Single tap on background — deselect all
  cy.on('tap', e => {
    if (e.target !== cy) return;
    clearTimeout(singleTapTimer);
    singleTapTimer = null;
    cy.elements().removeClass('highlighted dimmed hl-neighbor choice-active');
    callbacks.onBackgroundClick?.();
  });

  // Double-tap on background — create scene
  cy.on('dbltap', e => {
    if (e.target !== cy) return;
    const pos = e.position;
    callbacks.onCreateScene?.(pos.x, pos.y);
  });

  // Right-click — context menu
  cy.on('cxttap', 'node', e => {
    const rp = e.renderedPosition ?? e.position;
    const rc = cy.container().getBoundingClientRect();
    callbacks.onNodeRightClick?.(e.target.id(), rc.left + rp.x, rc.top + rp.y);
  });

  cy.on('dragfree', 'node', () => callbacks.onPositionsChanged?.(getNodePositions()));

  // Track cursor position in Cytoscape model coords for canvas-drop detection
  cy.on('mousemove', e => { lastCyPos = e.position; });
}

function highlightNode(node) {
  cy.elements().removeClass('highlighted dimmed hl-neighbor');
  const edges     = node.connectedEdges();
  const neighbors = edges.connectedNodes().not(node);
  node.addClass('highlighted');
  edges.addClass('highlighted');
  neighbors.addClass('hl-neighbor');
  cy.nodes().not(node).not(neighbors).addClass('dimmed');
  cy.edges().not(edges).addClass('dimmed');
}
