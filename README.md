# SceneMaker

A browser-based interactive 3D scene designer. Compose parametric shapes, style
them with color and finish presets, light the scene with environment presets,
and (coming next) make it respond to hover, click, and key presses, then
publish it as a live web page.

![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)

## What it is (and is not)

The output is an experience: a scene that reacts to the person viewing it.
It is not a modeling tool, not a game engine, and not a video renderer.
Interactivity is capped at states + events + timelines by design.

## Architecture

- `engine/resolver.mjs`: the pure engine. `resolve(doc, eventLog, t)` maps a
  scene document plus an input log to resolved property values. No DOM, no
  Three.js; runs identically in Node and the browser. `suite.cjs` is its
  truth-table test suite (run: `node suite.cjs`).
- `js/doc.mjs`: the scene document model, primitives, finish presets,
  environment presets, normalization.
- `js/editor.mjs`: the Three.js viewport (ACES tone mapping, soft PCF
  shadows, PMREM softbox environment, transform gizmos).
- `js/ui.mjs`: panels and toolbar.
- `js/app.mjs`: state, actions, undo/redo, and the `SceneMakerApp` surface.
- `vendor/three/`: Three.js r184 (MIT), vendored, no CDN.

## Development

Plain ES modules, no build step. Serve the directory and open `index.html`.

## Tests

- `node suite.cjs`: engine truth tables.
