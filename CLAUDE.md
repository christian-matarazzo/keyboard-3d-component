<!-- AUTO-MANAGED: project-description -->
## Overview

**keyboard-composer** (`v0.2.1`) — a React + react-three-fiber component that
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
                         # ⚠️ also mounts POST /__author/save-config
                         # (scripts/vite-plugin-author-save.mjs, `apply: 'serve'`),
                         # the endpoint the editor's "Salva" button uses to
                         # OVERWRITE public/<configUrl> in place. Outside the dev
                         # server that endpoint doesn't exist and the button falls
                         # back to downloading the file
npm run build            # production build (SPA/playground, dist/)
npm run build:lib        # npm package build (dist-lib/) — separate Vite mode,
                          # externalizes react/react-dom/three/@react-three/*/leva
                          # ⚠️ ends with `postbuild:lib` → scripts/ssr-smoke.mjs,
                          # which imports AND server-renders the built package on
                          # Node. It is the only check in this repo that runs by
                          # itself; a green Vite build alone never proved the
                          # package was importable under SSR
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

⚠️ **The two outputs are SIBLINGS — `dist/` and `dist-lib/` — and that is a
fix, not a preference.** The package used to build into `dist/lib/`, i.e.
*inside* the SPA's output directory, and `npm run build` deleted it: the SPA
build has `outDir: 'dist'` and Vite applies `emptyOutDir: true` by default, so
it emptied the package's subfolder too. No error, no warning — `build:lib`
followed by `build` simply left no artifact, and you found out at `npm publish`
or at the first import. Don't nest them again to tidy up the root.

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
   ├─ KeyboardModel.jsx                 GLB load (`useGLTF(product.modelUrl,
   │                                    product.dracoPath)` — il percorso del decoder
   │                                    NON è più un globale di modulo, vedi il ⚠️ in
   │                                    testa al file),
   │                                    auto-fit, useComposerControls host — feeds the
   │                                    measured `modelSize` into it for the two-axis
   │                                    fit/`frameCoverage` (see `cameraFraming.js`);
   │                                    also triggers `warmWireframeBuffers` (once,
   │                                    conditioned on the product's authored
   │                                    animations containing a `setWireframe` step
   │                                    — `hasWireframeStep`) alongside the existing
   │                                    transparent-material warm-up
   ├─ useComposerControls.js            drag/keys/spring/camera/zoom/focus; `rotation`
   │                                    read from the store (useComposerSection + a
   │                                    mirror ref for useFrame); owns the TWO-AXIS fit
   │                                    (measured extents from `cameraFraming.js`, not the
   │                                    old `FIT_HALF_WIDTH` constant) and publishes
   │                                    `apiRef.frameCoverage()` — the fraction of the
   │                                    viewport the model covers, which
   │                                    `runtime/postfx/PostFx.jsx` reads as its
   │                                    dynamic-resolution-scale signal. ⚠️ Replaced
   │                                    `focusZoomFactor()`, deleted: zero callers left
   ├─ cameraFraming.js                  pure projection math shared by the fit and the
   │                                    resolution scale: worst-case projected extents
   │                                    over the pose graph, and covered-viewport
   │                                    fraction (box projection × exact silhouette
   │                                    fill, saturating). No three, no React
   ├─ poseGraph.js                      angle primitives + `createPoseGraph` FACTORY
   │                                    (no pose data — that lives per product)
   ├─ products/                         ONE CONFIGURATOR, MANY MODELS
   │  ├─ index.js                       PRODUCTS registry, PRODUCT_IDS enum,
   │  │                                 DEFAULT_PRODUCT_ID, resolveProduct. `getProduct`
   │  │                                 is module-LOCAL (it only injects the registry
   │  │                                 into resolveProduct); `PRODUCT_LIST` and
   │  │                                 `isProductId` were deleted — zero callers
   │  ├─ productSchema.js               defineProduct/resolveProduct + typedefs;
   │  │                                 `assetsBaseUrl` (prefixes only URLs that start
   │  │                                 with `/`) and `dracoPath` per product; also
   │  │                                 exports `DEFAULT_DRACO_PATH` (`/draco/`) so
   │  │                                 `preloadKeyboardModel`'s string-URL form can't
   │  │                                 drift from `defineProduct`'s own default
   │  └─ arrayModelL/                   the first product: poseGraph (21 poses),
   │                                    meshGroups, meshVariants, model+config URLs
   ├─ focusFraming.js                   bounding-sphere group framing measure
   ├─ lightConfig.js                    LA FORMA di un `lights[posa]`:
   │                                    VIEW_SETTING_KEYS/readViewSettings/
   │                                    generateDefaultConfig. Estratte da LightRig
   │                                    quando l'editor è uscito di lì — due
   │                                    consumatori reali (il rig le legge, l'editor
   │                                    le scrive), non un'estrazione preventiva
   ├─ LightRig.jsx                      SOLO il rig, dal 2026-08-03: griglia di luci,
   │                                    scatola adattiva, un useFrame. NON è più
   │                                    "l'editor luci" — il pannello, l'undo e il
   │                                    salva/carica sono in authoring/LightEditor.jsx
   │                                    (~390 righe uscite dal chunk di produzione).
   │                                    Riempie `editorRef` per l'editor e legge la
   │                                    selezione da `store.ui.selectedLight` dentro
   │                                    useFrame; non scrive più su apiRef
   ├─ AnimationDirector.jsx             single useFrame driving the runtime; renders null
   ├─ VariantController.jsx             ISO/ANSI-style variant visibility; also calls
   │                                    `apiRef.invalidateShadows()` after every toggle
   │                                    (frozen shadow maps would otherwise keep
   │                                    casting the outgoing variant's shadow)
   ├─ Hud.jsx                           optional DOM overlay (telemetry, chips, mode
   │                                    button); `branding` prop (logo/version/footer),
   │                                    no hardcoded lockup; off by default (`hud=false`)
   │                                    and LAZY: `lazy(() => import('./Hud'))` in
   │                                    KeyboardComposer.jsx, so its ~430 lines ship in
   │                                    their own chunk instead of every consumer's
   │                                    bundle. ⚠️ The JS splits, the CSS does NOT —
   │                                    see "The authoring CSS ships eagerly"
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
   │  │                                   downstream `aa` (none/FXAA — SMAA was tried and
   │  │                                   removed, see Manual notes; the knob says which
   │  │                                   technique is available, the ratio gate decides
   │  │                                   when it runs), `resolveBox` (the A/B on the 4-tap
   │  │                                   box reduction), pixel-ratio
   │  │                                   cap, dynamicScale +
   │  │                                   frameBudgetMs/fillCostMsPerMpx/aaCostMsPerMpx/
   │  │                                   dynamicScaleMin/dynamicScaleMax, AO
   │  │                                   radius/intensity/thickness/
   │  │                                   distance-exponent/samples — deliberately NOT
   │  │                                   the postfx on/off switch, see
   │  │                                   runtime/postfx/PostFx.jsx); MaterialTuner/
   │  │                                   FocusTuner render one component instance per
   │  │                                   group (Patterns)
   │  ├─ LightGizmos.jsx                  TransformControls + useHelper for the two shadow
   │  │                                   lights; moves `keyLightRef`/`spotLightRef` (the
   │  │                                   real lights are rendered by
   │  │                                   runtime/ShadowLights.jsx) without owning them
   │  ├─ LightEditor.jsx                  L'EDITOR DELLE LUCI, uscito da LightRig.jsx:
   │  │                                   il pannello `<Html>`, la cronologia di undo
   │  │                                   (Ctrl+Z, 50 passi) e salva/carica — pubblica
   │  │                                   `saveConfigJSON`/`loadConfigJSON`/
   │  │                                   `resetActiveView` su apiRef (tutti e tre i
   │  │                                   chiamanti erano già in authoring/). Raggiunge
   │  │                                   il rig via `editorRef`; la selezione passa da
   │  │                                   `store.ui.selectedLight`. Sta in
   │  │                                   AuthoringScene e non in AuthoringDom perché
   │  │                                   `<Html>` va montato dentro il Canvas.
   │  │                                   ⚠️ `saveConfigJSON` SOVRASCRIVE
   │  │                                   `public/<configUrl>` via POST a
   │  │                                   `/__author/save-config` (il plugin dev in
   │  │                                   scripts/), e restituisce una PROMESSA di esito
   │  │                                   `{ok, path}` / `{ok:false, fallback:'download'}`
   │  │                                   — senza endpoint (pacchetto installato altrove)
   │  │                                   ripiega sul vecchio download
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
   │                                      the chain. A downstream AA pass (`aa` in the
   │                                      `postfx` section, 'none'/'fxaa') is the same
   │                                      kind of structural knob — one pass added or
   │                                      removed — imported from
   │                                      `three/examples/jsm/postprocessing/FXAAPass.js`
   │                                      (same externalized peer as the other passes,
   │                                      zero new npm bytes). `AA_PASSES` records not
   │                                      just how to build a technique but WHERE it goes
   │                                      in the chain — FXAA reads post-tonemap sRGB
   │                                      luma so it's added AFTER `OutputPass` — kept as
   │                                      a table (one entry today) because adding a
   │                                      technique back is one line that also states its
   │                                      placement. ⚠️ `SMAAPass` was implemented,
   │                                      measured and REMOVED (2026-08-04): dominated by
   │                                      supersampling on the quality/cost frontier, and
   │                                      its base64 area/search textures cost +40 kB gz
   │                                      in the `three` chunk of every integrator — see
   │                                      Manual notes for the numbers.
   │                                      ⚠️ `aa` says which technique is AVAILABLE, not
   │                                      when it runs: `applyAaGate` drives `pass.enabled`
   │                                      from the target-vs-screen ratio and only within
   │                                      `AA_BAND` (half a tier) of 1:1 — the one regime
   │                                      FXAA measured a win in. No rebuild is involved:
   │                                      `EffectComposer.render()` skips disabled passes
   │                                      and recomputes `renderToScreen` from
   │                                      `isLastEnabledPass` every frame. `wantedScaleRaw`
   │                                      still charges `aaCostMsPerMpx` off the AUTHORED
   │                                      `aa`, never off the live flag — tying the cost to
   │                                      the tier it determines makes the law bistable.
   │                                      `createResolveOutputPass()` replaces the plain
   │                                      `OutputPass`: it string-patches `OutputShader`'s
   │                                      single `texture2D(tDiffuse, vUv)` into a 4-tap box
   │                                      whose offset comes from the live reduction ratio,
   │                                      so a supersampling tier actually reaches the
   │                                      screen instead of being resampled by one bilinear
   │                                      tap (the artifact and its measurement are in
   │                                      Manual notes). Offset 0 below 1:1 → byte-identical
   │                                      to before; a `uniform`, never a `#define`, because
   │                                      `OutputPass.render()` wipes `material.defines`;
   │                                      guarded so a three upgrade that moves the markers
   │                                      degrades to the unpatched pass. Source size is
   │                                      read from the `readBuffer`, not from `setSize` —
   │                                      passes added AFTER `composer.setSize` never get
   │                                      one (the same trap now fixed for `FXAAPass`, which
   │                                      until now ran on its shader's default 1/1024).
   │                                      Cleanup now explicitly `.dispose()`s the AA, AO
   │                                      and output passes before `composer.dispose()`,
   │                                      because
   │                                      `EffectComposer.dispose()` frees only its own
   │                                      two targets and its copyPass, not passes added
   │                                      to it — load-bearing once `aa`/`aoEnabled` are
   │                                      live-editable and rebuild the chain repeatedly.
   │                                      `createAoPass()`
   │                                      builds a half-resolution `GTAOPass` off-label
   │                                      (`aoEnabled` in the `postfx` section, default
   │                                      on): depth-reconstructed normals so it skips
   │                                      its own normal prepass, its constructor's
   │                                      normal render target disposed by hand right
   │                                      after, and `setSize` overridden on the
   │                                      instance so `EffectComposer.setSize` can't pull
   │                                      it back to full resolution on window resize.
   │                                      Also owns the FEED-FORWARD resolution scale
   │                                      (`dynamicScale`/`frameBudgetMs`/
   │                                      `fillCostMsPerMpx`/`aaCostMsPerMpx`/
   │                                      `dynamicScaleMin`/`dynamicScaleMax`): the same
   │                                      `useFrame` reads `apiRef.frameCoverage()` —
   │                                      published by useComposerControls — and applies
   │                                      `scale = √(budget / ((fillCostMsPerMpx·coverage
   │                                      + aaCostMsPerMpx-if-aa-on) · fullPixels))`,
   │                                      clamped to [dynamicScaleMin, dynamicScaleMax],
   │                                      through `composer.setPixelRatio()` alone. The
   │                                      two cost terms are different quantities and
   │                                      can't be summed into one: fill is paid on
   │                                      pixels COVERED by the model, AA is a fullscreen
   │                                      quad paid on every pixel of the TARGET
   │                                      regardless of coverage; with `aa: 'none'` the
   │                                      AA term is zero and the formula collapses to
   │                                      the old one exactly. `dynamicScaleMax` above 1
   │                                      lets the tier supersample (target bigger than
   │                                      screen, downscaled by the final quad) — still
   │                                      bounded by `frameBudgetMs` since it's the same
   │                                      law that grants it — but is further capped by
   │                                      the module constant `MAX_TARGET_MPX` (4, a
   │                                      memory ceiling in megapixels: a multiplier
   │                                      alone doesn't know the window size).
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
   │  │                                  DEFAULT_POSTFX (frameBudgetMs/
   │  │                                  fillCostMsPerMpx — il budget e la taratura
   │  │                                  della scala dinamica, gli unici due numeri
   │  │                                  da rimisurare per macchina;
   │  │                                  msaaSamples/pixelRatioCap —
   │  │                                  render-target tuning; aoEnabled/aoResolution-
   │  │                                  Scale/hdrTarget/aa — structural, rebuild the
   │  │                                  composer chain (all four sit in
   │  │                                  PostFx.jsx's useLayoutEffect deps: `aa` adds or
   │  │                                  removes a pass same as `aoEnabled`); of these
   │  │                                  only `hdrTarget` is absent from
   │  │                                  authoring/PostFxTuner.jsx — aoEnabled/
   │  │                                  aoResolutionScale/`aa` are all tunable there
   │  │                                  despite being structural, since their rebuild
   │  │                                  resizes/swaps a render target rather than
   │  │                                  recompiling scene materials;
   │  │                                  aoRadius/aoIntensity/aoThickness/
   │  │                                  aoDistanceExponent/aoSamples/resolveBox — hot
   │  │                                  uniforms (`resolveBox` gates the 4-tap box
   │  │                                  reduction in createResolveOutputPass: it moves one
   │  │                                  uniform, so it is deliberately NOT in the
   │  │                                  useLayoutEffect deps, and it exists as a knob only
   │  │                                  so the A/B can be done on one frame);
   │  │                                  dynamicScale/frameBudgetMs/
   │  │                                  fillCostMsPerMpx/aaCostMsPerMpx/
   │  │                                  dynamicScaleMin/dynamicScaleMax — the
   │  │                                  feed-forward resolution scale, hot too (they
   │  │                                  only move the tier PostFx.jsx already
   │  │                                  applies per frame; `aaCostMsPerMpx` is a
   │  │                                  per-machine calibration like `fillCostMsPerMpx`
   │  │                                  but priced per megapixel of TARGET, not
   │  │                                  COVERED — the AA quad has no notion of model
   │  │                                  coverage; `dynamicScaleMax` above 1 lets the
   │  │                                  tier supersample, 1 is the historical
   │  │                                  reduce-only ceiling);
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
                                        production actually draws, see runtime/postfx/;
                                        its sibling export `warmWireframeBuffers`
                                        (2026-08-03) pre-builds the wireframe line-index
                                        buffer, called once from KeyboardModel.jsx when
                                        the product's animations contain a
                                        `setWireframe` step
public/
├─ models/keyboard.glb                  ARRAY_MODEL_L's GLB (`product.modelUrl`),
│                                       authored in MILLIMETERS
├─ ar/keyboard-ar.glb                   the AR playground button's asset, generated
│                                       by `scripts/make-ar-asset.mjs`: metric
│                                       scale + baked materials + one variant, i.e.
│                                       everything the configurator would otherwise
│                                       apply at runtime. Never read by the
│                                       configurator itself
├─ draco/                               decoder; il percorso arriva da
│                                       `product.dracoPath` e viene passato
│                                       esplicitamente a ogni useGLTF
└─ lightconfig/app-state-config.json    ALL authored state of ARRAY_MODEL_L —
                                        the sections are exactly
                                        state/composerStore.js's COMPOSER_SECTIONS
                                        (lights, materials, rotation, keylight,
                                        spotlight, focus, animations, variants, app,
                                        postfx). Path comes from `product.configUrl`;
                                        new products default to
                                        /lightconfig/<ID>/app-state-config.json
dist-lib/                              the npm package artifact (`npm run build:lib`),
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
scripts/ssr-smoke.mjs                  imports the built `dist-lib` and
                                        `renderToString()`s the component on Node —
                                        an SSR regression guard, not an asset
                                        pipeline step. Runs AUTOMATICALLY as
                                        `postbuild:lib`, so `npm run build:lib`
                                        fails if the package stops being
                                        importable on the server. See "The package
                                        must import on Node" in Manual notes
scripts/vite-plugin-author-save.mjs    dev-server-only (`apply: 'serve'`) plugin
                                        wired in vite.config.js: POST
                                        /__author/save-config writes a JSON body
                                        into `publicDir` after validating path
                                        (root-relative, `.json`, resolved inside
                                        public/, existing directory) and content
                                        (re-parsed), atomically (tmp + rename).
                                        It is what makes the editor's "Salva"
                                        overwrite the served config instead of
                                        downloading a copy. ⚠️ Never reachable from
                                        `dist/` or `dist-lib/` — a Vite plugin is
                                        build tooling, not bundled code
```

Data flow, in two directions:
- **Commands** cross the DOM/Canvas boundary through one imperative ref,
  `apiRef` — a multi-writer bridge written **only** via
  `Object.assign(apiRef.current, {...})`, never reassigned. **Eight writing
  files, nine call sites**: VariantController, `authoring/LightEditor.jsx`
  (`saveConfigJSON`/`loadConfigJSON`/`resetActiveView` — it took them over from
  LightRig, which no longer writes to the bridge at all), AnimationDirector,
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
- **`store.ui` also carries the light editor's SELECTION**
  (`selectedLight`, a `` `${layer}_${index}` `` **string**) and the rig's
  `activePose`. Same shape as `editMode`/`homePose` and for the same reason:
  the two sides read it in different regimes — `authoring/LightEditor.jsx`
  reactively (it redraws the panel), `LightRig.jsx` non-reactively inside
  `useFrame` via `store.get('ui')` (it highlights the right helper), so neither
  a prop nor a ref would serve both. ⚠️ It is a string and not `{layer, index}`
  because `set` compares sections with `shallowEqual`, i.e. `Object.is` per
  value: a fresh object every click is always unequal to itself and would
  publish a new snapshot — and a re-render — even when reselecting the same
  light.
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
- **Superficie pubblica: si esporta ciò che qualcuno chiama, non ciò che
  potrebbe servire.** Tolti nel 2026-08-03, tutti con ZERO chiamanti dentro e
  fuori (il pacchetto non è mai stato pubblicato): `PRODUCT_LIST` e
  `isProductId` (cancellati — con un prodotto solo sono una lista di uno e un
  confronto fra stringhe, e si riscrivono in una riga da `PRODUCTS`),
  `getProduct` (resta ma è locale a `products/index.js`), `DEFAULT_MODEL_URL`
  (locale a KeyboardModel.jsx), le tre prop `modelUrl`/`meshGroups`/
  `meshVariants` di `KeyboardComposer` e il parametro `overrides` di
  `resolveProduct` che le applicava. Export della radice: 16 → 13.
  ⚠️ Le tre prop non erano solo inutilizzate, erano una SECONDA STRADA per fare
  ciò che `product={{ ...ARRAY_MODEL_L, modelUrl: '…' }}` già faceva — con in
  più il difetto di scavalcare `defineProduct`, cioè la validazione. Il criterio
  non è "un export non costa niente": è che due strade per lo stesso risultato
  divergono, e quella non validata è la peggiore delle due.
- **Nessun globale di modulo per un valore che dipende dal prodotto.** Il
  percorso del decoder Draco è stato l'ultimo (`let dracoPath` +
  `getDracoPath`/`setDracoPath` in KeyboardModel.jsx, scritto da
  `KeyboardComposer` DURANTE il render e letto da sette `useGLTF`). L'argomento
  che lo giustificava era corretto ma incompleto: la cache di drei è indicizzata
  per `(url, dracoPath)`, quindi due valori diversi fra i chiamanti = due
  decoder e **due scaricamenti** dello stesso GLB da 1,5 MB. Solo che il modo di
  garantire un valore solo non è un globale — è passare lo stesso oggetto
  congelato. Ora tutti e sette leggono `product.dracoPath`, quindi la coerenza è
  STRUTTURALE invece che temporale ("chiama `setDracoPath` prima che qualcuno
  legga"). ⚠️ Il globale contraddiceva anche l'argomento con cui è nato lo store
  (composerStore.js, punto 2 «UNA PAGINA, DUE COMPONENTI»): due
  `<KeyboardComposer>` con prodotti diversi se lo sovrascrivevano a ogni render.
  Il controllo statico che sostituisce l'ispezione del pannello Network: ogni
  `useGLTF(` deve prendere ENTRAMBI gli argomenti dallo stesso `product`.
- **A green build does not verify a removal.** An undefined capitalized JSX
  tag left behind after deleting its import is a runtime `ReferenceError`,
  not a build error — Rollup/Vite won't flag it, and it can reach production
  as a blank screen. Grep for a component's remaining JSX usages after
  removing its import; don't trust the build alone.
- **The saved file is `store.toJSON()`, never a hand-written section list.**
  `handleSaveJSON` (now `authoring/LightEditor.jsx`, formerly LightRig.jsx)
  used to build its payload by naming each
  section, and `postfx` — added later — silently never reached the file: the
  JSON stayed valid, reloaded without error, and the whole post-processing
  tuning fell back to `DEFAULT_POSTFX` on every reload, because `hydrate` skips
  absent sections by design. **A new section added to `COMPOSER_SECTIONS` must
  be picked up by both directions for free**, or the next one repeats the bug.
  ⚠️ The cheap static check for the round trip, worth re-running after touching
  either direction: `hydrate` the shipped config into a fresh store and compare
  `toJSON()` to the file. ⚠️ **Re-run 2026-08-03 after adding `frameBudgetMs`/
  `fillCostMsPerMpx` to `postfx` and `focusMargin` to `rotation`: all ten
  sections identical and ZERO of the eleven animations drift.** An earlier run
  the same day found four drifting (`GoToRotorsAlt · inverso`,
  `GoToPatches · inverso`, `Esploso`, `Esploso · inverso`) because they had been
  hand-written into the JSON with a different key order and no `loop.times`/
  `loop.from`; the file has since been re-saved from the editor, which
  normalised them. Don't treat "four known names" as the expected baseline any
  more — the baseline is now zero, which is a stricter and more useful check.
  **Compare per animation, not per line**, so that a single new drift stands
  out. A missing SECTION is invisible in review AND in the browser; only that
  diff catches it, and it still does. ⚠️ **What this check does NOT catch is a
  new KEY** — checked, not assumed: `hydrate` REPLACES a section with the file's
  own keys rather than merging them over the defaults, so a key added to
  `DEFAULT_POSTFX` but not to the shipped JSON is simply absent from the store,
  the round trip stays green, and the only thing keeping the feature alive is the
  reader's own `{ ...DEFAULT_POSTFX, ...section }` spread (which is why that
  spread in `runtime/postfx/PostFx.jsx` is load-bearing and not defensiveness).
  Adding a section key therefore means adding it to the authored JSON too, or the
  authored file and the code drift with every signal green.
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
- **README.md carries its own mermaid diagrams** (architecture overview, the
  authored-state round-trip, the consumer bundle/chunk layout, the animation
  sequencer, and the dynamic-resolution control law — "La risoluzione segue il
  carico, non lo zoom") that restate facts also tracked here — the component
  tree, the COMPOSER_SECTIONS list, the apiRef writer count, the chunk split
  (core/authoring gzip sizes included), and the feed-forward resolution scale
  (`dynamicScale`/`frameBudgetMs`/`fillCostMsPerMpx`/`aaCostMsPerMpx`/
  `dynamicScaleMin`/`dynamicScaleMax`, plus the claim that fill cost is
  SUPERlinear in covered pixels). A structural change to any of those has two
  places to update, and the diagrams are the easier one to leave silently
  stale.

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->

# Manual notes

Everything below is hand-written and must not be regenerated. It records
a general overview of the entire project with key features catalogued,
**measured numbers, traps already hit, and deliberate decisions** — the things
that cost real time to re-derive and that are not recoverable by reading the
code. Structural facts (what a file is, where state lives) belong in the 
auto-managed sections above; this section is for *why* and *how much*.
This section must be kept trimmed and does not have to be bloated with
conversational constructs, and has to be modified only when meeting the cases
described before.

CORE ARCHITECTURE & INVARIANTS
- Camera Distance: Product of `baseRadius` (fit), `userZoom` (wheel), and `focusZoom` (focus). 
- Zoom & Focus: `focusZoom` is a relative factor. Framing relies on pose-independent bounding spheres.
- Config Mapping: Grid prefix + index exact match config JSON keys (e.g., `top_0_intensity`). DO NOT rename.
- Adaptive Light Box: Stretches based on mesh bounds; does not translate.
- State Exclusivity: Group focus and Mesh editor must never be active simultaneously.
- Dynamic Fit: Expand-only to prevent clipping deformed models in editor; already scaled when it runs.
- Wheel Zoom: Active ONLY in `?debug` authoring mode.
- Missing Inverses: Global restore (`clearFocus`) overrides explicit inverses if both exist. Global restore handles un-inversed steps.

BUILD & TEST COMMANDS
- Node Import Test: `node --input-type=module -e "import('./dist-lib/keyboard-composer.js')"`
- SSR Smoke Test: Runs via `scripts/ssr-smoke.mjs` on `postbuild:lib`. Catches errant `window` calls.
- Save Config: POSTs to `/__author/save-config`. Overwrites `public/` directly (Vite skips reload for non-graph files).
- Force Frames: Use `st.advance(T)` with `frameloop: 'never'`. Wall time `st.clock.elapsedTime` is in seconds.

PERFORMANCE & PROFILING RULES
- Bottleneck: Scene is fill/bandwidth-bound, NOT CPU or ALU bound. Scale estimates off VIEWPORT size, not model complexity.
- Render Profiling: `ctx.finish()` does NOT sync on ANGLE/D3D11. ALWAYS use median real rAF interval.
- Floor Baseline: Subtract harness rAF floor (~31ms) before evaluating optimizations. Re-measure in the same session.
- Shader Compiles: Count via `gl.info.programs.length`. Do NOT use frame timing for compilation drops.
- Anti-Aliasing: Progressive accumulation discarded (static scene is bit-identical; temporal shimmer negligible). MSAA is now OFF: at `pixelRatioCap` 1 it costs 6.0-8.2 ms and supersampling buys the same edge for less. Order on the quality/cost frontier: supersample > MSAA > FXAA > SMAA. SMAA implemented, measured, removed.
- Measuring below vsync: a 60 Hz rAF median saturates at 16.7 ms and hides everything under it. Use `EXT_disjoint_timer_query_webgl2` around `composer.render()` alone. Read absolute values only in the SATURATED regime — under vsync the iGPU downclocks between frames and the same config drifts 10 -> 17 ms.
- ⚠️ "Around `composer.render()` ALONE" is the load-bearing half, and a timer query opened in one rAF turn and closed in the next does NOT satisfy it: TIME_ELAPSED spans the GPU timeline including the idle wait for vsync, so at rest it reads ~16.7 ms whatever the render costs (measured: ON 16.36/16.24 vs OFF 16.67/16.56 — the wrong sign, i.e. pure noise). Without touching the source the way out is to push the frame ABOVE vsync first (`frameBudgetMs` 60 + `dynamicScaleMax` 2 lands it at ~20 ms) and read the delta there.
- Driving the app from the console without editing the source: `window.__kb` is the public API but only in `?debug`, and it does not expose the store. The per-instance store is reachable from the canvas' React fiber — `canvas[__reactFiber$…]`, walk `.return` to the first `memoizedProps.store` with `get`/`set` (7 hops). That gives a live A/B on the SAME frame instead of a reload, which matters because a reload wipes the reference capture. To read pixels, `canvas.getContext('webgl2')` returns the same context and a rAF registered while the loop is running is queued AFTER R3F's for that turn, so `readPixels` on the default framebuffer still sees the frame.
- ⚠️ Measure a still scene or measure nothing: an early `resolveBox` A/B at the end of `GoToRotors` reported 807k differing pixels and 30-vs-58 ms medians, all of it the camera still damping. The cheap guard is two captures ~1 s apart with nothing touched — it must return 0 differing pixels before any A/B is believed.
- Edge quality: mean per-pixel RGBA delta on EDGE pixels (local luma gradient mask, ~2.9% of the image) against the 2x supersampled frame — captured off the screen framebuffer inside the frame, since the final quad already downsamples it with an exact 2x2 box.
- ⚠️ That "exact 2x2 box" is a property of the ratio 2, NOT of the final quad. `OutputShader` does ONE `texture2D(tDiffuse, vUv)`, and a bilinear tap weighs 2x2 texels — at the shipped tier 1.4 it skips whole texels, so every ss>1 row of the edge-error table was measured with the supersample HANDICAPPED. Re-measure them before reopening the MSAA comparison; do not delete them, date them. Fixed 2026-08-04 by `createResolveOutputPass` (4-tap box, offset from the live ratio).
- ⚠️ The metric is blind to the artifact users report. Mean per-pixel delta prices a STRUCTURED error (a staircase) the same as an unstructured one (blur) — which is how a config that wins the table can still show a visible stairstep. Diagnose reported artifacts on the pixels, not on the aggregate.
- Diagnosing an edge artifact from a screenshot: decode the PNG and read the luma columns. The 2026-08-04 case (body chamfer, near-vertical): two 1px-wide ridges, peaks 115-126 over a local 60 (2:1 sRGB, 4.3:1 linear), drifting 1px every 24 rows and in phase — a slope of 1/24 point-sampled, not a resolution problem. Silhouette going 123 -> 11 -> 0 in one pixel also proves the frame was NOT upscaled, which rules out the dynamic scale before touching it.
- ⚠️ `aa` is not free even when its pass never fires: `wantedScaleRaw` charges `aaCostMsPerMpx` off the AUTHORED value. It must — charging off the live gate makes the law bistable (at coverage 0.183 both tier 1.0 and 1.1 are self-consistent). Arithmetic on the shipped config (1920x855, dpr 1, budget 14, fill 35): turning `aa` on costs one supersample tier at coverage 0.183 (1.1 -> 1.0) and 0.149 (1.2 -> 1.1), none at 0.053. Hence ARRAY_MODEL_L stays `'none'` while the library default stays `'fxaa'` (with `dynamicScaleMax` 1 the tier sits at 1 anyway, so it is pure gain).
- Passes added after `composer.setSize()` never receive a `setSize` — `EffectComposer.setSize` only walks the passes already in the list. `FXAAPass` therefore ran on its shader default (1/1024, 1/512) until the first window resize. Call `pass.setSize(w, h)` by hand after `addPass`, or read the size off the `readBuffer` inside `render` (what the output pass does).
- Focus state is floor-bound, not budget-bound: at coverage 0.95 the law wants scale 0.506 and `dynamicScaleMin` 0.6 stops it. Recalibrating `fillCostMsPerMpx` does not move it (even 35 -> 24 lands at 0.599) — only `frameBudgetMs` does, and holding tier 1.0 there would cost ~55 ms/frame (~18 fps). Downstream AA cannot help below 1:1 either (measured). The only 0 ms lever left in focus is the source contrast of the crease itself (material), which is a product decision.
- Geometry Passes: Avoid adding them (e.g., normal pre-passes). 
- Material Compilation: Fading a subset flips `transparent` and clones materials. `wireframe` warm-up builds indices silently during zero-fill fades.
- Stutter Hunting: Test on `npm run preview` w/o `?debug`. Stutter peaks (>60ms) at rest are often Leva/dev-server overhead.

AR PIPELINE & ASSETS
- Unit Conversion: Raw GLB is in millimeters. `scripts/make-ar-asset.mjs` wraps roots in `__AR_METRIC_ROOT` (scale 0.001) for AR.
- Material Baking: GLB materials are ignored. Script bakes config colors (converting hex to linear `baseColorFactor`).
- Variants: Script detaches losing nodes (e.g., ISO vs ANSI) instead of array compaction to preserve binary indices.
- Quick Look Quirks: Needs `<a rel="ar">` with 1x1 GIF child, and USDZ must be passed as a `File` (not Blob) to retain extension.
- Three.js Chunking: `USDZExporter` is split into its own chunk via Vite `EXTERNAL` rules to avoid bloating standard visitors.

MEASUREMENTS & METRICS

| Metric / Component                      | Value / Detail                                              |
|-----------------------------------------|-------------------------------------------------------------|
| Draw calls / frame                      | 108 (with shadow map frozen)                                |
| Shadow map regeneration                 | +107 draw calls (doubles the frame)                         |
| Forward lights in config                | 32 active (26 point, 6 rectArea). Shadow casters disabled.  |
| Transparent shader compile (cold vs hot)| 192 ms vs 0.4 ms                                            |
| AO pass draw calls                      | +4 (4 fullscreen quads, skips normal prepass)               |
| Crevice darkening (AO)                  | 22.2% vs 6.3% exposed faces (3.5x ratio)                    |
| Static frame difference                 | 0 (bit-identical across 1.4 Mpx)                            |
| Fill cost (zoomed)                      | ~60 ns / pixel (Linear scale)                               |
| CPU cost / frame                        | 1.17 ms (~1.3% of an 87 ms frame)                           |
| Frustum culling (GoToRotors zoom)       | 112 -> 69 draw calls                                        |
| 8-bit target (`hdrTarget: false`)       | -9.2% frame time cost                                       |
| Clearcoat OFF                           | 0 ms difference (below noise floor)                         |
| AO samples (16 -> 4)                    | 0 ms difference (cost is bandwidth, not arithmetic)         |
| PixelRatioCap (2.0 -> 1.25)             | 9.1/255 visual error on 2% edge pixels                      |
| Dynamic scale (Worst state)             | -28% wall clock cost, 0.49x pixels                          |
| `resolveBox` ON vs OFF, at rest (TL)    | 31,527 px differ = 1.92% of the frame, mean 3.31/255 on those, max 39 — confined to edges (edge mask is ~2.9%) |
| `resolveBox`, edge partial coverage     | rows with the boundary pixel >80% covered: 66.0% -> 47.1%; mean coverage 0.830 -> 0.737; resolved edge rows 338 -> 465 |
| `resolveBox` in the saturated state     | 0 px differ (tier < 1, the offset-0 branch) — byte-identical, so it cannot cost anything where it cannot help |
| `resolveBox` cost                       | below the harness floor: at ~20 ms/frame ON 19.93/19.88/20.09 vs OFF 20.17/19.88, i.e. -0.06 inside a 0.21 ON-ON spread. Upper bound <0.2 ms on 1.64 Mpx of screen (<0.12 ms/Mpx, vs 1.3 measured for FXAA's ~12 taps) |
| FXAA ratio gate                         | at 1:1 (dynamicScale off) `aa` none vs fxaa = 45,363 px differ (pass runs); supersampling = 0 px differ (pass off, and `renderToScreen` correctly handed back to the output pass) |
| Config JSON size                        | 97,010 B (round-trip: 10/10 sections and 11/11 animations identical) |
| Authoring CSS size (Eagerly loaded)     | 12.33 kB (3.30 kB gzipped)                                  |
| Wireframe Triangles (Total)             | 338,586                                                     |
| Wireframe Triangles (Keycaps)           | 144,704                                                     |
| Wireframe Triangles (Damping)           | 69,490                                                      |
| Wireframe Triangles (Viti/Body/Rotors)  | 62,152 / 36,664 / 20,160                                    |
| Wireframe Line Indices Size             | ~8 MB                                                       |
| Wireframe Fade Cost (`depthWrite: false`)| Drops to ~6 fps                                             |
| Transparent Opacity (0.2 on ~105 meshes)| ~8% frame cost (79.8ms -> 86.7ms)                           |
| `RADIUS_MIN` / `FIT_RADIUS_MIN`         | 0.8 / 5.2                                                   |
| `KEY_DEBOUNCE_MS` / `AXIS_DEADZONE`     | 300 ms / 6 px                                               |
| `BOX_REFRESH_FRAMES`                    | 4                                                           |
| `commitFraction`                        | 0.2                                                         |
| `focusDamp` / `focusOutDamp`            | 0.6                                                         |
| Dynamic Fit Margin                      | 1.5                                                         |
| Focus Margin                            | 1.6                                                         |
| Dynamic Scale Budget                    | 14 ms                                                       |
| Fill Cost per Mpx                       | 35 ms (Triples between small and large targets)             |
| Remote Harness rAF Floor                | ~31.3 ms (Can drift to 39.3ms, re-measure often)            |
| Local Chrome rAF floor (2026-08-04)     | 16.7 ms — plain vsync, NOT the remote ~31 ms. Re-measure it: which floor applies changes every conclusion |
| Wireframe Warm-up                       | 24.2 ms (cold CPU sync) vs 0.4 ms (hot)                     |
| Dev+Debug Stutter Peaks                 | Up to 114 ms (0 peaks >60ms in production w/o ?debug)       |
| Fullscreen Focus (`pixelRatioCap` 1.0)  | 17.1 ms (-58% cost from 40.1 ms at cap 1.32)                |
| AR Asset Metric Scale                   | x 0.001 (Model authored in mm: 332.5 x 42.7 x 148.8)        |
| AR Reachable Mesh Nodes                 | 103 (Keycaps 80, body 8, damping 5, etc.)                   |
| USDZExporter Chunk Size                 | 11 kB (3.7 kB gzipped)                                      |
| `three` chunk: +`FXAAPass` / +`SMAAPass` | 465.2 -> 466.7 (+1.4) / -> 505.4 kB gz (+40, base64 textures) |
| AA matrix, GPU ms (rest 0.15 / sat 0.96) | msaa0 10.3/63.4 · +fxaa 12.7/65.6 · msaa2 16.3/71.7 · +smaa 18.4/70.6 · msaa4 19.2/75.7 · msaa2+fxaa 22.6/77.2 |
| MSAA 2x cost                            | +6.0 ms at rest, +8.2 saturated (3.7-5.0 ms/Mpx of target)  |
| FXAA / SMAA cost per Mpx of target      | 1.3 / 4.4 ms                                                |
| Edge error vs 2x supersample (lower=better) | msaa4 3.97 · ss1.4 4.00 · msaa2 4.61 · ss1.2 4.72 · smaa 4.88 · fxaa+ss1.2 5.01 · fxaa 5.16 · none 6.27 |
| SMAA chain placement                    | after `OutputPass` 4.88 vs before 5.98 (three's doc says before) |
| FXAA below scale 1                      | HURTS: 11.35 vs 10.14 at 0.6, 8.25 vs 7.66 at 0.8           |
| Shipped config, rest (1920x855, dpr 1)  | before msaa2: 16.1 ms GPU, rAF p90 33.5 · after msaa0+ss1.2: 12.5 ms, p90 16.8, 0 frames >25 ms |
| Shipped config, vertical orbit (7 poses)| dropped frames 75/350 (21%) -> 31/395 (7.8%)                |
| Tier over the 21 poses (`dynamicScaleMax` 1.4) | 1.1 / 1.2 / 1.4 by coverage (0.183 / 0.149 / 0.053); 6 changes, 0 bounces |

<!-- END MANUAL -->