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
npm run asset:ar         # scripts/make-ar-asset.mjs -> public/ar/keyboard-ar.glb:
                         # the GLB made self-contained for AR — metric scale, the
                         # authored materials baked in, one variant kept
                         # (--scale/--in/--out/--config/--variants layout=ansi)
```

**No test runner and no linter are configured.** Changes are verified by
driving the running app and reading values back out of the scene graph — see
"Verifying changes in the browser" in the manual section for the four
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
│                                       `branding` into KeyboardComposer, and
│                                       mounts the playground-only `<ArButton>`
│                                       (see `ar/` below) as a sibling of it
├─ ar/                                  PLAYGROUND-ONLY "Prova in AR" button —
│  │                                    sibling of `components/KeyboardComposer/`,
│  │                                    not inside it: `npm run build:lib` never
│  │                                    sees it, same reasoning as
│  │                                    `PLAYGROUND_BRANDING` in App.jsx
│  ├─ arSupport.js                       `detectArSupport()` — capability-based
│  │                                     mobile-AR detection (iOS Safari / Android
│  │                                     with touch), not a viewport media query
│  ├─ launchAr.js                        `launchAr()`/`isArReady()` — hands the
│  │                                     model to the platform AR viewer (Quick
│  │                                     Look on iOS via a client-generated USDZ,
│  │                                     Scene Viewer on Android via an intent
│  │                                     URL); renders none of this project's
│  │                                     lighting/materials/variants
│  └─ ArButton.jsx (+.module.css)        idle/preparing/ready/error button, `null`
│                                        on unsupported platforms
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
├─ models/keyboard.glb                  ARRAY_MODEL_L's GLB (`product.modelUrl`),
│                                       authored in MILLIMETERS
├─ ar/keyboard-ar.glb                   the AR playground button's asset, generated
│                                       by `scripts/make-ar-asset.mjs`: metric
│                                       scale + baked materials + one variant, i.e.
│                                       everything the configurator would otherwise
│                                       apply at runtime. Never read by the
│                                       configurator itself
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
scripts/make-ar-asset.mjs              generates public/ar/keyboard-ar.glb (see
                                        `npm run asset:ar`). Three passes, in this
                                        order: variant selection -> material bake
                                        (from configUrl's `materials`) -> metric
                                        scale. IMPORTS meshGroups/meshVariants from
                                        products/ rather than copying them.
                                        ⚠️ Edits only the GLB's JSON chunk — scale,
                                        materials and hierarchy are all JSON — so the
                                        Draco-compressed binary chunk passes through
                                        byte for byte
```

Data flow, in two directions:
- **Commands** cross the DOM/Canvas boundary through one imperative ref,
  `apiRef` — a multi-writer bridge written **only** via
  `Object.assign(apiRef.current, {...})`, never reassigned. **Six writing
  files, seven call sites**: VariantController, LightRig, AnimationDirector,
  Scene, useComposerControls, and KeyboardComposer.jsx itself twice (app mode,
  then the variant commands).
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

**`src/ar/` is a separate, playground-only feature**, not part of the
configurator or the npm package — see the `ar/` entry in the tree above and
"AR playground feature" in the Manual notes for the mm-vs-m unit trap, the
material bake and the GLB-surgery technique behind `scripts/make-ar-asset.mjs`.
⚠️ That script is currently **single-product**: it imports ARRAY_MODEL_L's
groups/variants by name and defaults to its config path, so a second product
wanting AR needs it parameterized by `product` — one more line in the "adding a
model" list above, and the only place outside `products/` that still names one.
`vite.config.js`'s
production-build `manualChunks` carves `USDZExporter` into its own `'ar'`
chunk **before** the existing three/@react-three rule, so it isn't dragged
into the synchronous `three` chunk that every visitor downloads.

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

# Manual notes

Everything below is hand-written and must not be regenerated. It records
**measured numbers, traps already hit, and deliberate decisions** — the things
that cost real time to re-derive and that are not recoverable by reading the
code. Structural facts (what a file is, where state lives) belong in the
auto-managed sections above; this section is for *why* and *how much*.

Long block comments at the top of individual modules carry the per-file
argument (`warmupTransparency.js` and `composerStore.js` are the two densest).
This section holds what spans files or exists nowhere else.

## Verifying changes in the browser

With no test suite, regressions are caught by driving the running app and
reading numbers back out of the scene graph. Four things cost real time to
re-derive, so they are written down.

**Don't fingerprint the rig by hashing damped values.** The obvious regression
check — dump every light's intensity/position before and after a change and
compare — **does not work**: `maath/easing`'s damping is asymptotic and the
first frame's delta varies per run, so two runs of *identical* code produce
different dumps (observed: 5053 vs 5242 chars). Either pump to convergence
(below — ~25 s of virtual time brings the error to exactly `0`), or better,
assert against the source of truth: that the *i*-th point light in traversal
order carries the intensity of key `` `${prefix}_${i}` `` from the config JSON.
That checks the binding rather than a transient.

**Don't time frames to verify a shader-compilation fix — count programs.**
Chrome caches linked GL program binaries on disk, so on a machine that has
opened this app before, the compile still happens and the frame trace shows
nothing: measured, the first and second play of `GoToRotors` were
indistinguishable (median 21.5 vs 23.1 ms, no frame over 100 ms) *both before
and after* the fix. The honest metric is

```js
window.__r3f_state.gl.info.programs.length   // before and after the first play
```

which reads 0 new programs when the warm-up is right and 2 when it isn't. To
learn what a compile actually costs on the machine under test, force a cache
key that has never existed — clone a group material, set `sheen = 0.5`, assign
it to a mesh, time one `gl.render`. Measured on this asset: **192 ms against a
0.4 ms normal frame** (~1000 ms for the very first, which also pays the driver
compiler's start-up). Per-material state is reachable via
`gl.properties.get(material).programs.size`. See
`materials/warmupTransparency.js` for the full argument — it is the one place
that already solves this.

**A hidden or occluded tab breaks the app, not your change.**
`requestAnimationFrame` is frozen in a background tab, so R3F never measures
the container (the canvas stays stuck at the default `300×150`,
`window.__r3f_state` is never set) and `useFrame` never runs — the HUD reads
`FPS 0.00` and rAF-based promises in injected scripts hang until the tool times
out. Bring the browser window genuinely to the foreground before testing; a
window-resize call on an occluded window is not enough.

**Pump frames manually when you must.** `Scene.jsx`'s `onCreated` publishes
`window.__r3f_state` under `?debug`; `state.advance(timestamp)` runs one frame
on demand, which fast-forwards damping without waiting in real time:

```js
const st = window.__r3f_state
const pump = (sec) => { let t = performance.now(); for (let i = 0; i < sec*1000/16; i++) { t += 16; st.advance(t) } }
window.__setPose(35.264389682754654, 45)   // TL — see the product's POSE_COORD
pump(25)                                    // damping to convergence
```

Other `?debug`-only console handles, all installed next to the code they drive:
`window.__setPose(pitchDeg, yawDeg)` (hard teleport — bypasses both the spring
*and* the pose lock; console-only, not reachable from any UI),
`window.__abortComposerDrag()` (cancels an in-progress drag — called by the
`TransformControls` gizmos in `authoring/MeshController.jsx` and
`authoring/LightGizmos.jsx` on `onMouseDown`, so dragging a gizmo doesn't also
rotate the model), `window.__focusGroup(id)` / `window.__clearFocus()`, and
`window.__playAnimation(id, opts)` (`AnimationDirector.jsx`).

Since the store refactor there is no longer a reason to reproduce the
production config by hand: `runtime/ConfigLoader.jsx` fetches
`product.configUrl` in `?debug` too, so the authoring session already runs on
the shipped values. `apiRef.current.loadConfigJSON()` (the "Carica JSON" button,
published by `LightRig.jsx`) is still the way to try a *different* file.

## Measured numbers worth not re-deriving

| Number | Where | Why it is what it is |
| --- | --- | --- |
| **264 draw calls** | the GLB | The asset pipeline forbids `join`/`optimize`, so the mesh count is permanent. Every extra *geometry* pass re-pays all 264 |
| **~34 forward lights** | `LightRig.jsx` | 26 point (9 `top` + 8 `mid` + 9 `bot`) + 6 `rectAreaLight` (LTC, not cheap) + directional + spot. Every fragment evaluates all of them |
| **192 ms vs 0.4 ms** | shader compile vs normal frame | The cost of one `transparent` cache-key flip; the whole reason `warmupTransparency.js` exists |
| **`RADIUS_MIN = 0.8`** | `useComposerControls.js` | Lowered from 2.5 for the group focus. With a 200 mm lens `baseRadius` is ~36 scene units and a small group frames at ~1.7–3.5 — the old floor was an invisible ceiling on the product zoom |
| **`FIT_RADIUS_MIN = 5.2`** | `useComposerControls.js` | Floor of the **whole-model fit only**. ⚠️ Never apply it to the focus path |
| **`KEY_DEBOUNCE_MS = 300`** | `useComposerControls.js` | Blocks rapid re-presses from stacking steps and velocity ("spinning"). Native key-repeat is filtered separately (`e.repeat` + a `heldKeys` Set) |
| **`AXIS_DEADZONE = 6`** px | `useComposerControls.js` | Distance before a drag commits to one dominant axis for the rest of the gesture |
| **`BOX_REFRESH_FRAMES = 4`** | `LightRig.jsx` | `Box3` over the whole scene graph is not a per-frame operation; the sampled result is damped, so the sampling rate stays invisible |
| **`commitFraction = 0.2`** | `state/defaults.js` | Fraction of a step's travel past which a released drag commits instead of springing back |
| **`focusDamp` / `focusOutDamp` = 0.6** | `state/defaults.js` | Separate times in and out. The zoom-out closes every animation and at the entry speed it reads as hurried. Equal by default, so behavior is unchanged until one is tuned |

## Invariants that span files

**The camera distance is a product of three refs, never a written value.**
`cameraRadius = clamp(baseRadius × userZoom × focusZoom, RADIUS_MIN,
RADIUS_MAX)`, recomposed by the local `applyRadius()`. Each factor has exactly
one owner: `baseRadius` belongs to the fit paths, `userZoom` solely to
`onWheel`, `focusZoom` solely to the focus path. That split *is* the mechanism
behind "zoom survives every view/mode/selection change" — a fit recompute
rewrites the base and re-multiplies the others on top. Before this, `onWheel`
wrote `cameraRadius` itself and the next fit silently overwrote it. **If you add
a fourth writer, give it a ref of its own and fold it into `applyRadius()`.**

**The wheel is authoring-only.** `onWheel` is registered **only under `?debug`**
— not early-returned, *not registered*: with `{ passive: false }` +
`preventDefault()` an early return would still eat the host page's scroll. In
production the only zoom that exists is `focus(groupId)`. Inside `?debug` the
handler deliberately ignores `disabledRef`, so it stays live in every
`editMode`.

**Group focus is two motions, not one.** Getting closer alone would push an
off-axis group (rotors to one side, `landing` underneath) out of frame as the
camera approaches, so the orbit pivot moves to the group's world-space center
*and* `focusZoom` shrinks the radius. `PIVOT_Y` is therefore no longer a literal
`camera.position.y += PIVOT_Y`; it is the default value of the
`pivotCur`/`pivotTarget` refs, and the frame ends with
`camera.position.add(pivotCur.current)` — bit-identical to the old behavior
when no focus is active.

**`focusZoom` is a factor, not an absolute radius, and that is load-bearing.**
The distance framing an object of half-extent *R* over the distance framing one
of `FIT_HALF_WIDTH` is `R / FIT_HALF_WIDTH` **regardless of fov, aspect,
`fitMargin` and `zoomOutMobile`** — every camera term cancels. So a resize
rewrites `baseRadius` and the focus stays exactly as framed, with no
reconciliation code.

**Focus framing is a bounding *sphere*, deliberately.**
`focusFraming.js`'s `measureGroupFraming` returns the group's world center and
the half-diagonal of its bounding box — *not* the extent projected onto the
camera axes. Consequence: the framing is **pose-independent**, so orbiting while
focused needs no recompute and never clips from any angle. The price is a
generous framing — a group whose bounding sphere approaches the model's own
barely zooms at all. That is what the authored `radiusFactor` is for; it is not
a bug to "fix" by switching to projected extents. The measurement is
**edge-triggered** (entering focus, changing group, changing authored values),
never per-frame: it is a full scene traverse, and it skips `__editorHelper`
meshes for the same reason `collectMeshGroups` and `LightRig`'s box do.

**Step amplitude is compensated, not just scaled.** `stepAmp()` scales a step
relative to a 45° reference so a 90° corner transition dilates time
(`stepDt = dt / amp`) *and* compensates damping (a `Math.log(amp)` term), which
is what keeps the same angular velocity and the same **absolute-degree**
overshoot instead of visibly differing between step sizes.

**The portrait yaw offset is frozen in a ref**, derived once from the entry
pose — never recomputed from live viewport size. A resize would otherwise shift
the frame out from under the current pose and silently break `stepTo`.

**The grid prefix plus the index ARE the config JSON keys** (`top_0_intensity`,
`mid_3_color`, `bot_7_decay`, …). Never rename a prefix and never reorder the
loops in `gridLayers` that generate the grid: it would silently remap every
saved configuration onto different lights — invisible in review, obvious only on
the rendered product.

**The adaptive light box stretches, it does not translate.** Every face and
every light is anchored to *its own* extent of the box measured on the live
GLTF scene, so raising a mesh by `m` raises the top plane by `m` while the
bottom stays put, and each face keeps its own `margin` from the surface in front
of it.

**Group focus and the mesh editor must never be live at once.**
`focusGroup()` no-ops while `editMode === 'meshes'` and an effect clears an
active focus on entering that mode: there the pose is locked and the geometry
can be moved by the editor, so a stale center would frame nothing. Same reason
the animation surfaces disable themselves in that mode — `MeshController`'s
pivots and the animation registry's pivots must never hold the same meshes.

**The dynamic fit is expand-only, and `scene` is already scaled when it runs.**
The expand-only fit (active in Lights mode on the home pose) exists to keep a
model *deformed* by the editor from being clipped, not to reframe the pristine
model — which is what used to make every entry into Lights mode snap the camera
and wipe the user's zoom. ⚠️ By the time it runs, `scene` is already a child of
`<group scale={scale}>`, so `Box3().setFromObject(scene)` already returns
world-space size; multiplying by `scale` again double-scales and collapses the
fit to nearly zero. That was a real bug, hit and fixed — don't reintroduce it.
(`KeyboardModel.jsx`'s own one-time auto-fit `useMemo` is the opposite case: it
measures `scene` *before* insertion, i.e. genuinely unscaled.)

## AR playground feature ("Prova in AR")

`src/ar/` (arSupport.js, launchAr.js, ArButton.jsx) is playground-only, same
boundary as `PLAYGROUND_BRANDING` in App.jsx — `npm run build:lib` never sees
it. It renders nothing on desktop; on iOS Safari / Android it hands the model
to the platform's own AR viewer (Quick Look / Scene Viewer). Nothing of this
project's *runtime* survives that handoff — no 34-light rig, no
`MaterialApplier`, no `VariantController` — so anything the product needs to
look right has to be **baked into the asset** by `scripts/make-ar-asset.mjs`.
That script fixes three separate things the raw GLB gets wrong (units,
materials, variants), in that order for the reasons below. The one thing that
genuinely cannot be baked is the lighting: in AR the light IS the real room.

**The production GLB is authored in millimeters, not meters.** Measured
bounding box: 332.5 × 42.7 × 148.8. The configurator never notices —
`KeyboardModel.jsx` auto-fits to `TARGET_WIDTH` regardless of source units —
but glTF units ARE meters by spec, and neither ARKit nor ARCore auto-fits:
untouched, the keyboard would appear 332 METERS wide. `scripts/make-ar-asset.mjs`
writes a SEPARATE `public/ar/keyboard-ar.glb` wrapping the existing scene roots
in one new `__AR_METRIC_ROOT` node scaled ×0.001 — a second file, not an
in-place rescale of `keyboard.glb`, because authored offsets (mesh-editor
offsets, animation `transformOffset`) are expressed in the production asset's
own units and would silently shift under a rescale.

**The rescale touches only the GLB's JSON chunk, never the binary one.** The
model is Draco-compressed, so decoding to rescale geometry and re-encoding
would cost quality and CPU just to multiply some numbers; adding one root node
with a `scale` is equivalent and free, and the binary chunk is copied
byte-for-byte. GLB chunk padding is spec-mandated (4-byte aligned; JSON padded
with ASCII spaces `0x20`, binary with zero bytes) — the wrong pad byte and a
strict parser rejects the file. The script guards its own idempotency: it
throws if a `__AR_METRIC_ROOT` node already exists in the input, rather than
double-scaling on a re-run.

**The GLB has no materials worth losing — measured, and it changes the texture
plan.** Its five materials are byte-identical (`baseColorFactor
[0.5,0.5,0.5,1]`, `metallicFactor 0`, no `roughnessFactor` → defaults to 1),
carry no textures, and are named after Maya shading groups that survived
export (`initialShadingGroup`, `standardSurfaceNSG`). Everything that makes
the product look like a product is the nine per-group entries in
`app-state-config.json`'s `materials`, applied at runtime to clones by
`runtime/MaterialApplier.jsx`. ⚠️ **The GLB's materials cut ACROSS the logical
groups** — `initialShadingGroup` alone covers keycaps, body, patchesISO and
patchesANSI, which the config paints black / grey metal / red / blue.
Consequence for the incoming textured asset: **textures alone will not fix
AR.** A texture bound to that one material paints all four groups the same.
The textured GLB has to arrive with a material (and UV) split that follows the
nine groups — worth settling with whoever exports it *before* delivery, not
after.

**The material bake, and its three traps.** `make-ar-asset.mjs` writes the nine
authored materials into the JSON chunk (`baseColorFactor` / `roughnessFactor` /
`metallicFactor` + `KHR_materials_clearcoat`) and reassigns every primitive.
(1) ⚠️ **sRGB → linear**: config colours are hex that three reads as sRGB,
while `baseColorFactor` is linear — writing them through unconverted yields
visibly washed-out colour, and it is invisible on inspection because the number
is *there*, just in the wrong space (`#797979` must land as `0.1912`, not
`0.4745`). (2) `KHR_materials_clearcoat` goes in `extensionsUsed` and **never**
`extensionsRequired`: a viewer that doesn't know it must fall back to base PBR,
not reject the file. (3) `envMapIntensity` has no glTF or USD equivalent — it's
a three.js concept — so the AR result can never match the configurator exactly;
that gap is expected, not a bug to chase.

**The group/variant lists are IMPORTED by the script, not copied.** It pulls
`ARRAY_MODEL_L_MESH_GROUPS` / `_MESH_VARIANTS` straight from `products/`
(both are dependency-free data modules, so Node can import them as-is) and
replicates `collectMeshGroups`'s rule exactly: first group whose `nameToken`
appears in the node name, else the `fallback` bucket. ⚠️ **Array order is
load-bearing here too** — `patchesISO` must precede `body`, or `S05_L_ISO`
classifies as body because it also contains `S0`. Two diverging copies would
give an AR asset coloured differently from the configurator, noticed only by
whoever is holding the phone. ⚠️ And classification **never fails loudly**: an
unmatched token silently falls into the bucket, and an asset where everything
landed in `body` is uniformly grey exactly like an unbaked one. That is why the
script prints a per-group mesh table — currently `keycaps 80 · body 8 ·
damping 5 · viti 4 · rotors 2 · patchesISO 2 · tasselli 1 · landing 1` = 103
reachable mesh nodes. Read it after any asset change.

**Baking one variant is correctness, not a feature.** As `meshVariants.js`
says, all four `S05_{L,R}_{ISO,ANSI}` meshes exist in the GLB and interpenetrate
unless a selection is applied; in the configurator `VariantController` does that
at runtime, and in AR there is no runtime. The script keeps `defaultOption`
(`--variants layout=ansi` to override) and **detaches** the losing nodes from
their parents rather than removing them from `gltf.nodes`: compacting the array
would mean renumbering every reference in the file (children, scenes, skins,
animations) to save a few dozen bytes. Orphaned nodes are drawn by no loader —
but they must be excluded from the material pass, which is the entire reason
`reachableNodes()` exists and why the order is **variants → materials → scale**
(materials before the variant drop would paint geometry that's about to go;
the metric root node added last must not land in the group counts).

**Why not `@google/model-viewer`.** Its 4.x releases pin `three` via an npm
`^0.x` peer caret (`^0.172`/`^0.182`/`^0.183`), none satisfiable by this
project's `three@0.178` without `--legacy-peer-deps` — i.e. exactly the
two-copies-of-`three` problem `EXTERNAL` in `vite.config.js` exists to prevent
(see Architecture). `launchAr.js`'s hand-rolled code is the part of
model-viewer actually needed and adds zero dependencies: the Scene Viewer
intent is ten lines, and `USDZExporter` already ships inside `three@0.178`.

**`USDZExporter` must be carved out of the production `three` chunk, measured
not assumed.** It lives under `node_modules/three`, so without a rule ahead of
the existing `id.includes('node_modules/three') → 'three'` check in
`vite.config.js`, it gets baked into the synchronous `three` chunk and the
`import()` in `launchAr.js` becomes decorative. How it was caught, and the
check worth repeating after any chunking change: grep the built chunks for
exporter-internal strings (`usdaHeader`, `xformOp:transform`). Before the
`id.includes('exporters/USDZExporter') → 'ar'` rule those matched **13 lines
in `three-*.js` and 0 in any async chunk** — i.e. the exporter shipped to
every visitor, desktop included. After it: 0 in `three`, 6 in a separate
`ar-*.js` (11 kB / 3.7 kB gzip), and the `three` chunk 11 kB lighter.
⚠️ Chunk-name greps alone prove nothing here — the module has no unique
filename in the output. `GLTFLoader`/`DRACOLoader` are deliberately left alone:
`useGLTF` already imports them eagerly, so splitting them out would only add a
request.

**Quick Look has two undocumented DOM requirements, both hit and worked
around.** It opens only from an `<a rel="ar">` whose ONLY child is an `<img>`
(an inline transparent 1×1 GIF here) — without the img the link downloads
instead of opening AR — and the USDZ must be handed over as a `File`, not a
`Blob`: Quick Look identifies the format from the file EXTENSION, which a Blob
object URL doesn't carry. Object URLs are never revoked within the session —
Quick Look reads the file only after Safari has already navigated away from
the page, so revoking it pulls the model out from under the viewer; the
accepted cost is a few MB living as long as the tab.

**Scene Viewer (Android) downloads the model itself, as a separate app** — the
URL must be absolute and reachable from the phone's network. `localhost` never
works in dev (it resolves inside the viewer app, not the dev server); use the
dev machine's LAN IP or a real deploy.

## Known strains

These are accepted costs of the current design, not bugs waiting to be filed.

- **Every "done" is a policy, not a fact.** Half the animation steps end when a
  physics predicate happens to converge, so the same animation genuinely takes
  different wall-clock time on different machines, at different `focusDamp`
  values, and after a user drag lands mid-step. Fine for a configurator; not
  fine if anything ever has to sync to audio or scroll.
- **`focusDamp` and `timeScale` interact.** The first silently changes how long
  every `wait: 'settle'` focus step blocks; the second scales the pose spring
  but *not* the focus damping (deliberately), so settle-based and
  duration-based steps drift relative to each other when it changes.
- **No scrubbing.** "What does it look like 2.3 s in" means replaying from the
  top; `playAnimation(id, { fromWave: n })` softens it, but the state at wave
  *n* depends on all prior side effects. This is the real ergonomic cost of a
  sequencer over a timeline, and it is felt while authoring, not in production.
- **Not reversible by construction.** A timeline plays backwards for free; a
  sequencer does not. The way back is either `stopAnimation()`'s teardown or
  hand-authored inverse steps — which is why `stop()` must stay exhaustive and
  the restore-not-bake unwind of the registries is not negotiable. That teardown
  eases rather than snapping, but it is still a **return to rest, not a
  rewind**: it interpolates straight from wherever the scene is to the snapshot,
  ignoring the path the animation took to get there.
- **`measureModelBox` will see the spinning rotors.** It re-measures every
  `BOX_REFRESH_FRAMES` and damps the result, so a group whose AABB changes shape
  as it rotates can make the adaptive light box slowly breathe. If it turns out
  to matter, the skip flag belongs on **spin only** — a `transformOffset`
  *should* stretch the box, that is the point of it.
- **A partial-subset opacity fade clones N materials** and flips `transparent`.
  The compile is pre-warmed and the warm-up covers the clones (they share the
  originals' cache key), but the *cloning* itself is still per-acquire work. The
  fast path avoids it for whole-group selections, the common case.

## Planned work: anti-aliasing and contact shadows

⚠️ **Nothing in this section exists in the code.** It is a design record for a
discussed-but-unbuilt feature — don't go looking for an `EffectComposer`, an AO
pass or a quality-LOD state machine, and don't treat their absence as a
regression. Most of the reasoning is specific to this scene's cost profile and
is *not* the answer a generic three.js guide gives.

### The cost profile that drives every choice

The two bottlenecks in the table above (264 draw calls, ~34 forward lights)
exist before any effect is added, and they push in the same direction. The cheap
axis is **screen-space**: a full-screen pass is geometry-independent, and at
half resolution it costs a fraction of the main 34-light pass. Hence the rule:
**prefer screen-space effects over extra geometry passes, and never increase the
pixel count.** Raising DPR or brute-force SSAA scales the already-worst axis; a
depth prepass doubles the other one.

The second structural fact: **the scene is static most of the time.** The camera
only moves during the spring settle and the model never rotates. There is no
reason to pay per-frame for quality that only matters once the image settles.

### Anti-aliasing

The dominant aliasing source here is **not** geometric edges — it is **specular
aliasing**: sub-pixel highlights flickering on rounded keycap edges, driven by
clearcoat + satin metal + 34 light sources. That is a *shading-rate* problem,
not a *coverage* problem, so **MSAA does not fix it** (MSAA multiplies coverage
samples, not shader evaluations), and SMAA barely helps (it post-processes an
image in which the specular is already wrong). Only supersampling — too
expensive on the fragment axis — or **temporal accumulation** addresses it.

Hence a two-tier scheme tied to motion state:

| State | Technique | Cost |
| --- | --- | --- |
| Moving (drag, spring, running animation) | MSAA 4× on the render target + SMAA | ≈ today's |
| At rest (spring settled, no input) | Progressive accumulation: sub-pixel Halton jitter on the projection matrix, averaged into an HDR buffer at weight `1/n` over ~16–32 frames, then **stop rendering** | Zero at steady state |

Conceptually `TAARenderPass`/`SSAARenderPass` in progressive mode. The key
property for the stated requirement ("no stuttering"): during motion the cost is
exactly what it is today, and the extra work happens only when idle. **It cannot
introduce stutter into navigation by construction.**

⚠️ **MSAA on the default framebuffer is lost the moment you render through a
composer.** A multisampled render target must be requested explicitly (in
pmndrs `postprocessing`, the `multisampling` prop on `EffectComposer`), or the
first effect added makes the image *worse*, not better.

### Contact shadows (between meshes)

Terminology selects the technique here:

- drei's `<ContactShadows>` is a **ground** shadow — a blurred shadow map
  projected onto a plane below the model. It produces no darkening *between*
  meshes and is not what this feature means.
- What is wanted — keycap against plate, tasselli in their sockets, rotors in
  the body — is **ambient occlusion**, optionally plus directional contact
  hardening from the key light.

The reason none of this exists is structural, not an oversight: **31 of the 34
lights physically cannot cast shadows.** `rectAreaLight` has no shadow support
in three.js at all, and point lights only shadow via cube maps — 6 scene renders
*per light*, i.e. 26 × 6 × 264 draw calls, which is not a tradeoff to evaluate
but a non-starter. The only real shadow is the directional's. **The volumetric
rig therefore behaves as ambient light that never occludes anything** — AO is
not a polish item here, it is what stands in for the rig's missing occlusion.

Two separate contributions:

1. **Half-resolution screen-space AO** (GTAO/N8AO class) with a depth-guided
   bilateral upsample. It responds to any transform, so it keeps working under
   the mesh editor and under a running animation. Use an implementation that can
   **reconstruct normals from depth** — that removes the normal prepass, i.e.
   264 draw calls, worth the marginal quality loss on this cost profile.
   Physically AO should modulate only indirect light, but here the 32
   non-shadowing lights *already are* a stand-in for indirect, so multiplying
   the final color is defensible in this scene specifically.
2. **Freeze the directional light's shadow map.** The camera orbits, the model
   never rotates, the key light is fixed — **the shadow map is identical frame
   after frame.** Rendering it once (`shadow.autoUpdate = false`,
   `shadow.needsUpdate = true` on demand) and regenerating it only when the mesh
   editor moves something returns 264 draw calls per frame. Likely the single
   largest win in this list, and it lands *before* any effect is added. The
   recovered headroom is what pays for a contact-hardening (PCSS-style) filter
   on that one light.

**Baked AO** is the zero-runtime-cost option and the obvious choice for a static
product shot, but it breaks exactly where this project is heading: if "explode"
becomes an authored animation, AO baked between parts stays painted on the
surfaces as they separate. Per-mesh *self*-occlusion stays valid regardless. A
sensible hybrid is baked self-AO plus screen-space inter-mesh AO — but only if
measurement shows screen-space alone is insufficient. Don't assume it up front.

### The mechanism that unifies both

A **render-quality LOD driven by a "scene is at rest" signal**, which
`useComposerControls.js` largely already has (it knows whether the spring is
settled, whether a drag is active, whether an arrow was pressed):

```
moving    -> MSAA + SMAA, low-sample half-res AO (or AO frozen from the last settled frame)
at rest   -> progressive accumulation for N frames -> stop
any input -> invalidate, drop back to the base tier
```

The elegant coupling: **accumulation makes everything else cheaper.** If the
final image is the mean of 32 jittered frames, the AO can run at a low, noisy
sample count and the noise averages out — you pay for a dirty AO that converges,
not a clean one every frame.

Three invalidation sources that are not obvious and would bite:

- **`LightRig` is never truly "at rest".** Intensities damp asymptotically
  toward their targets and the adaptive box re-measures every
  `BOX_REFRESH_FRAMES`. Accumulating while the damping is still converging
  averages genuinely different images and yields a dirty result. A convergence
  threshold on the damping is needed, not just the camera spring's signal.
- **A running animation is never at rest**, and not only while the camera moves:
  a `spinGroup` step keeps rotating geometry forever and a `setOpacity` fade
  changes shading without moving the camera at all. The "at rest" signal must
  consult `apiRef.current.animationState()`, not just the pose spring.
- **In `?debug`**, gizmo drags must invalidate like a normal drag.

### Codebase-specific traps

- **Tone mapping has to move.** ACES currently sits on the renderer
  (`Scene.jsx`'s `gl={{ toneMapping, toneMappingExposure }}`). With a composer it
  must become the second-to-last effect and be disabled on the renderer, or AO
  gets applied to already-tone-mapped values and AA blends in display space.
  Correct order: scene in linear HDR → AO → accumulate → tone map → SMAA last,
  on LDR.
- **`__editorHelper` meshes must be excluded from depth passes.** The selection
  halos are slightly inflated shells; in the depth buffer they would generate an
  AO halo around every selected object. Same class of bug already handled in
  `collectMeshGroups`, the light box measure and the animation system's
  `opacityRegistry`/`resolveSelector` — same tag, one more site to cover.
- **Shader recompilation is real stutter.** With 34 lights the permutation count
  is large and a mid-interaction compile is visible. The rig already does the
  right thing by animating light *intensities* and never light *counts* — that
  invariant must hold. ⚠️ A targeted solution already exists and is **not**
  planned work: `materials/warmupTransparency.js`. Any effect added here
  multiplies the permutation count again, so **extend that warm-up rather than
  writing a second one** — and read its argument for why it uses a real
  `gl.render` instead of `compileAsync`.
- **Don't reallocate render targets on resize** without debouncing, or window
  resizing becomes a microfreeze.

### Suggested implementation order

1. **Freeze the shadow map.** No new effect, pure headroom. Everything else is
   measured from there.
2. **Measure whether the app is CPU- or fragment-bound.** The ratio decides
   whether half-res AO is nearly free, and it cannot be derived on paper.
3. **Composer with MSAA + relocated tone mapping + SMAA.** Checkpoint: verify
   the image is *identical* to today before adding any effect — the only moment
   a color-space mistake is still easy to isolate.
4. **Half-res AO** with depth-reconstructed normals.
5. **Progressive accumulation at rest**, last: biggest quality jump, and the
   piece needing the most accurate invalidation signal.

What not to do: raise DPR or add a depth prepass "since it's cheap". With 34
lights the first doubles the fragment axis; with 264 draw calls the second
doubles the CPU one. Those are the two moves this scene's profile punishes
hardest.

<!-- END MANUAL -->