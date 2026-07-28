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
   for those poses, and (c) producing zoomed/framed views of the model. (a)
   and (b) exist today. **(c) doesn't exist yet**: the only zoom is the
   `wheel` handler in `useComposerControls.js` — a free-form camera-distance
   multiplier (see "Zoom" under "Interaction + animation": it's now a
   `userZoom` factor that no fit path can reset, but that's a *robustness*
   fix, not the product feature). A product zoom would be named, authored,
   per-pose framings — treat it as still to build, not something to go
   looking for. (An exploded-view feature was built and then deleted outright in
   favor of the more general group/mesh selection-and-transform mechanism
   in `MeshController.jsx` — see "Mesh editor" below — which can reproduce
   "explode" as an authored pose instead of a hardcoded animation. There is
   currently no shipped exploded-view UI.)

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
**`editMode`** (`'none' | 'lights' | 'meshes' | 'timeline'`, a Leva select
in `Scene.jsx`, threaded as a prop into `KeyboardModel`/`LightRig`/
`MeshController`). The mesh editor and the light editor used to be
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

`'timeline'` is `'meshes'`'s sibling, not a separate tool — see "Mesh
editor" and "Timeline" below. It reuses `MeshController.jsx`'s
selection/pivot/gizmo machinery wholesale (`active = editMode === 'meshes'
|| editMode === 'timeline'` everywhere the file used to check only
`'meshes'`) and adds a keyframe scrubber on top.

`Scene.jsx` sets `controlsDisabled={editMode === 'meshes' || editMode ===
'timeline'}` — canvas drag/arrow-nav is suspended in Mesh **and** Timeline
mode, not Lights: pose navigation has to keep working in Lights mode since
the volumetric rig's config is per-pose, so tuning lights for a view
requires being able to still step through views. Mouse-wheel zoom is a
separate flag entirely — `useComposerControls.js`'s `onWheel` handler has
no `disabled` check at all, so it stays live in every `editMode` including
Mesh/Timeline, unlike drag/arrow-keys which do check it.

**Pose lock (Mesh/Timeline)**: `Scene.jsx` also owns a second Leva control,
`lockedPose` (default `'TL'`, options built once at module load from
`POSE_COORD`/`POSE_HUD_LABEL` — `POSE_HUD_LABEL` has intentionally
duplicate short labels across poses, e.g. `'TL'`/`'TR'`/`'CFB'` all read
`'3/4 FT'`, so the Leva `options` keys append the raw pose key to stay
unique: `` `${label} · ${key}` ``). Entering Mesh or Timeline mode (or
changing `lockedPose` while already in one of them) calls
`apiRef.current.goTo(lockedPose)`. The lock is enforced at two layers, not
just the trigger:
- **Mechanism**: `useComposerControls.js`'s `goTo(key)` itself checks
  `editModeRef`/`lockedPoseKeyRef` (refs mirroring the `editMode`/
  `lockedPoseKey` hook options every render, read inside the `goTo`
  closure without needing to recreate it) and silently no-ops any request
  for a *different* pose while locked — so the lock holds regardless of
  who calls `goTo` (HUD pager, future callers), not just the one UI
  surface that happens to be gated today.
- **UI**: `Hud.jsx`'s pager buttons are `disabled` for every pose except
  `lockedPoseKey` while locked, so it's visually obvious why nothing
  happens — see "HUD" below for how it learns `editMode`/`lockedPoseKey`
  from outside the Canvas.

Also within `?debug`, `editMode` doesn't just gate raycasting/interaction —
it gates **panel visibility** too, via Leva's per-folder `render`
predicate (`FolderSettings.render: (get) => boolean`, the 3rd/settings arg
of `useControls(folderName, schema, settings)`): the `Ombra: Directional
(Keylight)` / `Ombra: Spotlight` folders (in `LightRig.jsx`'s
`ShadowKeyLight`/`ShadowSpotLight`) and `Impostazioni Globali Vista` (also
`LightRig.jsx`) all pass `render: (get) => get('⚙️ Editor · Modalità.editMode')
=== 'lights'`; `MeshController.jsx`'s `⚙️ Editor Mesh (Debug)` folder passes
`render: (get) => ['meshes', 'timeline'].includes(get('⚙️ Editor ·
Modalità.editMode'))` — visible (and interactive) in **either** mode, since
Timeline reuses this exact panel for its Gruppo/Mesh selection and
gizmo/sliders. Critically, `render` only hides the row
in the Leva UI — it does **not** unmount the `useControls` call, so tuned
values survive switching away and back (an actual unmount/remount would
reset them to the schema's hardcoded `value:` defaults, since Leva's store
entries for a path are recreated from scratch when a fresh `useControls`
call registers them). The path string (`'⚙️ Editor · Modalità.editMode'`) is
`folderName + '.' + controlKey` from `Scene.jsx`'s own editMode control —
it's duplicated as a literal in each gated file rather than shared via
import (same reasoning as the `DEBUG` flag below), so if `Scene.jsx`'s
folder name or key ever changes, grep for that path string everywhere.

`Scene.jsx` snaps to `lockedPose` (see "Pose lock" above) the moment
`editMode` becomes `'meshes'`/`'timeline'` (or `lockedPose` itself changes
while already in one of them) — not on each mesh/group selection like an
earlier version did, which would re-snap every time you picked a different
one from the dropdown mid-session.

**`apiRef.current` is a multi-writer bridge, seeded once as `useRef({})`
(never `null`) in `KeyboardComposer.jsx`.** `useComposerControls.js` (inside
`<Canvas>`) and `Scene.jsx` (outside it, a separate React subtree with no
commit-ordering guarantee relative to the Canvas's own effects) both write
onto the *same* object via `Object.assign(apiRef.current, {...})` rather
than replacing it wholesale — `useComposerControls.js` contributes
`goTo`/`currentPoseKey` (cleanup `delete`s just those two keys), `Scene.jsx`
contributes `editMode`/`lockedPoseKey` (plain fields, no cleanup needed).
Object.assign-only, never `apiRef.current = {...}`, is the rule any future
writer onto this bridge must follow, or it risks clobbering fields the
other writer just added.

The dead code this file used to warn about has been **removed**, not just
documented — don't go looking for it and don't reintroduce it: `Backdrop.jsx`
(an unreferenced reflective floor plane), `KeyboardComposer.module.css`'s
`.viewPad`/`.viewBtn`/`.up`/`.left`/`.right`/`.down` and the whole
`.capturePanel*` family (leftovers of a `ViewPad` and a `LightCapturePanel`
that predated `Hud.jsx` and `LightRig.jsx`'s save/load buttons), and
`poseGraph.js`'s `VIEW_SHORTCUTS` (the ViewPad's direction→pose map). That CSS
module is now only `.section`, `.canvasWrap`, `.canvasWrapLoaded` and
`.debugResize`; `Hud.module.css` and `Timeline.module.css` are used in full.

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
fetch is skipped), feed the file to the app's own "Carica JSON" handler: patch
`HTMLInputElement.prototype.click` to capture the `<input type=file>` it
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
│  ├─ KeyboardModel.jsx       loads GLB, auto-fits scale, owns useComposerControls
│  ├─ MaterialTuner (in Scene.jsx)   one Leva folder per mesh group, from meshGroups config
│  ├─ LightRig.jsx            all scene lighting (production + debug editor);
│                              own useGLTF (shared cache) to measure the live
│                              model bbox for the adaptive light box
│  └─ MeshController.jsx      mesh inspector: TransformControls + halo on a runtime
│                              pivot at a group's cumulative center or a single
│                              mesh's own center (dual Gruppo/Mesh selectors, own
│                              useGLTF, shares KeyboardModel's cache); also owns
│                              the Timeline keyframe data model, active in both
│                              editMode 'meshes' and 'timeline'
├─ Hud.jsx                    DOM overlay outside the canvas: logo, telemetry, pager
└─ Timeline.jsx                DOM overlay outside the canvas: keyframe scrubber,
                                visible only in ?debug + editMode 'timeline'
```

`Hud.jsx`/`Timeline.jsx` (DOM) and the pose/lighting logic (inside
`<Canvas>`) can't share React state directly, so they're bridged with an
imperative ref:
`KeyboardComposer.jsx` creates `poseApi = useRef({})` (seeded to an empty
object, never `null` or reassigned — see "Pose lock" further down for why
that matters), passes it down as `apiRef` to `useComposerControls` (which
`Object.assign`s `goTo(poseKey)`/`currentPoseKey()` onto it) and to
`Scene.jsx` (which `Object.assign`s `editMode`/`lockedPoseKey` onto the
*same* object). `Hud.jsx` polls `currentPoseKey()`/`editMode`/
`lockedPoseKey` on a 150ms interval (not reactive) and calls `goTo()` from
its pager buttons. `LightRig.jsx` reads the same `apiRef` every `useFrame`
to know which per-pose lighting config is active. `Timeline.jsx` reads
`editMode` off this same bridge to decide its own visibility, and a
*second*, sibling ref (`timelineApiRef`, populated by `MeshController.jsx`
— see "Timeline" further down) carries the keyframe actions/data it needs.

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
- `HUD_VIEWS` / `POSE_HUD_LABEL` — the 5 poses exposed in the HUD pager and
  their short labels.
- `ENTRY_LANDSCAPE` / `ENTRY_PORTRAIT` / `PORTRAIT_YAW_OFFSET` — entry pose
  differs by orientation; in portrait the *entire graph* is yaw-shifted by
  `PORTRAIT_YAW_OFFSET`, derived once from the entry pose and frozen in a
  ref (`frame.current.yawOffset` in `useComposerControls.js`) — never
  recomputed from live viewport size, otherwise a resize could shift the
  frame out from under the current pose and silently break `stepTo`.

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
  *product of two independent refs*, never a single writable value —
  `cameraRadius.current = clamp(baseRadius.current * userZoom.current,
  RADIUS_MIN, RADIUS_MAX)`, recomposed by the local `applyRadius()` helper.
  **Nothing ever assigns `cameraRadius` directly.** `baseRadius` is the
  framing distance and belongs to the fit paths; `userZoom` is a pure
  multiplier (clamped `ZOOM_MIN`…`ZOOM_MAX`) and belongs solely to
  `onWheel`. That split is the whole mechanism behind "zoom survives every
  view/mode/selection change": a fit recompute rewrites the base and
  `applyRadius()` re-multiplies the user's factor back on top, so a resize,
  a `fitMargin`/`zoomOutMobile` change (including one arriving from a
  loaded JSON via `app-load-rotation`), or a mode switch can no longer
  erase it. Before this, `onWheel` wrote `cameraRadius` itself and the next
  fit to run silently overwrote it. If you add a third writer, give it a
  ref of its own and fold it into `applyRadius()` — do not assign
  `cameraRadius`.
  Two paths write `baseRadius`:
  - a **static** fit `useEffect` (deps `[size, camera, focalLength,
    feel.fitMargin, feel.zoomOutMobile]`) using the constant
    `FIT_HALF_WIDTH`;
  - a **dynamic**, **expand-only** fit active while `editMode === 'lights'`
    **and** the current pose equals `lockedPoseKey` (see "Pose lock"): it
    measures a *live* `Box3().setFromObject(scene)` when the condition's
    edge is detected (a cheap per-frame `useFrame` check compares
    `mode`/`curKey` against the lock and only rebuilds the box on the
    `false→true` transition — `Box3` over the whole scene graph is not
    something to run every frame), and **returns without touching anything
    if the needed radius isn't larger than the current base**. It exists to
    keep a model *deformed* in Mesh/Timeline (a translated group that no
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
  Mesh/Timeline, where drag is otherwise suspended); neither fit path can
  fire while `editMode` is `'meshes'`/`'timeline'` (the dynamic path is
  gated on `'lights'`, the static path doesn't care about `editMode` at
  all).
- **Imperative API**: contributes `goTo(key)`/`currentPoseKey()` onto the
  shared `apiRef.current` bridge (see "Pose lock" above for the
  `Object.assign`-only contract and why). `goTo` now opens with a lock
  check (refs `editModeRef`/`lockedPoseKeyRef`, kept fresh by plain
  per-render assignment next to the pre-existing `disabledRef`): while
  `editMode` is `'meshes'`/`'timeline'`, a request for any pose other than
  `lockedPoseKey` is silently ignored. Also, only when `?debug` is present:
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
(6 groups matching this GLB: `keycaps`, `body`, `damping`, `rotors`,
`tasselli`, `landing`). `meshGroups` is a prop threaded
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
- `collectMeshGroups(scene, groups, fallbackGroupId)` walks the loaded GLTF
  once, assigning every mesh to the first group whose `nameTokens` matches
  a substring of the node name, defaulting to `fallbackGroupId` (`'body'`)
  if nothing matches. Meshes tagged `userData.__editorHelper` (the
  selection halos `MeshController.jsx` parents under real meshes) are
  skipped — they are not product geometry and would otherwise land in a
  group, and in the mesh dropdown, on any recompute happening while a
  selection is live. It also flips on `castShadow`/`receiveShadow` for
  every mesh here. Returns `{ [groupId]: THREE.Mesh[] }`, one array per
  group in `groups` (even if empty).
- `collectMeshList(scene, groups, fallbackGroupId)` flattens that into the
  sorted, labelled, dedup-suffixed list `MeshController.jsx`'s Mesh
  dropdown renders — same classification, just reshaped.

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
is active. "Salva Configurazione" / "Carica JSON" are the exception to the
mode gating — they stay visible for the whole `DEBUG` session regardless of
`editMode`, since they serialize/deserialize **all** tunable state at once,
not just this rig's `configsRef`: also `window.__STATE_MATERIALS`,
`window.__STATE_ROTATION`, `window.__STATE_KEYLIGHT`,
`window.__STATE_SPOTLIGHT`, into one JSON blob.

**Production light loading**: outside `?debug`, `LightRig` fetches
`/lightconfig/app-state-config.json` once on mount and applies it via the
same code paths (`configsRef.current = lightsData`, then
`CustomEvent`s — `app-load-materials`, `app-load-rotation`,
`app-load-keylight`, `app-load-spotlight` — that `MaterialTuner` and
`useComposerControls` listen for). In other words: **the lighting/material/
rotation-feel values actually shipped to production are whatever's baked
into `public/lightconfig/app-state-config.json`**, authored via the
`?debug` panel and exported with "Salva Configurazione," not hardcoded
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

Active in **both** `'meshes'` and `'timeline'` `editMode` (`const active =
editMode === 'meshes' || editMode === 'timeline'`) — Timeline (see below)
is this file's selection/pivot/gizmo machinery plus a keyframe scrubber
layered on top, not a separate implementation.

Two **mutually exclusive** Leva selectors — **Gruppo** (a `meshGroups`
entry) and **Mesh** (`collectMeshList`'s flattened dropdown, same as
before) — pick either a whole logical group or a single mesh; a 3D click
in `KeyboardModel.jsx` (gated on `editMode === 'meshes' || editMode ===
'timeline'`, same as `active` above) calls `onSelectMesh(e.object)`,
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
mode, the effect's cleanup does the reverse — `parent.attach(mesh)` bakes
whatever the pivot ended up representing back into the mesh's own local
transform (edits persist across reselection/mode changes) and the pivot
group is removed from the scene. This branch is unchanged from before the
dual-selector rework — kept as a fully separate code path from the group
branch below rather than unified, specifically so it stays byte-for-byte
identical.

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
can differ) and removes the pivot.

In both branches the **Pos X/Y/Z (`±100`, step `0.05`) / Rot X/Y/Z°
(`±180`, step `1`) sliders are a relative offset from that center**
(`pivotInfo.basePosition`/`baseQuaternion`, captured once at wrap time) —
not absolute values, since the GLB's native coordinate space is large
(observed pivot positions in the tens of units), which is also why
`posX/Y/Z` needed the wide `±100` range (widened from an earlier `±2` that
was too narrow to reach the model's own scale) while `rotX/Y/Z` stayed
`±180`, a full turn being the natural bound for a relative rotation
regardless of model scale. Reset to `0` the instant a new selection is
wrapped — **except in Timeline mode with existing keyframes for that
selection**, where the reset instead applies the value interpolated at the
current playhead position (see "Timeline" below); in Mesh mode this branch
is unreachable (`editMode !== 'timeline'`), so behavior there is
unchanged. That reset is issued by the **pivot effect itself**, in the
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
the user actually picks something else. `active` (`editMode` is
`'meshes'`/`'timeline'`) is in those deps too: leaving Mesh/Timeline mode
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
Mesh/Timeline).

### Timeline (`Timeline.jsx`, `editMode === 'timeline'`)

First pass at a Maya-style keyframe timeline — explicitly scoped to **data
model + minimal scrub UI only** for now: no Play/Pause autoplay, no JSON
save/load (both deferred). Groundwork motivation: the group/mesh dual
selector's "selection → pivot → `posX..rotZ` offsets" shape (see "Mesh
editor" above) is exactly what a keyframe needs to capture, so Timeline
mode adds *no* new selection/pivot/gizmo logic of its own — it just reuses
`MeshController.jsx`'s wholesale (same `active`, same Leva panel, same
gizmo) and layers keyframes on top of the same `posX..rotZ` fields.

**State, owned by `MeshController.jsx`** (not a separate component/file —
it already owns everything a keyframe needs):
- `selectionKey` — `` `group:${groupId}` `` or `` `mesh:${uuid}` ``,
  derived from `selection` each render; keyframes are tracked **per
  selection**, since `posX..rotZ` are offsets relative to a
  selection-specific center and don't mean anything shared across
  different selections.
- `keyframesBySelection` (React state, `{ [selectionKey]:
  [{id, time, posX, posY, posZ, rotX, rotY, rotZ}] }`, kept sorted by
  `time`) and `playhead` (React state, seconds, `0..TIMELINE_DURATION` —
  a fixed 5s for this pass, no duration UI yet).
- **Scrub effect** (deps `[playhead, selectionKey, keyframesBySelection,
  editMode]`): when `editMode === 'timeline'` and the current selection
  has keyframes, linearly interpolates between the two keyframes
  bracketing `playhead` (module-level `interpolateKeyframes(kfs, t)` —
  clamps to the first/last keyframe outside their range) and calls the
  same `setMeshCtrl(...)` the gizmo/sliders already use — the existing
  "apply offset to pivot" effect does the rest, no duplicated transform
  logic.
- **A real race was caught and fixed here**: the pre-existing "reset
  sliders to 0 on new pivot" effect (deps `[pivotInfo]`) fires *after* the
  scrub effect on a selection swap, because `pivotInfo` (state) lags
  `selection`/`selectionKey` by one render — so it would stomp the just-
  applied interpolated keyframe values back to `0` on every selection
  change while in Timeline mode. Fixed by making that effect
  timeline-aware: it reads `playheadRef` (a ref mirror of `playhead`,
  updated by plain per-render assignment so the effect's own deps can stay
  narrowly `[pivotInfo]`) and, only when `editMode === 'timeline'` and
  keyframes exist for the new selection, applies the interpolated patch
  instead of zeros. Unreachable in Mesh mode, so no behavior change there.

**`timelineApiRef`** — a second imperative DOM↔Canvas bridge (new ref,
`KeyboardComposer.jsx` → `Scene.jsx` → `MeshController.jsx`, same pattern
as `apiRef`/`poseApi`), populated by two *separate* effects to avoid stale
closures:
- An actions effect (deps `[timelineApiRef]`, runs once) assigns
  `addKeyframe()`/`removeKeyframe(id)`/`jumpToKeyframe(id)`/`setPlayhead(t)`
  onto `timelineApiRef.current` — each reads its inputs (`selectionKey`,
  the live `meshCtrl` values, `playhead`, `keyframesBySelection`) through
  refs mirrored every render (`selectionKeyRef`/`meshCtrlRef`/
  `keyframesRef`, same "ref updated unconditionally each render, read
  inside a stable closure" idiom as `useComposerControls.js`'s
  `disabledRef`/`feelRef`) rather than closing over the render-time
  values directly — otherwise, since this effect only runs once, the
  action closures would permanently capture whatever those values were on
  first mount (e.g. "Add Keyframe" would snapshot `posX..rotZ` from
  *before* a gizmo drag that didn't itself change `selection`/`playhead`).
- A display-fields effect (deps on everything Timeline's UI needs to show:
  `[timelineApiRef, selection, selectionKey, keyframesBySelection,
  playhead, meshGroups]`) writes `selectionLabel`/`keyframes`/`playhead`/
  `duration` as plain fields on the same object — "eventually correct" is
  fine here since `Timeline.jsx` only polls it.

**`Timeline.jsx`** — DOM overlay outside the Canvas, same idioms as
`Hud.jsx`: `DEBUG` recomputed locally, a 150ms poll (reading `editMode`
off the *same* `poseApi.current` bridge `Hud.jsx` uses, plus
`timelineApiRef.current`'s fields), renders `null` unless `DEBUG &&
editMode === 'timeline'`. Shows the current selection's label, an
"+ Keyframe @ Ns" button (disabled with nothing selected), and a
scrubbable track (`pointerdown`+`pointermove` maps `clientX` to
`[0, duration]`, calling `setPlayhead`) with a playhead marker and
per-keyframe diamond markers (click to jump via `jumpToKeyframe`, a small
"×" to `removeKeyframe`). `Timeline.module.css` mirrors `Hud.module.css`'s
conventions (`pointer-events: none` on the container, `auto` on
interactive children, monospace/caps styling).

### HUD (`Hud.jsx`)

Real, always-mounted product UI (not debug-gated), DOM overlay with
`pointer-events: none` except the `01–05` pose pager. The pager buttons
are `disabled` (and visually dimmed via `.pageDisabled`) for every pose
except `lockedPoseKey` while `editMode` is `'meshes'`/`'timeline'` (see
"Pose lock" above) — `Hud.jsx` learns `editMode`/`lockedPoseKey` from the
same 150ms poll it already runs for the active-pose readout, reading them
off `poseApi.current` (the fields `Scene.jsx` publishes onto the shared
`apiRef`/`poseApi` bridge). All four telemetry readouts are measured
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
`KeyboardComposer.jsx`, `KeyboardModel.jsx`, `LightRig.jsx`, and
`Timeline.jsx` (not shared via context/prop) — if you add a new
debug-gated file, follow the same pattern rather than threading a prop
through. `editMode` (`'none' | 'lights' | 'meshes' | 'timeline'`), by
contrast, *is* threaded as a plain prop from a single `useControls` call
in `Scene.jsx` down into `KeyboardModel`, `LightRig`, and
`MeshController` — it needs one shared source of truth (mutual exclusion
doesn't work if each file has its own idea of the current mode), whereas
`DEBUG` is a static, page-load-time flag safe to recompute anywhere.
`Timeline.jsx` is the one exception that reads `editMode` a different way
(off the `poseApi`/`apiRef` bridge rather than as a direct prop) since it
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
| Moving (drag, spring, timeline scrub) | MSAA 4× on the render target + SMAA | ≈ today's |
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
   keeps working under the mesh editor and the Timeline. Use an
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
- **In `?debug`**, gizmo drags and timeline scrubbing must invalidate like a
  normal drag.

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
  of bug already handled in `collectMeshGroups` and `measureModelBox` —
  same tag, a third site to cover.
- **Shader recompilation is real stutter.** With 34 lights the permutation
  count is large and a mid-interaction compile is visible. The rig already
  does the right thing by animating light *intensities* and never light
  *counts* — that invariant must hold. Precompile asynchronously
  (`renderer.compileAsync`) during the existing fade-in, which is already
  dead time.
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
