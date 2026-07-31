<!-- AUTO-MANAGED: project-description -->
## Overview

**keyboard-composer** (`v0.1.0`, private) — a React + react-three-fiber
component that renders a 3D mechanical keyboard as a product configurator.

Key features:
- Navigation over a fixed graph of 21 named poses (no free orbit) with
  damped-spring settle physics.
- A per-pose volumetric lighting rig (~34 lights) authored in-browser and
  serialized to a single JSON blob.
- Named, authorable framings ("focus") on logical mesh groups.
- An authored **animation sequencer** (step/wave based) composing poses,
  framings, opacity and transforms into replayable sequences.
- Two product modes, `idle` (turn the model by hand) and `config`
  (button-driven), plus a `?debug` authoring playground.

⚠️ WIP: the debug/authoring playground and the shipped component live in the
same files, separated by the `DEBUG` flag and `editMode`. See the manual
section below before changing anything — it records measured numbers, traps
and deliberate decisions that are not recoverable from the code.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: build-commands -->
## Build & Development Commands

```bash
npm install
npm run dev              # vite dev server (port from $PORT, fallback 5174)
npm run build            # production build
npm run preview          # preview the production build

npm run asset:convert    # OBJ -> raw GLB (obj2gltf, --max-old-space-size=8192)
npm run asset:optimize   # weld -> prune --keep-attributes -> draco
npm run asset:inspect    # gltf-transform inspect public/models/keyboard.glb
```

**No test runner and no linter are configured.** Changes are verified by
driving the running app and reading values back out of the scene graph — see
"Verifying changes in the browser" in the manual section for the three
measurement techniques that cost real time to re-derive.

⚠️ Never run `gltf-transform optimize`/`join` on the model: it merges node
names and breaks both group classification and the per-group material clone.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Architecture

Vite + React 19 + `@react-three/fiber` 9 / `@react-three/drei` 10 / three
0.178, with `leva` for the debug panels and `maath` for damping. Everything
of substance lives in one component directory.

```
src/
├─ main.jsx, App.jsx                    app entry
└─ components/KeyboardComposer/
   ├─ index.js                          public exports (default + product registry)
   ├─ KeyboardComposer.jsx              DOM shell, app-mode state, apiRef bridge,
   │                                    resolves the `product` prop
   ├─ Scene.jsx                         <Canvas>, editMode control, material/focus tuners
   ├─ KeyboardModel.jsx                 GLB load, auto-fit, useComposerControls host
   ├─ useComposerControls.js            drag/keys/spring/camera/zoom/focus
   ├─ poseGraph.js                      angle primitives + `createPoseGraph` FACTORY
   │                                    (no pose data — that lives per product)
   ├─ products/                         ONE CONFIGURATOR, MANY MODELS
   │  ├─ index.js                       PRODUCTS registry, PRODUCT_IDS enum,
   │  │                                 getProduct/resolveProduct
   │  ├─ productSchema.js               defineProduct/resolveProduct + typedefs
   │  └─ arrayModelL/                   the first product: poseGraph (21 poses),
   │                                    meshGroups, meshVariants, model+config URLs
   ├─ focusFraming.js                   bounding-sphere group framing measure
   ├─ LightRig.jsx                      all lighting + per-pose light editor + save/load JSON
   ├─ MeshController.jsx                mesh/group inspector (TransformControls, halos)
   ├─ AnimationDirector.jsx             single useFrame driving the runtime; renders null
   ├─ VariantController.jsx             ISO/ANSI-style variant visibility
   ├─ Hud.jsx                           product DOM overlay (telemetry, chips, mode button)
   ├─ AnimationEditor.jsx               ?debug block editor for animations
   ├─ animation/                        schema, runtime, actions, selectors, easings,
   │                                    opacityRegistry, pivot, pivotRegistry, transforms
   └─ materials/                        MACHINERY ONLY (meshGroups, groupMaterials,
                                        meshVariants, warmupTransparency) — the
                                        group/variant LISTS live under products/
public/
├─ models/keyboard.glb                  ARRAY_MODEL_L's GLB (`product.modelUrl`)
├─ draco/                               decoder, passed explicitly to useGLTF
└─ lightconfig/app-state-config.json    ALL authored state of ARRAY_MODEL_L
                                        (lights, materials, rotation, keylight,
                                        spotlight, focus, animations, app).
                                        Path comes from `product.configUrl`;
                                        new products default to
                                        /lightconfig/<ID>/app-state-config.json
```

Data flow, in two directions:
- **Commands** cross the DOM/Canvas boundary through one imperative ref,
  `apiRef` — a multi-writer bridge written **only** via
  `Object.assign(apiRef.current, {...})`, never reassigned. Five writers.
- **Data** needs no bridge: `KeyboardComposer.jsx` renders both the Canvas
  subtree and the DOM overlays, so animations, variants and `appMode` travel
  as ordinary props.
- **Authored values** are not hardcoded defaults — they are fetched from
  `product.configUrl` in production and re-dispatched as `app-load-*`
  CustomEvents.

**One configurator, many models.** Everything model-specific is a `Product`
(`products/productSchema.js`): `modelUrl`, `configUrl`, `poseGraph`,
`meshGroups`, `meshVariants`. `KeyboardComposer` takes one `product` prop (an
id from `PRODUCT_IDS`, a defined product, or a raw definition), resolves it
once, and threads the frozen object down the tree.

⚠️ The five pieces are **not** independent — that is why the product, not the
individual list, is the swappable unit: the config JSON is indexed *by pose
key* (`lights`) and *by group id* (`materials`, `focus`), and authored
animations cite pose keys, group ids and variant ids. Mixing one model's pose
graph with another's groups yields a JSON that half-loads, silently.

⚠️ Consequently `collectMeshGroups`, `collectVariantMeshes`, `resolveSelector`,
`measureGroupFraming` and friends have **no default** `groups`/`variants`
argument any more. A forgotten argument must throw, not quietly classify the
wrong model. Adding a model = a folder under `products/`, a `defineProduct`,
one line in `products/index.js`.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Code Conventions

- **ESM only** (`"type": "module"`), `.jsx` for components, `.js` for
  React-free logic. No TypeScript.
- **No semicolons**, single quotes, 2-space indent, trailing commas in
  multi-line literals.
- **Comments and UI strings are in Italian**; identifiers are in English.
  Long block comments at the top of a file argue *why* a design is what it
  is — keep that habit when adding a module.
- **Naming**: PascalCase components and files (`LightRig.jsx`), camelCase
  functions/variables, SCREAMING_SNAKE_CASE module constants
  (`RADIUS_MIN`, `DEPTH_WRITE_MIN`, `DEFAULT_VIEW_SETTINGS`; per-product data
  is `<PRODUCT_ID>_POSE_GRAPH`/`_MESH_GROUPS`/`_MESH_VARIANTS`, e.g.
  `ARRAY_MODEL_L_MESH_GROUPS`), `__doubleUnderscore` for runtime tags and
  globals (`__editorHelper`, `__animPivot`, `window.__STATE_*`).
- **Imports** are grouped: react → three → r3f/drei → leva/maath → local,
  local paths relative and extension-less.
- **Styling** is CSS Modules (`*.module.css`) with CSS custom properties for
  layout constants; there is no CSS framework.
- **Exports**: `export default` for components, named exports for helpers;
  the folder's public surface is re-exported from `index.js`.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: patterns -->
## Detected Patterns

Recurring shapes in this codebase — follow them rather than inventing a
variant:

- **`DEBUG` is recomputed per file**, never threaded as a prop:
  `new URLSearchParams(window.location.search).has('debug')`. `editMode`
  is the opposite — one `useControls` in `Scene.jsx`, threaded down.
- **Ref mirrors for per-render values read inside stable closures**
  (`disabledRef`, `feelRef`, `focusImplRef`, `editModeRef`): the API effect
  runs once, so implementations are reached through a ref updated every
  render.
- **Polling over subscriptions for DOM↔Canvas readouts**: `Hud.jsx` and
  `AnimationEditor.jsx` poll `apiRef.current` on a 150 ms interval;
  `DebugPanel` polls Leva's bounding rect at 200 ms; `warmupTransparency`
  polls a program signature at 400 ms.
- **Declarative config arrays as the single source of truth** (`ACTIONS`,
  `DEFAULT_VIEW_SETTINGS`) — threaded as props with a default, so an
  integrator can substitute their own. Mesh groups/variants/pose graph
  followed this shape once but no longer take a default: they are **required**
  pieces of the resolved `product` (see "One configurator, many models" above)
  — a caller that forgets to pass them throws instead of silently classifying
  the wrong model. ⚠️ Array **order** is still significant in
  `products/<id>/meshGroups.js`.
- **Schema and implementation side by side** so they cannot drift:
  `ACTIONS` holds a parameter schema, the runtime impl and the `inverse`
  generator in one object; the editor's UI is generated from it.
- **Registries with refcounted ownership + snapshot restore**
  (`opacityRegistry`, `pivotRegistry`): acquire snapshots once, a second
  acquire bumps a count, release restores — never bakes.
- **One component instance per item, never `useControls` in a loop**
  (`MaterialTuner`/`FocusTuner` render N tuner components).
- **Scene traversals must skip tagged nodes**: `userData.__editorHelper`
  and `userData.__variantHidden`. Every new traversal is one more site to
  cover.
- **Per-frame code avoids shader-define writes** (`transparent`,
  `needsUpdate`, light *counts*); only uniforms and renderer state change
  per frame.

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->

<!-- END MANUAL -->