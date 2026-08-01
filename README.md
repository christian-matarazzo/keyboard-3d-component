<div align="center">

# ⌨️ Keyboard Composer

**Configuratore 3D di prodotto in un solo componente React.**
Navigazione su grafo di pose, rig di luci autorato per posa, sequencer di animazioni.

<sub>
  React 19 · three 0.178 · @react-three/fiber 9 · @react-three/drei 10 · Vite 6
</sub>

<br/>

`v0.1.0` — pacchetto npm `keyboard-composer` · `WIP`

</div>

---

Non è un viewer 3D con orbita libera: è una **vetrina di prodotto guidata**. Il
modello si muove fra pose nominate, ogni posa ha la sua illuminazione autorata,
e ogni movimento — inquadrature, opacità, swap di varianti — è una sequenza
salvata su file, non codice.

Il componente **non porta UI**: un'app ospite disegna i propri pulsanti e li
collega a una piccola API imperativa (`onReady(api)`).

> **Due mondi nello stesso sorgente.** Il *prodotto* (ciò che viene spedito) e
> il *playground di authoring* (`?debug`, con i pannelli Leva) vivono nella
> stessa cartella, separati da un confine `import()`: in produzione `leva` e
> l'editor non vengono nemmeno scaricati.

<table>
<tr><td>

**[⚡ Avvio rapido](#-avvio-rapido)** · **[✨ Cosa fa](#-cosa-fa)** · **[🔌 Integrazione](#-integrazione)** · **[🧩 Prodotti](#-un-configuratore-molti-modelli)**

**[🏗 Architettura](#-architettura)** · **[🎛 Authoring `?debug`](#-authoring-debug)** · **[📦 Pipeline asset](#-pipeline-asset-obj--glb)** · **[⚠️ Limiti noti](#️-stato-e-limiti-noti)**

</td></tr>
</table>

---

## ⚡ Avvio rapido

```bash
npm install
npm run dev          # playground su http://localhost:5174  (porta da $PORT)
npm run build        # build SPA         → dist/
npm run build:lib    # pacchetto npm     → dist/lib
```

Aggiungi `?debug` all'URL per aprire l'ambiente di authoring.

> **Niente test runner, niente linter.** Le verifiche si fanno guidando l'app e
> rileggendo i valori dallo scene graph. In `?debug` `window.__r3f_state`
> espone lo stato R3F: `state.advance(t)` fa avanzare un frame su richiesta,
> utile per portare a convergenza uno smorzamento senza aspettare in tempo
> reale.

---

## ✨ Cosa fa

<table>
<tr>
<td width="50%" valign="top">

### 🧭 Navigazione a pose
**21 pose nominate** su un grafo di adiacenza esplicito (convenzione ViewCube di
Maya: facce a 0°/90°, spigoli a 45°, corner a `atan(1/√2)`). Un gesto è sempre
«vai al vicino in questa direzione», mai una rotazione arbitraria.

L'assestamento è una **molla smorzata** seminata con la velocità reale del
gesto, compensata perché uno step da 90° abbia lo stesso overshoot *in gradi*
di uno da 45°.

</td>
<td width="50%" valign="top">

### 💡 Rig volumetrico per posa
~34 luci (griglia 3×3×3 di point light attorno al bounding box + 6
`rectAreaLight`, una per faccia), con **intensità, colore e decay memorizzati
per chiave di posa**.

Il crossfade fra due set di luci è guidato dalla **distanza angolare percorsa
dalla camera**, non da un timer: le luci vanno in passo con la rotazione.

</td>
</tr>
<tr>
<td valign="top">

### 🎬 Sequencer di animazioni
Animazioni autorate a **step e wave**, composte da azioni dichiarative:
`goToPose`, `focusGroup`, `setOpacity`, `spinGroup`, `rotateBy`, `wobble`,
`bounce`, `transformOffset`, `setVariant`, `waitTime`, `waitTrigger`.

Si citano per **slug** — `api.play('go-to-rotors')` — e possono avere
prerequisiti (`requires`), quindi sbloccarsi a vicenda.

</td>
<td valign="top">

### 🎚 Varianti e materiali
Insiemi di mesh alternative (oggi il layout **ISO/ANSI**) con transizione
autorata o incrocio in dissolvenza integrato. La scelta vive in
`sessionStorage`, mai nel JSON: è dell'utente, non del prodotto.

I materiali non sono preset: vengono **clonati da quelli che il GLB già porta**,
una volta per gruppo, così ogni texture map autorata nel DCC sopravvive intatta.

</td>
</tr>
</table>

**Due modalità di prodotto.** `idle` è il modello nudo, si gira a mano.
`config` si comanda dai pulsanti: gesture e frecce sono spente, così non ci sono
mai due scrittori sui target di posa e zoom mentre una sequenza gira.
`play()` entra da sé in `config` — è la trappola d'integrazione che l'API toglie
di mezzo al chiamante.

**Lo zoom non si resetta mai.** La distanza della camera non è un valore
scrivibile ma il **prodotto di tre ref indipendenti** — `baseRadius` (il fit
responsive), `userZoom` (la rotellina, registrata *solo* in `?debug`) e
`focusZoom` (l'inquadratura su un gruppo) — ricomposte da `applyRadius()`.
Un resize o un cambio di modalità riscrive la base e rimoltiplica gli altri
fattori sopra, quindi non può cancellarli. In produzione l'unico zoom è
`focus(groupId)`.

---

## 🔌 Integrazione

```jsx
import KeyboardComposer, { PRODUCT_IDS } from 'keyboard-composer'
import 'keyboard-composer/style.css'

function Configuratore() {
  const api = useRef(null)

  return (
    <>
      <KeyboardComposer
        product={PRODUCT_IDS.ARRAY_MODEL_L}
        onReady={(a) => { api.current = a }}
      />
      {/* La UI è tua: */}
      <button onClick={() => api.current.play('go-to-rotors')}>Rotori</button>
      <button onClick={() => api.current.cycleVariant('layout')}>ISO / ANSI</button>
    </>
  )
}
```

### Props

| Prop | Default | Descrizione |
| --- | --- | --- |
| `product` | `'ARRAY_MODEL_L'` | Id del registro, prodotto definito, o definizione derivata |
| `onReady` | — | `(api) => void`, **una volta**, quando il modello è carico e il ponte è pronto |
| `apiRef` | — | La stessa facciata via ref React (usabile insieme a `onReady`) |
| `hud` | `false` | Monta l'overlay DOM integrato (telemetria, chip, selettori) |
| `branding` | `null` | `{ logoUrl, logoAlt, version, footer }` per l'HUD — nessun marchio di serie |
| `escapeToIdle` | `true` | Uscita da `config` con `Esc`; **indipendente dall'HUD** |
| `authoring` | `isDebug()` | Carica l'editor. Valutato **una volta**: è un `import()`, non un ramo di render |
| `modelUrl` · `meshGroups` · `meshVariants` | dal prodotto | Override puntuali — per un modello nuovo si dichiara un prodotto |

### API pubblica — `createPublicApi`

| Area | Metodi |
| --- | --- |
| **Modalità** | `mode()` · `enterConfig()` · `exitConfig()` |
| **Animazioni** | `animations()` → `[{ slug, label, requires, locked }]` · `play(slug, { force })` · `stop()` · `state()` · `trigger(name)` · `subscribe(fn)` |
| **Varianti** | `variants()` → `[{ id, label, options, selected, next }]` · `cycleVariant(id)` *(con transizione)* · `setVariant(id, opt)` *(scatto secco)* |
| **Navigazione** | `poses()` · `goTo(poseKey)` · `currentPose()` · `focus(groupId)` · `clearFocus()` |

> `locked` è calcolato **adesso**: va riletto dopo ogni evento di `subscribe`.
> Il gate dei prerequisiti vive qui, non nel runtime — l'editor deve poter
> provare qualunque cosa mentre la si autora.

### Asset da servire

| Percorso | Contenuto |
| --- | --- |
| `models/keyboard.glb` | Il modello (~1,1 MB, Draco) |
| `draco/` | Decoder self-hosted, passato esplicitamente a `useGLTF` |
| `lightconfig/app-state-config.json` | **Luci, materiali, focus, animazioni** — senza, il modello resta al buio |

Servili da un'altra origine con `assetsBaseUrl` sul prodotto: prefissa i soli
URL relativi alla radice, lasciando intatto chi ha già scritto un URL assoluto.

---

## 🧩 Un configuratore, molti modelli

Tutto ciò che dipende dal *modello* — e non dal comportamento del configuratore
— sta in un solo oggetto dichiarativo sotto `products/`:

```js
export const ARRAY_MODEL_L = defineProduct({
  id: 'ARRAY_MODEL_L',
  modelUrl: '/models/keyboard.glb',
  configUrl: '/lightconfig/app-state-config.json',
  poseGraph:    ARRAY_MODEL_L_POSE_GRAPH,     // 21 pose + adiacenza
  meshGroups:   ARRAY_MODEL_L_MESH_GROUPS,    // 9 gruppi logici
  meshVariants: ARRAY_MODEL_L_MESH_VARIANTS,  // layout ISO/ANSI
})
```

Aggiungere un modello è: **una cartella, un `defineProduct`, una riga nel
registro**. Nient'altro nel componente conosce i nomi dei gruppi, le chiavi
delle pose o il percorso del GLB.

> ⚠️ **I pezzi non sono indipendenti**, ed è il motivo per cui l'unità
> sostituibile è il prodotto e non le singole prop: il JSON è indicizzato *per
> chiave di posa* (`lights`) e *per id di gruppo* (`materials`, `focus`), e le
> animazioni citano pose, gruppi e varianti. Mescolare il pose graph di un
> modello con i gruppi di un altro produce un file che carica a metà, in
> silenzio.

I gruppi di `ARRAY_MODEL_L`: `keycaps` · `patchesISO` · `patchesANSI` · `body`
*(fallback)* · `damping` · `rotors` · `tasselli` · `landing` · `viti`.
La classificazione è **puramente per substring del nome nodo** e **l'ordine
dell'array conta** (vince il primo che matcha).

---

## 🏗 Architettura

```
src/components/KeyboardComposer/
├─ KeyboardComposer.jsx    shell DOM · crea lo store · risolve il prodotto · espone l'API
├─ Scene.jsx               <Canvas> — monta runtime e (solo in authoring) la scena editor
├─ KeyboardModel.jsx       GLB + auto-fit + useComposerControls (drag/tasti/molla/zoom)
├─ poseGraph.js            primitive angolari + createPoseGraph (fabbrica, senza dati)
│
├─ products/               ⬅ TUTTO ciò che dipende dal modello
├─ runtime/                ⬅ CODICE DI PRODUZIONE — non importa mai `leva`
│                             publicApi · ConfigLoader · MaterialApplier · ShadowLights
├─ authoring/              ⬅ IL CONFINE LAZY — pannelli Leva, gizmo, editor animazioni
├─ state/                  composerStore (9 sezioni serializzate + `ui` + `view`)
├─ animation/              schema · runtime · azioni · registri opacità/pivot
└─ materials/              macchina di classificazione e clone (nessun dato di modello)
```

**Il flusso dati, in tre regole:**

| | |
| --- | --- |
| **Dati** | Nessun ponte: `KeyboardComposer` è l'antenato comune di Canvas e overlay, quindi animazioni, varianti e modalità scendono come **prop normali** |
| **Comandi** | Un solo ref imperativo, `apiRef`, scritto **solo** con `Object.assign` — mai riassegnato: cinque scrittori vivono in sottoalberi React senza garanzie d'ordine |
| **Stato autorato** | Uno **store per istanza** (niente globali, niente CustomEvent): chi monta dopo legge ciò che trova già lì, quindi il caricamento non dipende più dall'ordine di mount |

Le nove sezioni serializzate — `lights`, `materials`, `rotation`, `keylight`,
`spotlight`, `focus`, `animations`, `variants`, `app` — **sono** la forma del
JSON salvato, nello stesso ordine.

---

## 🎛 Authoring (`?debug`)

Un ambiente per **trovare numeri**, non qualcosa che l'utente finale vede.
`leva` e ogni componente dell'editor stanno dietro un `import()`: la produzione
non li scarica.

| Modalità | Cosa sblocca |
| --- | --- |
| `Nessuno` | Solo il prodotto |
| `Luci` | Editor per posa: click sull'helper, intensità/colore/decay, gizmo su key e spot |
| `Mesh` | Ispettore gruppo/mesh con `TransformControls`, halo e pivot runtime |
| `Animazioni` | Editor a blocchi di step e wave |
| `Focus` | Inquadrature nominate sui gruppi logici |

Il pulsante **«Salva Configurazione»** serializza *tutto* in un blob unico: è
quel file che va in `public/lightconfig/` per portare l'authoring in produzione.

> ⚠️ **Le luci di produzione vivono nel JSON, non nel codice.** I `value:` dei
> componenti sono solo il fallback se il fetch fallisce. Una vista nera è prima
> di tutto una questione di contenuto del file — controllalo *prima* di
> indagare su `LightRig.jsx`:
>
> ```bash
> node -e "const L=require('./public/lightconfig/app-state-config.json').lights;
> for (const [p,c] of Object.entries(L)) console.log(p, Object.entries(c).filter(([k,v])=>k.endsWith('_intensity')&&v>0).length)"
> ```

---

## 📦 Pipeline asset (OBJ → GLB)

```bash
npm run asset:convert    # OBJ → GLB grezzo (obj2gltf, --max-old-space-size=8192)
npm run asset:optimize   # weld → prune --keep-attributes → Draco
npm run asset:inspect    # gltf-transform inspect
```

Vincoli **non negoziabili**:

- ⛔ **Mai `gltf-transform optimize` o `join`** — fondono le mesh e i loro nomi
  di nodo, rompendo insieme la classificazione dei gruppi e il clone dei
  materiali.
- 🔑 **I nomi dei nodi devono mantenere le substring distintive**: sono l'unico
  criterio di classificazione.
- 🧵 **`prune` va eseguito con `--keep-attributes`**, o si perdono le UV.
- 🚫 **Niente `simplify`**: è già un retopo web-ready, decimarlo sfaccetta i
  keycap arrotondati.

---

## ⚠️ Stato e limiti noti

| | |
| --- | --- |
| ✅ **Luci** | Tutte e 21 le pose sono autorate nel JSON di produzione |
| ✅ **Pacchetto** | `build:lib` esternalizza react/three/r3f/leva; `leva` è peer **opzionale** |
| ⏳ **Ombre di contatto** | Assenti *per costruzione*: le `rectAreaLight` non supportano le ombre in three.js e le point light solo via cube map — **31 delle 34 luci non possono fisicamente proiettarne**. L'unica ombra reale è quella della direzionale |
| ⏳ **Anti-aliasing** | Progettato (AO screen-space, shadow map congelata, accumulo a scena ferma), **non implementato**: non cercare un `EffectComposer` |
| ⏳ **Secondo prodotto** | Il registro ne contiene uno solo; l'infrastruttura è pronta |
| ➖ **Test e linter** | Non configurati. Nota: **non si può fare il fingerprint del rig hashando i valori smorzati** — lo smorzamento è asintotico e il delta del primo frame varia a ogni run |
