# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status: WIP

This is an in-progress build, not a finished deliverable. Two things are
tangled together in the current code and must stay conceptually separate
going forward:

1. **The debug/authoring playground** (everything gated by, or living
   alongside, the `?debug` query flag): live Leva panels for tuning
   lights/materials/rotation feel, a per-pose volumetric light editor with
   save/load-to-JSON, and a mesh inspector with transform gizmos. This is a
   tool for finding numbers, not something end users see.
2. **The actual deliverable component**: a `KeyboardComposer` capable of (a)
   navigating the model between fixed product poses, (b) driving lighting
   for those poses, (c) producing zoomed/framed views of the model, and (d)
   **playing authored animations** that compose (a)–(c) plus opacity and
   transforms into named, saved sequences. All four exist today.
   **(c) is the group focus** — named, authorable
   framings on the logical mesh groups (`focusGroup`/`clearFocus`, see "Zoom"
   under "Interaction + animation"), not the free-form wheel
   multiplier. The wheel is now **authoring-only**: its listener isn't
   registered outside `?debug`, so in production the group focus is the only
   zoom there is — and it is reached **only from an authored animation's
   `focusGroup` step**, since the HUD's chip row for it was removed (see
   "HUD"). Not built (and not planned as of this writing):
   *per-pose* framings — the focus is currently one framing per group,
   deliberately pose-independent. (An exploded-view feature was built and then deleted outright in
   favor of the more general group/mesh selection-and-transform mechanism
   in `MeshController.jsx` — see "Mesh editor" below. It is now reachable as
   an *authored animation step* (`transformOffset` with `perMesh: true`, see
   "Animations"), not as a hardcoded feature. There is still no hardcoded
   exploded-view UI.)
   **(d) is the animation system** (`animation/`, `AnimationDirector.jsx`,
   `AnimationEditor.jsx`) — a step sequencer, authored in `?debug`, saved into
   the same JSON blob as everything else, played in production from a row of
   HUD chips or `apiRef.current.playAnimation(id)`. It **replaced the
   keyframe Timeline**, which was deleted outright: don't go looking for
   `Timeline.jsx`, `timelineApiRef`, `editMode 'timeline'` or
   `keyframesBySelection`, and don't reintroduce them.

   These four are exposed to the end user through **two product modes** —
   `idle`, where the model is simply turned by hand, and `config`, where the
   gestures go quiet and everything (views, variants, framings, animations) is
   driven from HUD buttons. That split, not just the `?debug` flag, is what
   separates "looking at the product" from "configuring it"; see "App mode"
   below.

Planned render-quality work (anti-aliasing, inter-mesh contact shadows) is
**designed but not implemented** — see "Planned work: anti-aliasing and
contact shadows" at the end of this file. Like the product zoom above, treat
it as still to build, not something to go looking for.

When making changes, keep debug-only controls/UI behind the `DEBUG` flag
(`new URLSearchParams(window.location.search).has('debug')`, redefined
per-file — see below) rather than leaking them into the always-on product
UI. Mesh selection/`TransformControls` (`MeshController.jsx`, driven by the
`onPointerDown` handler on the model's `<primitive>` in
`KeyboardModel.jsx`) is gated this way: the handler no-ops unless `DEBUG` is
true, so `selectedMesh` never gets set (and `MeshController` never renders
its gizmo) outside `?debug`.

Within `?debug`, the mesh editor and the light editor (`LightRig.jsx`'s
per-pose volumetric rig, see below) are further gated by an exclusive
**`editMode`** (`'none' | 'lights' | 'meshes' | 'anim' | 'focus'`, a Leva
select in `Scene.jsx`, threaded as a prop into `KeyboardModel`/`LightRig`/
`MeshController`/`AnimationDirector`). `'focus'` is the group-framing
authoring mode and behaves
like `'lights'`, not like `'meshes'`: no clicks, no gizmo, **navigation stays
live** (framings are tuned while stepping through poses), and it only gates
the visibility of its own Leva folders. `'anim'` (the animation editor) is in
that same family for the same reasons — animations are previewed while
navigating, and they drive pose/focus themselves — with the extra rule that
entering `'meshes'` **stops any running animation** (see "Animations").
The mesh editor and the light editor used to be
simultaneously live any time their own toggle was on (mesh clicks always
active in debug; light helpers active whenever `showHelpers`/
`showSurfaces` was checked), which meant a single click on the model could
select a mesh *and* a light helper underneath it at once: `onPointerDown`
(the model's click handler) and `onClick` (the light helpers') are
independent R3F event pipelines raycast separately, so `stopPropagation()`
on one never blocks the other. The actual fix is not just gating the click
handlers — it's setting `raycast={() => null}` on the inactive subsystem's
hit-test geometry in `LightRig.jsx`, which removes it from the
raycaster's intersection list entirely, for every event type at once.
(Never assign `raycast={undefined}` there — that sets an own-property
shadowing `THREE.Mesh.prototype.raycast` with `undefined`, and three.js's
raycaster crashes trying to call it; always assign a real function, e.g.
`THREE.Mesh.prototype.raycast` to restore default behavior.)

`Scene.jsx` sets
`controlsDisabled={editMode === 'meshes' || (appMode === 'config' && editMode
=== 'none')}` — **two independent sources** suspend canvas drag/arrow-nav.
`editMode === 'meshes'` is the authoring one: navigation keeps working in
Lights, Focus and Anim, since the volumetric rig's config is per-pose, the
group framings are checked pose by pose, and animations are previewed while
orbiting — tuning any of them requires being able to still step through views.
`appMode === 'config'` is the *product* one (see "App mode" below); it is
deliberately conditioned on `editMode === 'none'` so that toggling into config
mode while an authoring editor is open doesn't freeze the very navigation that
editor needs. Mouse-wheel zoom is a
separate flag entirely — `useComposerControls.js`'s `onWheel` handler has
no `disabled` check at all, so *within `?debug`* it stays live in every
`editMode` including Mesh, unlike drag/arrow-keys which do check
it. Outside `?debug` the wheel listener is never registered in the first
place (see "Zoom" below).

**App mode (`'idle' | 'config'`) — the product-level state machine.** Not to
be confused with `editMode`, which is authoring-only and lives in `?debug`.
The state lives in `KeyboardComposer.jsx` (plain React state, like
`animations` and the variant selection: that component renders both the Canvas
subtree and the DOM overlays, so it travels as an ordinary prop — only the
*command* goes onto `apiRef` as `appMode()`/`setAppMode()`/`toggleAppMode()`).

- **`idle`** is the bare product: the model is turned **by hand** (drag +
  arrow keys) and the HUD is reduced to lockup, telemetry, footer and the one
  `Configura` button. No pager, no chips.
- **`config`** is the opposite: drag/arrow-nav is **off** and everything is
  driven from buttons — the variant chips and the **animation chips**. This is
  the answer to "authored animations must be triggered in production by
  dedicated buttons": with the gestures suspended there can't be two writers on
  the pose/zoom targets while a sequence runs.
  ⚠️ **The `01–05` pose pager and the group-focus chips are GONE** — deleted,
  not hidden (see "HUD"). Poses and framings are still live primitives
  (`goTo`, `focusGroup`/`clearFocus`), but the only product surface that
  reaches them is an authored animation.

Transitions (`changeAppMode` in `KeyboardComposer.jsx`): **both** directions
`resetAnimationProgress()` (sequence progress — see "Sequences" — restarts from
the first link, for the same reason the pose does), then
`clearFocus()`, `stopAnimation()` and `goTo(homePoseKey)` — the home pose is
where *both* modes start, so an authored animation always begins from the same
known state instead of wherever the user left the model while turning it by
hand. `stopAnimation()` *is* the teardown of opacity/pivots and therefore runs
before the camera move. It used to run on `config → idle` only; it runs in
**both** directions now because the product HUD no longer stops anything by
hand (see "What stops an animation"), which makes the mode switch the one place
where the scene is guaranteed to return to a known state — and an
`idleAnimation` authored without `stopOnFinish` would otherwise carry live
instances into the next configuration session. The side effects sit **outside**
the `setState` updater on purpose: an updater must stay pure (StrictMode re-runs
it), so the current mode is read from `appModeRef`.

**`config → idle` can instead be an authored animation** — `app.idleAnimation`
(a bound animation id, `''` = the plain transition above), picked in
`AnimationEditor`'s "transizioni" block. When one is bound, `changeAppMode`
plays it and does **nothing else**: no `clearFocus`, no `goTo` — the animation
owns the whole return and authors those steps itself.

⚠️ Two non-negotiable details, both already paid for once:
- it is played with **`keep: true`**. A reset play would tear down exactly the
  state the animation exists to undo, and its `clearFocus`/opacity steps would
  find nothing left to fade (the same trap documented under `clearFocus`);
- that means it **inherits the previous animation's instances**, so it wants
  **`stopOnFinish`** on (see "Animations"), or a `spinGroup` keeps spinning in
  idle. The editor warns when the bound animation doesn't have it.

Accepted nuance: while the return animation runs, `appMode` is already `idle`,
so drag/arrow-nav is live and a user grabbing the model mid-transition fights
it for the pose target. It resolves when the sequence ends.

⚠️ **The gate is the HUD, not the runtime.** `playAnimation` has no app-mode
guard: `AnimationEditor`'s ▶ and the `?debug` console handles must keep
working while authoring, and in production the chips are the only surface that
can reach it anyway.

**Home pose — one knob, three uses.** `Scene.jsx`'s second Leva control is
`homePose` (default `'TL'`, options built once at module load from
`POSE_COORD`/`POSE_HUD_LABEL` — `POSE_HUD_LABEL` has intentionally
duplicate short labels across poses, e.g. `'TL'`/`'TR'`/`'CFB'` all read
`'3/4 FT'`, so the Leva `options` keys append the raw pose key to stay
unique: `` `${label} · ${key}` ``). It used to be `lockedPose`, serving Mesh
mode alone; it now also drives (a) the **landscape entry pose** and (b) the
pose `config → idle` returns to. It ships in the JSON under the top-level
`app` key (`app-load-app` — see "Persistence" in the
animations section for the three sites that must stay in sync).

⚠️ **`window.__STATE_APP` has exactly one writer: `KeyboardComposer.jsx`.**
The `app` section also carries `idleAnimation` and the release timings, which
live there — so `homePose`, though it *is* a Leva control in `Scene.jsx`,
travels **up** via an `onHomePoseChange` callback instead of Scene writing the
global itself. Two writers on one `__STATE_*` object would overwrite each
other's keys (unlike `apiRef`, nothing here does `Object.assign`). The
`app-load-app` event, by contrast, has two listeners — Scene's (which pushes
`homePose` back into Leva) and KeyboardComposer's (everything else) — which is
the same one-listener-per-consumer shape `app-load-materials` already uses.

Two consequences of it being authorable:
- **Portrait entry is deliberately NOT the home pose.** `KeyboardModel.jsx`
  keeps `ENTRY_PORTRAIT` (TOP through `PORTRAIT_YAW_OFFSET`) on tall screens:
  that entry is a *fit* decision, not a product pose, and routing it through
  `homePose` would also make the frozen `yawOffset` inference (see "Pose
  graph") depend on an authored value.
- **`initialRotation` is read once**, while the JSON arrives asynchronously
  after mount. So `KeyboardModel.jsx` also carries a small effect that
  `goTo`s a *changed* `homePoseKey` — skipping the mount value (already in
  `initialRotation`), skipping portrait, and only while `appMode === 'idle'`
  (elsewhere there are already other writers on the camera targets).

**Pose lock (Mesh)** is the third use. Entering Mesh mode (or changing
`homePose` while already in it) calls
`apiRef.current.goTo(homePose)`. The lock is enforced in the **mechanism**,
not at the call site: `useComposerControls.js`'s `goTo(key)` itself checks
`editModeRef`/`homePoseKeyRef` (refs mirroring the `editMode`/`homePoseKey`
hook options every render, read inside the `goTo` closure without needing to
recreate it) and silently no-ops any request for a *different* pose while
locked — so the lock holds regardless of who calls `goTo` (an animation's
`goToPose` step, `?debug` console, future callers). That is the whole of it
now: the HUD pager that used to mirror the lock in its `disabled` states no
longer exists (see "HUD"), and `Hud.jsx` therefore polls only `editMode` off
the bridge, not `homePoseKey`, to grey out its remaining chips wholesale.

Also within `?debug`, `editMode` doesn't just gate raycasting/interaction —
it gates **panel visibility** too, via Leva's per-folder `render`
predicate (`FolderSettings.render: (get) => boolean`, the 3rd/settings arg
of `useControls(folderName, schema, settings)`): the `Ombra: Directional
(Keylight)` / `Ombra: Spotlight` folders (in `LightRig.jsx`'s
`ShadowKeyLight`/`ShadowSpotLight`) and `Impostazioni Globali Vista` (also
`LightRig.jsx`) all pass `render: (get) => get('⚙️ Editor · Modalità.editMode')
=== 'lights'`; `MeshController.jsx`'s `⚙️ Editor Mesh (Debug)` folder passes
`render: (get) => get('⚙️ Editor · Modalità.editMode') === 'meshes'`;
the `Focus · <gruppo>` folders, one per mesh group (`FocusGroupTuner` in
`Scene.jsx`) gate on `=== 'focus'`. The animation editor deliberately owns
**no Leva folder at all** — it's a plain DOM overlay
(`AnimationEditor.jsx`), because Leva can't take a per-step dynamic schema
without the component-per-item trick and the step list changes length
constantly. Critically, `render` only hides the row
in the Leva UI — it does **not** unmount the `useControls` call, so tuned
values survive switching away and back (an actual unmount/remount would
reset them to the schema's hardcoded `value:` defaults, since Leva's store
entries for a path are recreated from scratch when a fresh `useControls`
call registers them). The path string (`'⚙️ Editor · Modalità.editMode'`) is
`folderName + '.' + controlKey` from `Scene.jsx`'s own editMode control —
it's duplicated as a literal in each gated file rather than shared via
import (same reasoning as the `DEBUG` flag below), so if `Scene.jsx`'s
folder name or key ever changes, grep for that path string everywhere.

`Scene.jsx` snaps to `homePose` (see "Pose lock" above) the moment
`editMode` becomes `'meshes'` (or `homePose` itself changes
while already in it) — not on each mesh/group selection like an
earlier version did, which would re-snap every time you picked a different
one from the dropdown mid-session.

**`apiRef.current` is a multi-writer bridge, seeded once as `useRef({})`
(never `null`) in `KeyboardComposer.jsx`.** Five writers, in different React
subtrees with no commit-ordering guarantee between them, all write onto the
*same* object via `Object.assign(apiRef.current, {...})` rather than
replacing it wholesale:
- `useComposerControls.js` (inside `<Canvas>`) — `goTo`, `currentPoseKey`,
  `focusGroup`, `clearFocus`, `currentFocus`, `isPoseSettled`,
  `isFocusSettled`; its cleanup `delete`s exactly those seven keys.
- `AnimationDirector.jsx` (also inside `<Canvas>`) — `playAnimation`,
  `stopAnimation`, `currentAnimation`, `animationState`, `triggerAnimation`,
  `animationUnlocked`, `resetAnimationProgress`, `meshCatalog`; same
  `delete`-only cleanup.
- `LightRig.jsx` (also inside `<Canvas>`) — `saveConfigJSON`/`loadConfigJSON`,
  thin wrappers over a per-render-updated ref (same idiom as the focus methods
  above) so the two handlers, which are the only code that sees `configsRef`,
  can be driven by buttons living in the DOM next to the Leva panel; same
  `delete`-only cleanup.
- `Scene.jsx` (outside the Canvas) — `editMode`, `homePoseKey` (plain
  fields, no cleanup needed).
- `KeyboardComposer.jsx` itself (outside the Canvas) — the variant commands
  (`currentVariants`, `setVariant`, `variantSwapAnimation`) and the app mode
  (`appMode`, `setAppMode`, `toggleAppMode`); no cleanup needed either.

Object.assign-only, never `apiRef.current = {...}`, is the rule any future
writer onto this bridge must follow, or it risks clobbering fields another
writer just added. There is **one** bridge now: the second one
(`timelineApiRef`) died with the Timeline and was not replaced — the
animation system needed no data bridge because `KeyboardComposer.jsx`
renders both the Canvas subtree and the DOM overlays, so the animation list
travels as an ordinary prop and only *commands* go through `apiRef`.

The dead code this file used to warn about has been **removed**, not just
documented — don't go looking for it and don't reintroduce it: `Backdrop.jsx`
(an unreferenced reflective floor plane), `KeyboardComposer.module.css`'s
`.viewPad`/`.viewBtn`/`.up`/`.left`/`.right`/`.down` and the whole
`.capturePanel*` family (leftovers of a `ViewPad` and a `LightCapturePanel`
that predated `Hud.jsx` and `LightRig.jsx`'s save/load buttons), and
`poseGraph.js`'s `VIEW_SHORTCUTS` (the ViewPad's direction→pose map), and —
most recently — the whole keyframe Timeline (`Timeline.jsx`,
`Timeline.module.css`, `timelineApiRef`, `interpolateKeyframes`,
`keyframesBySelection`/`playhead`, `editMode 'timeline'`). That CSS
module is now only `.section`, `.canvasWrap`, `.canvasWrapLoaded` and
`.debugResize`; `Hud.module.css` and `AnimationEditor.module.css` are used
in full.

## Commands

```bash
npm install
npm run dev        # vite dev server (port from $PORT env, fallback 5174)
npm run build       # production build
npm run preview     # preview the production build
```

No test runner or linter is configured.

### Verifying changes in the browser

With no test suite, regressions here are caught by driving the running app and
reading numbers back out of the scene graph. Three things cost real time to
re-derive, so they're written down:

**Don't fingerprint the rig by hashing damped values.** The obvious regression
test — dump every light's intensity/position before and after a change and
compare — **does not work**: `maath/easing`'s damping is asymptotic and the
first frame's delta varies per run, so two runs of *identical* code produce
different dumps (observed: 5053 vs 5242 chars). Instead, either pump to
convergence (see below, ~25 s of virtual time makes the error exactly `0`) or
— better — assert against the source of truth: that the *i*-th point light in
traversal order carries the intensity of key `` `${prefix}_${i}` `` from the
config JSON. That checks the binding rather than a transient, and it's what
caught nothing (correctly) during the `gridLayers` consolidation.

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
find out what a compile actually costs on the machine under test, force a cache
key that has never existed — clone a group material, set `sheen = 0.5`, assign
it to a mesh and time one `gl.render` (measured here: 192 ms against a 0.4 ms
normal frame). Per-material state is reachable via `gl.properties.get(material)
.programs.size`.

**A hidden/occluded tab breaks the app, not your change.** `requestAnimation
Frame` is frozen in a background tab, so R3F never measures the container (the
canvas stays stuck at the default `300×150`, `window.__r3f_state` is never
set) and `useFrame` never runs — the HUD reads `FPS 0.00` and rAF-based
promises in injected scripts hang until the tool times out. Bring the Chrome
window genuinely to the foreground before testing; a `resize_window` call on an
occluded window is not enough.

**Pump frames manually when you must.** With `?debug`, `window.__r3f_state`
exposes the R3F state, and `state.advance(timestamp)` runs one frame on
demand — useful to fast-forward damping without waiting in real time:

```js
const st = window.__r3f_state
const pump = (sec) => { let t = performance.now(); for (let i = 0; i < sec*1000/16; i++) { t += 16; st.advance(t) } }
window.__setPose(35.264389682754654, 45)   // TL — vedi POSE_COORD
pump(25)                                    // damping a convergenza
```

To exercise the production lighting while still in `?debug` (where the JSON
fetch is skipped), feed the file to the app's own load handler
(`window.__r3f_state`-free: it is on the bridge as
`apiRef.current.loadConfigJSON()`, the same thing the "Carica" button calls):
patch `HTMLInputElement.prototype.click` to capture the `<input type=file>` it
creates, assign a `DataTransfer`-built `File`, and dispatch `change`.

### Model asset pipeline (OBJ -> GLB)

The source OBJ (`assets-src/Array_L_WEB_Retopo.obj`, not committed for
size) is converted/optimized into `public/models/keyboard.glb`, the only
model asset the app actually loads (`DEFAULT_MODEL_URL` in
`KeyboardModel.jsx`):

```bash
npm run asset:convert    # OBJ -> raw GLB via obj2gltf (needs --max-old-space-size=8192)
npm run asset:optimize   # weld -> prune (--keep-attributes) -> draco compress
npm run asset:inspect    # gltf-transform inspect on the final GLB
```

Hard constraints on this pipeline:
- `materials/meshGroups.js` classifies meshes into groups purely by node
  name substring (`nameTokens`, e.g. `'Keycaps'`, `'S0'`, `'Rotor'`) — the
  `.mtl`'s material names no longer matter for *grouping*, only for what
  material ends up on each mesh in the first place (which
  `materials/groupMaterials.js` then clones per group, see "Mesh groups"
  below). Exported node names must keep their distinguishing substrings.
- Never run `gltf-transform optimize`/`join` on the output — it merges
  meshes (and their node names), which breaks both the per-node group
  classification above and the per-group material clone this whole
  materials system depends on.
- `prune` must be run with `--keep-attributes` or UVs are lost.
- Don't run `simplify` on this asset — it's already a web-ready retopo.

The GLTF is loaded with Draco compression; the decoder lives in
`public/draco/` and is passed explicitly as the second arg to `useGLTF`
(`DRACO_PATH = '/draco/'` in `KeyboardModel.jsx`).

## Architecture

The component tree (all under `src/components/KeyboardComposer/`):

```
KeyboardComposer.jsx        DOM shell: canvas fade-in, Leva panel host (DebugPanel)
├─ Scene.jsx                 <Canvas> — camera, tone mapping, Suspense/Loader
│  ├─ KeyboardModel.jsx       loads GLB, auto-fits scale, owns useComposerControls,
│  │                           keeps the transparent-shader warm-up in sync
│  ├─ MaterialTuner (in Scene.jsx)   one Leva folder per mesh group, from meshGroups config
│  ├─ FocusTuner (in Scene.jsx)      one Leva folder per mesh group: authored
│                              framing (radiusFactor + offset) for the product
│                              zoom; collected into window.__STATE_FOCUS and
│                              passed down to useComposerControls
│  ├─ LightRig.jsx            all scene lighting (production + debug editor);
│                              own useGLTF (shared cache) to measure the live
│                              model bbox for the adaptive light box
│  ├─ MeshController.jsx      mesh inspector: TransformControls + halo on a runtime
│  │                           pivot at a group's cumulative center or a single
│  │                           mesh's own center (dual Gruppo/Mesh selectors, own
│  │                           useGLTF, shares KeyboardModel's cache); the pivot
│  │                           machinery itself lives in animation/pivot.js
│  └─ AnimationDirector.jsx   runs the authored animations: one useFrame, renders
│                              null, owns the opacity/pivot registries, publishes
│                              play/stop/state onto apiRef (own useGLTF, shared cache)
├─ Hud.jsx                    DOM overlay outside the canvas: logo, telemetry,
│                              variant chips, animation chips + the wait-for-trigger
│                              chip, and the idle⇄config button. No pose pager, no
│                              focus chips — both removed
└─ AnimationEditor.jsx        DOM overlay outside the canvas: block editor + JSON
                                view, visible only in ?debug + editMode 'anim'

animation/                     (no React except the two components above)
├─ animationSchema.js          data shape, defaults, normalize/migrate, buildWaves,
│                               buildStepGroups, validazione dei prerequisiti
├─ animationTransforms.js      authoring-only: clone di step/blocchi/animazioni e
│                               generazione dell'inverso (no React, no runtime)
├─ actions.js                  ACTIONS — param schema + runtime impl, one source of truth
├─ animationRuntime.js         the wave sequencer (pure JS, ticked by the Director)
├─ selectors.js                resolveSelector: all / group / allExcept / meshes
├─ easings.js                  named curves for duration-driven steps
├─ opacityRegistry.js          runtime-only opacity ownership (fast path + clone-on-write)
├─ pivot.js                    wrapMeshInPivot / wrapGroupInPivot (shared with MeshController)
└─ pivotRegistry.js            refcounted pivots, composed channels, restore-not-bake unwind
```

`Hud.jsx`/`AnimationEditor.jsx` (DOM) and the pose/lighting/animation logic
(inside `<Canvas>`) can't share React state directly, so **commands** are
bridged with an imperative ref:
`KeyboardComposer.jsx` creates `poseApi = useRef({})` (seeded to an empty
object, never `null` or reassigned — see "Pose lock" further down for why
that matters), passes it down as `apiRef` to `useComposerControls`, to
`AnimationDirector` and to `Scene.jsx`; all three `Object.assign` onto the
*same* object (full field list under "`apiRef.current` is a multi-writer
bridge" above). `Hud.jsx` polls `currentPoseKey()` (telemetry readout only —
it no longer navigates), `animationState()` and `editMode` on a 150ms interval
(not reactive) and calls `playAnimation()`/`setVariant()` from its buttons,
plus `clearFocus()` from the `Escape` cascade. `LightRig.jsx` reads the same
`apiRef` every `useFrame` to know which per-pose lighting config is active,
and *writes* `saveConfigJSON`/`loadConfigJSON` onto it so the save/load
buttons can live next to the Leva panel (see "Lighting"). `AnimationEditor.jsx`
reads `editMode` off this same bridge to decide its own visibility.

**Data**, by contrast, needs no bridge: `KeyboardComposer.jsx` renders both
the Canvas subtree and the DOM overlays, so the `animations` list is plain
React state there, passed down as an ordinary prop to `Scene` (→
`AnimationDirector`), `Hud` and `AnimationEditor`. This is why the Timeline's
second bridge (`timelineApiRef`) has no successor. The variant selection and
`appMode` (see "App mode") travel the same way — `appMode` reaches `Scene`
(where it folds into `controlsDisabled`) and `Hud` (which switches its whole
surface on it) as a plain prop, with only the *setter* mirrored onto the
bridge.

### Pose graph (`poseGraph.js`)

Navigation is over a fixed set of **21 named poses** (`POSE_COORD`:
pitch/yaw pairs) connected by an explicit adjacency graph (`NEIGHBORS`,
one neighbor per `up`/`down`/`left`/`right`, or `null`). There is no free
orbit — a step is always "jump to the named neighbor in this direction."
Key exports:
- `stepTo(pitch, yaw, dir, yawOffset)` — direction → next pose's raw
  (pitch, yaw), taking the shortest yaw path from the *current raw* yaw
  (which may have accumulated multiple turns) rather than the neighbor's
  canonical yaw, so `goTo`/arrow-steps never spin an extra full turn.
- `findPoseKey(pitch, yaw, yawOffset)` — raw angles → pose key, or `null`.
- `wrapYaw(yaw)` — reduces yaw to `(-180°, 180°]`.
- `POSE_HUD_LABEL` — short labels, used by the HUD telemetry readout, by the
  editor's `pose` parameter field and by `Scene.jsx`'s `homePose` options.
  ⚠️ `HUD_VIEWS` (the 5 poses of the `01–05` pager) was **deleted** with the
  pager itself — same fate as `VIEW_SHORTCUTS`, don't reintroduce either.
- `ENTRY_LANDSCAPE` / `ENTRY_PORTRAIT` / `PORTRAIT_YAW_OFFSET` — entry pose
  differs by orientation; in portrait the *entire graph* is yaw-shifted by
  `PORTRAIT_YAW_OFFSET`, derived once from the entry pose and frozen in a
  ref (`frame.current.yawOffset` in `useComposerControls.js`) — never
  recomputed from live viewport size, otherwise a resize could shift the
  frame out from under the current pose and silently break `stepTo`.
  ⚠️ `ENTRY_LANDSCAPE` is now only the **fallback**: the landscape entry is
  `POSE_COORD[homePose]` (see "Home pose"), which is always a canonical graph
  pose and therefore always resolves to `yawOffset === 0`. `ENTRY_PORTRAIT`
  is still used as-is, which is what keeps that inference honest.

### Interaction + animation (`useComposerControls.js`)

Single hook, attached to the model's outer `<group>` ref, that owns:
- **Pointer drag**: picks one dominant axis per gesture (`vertical =
  |dy| >= |dx|`) on first exceeding `AXIS_DEADZONE`, resolves the neighbor
  via `stepTo`, and interpolates along that axis with `softClamp` providing
  elastic resistance past the target/graph-edge. On release, commits if
  progress along the axis exceeds `commitFraction` (a Leva-tunable, default
  0.2), else springs back.
- **Arrow keys**: each press is exactly one `commitStep(dir)` — native
  key-repeat is filtered (`e.repeat` + a `heldKeys` Set), and a
  `KEY_DEBOUNCE_MS` (300ms) debounce blocks rapid re-presses from stacking
  steps/velocity ("spinning"). `keyup`/`blur` listeners are on `window`
  (not the canvas) so a held key can't get stuck if focus moves mid-press.
- **Settle physics**: a single damped-spring model
  (`springStiffness`/`springDamping` in the `feel` Leva group) integrated
  in `useFrame`, seeded with real gesture velocity from drag or from
  keypress cadence (`seedKeyBounce`, using inter-press `dt`). `stepAmp()`
  scales step amplitude relative to a 45° reference step so that 90° corner
  transitions dilate time (`stepDt = dt / amp`) and compensate damping
  (`Math.log(amp)` term) to keep the same angular velocity and the same
  *absolute-degree* overshoot as a 45° step, instead of visibly differing.
- **Camera**: stays level at a fixed pivot height (`PIVOT_Y`); the model
  itself never rotates — only the **camera** orbits it via quaternion
  (`camera.quaternion.setFromEuler(new THREE.Euler(-pitch, -yaw, 0, 'YXZ'))`,
  then `camera.position` is placed at `cameraRadius` along that quaternion).
  Because nothing ever rotates the model, the hook takes **only** its options
  object — the old dead first param `groupRef` is gone, and with it the two
  identity-transform wrapper `<group>`s it fed in `KeyboardModel.jsx` (which
  now renders just `<group scale={scale}><primitive object={scene} …/></group>`).
- **Zoom (invariante: non si resetta MAI)**: the camera distance is a
  *product of three independent refs*, never a single writable value —
  `cameraRadius.current = clamp(baseRadius.current * userZoom.current *
  focusZoom.current.value, RADIUS_MIN, RADIUS_MAX)`, recomposed by the local
  `applyRadius()` helper.
  **Nothing ever assigns `cameraRadius` directly.** `baseRadius` is the
  framing distance and belongs to the fit paths; `userZoom` is a pure
  multiplier (clamped `ZOOM_MIN`…`ZOOM_MAX`) and belongs solely to
  `onWheel`; `focusZoom` is the group-framing factor and belongs solely to
  the focus path below. That split is the whole mechanism behind "zoom
  survives every view/mode/selection change": a fit recompute rewrites the
  base and `applyRadius()` re-multiplies the other factors back on top, so a
  resize, a `fitMargin`/`zoomOutMobile` change (including one arriving from a
  loaded JSON via `app-load-rotation`), or a mode switch can no longer
  erase it. Before this, `onWheel` wrote `cameraRadius` itself and the next
  fit to run silently overwrote it. If you add a **fourth** writer, give it a
  ref of its own and fold it into `applyRadius()` — do not assign
  `cameraRadius`.
- **The wheel is authoring-only.** `onWheel` is registered
  **only under `?debug`** — not early-returned, *not registered*: with
  `{ passive: false }` + `preventDefault()` an early return would still eat
  the host page's scroll. In production the group focus below is the only
  zoom that exists. Inside `?debug` the handler still ignores `disabledRef`,
  so it stays live in every `editMode`.
- **Group focus — lo zoom di prodotto** (`focusGroup(groupId)` /
  `clearFocus()` / `currentFocus()` on the shared `apiRef` bridge; an authored
  animation's `focusGroup`/`clearFocus` steps drive it, plus `Escape` and
  `window.__focusGroup`/`__clearFocus` in `?debug` — the HUD chip row that used
  to is gone, see "HUD"). Framing a group is **two** motions, not one — getting closer
  alone would push an off-axis group (rotors to one side, `landing`
  underneath) out of frame as the camera approaches:
  - the **orbit pivot** moves from the historical constant `(0, PIVOT_Y, 0)`
    to the group's world-space center. `PIVOT_Y` is no longer applied as a
    literal `camera.position.y += PIVOT_Y`; it's the default value of the
    `pivotCur`/`pivotTarget` refs, and the last line of the frame is
    `camera.position.add(pivotCur.current)`. With no focus active this is
    bit-identical to the old behaviour.
  - `focusZoom` shrinks the radius. It is a **factor, not an absolute
    radius**, and that is load-bearing: the distance framing an object of
    half-extent *R* over the distance framing one of `FIT_HALF_WIDTH` is
    `R/FIT_HALF_WIDTH` **regardless of fov, aspect, `fitMargin` and
    `zoomOutMobile`** — every camera term cancels. So a resize rewrites
    `baseRadius` and the focus stays exactly as framed, with no
    reconciliation code (verified: distance to the group center unchanged
    across a `resize`).

  Both are targets, damped every frame with `maath` (`easing.damp3` on the
  pivot, `easing.damp` on the factor) against a Leva knob in
  the `Rotazione` folder — hence saved into `__STATE_ROTATION` for free. The
  damping runs on the **raw** `delta`, deliberately not on `scaledDelta`: the
  dolly is not the pose spring and must not change speed when `timeScale` is
  tuned. Reusing the pose spring was rejected — it integrates angles with
  `stepAmp`'s amplitude compensation, which means nothing for a dolly.
  **Going in and coming out have separate times**: `focusDamp` while a group is
  framed, `focusOutDamp` on the way back to the whole model. The direction is
  read straight off `focusGroupRef.current` (null = returning). The split
  exists because the zoom-out is what closes every animation, alongside the
  opacity fade of the soft teardown (see "Animations"), and at the entry speed
  it reads as hurried. Both default to `0.6`, so behaviour is unchanged until
  one is tuned; a JSON predating `focusOutDamp` falls back to `focusDamp`.
- **The measurement is a bounding sphere, and that's a design decision.**
  `focusFraming.js`'s `measureGroupFraming` returns the group's world-space
  center and the half-diagonal of its bounding box — *not* the extent
  projected onto the camera axes. Consequence: the framing is
  **pose-independent**, so orbiting while focused needs no recompute and
  never clips from any angle (verified: stepping poses while focused leaves
  the group's NDC at `(0, 0)` and the distance unchanged). The price is a
  generous framing — a group whose bounding sphere approaches the model's
  own barely zooms at all. That is what the authored `radiusFactor` is for;
  it is not a bug to "fix" by switching to projected extents. Measurement is
  **edge-triggered** (entering focus, changing group, changing the authored
  values), never per-frame: it is a full scene traverse, like `LightRig`'s
  adaptive box, and it skips `__editorHelper` meshes for the same reason.
- **`RADIUS_MIN` was lowered `2.5 → 0.8`** for this feature and
  `FIT_RADIUS_MIN` (5.2) must **never** be applied to the focus path. With a
  200mm lens `baseRadius` is ~36 scene units and a small group frames at
  ~1.7–3.5; the old floor was an invisible ceiling on how close the product
  zoom could get. `FIT_RADIUS_MIN` is the floor of the *whole-model fit*
  only.
- `focusGroup(groupId, extra)` takes an optional second argument: per-call
  overrides of the authored framing (`radiusFactor`/`offsetX/Y/Z`), merged
  *over* the `FocusTuner` values. It's how an animation's `focusGroup` step
  gets its own distance without touching the group's global framing. ⚠️ The
  last `extra` is remembered in `focusExtraRef` **and re-passed by the
  re-apply effect** (deps `[focusOverrides, scene]`) — without that, moving a
  `Focus · <gruppo>` Leva slider or an incoming `app-load-focus` would
  silently discard an animation's framing. `clearFocus()` resets it.
- `focusGroup()` **no-ops in `editMode` `'meshes'`** (same guard
  shape as `goTo`'s pose lock) and an effect **clears an active focus** when
  entering that mode: there the pose is locked and the geometry can be
  moved by the editor, so a stale center would frame nothing. The HUD's
  remaining chips disable themselves in that mode too, for the sibling reason
  (an animation would acquire pivots on the meshes the editor holds). One accepted
  nuance: in Lights mode the expand-only dynamic fit can still grow
  `baseRadius`, which scales an active focus proportionally — correct
  behaviour (a deformed model wants a wider framing), not a bug.
  Two paths write `baseRadius`:
  - a **static** fit `useEffect` (deps `[size, camera, focalLength,
    feel.fitMargin, feel.zoomOutMobile]`) using the constant
    `FIT_HALF_WIDTH`;
  - a **dynamic**, **expand-only** fit active while `editMode === 'lights'`
    **and** the current pose equals `homePoseKey` (see "Pose lock"): it
    measures a *live* `Box3().setFromObject(scene)` when the condition's
    edge is detected (a cheap per-frame `useFrame` check compares
    `mode`/`curKey` against the lock and only rebuilds the box on the
    `false→true` transition — `Box3` over the whole scene graph is not
    something to run every frame), and **returns without touching anything
    if the needed radius isn't larger than the current base**. It exists to
    keep a model *deformed* in Mesh (a translated group that no
    longer fits the pristine framing) from being clipped — not to reframe
    the pristine model, which is what used to make every entry into Lights
    mode snap the camera and wipe the user's zoom. A second `useEffect`
    declared *immediately after* the static one (same deps, so it gets the
    final word on a shared commit) re-applies it if still active.
  One subtlety on the dynamic path: `scene` is *already* a child of
  `<group scale={scale}>` by the time this runs (unlike
  `KeyboardModel.jsx`'s own one-time auto-fit `useMemo`, which measures
  `scene` *before* it's inserted into the tree, i.e. genuinely raw/
  unscaled) — so `Box3().setFromObject(scene)` here already returns
  world-space (post-scale) size; multiplying by `scale` again would
  double-scale and collapse the fit almost to zero — a real bug hit and
  fixed while building this, don't reintroduce it. `onWheel` itself never
  checks `disabledRef`, so zoom stays live in every `editMode` (including
  Mesh, where drag is otherwise suspended); neither fit path can
  fire while `editMode` is `'meshes'` (the dynamic path is
  gated on `'lights'`, the static path doesn't care about `editMode` at
  all).
- **Imperative API**: contributes `goTo(key)`/`currentPoseKey()`,
  `focusGroup(groupId, extra)`/`clearFocus()`/`currentFocus()`, and the two
  "movement finished" probes `isPoseSettled()`/`isFocusSettled()` onto the
  shared `apiRef.current` bridge (see "Pose lock" above for the
  `Object.assign`-only contract and why). The three focus methods are thin
  wrappers over `focusImplRef.current` — the implementations close over
  `scene`/`meshGroups` props and are rebuilt each render, while the API
  effect runs once (`deps: [apiRef]`), so calling them through a
  per-render-updated ref is what keeps them from freezing on the first
  mount's values. Same idiom as `disabledRef`/`feelRef`. `goTo` now opens with a lock
  check (refs `editModeRef`/`homePoseKeyRef`, kept fresh by plain
  per-render assignment next to the pre-existing `disabledRef`): while
  `editMode` is `'meshes'`, a request for any pose other than
  `homePoseKey` is silently ignored. Also, only when `?debug` is present:
  `window.__setPose(pitchDeg, yawDeg)` (hard teleport, bypasses the spring
  **and** the lock — a debug/console-only escape hatch, not reachable from
  any UI) and `window.__abortComposerDrag()` (cancels an in-progress drag —
  called by `MeshController`'s and `LightRig`'s `TransformControls` gizmos
  on `onMouseDown` so dragging a gizmo doesn't also rotate the model).

### Mesh groups (`materials/meshGroups.js`) and materials (`materials/groupMaterials.js`)

Mesh classification and material application are two deliberately separate
concerns living in two files. There is no more "finish"/preset concept
(the earlier `materials/registry.js` + `materials/applyFinish.js`, which
built brand-new `MeshPhysicalMaterial`s from 4 hand-authored color presets,
were deleted): materials are now discovered and cloned from whatever the
GLB itself already carries, so any texture maps the DCC-authored materials
have (or gain later, once high-def textures land) survive untouched.

**`materials/meshGroups.js`** is the single source of truth for what
logical groups the model is split into — nothing else hardcodes group
names. `DEFAULT_MESH_GROUPS` is an array of `{ id, label, nameTokens }`
(9 groups matching this GLB: `keycaps`, `patchesISO`, `patchesANSI`,
`body`, `damping`, `rotors`, `tasselli`, `landing`, `viti`). `meshGroups`
is a prop threaded
`KeyboardComposer.jsx` → `Scene.jsx` →
`KeyboardModel.jsx`/`MeshController.jsx`, defaulting to
`DEFAULT_MESH_GROUPS` everywhere — an integrator embedding this component
with a differently-authored GLB can pass their own group list without
touching any of the consumers below.
- Classification is **purely by node-name substring** (`nameTokens`) —
  there is deliberately no material-name matching path. An earlier version
  matched by material name first (`materialNames`) with `nameTokens` only
  as a tie-breaker; that was removed because several groups in this asset
  share one Maya material (`body`/`rotors`/`tasselli` all use
  `standardSurface3SG`), which made the material-name fast path silently
  misclassify meshes whenever a match was unambiguous by material alone
  but wrong by node name (`L_ARRAY_Tasselli_Retopo` has `damping`'s
  material but is a `tasselli` mesh) — pure node-name classification both
  removes that failure mode and the disambiguation machinery it required.
- ⚠️ **The array's ORDER is significant** — `collectMeshGroups` uses
  `groups.find(...)`, so the first group that matches wins, and the order
  (not the tokens) is the intended way to disambiguate meshes two rules
  could both claim. Two live dependencies on it: `patchesISO`/`patchesANSI`
  must come **before** `body`, whose `'S0'` token would otherwise claim
  `…S05_L_ISO…` first and leave the patches without a group of their own;
  and `damping` must come before `landing`, since `Damping_Foots_Rialzo`
  carries both tokens and belongs to damping.
- ⚠️ **Tokens must match the names `GLTFLoader` produces at RUNTIME**, not
  the ones you read in the GLB: the loader turns spaces into underscores
  and appends dedup suffixes (`L_ARRAY S05_L_ISO` → `L_ARRAY_S05_L_ISO_1`).
  A token like `S01_1` looks plausible in the file and matches nothing at
  runtime, where the name is `L_ARRAY_S01` — those meshes then land in the
  right group only via the fallback, i.e. by luck.
- `collectMeshGroups(scene, groups, fallbackGroupId)` walks the loaded GLTF
  once, assigning every mesh to the first group whose `nameTokens` matches
  a substring of the node name, defaulting to `fallbackGroupId` (`'body'`)
  if nothing matches. Meshes tagged `userData.__editorHelper` (the
  selection halos `MeshController.jsx` parents under real meshes) are
  skipped — they are not product geometry and would otherwise land in a
  group, and in the mesh dropdown, on any recompute happening while a
  selection is live. Meshes tagged `userData.__variantHidden` (the
  unselected option of a variant — see "Model variants") are skipped for
  the same class of reason. It also flips on `castShadow`/`receiveShadow`
  for every mesh here. Returns `{ [groupId]: THREE.Mesh[] }`, one array per
  group in `groups` (even if empty).
- `collectMeshList(scene, groups, fallbackGroupId)` flattens that into the
  sorted, labelled, dedup-suffixed list `MeshController.jsx`'s Mesh
  dropdown renders — same classification, just reshaped.

**`materials/warmupTransparency.js`** is a third, much smaller file in this
folder, and it belongs to neither concern above: it precompiles the
`transparent` shader variant of the materials the two produce, so the first
animated fade doesn't pay a 192 ms shader compile mid-movement. It is driven
from `KeyboardModel.jsx` and re-runs whenever `programSignature()` changes —
**not** once at mount, which was tried and measurably did nothing (the authored
`clearcoat` values arrive later and are themselves a define). Full argument
under "Opacity" in the animations section, and in the file's own header.

**`materials/groupMaterials.js`** doesn't know or care what the groups are
called — it only ever receives an already-classified `{ [groupId]:
THREE.Mesh[] }` object, fully generic over group ids:
- `prepareGroupMaterials(scene, groups, fallbackGroupId)` discovers each
  group's real material(s) straight off the meshes and clones each
  distinct source material **once per group** (`cloneByOriginal`, scoped
  per group so two groups sharing one Maya material — `body`/`rotors`/
  `tasselli` — get independently tunable clones instead of one shared
  clone). `THREE.Material.clone()` deep-copies scalar PBR params but
  assigns texture map properties by reference, never touching pixel data —
  so any texture maps already on the GLB's materials (or added later) ride
  along for free. Idempotent via a `userData.__groupMaterialFor = groupId`
  tag checked before cloning, so `KeyboardModel.jsx` and `Scene.jsx`'s
  `MaterialTuner` can each independently call it on the same cache-shared
  `scene` (siblings under `Scene.jsx`, not parent/child) without double-
  cloning or fighting over mount order. Returns `{ [groupId]:
  THREE.Material[] }`.
- `applyMaterialProps(material, props)` mutates a material in place
  (`color`/`roughness`/`metalness`/`envMapIntensity`/`clearcoat`/
  `clearcoatRoughness`) — this is what the debug `MaterialGroupTuner` (in
  `Scene.jsx`) calls on every Leva change.

**`MaterialTuner` (in `Scene.jsx`) instantiates one Leva folder per group at
runtime** — `groups.map(group => <MaterialGroupTuner key={group.id} .../>)`
— rather than one hardcoded `useControls` call per slot name. This is *not*
a `useControls` call inside a loop (which would violate the Rules of
Hooks the moment the groups list length changed across renders); each
`MaterialGroupTuner` is its own component instance with its own single,
fixed `useControls` call, and `MaterialTuner` just renders a list of them —
the standard, safe way to get "N of the same hook-using thing" from a
runtime-length array. Each folder is named `Materiale · ${group.label
.toLowerCase()}`; per-group state is collected back up into
`window.__STATE_MATERIALS` (keyed by group id, used by `LightRig.jsx`'s
save/load JSON) via an `onChange(groupId, values)` callback, and each
`MaterialGroupTuner` independently listens for `app-load-materials` and
checks `e.detail?.[group.id]` rather than one shared listener juggling
named setters. Leva defaults are seeded from whatever the GLB's own
(cloned) material already has (`seed.color.getHexString()`, etc., `seed`
being the first material `prepareGroupMaterials` returned for that group)
rather than hand-authored preset data — a group with no meshes falls back
to a flat placeholder (`#888888`/mid-range PBR values) instead of
throwing. `window.__STATE_MATERIALS`'s shape (keyed by group id) and the
`app-load-materials` event contract are unaffected by which groups a
particular saved JSON does or doesn't cover — a group id missing from an
older save just keeps its GLB-seeded live default.

### Model variants (`materials/meshVariants.js`, `VariantController.jsx`)

Sets of **alternative meshes** the end user picks between — today the ISO/ANSI
layout, later the landing or anything else. Same shape and same rules as
`meshGroups.js`, deliberately: a declarative exported default, classification by
**node-name substring**, and the list threaded as a `meshVariants` prop through
the whole tree so an integrator can describe their own without touching a single
consumer.

⚠️ **This also fixes a pre-existing defect.** The GLB contains all four of
`L_ARRAY S05_{L,R}_{ISO,ANSI}` and, before this, drew them **all at once**,
interpenetrating. Applying a selection is what makes the model correct, not just
a feature.

Hidden meshes are tagged `userData.__variantHidden = true`, and **that tag —
not `.visible` — is what other traversals must check**, exactly like
`__editorHelper`: `.visible` can be turned off by anyone for their own reasons,
the tag says *why*. Two sites consume it, and both are required: 
`collectMeshGroups` (or a hidden ISO keeps counting in a group's focus framing,
in fades and in the mesh dropdown) and `LightRig`'s `measureModelBox` (or the
light box is sized on a layout nobody is looking at).

**Where the choice lives — and ⚠️ the two halves of this section are
deliberately treated as opposites.**

- The **selection** (which layout is on) is *user* state and is **never saved to
  the JSON**. Precedence is only two steps: *session choice → `defaultOption`
  declared in `meshVariants.js`*. The session choice is `sessionStorage`
  (survives a reload, resets when the tab closes), wrapped in try/catch because
  storage can be denied. There is deliberately **no** third step: a starting
  layout authored into the config file would mean that loading a configuration
  puts the user back on a choice that isn't theirs. This is a product decision,
  not a missing feature — an earlier version did save it, and `app-load-variants`
  needed a "session choice wins over the loaded default" rule to paper over the
  consequence. Both are gone; a pre-existing JSON that still carries
  `variants.selection` is **ignored, not migrated**.
- The **swap bindings** (variant → animation id) *are* authored configuration
  and do ship in the JSON, so `window.__STATE_VARIANTS` now carries only
  `{ swapAnimations }`. Without them production would swap instantly instead of
  playing the authored animation, since `meshVariants.js`'s own `swapAnimation`
  field is `null` by default.

If you ever put the selection back, put the session-choice-wins rule back with
it — that pairing is the whole reason the old code looked the way it did.

**`VariantController.jsx`** (inside the Canvas, own `useGLTF`, renders `null`)
applies visibility. `KeyboardComposer.jsx` owns the selection state and
contributes `currentVariants()`/`setVariant()`/`variantSwapAnimation()` onto the
shared `apiRef` — it can, because `apiRef.current` is a plain object and the
component sits outside the Canvas.

**Transition hold.** During an animated swap both options must stay visible to
cross-fade, but the choice is committed at the *start* so the HUD toggle
responds instantly. Without a deroga the controller's effect would switch the
outgoing mesh off in the very frame it starts fading. Hence
`holdVariant(id)` / `releaseVariantHold(id)`: while a hold is set,
`applyVariantVisibility` skips that variant entirely and the animation owns its
visibility.

**The `setVariant` action** cross-fades incoming against outgoing over its
`duration`. ⚠️ It breaks the teardown symmetry every other action obeys, and
deliberately: **`stop()` does not revert the choice.** Opacity and transforms
always go back; a variant selection is *user state*, so stopping a swap
mid-flight must leave the layout the user asked for. Its `optionId` param
left **empty** means "whichever option the caller requested" — the HUD passes
`playAnimation(id, { variantTarget })`, which is what lets one authored swap
animation serve **both** directions instead of a hard-wired one.

⚠️ **`setVariant` is also the only action whose `restart()` must re-run
`start()`.** Every other persistent action holds its materials/pivots until
`stop()`, so restarting only needs the "from" values recomputed. `setVariant`
releases its handles at the *end of the fade* while staying a live instance —
so on a replay (which is what the toggle does on every click, and with
`startFrom: 'keep'` there is no `stop()` in between) the runtime would reuse the
old instance: released handles, previous direction, no hold. Caught in the
browser: the **second** swap silently didn't happen and left the outgoing meshes
at `opacity 0` while hidden — i.e. invisible even once switched back on.

**The HUD toggle** (the top chip row, above the animation chips) plays the
variant's bound swap animation if there is one, and otherwise swaps instantly —
so a newly declared variant is usable immediately, before you have authored
anything for it. The binding (variant → animation id) is edited in
`AnimationEditor` under "swap delle varianti" and ships in the same JSON. Like
the animation chips, these buttons **disable themselves in
`editMode 'meshes'`**, but for a reason of their own: a swap animation would
have `pivotRegistry` acquire pivots on the very meshes `MeshController` is
holding wrapped in its own, and those two must never be live together.

### Lighting (`LightRig.jsx`)

This is the most complex file in the component and mixes production
behavior with a full per-pose lighting *authoring tool* — read it as two
halves:

**Always-on lights** (not pose-dependent, both debug-editable via their own
Leva folders, each folder visible only in Lights mode — see the `editMode`
`render`-gating note above): `ShadowKeyLight` (a `directionalLight`, the
shadow caster) and `ShadowSpotLight` (a `spotLight`, disabled by default).
Both support an in-scene `TransformControls` gizmo (only rendered `if
(debug && lightsActive && showGizmo)`, where `lightsActive = editMode ===
'lights'`) that writes position back into their Leva controls live, and
both mirror their state to `window.__STATE_KEYLIGHT` /
`window.__STATE_SPOTLIGHT` for the save/load system below.

**Per-pose volumetric rig** (the bulk of the file): a fixed grid of point
lights arranged on a 3×3×3 cube around the model's bounding box minus the
center (9 `top`, 8 `mid`, 9 `bot` — `layers` memo), plus 6 `rectAreaLight`s
one per bounding-box face (`faces`, using `RectAreaLightUniformsLib`, which
must be `.init()`ed at module load *before* any PBR material compiles or
the area lights are silently ignored — see the import block at the top of
the file). Each light's intensity/decay/color is stored **per pose key** in
`configsRef.current[poseKey]` (an in-memory map, not React state — mutating
it doesn't rerender).

**Per-view settings (`DEFAULT_VIEW_SETTINGS`).** Alongside the per-light keys,
each pose config carries the `Impostazioni Globali Vista` folder's values —
`margin` plus the four transition speeds `animMarginDamp` / `animLightOnDamp` /
`animLightOffDamp` / `animColorDamp`. The folder's name is a leftover: only
`showHelpers`/`showSurfaces` (debug display) are genuinely global. The four
speeds used to be tunable in `?debug` and persisted **nowhere**, so production
always ran the hardcoded values — the one parameter in the whole app that
didn't survive a save/reload.

`DEFAULT_VIEW_SETTINGS` is the single source for their defaults: both the Leva
schema and `generateDefaultConfig` read from it, so the two can't drift, and
`readViewSettings(config)` reads a pose's values filling absences from it.
⚠️ These keys ship inside `lights[pose]` next to `top_0_intensity` & co., so
the rule about light prefixes applies to them too: **renaming one silently
remaps every saved configuration.**

**How a per-view value reaches the runtime**: `useFrame` reads these from
**Leva** (`currentControlsRef`), not from the config — the pose-change effect
pushes the incoming pose's values into Leva with `setControls`, and a mirror
effect writes slider edits back into the active pose's config. Two consequences
worth knowing: a speed is a *rate*, not a displayed value, so it is deliberately
**not** interpolated through `lerpVal` like intensities are — the switch lands
at the start of the transition, which means **the view being entered governs
its own transition in**; and the mirror effect only ever touches the *active*
pose, which is why `handleSaveJSON` fills the keys for every pose before
serializing (otherwise a file would carry them only for the views the author
happened to navigate through). Older JSONs without the keys stay valid and
fall back to the defaults at every read site.

The three grid bands are described **once**, by the `gridLayers` memo
(`{ prefix, label, groups, lights, helpers }` per band, holding the existing
`useRef` arrays — stable identity, hence `[]` deps). Four places consume it:
the band JSX, the per-frame `updateLightGroup(layer, gridItems)` loop, the
selector's `<optgroup>`s, and `activeLightsList`. They used to be four
verbatim copies of the same top/mid/bot triple that had to be kept in sync by
hand.

⚠️ **`prefix` + the index inside `layers[prefix]` ARE the config JSON's keys**
(`top_0_intensity`, `mid_3_color`, `bot_7_decay`, …). Never rename a prefix and
never reorder the `layers` memo's `for (let y …) / for (let z …) / for (let x …)`
loops: doing so silently remaps every saved configuration onto different
lights — invisible in review, obvious only on the rendered product.

Every `useFrame`:
1. Reads the active pose via `apiRef.current.currentPoseKey()`.
2. On pose change, computes a transition `progress` driven by camera
   angular distance actually traveled (not time), so lighting crossfades in
   step with the rotation animation rather than on a fixed timer.
3. Lerps every light's target intensity/decay/color between the previous
   pose's config and the new pose's config using that progress, then damps
   toward the lerped target with `maath/easing` (asymmetric damping:
   `animLightOnDamp` vs `animLightOffDamp` depending on whether a light is
   brightening or dimming).
4. Animates each light group's *position* outward from the bounding box by
   a `margin` (also Leva/`?debug`-tunable, itself damped via
   `animMarginDamp`) rather than snapping.

**Adaptive (stretching) light box.** The box is *not* derived from the
`modelSize` prop anymore — that's `KeyboardModel.jsx`'s one-shot
`finalSize`, measured on the pristine GLB and applied *symmetrically* about
the rig origin, so it never noticed anything the mesh editor did. Instead
`measureModelBox(modelScene, rigRef.current)` walks the live GLTF scene
(same drei cache instance `KeyboardModel`/`MeshController`/`MaterialTuner`
use, so it's literally the tree `MeshController.jsx` writes its transforms
into — no fetch, no bookkeeping, no event plumbing) and returns
`{minX,maxX,minY,maxY,minZ,maxZ}` in the rig's local space. Every face and
every grid light is then anchored to **its own** extent of that box
(`maxY + m` for `top`, `minY - m` for `bot`, …), which is what makes the
box *stretch* on an axis rather than translate: raise the topmost mesh by
`m` and the top plane rises by `m` while the bottom plane doesn't move, so
each face keeps its `margin` distance from the surface facing it. Faces
also recentre (`boxCenter`) and resize (`(max-min) + 2·margin`)
accordingly. Three things to keep in mind if you touch this:
- It skips `userData.__editorHelper` meshes (the selection halos — see
  "Mesh editor"), which would otherwise inflate the box by `HALO_SCALE`
  while a selection is live.
- The measurement is throttled to one every `BOX_REFRESH_FRAMES` frames
  (a full `traverse` + `updateWorldMatrix(true, true)`; measured at
  ~0.19 ms for this asset's 264 meshes, but it is not per-frame work), and
  the six values are then damped with `animMarginDamp` — so the sampling
  rate is invisible and the stretch animates instead of stepping.
- For the pristine model the measured box is centred on the rig origin and
  equal to `modelSize`, so this is behaviour-preserving for every existing
  saved config (verified numerically). `boxFromModelSize(modelSize)` is
  only a fallback for the frames before the first measurement lands.
- `margin`'s Leva max was raised `3 → 12`: with the box tracking meshes
  that can be translated far away, the old ceiling was too low to push
  lights clear of the model. Purely a range change — saved JSONs are
  unaffected.

Debug-only editing surface on top of that (`Html fullscreen` overlays,
only rendered when `DEBUG` **and** `editMode === 'lights'` — see the
`editMode` note above): clicking a light's wireframe helper (sphere for
grid lights, plane for face lights) selects it (`selectedLight`) and opens
a side panel to edit intensity/color/decay directly, with `Ctrl/Cmd+Z` undo
backed by a JSON-snapshot history (`historyRef`, capped at 50). Every
helper mesh's `raycast` prop is swapped to a no-op whenever `editMode !==
'lights'`, so it's fully unhittable (not just hidden) while the mesh editor
is active.

**Save / load is not one of those overlays.** `handleSaveJSON`/`handleLoadJSON`
still live in this file — it is the only code that sees `configsRef` — but they
are published onto the shared `apiRef` as `saveConfigJSON`/`loadConfigJSON`,
and the two **buttons live in `KeyboardComposer.jsx`'s `DebugPanel`**, docked
under the Leva panel (`.jsonDock` in `KeyboardComposer.module.css`). They used
to be an `Html fullscreen` overlay pinned top-left of the canvas, on top of the
client's logo lockup. Three things about the new home:
- it is where they belong semantically — they write and read *everything*
  authored from the Leva panels, so they read as one more folder of it: same
  right margin, same width, Leva 0.10's own default palette/radii/row height
  copied verbatim into the CSS module (⚠️ **copied, not inherited** — passing a
  custom `theme` to `<Leva>` would desync them);
- the dock position is **measured, not assumed**: `DebugPanel` wraps `<Leva>`
  in a `display: contents` div and polls `firstElementChild.getBoundingClient
  Rect()` every 200 ms. Leva 0.10 renders its root in place (no portal) when
  `<Leva>` is mounted explicitly, and that root is `position: fixed`, draggable
  by its title bar and collapsible — a `ResizeObserver` would miss the drag,
  hence the poll (same idiom as `Hud.jsx`'s). The computed `top` is then
  **clamped into the viewport**: with enough folders expanded the Leva panel is
  taller than the window, and a rigidly-docked bar would sit off-screen and
  unreachable. In that limit it overlaps the panel's last row instead;
- they stay visible for the whole `DEBUG` session regardless of `editMode`,
  since they serialize/deserialize **all** tunable state at once, not just this
  rig's `configsRef`: also `window.__STATE_MATERIALS`, `window.__STATE_ROTATION`,
  `window.__STATE_KEYLIGHT`, `window.__STATE_SPOTLIGHT` and
  `window.__STATE_FOCUS` (the authored group framings — nothing to do with
  lighting, they live here because this is the single save/load point for *all*
  tunable state), into one JSON blob.

**Production light loading**: outside `?debug`, `LightRig` fetches
`/lightconfig/app-state-config.json` once on mount and applies it via the
same code paths (`configsRef.current = lightsData`, then
`CustomEvent`s — `app-load-materials`, `app-load-rotation`,
`app-load-keylight`, `app-load-spotlight`, `app-load-focus` — that
`MaterialTuner`, `FocusTuner` and `useComposerControls` listen for). Note the
route the focus values take: the event is handled by `FocusGroupTuner`'s Leva
`setValues`, which bubbles up through `FocusTuner`'s `onChange` into
`Scene.jsx` state, down as the `focusOverrides` prop to `KeyboardModel`, into
the hook — which re-applies an *already active* focus on change, so the
sliders are usable live rather than blind. A group id missing from an older
JSON just keeps the computed framing. In other words: **the lighting/material/
rotation-feel values actually shipped to production are whatever's baked
into `public/lightconfig/app-state-config.json`**, authored via the
`?debug` panel and exported with the "Salva" button docked under the Leva panel, not hardcoded
defaults in the component files (those Leva `value:` defaults are only the
fallback if the JSON fetch fails).

**Light authoring coverage — the content gap is now closed.** All 21 poses in
the shipped JSON have lights authored (7–19 lights on per pose). This used to
be the opposite: only `TL`/`CFL`/`BFL` had non-zero intensities and every
other view, `TOP` and `FRONT` included, rendered as a black screen in
production. If you find that warning quoted anywhere else, it is stale.

The underlying point still stands, though, and is the reason to keep this
paragraph: **a black view is a JSON content question before it is a rig bug.**
Don't go debugging `LightRig.jsx` over one — check that pose's intensities
first:

```bash
node -e "const L=require('./public/lightconfig/app-state-config.json').lights;
for (const [p,c] of Object.entries(L)) console.log(p, Object.entries(c).filter(([k,v])=>k.endsWith('_intensity')&&v>0).length)"
```

### Mesh editor (`MeshController.jsx`)

Active in `editMode === 'meshes'` only (`const active = editMode ===
'meshes'`).

Two **mutually exclusive** Leva selectors — **Gruppo** (a `meshGroups`
entry) and **Mesh** (`collectMeshList`'s flattened dropdown, same as
before) — pick either a whole logical group or a single mesh; a 3D click
in `KeyboardModel.jsx` (gated on `editMode === 'meshes'`,
same as `active` above) calls `onSelectMesh(e.object)`,
setting `Scene.jsx`'s `selectedMesh` state, which **always** populates
`meshName` (never `groupId`, there is no "click to select a whole group"
UI) via a dedicated sync effect (deps `[selectedMesh]`, deliberately
*not* `active` — including it would re-fire this effect on the mode-
reactivation edge against a `meshName` the deactivation effect never
clears, ping-ponging with the mirror effect below for a couple of renders;
omitting it means this effect only reacts to a genuine `selectedMesh`
change, by which point `meshName` is already reconciled). This is the
*reverse* direction of a second, pre-existing effect (deps `[meshName,
active, meshByUuid]`) that pushes `meshName` selections (dropdown-driven)
back up into `selectedMesh` — the two effects converge on the same
UUID-keyed truth without an explicit suppress guard between them (traced
by hand: dropdown pick → push-up effect fires → sync effect sees the
derived UUID already matches `meshName` → no-op; 3D click → sync effect
fires → sets `meshName` → push-up effect sees it already matches
`selectedMesh` → no-op). Whichever field the user touches last wins and
clears the other, via a small ref-tracked effect (`prevGroupId`/
`prevMeshName` + a `suppressClearRef` guard so its own `setMeshCtrl` clear
doesn't re-trigger itself): picking a group blanks `meshName`, picking a
mesh (dropdown or 3D click) blanks `groupId` — the 3D-click sync effect
clears both fields atomically in one patch
(`{meshName: uuid, groupId: ''}`) when a group was active, so the mutual-
exclusion effect just observes both already consistent and no-ops rather
than doing a second write. The derived `selection` (`useMemo` over
`groupId`/`meshName`) is one of `{ type: 'mesh', mesh, meshes: [mesh] }`,
`{ type: 'group', groupId, meshes }`, or `null` — everything downstream
(pivot, halo, opacity, gizmo, keyframes) is written once against
`selection.meshes`, agnostic to which case it is.

Selecting a mesh lets you nudge it with a `TransformControls` gizmo plus
Pos/Rot sliders; selecting a group rigidly moves/rotates every mesh in
that group together, gizmo and sliders keyed off their **combined**
center. Two things make the pivot-wrap effect non-obvious, one per branch:

**Single mesh — transforms are relative to the mesh's own geometric
center, not its raw local origin.** Many sub-meshes in this Maya-exported
GLB have their local origin nowhere near their visible geometry (a
"freeze transform" export pattern — the real placement is baked into
vertex data, not the node transform), so rotating/translating
`selectedMesh.position`/`.rotation` directly would swing it around an
arbitrary point instead of spinning in place. Fix: on selection, the mesh
is temporarily reparented under a runtime-created `THREE.Group` ("pivot")
positioned at the mesh's local geometry bounding-box center (treated as a
"center of mass" — true volumetric centroid is unnecessary complexity for
a debug tool), using `Object3D.prototype.attach()` (native three.js
method that reparents while preserving world transform — computes the
compensating local transform automatically, so the mesh never visually
jumps on wrap/unwrap; per its own doc comment it doesn't support non-
uniformly-scaled ancestors, fine today since the only ancestor scale in
this scene is `KeyboardModel.jsx`'s single uniform `scale={scale}`, but a
landmine if that ever changes). On deselect / mesh switch / leaving Mesh
mode, the effect's cleanup does the reverse — `restore({ bake: true })`,
i.e. `parent.attach(mesh)`, bakes
whatever the pivot ended up representing back into the mesh's own local
transform (edits persist across reselection/mode changes) and the pivot
group is removed from the scene.

**This machinery now lives in `animation/pivot.js`** (`wrapMeshInPivot` /
`wrapGroupInPivot`), shared with the animation system, which needed exactly
the same wrap in production. `MeshController.jsx` was refactored onto the
extracted module *before* any animation code depended on it, so the
extraction was validated against the existing proven behaviour. The wrap is
identical for both callers; the **unwind is not** — see the `bake` flag in
"Animations" below, and don't "simplify" the two into one.

**Group — pivot at the union bounding box's center, parented under
`scene` (the GLTF root) rather than any one mesh's original parent** (a
group's members can have different original parents). `Box3.union` of
each mesh's own world-space AABB (`Box3().setFromObject`, which already
accounts for each mesh's individual rotation/scale) is the direct multi-
mesh generalization of the single-mesh "bounding-box center ≈ center of
mass" approximation — not an average of individually-computed centroid
points, which would not equal "center of the combined extent." The
resulting world-space center must be converted with
`scene.worldToLocal(...)` before being assigned to `pivot.position` —
`scene` is **not** an identity transform in world space (it inherits real
rotation from the current pose and scale from `KeyboardModel.jsx`'s
`TARGET_WIDTH` normalization; only its own *local* transform is
translation-only), so a bare world-space assignment would place the pivot
off-target the moment the model isn't at its default pose/scale. The
pivot's quaternion is left at identity (no single well-defined "group
orientation" exists for mixed-orientation members) — `attach()`'s normal
parent/child composition still rigidly carries every mesh along when the
pivot rotates, regardless of the pivot's own starting orientation. Every
group member is `pivot.attach()`-ed in, and the cleanup re-`attach()`s
each one back to its own original parent (tracked per-mesh, since members
can differ) and removes the pivot. A group pivot stays a group pivot even
with a single member (identity quaternion, under `scene`), never collapsing
into the oriented single-mesh branch — otherwise the same authored rotation
would turn around different axes depending on how many meshes the group
happens to contain. ⚠️ The animation registry now leans on exactly that: it
wraps **every** mesh through this branch, one at a time, and the identity
orientation is what makes an authored axis mean the model's axis (see
"Pivots"). The oriented `wrapMeshInPivot` branch is this editor's alone.

In both branches the **Pos X/Y/Z (`±100`, step `0.05`) / Rot X/Y/Z°
(`±180`, step `1`) sliders are a relative offset from that center**
(`pivotInfo.basePosition`/`baseQuaternion`, captured once at wrap time) —
not absolute values, since the GLB's native coordinate space is large
(observed pivot positions in the tens of units), which is also why
`posX/Y/Z` needed the wide `±100` range (widened from an earlier `±2` that
was too narrow to reach the model's own scale) while `rotX/Y/Z` stayed
`±180`, a full turn being the natural bound for a relative rotation
regardless of model scale. Reset to `0` the instant a new selection is
wrapped. That reset is issued by the **pivot effect itself**, in the
same effect body (hence the same React commit and the same batched state
update) that creates the pivot and calls `setPivotInfo` — it used to be a
separate `useEffect` keyed on `[pivotInfo]`, which necessarily ran one
render *later* and needed a `suppressApplyRef` flag to cover the gap; that
flag could be consumed by the wrong intervening change and leave the
previous selection's offset applied against a freshly-built pivot. The
reset only ever *sets* `meshName` (to sync a 3D-click selection into the
dropdown when `selection.type === 'mesh'`) — it never blanks `meshName` or
touches `groupId`, that's the mutual-exclusion effect's sole job.

Consequently the **"sliders → pivot" effect is now purely idempotent** —
"the pivot is always `basePosition + current offset`" — and lists
`pivotInfo` in its dependency array alongside `posX..rotZ`. There is no
suppression flag anymore: since pivot and reset values land together,
re-running on `pivotInfo` is not a hazard but a guarantee that a
newly-built pivot is immediately consistent with the sliders.

**Effect lifecycle is keyed on `selectionKey` (a string), never on the
`selection` object.** The pivot, halo and opacity effects all depend on
`[selectionKey, active, …]` and read the selection itself through
`selectionRef` (a plain per-render ref mirror). `selection` is a `useMemo`
result, so it gets a fresh identity whenever `meshGroupsData`/`meshByUuid`
are recomputed — which used to unwrap and rewrap the pivot with no
deliberate selection change behind it, and in that window an offset could
be re-applied or zeroed against the wrong pivot (the previously documented
"group transform doesn't persist" symptom). A string key changes only when
the user actually picks something else. `active` (`editMode === 'meshes'`)
is in those deps too: leaving Mesh mode
now *unwraps* the pivot (cleanup's `attach()` bakes the current transform
into the meshes, so the edit persists) and removes the halos/restores
opacity, instead of leaving blue outlines, a faded material and an orphan
pivot group hanging in the scene through Lights mode — which also means
what the dynamic camera fit and `LightRig.jsx`'s adaptive light box
measure is the real model, not the editor's scaffolding.

**Selection halo**: one halo per mesh in `selection.meshes` (1 for a
single mesh, N for a group — no dedup, each mesh needs its own geometry-
matched halo regardless of material sharing). Each is a backface-only,
slightly-enlarged (`HALO_SCALE`) clone-material mesh sharing that mesh's
geometry (never cloned or disposed — it's a shared reference), added as a
child of the **mesh itself** (not the pivot) so it inherits the real world
transform regardless of pivot wrap/unwrap. Its scale must be applied
*about the geometry center* (`halo.position = center*(1-HALO_SCALE)`,
`halo.scale = HALO_SCALE`, from `Object3D`'s `position + scale*v`
composition) rather than the mesh's local origin — otherwise it would
reproduce the exact off-center bug the pivot exists to fix. It also needs
`halo.raycast = () => null` (same pattern as `LightRig.jsx`'s debug
helpers) or a click at the rim, where the enlarged shell pokes out beyond
the real mesh, would select the halo itself instead. Each halo is tagged
`userData.__editorHelper = true`: it's a 4%-inflated shell living as a
*child of a real mesh*, so anything that walks the scene graph must skip
it — `collectMeshGroups` (or it would classify halos into a group and into
the mesh dropdown on any recompute made while a selection is live) and
`LightRig.jsx`'s `measureModelBox` (or the adaptive light box would be
sized off the outline instead of the model). drei's built-in
`<Outlines>` can't be used here declaratively — it expects to be mounted
as a literal JSX child of the target mesh, but the selected mesh lives
inside `KeyboardModel.jsx`'s `<primitive object={scene}>` tree, not this
component's own render output.

**Opacity slider**: fades the whole selection and must restore correctly
on deselect — this **does** need dedup, unlike the halo. Since
`materials/groupMaterials.js` now clones one material per *group* (not
per mesh), group members frequently share one material object; naively
looping `mesh.material.opacity = ...` per mesh would have the second-plus
mesh sharing that material capture the *already-mutated* value as its own
"previous" opacity, corrupting the restore. Fixed by deduping on material
object identity (a `Set`) so each distinct material is read/written/
restored exactly once regardless of how many selected meshes reference it.

**No scale**: the gizmo `mode` Leva control only offers
`['translate', 'rotate']` — scaling individual mesh/group parts was
intentionally removed from this tool.

**The gizmo publishes offsets via `onObjectChange`, never `onChange` — do
not "simplify" this back.** three's `TransformControls` dispatches its
generic `change` event from the *property setter* it installs over
`object`/`mode`/etc. (the `defineProperty` block in `TransformControls.js`),
so drei's `controls.attach(newPivot)` on a selection change fires it too.
The callback React invokes at that moment is still the **previous render's
closure**, holding the **old** `pivotInfo` — whose pivot is sitting at
`base + offset` because it was just unwrapped. It therefore recomputed that
old offset and wrote it straight back into Leva, landing *after* the pivot
effect's reset-to-zero, and the idempotent apply effect then faithfully
applied it to the freshly selected mesh/group. Symptom: move a slider, then
pick another mesh/group **directly** (going through a click on empty canvas
first hid it, because that unmounts `TransformControls` entirely, so there
was no stale gizmo left to fire) and the new selection jumped by the
previous one's offset with the slider still reading the old value.
`objectChange` is dispatched only from `pointerMove`, i.e. only when the
user is actually dragging the gizmo — never on attach/detach/mode change —
so the closure is always current. A defensive `e.target.object !==
pivotInfo.pivot` guard sits on top; during a genuine drag the selection
can't change, so it never trips.

The **previously documented "group transform doesn't persist across a mode
switch" issue is fixed**, along with the temporary `console.log`
instrumentation that had been left in the file to chase it (both are gone —
don't reintroduce either). The fix is structural, described above: pivot/
halo/opacity lifecycles keyed on `selectionKey` + `active` rather than on
the `selection` object's identity, the slider reset issued inside the pivot
effect itself, and an idempotent apply effect with no suppression flag.
Verified in the browser: with a group translated in Mesh mode, its meshes'
world position is bit-identical across Mesh → Lights → Mesh, halos
(80 for `keycaps`) and opacity are torn down and rebuilt on the mode edge,
and exactly one `__meshEditorPivot` exists at a time (zero outside
Mesh mode).

### Animations (`animation/`, `AnimationDirector.jsx`, `AnimationEditor.jsx`)

**This replaced the keyframe Timeline, which was deleted outright.** The
Timeline was a per-selection keyframer of `posX..rotZ` offsets: it knew
nothing about poses, focus or opacity, and was never persisted. What was
actually wanted was a way to *compose* the imperative primitives this
component already has into named, saved, replayable sequences — so the
keyframe track was removed rather than extended.

Motivating case, in the user's words: "configurazione rotori" — from the 3/4
front pose go to 3/4 back, frame the `rotors` group, fade everything except
the rotors to 20%, and then, *optionally*, a trigger makes the rotors spin on
their own axes with alternating sign.

#### Data model (`animation/animationSchema.js`)

One new top-level key in the global JSON blob. `{version, items}` rather than
a bare array, so a format bump has somewhere to live and `!!parsed.animations`
stays a clean presence check:

```jsonc
"animations": { "version": 1, "items": [ /* Animation[] */ ] }

// Animation
{ "id": "rotors", "label": "Rotori", "hidden": false,
  "loop": { "mode": "none" },     // "none" | "forever" | "count" (+ times, from)
  "requires": "",                 // sequenza: id dell'animazione che deve essere
                                  // stata ESEGUITA perché questa sia lanciabile
  "restoreOnStop": true, "steps": [ /* Step[] */ ] }

// Step
{ "id": "s3", "action": "setOpacity", "enabled": true,
  "parallel": false,              // true = joins the PREVIOUS step's wave
  "delay": 0,                     // s, from the start of its own wave
  "wait": "duration",             // "settle" | "duration" | "none"
  "duration": 0.6, "maxWait": 8, "easing": "easeInOutCubic",
  "params": { "selector": { "kind": "allExcept", "groupIds": ["rotors"] },
              "opacity": 0.2 } }
```

**Waves are the whole sequencing model.** `buildWaves(animation)` partitions
the *enabled* steps once: `parallel: false` opens a new wave, `parallel: true`
joins the previous one (the first enabled step always opens a wave — there is
nothing to join). The runtime starts every step of a wave together and
advances only when all of them report `done`. One integer cursor, and the
editor indents parallel rows under their leader by reusing the same function —
so the two can't diverge.

`wait` and `duration` are **orthogonal**: `duration` is the *action's own*
animated length (for `durationDriven` actions like fade and offset), `wait`
decides whether the wave blocks on it. `wait:'none'` + `duration:0.6` means
"start a 0.6 s fade and move on immediately." `delay` exists from day one
because it costs nothing and recovers most of what a real timeline gives
("start the fade 0.2 s into the dolly") — without it, parallelism is
all-or-nothing at wave granularity.

**`maxWait` is not polish.** `goTo` silently no-ops on an unknown key or under
the pose lock, and `isFocusSettled` is a threshold on asymptotic damping whose
time constant is `feel.focusDamp` — *a user-facing Leva slider that also ships
in the JSON*. Without a watchdog a mistuned value wedges an animation forever
with no error. `0` disables it, which is what `waitTrigger` does (it waits for
a human).

⚠️ **Mesh selectors store node NAMES, never `uuid`.** `THREE.Object3D.uuid` is
regenerated on every GLTF parse, so a persisted uuid points at nothing on the
next load. `MeshController`'s dropdown may use uuids (they live and die inside
one session); anything written to the JSON may not. The price is that GLB node
names can repeat and a name selects *every* mesh carrying it — the editor shows
`collectMeshList`'s dedup-suffixed label but saves the raw name. This makes the
asset pipeline's "exported node names must keep their distinguishing
substrings" constraint protect animations too, not just group classification.

`resolveSelector` (`animation/selectors.js`) handles `all` / `group` /
`allExcept` / `meshes`, all built on `collectMeshGroups`, so `__editorHelper`
exclusion and the group classification come for free.

#### Runtime (`animation/animationRuntime.js`, ticked by `AnimationDirector.jsx`)

Pure JS, no React — it mutates every frame. `AnimationDirector.jsx` is a
sibling under `<Suspense>` in `Scene.jsx` with its own `useGLTF` (shared drei
cache, like `MaterialTuner`/`MeshController`/`LightRig`), renders `null`, and
owns the single `useFrame` that drives it. It is **always mounted, not
`?debug`-gated**: in production it is what plays the animations launched from
the HUD chips.

⚠️ **No `priority` on that `useFrame`** — a priority > 0 disables R3F's
automatic render loop.

⚠️ **The tick order and the `return` after `start()` are load-bearing:**

```js
const tick = (rawDelta) => {
  const dt = Math.min(rawDelta, 1/20)              // a refocused tab must not skip a step
  for (const inst of instances) tickInstance(inst, dt)          // (1) update everything…
  if (state === 'playing' && waveInstances.every(i => i.done)) advanceWave()  // (2) …then advance
}
// inside tickInstance, right after action.start(...):
inst.started = true
return   // ⚠️ NEVER evaluate isDone in the same tick as start()
```

`goTo` writes the spring's target synchronously but the spring integrates on
the *next* frame: evaluating `isDone` immediately would have `isPoseSettled()`
read "current === old target, velocity 0" and every pose step would fall
through instantly. Same class of bug for the focus dolly. With (1)-then-(2)
plus that `return`, a step started at tick *n* is first judged at tick *n+1*,
and the `useFrame` callback order between the director and
`useComposerControls` becomes irrelevant.

**How each action reports "done"** — there are no completion callbacks
anywhere in this codebase, so every one of these is a polled predicate:

| class | done when |
| --- | --- |
| `goToPose` | `api.isPoseSettled()` — exact equality (the spring snaps to target and zeroes velocity), no threshold to tune |
| `focusGroup` / `clearFocus` | `api.isFocusSettled()` — thresholds on damped values: absolute on the pivot, **relative** on the zoom factor (its targets span 0.02–4, a fixed epsilon would be 0.05% at one end and 10% at the other) |
| duration-driven (`setOpacity`, `transformOffset`, `waitTime`) | `elapsed >= duration` |
| persistent (`spinGroup`) | `wait:'none'` → immediately; the effect keeps living |
| `waitTrigger` | a matching `trigger(name)` arrived |
| anything, worst case | `elapsed >= maxWait` |

**Finishing is not teardown.** When the waves run out the state becomes
`'finished'`: persistent instances keep ticking (the rotors keep spinning, the
isolate stays at 20%) but nothing new starts. That *is* what "configurazione
rotori" means as a product state. Only `stopAnimation()` unwinds, in **reverse
order of start** (a pivot acquired last must be released first), then
`clearFocus()` if `restoreOnStop !== false`.

The **one opt-in exception is `stopOnFinish`** (per animation, default false):
at the end of its last wave the animation calls `stop()` on itself. It exists
for sequences whose job is to *put the scene back* — the `config → idle`
return animation (see "App mode"), which starts chained and therefore inherits
the previous animation's live instances. Without it those keep running with
nobody left to stop them. Calling `stop()` from inside `advanceWave()` is safe:
`tick`'s loop over `instances` has already finished by then.

**Teardown is soft on opacity.** Releasing the handles restores every material
to its snapshot **in one frame**, which is what made switching from one
animation to another flash the isolate back to opaque. `stop()` now opens a
**release phase**: `beginRestoreAll()` is taken *before* the per-action
teardowns (while the materials are still owned), those teardowns are told
`{ keepOpacity: true }` so `setOpacity`/`clearFocus` **skip their own release**,
and the runtime interpolates to the snapshot over `app.releaseDuration` with
`app.releaseEasing`, calling `finish()` — the only place `transparent`/
`depthWrite` come back and clones are disposed — at the end. Consequences worth
knowing:
- `tick()` advances the release **even when `state === 'idle'`**; that is the
  one thing that outlives the sequencer.
- ⚠️ a `play()` that resets is **queued** until the release completes
  (`pending`), because the outgoing fade and the incoming `setOpacity` would
  otherwise write the same materials in the same frame with no defined winner.
  That wait *is* the transition between two animations. `getState()` reports
  `state: 'releasing'` with the **pending** id, so the HUD chip lights on the
  click rather than at the end of the fade.
- pivots and variants stay **synchronous**: they are hierarchy ownership, not a
  value to interpolate. `setVariant` always closes its own cross-fade
  (`keepOpacity` doesn't apply to it) — hence `beginRestoreAll().lerp` skips
  targets that are no longer owned, and `remaining` lets `stop()` decide there
  is nothing left to fade.
- `stop({ soft: false })` is the escape hatch, and both callers need it:
  entering `editMode 'meshes'` (whose opacity slider writes the same materials)
  and director unmount.
- the **zoom-out** side of the same transition is not here: it was always
  damped, and now has its own knob, `focusOutDamp` (Leva `Rotazione`, ships in
  `rotation`) — see "Zoom".

**One live instance per `(animId, step.id)`.** On a loop iteration a persistent
action must not re-acquire pivots/materials, or the refcount never returns to
zero — the existing instance is restarted via `action.restart?.()` instead. The
animation id is part of the key because chaining (below) puts instances from
*different* animations in the same list, and step ids are only unique within an
animation.

**Chaining — `startFrom: 'reset' | 'keep'`.** `play()` used to always `stop()`
first, which tore down *everything*: opacity handles released (so the isolate
snapped back), pivots released, focus cleared. That made "play A to frame and
x-ray the rotors, then play B to spin them" impossible — B reset A's work. With
`startFrom: 'keep'` (or `playAnimation(id, { keep: true })`) nothing is torn
down: the previous instances stay in `instances`, keep being ticked, and remain
`stop()`'s responsibility. Only the wave cursor and the pending triggers are
reset. Default stays `'reset'`.

⚠️ Since the HUD lost its stop button (see "What stops an animation" below),
`startFrom: 'reset'` is no longer just a convenience — **it is one of the two
reset mechanisms the product has**. A set of authored animations that are all
`'keep'` can only be undone by leaving `config`. Author at least one entry
animation that resets.

Note what `restoreOnStop` does and doesn't cover: it gates **only the camera
focus release**. Opacity and transforms are *always* restored on `stop()`,
because their handles have to go back to the registries — leaving them would
leak owned materials and orphan pivots (opacity now gets there over
`releaseDuration` instead of instantly, but it always gets there). If the goal is "don't undo the previous
animation", the control to reach for is `startFrom`, not `restoreOnStop`; the
editor labels them accordingly ("al play…" vs "stop rilascia lo zoom").

**`stop()` is not a product surface.** An animation is never stopped by hand
from the shipped UI: it runs, reaches `'finished'`, and **leaves the scene the
way it put it** — framing, isolate opacity, persistent rotations all stay. The
only two ways to undo that are the ones already formalized elsewhere in this
file: **play another animation declared `startFrom: 'reset'`** (which goes
through `stop()` on its own account, release phase and all), or **change app
mode** (see "App mode"). Everything else that calls `stop()` is either
machinery or authoring:

| caller | why |
| --- | --- |
| `playAnimation(other)` with `startFrom: 'reset'` | plays are exclusive — `stop()`, release phase, then `play()`. **This is the product-facing reset.** |
| `changeAppMode` (both directions) | idle⇄config is the other formalized reset; see "App mode" |
| entering `editMode 'meshes'` | mandatory — `MeshController`'s pivot and the registry's pivots reparent the same meshes and must never both be live |
| the animation's own `stopOnFinish` | opt-in, for sequences whose job is to put the scene back |
| director unmount | safety net |
| `AnimationEditor`'s ■, `window.__stopAnimation()` | **authoring only**, `?debug` |

Consequences in `Hud.jsx`, all deliberate:
- **the animation chips are a selector, not a toggle.** Clicking the *active*
  chip re-plays it (what `startFrom` says happens, happens); it does not stop
  it. There is no "stop" button in the product HUD.
- **`Escape` no longer stops.** Its cascade is now: an animation is
  active → leave `config` for `idle` (the sanctioned reset, skipping the
  intermediate `clearFocus` rung since the framing belongs to the animation);
  else a group is framed → `clearFocus()`; else leave `config`.
- **the two-writers-on-pose/zoom hazard no longer needs arbitration in the
  HUD at all.** It used to: the pager and the focus chips went inert while
  `animationState().state` read `'playing'`/`'releasing'` and came back at
  `'finished'` (which replaced an earlier `stopIfAnimating()` — waiting instead
  of tearing the animation down). Both rows are now **gone** (see "HUD"), so an
  animation is the only writer on pose and focus for its whole life, and the
  `'forever'`-loop edge case that used to hold that buttonry inert is moot.
  What remains on the chips is the Mesh-mode gate alone.

Drag and arrow keys never stopped it and still don't (they're off in `config`
anyway).

`?debug` console handles, same idiom as `window.__focusGroup`:
`__playAnimation(id, opts)`, `__stopAnimation()`, `__animTrigger(name)`,
`__animState()`, `__animStats()` (owned materials / clones / pivots — the
counters the teardown assertions check).

#### Sequences (`requires`)

"A group of animations in a fixed order" is **not** a container — it is a
**chain of prerequisites**, one field: `requires`, the id of the animation that
must have been *executed* before this one can be launched. `A1 ← A2 ← A3` is the
whole feature; each link knows only its predecessor, and the order is the chain.
A first-class `sequences` list would need its own JSON section, its own editor
and its own HUD grouping to express exactly the same constraint.

- **"Executed" means "ran out of waves"** — the runtime adds the id to a
  `completed` Set inside `advanceWave()`, at the same point that sets
  `'finished'` and *before* `stopOnFinish` clears `anim`. Not at `play()`, which
  can be replaced mid-flight. ⚠️ Consequence: **a `forever`-loop animation never
  unlocks anything**, and neither does one blocked on a `waitTrigger` nobody
  triggers. `AnimationEditor` warns about the first, and about a prerequisite
  that is `hidden` (no chip in production = no way to satisfy it).
- **Replaying a link walks the sequence back**: `play(id)` removes `id` *and
  everything that transitively requires it* from `completed`. Without that,
  going back to A1 would leave A3 unlocked.
- **The progress is per-session and resets on `changeAppMode`**, both
  directions — the one place the scene returns to a known state, so it is the
  one place "A1 has been executed" should decay.
- ⚠️ **The gate is the HUD, not the runtime**, exactly as for app mode:
  `play()` launches anything. `Hud.jsx` disables a chip whose prerequisite is
  missing (dashed border, `title` naming what to run first); the editor's ▶ and
  the `?debug` console keep working, or authoring A3 would mean replaying the
  whole chain every time.
- Cycles are impossible by construction on two fronts: `normalizeAnimations`
  breaks the closing edge of any cycle (and drops a `requires` pointing at a
  missing id or at itself), and the editor's dropdown only offers candidates
  that don't already descend from the current animation (`canRequire`).

#### Action registry (`animation/actions.js`)

**One `ACTIONS` object is the single source of truth**, holding the parameter
*schema* (from which `AnimationEditor` generates its fields) and the runtime
*implementation* side by side, so the two can't drift. Adding an action there
makes it appear in the editor with no UI code.

```js
{ label, group,               // 'camera' | 'materiali' | 'trasformazioni' |
                              // 'varianti' | 'flusso'
  persistent, durationDriven,
  defaults: { wait, duration, easing, maxWait },
  params: [ { key, type, label, default, … } ],   // type: number|boolean|string|
                                                  // select|vec3|selector|group|pose|easing
  start(inst, ctx), update(inst, ctx, dt), isSettled(inst, ctx),
  restart(inst, ctx), stop(inst, ctx),
  inverse(step, ctx), inverseNote }   // authoring: come si disfa, o perché no
```

⚠️ **`inverse` lives here, not in the generator that uses it** — same argument
as schema-next-to-implementation: if "what this action does" and "how you undo
it" lived in two files they would diverge at the first parameter added. It takes
the **authored step** (static data, not a live instance) and returns
`{ action?, params? }` — a missing `action` means "same action, different
params" — or `null` for "not invertible, skip", with `inverseNote` saying why.
The ones that return `null` and the reason: `clearFocus` (nothing says which
group to re-frame), `spinGroup` (a continuous rotation has no inverse; the
end-of-sequence release closes it), `wobble` (self-damping), `setVariant` (the
choice is user state — the same asymmetry `stop()` obeys) and `waitTrigger` (a
return must not sit waiting for a human). Two whose inverse is *not* the obvious
mirror: `transformOffset` goes to `[0,0,0]` rather than to the opposite offset,
because `OFFSET_CHANNEL` is shared and interpolates from wherever it is — the
opposite offset would double the displacement; and `focusGroup` inverts into a
`clearFocus` with **`restoreOpacity: false`**, since a generated inverse already
carries the explicit inverse of each `setOpacity` and the two would write the
same materials in the same frame.

Shipped set: `goToPose`, `focusGroup`, `clearFocus`, `setOpacity` (fade-in and
fade-out are the same action with `opacity` 1 or 0), `spinGroup`, `rotateBy`,
`wobble`, `transformOffset`, `setVariant` (see "Model variants"), `waitTime`,
`waitTrigger`.

**`clearFocus` is not just the inverse of `focusGroup`** — it is the full "put
it back", so it also **restores opacity**, interpolated over its own `duration`
rather than snapped. Without it, leaving an isolate required a hand-authored
inverse `setOpacity`, and on *which* selector? The opacity may have been taken
by several different steps. The restore therefore goes through
`opacityRegistry.beginRestoreAll()`, the only thing that knows which materials
are under override and what value each started from — it interpolates toward
the **snapshot**, not a literal `1`, so a GLB material authored semi-transparent
isn't silently "fixed". The handles are released only once the interpolation
completes; releasing earlier would snap. A `restoreOpacity` param turns it off.

⚠️ **The fade only happens if the opacity handles are still owned when the step
starts.** `stop()` restores opacity *synchronously* (the materials have to go
back to the registry, or they stay owned by nobody), so a `clearFocus` in the
first wave of an animation with `startFrom: 'reset'` finds nothing left to fade
and snaps. Put it in the animation that applied the opacity, or set that
animation to `startFrom: 'keep'`. Verified in the browser both ways: same
animation `0.2 → 0.234 → 0.398 → 0.562 → 0.725 → 0.887 → 1`, chained
`0.2 → 0.329 → 0.467 → 0.605 → 0.742 → 0.881 → 1`, `'reset'` snaps to 1 in one
frame. `AnimationEditor` detects that exact configuration and warns.

⚠️ `clearFocus` is marked `persistent` even though it leaves nothing running:
the runtime stops ticking non-persistent instances the moment they are `done`,
so with any `wait` other than `'settle'` the fade would freeze half-way.

**Three rotation actions, deliberately distinct**: `spinGroup` never ends (it
is the "keep turning" state), `rotateBy` turns by a finite angle and stops, and
`wobble` oscillates with an exponential decay envelope (`decay` is a time
constant in seconds; `0` never dies down). `rotateBy` exists as a preset rather
than as a case of `transformOffset` because a single-axis + angle UI is a very
different authoring act from a rotation vec3 — and because "show me the other
side of this part" is a thing you want one control for.

**The axis is simply the model's axis** — `'y'` means the model's vertical, no
parameter, no conversion. That is a property of the pivot being identity-
oriented under `scene` (see "Pivots"), not something the actions do. They used
to carry an `axisSpace` (`'model'`/`'local'`) plus an `axisInPivotFrame`
conjugation, because a single-mesh pivot then inherited the mesh's own — often
tilted — orientation and "rotate about Y" was not the model's vertical. Choosing
the orientation correctly removed the parameter and the machinery both; don't
reintroduce either.

⚠️ **`perMesh` is the parameter that actually bites, and it is not a nuance.**
With it off, N meshes rotate as one rigid body about their *common* centre — so
they orbit and translate. Verified with the two rotor knobs: a 90° group
rotation slides each one 0.1296 world units, ~90 % of its own diameter,
lifting it out of its socket and into the neighbouring keycaps, while its own
vertical axis stays exactly `(0,1,0)`. It reads as "the rotors tilt and clip
through the plate", but nothing tilts — measured world quaternion is a pure Y
rotation at every sampled angle, and the world AABB's `minY` never moves. With
`perMesh` on, the same rotation leaves each knob's centre displaced by exactly
`0`. `rotateBy` and `wobble` therefore default to `perMesh: true`;
`transformOffset` keeps `false`, because a rigid group translation *is* the
normal intent there and per-mesh is the explode case you ask for explicitly.
What it selects today is the **centre** written into each mesh's channel, not a
different pivot — see "Pivots". One consequence worth having: mixing
granularities on overlapping meshes (a rigid group offset plus a per-mesh spin)
now simply composes, where it used to be refused.

**Duration-driven persistent actions stop writing once complete**
(`inst.data.settled`). They hold pivots/materials so the runtime keeps ticking
them; without the guard they would recompose N pivots every frame forever to
rewrite the same quaternion — and, worse, `setOpacity` would fight
`clearFocus`'s gradual restore over the same materials, with the frame's last
writer winning.

**No action adds a fourth writer to `cameraRadius`** — `focusGroup` goes
through the existing `focusZoom` ref. What it did need is the `extra` argument
on `applyFocus` and the `focusExtraRef` fix documented under "Zoom".

#### Opacity (`animation/opacityRegistry.js`)

**`applyMaterialProps` deliberately does NOT gain `opacity`/`transparent`.**
Adding them would put a static opacity in every `Materiale · <gruppo>` Leva
folder, in `window.__STATE_MATERIALS` and in every saved JSON — and
`MaterialGroupTuner`'s apply effect re-runs on every `values` change, so the
tuner and the animation would be two owners of one property with the tuner
winning at unpredictable moments. Opacity stays a **runtime-only override
layer**. The happy consequence: `applyMaterialProps` writes only
color/roughness/metalness/envMapIntensity/clearcoat/clearcoatRoughness, so
moving a material slider mid-animation *cannot* clobber a fade. Orthogonal by
construction, not by discipline.

The hard part is that `prepareGroupMaterials` clones **one material per
group**, so a group's meshes share one object — right for "fade the whole
group", wrong for "fade 3 keycaps". Two paths:

- **Fast path**: if the selection contains *all* users of a material (the
  common case — `allExcept('rotors')` is 5 whole group materials), write
  straight to the shared material. Zero clones, zero extra shader compiles.
- **Clone-on-write per mesh**: a partial subset of a shared material gives
  each selected mesh its own clone (`__groupMaterialFor` copied onto the clone
  so `prepareGroupMaterials` stays idempotent), restored and disposed on
  release.

`own(material)` snapshots `prevOpacity/prevTransparent/prevDepthWrite`
**once**; a second acquire bumps `refs` and does *not* re-snapshot — otherwise
a second fade would capture the first fade's value as "original" and the
restore would be wrong. This is exactly the bug `MeshController`'s
identity-`Set` dedup prevents *between meshes*, generalized *across time*.

⚠️ **Anti-recompile discipline**: `transparent` and `needsUpdate` are touched
only at acquire and release. During the fade the writes are `material.opacity`
(a uniform) and — see below — `material.depthWrite`, which is renderer state
read at draw time, not a shader define, and therefore free. `MeshController`'s
slider sets `needsUpdate = true` on every change — harmless at mouse cadence,
disastrous per-frame with ~34 forward-rendered lights. Do not copy that line
into the per-frame path.

**The acquire-time flip is itself a shader compile, and it is pre-warmed**
(`materials/warmupTransparency.js`, driven from `KeyboardModel.jsx`). This is
the one piece of the discipline above that cannot be avoided, only moved:
`material.transparent` is **not** renderer state, it is a bit of the *program
cache key* — `getParameters` derives `opaque: material.transparent === false
&& …`, `getProgramCacheKey` folds it in as `_programLayers.enable(17)`, and
`WebGLProgram` emits `#define OPAQUE` from it. So the first `setOpacity` of a
session compiles and links a brand-new shader per define-combination,
synchronously, with all ~34 lights in it. **Measured in the browser on this
asset: a normal frame costs 0.4 ms of CPU; the frame that has to compile one of
these costs 192 (1000 for the very first, which also pays the driver's compiler
startup).** That is the stutter. It never recurred because
`materialProperties.programs` is a per-material `Map` keyed by cache key,
emptied only on material *dispose*, and the group materials are never disposed.

⚠️ **A mount-time one-shot does NOT work, and shipping one was the first
attempt.** `applyMaterialProps` writes `clearcoat`, and `clearcoat > 0` is
itself a define (`USE_CLEARCOAT`). The authored values arrive *later*, with the
production JSON fetch (`app-load-materials`), and on this asset they change the
combination — `landing` sits at 0, every other group above it. Measured: the
one-shot warmed the pre-JSON variants, the JSON invalidated them, and the first
play still compiled 2 programs — **identical to no warm-up at all**, plus one
wasted program in cache. The fix is `programSignature()`: rather than knowing
*which* events mutate materials (production fetch, "Carica JSON", Leva sliders,
and tomorrow the high-def textures, which are also defines), a 400 ms poll
watches the state that actually enters the cache key and re-warms when it
changes, with a one-tick debounce so dragging a slider through `clearcoat === 0`
doesn't recompile at every intermediate value.

Three more details are load-bearing, and the file argues them at length:
- **synchronous flip → `gl.render` → restore, not `compileAsync` + restore in
  `.then()`**: an `await` between flip and restore is a window in which an
  animation could acquire these very materials and have `transparent = false`
  written over its fade;
- **a real `gl.render`, not `gl.compile`**: three defers `LINK_STATUS` and *all
  uniform-location resolution* to `onFirstUse`, i.e. to the first draw. Only an
  actual draw pays that, and with 34 lights it is a large part of the cost;
- **`__variantHidden` meshes are temporarily made visible for that one frame**,
  or their materials are never drawn and so never compiled — verified:
  `patchesANSI` sat at `programs.size === 0` with ISO selected, so the first
  variant swap (which cross-fades, i.e. goes transparent) paid a cold compile.
  It collects materials by the `__groupMaterialFor` tag rather than through
  `collectMeshGroups`, which skips hidden meshes by design.

It depends on the rig's **light-count invariant** (intensities animate, counts
never do). Mount/unmount a light and the warm-up warms the wrong cache key.

Free side effect: the clone-on-write path is covered too — a clone has the same
parameters, hence the same cache key, and `acquireProgram` shares by key at the
renderer level.

**`depthWrite` is gated by an opacity threshold (`DEPTH_WRITE_MIN`, 0.2), not
a flat `true`.** The `depthWrite` param is still there and still defaults to
`true`, but it now means "write depth *while essentially opaque*": every path
that writes opacity (`set`, `lerpTo`, `beginRestoreAll().lerp`) calls
`syncDepthWrite`, which ANDs the request with `opacity >= DEPTH_WRITE_MIN`.

The reason is the artifact this caused, found by driving the app: a set of
interpenetrating meshes that all write depth is exactly the case where the
image depends on **draw order**, and the transparent pass re-sorts by distance
every frame — so the first one drawn punches the others out, and the set flips
as the camera moves, which during an animation it always is. Measured on the
80 keycaps (one shared material) mid-fade at `opacity 0.55`: turning
`depthWrite` off changes **28 076 pixels**, 2.7 % of the frame, average delta
72/765. It reads as parts flickering inside each other.

⚠️ **The threshold's value is a measured compromise and the flip is inherently
a discontinuity — there is no opacity at which the two modes agree.** They
diverge *most* toward opaque (at `opacity 1` they differ by avg 76 over 13 597
px; at 0.5, by 41), because there each mode is wrong in the opposite direction:
with depth writing the front face correctly hides what's behind, without it a
mis-sorted far mesh overwrites a near one. Against the ~4 avg delta of a normal
60 fps fade step on this scene:

    threshold   0.95   0.5   0.3   0.2   0.06
    jump          69    41    31    23      9

The first version of this fix shipped at 0.95 and the jump — ~17 fade steps in
a single frame — was immediately reported as the fade having become "steppy".
0.2 costs ~5. Below 0.1 the flip is imperceptible but depth writing then covers
over 90 % of the fade, i.e. the artifact is back. **Moving this constant trades
one defect for the other; it does not remove either.**

Dead ends already explored, so nobody re-walks them: `alphaHash` (continuous by
construction — at `opacity 1` it is pixel-identical to opaque — and fully
order-independent, but the stochastic grain without temporal accumulation is
far too visible on this product; revisit only once the planned progressive
accumulation exists), and turning depth writing off at acquire instead (same
jump, merely moved to the first frame of the fade: 76 instead of 23).

Turning ~250 meshes transparent already moves them into the depth-sorted
transparent pass; this only decides what they do once there. The perf
difference is negligible either way (measured 14.95 vs 15.57 ms/frame).

#### Pivots (`animation/pivot.js`, `animation/pivotRegistry.js`)

`pivot.js` is `MeshController`'s wrap machinery, extracted verbatim and used by
both (see "Mesh editor"). The registry adds shared ownership.

⚠️ **The teardown semantics differ, and this is the single biggest trap in the
whole system.** `MeshController` unwinds with `restore({ bake: true })` —
`parent.attach(mesh)`, which *bakes* the current transform into the mesh. Right
for an editor: the user's edit persists. **Catastrophic for an animation**:
`stopAnimation()` after a `transformOffset` would bake the explosion into the
in-memory GLB permanently. The animation path therefore **restores rather than
bakes**: every mesh's `{parent, position, quaternion, scale}` is snapshotted at
wrap time and rewritten at unwind with `parent.add(mesh)` — not `attach()`,
which would be a matrix round-trip, i.e. float drift.

**One pivot per mesh, always — there is no such thing as a group pivot here.**
A rigid group transform is a shared **centre** written into each mesh's channel,
not a different container. Everything else in this section follows from that.

⚠️ **It used to be otherwise, and the difference is worth knowing because the
old model is what most of the surrounding design was working around.** An
acquire's target could be a mesh *or a set of meshes*, and the set was the
handle's key. Two targets that overlapped without coinciding were therefore two
pivots contending for the same children — whichever unwound first would reparent
meshes that by then lived under the other — so the registry **refused** them,
via a `meshOwner` map, a `canClaim` check and a `console.warn`. Correct, and
unusable while authoring: "move 105 meshes, then bring 4 of them back" was
refused, the step then did nothing at all (a rejected acquire returns `null`,
`start()` ends up with `handles: []`, `update()` iterates over nothing, the step
completes on its `duration` and the wave advances — no error, no effect), and
getting the effect meant hand-splitting the selector into two disjoint sets
(4 and 101) *knowing why*. With per-mesh ownership partial overlap cannot exist:
two steps touching common meshes simply share those meshes' handles. Gone with
it: `canClaim`, `meshOwner`, the set key, the warning, and the static
`pivotConflicts.js` analysis that had been added to the editor to anticipate it.

**Channels.** A handle carries a `Map` of contributions. Each is a rigid motion
in the scene's local space — `x ↦ c + T + Q·(x − c)` — with a centre, a
translation and a rotation. The centre is the whole of `perMesh`: the mesh's own
centre ("each on its own centre") versus the group's common centre ("the set as
a rigid body", so members orbit and translate). **`perMesh` no longer changes
which pivots are taken, only what centre goes into the channels.**

Keys: rotating actions use `step.id`, so two rotating steps on the same mesh add
up instead of overwriting each other and a fourth rotating action needs no
change to `pivotRegistry.js`. `transformOffset` deliberately uses **one shared
key** (`OFFSET_CHANNEL`) instead — ⚠️ and that is what makes `position: [0,0,0]`
mean *"back to the rest pose"*: a later step finds the channel part-way and
resumes from it (`inst.data.from` reads the channel, not zero). With a per-step
channel the second step would start from zero and move nothing.

⚠️ **`compose()` applies rotations first and translations last**, and it is not
a detail: it means "spin on its own axis *after* being moved out" — the
explode-and-rotate case. Fold the channels in insertion order instead and a
rotation registered after an offset makes the mesh orbit the point it started
from. Verified in the A/B harness, and note it is **invisible** unless the
translation is off the rotation axis: with `[0,30,0]` and a spin about Y,
`Q·T = T` and both orders agree.

The rotations themselves compose as **true rigid motions**, each about its own
centre (`R ← Q·R`, `t ← c + Q·(t − c)`), not by summing positions and
multiplying quaternions separately — those agree only when every channel shares
one centre, and two rigid group rotations about the same centre would come out
wrong.

⚠️ **The per-mesh pivot is identity-oriented under `scene`, not aligned to the
mesh**, and that is load-bearing: the pivot's axes *are* the model's, so "rotate
about Y" means the model's Y by construction. The old single-mesh pivot
inherited the mesh's own orientation — often tilted in this Maya-exported GLB —
which required conjugating the requested axis into the pivot's frame
(`axisSpace`, `restWorldQuat`, `axisInPivotFrame`, plus a user-facing parameter).
All of it existed to repair an orientation choice, and all of it is gone.
`pivot.js` keeps the oriented single-mesh branch for `MeshController`, whose
gizmo must show the mesh's own orientation.

Animation pivots are named `__animPivot`, distinct from `__meshEditorPivot`, so
the "exactly one editor pivot at a time" browser assertion still holds and gains
a sibling. No `__editorHelper` tag is needed — a pivot is a `Group`, and both
`collectMeshGroups` and `measureModelBox` filter on `isMesh`.

⚠️ **A JSON predating this carries `axisSpace` on its rotating steps.**
`normalizeAnimations` rebuilds each step's `params` from the action's schema, so
the key is dropped on the round trip with no migration needed — and on this
asset it was a no-op anyway (measured: every mesh node carries an identity
quaternion, and `scene.getWorldQuaternion()` is identity too, so `'model'` and
`'local'` resolved to the same axis).

#### Persistence

The source of truth is **React state lifted to `KeyboardComposer.jsx`**, which
renders both the Canvas subtree and the DOM overlays — so the list travels as
an ordinary prop and needs no imperative bridge (see "Architecture"). It is
mirrored to `window.__STATE_ANIMATIONS` for the save, and an
`app-load-animations` listener there feeds it back through
`normalizeAnimations`.

`AnimationDirector` mirrors the prop into a ref and resolves ids through it, so
editor keystrokes re-render one component that returns `null`, and
`playAnimation(id)` always plays the *current* editor state — no separate
"preview unsaved" API.

Three sites in `LightRig.jsx` must stay in sync, as for every other section:
`handleSaveJSON` (adds `animations`), `handleLoadJSON` and the production
fetch (both dispatch `app-load-animations`). Backward compatibility is free —
the `isNewFormat = !!parsed.lights` gate is untouched and each dispatch is
`if (parsed.X)`-guarded. The shipped
`public/lightconfig/app-state-config.json` currently carries **eight** of the
nine sections — `lights`, `materials`, `rotation`, `keylight`, `spotlight`,
`focus`, `animations` (6 authored animations: `GoToRotors`, `RotorSPin`,
`GoIdle`, `GoToPatches`, `SwitchToISO`, `SwitchToANSI`) and `app`
(`homePose: 'TL'`, `idleAnimation` bound to `GoIdle`, the release timings).
The ninth, `variants`, will appear the first time someone authors a swap
binding — it now carries **only** those bindings, never the layout selection
(see "Model variants"), so production always starts on `defaultOption` from
`meshVariants.js` (`iso`) by design.

⚠️ **`GoIdle` carries `stopOnFinish: true`, and that is a requirement of the
binding, not a preference.** A return animation starts with `keep: true` and
therefore inherits the previous animation's live instances; without it they
outlive the transition into the next session. `AnimationEditor` warns about
exactly this configuration.

To re-check this list rather than trusting the paragraph:

```bash
node -e "console.log(Object.keys(require('./public/lightconfig/app-state-config.json')))"
```

`normalizeAnimations(raw)` fills defaults, drops steps with unknown actions
(with a warn), generates missing ids, dedups animation ids, and rebuilds each
step's `params` from the action's schema — so a JSON missing a parameter added
later gets its default instead of `undefined`, and parameters since removed
don't survive the round trip. It also accepts a bare array, so pasting just the
list into the JSON view works.

#### Editor (`AnimationEditor.jsx`, `editMode === 'anim'`)

DOM overlay outside the Canvas, same idioms as `Hud.jsx`: `DEBUG` recomputed
locally, a 150 ms poll on `poseApi.current` for `editMode` plus the runtime
state, `null` unless `DEBUG && editMode === 'anim'`.

Deliberately **plain DOM, not Leva**: `useControls` can't take a per-step
dynamic schema without the component-per-item trick, and the step list changes
length constantly. Two views on the same data — a block list whose parameter
fields are *generated* from `ACTIONS[type].params` via one `<ParamField>`
switch, and a JSON textarea whose text lives in **local** state (so half-typed
JSON can't destroy the model) applied only via a button that runs it through
`normalizeAnimations`.

**Layout: a column docked LEFT, not a bar centred at the bottom.** The model
sits in the middle of the canvas and the HUD chips sit bottom-centre; a wide
bar there covered both. The column starts below the logo lockup and stops above
the footer (the HUD derives that point from `--hud-pad`/`--logo-h`; the editor
reproduces it with equivalent `clamp()`s, since those custom properties live on
`.hud`). Leva is anchored right, so the two never meet. A `—` button collapses
the panel to its title + play/stop row, for looking at the model without
leaving debug mode.

⚠️ **`color-scheme: dark` on every `<select>`/`<input>` is not cosmetic.** A
native select's *popup* is drawn by the OS, not by the document's CSS: without
it the option list renders white-on-white on Chrome/Windows and is legible only
under the cursor. The `option`/`optgroup` background rules alongside it are the
belt-and-braces for browsers that do honour them.

A step is a **card of three lines** (identity + commands / parameters / timing),
not a single row — ten controls in a row would wrap arbitrarily in a narrow
column. Reordering uses `↑`/`↓` buttons, not HTML5 drag-and-drop: more reliable
and keyboard-accessible. The `∥` toggle is disabled on the first step.

**Cards are grouped into collapsible blocks, one per synchronized set** (the
`parallel` run — i.e. a wave). The header carries the commands that apply to all
of them at once: `▶` play from this wave (it moved off the individual cards —
it was always a wave-level command), `⧉` duplicate the block, `⎘` copy it to
the clipboard, `×` delete it, and the `▾`/`▸` fold. Folded, it shows the
contained action labels so it stays recognizable.
⚠️ The grouping is `buildStepGroups` (**all** steps, disabled included), not
`buildWaves` (enabled only) — an editor that hid a disabled step would be
lying about the list you are editing. The two disagree when a block's leader is
disabled, so the **wave number badge on each card still comes from
`buildWaves`**, which is the runtime's truth.

**Copy, in three scopes.** `⧉` on a card duplicates that step in place (keeping
its `parallel`, so it stays inside its block); `⧉` on a block header duplicates
the whole block below it; `⎘` on either puts it in an in-editor **clipboard**
that survives switching animation — which is the only way to move a block from
one animation to another. Paste appends at the end (then place it with `↑`/`↓`:
an explicit "paste here" on every block would be more buttons and more
ambiguity). Every path goes through `cloneSteps`, which **regenerates ids** —
they are the key of the live instances, and two steps sharing one would steal
each other's instance (see `startStep` in `animationRuntime.js`).

**`⧉ duplica` / `⇄ inverso`** sit in the set-management row, next to
`+ nuova`. Cloning keeps `requires`: a variant of A2 belongs at A2's place in
the chain, not at the start. The inverse (`reverseAnimation`) is the "explode
that reassembles" — and two things about it are mechanics, not taste:
- **the order reverses by BLOCK, not by step**: a synchronized set stays
  synchronized and keeps its internal order. Reversing the flat list would
  scatter it and send the leader to the back;
- **the pose chain shifts by one**: "go to P2" inverts into "go back where you
  came from", i.e. the `goToPose` before it; the first one returns to the
  entry pose, for which the editor passes `app.homePose` — the only pose known
  without executing the sequence, since both product modes start there.

  It is generated with **`startFrom: 'keep'` + `stopOnFinish: true`**, the same
  obligatory pair as the idle-return transition (a reset play would tear down
  the very state the inverse exists to undo; starting chained it inherits live
  instances that nothing else would release), and with `requires` pointing at
  the original. It reports what it could not invert in a notice bar — **a
  generated inverse is a starting point to refine, not a finished result**.

**Number fields (`NumberInput`) may be left empty; empty reads as 0.** Clearing
one used to snap an immediate `0` back into the box that had to be selected
away before typing. The text is now local state and only the *parsed* value goes
to the model, so `''` stays `''` on screen while the model reads
`emptyValue` — `0` normally, `null` for the `optional` params (`focusGroup`'s
`radiusFactor`/offsets), where empty means "use the `FocusTuner`'s authored
value", not zero. ⚠️ Resync from the outside compares the *parsed* text, never
the raw string: comparing strings would turn `'' → onChange(0) → value 0 →
text "0"` into a loop that puts back the zero just deleted.

Two parameter types get real UI:
- `selector` — a `kind` select, plus group toggle chips, plus (for
  `kind: 'meshes'`) a **scrollable checkbox list with a text filter**, a
  select-all/none pair and a live count. Not a `<select multiple>`: that needed
  ctrl/shift for multi-selection and one stray click wiped the whole set. It is
  fed by `apiRef.current.meshCatalog()`, since the editor lives outside the
  Canvas and has no access to the scene; it displays `collectMeshList`'s
  dedup-suffixed labels but stores node **names**.
- `pose` — `label · key` disambiguation, because `POSE_HUD_LABEL` has
  intentional duplicates (same reason as `LOCKED_POSE_OPTIONS` in `Scene.jsx`).

**A "sequenza" block** holds the one `requires` dropdown plus the derived chain
(`A1 → A2 → **A3**`) and the two warnings that make a link unreachable (a
`forever` prerequisite, a `hidden` one). See "Sequences" above.

**A "transizioni" block sits next to the variant-swap bindings**, and for the
same reason: what it edits is not a property of one animation but of how the
component moves between states — the `config → idle` return animation and the
release fade's duration/easing. It writes into the `app` section
(`appConfig`/`onAppConfigChange` props from `KeyboardComposer.jsx`), not into
`animations`, and it warns when the bound return animation lacks
`stopOnFinish`. Its sibling knob for the zoom-out lives in Leva
(`Rotazione → zoom-out (uscita)`), because that one is camera feel and travels
in `rotation`.

**`↑ importa` / `↓ esporta`** move *only* the `animations` block, as an
`animations.json` in exactly the shape of the global blob's `animations` key —
so the two are interchangeable. This is deliberately separate from the global
"Salva"/"Carica" pair docked under the Leva panel (handlers in `LightRig.jsx`),
which serialize *all* tunable state at once: animations are the one section
you'd want to hand to someone, diff, or keep in version control on its own.
Import replaces the whole set (like "Carica" does), behind a `window.confirm`
when there is existing work to lose.

#### Known strains

- **Every "done" is a policy, not a fact.** Half the steps end when a physics
  predicate happens to converge, so the same animation genuinely takes
  different wall-clock time on different machines, at different `focusDamp`
  values, and after a user drag lands mid-step. Fine for a configurator; not
  fine if anything ever has to sync to audio or scroll.
- **`feel.focusDamp` and `feel.timeScale` both ship in the JSON.** The first
  silently changes how long every `wait:'settle'` focus step blocks; the second
  scales the pose spring but *not* the focus damping (deliberately), so
  settle-based and duration-based steps drift relative to each other when it
  changes.
- **No scrubbing.** "What does it look like 2.3 s in" means replaying from the
  top; `playAnimation(id, {fromWave: n})` softens it but the state at wave *n*
  depends on all prior side effects. This is the real ergonomic cost of the
  sequencer over the thing it replaced, and it is felt while authoring, not in
  production.
- **Not reversible by construction.** A timeline plays backwards for free; a
  sequencer doesn't. The way back is either `stopAnimation()`'s teardown
  (all at once, no easing) or hand-authored inverse steps — which is why
  `stop()` must stay exhaustive and the restore-not-bake unwind is not
  negotiable.
- **`LightRig`'s `measureModelBox` will see the spinning rotors.** It
  re-measures every `BOX_REFRESH_FRAMES` and damps the result, so a group whose
  AABB changes shape as it rotates can make the adaptive light box slowly
  breathe. If it turns out to matter, the skip flag belongs on **spin only** —
  a `transformOffset` *should* stretch the box, that's the point of it.
- A partial-subset fade clones N materials and flips `transparent`. The shader
  compile that used to cost is now pre-warmed at load
  (`materials/warmupTransparency.js`, see "Opacity"), and the warm-up covers
  the clones too since they share the originals' cache key — but the *cloning*
  itself (N `Material.clone()` plus the swap on each mesh) is still per-acquire
  work. The fast path avoids it for whole-group selections, the common case.

### HUD (`Hud.jsx`)

Real, always-mounted product UI (not debug-gated), DOM overlay with
`pointer-events: none` except the **variant chips**, the **animation chips**
and the **app-mode button**.

⚠️ **The surface is deliberately minimal, and two rows were REMOVED to get
there**, not hidden: the `01–05` pose pager (`.pager`/`.page*`, gone from the
CSS module too) and the group-focus chip row (`.focusBar`; the shared chip
base survives, renamed `.chip`/`.chipActive`/`.chipDisabled`). `goTo`,
`focusGroup` and `clearFocus` are all still live on the bridge — what changed
is that no *product* button calls them: poses and framings are things an
authored animation does. Two consequences fall out for free, and they are the
reason not to add the rows back: an animation is the only writer on the pose
and zoom targets for its whole lifetime (so nothing in the HUD has to go inert
while one advances — see "What stops an animation"), and `Hud.jsx` no longer
needs `homePoseKey` or the runtime's raw `state` string.

⚠️ **The HUD has two faces, switched by the `appMode` prop** (see "App mode"):
in `idle` everything interactive except the mode button is **not rendered** —
no chips — because in idle there is nothing to configure and an inert button is
noise; in `config` the button surface appears, and it is the *only* way to
drive the model, since drag/arrow-nav is suspended there. Everything below
describes the `config` face unless stated otherwise.

The **animation row** (`.animBar`/`.animChip`) is built from the `animations`
prop, which reaches `Hud.jsx` as ordinary React state from
`KeyboardComposer.jsx` and needs no poll. Only items with `hidden !== true` get
a chip. **Click plays — including on the active chip, which re-plays it. There
is no stop** (see "What stops an animation"); the active id is derived from
`animationState()` in the 150 ms poll rather than from local state, so it stays
honest when an animation is started or stopped from outside (the `?debug`
console helpers, the automatic stop on entering Mesh mode). When a
`waitTrigger` step is blocking, one **extra chip** appears carrying that
step's authored label and calling `triggerAnimation(name)` — that chip is the
product surface for "optionally, an event makes the rotors spin."

⚠️ **This row is also where sequence order is enforced**: a chip whose
animation declares a `requires` stays disabled (dashed border, `title` naming
what to run first) until that prerequisite has been *executed* in this session.
The set of executed ids rides on `animationState()` in the same 150 ms poll —
`completedKey` exists purely so that poll's identity check doesn't see a fresh
array every tick. The gate is here and **not** in `play()`; see "Sequences".

⚠️ **The rows (variants, animations, and the mode button) live in ONE flex
column, `.chipStack`**, anchored bottom-centre at `--chip-row-bottom`; the
individual bars carry no positioning of their own. They used to be absolutely
positioned rows at `--chip-row-bottom + n * --chip-h`, which silently assumed
every row is exactly one chip tall — the moment a row wrapped, the rows above
it overlapped it. Only the stack's `bottom` needs the custom property now, so
the mobile breakpoint still moves everything by overriding `--chip-row-bottom`
alone. Any further row goes inside the stack, never next to it.

**The mode button (`.modeBar`/`.modeBtn`) is the stack's LAST child**, i.e. the
bottom one, on purpose: it is the only control present in both app modes, and
the rows above it appear and disappear — anchoring it last keeps it at a
constant height off the bottom edge instead of jumping when the mode changes.

`Escape` cascades most-specific-first: an animation is active → leave `config`;
else `clearFocus()` if a group is framed (reachable only from an animation or
the `?debug` console now, but it is still the right rung); else leave `config`.
Its listener is on `window`, not the canvas: clicking a chip takes focus off
the canvas, so a canvas-scoped listener would never see the key.

The animation chips, the variant chips and the mode button **disable wholesale
while `editMode` is `'meshes'`** — `MeshController`'s pivots and the animation
registry's pivots must never be live on the same meshes. `Hud.jsx` learns
`editMode` from the same 150 ms poll it already runs for the active-pose
readout, reading it off `poseApi.current` (the field `Scene.jsx` publishes onto
the shared `apiRef`/`poseApi` bridge). All four telemetry readouts are measured
directly rather than derived from R3F/React state:
- FPS: counted via its own `requestAnimationFrame` loop, independent of the
  R3F render loop.
- Active view label: polls `poseApi.current.currentPoseKey()` every 150ms.
- Model size: reads `encodedBodySize`/`transferSize`/`decodedBodySize` off
  the `.glb`'s `PerformanceResourceTiming` entry, polling until the entry
  exists (the fetch may not have resolved at mount).
- RAM: `performance.memory.usedJSHeapSize` (Chrome/Edge only; renders `—`
  elsewhere since the API doesn't exist).

### Debug flag

`DEBUG` is independently recomputed from
`new URLSearchParams(window.location.search).has('debug')` in
`KeyboardComposer.jsx`, `KeyboardModel.jsx`, `LightRig.jsx`,
`AnimationDirector.jsx`, `AnimationEditor.jsx` and
`useComposerControls.js` (not shared via context/prop) —
if you add a new debug-gated file, follow the same pattern rather than
threading a prop through. In `useComposerControls.js` it gates exactly one
thing: whether the `wheel` listener is registered at all; in
`AnimationDirector.jsx` it gates only the `window.__playAnimation`-family
console handles — **the director itself runs in production**, since that's
what plays the animations the HUD chips launch.
`editMode` (`'none' | 'lights' | 'meshes' | 'anim' | 'focus'`), by
contrast, *is* threaded as a plain prop from a single `useControls` call
in `Scene.jsx` down into `KeyboardModel`, `LightRig`,
`MeshController` and `AnimationDirector` — it needs one shared source of
truth (mutual exclusion
doesn't work if each file has its own idea of the current mode), whereas
`DEBUG` is a static, page-load-time flag safe to recompute anywhere.
`AnimationEditor.jsx` is the one exception that reads `editMode` a different
way (off the `poseApi`/`apiRef` bridge rather than as a direct prop) since it
lives outside the Canvas, like `Hud.jsx` — see "Pose lock" above. `Leva`
itself is always mounted
(`KeyboardComposer.jsx`'s `DebugPanel`) even in production, with
`hidden={!DEBUG}`, because Leva creates a default panel the instant any
`useControls()` call exists anywhere in the tree — there's no other way to
suppress it short of not calling `useControls` at all.

## Planned work: anti-aliasing and contact shadows

⚠️ **Nothing in this section exists in the code yet.** It is a design record
for a discussed-but-unbuilt feature — don't go looking for an
`EffectComposer`, an AO pass or a quality-LOD state machine, and don't treat
their absence as a regression. What follows is the reasoning that should
survive into whoever implements it, because most of it is specific to this
scene's cost profile and is not the answer a generic three.js guide gives.

### The cost profile that drives every choice below

Two bottlenecks exist *before* adding any effect, and they push in the same
direction:

- **CPU — 264 draw calls.** The asset pipeline forbids `gltf-transform
  join`/`optimize` (it would merge node names and break both the per-node
  group classification and the per-group material clone — see "Model asset
  pipeline"), so the mesh count is permanent. Every additional *geometry*
  pass (shadow map, depth prepass, normal prepass) re-pays all 264.
- **Fragment — ~34 forward-rendered lights.** 26 point (9 `top` + 8 `mid` +
  9 `bot`) + 6 `rectAreaLight` (LTC evaluation, not cheap) + the directional
  + the spot. Every fragment evaluates all of them.

The cheap axis is therefore **screen-space**: a full-screen pass is
geometry-independent, and at half resolution it costs a fraction of the main
34-light pass. The rule that follows: **prefer screen-space effects over
extra geometry passes, and never increase the pixel count.** Raising DPR or
brute-force SSAA scales the already-worst axis; a depth prepass doubles the
other one.

The second structural fact: **the scene is static most of the time.** The
camera only moves during the spring settle and the model never rotates at
all. There is no reason to pay per-frame for quality that only matters once
the image has settled.

### Anti-aliasing

The dominant aliasing source here is **not** geometric edges — it's
**specular aliasing**: sub-pixel highlights flickering on rounded keycap
edges, driven by clearcoat + satin metal + 34 light sources. That is a
*shading-rate* problem, not a *coverage* problem, so **MSAA does not fix
it** (MSAA multiplies coverage samples, not shader evaluations), and SMAA
barely helps (it post-processes a final image in which the specular is
already wrong). Only supersampling — too expensive on the fragment axis — or
**temporal accumulation** actually addresses it.

Hence a two-tier scheme tied to motion state:

| State | Technique | Cost |
| --- | --- | --- |
| Moving (drag, spring, a running animation) | MSAA 4× on the render target + SMAA | ≈ today's |
| At rest (spring settled, no input) | Progressive accumulation: sub-pixel Halton jitter on the projection matrix, averaged into an HDR buffer at weight `1/n` over ~16–32 frames, then **stop rendering** | Zero at steady state |

Conceptually `TAARenderPass`/`SSAARenderPass` in unbiased/progressive mode.
The key property for the stated requirement ("no stuttering"): during motion
the cost is exactly what it is today, and the extra work happens only when
idle. **It cannot introduce stutter into navigation by construction.**

⚠️ **MSAA on the default framebuffer is lost the moment you render through a
composer.** A multisampled render target must be requested explicitly (in
pmndrs `postprocessing`, the `multisampling` prop on `EffectComposer`), or
the first effect added makes the image *worse*, not better.

### Contact shadows (between meshes)

Terminology matters here, because it selects a different technique:

- drei's `<ContactShadows>` is a **ground** shadow — a blurred shadow map
  projected onto a plane below the model. It produces no darkening *between*
  meshes and is not what this feature means. (It also no longer exists in
  this codebase; the old `Scene.jsx` had one.)
- What's wanted — keycap against plate, tasselli in their sockets, rotors in
  the body — is **ambient occlusion**, optionally plus directional contact
  hardening from the key light.

The reason none of this exists today is structural, not an oversight:
**31 of the 34 lights physically cannot cast shadows.** `rectAreaLight` has
no shadow support in three.js at all, and point lights only shadow via cube
maps — 6 scene renders *per light*, i.e. 26 × 6 × 264 draw calls, which is
not a tradeoff to evaluate but a non-starter. The only real shadow in the
scene is `ShadowKeyLight`'s. **The volumetric rig therefore behaves as
ambient light that never occludes anything** — AO is not a polish item here,
it is what stands in for the rig's missing occlusion.

Two separate contributions:

1. **Half-resolution screen-space AO** (GTAO/N8AO class) with a
   depth-guided bilateral upsample. It responds to any transform, so it
   keeps working under the mesh editor and under a running animation. Use an
   implementation that can **reconstruct normals from depth** — that removes
   the normal prepass, i.e. 264 draw calls, which is worth the marginal
   quality loss on this cost profile. Physically AO should modulate only
   indirect light, but here the 32 non-shadowing lights *are already* a
   stand-in for indirect, so multiplying the final color is defensible in
   this scene specifically.
2. **Freeze the directional light's shadow map.** The camera orbits, the
   model never rotates, the key light is fixed — **the shadow map is
   identical frame after frame.** Rendering it once (`shadow.autoUpdate =
   false`, `shadow.needsUpdate = true` on demand) and regenerating it only
   when the mesh editor moves something returns 264 draw calls per frame.
   This is likely the single largest win in this whole list and it lands
   *before* any effect is added. The recovered headroom is what pays for a
   contact-hardening (PCSS-style) filter on that one light.

**Baked AO** is the zero-runtime-cost option and would be the obvious choice
for a static product shot, but it breaks exactly where this project is
heading: if "explode" becomes an authored pose via `MeshController`, AO
baked between parts stays painted on the surfaces as they separate. Per-mesh
*self*-occlusion stays valid regardless. A sensible hybrid is baked self-AO
plus screen-space inter-mesh AO — but only if measurement shows screen-space
alone is insufficient. Don't assume it up front.

### The mechanism that unifies both

A **render-quality LOD driven by a "scene is at rest" signal**, which
`useComposerControls.js` largely already has (it knows whether the spring is
settled, whether a drag is active, whether an arrow was pressed):

```
moving   -> MSAA + SMAA, low-sample half-res AO (or AO frozen from the last settled frame)
at rest  -> progressive accumulation for N frames -> stop
any input -> invalidate, drop back to the base tier
```

The elegant coupling: **accumulation makes everything else cheaper.** If the
final image is the mean of 32 jittered frames, the AO can run at a low,
noisy sample count and the noise averages out — you pay for a dirty AO that
converges, not a clean one every frame.

Two invalidation sources that are not obvious and would bite:

- **`LightRig` is never truly "at rest".** Intensities damp asymptotically
  toward their targets and the adaptive box re-measures every
  `BOX_REFRESH_FRAMES`. Accumulating while the damping is still converging
  averages genuinely different images and yields a dirty result. A
  convergence threshold on the damping is needed, not just the camera
  spring's signal.
- **A running animation is never at rest**, and not only while the camera
  moves: a `spinGroup` step keeps rotating geometry forever and a
  `setOpacity` fade changes shading without moving the camera at all. The
  "at rest" signal must therefore consult
  `apiRef.current.animationState()`, not just the pose spring.
- **In `?debug`**, gizmo drags must invalidate like a normal drag.

### Codebase-specific traps

- **Tone mapping has to move.** ACES currently sits on the renderer
  (`Scene.jsx`'s `gl={{ toneMapping, toneMappingExposure }}`). With a
  composer it must become the second-to-last effect and be disabled on the
  renderer, or AO gets applied to already-tone-mapped values and AA blends
  in display space. Correct order: scene in linear HDR -> AO -> accumulate
  -> tone map -> SMAA last, on LDR.
- **`__editorHelper` meshes must be excluded from depth passes.** The
  selection halos are 4%-inflated shells; in the depth buffer they'd
  generate an AO halo around every selected object. This is the same class
  of bug already handled in `collectMeshGroups`, `measureModelBox` and the
  animation system's `opacityRegistry`/`resolveSelector` — same tag, one more
  site to cover.
- **Shader recompilation is real stutter.** With 34 lights the permutation
  count is large and a mid-interaction compile is visible. The rig already
  does the right thing by animating light *intensities* and never light
  *counts* — that invariant must hold. Precompile during the existing fade-in,
  which is already dead time. ⚠️ **A targeted version of this already exists
  and is not planned work**: `materials/warmupTransparency.js` warms the
  `transparent` variant of every group material (see "Opacity"). Any effect
  added here multiplies the permutation count again, so extend that warm-up
  rather than writing a second one — and read its argument for why it uses a
  real `gl.render` instead of `compileAsync`.
- **Don't reallocate render targets on resize** without debouncing, or
  window resizing becomes a microfreeze.

### Suggested implementation order

1. **Freeze the shadow map.** No new effect, pure headroom. Everything else
   is measured from there.
2. **Measure whether the app is CPU- or fragment-bound.** The ratio decides
   whether half-res AO is nearly free, and it cannot be derived on paper.
3. **Composer with MSAA + relocated tone mapping + SMAA.** Checkpoint:
   verify the image is *identical* to today before adding any effect — the
   only moment a color-space mistake is still easy to isolate.
4. **Half-res AO** with depth-reconstructed normals.
5. **Progressive accumulation at rest**, last: biggest quality jump, and the
   piece needing the most accurate invalidation signal.

What not to do: raise DPR or add a depth prepass "since it's cheap." With 34
lights the first doubles the fragment axis; with 264 draw calls the second
doubles the CPU one. Those are the two moves this scene's profile punishes
hardest.
