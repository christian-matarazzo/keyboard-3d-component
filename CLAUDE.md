<!-- AUTO-MANAGED: project-description -->
## Overview

**keyboard-composer** (`v0.1.0`) — a React + react-three-fiber component that
renders a 3D mechanical keyboard as a product configurator, packaged as an
npm library (`npm run build:lib`) with `react`, `react-dom`, `three`,
`@react-three/fiber`, `@react-three/drei` and `leva` as peer dependencies
(`leva` is optional — needed only to open the authoring editor).

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
- A small public API (`createPublicApi`, exported from the package root) —
  mode, animation playback/subscribe, variant selection, pose navigation —
  for a host app that renders its own UI and drives the model by calling it.

⚠️ WIP: the debug/authoring playground and the shipped component live in the
same source tree, separated by the `DEBUG`/`isDebug()` flag and `editMode`,
and — since the npm-packaging refactor — by a lazy `import('./authoring')`
boundary: production code imports neither `leva` nor any authoring component.
See the manual section below before changing anything — it records measured
numbers, traps and deliberate decisions that are not recoverable from the
code.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: build-commands -->
## Build & Development Commands

```bash
npm install
npm run dev              # vite dev server (port from $PORT, fallback 5174)
npm run build            # production build (SPA/playground, dist/)
npm run build:lib        # npm package build (dist/lib) — separate Vite mode,
                          # externalizes react/react-dom/three/@react-three/*/leva
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

⚠️ `vite.config.js` reads `--mode lib` to switch build targets from the SAME
config file. `publicDir` is forced to `false` only in lib mode: Vite's
default of copying `public/` into the output would duplicate assets already
declared in package.json's `files` and ship the licensed client fonts inside
the npm tarball.

⚠️ A green build does not verify a removal — see the matching entry in
Detected Patterns below.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Architecture

Vite + React 19 + `@react-three/fiber` 9 / `@react-three/drei` 10 / three
0.178, with `leva` for the debug panels and `maath` for damping. Everything
of substance lives in one component directory.

```
src/
├─ main.jsx, App.jsx                    app entry; App.jsx (playground) passes
│                                       `branding` into KeyboardComposer
└─ components/KeyboardComposer/
   ├─ index.js                          public exports: component, product registry,
   │                                    `createPublicApi`, `isDebug`/`setDebug`
   ├─ KeyboardComposer.jsx              DOM shell, app-mode state, apiRef bridge, creates
   │                                    the store, resolves the `product` prop, decides
   │                                    `authoring` (prop or `isDebug()`) once via a ref
   ├─ Scene.jsx                         <Canvas>; mounts MaterialApplier/LightRig/
   │                                    AnimationDirector/VariantController and, only
   │                                    when `authoring`, the lazy AuthoringScene
   ├─ KeyboardModel.jsx                 GLB load (getDracoPath()/setDracoPath()),
   │                                    auto-fit, useComposerControls host
   ├─ useComposerControls.js            drag/keys/spring/camera/zoom/focus; `rotation`
   │                                    read from the store (useComposerSection + a
   │                                    mirror ref for useFrame)
   ├─ poseGraph.js                      angle primitives + `createPoseGraph` FACTORY
   │                                    (no pose data — that lives per product)
   ├─ products/                         ONE CONFIGURATOR, MANY MODELS
   │  ├─ index.js                       PRODUCTS registry, PRODUCT_IDS enum,
   │  │                                 getProduct/resolveProduct
   │  ├─ productSchema.js               defineProduct/resolveProduct + typedefs;
   │  │                                 `assetsBaseUrl` (prefixes only URLs that start
   │  │                                 with `/`) and `dracoPath` per product
   │  └─ arrayModelL/                   the first product: poseGraph (21 poses),
   │                                    meshGroups, meshVariants, model+config URLs
   ├─ focusFraming.js                   bounding-sphere group framing measure
   ├─ LightRig.jsx                      per-pose light editor; imports no `leva` —
   │                                    reads `store.get('view')`, exposes
   │                                    `resetActiveView` on apiRef
   ├─ AnimationDirector.jsx             single useFrame driving the runtime; renders null
   ├─ VariantController.jsx             ISO/ANSI-style variant visibility
   ├─ Hud.jsx                           optional DOM overlay (telemetry, chips, mode
   │                                    button); `branding` prop (logo/version/footer),
   │                                    no hardcoded lockup; off by default (`hud=false`)
   ├─ authoring/                        THE LAZY BOUNDARY — the only module the rest of
   │  │                                 the component reaches via `import()`, so `leva`
   │  │                                 and every authoring component ship in a chunk
   │  │                                 production never downloads
   │  ├─ index.jsx                       exports `AuthoringDom` (panels, mounted by the
   │  │                                   shell outside the Canvas) and `AuthoringScene`
   │  │                                   (gizmos + mesh editor, mounted by Scene.jsx
   │  │                                   inside it) — same specifier from both call
   │  │                                   sites, ONE chunk for both mount points
   │  ├─ useLevaSection.js                the ONLY Leva↔store bridge: seeds a `useControls`
   │  │                                   folder FROM THE STORE at mount (not from schema
   │  │                                   defaults), writes Leva→store on change, store→Leva
   │  │                                   on hydrate; no anti-echo guard needed (see Patterns).
   │  │                                   `groupId` option selects a per-mesh-group subkey
   │  │                                   (`materials`, `focus`) — the shallow-compare there
   │  │                                   must run BEFORE the write (see Patterns).
   │  │                                   Exports LEVA_MODE_FOLDER/LEVA_MODE_PATH and
   │  │                                   `renderInMode(mode)`, the shared `render` predicate
   │  │                                   for mode-gated folders
   │  ├─ ModeTuner.jsx                    the "⚙️ Editor · Modalità" folder (editMode +
   │  │                                   homePose), writes `store.ui`
   │  ├─ DebugPanel.jsx                   the `<Leva>` root + debug readouts, extracted
   │  │                                   from KeyboardComposer.jsx
   │  ├─ RotationTuner.jsx, ViewSettingsTuner.jsx, MaterialTuner.jsx, FocusTuner.jsx
   │  │                                   one Leva folder each; MaterialTuner/FocusTuner
   │  │                                   render one component instance per group (Patterns)
   │  ├─ LightGizmos.jsx                  TransformControls + useHelper for the two shadow
   │  │                                   lights; moves `keyLightRef`/`spotLightRef` (the
   │  │                                   real lights are rendered by
   │  │                                   runtime/ShadowLights.jsx) without owning them
   │  ├─ MeshController.jsx               mesh/group inspector (TransformControls, halos)
   │  └─ AnimationEditor.jsx (+.module.css) ?debug block editor for animations
   ├─ runtime/                           production code — imports no `leva`, no
   │  │                                  authoring component
   │  ├─ productConfig.js                 fetchProductConfig/applyConfig/normalizeConfig;
   │  │                                   named productConfig (not configLoader) to
   │  │                                   avoid a Windows case-collision with ConfigLoader.jsx
   │  ├─ ConfigLoader.jsx                 renders null, mounted by the SHELL
   │  │                                   (KeyboardComposer.jsx, outside the Canvas) —
   │  │                                   fetches + hydrates the store
   │  ├─ publicApi.js                     `createPublicApi` — the integration surface
   │  │                                   (see Data flow below)
   │  ├─ variantCommands.js               `cycleVariant`/`nextVariantOption`, extracted
   │  │                                   from Hud.jsx (the only place that knew them —
   │  │                                   the HUD is now optional)
   │  ├─ useEscapeToIdle.js               Escape-key exit from `config`, extracted from
   │  │                                   Hud.jsx so it still works with the HUD unmounted
   │  ├─ MaterialApplier.jsx              applies the authored materials — used to be one
   │  │                                   line inside a Leva panel, i.e. production
   │  │                                   materials depended on the editor being mounted
   │  └─ ShadowLights.jsx                 the two shadow lights (key/spot), rendered
   │                                      unconditionally from the store; see LightGizmos
   ├─ state/                            per-instance authored config store
   │  ├─ composerStore.js                createComposerStore; COMPOSER_SECTIONS
   │  │                                  IS the saved-JSON shape/order (nine sections:
   │  │                                  lights, materials, rotation, keylight, spotlight,
   │  │                                  focus, animations, variants, app), + UI_SECTION
   │  │                                  ('ui') and VIEW_SECTION ('view'), both never
   │  │                                  serialized; get/set/replace/hydrate/subscribe
   │  ├─ defaults.js                     every product default in one place (was:
   │  │                                  buried in Leva `value:` fields) + createInitialState
   │  ├─ debug.js                        isDebug()/setDebug(), SSR-safe — now ADOPTED:
   │  │                                  `KeyboardComposer` uses it to decide whether to
   │  │                                  load authoring, and it's re-exported from
   │  │                                  `index.js`. The per-file `DEBUG` literal is still
   │  │                                  the live pattern in KeyboardModel.jsx, LightRig.jsx,
   │  │                                  AnimationDirector.jsx, useComposerControls.js and
   │  │                                  Scene.jsx (onCreated) — not yet switched over.
   │  └─ useComposerSection.js           reactive per-section read (useSyncExternalStore);
   │                                     store.get(section) is the non-reactive twin for useFrame
   ├─ animation/                        schema, runtime, actions, selectors, easings,
   │  │                                 opacityRegistry, pivot, pivotRegistry, transforms
   │  ├─ animationSchema.js               every animation gets a `slug` (slugified label,
   │  │                                   deduped) alongside its id; `findAnimation(items, key)`
   │  │                                   matches id OR slug, id first across every source —
   │  │                                   internal `requires`/`idleAnimation` cite ids, the
   │  │                                   slug is the citable public surface
   │  │                                   (`play('go-to-rotors')`)
   │  └─ animationRuntime.js              emitter (`start`/`finish`/`stop`) with events
   │                                      QUEUED and drained at the end of `tick()` — they
   │                                      originate inside useFrame, and a listener that
   │                                      called back into `play` would re-enter mid-update;
   │                                      exposed as `subscribeAnimation` on apiRef
   └─ materials/                        MACHINERY ONLY (meshGroups, groupMaterials,
                                        meshVariants, warmupTransparency) — the
                                        group/variant LISTS live under products/
public/
├─ models/keyboard.glb                  ARRAY_MODEL_L's GLB (`product.modelUrl`)
├─ draco/                               decoder, passed explicitly to useGLTF
└─ lightconfig/app-state-config.json    ALL authored state of ARRAY_MODEL_L —
                                        the sections are exactly
                                        state/composerStore.js's COMPOSER_SECTIONS
                                        (lights, materials, rotation, keylight,
                                        spotlight, focus, animations, variants, app).
                                        Path comes from `product.configUrl`;
                                        new products default to
                                        /lightconfig/<ID>/app-state-config.json
dist/lib/                              the npm package artifact (`npm run build:lib`),
                                        built from this same source tree, not a
                                        separate project — see Build & Development
                                        Commands
```

Data flow, in two directions:
- **Commands** cross the DOM/Canvas boundary through one imperative ref,
  `apiRef` — a multi-writer bridge written **only** via
  `Object.assign(apiRef.current, {...})`, never reassigned. Five writers
  (VariantController, LightRig, AnimationDirector, Scene, useComposerControls).
- **Data** needs no bridge: `KeyboardComposer.jsx` renders both the Canvas
  subtree and the DOM overlays, so animations, variants and `appMode` travel
  as ordinary props.
- **State lives in one per-instance store, not globals**: `state/composerStore.js`
  replaces what used to be eight `window.__STATE_*` globals + eight
  CustomEvents with one object, created once (via a ref) in
  `KeyboardComposer.jsx` and threaded as a `store` prop through nearly every
  component that reads or writes authored state — Scene, KeyboardModel,
  LightRig, `runtime/MaterialApplier`, `runtime/ShadowLights`,
  AnimationDirector, Hud, useComposerControls, and every `authoring/`
  component. **The migration is complete**: zero `window.__STATE_*`, zero
  `app-load-*` CustomEvents. `handleSaveJSON` reads only from the store.
- **`editMode`/`homePose` live in `store.ui`** (the never-serialized section),
  written only by `authoring/ModeTuner.jsx` and read via
  `useComposerSection(store, 'ui')` — no longer a `Scene.jsx` `useControls`,
  so `controlsDisabled` (production behavior) no longer depends on a debug
  panel being mounted. `Scene.jsx` keeps `homePose` in sync with the loaded
  config via `store.subscribe('app', ...)` rather than a CustomEvent, so a
  config that finishes loading *before* `Scene.jsx` mounts is still picked up.
- **`store.view`** (the other never-serialized section) holds the active
  pose's live light settings, mirrored by `LightRig.jsx` into `lights[pose]`
  on change — it's what the "Resetta Vista" panel button and
  `apiRef.resetActiveView` operate on.
- **Authored values** are not hardcoded defaults — `runtime/ConfigLoader.jsx`
  fetches `product.configUrl` (in production *and* in `?debug`) and hydrates
  the per-instance store via `runtime/productConfig.js`'s `applyConfig`.
  `ConfigLoader` is mounted in the **shell** (`KeyboardComposer.jsx`, outside
  the Canvas) — it used to live inside the Canvas, which was a transitional
  spot, not its final home.
- **Integration surface**: `KeyboardComposer` accepts `onReady`/`apiRef` to
  hand out `runtime/publicApi.js`'s `createPublicApi()` facade, `hud` (default
  `false`) to opt into the built-in DOM overlay, `branding` to customize it,
  `escapeToIdle` (default `true`, independent of the HUD) and `authoring`
  (default follows `isDebug()`) to force the editor open on a custom route.

**One configurator, many models.** Everything model-specific is a `Product`
(`products/productSchema.js`): `modelUrl`, `configUrl`, `poseGraph`,
`meshGroups`, `meshVariants`, plus `assetsBaseUrl` (prefixes root-relative
URLs, for serving assets from a CDN) and `dracoPath`. `KeyboardComposer` takes
one `product` prop (an id from `PRODUCT_IDS`, a defined product, or a raw
definition), resolves it once, and threads the frozen object down the tree.

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
  `new URLSearchParams(window.location.search).has('debug')`. `editMode` used
  to be the opposite (one `useControls` in `Scene.jsx`, threaded down); it now
  lives in `store.ui`, written by `authoring/ModeTuner.jsx` and threaded down
  as a prop like everything else — see Data flow above.
  `state/debug.js` (`isDebug()`/`setDebug()`) centralizes the `DEBUG`
  computation and is SSR-safe; it is now ADOPTED by `KeyboardComposer.jsx`
  (decides whether to load `authoring/`) and re-exported from `index.js`. The
  per-file `URLSearchParams` literal is still the live pattern in
  KeyboardModel.jsx, LightRig.jsx, AnimationDirector.jsx,
  useComposerControls.js and Scene.jsx (`onCreated`) — not yet switched over.
- **A Leva folder's `render` cannot close over an external boolean prop** —
  MEASURED, not assumed. Leva only re-evaluates `render` when a value the
  callback read *through `get`* changes; that's how it registers its
  dependency. A `render` that never calls `get` runs once at mount and never
  again — tried by passing `editMode` as a boolean prop, and the light
  folders simply stopped reappearing when re-entering Luci mode. The fix
  everywhere is `render: renderInMode(mode)` from `authoring/useLevaSection.js`,
  which reads `get(LEVA_MODE_PATH)`. This still applies to every Leva
  `useControls` folder (a `useControls` call itself can't be conditionally
  mounted without losing its seeded values); it no longer has a
  light-specific exception — since the runtime/authoring split, the shadow
  lights render unconditionally from `runtime/ShadowLights.jsx` and their
  gizmo/helper (`authoring/LightGizmos.jsx`'s `LightGizmo`) unmounts freely
  (`if (!on) return null`) because it no longer owns the light it used to
  also render.
- **Store snapshots must keep identity when unchanged**: `composerStore.js`'s
  `set`/`replace` return the exact same object if a shallow compare finds no
  real change (exported as `shallowEqual`, also used by
  `useLevaSection`'s `groupId` path — see Architecture). This isn't an
  optimization — `useComposerSection` is built on `useSyncExternalStore`,
  which compares snapshots by identity and render-loops if it ever receives
  an equal-but-new-identity object.
- **A green build does not verify a removal.** An undefined capitalized JSX
  tag left behind after deleting its import is a runtime `ReferenceError`,
  not a build error — Rollup/Vite won't flag it, and it can reach production
  as a blank screen. Grep for a component's remaining JSX usages after
  removing its import; don't trust the build alone.
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