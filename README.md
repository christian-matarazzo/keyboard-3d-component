# Keyboard Composer — configuratore 3D

Componente React (Three.js / @react-three/fiber) per la vetrina della tastiera
Dither "Array — Model L": canvas nera a piena viewport con il modello 3D e un
**HUD di prodotto** in overlay (logo, telemetria FPS/vista/peso, paginazione
delle viste, footer). Stile product-shot Apple, sfondo nero pieno.

- **Navigazione a pose (ViewCube-style)**: il modello si muove tra pose
  discrete 1:1 con i riferimenti del cliente — trascina (o usa le frecce
  tastiera) per andare alla posa adiacente, con assestamento a molla e piccolo
  bounce. Niente rotazione libera e **niente zoom** (contratto col cliente).
- **Paginazione `01–05`**: il selettore vista in alto (in `Hud.jsx`) salta alle
  5 viste principali; l'`04` (initial position, 3/4 front) è la posa d'ingresso.
- **Finiture**: definite in `materials/registry.js`, applicate ai materiali in
  tempo reale senza ricaricare il modello.

Gesti e pose stanno in `useComposerControls.js` + `poseGraph.js`. La camera è
livellata sul pivot con focale 200 mm equivalenti (look teleobiettivo).

**Per regolare luci, materiali, feel del drag e pose dal vivo (`?debug`) e poi
nel codice, vedi [GUIDA-TUNING.md](GUIDA-TUNING.md).**

## Avvio

```bash
npm install
npm run dev       # sviluppo
npm run build     # build di produzione
```

## Integrazione nel sito del cliente

```jsx
import KeyboardComposer, { preloadKeyboardModel } from './components/KeyboardComposer'

preloadKeyboardModel() // opzionale, avvia il fetch del GLB il prima possibile

<KeyboardComposer
  modelUrl="/models/keyboard.glb"  // default
  finishes={...}                   // default: registry interno
  finishId="grafite"               // finitura iniziale
/>
```

Requisiti lato host: copiare `public/models/keyboard.glb`, `public/draco/`
(decoder Draco self-hosted), `public/fonts/` (Suisse Intl Mono) e
`public/brand/` (logo) nella cartella statica. Gli stili sono in CSS module,
nessuno stile globale oltre a `src/index.css` (font + reset).

## Materiali / finiture

Le finiture (`materials/registry.js`) assegnano parametri PBR a tre slot logici,
mappati per nome materiale del GLB in `materials/applyFinish.js`:

| Slot      | Materiali OBJ                          | Parti                                   |
| --------- | -------------------------------------- | --------------------------------------- |
| `keycaps` | `initialShadingGroup`                  | keycaps + viti                          |
| `body`    | `standardSurface3SG`, `standardSurface4SG` | rotori, piastre, rialzo 4° della base |
| `damping` | `standardSurface2SG`                   | Damping_Foots, Tasselli                 |

Ogni slot accetta anche `map`, `normalMap`, `roughnessMap`, `metalnessMap`,
`aoMap` come URL di texture (le UV sono preservate nel GLB) — quando arriveranno
i materiali definitivi del cliente basta aggiornare il registry.

## Pipeline asset (OBJ ~21 MB → GLB ~1,2 MB)

Il sorgente `assets-src/Array_L_WEB_Retopo.obj` non viene distribuito; il sito
usa `public/models/keyboard.glb`. Per rigenerarlo:

```bash
npm run asset:convert    # OBJ → GLB grezzo (obj2gltf, heap 8 GB)
npm run asset:optimize   # weld → prune (con UV) → Draco (normali 12 bit)
npm run asset:inspect    # verifica materiali/mesh/dimensioni
```

Note:
- Il `.mtl` deve stare accanto all'OBJ e contenere i nomi materiale
  (`initialShadingGroup`, `standardSurface2/3/4SG`): senza, obj2gltf perde i nomi
  e salta la mappatura materiale→slot.
- Non usare `gltf-transform optimize`/`join`: fonderebbe le mesh e distruggerebbe
  gli slot per lo swap materiali.
- `prune` va eseguito con `--keep-attributes` per non perdere le UV.
- **Niente `simplify`**: il modello è un retopo già web-ready; decimarlo
  sfaccetta i keycap arrotondati. Se in futuro servisse alleggerire un modello
  più denso, reintrodurre `simplify` con `--ratio`/`--error` prudenti e alzare
  la quantizzazione normali di Draco.
