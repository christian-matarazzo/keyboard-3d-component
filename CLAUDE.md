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
   │                                    ShadowFreeze/AnimationDirector/VariantController,
   │                                    `runtime/postfx/PostFx` (gated on the `postfx`
   │                                    prop, frozen into a ref at mount) and, only
   │                                    when `authoring`, the lazy AuthoringScene
   ├─ KeyboardModel.jsx                 GLB load (getDracoPath()/setDracoPath()),
   │                                    auto-fit, useComposerControls host
   ├─ useComposerControls.js            drag/keys/spring/camera/zoom/focus; `rotation`
   │                                    read from the store (useComposerSection + a
   │                                    mirror ref for useFrame); publishes
   │                                    `apiRef.focusZoomFactor()` (the animated focus-zoom
   │                                    factor, a number not a boolean — a focus can zoom
   │                                    OUT) that `runtime/postfx/PostFx.jsx` reads as its
   │                                    dynamic-resolution-scale signal
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
   │                                    `resetActiveView` on apiRef. Also owns
   │                                    `handleSaveJSON`/`handleLoadJSON` (published as
   │                                    `saveConfigJSON`/`loadConfigJSON`): the save is
   │                                    `store.toJSON()`, never a hand-written section
   │                                    list — see the ⚠️ there and Detected Patterns
   ├─ AnimationDirector.jsx             single useFrame driving the runtime; renders null
   ├─ VariantController.jsx             ISO/ANSI-style variant visibility; also calls
   │                                    `apiRef.invalidateShadows()` after every toggle
   │                                    (frozen shadow maps would otherwise keep
   │                                    casting the outgoing variant's shadow)
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
   │  │                                   homePose), writes `store.ui`. Six modes:
   │  │                                   none/lights/**render**/meshes/anim/focus —
   │  │                                   `render` ("Resa") is the one that gates folders
   │  │                                   with no 3D surface of their own (materials,
   │  │                                   rotation, post-processing), which used to be
   │  │                                   visible in every mode
   │  ├─ DebugPanel.jsx                   the `<Leva>` root + debug readouts, extracted
   │  │                                   from KeyboardComposer.jsx
   │  ├─ RotationTuner.jsx, ViewSettingsTuner.jsx, PostFxTuner.jsx, MaterialTuner.jsx,
   │  │  FocusTuner.jsx                   one Leva folder each (PostFxTuner tunes the
   │  │                                   `postfx` section's hot values — MSAA samples,
   │  │                                   pixel-ratio cap, dynamicScale/dynamicScaleMin,
   │  │                                   AO radius/intensity/thickness/
   │  │                                   distance-exponent/samples — deliberately NOT
   │  │                                   the postfx on/off switch, see
   │  │                                   runtime/postfx/PostFx.jsx); MaterialTuner/
   │  │                                   FocusTuner render one component instance per
   │  │                                   group (Patterns)
   │  ├─ LightGizmos.jsx                  TransformControls + useHelper for the two shadow
   │  │                                   lights; moves `keyLightRef`/`spotLightRef` (the
   │  │                                   real lights are rendered by
   │  │                                   runtime/ShadowLights.jsx) without owning them
   │  ├─ MeshController.jsx               mesh/group inspector (TransformControls, halos)
   │  └─ AnimationEditor.jsx (+.module.css) ?debug block editor for animations. Four
   │                                       things it owns that the markup doesn't show:
   │                                       an UNDO/REDO history (every write goes through
   │                                       `commitAll`, writes to the same field coalesce
   │                                       within 700 ms, Ctrl+Z is ignored while a text
   │                                       field has focus), an INSERTION POINT (a block's
   │                                       ⌖ decides where new/pasted steps land),
   │                                       `stepIssues` — the diagnosis of steps that
   │                                       would raise no runtime error and do nothing
   │                                       (an empty selector resolves zero meshes,
   │                                       silently) — and a per-sequence duration
   │                                       estimate (`stepDuration`/`waveDuration`)
   │                                       rendered as "durata ≥ 4.2 s · 3 attese", not a
   │                                       single number: a `wait: 'settle'` step's duration
   │                                       depends on a physics predicate converging (see
   │                                       "ogni `done` è una policy, non un fatto" in
   │                                       Known strains), so the count of unpredictable
   │                                       waves is shown alongside the guaranteed minimum
   │                                       instead of averaging over a lie.
   │                                       The four sections above the step list fold
   │                                       (`Section`, collapsed by default — they are set
   │                                       once per animation while the steps are worked
   │                                       continuously). ⚠️ A folded section AUTO-OPENS
   │                                       and flags a ⚠ when it holds a warning
   │                                       (`sectionIssues`): those warnings describe
   │                                       configurations that raise no runtime error —
   │                                       a `requires` on a forever-loop never unlocks —
   │                                       so hiding one behind a default-closed fold
   │                                       would be a regression, not a tidy-up
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
   │  ├─ ShadowLights.jsx                 the two shadow lights (key/spot), rendered
   │  │                                  unconditionally from the store; see LightGizmos
   │  ├─ ShadowFreeze.jsx                 `shadow.autoUpdate = false` on both shadow
   │  │                                  lights, one useFrame, renders null. The model
   │  │                                  never rotates (only the camera orbits), so a
   │  │                                  frozen shadow map is pixel-identical to a
   │  │                                  redrawn one; regenerates (frame-counted budget,
   │  │                                  not a boolean) on a running animation/
   │  │                                  `editMode==='meshes'`, a `keylight`/`spotlight`/
   │  │                                  `materials` store change, or
   │  │                                  `apiRef.invalidateShadows(frames)` — the entry
   │  │                                  point VariantController calls after toggling
   │  │                                  mesh visibility
   │  └─ postfx/PostFx.jsx                MSAA render-target composer (`EffectComposer`/
   │                                      `RenderPass`/`OutputPass`/`GTAOPass` from
   │                                      `three/examples/jsm/postprocessing`, not
   │                                      `@react-three/postprocessing` — same
   │                                      two-copies-of-three reasoning that ruled out
   │                                      `@google/model-viewer` for AR). Owns the app's
   │                                      only positive-priority `useFrame`, so it
   │                                      renders last; publishes
   │                                      `apiRef.postfxTarget()` so
   │                                      `materials/warmupTransparency.js` warms up
   │                                      shaders against the SAME target production
   │                                      draws to (toneMapping/outputColorSpace are
   │                                      shader-cache-key defines that depend on
   │                                      screen vs. render-target). Tuning
   │                                      (`msaaSamples`, `pixelRatioCap`, plus the AO
   │                                      uniforms below) is authored state (`postfx`
   │                                      section); the on/off switch is the synchronous
   │                                      `postfx` prop, never authored (flipping it
   │                                      recompiles every material). `createTarget()`'s
   │                                      `hdr` arg (from the `postfx` section's
   │                                      `hdrTarget`) picks HalfFloatType vs
   │                                      UnsignedByteType for the render target — a
   │                                      structural knob like `msaaSamples`, so it's
   │                                      also in the useLayoutEffect's deps and rebuilds
   │                                      the chain. `createAoPass()`
   │                                      builds a half-resolution `GTAOPass` off-label
   │                                      (`aoEnabled` in the `postfx` section, default
   │                                      on): depth-reconstructed normals so it skips
   │                                      its own normal prepass, its constructor's
   │                                      normal render target disposed by hand right
   │                                      after, and `setSize` overridden on the
   │                                      instance so `EffectComposer.setSize` can't pull
   │                                      it back to full resolution on window resize.
   │                                      Also owns the FEED-FORWARD resolution scale
   │                                      (`dynamicScale`/`dynamicScaleMin`): the same
   │                                      `useFrame` reads `apiRef.focusZoomFactor()` —
   │                                      published by useComposerControls, a number and
   │                                      not a boolean because a focus can zoom OUT —
   │                                      and applies `scale = clamp(focusZoom, min, 1)`
   │                                      through `composer.setPixelRatio()` alone.
   │                                      ⚠️ Never through the useLayoutEffect: that
   │                                      rebuild constructs a new GTAOPass, i.e. a
   │                                      shader compile fired by the knob meant to avoid
   │                                      one. Quantized (SCALE_STEP) and rate-limited
   │                                      (SCALE_COOLDOWN_S) because every change
   │                                      reallocates both targets; the debounced resize
   │                                      effect re-applies the live tier, or a resize
   │                                      mid-focus would silently restore full res
   ├─ state/                            per-instance authored config store
   │  ├─ composerStore.js                createComposerStore; COMPOSER_SECTIONS
   │  │                                  IS the saved-JSON shape/order (ten sections:
   │  │                                  lights, materials, rotation, keylight, spotlight,
   │  │                                  focus, animations, variants, app, postfx),
   │  │                                  + UI_SECTION ('ui') and VIEW_SECTION ('view'),
   │  │                                  both never serialized; get/set/replace/hydrate/
   │  │                                  subscribe
   │  ├─ defaults.js                     every product default in one place (was:
   │  │                                  buried in Leva `value:` fields) +
   │  │                                  DEFAULT_POSTFX (msaaSamples/pixelRatioCap —
   │  │                                  render-target tuning; aoEnabled/aoResolution-
   │  │                                  Scale/hdrTarget — structural, rebuild the
   │  │                                  composer chain (all three sit in
   │  │                                  PostFx.jsx's useLayoutEffect deps) and none
   │  │                                  are in authoring/PostFxTuner.jsx;
   │  │                                  aoRadius/aoIntensity/aoThickness/
   │  │                                  aoDistanceExponent/aoSamples — hot uniforms;
   │  │                                  dynamicScale/dynamicScaleMin — the feed-forward
   │  │                                  resolution scale, hot too (they only move the
   │  │                                  tier PostFx.jsx already applies per frame);
   │  │                                  never the postfx on/off switch itself, that's
   │  │                                  a KeyboardComposer prop) + createInitialState
   │  ├─ debug.js                        isDebug()/setDebug(), SSR-safe — now the ONLY
   │  │                                  source of the flag: zero `URLSearchParams`
   │  │                                  literals left in `src/`. The migration was
   │  │                                  finished because it wasn't cosmetic — see
   │  │                                  "The package must import on Node" in Manual notes
   │  └─ useComposerSection.js           reactive per-section read (useSyncExternalStore);
   │                                     store.get(section) is the non-reactive twin for useFrame
   ├─ animation/                        schema, runtime, actions, selectors, easings,
   │  │                                 opacityRegistry, materialRegistry,
   │  │                                 materialTargets, pivot, pivotRegistry, transforms
   │  ├─ materialTargets.js              SHARED material ownership: resolves a set of
   │  │                                  meshes to the material objects actually written
   │  │                                  to — fast path on the shared group material, or
   │  │                                  per-mesh clone-on-write — with the clones
   │  │                                  REFCOUNTED per mesh. Extracted out of
   │  │                                  opacityRegistry the moment a second writer
   │  │                                  appeared: two separate clone maps fight over
   │  │                                  `mesh.material`, and whichever releases first
   │  │                                  silently takes the other's effect with it
   │  ├─ materialRegistry.js             color/roughness/metalness/emissive override
   │  │                                  (the `setMaterial` action) — twin of
   │  │                                  opacityRegistry: snapshot on acquire, interpolate,
   │  │                                  restore-not-bake. ⚠️ INTERPOLATED properties are
   │  │                                  UNIFORM only, never a define (see the strain in
   │  │                                  Manual notes). `wireframe` (the `setWireframe`
   │  │                                  action) rides the same snapshot/refcount/restore
   │  │                                  machinery as a WRITE-ONCE flag: it is neither —
   │  │                                  three swaps the index buffer at draw time — so it
   │  │                                  is safe mid-animation, and it is the one value
   │  │                                  `beginRestoreAll` puts back at k=0 instead of k=1
   │  │                                  (a draw mode has no in-between to fade)
   │  ├─ animationSchema.js               every animation gets a `slug` (slugified label,
   │  │                                   deduped) alongside its id; `findAnimation(items, key)`
   │  │                                   matches id OR slug, id first across every source —
   │  │                                   internal `requires`/`idleAnimation` cite ids, the
   │  │                                   slug is the citable public surface
   │  │                                   (`play('go-to-rotors')`)
   │  └─ animationRuntime.js              emitter (`start`/`finish`/`stop`, plus `event` —
   │                                      the authored signal of the «Notifica l'host»
   │                                      action) with events QUEUED and drained at the end
   │                                      of `tick()` — they originate inside useFrame, and
   │                                      a listener that called back into `play` would
   │                                      re-enter mid-update; exposed as
   │                                      `subscribeAnimation` on apiRef. `stop()`'s soft
   │                                      teardown now runs THREE tracks: opacity, pose,
   │                                      tints (the last reuses the opacity timings)
   └─ materials/                        MACHINERY ONLY (meshGroups, groupMaterials,
                                        meshVariants, warmupTransparency) — the
                                        group/variant LISTS live under products/.
                                        `warmupTransparency.js`'s
                                        `warmTransparentPrograms` takes a
                                        `renderTarget` (from `apiRef.postfxTarget()`,
                                        `null` = screen) — must warm up wherever
                                        production actually draws, see runtime/postfx/
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
                                        spotlight, focus, animations, variants, app,
                                        postfx). Path comes from `product.configUrl`;
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
scripts/ssr-smoke.mjs                  imports the built `dist/lib` and
                                        `renderToString()`s the component on Node —
                                        an SSR regression guard, not an asset
                                        pipeline step. Not yet wired into
                                        package.json scripts. See "The package
                                        must import on Node" in Manual notes
```

Data flow, in two directions:
- **Commands** cross the DOM/Canvas boundary through one imperative ref,
  `apiRef` — a multi-writer bridge written **only** via
  `Object.assign(apiRef.current, {...})`, never reassigned. **Eight writing
  files, nine call sites**: VariantController, LightRig, AnimationDirector,
  Scene, useComposerControls, `runtime/ShadowFreeze.jsx` (`invalidateShadows`),
  `runtime/postfx/PostFx.jsx` (`postfxTarget`), and KeyboardComposer.jsx itself
  twice (app mode, then the variant commands).
- **Data** needs no bridge: `KeyboardComposer.jsx` renders both the Canvas
  subtree and the DOM overlays, so animations, variants and `appMode` travel
  as ordinary props.
- **State lives in one per-instance store, not globals**: `state/composerStore.js`
  replaces what used to be eight `window.__STATE_*` globals + eight
  CustomEvents with one object, created once (via a ref) in
  `KeyboardComposer.jsx` and threaded as a `store` prop through nearly every
  component that reads or writes authored state — Scene, KeyboardModel,
  LightRig, `runtime/MaterialApplier`, `runtime/ShadowLights`,
  `runtime/ShadowFreeze`, `runtime/postfx/PostFx`, AnimationDirector, Hud,
  useComposerControls, and every `authoring/` component. **The migration is
  complete**: zero `window.__STATE_*`, zero
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
  `postfx` (default `true`) switches the MSAA render-target composer
  (`runtime/postfx/PostFx.jsx`) on/off; unlike the other props it must be
  decided synchronously (before the first `useGLTF`/Canvas creation) because
  toggling it later would recompile every material's shader — see
  `runtime/postfx/PostFx.jsx` and `state/defaults.js`'s `postfx` section.

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

- **`DEBUG` is recomputed per file, never threaded as a prop — but it is
  always `isDebug()`, and NEVER at module scope.** `editMode` used to be the
  opposite (one `useControls` in `Scene.jsx`, threaded down); it now lives in
  `store.ui`, written by `authoring/ModeTuner.jsx` and threaded down as a prop
  like everything else — see Data flow above.
  `state/debug.js` (`isDebug()`/`setDebug()`) is the single source: it is read
  by `KeyboardComposer.jsx` (decides whether to load `authoring/`), by
  KeyboardModel.jsx, LightRig.jsx, AnimationDirector.jsx,
  useComposerControls.js, Scene.jsx (`onCreated`) and
  authoring/AnimationEditor.jsx, and re-exported from `index.js`.
  ⚠️ **The placement is the load-bearing half.** Each call site holds a
  `const DEBUG = isDebug()` in the COMPONENT/HOOK BODY. Hoisting it back to
  module scope compiles, builds green, and runs fine in the browser — and
  breaks the npm package on Node, because module scope is evaluated at
  `import` time. See "The package must import on Node" in Manual notes for the
  measurement and the one-line guard.
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
- **The saved file is `store.toJSON()`, never a hand-written section list.**
  `handleSaveJSON` (LightRig.jsx) used to build its payload by naming each
  section, and `postfx` — added later — silently never reached the file: the
  JSON stayed valid, reloaded without error, and the whole post-processing
  tuning fell back to `DEFAULT_POSTFX` on every reload, because `hydrate` skips
  absent sections by design. **A new section added to `COMPOSER_SECTIONS` must
  be picked up by both directions for free**, or the next one repeats the bug.
  ⚠️ The cheap static check for the round trip, worth re-running after touching
  either direction: `hydrate` the shipped config into a fresh store and compare
  `toJSON()` to the file. ⚠️ **It is NOT byte-identical any more — this line
  used to claim it was, and taken literally it turns every run into a false
  alarm.** Measured 2026-08-03: all ten sections survive, but four animations
  drift (`GoToRotorsAlt · inverso`, `GoToPatches · inverso`, `Esploso`,
  `Esploso · inverso`). They were hand-written into the JSON rather than saved
  from the editor, so their keys are in a different order and `loop.times`/
  `loop.from` are absent — `normalizeAnimation` fills them in, nothing is lost.
  **Compare per animation, not per line**: stringify each item before and after
  and expect the four known names, so a fifth stands out. A missing SECTION is
  invisible in review AND in the browser; only that diff catches it, and it
  still does.
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
  generator in one object; the editor's UI is generated from it. Two schema
  flags are read only by `AnimationEditor.jsx`'s `ParamField`/`StepRow`, not by
  the runtime: `advanced: true` hides a param behind a '···' toggle that
  auto-reveals when the value differs from the schema default (`isDefaultValue`).
  Same principle as the panel's folded sections, which auto-open on a
  `sectionIssues` warning rather than on a non-default value: **nothing that
  changes behaviour is allowed to sit behind a closed fold**; a `type: 'color'`
  param is tri-state via a checkbox gating the color input — unchecked means
  `null`, i.e. "leave this material property alone", not black. Both exist
  because `setMaterial` has optional per-property overrides that a plain
  default value can't express.
- **Registries with refcounted ownership + snapshot restore**
  (`opacityRegistry`, `materialRegistry`, `pivotRegistry`): acquire snapshots
  once, a second acquire bumps a count, release restores — never bakes. All
  three now also share a `restoring` freeze Set: once a graceful restore
  (`beginRestoreAll`) claims a material/pivot, any still-live action that
  keeps writing it every frame (`pulseOpacity`, `wobble`, `bounce`) is
  ignored until the restore finishes — without it the "last writer of the
  frame wins" and the restore would flicker against the action still ticking.
  `opacityRegistry`/`materialRegistry` additionally share ownership of the
  underlying material *objects* (fast-path-vs-clone decision) via
  `materialTargets.js`, so two registries writing different properties of the
  same mesh never fight over `mesh.material` — see that file's header.
- **One component instance per item, never `useControls` in a loop**
  (`MaterialTuner`/`FocusTuner` render N tuner components).
- **Scene traversals must skip tagged nodes**: `userData.__editorHelper`
  and `userData.__variantHidden`. Every new traversal is one more site to
  cover. ⚠️ `LightRig.jsx`'s own gizmo meshes (the 6 box-face helpers, the 26
  point-light sphere helpers) were themselves a missed site until recently:
  untagged, they fell into `collectMeshGroups`'s fallback bucket (`body` on
  this model) and so were reachable by any animation selector targeting
  `body` — a `setOpacity`/`transformOffset` on `body` would have fought the
  `useFrame` that repositions/rescales them every frame. Now tagged
  `__editorHelper` like every other authoring scaffold mesh.
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

**`ctx.finish()` does NOT synchronise on ANGLE/D3D11 — timing a frame with it
measures CPU submit, not the GPU.** Measured 2026-08-02: a frame that really
took 87 ms of wall clock timed as **0.3 ms** with `gl.getContext().finish()`
after it. The gap is not subtle and it silently inverts conclusions — it makes
every GPU-bound frame look free and sends you hunting in the JS. ⚠️ It also
means the "0.53 ms vs 0.28 ms" row in the numbers table below was only ever
measuring submit time; it is annotated there. **The only reliable clock on this
setup is the real rAF interval**, because the swap is the one place the browser
actually blocks:

```js
const bench = async (warm = 12, n = 25) => {
  for (let i = 0; i < warm; i++) await new Promise(r => requestAnimationFrame(r))
  const d = []; let last = performance.now()
  for (let i = 0; i < n; i++) {
    await new Promise(r => requestAnimationFrame(r))
    const now = performance.now(); d.push(now - last); last = now
  }
  return d.sort((a, b) => a - b)[n >> 1]   // mediana
}
```

**Subtract the environment's rAF floor before believing any absolute number.**
In a remote-driven Chrome the loop does not run at the display rate: measured
**31.3 ms median with `state.frameloop = 'never'`, i.e. no WebGL at all**, and
31.4 ms with the entire model hidden. So ~31 ms of every reading here is the
harness. Absolutes are inflated by that constant; **deltas between two
configurations are valid**, which is why every ranking in this file is expressed
as a delta. Re-measure the floor rather than assuming this number — it is a
property of the machine and of how Chrome is being driven, not of the app.
⚠️ **And re-measure it in the same session as the readings it explains**, not
once at the start: measured 2026-08-02, the same tab read a **39.3 ms** floor
early on and **31.3 ms** twenty minutes later, with nothing changed. The first
number was contaminated (it was taken right after a heavy state, with the queue
still draining) and it makes the app look like it cannot go below the floor —
in that session a configuration that really ran at 31.2 ms was *below* the
"floor", which is how the bad reading announces itself. If a measurement comes
out under the floor, the floor is wrong, not the measurement.

**Reaching the authored store from the console.** `?debug` publishes
`window.__r3f_state` but *not* the per-instance store, and the composer lives in
R3F's own reconciler root (walking fibers from the canvas element finds the DOM
shell only — 641 refs, no composer). The store *is* in that shell, so it can be
recovered by walking the fiber tree for an object carrying the store's shape,
which is what makes A/B-ing authored values from the console possible at all:

```js
let f = canvas[Object.keys(canvas).find(k => k.startsWith('__reactFiber$'))]
while (f.return) f = f.return
// DFS su f.child / f.sibling, ispezionando memoizedState:
//   store → get/set/subscribe/hydrate     api → playAnimation/postfxTarget
```

Driving `store.set('postfx', …)` this way exercises the real production path
(`useComposerSection` → `PostFx`'s effects), so what you measure is what ships.

**A hidden or occluded tab breaks the app, not your change.**
`requestAnimationFrame` is frozen in a background tab, so R3F never measures
the container (the canvas stays stuck at the default `300×150`,
`window.__r3f_state` is never set) and `useFrame` never runs — the HUD reads
`FPS 0.00` and rAF-based promises in injected scripts hang until the tool times
out. Bring the browser window genuinely to the foreground before testing; a
window-resize call on an occluded window is not enough.

**Pump frames manually when you must.** `Scene.jsx`'s `onCreated` publishes
`window.__r3f_state` under `?debug`; `state.advance(timestamp)` runs one frame
on demand, which fast-forwards damping without waiting in real time.

⚠️ **Two details decide whether it works at all, and the version this file
carried until 2026-08-02 got both wrong — measured, not assumed.** R3F honours
the `timestamp` argument *only* when `frameloop === 'never'`; otherwise the
delta comes from `clock.getDelta()`, i.e. real wall time, which in a
synchronous loop is ~0. And the timestamp is `clock.elapsedTime`, in
**seconds**, not a `performance.now()` millisecond value. The old recipe
(`t += 16` from `performance.now()`, frameloop left alone) therefore advanced
nothing: 43 calls moved the animation runtime by **64 ms** instead of the ~0.7 s
asked for, which reads as "the sequencer is stuck" and sends you debugging the
sequencer. The working version:

```js
const st = window.__r3f_state
st.setFrameloop ? st.setFrameloop('never') : (st.frameloop = 'never')
let T = st.clock.elapsedTime
const pump = (sec) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { T += 1/60; st.advance(T) } }
window.__setPose(35.264389682754654, 45)   // TL — see the product's POSE_COORD
pump(25)                                    // damping to convergence
// …e alla fine: st.setFrameloop('always'), o la pagina resta ferma
```

Confirmation that the manual clock is really driving: after `pump(1)` from a
standing start, `st.clock.elapsedTime` reads **exactly** `1` — under
`frameloop: 'always'` it would read the accumulated real time instead.
⚠️ Note `st.frameloop` on the published snapshot keeps reading `'always'` even
once the switch has taken effect (`window.__r3f_state` is the state object
captured at `onCreated`); trust the clock, not that field.

Other `?debug`-only console handles, all installed next to the code they drive:
`window.__setPose(pitchDeg, yawDeg)` (hard teleport — bypasses both the spring
*and* the pose lock; console-only, not reachable from any UI),
`window.__abortComposerDrag()` (cancels an in-progress drag — called by the
`TransformControls` gizmos in `authoring/MeshController.jsx` and
`authoring/LightGizmos.jsx` on `onMouseDown`, so dragging a gizmo doesn't also
rotate the model), `window.__focusGroup(id)` / `window.__clearFocus()`, and
`window.__playAnimation(id, opts)` / `__stopAnimation()` / `__animTrigger(name)`
/ `__animState()` / `__animStats()` (`AnimationDirector.jsx`). The last two are
the cheap way to check a teardown left nothing behind: `__animStats()` must read
all zeros (`ownedMaterials`, `tintedMaterials`, `clonedMeshes`, `pivots`,
`pivotedMeshes`) once an animation and its inverse have finished.
⚠️ `window.__kb` is the PUBLIC API facade, and it comes from `App.jsx`, not from
the component — playground only, same boundary as `PLAYGROUND_BRANDING`. It is
the honest way to exercise what ships (`__kb.play('wireframe')`,
`__kb.subscribe(console.log)`).
⚠️ `window.__STORE` is **Leva's** store, not the composer's — checked, it
exposes `getVisiblePaths`/`setValueAtPath`. The fiber walk above is still the
only way to the authored store; don't let the name save you the trip.

Since the store refactor there is no longer a reason to reproduce the
production config by hand: `runtime/ConfigLoader.jsx` fetches
`product.configUrl` in `?debug` too, so the authoring session already runs on
the shipped values. `apiRef.current.loadConfigJSON()` (the "Carica JSON" button,
published by `LightRig.jsx`) is still the way to try a *different* file.

## The package must import on Node — and the browser never tells you

The component is meant to be installed by a React e-commerce app, i.e. by
Next/Remix, where **the first render runs on the server**. Nothing in this
repo's normal workflow exercises that: `npm run dev`, `npm run build` and every
browser measurement above all run where `window` exists.

Measured 2026-08-03: `dist/lib` **could not be imported at all** under Node —
`ReferenceError: window is not defined`, thrown at import time, before any
component rendered. Cause: five modules held
`const DEBUG = new URLSearchParams(window.location.search).has('debug')` at
**module scope**, and four of them (KeyboardModel, LightRig, AnimationDirector,
useComposerControls) sit in the eager chain
`index.js → KeyboardComposer → Scene`. `state/debug.js` had already been
written to prevent exactly this — its own header names Next/Remix — and the
migration had stopped four files short.

⚠️ **The failure mode is what makes this worth writing down: every local signal
was green.** The dev server was fine, both builds were fine, and the browser
was fine, because module scope is only hostile in an environment this repo
never starts. A code review reads `const DEBUG = …` as a harmless constant; the
bug is not in the expression but in *where it sits*.

The guard is one line and runs without a browser:

```bash
node --input-type=module -e "import('./dist/lib/keyboard-composer.js')"
```

`scripts/ssr-smoke.mjs` is the stronger version — it also `renderToString`s the
component, which catches a `window` in a component BODY that a bare import
would miss (261 bytes of HTML: the shell renders, the Canvas subtree correctly
renders nothing on the server). Worth running after any change to the eager
import chain. Not yet wired into `package.json`.

⚠️ Two things that are safe and should not be "fixed" on sight:
`sessionStorage` in `KeyboardComposer.jsx`'s `useState` initializer is inside a
`try/catch`, and a bare-identifier `ReferenceError` **is** catchable, so it
returns `null` on Node exactly as it does in Safari private mode. And
`authoring/AnimationEditor.jsx` lives behind the `import()`, so it never loads
on the server — it was switched over anyway, because leaving one copy of the
pattern alive is how it comes back.

## Measured numbers worth not re-deriving

| Number | Where | Why it is what it is |
| --- | --- | --- |
| **108 draw calls/frame** | measured in browser, 2026-08-01 | ⚠️ **Supersedes the "264" this table used to claim.** Counted with `gl.info.autoReset = false` + `state.advance()`: 108 per frame, from 107 visible meshes out of 143 in the graph (the rest are the hidden variant). 264 is not reproducible on today's asset — treat any cost estimate scaled from it as 2.4× too pessimistic. The pipeline still forbids `join`/`optimize`, so the count is still permanent |
| **+107 draw calls** | one shadow-map regeneration | The directional's shadow pass, measured by forcing `shadow.needsUpdate`: 108 frozen → 215 the frame it regenerates → 108 again. I.e. an active shadow light **doubles the frame**, which is the entire payoff of `runtime/ShadowFreeze.jsx` |
| **~34 forward lights** | `LightRig.jsx` | 26 point (9 `top` + 8 `mid` + 9 `bot`) + 6 `rectAreaLight` (LTC, not cheap) + directional + spot. Every fragment evaluates all of them. ⚠️ Measured in the shipped config there are only **32**: `keylight.enabled` and `spotlight.enabled` are both `false` in `app-state-config.json`, so the two shadow-casters aren't in the scene at all — see "Contact shadows" below, it changes what AO has to stand in for |
| **192 ms vs 0.4 ms** | shader compile vs normal frame | The cost of one `transparent` cache-key flip; the whole reason `warmupTransparency.js` exists |
| **+4 draw calls** | the AO pass | `GTAOPass` adds four fullscreen quads (AO, Poisson denoise, copy, blend) and **no geometry pass**: 112/frame against 108 without. It is the proof that `setGBuffer(null, undefined)` really suppressed the pass's own normal prepass — which would read ~216 instead |
| **22.2% vs 6.3%** | AO on crevices vs exposed faces | Relative darkening (`1 - ON/OFF`), ratio 3.5×, zero pixels brightened. ⚠️ Measured as an ABSOLUTE difference the ratio inverts to 0.65 and real contact occlusion looks like a flat global dim — AO multiplies, so already-dark pixels lose little in absolute terms |
| **0 difference** | two static frames | Consecutive `state.advance()` frames with a settled camera are BIT-IDENTICAL across 1.4 M pixels. Two uses: it is the control that proves any A/B measurement here is signal and not rig noise, and it is half the reason progressive accumulation was archived — there is no shimmer at rest to remove |
| **0.018 / 255** | what supersampling would buy | Excess *temporal* variation of MSAA 4× over a 2.5× supersampled reference, across poses 0.05° apart (0.313 vs 0.295 mean). ⚠️ Measure the frame-to-frame VARIATION, not the per-frame error: the single-pose error against the same reference is 1.41/255 with 7.4% of pixels beyond 5, which looks like it justifies accumulation. It does not — a constant error is invisible, only an oscillating one is seen |
| ~~**0.53 ms vs 0.28 ms**~~ | ~~composer frame vs direct render~~ | ⚠️ **RETRACTED 2026-08-02 — do not scale anything off this row.** Both were taken with `ctx.finish()` "to force GPU sync", and on ANGLE/D3D11 that call does not sync: it timed a genuinely 87 ms frame as 0.3 ms. The two numbers are CPU submit time, not frame cost, so the conclusion drawn from them ("neither axis is saturated") was unsupported. See the `ctx.finish()` entry above for the method that replaces it |
| **~60 ns per pixel** | fill cost, zoomed-in state | The real answer to step 2, and it is unambiguous: **this scene is fill-bound and linear in pixel count.** Same state, three render-target sizes: 1.46 Mpx → 87.3 ms, 1.29 → 76.6, 0.89 → 60.0. ⚠️ Every cost estimate here must scale with the VIEWPORT, not with the model: fullscreen on a 1080p display at DPR 1.6 is ~3.6× these pixels, which is how the same animation reads 12 fps on one window and 6 on another |
| **1.17 ms** | CPU cost of a whole frame | 60 synchronous `state.advance()` calls, every `useFrame` subscriber plus the full composer chain. Against an 87 ms wall clock, i.e. **the CPU is 1.3% of the frame** and the main thread is idle between frames (202 `setTimeout(0)` per second). Kills the whole class of "reduce draw calls / batch material binds" optimisations before anyone spends a day on one |
| **112 → 69 draw calls** | entering the `GoToRotors` focus | Frustum culling as the camera closes in. ⚠️ The frame **doubles** while the draw calls nearly halve — the single cheapest observation that separates the fill axis from the geometry axis, and worth re-running before believing any geometry-side diagnosis |
| **+22% from REMOVING 6 lights** | the 6 `rectAreaLight`s | ⚠️ Counter-intuitive, reproduced 3/3 (87/90/88 ms with them → 111/106/107 without). Removing 13 of 26 point lights changes nothing at all (87.8 vs 84.6). **Light count is not a performance knob on this profile**: the forward shader's ALU hides behind memory traffic, and the recompiled variant can land in a worse register/occupancy regime on Intel Xe. Re-authoring the rig for speed would cost days and buy a regression |
| **−9.2% from an 8-bit target** | `hdrTarget: false` | The third and last real lever, and the only one deliberately left OFF. 54.6 → 49.6 ms (spreads 2.1 and 0.7, non-overlapping). Quality against a 16-vs-16-bit control that reads **exactly 0** at rest: 0.18/255 mean at rest (invisible), **1.31/255 mean and 0.425% of pixels over 8 in the zoomed state** — the blended state is worse because ~105 meshes quantise layer on layer. ⚠️ Not taken as default because it is the only measured knob whose damage depends on CONTENT rather than on image geometry: the scene enters the target in linear HDR, so anything above 1.0 clips before ACES can compress it, and the incoming textured asset may bring glossier materials. Spend it on mobile, not here |
| **0 ms from dropping `USE_CLEARCOAT`** | all 8 clearcoat groups | ⚠️ **Measured 2026-08-02, and it closes the last "obvious" lever.** Interleaved A/B/A/B/A/B in the zoomed state: clearcoat on = 56.4 ms median, off = 53.5, i.e. 2.9 ms apart while the *spread within the on-group alone* is 13.1. Below the noise floor. Do not spend image quality on this. ⚠️ Two traps if you re-run it: `clearcoat` is a **define** (`three.cjs:65040`, `HAS_CLEARCOAT = material.clearcoat > 0`), so lowering a value from 0.61 to 0.2 changes literally nothing — only crossing zero does; and verify the define actually dropped (`gl.properties.get(mat).currentProgram.id` must change) rather than trusting that setting the value was enough — see the entry below |
| **0 ms from `aoSamples` 16 → 4** | the AO pass | 87.4 vs 87.3, i.e. nothing — while disabling the pass entirely is worth 15 ms. The AO's cost here is **bandwidth** (four fullscreen quads: AO, Poisson denoise, copy, blend), not arithmetic. The only real AO levers are `aoEnabled` and `aoResolutionScale` |
| **9.1/255 on 2% of pixels** | `pixelRatioCap` 2 → 1.25 | What the default change costs visually, split by local gradient over 365k samples: flat surfaces (98%) move 0.15/255, silhouette edges (2%) move 9.1. ⚠️ And the sample count is nearly irrelevant next to it — msaa 4 gives 9.06, msaa 2 gives 9.19, which is why `msaaSamples` dropped to 2 for free. `pixelRatioCap: 1.5` is the conservative alternative: 7.6/255 on edges but only −12% |
| **−28% wall clock, 0.49× pixels** | `dynamicScale` in the worst state | Interleaved A/B/A/B/A/B on `focusGroup('rotors', radiusFactor: 2)`, medians of the real rAF interval: **43.8 ms off (39.6–46.5) vs 31.4 ms on (31.2–31.8)**, non-overlapping. The scaled runs sit *exactly* on the harness floor, i.e. the GPU work disappears under it — so −28% is a FLOOR-LIMITED lower bound on this window, not the real saving. The machine-independent half of the result is the pixel count: 1.465 → 0.718 Mpx, the exact 0.7² the tier asked for. Exposure control: mean luminance 17.491 vs 17.471 (−0.11%), i.e. resolution changed and nothing else |
| **0 recompiled programs** | 8 tier transitions | `gl.info.programs.length` 11 → 11 across four focus/exit cycles. This is THE check that the tier change goes through `composer.setPixelRatio()` and not the `useLayoutEffect` — the rebuild path would construct a fresh `GTAOPass`, i.e. new materials, i.e. a compile stall triggered by the very knob that exists to avoid one. Re-run it after touching either path |
| **2 reallocations per dolly** | entering focus, 150 frames sampled | Target width went 1276 → 1148.4 → 893.2 and stopped, i.e. `SCALE_STEP` + `SCALE_COOLDOWN_S` really do keep the ~0.6 s damped dolly from reallocating at every intermediate zoom. Sample `postfxTarget().width` per frame and count distinct values to re-check |
| **`focusZoom` 1.56 on `keycaps`** | why the signal is a number, not a boolean | Focusing a group whose bounding sphere is *larger* than the fit zooms OUT, and costs less than the resting frame. Measured: rotors 0.19 → tier 0.7, keycaps 1.56 → clamped to 1, full resolution. A boolean "focus active" would have downscaled the one case that needed nothing |
| **A wireframe of this asset does not read at full framing — at any density** | `setWireframe`, browser 2026-08-03 | 338,586 triangles over an ~800 px canvas cover every pixel several times: the result is a flat tone, not a mesh. ⚠️ The obvious fix does NOT work — dropping the three densest groups (keycaps + damping + viti = **81.6%** of triangles) leaves the bare shell at 36,664 triangles, and it is *still* a solid mass. It is the asset's density, not a tuning problem, so the authored animation does `focusGroup` BEFORE switching on, never after. Close up the topology is unmistakable. Per-group triangles, worth not re-counting: keycaps 144,704 · damping 69,490 · viti 62,152 · body 36,664 · rotors 20,160 · the other four ≈1,300 each |
| **13 fps wide vs 24-25 fps zoomed** | the same wireframe | ⚠️ Inverts the rule the rest of this table teaches (a focus costs ~4× because it fills the viewport). Lines are the exception: wide, all ~2 M segments are on screen and overlapping; zoomed, frustum culling throws most of them away. So the legible framing is also the cheap one — there is no trade-off to arbitrate here |
| **6 fps from `depthWrite: false`** | the wireframe fade | Dead end already walked, in search of an x-ray look: half the frame rate of `depthWrite: true` (every interior face drawn as well) and **zero** legibility gained. Depth write is what gives the wireframe a silhouette instead of a cloud |
| **~8% from transparency** | ~105 meshes at `opacity 0.2` | 86.7 ms transparent vs 79.8 opaque, same camera. Real, but far from the story — the transparent pass loses early-Z and interleaves materials by z instead of batching them (`three.cjs:65639` vs `65665`), yet both of those land on the CPU/ordering axis that the 1.17 ms row already rules out. **What makes `GoToRotors` expensive is the focus zoom filling the viewport, not the fade** |
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
- **A generated inverse has two ways to undo the same thing, and the wrong one
  wins in silence.** `clearFocus` restores opacity, mesh poses and tints
  *globally* from the registries, while `reverseAnimation` also emits the
  per-step inverses (`setOpacity → 1`, `transformOffset → [0,0,0]`,
  `rotateBy → −angle`). Where both exist the global restore wins — and not by
  racing for the same frame, which is what makes it hard to see: `focusGroup` is
  usually the LAST step of the direct animation, so the reversal by groups puts
  its `clearFocus` FIRST in the inverse, and `beginRestoreAll().finish()` clears
  every pivot channel *before* the explicit steps run. Those then interpolate
  from zero to zero and the motion the inverse existed to show simply never
  happens. Measured 2026-08-02 on `GoToRotorsAlt · inverso`: the keycaps dropped
  back to rest within 0.5 s **at opacity 0** and then faded in standing still,
  instead of descending from +50 as they faded. `focusGroup.inverse` therefore
  emits `restoreOpacity: false` **and** `restoreTransforms: false`.
  ⚠️ `restoreMaterials` stays ON, and that asymmetry is the actual rule worth
  keeping: **the global restore is right exactly where no explicit inverse
  exists.** `setMaterial` has none (the starting colour lives only in the
  registry at runtime); opacity and transforms do. An action added with an
  `inverse()` joins the first list; one added without it needs `clearFocus` to
  keep covering it.
  ⚠️ Inverses already **saved** in a product's config keep the flags they were
  generated with — fixing the generator does not reach them. Grep the config for
  `clearFocus` after touching this, and leave hand-authored "return to rest"
  sequences (`GoIdle`) alone: there the global restore is the whole point.
- **`measureModelBox` will see the spinning rotors.** It re-measures every
  `BOX_REFRESH_FRAMES` and damps the result, so a group whose AABB changes shape
  as it rotates can make the adaptive light box slowly breathe. If it turns out
  to matter, the skip flag belongs on **spin only** — a `transformOffset`
  *should* stretch the box, that is the point of it.
- **Any framing that fills the viewport costs ~4× the resting frame, and there
  is no fix — only a scale factor.** Measured on `GoToRotors`: ~3 ms/frame at
  rest, **~56 ms** once `focusGroup('rotors', radiusFactor: 2)` has the model
  covering the whole viewport. Nothing pathological is happening; the scene is
  simply fill-bound (~60 ns/px) and focus multiplies covered pixels. ⚠️ Two
  consequences that are easy to get wrong:
  - **it is a property of the WINDOW, not of the animation.** The same sequence
    reads ~12 fps in a 798×718 canvas and ~6 fps fullscreen on a 1080p display,
    because that is 3.6× the pixels. Reproduce perf reports at the reporter's
    window size or the numbers will not match.
  - **the obvious culprits are all innocent** — the opacity fade is ~8%, the
    CPU 1.3%, and cutting lights makes it *worse*. Every one of those was
    measured after being wrongly predicted as the cause; don't re-derive them.

  The only lever is `pixelRatioCap` (linear), which is why it ships at 1.25
  rather than 2. Beyond that the fix would have to be the material shader
  itself — 32 forward lights with clearcoat, i.e. two BRDF lobes per light per
  fragment — and that is an authoring decision, not a tuning one.
  ⚠️ **Since `dynamicScale` that lever is applied automatically** (see the
  matching row in the numbers table and `state/defaults.js`): the strain is no
  longer "the expensive state costs 4×" but "the expensive state is rendered at
  fewer pixels", which is a quality cost, not a frame-rate one. What did **not**
  change is the underlying profile — the scene is still fill-bound and the
  shader is still the only structural fix.
- **A material change that flips a DEFINE does not reach the shader while that
  material is under an opacity override — observed, mechanism not yet
  diagnosed.** Seen 2026-08-02 while measuring clearcoat: with `GoToRotors`
  holding ~105 meshes transparent, writing `clearcoat: 0` through the normal
  authored path (`store.set('materials', …)` → `applyMaterialProps`) updated the
  VALUE on the material — `mat.clearcoat` really read 0 — while the material
  stayed on its old program (id 9, `clearcoat` still an active uniform). The one
  group that *wasn't* faded (`rotors`, excluded by the selector) rebuilt
  correctly, 7 → 8. Forcing `needsUpdate = true` afterwards makes every group
  rebuild as expected.
  ⚠️ Why it matters beyond clearcoat: uniform-valued props (color, roughness,
  metalness) are unaffected and apply normally, so the failure is **invisible
  until a define is involved** — `wireframe` is the one non-uniform property
  that is nonetheless safe under a fade, because it is not a define either: it
  is read at draw time (`WebGLRenderer.js:1111` swaps in
  `getWireframeAttribute(geometry)` and draws LINES). It appears in the cache
  key only through `WebGLPrograms.js:305`'s
  `flatShading && wireframe === false`, and `flatShading` is never set anywhere
  in `src/`, so the term is `false` either way. **Anyone introducing a
  `flatShading: true` material silently makes `setWireframe` a 192 ms compile
  stall.** Verified in browser 2026-08-03, and verified the right way —
  `gl.info.programs.length` reads **11 before and 11 after**, across two plays
  of the animation and one of its inverse. Its real cost is elsewhere: three
  builds the line index buffer on the first draw with it on (6 indices per
  triangle, ~2.03 M entries, ~8 MB across 338,586 triangles / 111 primitives).
  Measured, the frame that flips it costs **148.7 ms the first time and 81 the
  second**, against a 32 ms median — so ~68 ms is the one-time build and the
  remaining 81 is the first line draw, which never goes away. The authored
  «Wireframe» animation flips it at opacity 0.04 so that frame lands where
  nothing is visible; it is deliberately NOT pre-warmed, which would charge
  every session for a view most visitors never open. And the textured GLB will
  bring the genuine defines
  (`map`, `normalMap`, `alphaMap` presence are all defines, and
  `programSignature` already tracks them for the warm-up). Authoring materials
  while an animation holds a fade is a normal thing to do in `?debug`.
  ⚠️ Not investigated: `opacityRegistry.own()` does bump the version once at
  acquire, and three bumps it again when clearcoat crosses zero, so on paper the
  rebuild should happen. Don't assume the registry is at fault without checking
  — start from `properties.get(material).__version` against `material.version`.
- **A partial-subset opacity fade clones N materials** and flips `transparent`.
  The compile is pre-warmed and the warm-up covers the clones (they share the
  originals' cache key), but the *cloning* itself is still per-acquire work. The
  fast path avoids it for whole-group selections, the common case.

## Anti-aliasing and contact shadows: built, and one part deliberately not

⚠️ **This section twice described work that no longer matched reality** — first
claiming nothing here existed in the code, then that step 4 was unmeasured. It
is now settled: steps 1, 3 and 4 are built and measured, step 2 is answered, and
step 5 is **archived by measurement rather than left pending**. Nothing below is
open work. Read the status table before acting on any prescription further down,
because two of them (moving the tone mapping, building the quality LOD) are kept
as records of decisions *not* to do something:

| Step (see "Suggested implementation order" below) | Status |
| --- | --- |
| 1. Freeze the shadow map | **BUILT & MEASURED** — `runtime/ShadowFreeze.jsx`, halves the frame (215 → 108) when a shadow light is on. ⚠️ Saves nothing today: both shadow lights are disabled in the shipped config |
| 2. Measure CPU- vs fragment-bound | **ANSWERED 2026-08-02 — fragment, and only when the model fills the viewport.** CPU 1.17 ms of an 87 ms frame; ~60 ns/px, linear. ⚠️ Supersedes the earlier "neither axis saturated", which was an artefact of `ctx.finish()` not syncing on ANGLE |
| 3. Composer + MSAA + `OutputPass` | **BUILT & CHECKPOINTED** — `runtime/postfx/PostFx.jsx`. No SMAA yet, and the tone-mapping move it prescribed turned out to be WRONG (see the step itself) |
| 4. Half-res AO with depth-reconstructed normals | **BUILT & MEASURED** — `createAoPass()` in `runtime/postfx/PostFx.jsx` (`GTAOPass`, `aoEnabled: true` by default). 112 draw calls/frame vs 108 without, i.e. the normal prepass really is skipped; crevices darken 3.5× more than exposed faces; cost below the measurement noise floor |
| 5. Progressive accumulation at rest | **ARCHIVED, not deferred** — measured worth 0.018/255; the image is already bit-identical at rest. Takes the quality-LOD machine and SMAA down with it |

So: an `EffectComposer` *and* a `GTAOPass` now exist and are mounted (the
composer whenever the `postfx` prop is on, the AO pass whenever `aoEnabled` is
true in the `postfx` section); only the quality-LOD state machine (step 5,
progressive accumulation) still does not — don't treat *its* absence as a
regression. Everything below about *why* remains the design record, and most of
the reasoning is specific to this scene's cost profile rather than what a
generic three.js guide would say.

⚠️ **The passes come from `three` itself** (`three/examples/jsm/postprocessing/`),
not from `postprocessing`/`@react-three/postprocessing`. That is what makes this
feature cost the npm package **zero bytes**: `vite.config.js`'s EXTERNAL rule
already matches `three/` subpaths, so the pass code stays external and is
supplied by the peer `three` the host installs anyway. Measured on the
playground build, the only place it does land: `three` chunk 1504.71 → 1514.19
kB (+9.5 kB, +2.3 kB gzip). Picking `postprocessing` instead would have
reintroduced the two-copies-of-`three` problem — it peer-pins `three` with a
`^0.x` caret, the same reason `@google/model-viewer` was rejected for AR.

### The cost profile that drives every choice

⚠️ **Half of this subsection was written from the draw-call count and turned out
to be wrong when measured (2026-08-02).** The corrected profile, which every
choice below should now be read against:

- **The CPU is not a bottleneck and never was.** 1.17 ms of a 87 ms frame. Any
  optimisation aimed at draw calls, material binds or render-list ordering is
  chasing ~1% — including the "108 draw calls" figure that this section used to
  treat as one of the two bottlenecks.
- **The light count is not a bottleneck either**, and cutting it *backfires*
  (see the +22% row in the numbers table). The "~34 forward lights" figure is
  still true as a description; it is not a lever.
- **The only axis that matters is pixels**, and it is linear: ~60 ns each. Cost
  therefore scales with the VIEWPORT and with how much of it the model covers —
  not with the model's complexity.

**The one sentence that predicts every measurement in this file: the frame is
bandwidth-bound, not ALU-bound.** Everything arithmetic has measured free —
light count (removing 6 is *worse*), clearcoat (2.9 ms against 13.1 of noise),
`aoSamples` 16 → 4 (zero). Everything that moves bytes has measured expensive —
pixel count (linear, the only real lever), MSAA samples (4 → 0 is worth 26 ms),
the AO pass's four fullscreen quads (15 ms), blending ~105 transparent meshes
(7 ms). ⚠️ Use this to triage before measuring: **an optimisation that removes
shader math on this scene will do nothing.** That is not a general truth about
three.js — it is a property of an RGBA16F + MSAA target on an integrated GPU
sharing system memory, and it should be re-tested on a discrete card before
being carried anywhere else.

What survives intact is the rule this section existed to state, now for a
sharper reason: **prefer screen-space effects over extra geometry passes, and
never increase the pixel count.** Raising DPR multiplies the only axis that
costs anything. ⚠️ But its corollary does not survive: a fullscreen pass is
*not* cheap here because it is geometry-independent — the AO is four fullscreen
quads at half resolution and still costs 15 ms. On a bandwidth-bound integrated
GPU, "screen-space" and "cheap" are not synonyms.

The second structural fact: **the scene is static most of the time.** The camera
only moves during the spring settle and the model never rotates. There is no
reason to pay per-frame for quality that only matters once the image settles.

### Anti-aliasing

⚠️ **This section argued for temporal accumulation on a premise that turned out
to be false on this asset. It was measured 2026-08-01 and the answer is no —
MSAA 4× is enough, and step 5 is ARCHIVED, not deferred.** The reasoning is kept
because the argument is sound in general and the measurement method is worth
reusing; what changed is the empirical input.

The argument was: the dominant aliasing source here is **not** geometric edges
but **specular aliasing** — sub-pixel highlights flickering on rounded keycap
edges, driven by clearcoat + satin metal + 34 light sources. That is a
*shading-rate* problem, not a *coverage* problem, so **MSAA does not fix it**
(MSAA multiplies coverage samples, not shader evaluations) and SMAA barely helps.
Only supersampling — too expensive on the fragment axis — or **temporal
accumulation** addresses it. All of that is still true *as physics*.

**What is not true is that this scene has that problem.** Three measurements,
in the order that matters:

1. **At rest the image is bit-identical frame to frame.** Two consecutive
   `state.advance()` frames with a static camera differ by **0** across 1.4 M
   pixels — not "small", zero. Progressive accumulation acts precisely in the
   settled state, which is where this app spends most of its time, and there is
   nothing there to stabilise.
2. **Under motion, supersampling removes almost nothing.** Building the ground
   truth accumulation converges to (render at 2.5×, area-reduce to the display
   grid) and comparing the *temporal* variation of the two chains across four
   poses 0.05° of yaw apart — the tail of a settle, i.e. the regime most likely
   to expose shimmer:

   | | mean variation | unstable pixels (>8) | max |
   | --- | --- | --- | --- |
   | MSAA 4× (today) | 0.313 | 0.58% | 62 |
   | supersampled (the truth) | 0.295 | 0.43% | 69 |

   Excess: **0.018/255**, about 6% of an already small quantity, and the
   supersampled chain's *maximum* is even higher. What changes between frames is
   **real motion**, not aliasing.
3. **The static error is real but static, and therefore invisible.** A single
   pose against the supersampled truth differs by 1.41/255 on average, 7.4% of
   pixels beyond 5. So the image genuinely is not the ideal one — but (2) shows
   that discrepancy does not move as the camera does. A constant error is not
   perceived; an oscillating one is. **That distinction is the whole answer**,
   and measuring only (3) — the obvious test — would have produced the opposite
   conclusion.

Likely why: the materials are rough and the keycaps are black with mild
clearcoat, so the highlights are broad and soft. The condition that generates
specular shimmer — highlights narrower than a pixel — simply does not occur here.
⚠️ It could return with the incoming textured asset, if it brings glossier
materials or a normal map. If it does, re-run measurement (2), not (3).

⚠️ **MSAA on the default framebuffer is lost the moment you render through a
composer**, and the last draw to the screen is a fullscreen quad with no
geometric edges to sample. A multisampled render target must be requested
explicitly — `samples` on the `WebGLRenderTarget` handed to `EffectComposer`,
since its default target has none — or the first effect added makes the image
*worse*, not better. For the same reason `Scene.jsx` now sets
`antialias: !postfxOn` on the Canvas: with the composer up, that would be a
multisampled framebuffer allocated and never used.

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
*per light*, i.e. 26 × 6 × 108 draw calls, which is not a tradeoff to evaluate
but a non-starter. The only light that *could* shadow is the directional.

⚠️ **And in the shipped configuration it is switched off.** Measured in browser
2026-08-01: `app-state-config.json` carries `keylight.enabled: false` *and*
`spotlight.enabled: false`, and the scene contains 32 lights — 26 point + 6
rectArea — with **zero shadow casters**. So the product as it ships has no
shadow of any kind, not merely a weak one. Two consequences, and they point in
opposite directions:

- The premise below is *stronger* than it was written: **the volumetric rig
  behaves as ambient light that never occludes anything** — AO is not a polish
  item here, it is the only occlusion the product would have.
- The headroom that was supposed to pay for AO **is not there to recover**.
  `runtime/ShadowFreeze.jsx` is built, correct and measured, but with no shadow
  caster enabled it currently guards nothing (0 draw calls saved). Re-enabling
  the key light returns 107 draw calls per frame — but whether it is off by
  authoring choice or by accident is unresolved, and it should be settled before
  any cost is scaled off it.

Two separate contributions:

1. ✅ **Half-resolution screen-space AO** (GTAO/N8AO class) with a depth-guided
   bilateral upsample. Built — see step 4 in "Suggested implementation order"
   below for the implementation traps. It responds to any transform, so it
   keeps working under the mesh editor and under a running animation. Uses an
   implementation that can **reconstruct normals from depth** — that removes
   the normal prepass, i.e. 108 draw calls, worth the marginal quality loss on
   this cost profile. Physically AO should modulate only indirect light, but
   here the 32 non-shadowing lights *already are* a stand-in for indirect, so
   multiplying the final color is defensible in this scene specifically.
2. **Freeze the directional light's shadow map.** The camera orbits, the model
   never rotates, the key light is fixed — **the shadow map is identical frame
   after frame.** Rendering it once (`shadow.autoUpdate = false`,
   `shadow.needsUpdate = true` on demand) and regenerating it only when the mesh
   editor moves something returns 107 draw calls per frame — **measured**, see
   the numbers table. Built as `runtime/ShadowFreeze.jsx`. It was billed as
   likely the single largest win in this list, and per-frame it is (it halves
   the frame); ⚠️ but the shipped config has no shadow caster enabled, so today
   it recovers nothing and **cannot be the thing that pays** for a
   contact-hardening (PCSS-style) filter
   on that one light.

**Baked AO** is the zero-runtime-cost option and the obvious choice for a static
product shot, but it breaks exactly where this project is heading: if "explode"
becomes an authored animation, AO baked between parts stays painted on the
surfaces as they separate. Per-mesh *self*-occlusion stays valid regardless. A
sensible hybrid is baked self-AO plus screen-space inter-mesh AO — but only if
measurement shows screen-space alone is insufficient. Don't assume it up front.

### The quality LOD — NOT BUILT, and no longer needed

⚠️ **Do not build this.** A render-quality LOD driven by a "scene is at rest"
signal existed in this document only to serve progressive accumulation, and
accumulation was archived by measurement (see "Anti-aliasing" above). With it
goes the whole machine: the tier switching, the convergence threshold on the
rig's damping, the three invalidation sources. That is a substantial amount of
delicate state serving an effect worth 0.018/255.

It is kept here in outline because the *shape* would return if the textured
asset ever reintroduces specular shimmer:

```
moving    -> MSAA + SMAA, low-sample half-res AO
at rest   -> progressive accumulation for N frames -> stop
any input -> invalidate, drop back to the base tier
```

The coupling that made it attractive: **accumulation makes everything else
cheaper** — if the final image is the mean of 32 jittered frames, the AO can run
at a low, noisy sample count and the noise averages out. Note that today's AO
already costs below the measurement noise floor at full quality, so even that
argument has lost its payer.

And the three invalidation sources that would bite, which are the reason this
was never cheap — recorded so nobody rediscovers them the hard way:

- **`LightRig` is never truly "at rest".** Intensities damp asymptotically
  toward their targets and the adaptive box re-measures every
  `BOX_REFRESH_FRAMES`. Accumulating while the damping is still converging
  averages genuinely different images and yields a dirty result. A convergence
  threshold on the damping is needed, not just the camera spring's signal.
  ⚠️ Note this does NOT contradict the measured "bit-identical at rest" result:
  the rig converges to an exact fixed point and then stops changing — it is the
  approach to it that is asymptotic, so the threshold problem is about *when* to
  start accumulating, not about the settled state being noisy.
- **A running animation is never at rest**, and not only while the camera moves:
  a `spinGroup` step keeps rotating geometry forever and a `setOpacity` fade
  changes shading without moving the camera at all. The "at rest" signal must
  consult `apiRef.current.animationState()`, not just the pose spring.
  (`runtime/ShadowFreeze.jsx` already does exactly this, and is the working
  precedent for how such a signal should read the bridge.)
- **In `?debug`**, gizmo drags must invalidate like a normal drag.

### Codebase-specific traps

- ⚠️ **Tone mapping does NOT have to move — this entry used to say it did, and
  acting on it would have broken the image.** The requirement is real (scene in
  linear HDR → AO → accumulate → tone map → SMAA last, on LDR), but three
  already satisfies it for free: the `toneMapping`/`outputColorSpace` defines a
  material compiles with are chosen **per render destination** — the renderer's
  values when drawing to the screen, `NoToneMapping` + linear when drawing into
  a render target. So `RenderPass` fills the target in linear HDR by itself, and
  `OutputPass` reads `renderer.toneMapping`/`outputColorSpace` back off the
  renderer for the final quad. Setting the renderer to `NoToneMapping` disables
  **both**, and the image comes out flat. ACES stays on `Scene.jsx`'s `gl={{…}}`
  exactly where it was.
- ⚠️ **That same per-destination rule is why `warmupTransparency.js` takes a
  `renderTarget`.** The destination is part of the program cache key, so once
  the composer exists the production frames compile against a *different* key
  than a warm-up that renders to the screen — the warm-up would heat programs
  nobody uses and the first `setOpacity` would still compile 2, i.e. the exact
  defect that module exists to prevent, re-created from another direction.
  Failure mode: no error, no visual difference, visible **only** on
  `gl.info.programs.length`. `KeyboardModel.jsx` passes
  `apiRef.current.postfxTarget()`, published by `runtime/postfx/PostFx.jsx`;
  `null` (composer off) means the screen, i.e. the old behavior. **Any future
  pass that changes where the scene is drawn has to keep that bridge honest.**
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

1. ✅ **Freeze the shadow map.** No new effect, pure headroom. Built as
   `runtime/ShadowFreeze.jsx`; the invalidation budget is counted in FRAMES, not
   a boolean, because whoever invalidates (a React effect, a store listener) has
   no guaranteed order against the `useFrame` that spends it. Measured: 108
   frozen / 215 the frame it regenerates, i.e. it **halves the frame**. The
   freeze also applies itself from inside `useFrame` rather than an effect, and
   that is load-bearing — verified by enabling the key light long after mount
   and finding `autoUpdate === false` anyway; three resets it to `true` on every
   remount, which a one-shot effect would miss.
   ⚠️ **Payoff is currently zero**: both shadow lights ship disabled. See
   "Contact shadows" above before counting on this headroom.
2. ✅ **Measure whether the app is CPU- or fragment-bound. ANSWERED 2026-08-02:
   fragment, overwhelmingly, and only when the model fills the viewport.**
   ⚠️ The previous answer here (0.53 vs 0.28 ms, "neither axis saturated") was
   wrong because `ctx.finish()` does not sync on ANGLE — see the retracted row
   in the numbers table. The real figures: **CPU 1.17 ms against an 87 ms
   frame**, cost linear in pixels at ~60 ns/px, and — the measurement that
   settles it — **at rest, cutting the render target to 1/36 of its pixels
   changes nothing** (34.3 → 31.2 ms, and 31.3 is the harness floor), while in
   the zoomed-in state halving the pixels halves the frame.

   So the two states are bound by different things and must be measured
   separately. At rest the app costs ~3 ms/frame and is fine. What is expensive
   is any framing where the model covers the viewport — which `focusGroup` does
   by design, and which no post-processing knob removes, only scales.

   Consequences that overturn earlier prescriptions in this file: half-res AO is
   **not** nearly free (the pass is worth 15 ms, all of it bandwidth), and the
   only knob with real leverage is `pixelRatioCap`.
3. ✅ **Composer with MSAA + ~~relocated tone mapping~~ + SMAA.** Built as
   `runtime/postfx/PostFx.jsx` — minus SMAA, and minus the tone-mapping move,
   which was wrong (see the traps above). **Checkpoint run 2026-08-01, both
   halves passed**, and the method is worth reusing rather than re-deriving:

   *Image identity.* Don't reload to compare — do the A/B **inside one frame**:
   render through the composer, `readPixels` off the default framebuffer, then
   `gl.setRenderTarget(null); gl.render(scene, camera)` and grab again. Same
   camera, same damping state, only the destination differs. Then split the diff
   by local gradient, because a single mean hides the answer: **flat surfaces
   (1,413,204 px, 97%) differed by 0.0043/255 — numerically identical — while
   edge pixels (46,800, 3%) differed by 5.66**, which is the MSAA doing its job.
   Mean luminance 4.221 vs 4.171, i.e. an exposure delta of **+0.02%**: a
   colour-space mistake would have moved the whole image, not one pixel in
   thirty.

   *Warm-up survival.* `gl.info.programs.length` around the first `setOpacity`
   (`GoToRotors`) read **7 → 7, delta 0**. ⚠️ A delta of 0 alone proves little —
   run the counterfactual: drawing **one** frame to the screen instead of the
   composer target compiles **2 new programs**, the exact number this repo
   already measured for the un-warmed case. That is the proof the destination is
   in the cache key and that `warmupTransparency.js`'s `renderTarget` parameter
   is load-bearing rather than decorative.
4. ✅ **Half-res AO** with depth-reconstructed normals. Built as `createAoPass()`
   in `runtime/postfx/PostFx.jsx`, using `three`'s own `GTAOPass`. Three traps
   hit and worked around, specific to using `GTAOPass` off-label this way:
   - `pass.setGBuffer(null, undefined)` — not `(depth, undefined)`, the depth
     argument only matters when a normal texture is supplied — sets
     `NORMAL_VECTOR_TYPE = 0`, reconstructing normals from depth and skipping
     the pass's own normal prepass, which would otherwise cost +108 draw
     calls/frame, the one thing this scene cannot afford.
   - The constructor allocates a normal render target regardless, before
     `setGBuffer` can refuse it, and passing `parameters.depthTexture` to the
     constructor doesn't avoid it either — in that branch `normalRenderTarget`
     is never created and the very next line dereferences it, so the
     constructor throws. The only way out is build → reconfigure → dispose the
     orphan by hand (`pass.normalRenderTarget?.dispose()`); safe because
     `setSize`/`dispose` keep referencing it but nothing ever draws to it.
   - `EffectComposer.setSize` forces every pass back to full resolution on
     resize, so `pass.setSize` is overridden on the instance to defend the
     half-res scale. `aoResolutionScale` is therefore a *structural* setting
     (rebuilds the chain) alongside `aoEnabled`, unlike the AO uniforms below.
   - The pass's `depthTexture` is re-read from `readBuffer.depthTexture` on
     every `render()` call rather than fixed once, because `EffectComposer`
     swaps two render targets with **distinct** depth textures (`clone()`
     duplicates them); today's two-pass round trip makes a fixed reference
     work *by accident*, and a third pass (e.g. the still-unbuilt SMAA) would
     make it flicker at alternating frames instead of erroring.

   The `DepthTexture` this depends on is allocated unconditionally in
   `createTarget()`. Settings split into structural (`aoEnabled`,
   `aoResolutionScale` — rebuild) vs hot-tunable uniforms (`aoRadius`,
   `aoIntensity`, `aoThickness`, `aoDistanceExponent`, `aoSamples` — applied
   without rebuilding); `authoring/PostFxTuner.jsx` is the Leva surface for
   both.

   **Measured in browser 2026-08-01**, and two of the three numbers are only
   meaningful because of *how* they were taken:

   - **112 draw calls/frame** against 108 without AO. The AO adds four
     fullscreen quads (AO, Poisson denoise, copy, blend) and **no geometry
     pass** — that single number is the proof the first trap above actually
     worked. Had the normal prepass still been running it would read ~216.
   - **Crevices darken 3.5× more than exposed faces** (22.2% vs 6.3% relative),
     max occlusion 100%, and **zero pixels brightened**. ⚠️ Measure the
     darkening as `1 - ON/OFF`, **not** as an absolute difference: AO
     multiplies, so a pixel that is already dark loses little in absolute terms
     and an absolute-difference histogram makes real contact occlusion look
     like a flat global dim. That mistake was made first and inverted the
     conclusion — the absolute metric said crevices darkened *less* than faces
     (ratio 0.65).
   - ~~**Cost below the noise floor**: AO-on vs AO-off came out at 1.26 vs
     1.41 ms, the orderings invert, so the effect is smaller than the
     variance.~~ ⚠️ **RETRACTED 2026-08-02.** Those numbers came from
     `ctx.finish()`, which does not sync on ANGLE, so they compared two CPU
     submit times and were always going to look like noise. Re-measured against
     the real rAF interval, **the AO pass costs ~15 ms** in the zoomed-in state
     (87.3 ms with, 73.2 without) — not a rounding error, roughly a sixth of
     the frame. ⚠️ And the cost is **bandwidth, not samples**: `aoSamples`
     16 → 4 changes nothing at all (87.4 vs 87.3). The levers are
     `aoResolutionScale` and, if it ever comes to it, `aoEnabled`; there is a
     hot path for the latter (`pass.enabled`, honoured at
     `EffectComposer.js:232`) that skips the pass without rebuilding the chain,
     should switching it off during animations ever be wanted. It is not done
     today because the AO is the product's only occlusion and it would pop.

   ⚠️ **At full-model framing the AO reads as diffuse depth, not crisp contact.**
   The gaps between keycaps are 1–2 px wide there, and the AO runs at half
   resolution, so they fall below its sampling. Close up it is unmistakable. If
   crisp contact is ever wanted in the wide shot the knob is
   `aoResolutionScale: 1`, but measure before spending it — that doubles the
   axis this scene is most sensitive on.

   Cosmetic, worth knowing: linking the GTAO shader emits
   `warning X4000: use of potentially uninitialized variable` from ANGLE's HLSL
   compiler on Windows. It comes from three's shader, not from this code; the
   program links and the AO renders correctly. It only appears on a cold shader
   cache. If AO ever comes out black on a specific GPU, start there.
5. ❌ **Progressive accumulation at rest — ARCHIVED 2026-08-01, by measurement.**
   It was billed as the biggest quality jump. Measured, it is worth **0.018/255**
   of temporal variation on this asset, and the image is already bit-identical
   frame to frame once settled. See "Anti-aliasing" above for the three numbers
   and, more importantly, for *which* measurement decides: the single-pose
   comparison against a supersampled reference (test 3) says the error is real
   and would have justified building this; only the temporal comparison (test 2)
   shows the error does not oscillate, which is what makes it invisible. Measure
   the variation, not the error.
   Archived with it: the quality-LOD state machine, the convergence threshold on
   the rig's damping, and SMAA (with MSAA 4× already on the render target it
   adds little, and it does nothing for specular aliasing by construction).

What not to do: raise DPR or add a depth prepass "since it's cheap". With 34
lights the first doubles the fragment axis; with 108 draw calls the second
doubles the CPU one. Those are the two moves this scene's profile punishes
hardest.

<!-- END MANUAL -->