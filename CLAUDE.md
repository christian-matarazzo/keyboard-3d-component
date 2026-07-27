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
   for those poses, and (c) producing exploded/zoomed views of the model.
   (a), (b), and the *exploded* half of (c) exist today (see "Exploded view"
   below) — a real, always-on HUD button, not a debug tool. **Zoomed views
   still don't exist**: the only zoom is the `wheel` handler in
   `useComposerControls.js`, which just adjusts camera distance and predates
   any product zoom concept. Treat proper zoomed/framed views as a feature
   still to build, not something to go looking for.

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
**`editMode`** (`'none' | 'lights' | 'meshes'`, a Leva select in
`Scene.jsx`, threaded as a prop into `KeyboardModel`/`LightRig`/
`MeshController`). They used to be simultaneously live any time their own
toggle was on (mesh clicks always active in debug; light helpers active
whenever `showHelpers`/`showSurfaces` was checked), which meant a single
click on the model could select a mesh *and* a light helper underneath it
at once: `onPointerDown` (the model's click handler) and `onClick` (the
light helpers') are independent R3F event pipelines raycast separately, so
`stopPropagation()` on one never blocks the other. The actual fix is not
just gating the click handlers — it's setting `raycast={() => null}` on
the inactive subsystem's hit-test geometry in `LightRig.jsx`, which removes
it from the raycaster's intersection list entirely, for every event type at
once. (Never assign `raycast={undefined}` there — that sets an
own-property shadowing `THREE.Mesh.prototype.raycast` with `undefined`, and
three.js's raycaster crashes trying to call it; always assign a real
function, e.g. `THREE.Mesh.prototype.raycast` to restore default
behavior.)

`Scene.jsx` sets `controlsDisabled={editMode === 'meshes'}` — canvas
drag/arrow-nav is suspended **only** in Mesh mode, not Lights: pose
navigation has to keep working in Lights mode since the volumetric rig's
config is per-pose, so tuning lights for a view requires being able to
still step through views. Mouse-wheel zoom is a separate flag entirely —
`useComposerControls.js`'s `onWheel` handler has no `disabled` check at
all, so it stays live in every `editMode` including Mesh, unlike drag/
arrow-keys which do check it.

Also within `?debug`, `editMode` doesn't just gate raycasting/interaction —
it gates **panel visibility** too, via Leva's per-folder `render`
predicate (`FolderSettings.render: (get) => boolean`, the 3rd/settings arg
of `useControls(folderName, schema, settings)`): the `Ombra: Directional
(Keylight)` / `Ombra: Spotlight` folders (in `LightRig.jsx`'s
`ShadowKeyLight`/`ShadowSpotLight`) and `Impostazioni Globali Vista` (also
`LightRig.jsx`) all pass `render: (get) => get('⚙️ Editor · Modalità.editMode')
=== 'lights'`; `MeshController.jsx`'s `⚙️ Editor Mesh (Debug)` folder passes
the same check against `'meshes'`. Critically, `render` only hides the row
in the Leva UI — it does **not** unmount the `useControls` call, so tuned
values survive switching away and back (an actual unmount/remount would
reset them to the schema's hardcoded `value:` defaults, since Leva's store
entries for a path are recreated from scratch when a fresh `useControls`
call registers them). The path string (`'⚙️ Editor · Modalità.editMode'`) is
`folderName + '.' + controlKey` from `Scene.jsx`'s own editMode control —
it's duplicated as a literal in each gated file rather than shared via
import (same reasoning as the `DEBUG` flag below), so if `Scene.jsx`'s
folder name or key ever changes, grep for that path string everywhere.

`Scene.jsx` also snaps the pose to `TL` (`apiRef.current.goTo('TL')`) the
moment `editMode` becomes `'meshes'` — not on each mesh selection like an
earlier version did, which would re-snap every time you picked a different
mesh from the dropdown mid-session. It fires once, on mode entry.

There's also dead code to be aware of so it isn't mistaken for something
load-bearing:
- `Backdrop.jsx` (reflective floor plane) is not imported anywhere.
- `KeyboardComposer.module.css` still defines `.viewPad`/`.viewBtn` and the
  whole `.capturePanel*` family (a `ViewPad` and a `LightCapturePanel` that
  apparently predated `Hud.jsx` and the inline-styled save/load buttons in
  `LightRig.jsx`); no current `.jsx` file references those class names.

## Commands

```bash
npm install
npm run dev        # vite dev server (port from $PORT env, fallback 5174)
npm run build       # production build
npm run preview     # preview the production build
```

No test runner or linter is configured.

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
- The `.mtl` must sit next to the OBJ with the exact material names
  (`initialShadingGroup`, `standardSurface2SG/3SG/4SG`) or
  `materials/applyFinish.js`'s material→slot mapping silently breaks (falls
  back to substring-matching mesh names, then to `'body'`).
- Never run `gltf-transform optimize`/`join` on the output — it merges
  meshes, which destroys the per-slot material swap this whole materials
  system depends on.
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
│                              + exploded-view groups/animation
│  ├─ MaterialTuner (in Scene.jsx)   Leva-driven live material overrides
│  ├─ LightRig.jsx            all scene lighting (production + debug editor)
│  └─ MeshController.jsx      mesh inspector: TransformControls + halo on a runtime
│                              center-of-mass pivot, mesh dropdown (own useGLTF,
│                              shares KeyboardModel's cache)
└─ Hud.jsx                    DOM overlay outside the canvas: logo, telemetry, pager
```

`Hud.jsx` (DOM) and the pose/lighting logic (inside `<Canvas>`) can't share
React state directly, so they're bridged with an imperative ref:
`KeyboardComposer.jsx` creates `poseApi = useRef(null)`, passes it down as
`apiRef` to `useComposerControls`, which populates
`apiRef.current = { goTo(poseKey), currentPoseKey() }`. `Hud.jsx` polls
`currentPoseKey()` on a 150ms interval (not reactive) and calls `goTo()`
from its pager buttons. `LightRig.jsx` reads the same `apiRef` every
`useFrame` to know which per-pose lighting config is active.

### Pose graph (`poseGraph.js`)

Navigation is over a fixed set of **18 named poses** (`POSE_COORD`:
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
  rotates, the camera orbits around it via quaternion
  (`camera.quaternion.setFromEuler(new THREE.Euler(-pitch, -yaw, 0, 'YXZ'))`)
  at a distance (`cameraRadius`) computed purely from a responsive fit
  (`fitMargin`, `zoomOutMobile` in portrait) — plus a `wheel` handler that
  also adjusts `cameraRadius` directly (this is the closest thing to zoom
  today; not exploded views). Unlike drag/arrow-nav, `onWheel` never checks
  `disabledRef` — zoom stays live in every `editMode` (including Mesh,
  where drag is otherwise suspended).
- **Imperative API**: `apiRef.current = { goTo(key), currentPoseKey() }`
  (see above). Also, only when `?debug` is present:
  `window.__setPose(pitchDeg, yawDeg)` (hard teleport, bypasses the spring)
  and `window.__abortComposerDrag()` (cancels an in-progress drag —
  called by `MeshController`'s and `LightRig`'s `TransformControls` gizmos
  on `onMouseDown` so dragging a gizmo doesn't also rotate the model).
  The exploded-view toggle (see below) deliberately does **not** live on
  this same `apiRef` object — it has its own sibling ref, `explodeApiRef`,
  populated by `KeyboardModel.jsx` itself rather than by this hook, so
  `useComposerControls` stays single-purpose (pose/camera only) and neither
  ref's contract depends on hook call-order inside `KeyboardModel.jsx`.

### Materials (`materials/registry.js`, `materials/applyFinish.js`)

Four logical slots — `keycaps`, `body`, `damping`, `landing` — each backed
by a single cached `THREE.MeshPhysicalMaterial` (`materialCache`, keyed
`${finish.id}:${slotName}`), reused across all meshes in that slot so a
finish swap reassigns material references instead of reallocating.
- `collectSlotMeshes(scene)` walks the loaded GLTF once, assigning every
  mesh to a slot by exact material name (`MATERIAL_TO_SLOT`) first, falling
  back to a substring match on the node name (`NODE_TO_SLOT`), defaulting
  to `'body'` if nothing matches. It also flips on `castShadow`/
  `receiveShadow` for every mesh here.
- `getMaterial(finish, slotName)` builds the material, stripping out
  texture-URL props (`map`, `normalMap`, `roughnessMap`, `metalnessMap`,
  `aoMap`) to load them async via `THREE.TextureLoader` and hot-patch the
  already-in-scene material when they resolve.
- `tuneSlotMaterial(finishId, slotName, props)` mutates a cached material
  in place — this is what the debug `MaterialTuner` (in `Scene.jsx`) calls
  on every Leva change, and what `KeyboardModel`'s initial `applyFinish`
  call (declarative, from the `finish` prop) does not overlap with — the
  two paths write the same cache entries, tuner last-write-wins while
  `?debug` is open.
- `registry.js` is a plain array of finish presets (`grafite`, `argento`,
  `arancio`, `blu`), each defining the 4 slots' `color`/`roughness`/
  `metalness`/`envMapIntensity`/`clearcoat`/`clearcoatRoughness`.
  `getFinish(finishes, id)` looks one up, falling back to `finishes[0]`.

### Exploded view (`KeyboardModel.jsx`, `Hud.jsx`)

A real product feature (always on, not `?debug`-gated), toggled by the
"Explode" button in the HUD pager row. Reuses the materials system's slot
classification (`collectSlotMeshes`) but does **not** animate individual
mesh positions — instead, on mount, every slot's meshes are reparented
(once) into one runtime `THREE.Group` per slot (`__explodeGroup_<slot>`,
added as a direct child of `scene`) via `Object3D.attach()` — the same
technique `MeshController.jsx` uses for its center-of-mass pivot, and for
the same reason: writing directly to individual `mesh.position.y` would
assume each mesh's own local Y axis lines up with world/scene Y, which
isn't safe on this Maya-exported GLB (see the Mesh editor section below).
`attach()` sidesteps that assumption entirely by recomputing each mesh's
local transform to preserve its world pose regardless of hierarchy depth.
Only 4 group `position.y` values are touched per frame, not every mesh in
every slot.

`EXPLODE_LAYER = { landing: 0, damping: 0.3, body: 0.65, keycaps: 1 }` is a
fixed design constant (not Leva-tunable) — non-negative and monotonic from
the physical base (`landing` = feet/riser, bottommost in the real assembly)
up to `keycaps` (topmost), so everything spreads in the *same* direction by
increasing amounts per layer rather than some parts going up and others
down. The offset is `progress * layer * distanza * nativeSize.y`, where
`nativeSize` is the **pre**-`TARGET_WIDTH`-scale bounding-box size (added
alongside the existing `scale`/`offset`/`finalSize` in the same auto-fit
`useMemo`) — required because the explode groups live in `scene`'s own
native-unit frame, not the post-scale scene-unit frame `finalSize` is
measured in (30–60× smaller, would be visually imperceptible if used here).
`distanza` (spread amount) and `durata` (transition time) are Leva-tunable
under a `'Vista esplosa'` folder (collapsed by default, production values
as defaults — same idiom as `useComposerControls.js`'s `Rotazione` group);
`progress` itself is a `maath/easing`-damped 0..1 value chasing a committed
boolean, same pattern as `LightRig.jsx`'s per-pose crossfades.

The toggle is exposed through `explodeApiRef.current = { toggle(),
isExploded() }` — a ref separate from `apiRef` (see "Imperative API"
above), threaded `KeyboardComposer.jsx` → `Scene.jsx` → `KeyboardModel.jsx`
the same way `apiRef`/`poseApi` already is. `Hud.jsx` polls
`isExploded()` on the same 150ms interval it already uses for
`currentPoseKey()`.

**CSS Modules gotcha hit while building this**: the "Explode" button reuses
`.pageActive` (from the pose pager) for its active state, combined with its
own `.explodeToggle` class for sizing. When two classes on the same element
set the same CSS property, CSS Modules — like plain CSS — resolves the
conflict by **source order in the file**, not by the order the class names
appear in `className`. `.explodeToggle` must stay declared *before*
`.pageActive` in `Hud.module.css`, or its `border`/`background`/`color`
silently win over the "active" ones regardless of which class was listed
first/last in JSX.

A mesh currently wrapped under `MeshController.jsx`'s `__meshEditorPivot`
(the `?debug`, `editMode === 'meshes'`-only tool) is skipped by the
one-time slot-reparenting effect, so the two features can't fight over the
same mesh — not that it matters in the current per-frame loop, which only
ever touches the 4 slot groups, never individual meshes.

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
it doesn't rerender). Every `useFrame`:
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

### Mesh editor (`MeshController.jsx`)

Selects a mesh (3D click in `KeyboardModel.jsx`, or the `meshName` Leva
dropdown here — both feed the same lifted `selectedMesh` state in
`Scene.jsx`, kept in sync in both directions) and lets you nudge it with a
`TransformControls` gizmo plus Pos/Rot sliders. Two things make this file
non-obvious:

**Transforms are relative to the mesh's own geometric center, not its raw
local origin.** Many sub-meshes in this Maya-exported GLB have their local
origin nowhere near their visible geometry (a "freeze transform" export
pattern — the real placement is baked into vertex data, not the node
transform), so rotating/translating `selectedMesh.position`/`.rotation`
directly would swing it around an arbitrary point instead of spinning in
place. Fix: on selection, the mesh is temporarily reparented under a
runtime-created `THREE.Group` ("pivot") positioned at the mesh's local
geometry bounding-box center (treated as a "center of mass" — true
volumetric centroid is unnecessary complexity for a debug tool), using
`Object3D.prototype.attach()` (native three.js method that reparents while
preserving world transform — computes the compensating local transform
automatically, so the mesh never visually jumps on wrap/unwrap; per its own
doc comment it doesn't support non-uniformly-scaled ancestors, fine today
since the only ancestor scale in this scene is `KeyboardModel.jsx`'s single
uniform `scale={scale}`, but a landmine if that ever changes). The
`TransformControls` gizmo attaches to the **pivot**, not the mesh, so it
visually sits at the center and rotates/translates around it. The Pos
X/Y/Z / Rot X/Y/Z° sliders are a **relative offset from that center**
(`pivotInfo.basePosition`/`baseQuaternion`, captured once at wrap time),
always reset to `0` the instant a new mesh is wrapped — not absolute
values, since the GLB's native coordinate space is large (observed pivot
positions in the tens of units), far outside the sliders' small `±2`/`±180°`
range if they mirrored absolute position. On deselect / mesh switch /
leaving Mesh mode, a `useEffect` cleanup (keyed on `[selectedMesh]`, so it
naturally covers every transition) does the reverse — `parent.attach(mesh)`
bakes whatever the pivot ended up representing back into the mesh's own
local transform (edits persist across reselection/mode changes, matching
this tool's existing behavior) and the pivot group is removed from the
scene.

A `suppressApplyRef` guard exists on the "sliders → pivot" effect even
though the reset value is always the mesh-independent `0` (so a stale
write from the previous mesh landing on the new one is provably harmless
today) — kept as insurance against that effect's dependency array having to
deliberately *exclude* `pivotInfo`, a non-obvious invariant a future change
could break silently.

**Selection halo**: a backface-only, slightly-enlarged (`HALO_SCALE`)
clone-material mesh sharing the selected mesh's geometry (never cloned or
disposed — it's a shared reference), added as a child of the **mesh**
(not the pivot) so it inherits the real world transform regardless of
pivot wrap/unwrap. Its scale must be applied *about the geometry center*
(`halo.position = center*(1-HALO_SCALE)`, `halo.scale = HALO_SCALE`, from
`Object3D`'s `position + scale*v` composition) rather than the mesh's local
origin — otherwise it would reproduce the exact off-center bug the pivot
exists to fix. It also needs `halo.raycast = () => null` (same pattern as
`LightRig.jsx`'s debug helpers) or a click at the rim, where the enlarged
shell pokes out beyond the real mesh, would select the halo itself instead.
drei's built-in `<Outlines>` can't be used here declaratively — it expects
to be mounted as a literal JSX child of the target mesh, but the selected
mesh lives inside `KeyboardModel.jsx`'s `<primitive object={scene}>` tree,
not this component's own render output.

**No scale**: the gizmo `mode` Leva control only offers
`['translate', 'rotate']` — scaling individual mesh parts was intentionally
removed from this tool.

### HUD (`Hud.jsx`)

Real, always-mounted product UI (not debug-gated), DOM overlay with
`pointer-events: none` except the `01–05` pose pager and the "Explode"
toggle appended to that same pager row (see "Exploded view" above). All
four telemetry readouts are measured directly rather than derived from
R3F/React state:
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
`KeyboardComposer.jsx`, `KeyboardModel.jsx`, and `LightRig.jsx` (not shared
via context/prop) — if you add a new debug-gated file, follow the same
pattern rather than threading a prop through. `editMode` (`'none' |
'lights' | 'meshes'`), by contrast, *is* threaded as a plain prop from a
single `useControls` call in `Scene.jsx` down into `KeyboardModel`,
`LightRig`, and `MeshController` — it needs one shared source of truth
(mutual exclusion doesn't work if each file has its own idea of the current
mode), whereas `DEBUG` is a static, page-load-time flag safe to recompute
anywhere. `Leva` itself is always mounted
(`KeyboardComposer.jsx`'s `DebugPanel`) even in production, with
`hidden={!DEBUG}`, because Leva creates a default panel the instant any
`useControls()` call exists anywhere in the tree — there's no other way to
suppress it short of not calling `useControls` at all.
