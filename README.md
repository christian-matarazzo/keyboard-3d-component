# Keyboard Composer — configuratore 3D

Componente React (Three.js / @react-three/fiber) per il sito di presentazione
della tastiera: sezione scura con pannello pillole a sinistra e modello 3D
interattivo a destra, stile Apple "Guardalo da vicino".

- **Rotazione**: trascina con un dito/mouse per ruotare su entrambi gli assi
  (orizzontale → Y, verticale → X, 360°); al rilascio il modello si assesta
  con easing organico sul multiplo di 45° più vicino per ciascun asse. Un
  fling deciso salta più stop.
- **Zoom**: rotella del mouse su desktop, pinch con due dita su touch.
  Distanza clampata; la distanza iniziale è calcolata dall'aspect ratio del
  canvas, così su mobile il modello entra intero nel frame.
- **Finiture**: gli swatch nella pillola "Colori" cambiano i materiali in
  tempo reale, senza ricaricare il modello.

I gesti sono gestiti in `useComposerControls.js` (un unico set di pointer
event: 1 pointer = rotazione, 2 pointer = pinch, wheel = zoom).

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
  modelUrl="/models/keyboard.glb"   // default
  finishes={...}                    // default: registry interno
  features={['Switch magnetici', ...]}
  onFinishChange={(id) => ...}
  onFeatureClick={(label) => ...}
/>
```

Requisiti lato host: copiare `public/models/keyboard.glb` e `public/draco/`
(decoder Draco self-hosted) nella cartella statica del sito. Il CSS è in CSS
module, nessuno stile globale.

## Materiali / finiture

Le finiture sono definite in
`src/components/KeyboardComposer/materials/registry.js`. Ogni finitura assegna
parametri PBR a tre slot logici del modello:

| Slot      | Materiale OBJ         | Parti                          |
| --------- | --------------------- | ------------------------------ |
| `keycaps` | `initialShadingGroup` | Keycaps_Set, viti Countersunk  |
| `body`    | `standardSurface3SG`  | Rotori, piastre Slate_01–08    |
| `damping` | `standardSurface2SG`  | Damping_Module, Damping_Foots  |

Quando arriveranno i materiali definitivi del cliente basta aggiornare il
registry: ogni slot accetta anche `map`, `normalMap`, `roughnessMap`,
`metalnessMap`, `aoMap` come URL di texture (le UV sono preservate nel GLB).

## Pipeline asset (OBJ 168 MB → GLB 1,7 MB)

Il sorgente `assets-src/Dither_L_Array_WEB_01.obj` non viene distribuito; il
sito usa `public/models/keyboard.glb`. Per rigenerarlo:

```bash
npm run asset:convert    # OBJ → GLB grezzo (obj2gltf, heap 8 GB)
npm run asset:optimize   # weld → prune (con UV) → simplify 0.25 → Draco
npm run asset:inspect    # verifica materiali/mesh/dimensioni
```

Note:
- Non usare `gltf-transform optimize`/`join`: fonderebbe le mesh e
  distruggerebbe gli slot per lo swap materiali.
- `prune` va eseguito con `--keep-attributes` per non perdere le UV
  (servono per le texture future).
- Se i dettagli dei keycap si degradano, alzare `--ratio` o abbassare
  `--error` nello step di simplify.
