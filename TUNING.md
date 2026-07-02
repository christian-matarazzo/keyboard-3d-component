# Guida alla configurazione — Keyboard Composer

Riferimento pratico: dove modificare ogni valore usato dal configuratore e
che effetto produce a video. Tutti i percorsi partono da
`src/components/KeyboardComposer/`.

---

## 1. Camera e inquadratura — `useComposerControls.js`

### Focale (`focalLength`, default `100`)

Opzione del hook, dichiarata nei parametri di `useComposerControls(...)` e
applicata con `camera.setFocalLength(...)` nell'effect del fit.

- **Valore più alto** (es. 135, 200): effetto teleobiettivo — prospettiva
  ancora più compressa/"piatta", il modello sembra quasi ortografico. La
  camera si allontana automaticamente per compensare.
- **Valore più basso** (es. 35, 50): effetto grandangolo — prospettiva
  marcata, i bordi vicini appaiono più grandi, il modello sembra più
  "dinamico" ma può deformarsi ai lati.
- La focale è in mm equivalenti su pellicola 35mm, come in fotografia.

Per cambiarla dall'esterno: `useComposerControls(groupRef, { focalLength: 50 })`
in `KeyboardModel.jsx`.

### Fit responsive (`FIT_HALF_WIDTH`, default `2.0`)

Costante in testa al file. È la mezza larghezza (modello + margine) che deve
entrare nel frame all'apertura.

- **Aumentare** (es. 2.4): più aria attorno al modello all'ingresso, modello
  più piccolo a video.
- **Diminuire** (es. 1.7): modello più grande, ma rischio di taglio ai lati
  durante la rotazione.

Nella stessa formula: `clamp(fit, 5.2, 40)` — il primo numero è la distanza
minima all'ingresso su desktop (più basso = modello più grande su schermi
larghi), il secondo il tetto su schermi strettissimi.

### Limiti dello zoom (`minZoom`, default `3`; massimo `fit * 1.3`)

- `minZoom`: quanto ci si può avvicinare. Più basso = zoom più spinto sui
  keycap (sotto ~2 si rischia di attraversare il modello).
- Il moltiplicatore `1.3` in `z.max = Math.max(8, fit * 1.3)`: quanto ci si
  può allontanare oltre il fit iniziale.

### Sensibilità zoom

- Rotella: il fattore `0.0012` in `onWheel` (`z.target * (1 + e.deltaY * 0.0012)`).
  Più alto = zoom più rapido per scatto di rotella.
- Pinch: la sensibilità è implicita nel rapporto tra le distanze delle dita
  (`p.startDist / pinchDistance()`), di norma non va toccata.
- Fluidità dello zoom: lo `0.25` in `easing.damp(z, 'current', z.target, 0.25, delta)`.
  Più basso = risposta più scattante; più alto = più "morbido"/lento.

### Posizione iniziale della camera — `Scene.jsx`

`camera={{ position: [0, 1.4, 5.2] }}`: conta soprattutto il rapporto tra Y
(1.4) e Z (5.2), che definisce l'angolo di vista dall'alto. Y più alta =
si guarda la tastiera più dall'alto. La distanza effettiva viene poi
ricalcolata dal fit responsive, la direzione resta questa.

---

## 2. Rotazione e snap — `useComposerControls.js`

| Costante / opzione | Default | Effetto a video |
| --- | --- | --- |
| `SNAP_STEP` | `Math.PI / 4` (45°) | Passo di aggancio al rilascio. `Math.PI / 2` = stop ogni 90°, `Math.PI / 8` = ogni 22,5°. |
| `speed` | `0.008` | Radianti di rotazione per pixel di drag. Più alto = rotazione più nervosa; più basso = più pesante/precisa. |
| `flingFactor` | `0.15` | Quanto l'inerzia del rilascio proietta lontano lo snap. Più alto = un fling salta più stop da 45°; `0` = si aggancia sempre allo stop più vicino, senza inerzia. |
| `smoothTime` | `0.4` | Secondi (circa) del settle verso lo snap dopo il rilascio. Più alto = assestamento più lento e morbido; più basso = più secco. |
| `0.06` (in `useFrame`) | — | Follow durante il drag. Più basso = il modello segue il dito quasi 1:1; più alto = effetto "elastico" durante il trascinamento. |
| `MAX_VELOCITY` | `12` rad/s | Tetto all'inerzia: evita che un fling estremo faccia girare il modello all'infinito. |
| `VELOCITY_SMOOTHING` | `0.7` | Lisciatura della velocità misurata. Più alto = fling più stabile ma meno reattivo agli ultimi millimetri di gesto. |

Per disattivare la rotazione verticale (solo giradischi su Y): in `onMove`
rimuovere le righe che aggiornano `r.targetX` / `r.velocityX` e in `useFrame`
la riga `easing.damp(group.rotation, 'x', ...)`.

---

## 3. Dimensione del modello — `KeyboardModel.jsx`

`TARGET_WIDTH` (default `3.2`): larghezza del modello in unità scena dopo
l'auto-fit (il file sorgente è in centimetri, questa costante lo normalizza).

- **Aumentare**: modello più grande rispetto a luci/ombre/camera — a video
  appare più grande ma tutte le distanze (fit, zoom, ContactShadows) vanno
  riproporzionate.
- In pratica: per ingrandire il modello a video conviene NON toccare questa
  costante e agire invece su `FIT_HALF_WIDTH` o sui limiti di zoom.

---

## 4. Luci e atmosfera — `LightRig.jsx`, `Backdrop.jsx`, `Scene.jsx`

### Il rig da studio (`LightRig.jsx`)

Le quattro luci sono in un unico group ancorato al pivot del modello che
**copia l'orientamento della camera a ogni frame**: il rig segue i movimenti
della camera (come lo studio che si muove col fotografo) ma resta a distanza
costante dal soggetto, quindi zoom in/out non cambia né l'illuminazione né
le ombre. Tutte le posizioni sono **rig-local**: +Z verso l'osservatore,
−Z dietro il soggetto, qualunque cosa faccia la camera.

Le costanti sono in testa al file:

| Costante | Ruolo | Valori chiave e effetto a video |
| --- | --- | --- |
| `MAIN` | Luce principale dall'alto, leggermente angolata (destra/avanti). Unico shadow caster. | `intensity 90` = luminosità generale del modello; `angle 0.5` = apertura del cono; `penumbra 0.85` = morbidezza del bordo; `position [0.9, 4.2, 2.2]` = da dove arriva (X≠0 dà l'angolazione richiesta, più X = ombre più laterali). |
| `FILL_LEFT` | Laterale sinistra, morbida e leggermente fredda | `intensity 0.6`: alzare = meno contrasto sul lato sinistro. `color #e8ecff`. |
| `FILL_RIGHT` | Laterale destra, più debole (l'asimmetria dà volume) | `intensity 0.45`: portarla uguale alla sinistra appiattisce il modello. |
| `RIM` | Controluce da dietro il soggetto — bordo luminoso da silhouette | `intensity 70` = quanto "taglia" il bordo; `color #a9c1ff` = tinta del bordo (fredda); `RIM_TARGET [0, 0.3, 0]` = mira alta per marcare il profilo superiore. |

- Nota tecnica: i target delle luci sono `<object3D>` figli del rig,
  assegnati in `useLayoutEffect` — se si aggiunge una luce direzionata va
  puntata allo stesso modo, altrimenti mira nel vuoto.
- Le ombre della main: `shadow-mapSize [1024,1024]` (2048 = più definite,
  più costose), `shadow-bias -0.0001` (se compaiono artefatti a strisce sui
  keycap, renderlo più negativo).

### Backdrop trasparente (`Backdrop.jsx`)

Piano orizzontale con `MeshReflectorMaterial` che raccoglie il riflesso del
modello e lascia trasparire lo sfondo CSS; una alphaMap radiale lo dissolve
verso i bordi (nessuna cucitura visibile).

- `opacity` (0.5): intensità complessiva di riflesso + vignettatura scura.
- `mirror` (0.55): nitidezza speculare del riflesso (1 = specchio).
- `mixStrength` (2): quanto il riflesso è luminoso. Il parametro da toccare
  per "più/meno riflesso".
- `blur [400, 100]` + `mixBlur` (0.9): sfocatura del riflesso — valori più
  bassi = riflesso più definito, meno da "superficie satinata".
- `resolution` (512): risoluzione del render target del riflesso; 256 su
  device deboli (vedi §7), 1024 per riflessi più fini ma più costosi.
- `color #000000`: tinta del piano. Deve restare molto scura, altrimenti il
  piano si vede come un rettangolo più chiaro dello sfondo CSS.
- Il gradiente radiale (funzione `alphaMap` nel file): gli stop
  `(0→1, 0.5→0.5, 1→0)` regolano quanto lontano dal modello arriva il
  riflesso prima di dissolversi.

### Ombra a terra (ContactShadows, in `Scene.jsx`)

`position [0, -1.5, 0]`: quota del piano ombra (il backdrop sta 1 mm sotto).
`opacity 0.6` = intensità; `blur 2.6` = morbidezza; `scale 9` = estensione.

### Environment (riflessi PBR sui metalli)

I `<Lightformer>` dentro `<Environment>` sono i "softbox" riflessi dalle
superfici metalliche (`intensity` 1.1 / 0.7 / 0.55 — dimezzati rispetto al
passato: il look ora lo definisce il rig). Non illuminano le ombre:
definiscono i riflessi sul body in alluminio. Sono world-fixed: quando il
modello ruota, i riflessi scorrono sulla superficie (comportamento
fisicamente corretto).

### Esposizione globale

`toneMappingExposure: 1.25` nelle props `gl` del `<Canvas>` in `Scene.jsx`:
luminosità complessiva della scena. È il modo più rapido per
schiarire/scurire tutto in una volta (valori tipici 0.8–1.6).

---

## 5. Finiture e materiali — `materials/registry.js`

Ogni voce dell'array `finishes`:

```js
{ id: 'grafite', label: 'Grafite', swatch: '#3a3a3c',
  slots: { keycaps: {...}, body: {...}, damping: {...} } }
```

- `swatch`: colore del pallino nella pillola "Colori" (solo UI).
- `slots.*.color`: colore base della parte a video.
- `slots.*.roughness` (0–1): `0` = lucido a specchio, `1` = opaco.
- `slots.*.metalness` (0–1): `1` = metallo (riflette l'environment),
  `0` = plastica/gomma.
- Texture del cliente: aggiungere `map`, `normalMap`, `roughnessMap`,
  `metalnessMap`, `aoMap` come URL nello slot — vengono caricate in
  automatico senza altre modifiche.

Aggiungere una finitura = aggiungere un oggetto all'array: lo swatch compare
da solo nella pillola.

Mappatura parti → slot: in `materials/applyFinish.js`, tabelle
`MATERIAL_TO_SLOT` (per nome materiale del GLB) e `NODE_TO_SLOT` (fallback
per nome nodo). Es.: per dare alle viti un colore separato dai keycap,
spostare `'Countersunk'` su un nuovo slot e aggiungerlo alle finiture.

---

## 6. UI e layout — `KeyboardComposer.jsx` + `KeyboardComposer.module.css`

- Etichette pillole feature: array `DEFAULT_FEATURES` in
  `KeyboardComposer.jsx` (o prop `features` dal sito host).
- Sfondo sezione: `.section { background: #101012; border-radius: 28px; }`.
- Breakpoint mobile: `@media (max-width: 900px)` — sotto questa larghezza il
  canvas passa sopra le pillole.
- Altezza canvas: `.canvasWrap { height: clamp(420px, 60vh, 680px); }`
  (desktop) e `clamp(320px, 50vh, 480px)` (mobile). Più alto = scena più
  grande a video.
- Fade-in al caricamento: `transition: opacity 0.8s` in `.canvasWrap`.
- Aspetto pillole/swatch: classi `.pill`, `.plusIcon`, `.swatch` nello
  stesso CSS module.

---

## 7. Qualità di rendering — `Scene.jsx`

- `dpr={[1, 2]}`: risoluzione massima = 2× device pixel ratio. Abbassare a
  `[1, 1.5]` migliora gli FPS su schermi 4K/mobile deboli a lieve costo di
  nitidezza.
- `shadow-mapSize={[1024, 1024]}` sulla main light del rig: risoluzione
  delle ombre proiettate (2048 = più definite, più costose).
- Il backdrop riflettente ridisegna la scena una seconda volta per frame in
  un render target da 512px: su device deboli abbassare `resolution` a 256
  in `Backdrop.jsx`, o rimuovere `<Backdrop />` da `Scene.jsx` lasciando le
  sole ContactShadows.
- Asset: vedi README, sezione "Pipeline asset" (`--ratio` di simplify regola
  il dettaglio della mesh).
