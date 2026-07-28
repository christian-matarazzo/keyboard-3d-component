# Keyboard Composer — vetrina 3D

Componente React (Three.js / `@react-three/fiber`) per la vetrina della tastiera
Dither **"Array — Model L"**: canvas nera a piena viewport con il modello 3D e un
**HUD di prodotto** in overlay (logo, telemetria, paginazione delle viste).
Estetica product-shot, fondo nero pieno, camera teleobiettivo.

> **Stato: WIP.** Navigazione fra pose e illuminazione per-posa sono
> funzionanti, con tutte e 21 le pose illuminate; mancano ancora le
> inquadrature zoomate/autorali e il lavoro su anti-aliasing e ombre di
> contatto. Vedi [Stato e limiti noti](#stato-e-limiti-noti).
>
> Per le note di implementazione approfondite (invarianti, trappole, ordini di
> effetti React) il riferimento è **[CLAUDE.md](CLAUDE.md)**: questo README è la
> porta d'ingresso — cosa fa, come si avvia, come si integra, come si autora.

---

## Indice

- [Avvio rapido](#avvio-rapido)
- [Cosa fa il componente](#cosa-fa-il-componente)
- [Integrazione](#integrazione)
- [Architettura](#architettura)
- [Il grafo delle pose](#il-grafo-delle-pose)
- [Materiali e gruppi di mesh](#materiali-e-gruppi-di-mesh)
- [Illuminazione e configurazione di produzione](#illuminazione-e-configurazione-di-produzione)
- [Modalità debug (`?debug`) — il playground di authoring](#modalità-debug-debug--il-playground-di-authoring)
- [Pipeline asset (OBJ → GLB)](#pipeline-asset-obj--glb)
- [Stato e limiti noti](#stato-e-limiti-noti)

---

## Avvio rapido

```bash
npm install
npm run dev       # dev server Vite — porta da $PORT, fallback 5174
npm run build     # build di produzione
npm run preview   # anteprima della build
```

Poi apri `http://localhost:5174/`. Aggiungi `?debug` per il pannello di
authoring (`http://localhost:5174/?debug`).

Non è configurato né un test runner né un linter: le verifiche si fanno
guidando l'app nel browser (vedi la sezione "Verificare le modifiche nel
browser" in [CLAUDE.md](CLAUDE.md), che documenta le tre trappole che costano
tempo — fra cui il fatto che **una tab in background rompe l'app**, perché
`requestAnimationFrame` è congelato e R3F non misura mai il canvas).

---

## Cosa fa il componente

**Navigazione a pose, non orbita libera.** Il modello si muove fra **21 pose
nominate** collegate da un grafo di adiacenza esplicito. Un gesto è sempre
"vai alla posa vicina in questa direzione", mai una rotazione arbitraria:

| Input | Comportamento |
| --- | --- |
| **Drag** (mouse/touch) | Sceglie un asse dominante per gesto, interpola verso il vicino con resistenza elastica oltre il target; al rilascio committa se il progresso supera `commitFraction` (default `0.2`), altrimenti torna indietro |
| **Frecce tastiera** | Uno step esatto per pressione — key-repeat filtrato, debounce 300 ms per evitare lo "spinning" |
| **Rotellina** | Zoom continuo, moltiplicatore utente sulla distanza camera |
| **Pager `01–05`** (HUD) | Salta direttamente a una delle 5 viste principali |

L'assestamento è una **molla smorzata** con velocità reale seminata dal gesto
(o dalla cadenza dei tasti), con compensazione: uno step da 90° dilata il tempo
e compensa lo smorzamento perché abbia la stessa velocità angolare e lo stesso
overshoot *in gradi assoluti* di uno step da 45°, invece di risultare
visibilmente diverso.

**La camera orbita, il modello non ruota mai.** La camera resta livellata a
un'altezza di pivot fissa e viene posizionata via quaternione lungo
pitch/yaw della posa. Questo è il motivo per cui le luci non devono essere
"riagganciate" al modello quando la vista cambia.

**Zoom (invariante: non si resetta MAI).** La distanza della camera è il
*prodotto di due ref indipendenti* — `baseRadius` (la distanza di
inquadratura, di competenza dei percorsi di fit) e `userZoom` (puro
moltiplicatore, di competenza esclusiva della rotellina). Un ricalcolo del
fit riscrive la base e rimoltiplica il fattore utente sopra, quindi un
resize, un cambio di `fitMargin` o un cambio di modalità non possono più
cancellare lo zoom dell'utente. **Nessuno assegna mai `cameraRadius`
direttamente**: se aggiungi un terzo scrittore, dagli un ref suo e componilo
in `applyRadius()`.

**HUD di prodotto** (`Hud.jsx`) — overlay DOM sempre montato (non debug),
`pointer-events: none` tranne il pager. Le quattro telemetrie sono *misurate*,
non derivate dallo stato React: FPS da un proprio loop rAF indipendente da
R3F, vista attiva da un poll a 150 ms sul ponte imperativo, peso del modello
letto dal `PerformanceResourceTiming` del `.glb`, RAM da `performance.memory`
(solo Chrome/Edge — altrove mostra `—`).

---

## Integrazione

```jsx
import KeyboardComposer, { preloadKeyboardModel } from './components/KeyboardComposer'

preloadKeyboardModel()   // opzionale: avvia il fetch del GLB il prima possibile

<KeyboardComposer
  modelUrl="/models/keyboard.glb"   // default: DEFAULT_MODEL_URL
  meshGroups={DEFAULT_MESH_GROUPS}  // default: i 6 gruppi di questo GLB
/>
```

### Props

| Prop | Default | Descrizione |
| --- | --- | --- |
| `modelUrl` | `'/models/keyboard.glb'` | URL del GLB (Draco-compresso) |
| `meshGroups` | `DEFAULT_MESH_GROUPS` | Elenco dei gruppi logici di mesh — vedi [Materiali](#materiali-e-gruppi-di-mesh). Chi integra il componente con un GLB dalle convenzioni di naming diverse passa qui il proprio elenco, senza toccare nessun consumer |

### Export pubblici (`src/components/KeyboardComposer/index.js`)

```js
export default KeyboardComposer          // anche come export nominato
export { preloadKeyboardModel }          // prefetch del GLB
export { DEFAULT_MESH_GROUPS }           // per estendere/sostituire i gruppi
```

### Requisiti lato host

Copiare nella cartella statica:

| Percorso | Contenuto |
| --- | --- |
| `public/models/keyboard.glb` | Il modello (~1,1 MB, Draco) |
| `public/draco/` | Decoder Draco self-hosted — passato esplicitamente a `useGLTF`, non da CDN |
| `public/lightconfig/app-state-config.json` | **Luci, materiali e feel di produzione** — senza questo file il modello resta al buio |
| `public/fonts/` | Suisse Intl Mono (HUD) |
| `public/brand/` | Logo |

Gli stili sono CSS module; l'unico stile globale è `src/index.css` (font +
reset).

---

## Architettura

```
KeyboardComposer.jsx        shell DOM: fade-in del canvas, host del pannello Leva
├─ Scene.jsx                 <Canvas> — camera, tone mapping, Suspense/Loader
│  ├─ KeyboardModel.jsx       carica il GLB, auto-fit della scala, monta useComposerControls
│  ├─ MaterialTuner           un folder Leva per gruppo di mesh (in Scene.jsx)
│  ├─ LightRig.jsx            tutta l'illuminazione (produzione + editor per-posa)
│  └─ MeshController.jsx      editor mesh: TransformControls + halo su un pivot runtime;
│                              possiede anche il data model dei keyframe della Timeline
├─ Hud.jsx                    overlay DOM: logo, telemetria, pager viste
└─ Timeline.jsx               overlay DOM: scrubber keyframe (solo ?debug + editMode 'timeline')
```

**I due ponti imperativi.** `Hud.jsx`/`Timeline.jsx` vivono nel DOM, fuori dal
`<Canvas>`, quindi non possono condividere stato React con la logica di
pose/luci che sta dentro. Sono collegati da due ref:

- **`poseApi`** — seedato a `useRef({})`, **mai `null`, mai riassegnato**.
  Ci scrivono due sorgenti indipendenti: `useComposerControls.js`
  (`goTo`/`currentPoseKey`) e `Scene.jsx` (`editMode`/`lockedPoseKey`).
  ⚠️ **Solo `Object.assign(apiRef.current, {...})`, mai `apiRef.current = {...}`**:
  i due scrittori stanno in sottoalberi React diversi senza garanzie di
  ordinamento dei commit, e una riassegnazione cancellerebbe i campi appena
  scritti dall'altro. `Hud.jsx` lo interroga con un poll a 150 ms (non è
  reattivo) e chiama `goTo()` dai pulsanti del pager; `LightRig.jsx` lo legge
  a ogni `useFrame` per sapere quale config di luci è attiva.
- **`timelineApiRef`** — ponte gemello per la Timeline, popolato da
  `MeshController.jsx` con le azioni sui keyframe e i campi di sola lettura
  che `Timeline.jsx` interroga.

---

## Il grafo delle pose

`poseGraph.js` è il contratto di navigazione. Convenzione **ViewCube di Maya**
(il cliente lavora in Maya): facce a 0°/90°, spigoli a 45°, corner "3/4" lungo
la diagonale del cubo, cioè elevazione `atan(1/√2) ≈ 35.264°`.

- **`POSE_COORD`** — le 21 pose con le loro coppie pitch/yaw canoniche,
  organizzate in tre bande orizzontali (alta, centrale, bassa) più la colonna
  centrale a yaw 0 (`TBACK · TOP · CFT · FRONT · CFB · BOTTOM · BBACK`), unica
  via allo zenit e al nadir.
- **`NEIGHBORS`** — adiacenza esplicita: al più un vicino per `up`/`down`/
  `left`/`right`, oppure `null` (dove trovi solo la resistenza elastica). Il
  `back` e il `back-basso` sono raggiungibili **solo** in orizzontale, mai in
  verticale — regola del cliente.
- **`stepTo(pitch, yaw, dir, yawOffset)`** — direzione → pitch/yaw grezzi
  della prossima posa, prendendo il percorso di yaw **più breve dallo yaw
  grezzo corrente** (che può aver accumulato più giri) invece che dallo yaw
  canonico del vicino: così nessuno step fa un giro completo di troppo.
- **`HUD_VIEWS`** — le 5 pose del pager (`TOP`, `CFT`, `FRONT`, `TL`,
  `BOTTOM`); `TL` (initial position, 3/4 front left) è la posa d'ingresso
  landscape ed è quindi la voce attiva al caricamento.
- **Portrait** — in verticale l'**intero grafo** è ruotato di
  `PORTRAIT_YAW_OFFSET` (90°), derivato una volta dalla posa d'ingresso e
  **congelato in un ref**. Non va mai ricalcolato dalla dimensione live della
  viewport: un resize sposterebbe il frame sotto la posa corrente e romperebbe
  silenziosamente `stepTo`.

---

## Materiali e gruppi di mesh

Classificazione e applicazione dei materiali sono due concetti deliberatamente
separati in due file. **Non esiste più un concetto di "finitura"/preset**: i
vecchi `materials/registry.js` + `materials/applyFinish.js`, che costruivano
`MeshPhysicalMaterial` nuovi da preset di colore scritti a mano, sono stati
eliminati. I materiali vengono ora **scoperti e clonati da quelli che il GLB
già porta con sé**, così qualunque texture map autorata nel DCC (o aggiunta in
futuro) sopravvive intatta.

**`materials/meshGroups.js`** — unica fonte di verità sui gruppi logici.
`DEFAULT_MESH_GROUPS` per questo asset:

| id | label | `nameTokens` |
| --- | --- | --- |
| `keycaps` | Keycaps | `Keycaps` |
| `body` | Body | `S0` |
| `damping` | Damping | `Damping` |
| `rotors` | Rotors | `Rotor` |
| `tasselli` | Tasselli | `Tasselli` |
| `landing` | Rialzo | `Rialzo` |

⚠️ La classificazione è **puramente per substring del nome nodo**. Non esiste
più il match per nome materiale: in questo asset più gruppi condividono lo
stesso materiale Maya (`body`/`rotors`/`tasselli` usano tutti
`standardSurface3SG`), quindi la vecchia "fast path" per nome materiale
classificava silenziosamente male ogni volta che il match era univoco per
materiale ma sbagliato per nome nodo. **I nomi dei nodi esportati devono
mantenere le loro substring distintive.**

**`materials/groupMaterials.js`** è completamente generico sugli id dei
gruppi — riceve solo un oggetto già classificato. `prepareGroupMaterials()`
clona ogni materiale sorgente distinto **una volta per gruppo**, così due
gruppi che condividono un materiale Maya ottengono cloni tunabili
indipendentemente. `Material.clone()` copia in profondità i parametri PBR
scalari ma assegna le texture **per riferimento**, senza mai toccare i pixel:
le map viaggiano gratis. L'operazione è idempotente (tag
`userData.__groupMaterialFor`), così `KeyboardModel.jsx` e il `MaterialTuner`
di `Scene.jsx` — che sono fratelli, non genitore/figlio — possono chiamarla
entrambi sulla stessa scena condivisa in cache senza doppioni né conflitti di
ordine di mount.

---

## Illuminazione e configurazione di produzione

`LightRig.jsx` è il file più complesso del componente e va letto come due metà.

**Luci sempre accese** (non dipendenti dalla posa): `ShadowKeyLight` (una
`directionalLight`, l'unico shadow caster) e `ShadowSpotLight` (uno
`spotLight`, disattivato di default).

**Rig volumetrico per-posa** (il grosso del file): una griglia fissa di point
light su un cubo 3×3×3 attorno al bounding box del modello meno il centro (9
`top`, 8 `mid`, 9 `bot`), più 6 `rectAreaLight`, una per faccia del box.
Intensità/decay/colore di ogni luce sono memorizzati **per chiave di posa**.
A ogni frame il rig legge la posa attiva, e sul cambio posa calcola un
`progress` di transizione guidato dalla **distanza angolare effettivamente
percorsa dalla camera** (non da un timer): il crossfade delle luci va in passo
con la rotazione invece che a tempo fisso.

⚠️ **Il prefisso più l'indice SONO le chiavi del JSON di configurazione**
(`top_0_intensity`, `mid_3_color`, `bot_7_decay`, …). Non rinominare mai un
prefisso e non riordinare mai i cicli che generano la griglia: rimapperesti
silenziosamente ogni configurazione salvata su luci diverse — invisibile in
review, evidente solo sul prodotto renderizzato.

**Box luci adattivo (che si stira).** Il box non deriva da una misura
one-shot del modello pristino: viene misurato sulla scena GLTF *live* (la
stessa istanza in cache in cui l'editor mesh scrive le sue trasformazioni).
Ogni faccia e ogni luce sono ancorate alla **propria** estensione del box, ed
è questo che lo fa *stirare* su un asse invece che traslare: alza la mesh più
in alto di `m` e il piano superiore sale di `m` mentre quello inferiore resta
fermo, così ogni faccia mantiene la sua distanza di `margin` dalla superficie
che ha davanti. La misura salta le mesh taggate `__editorHelper` (gli halo di
selezione, che altrimenti gonfierebbero il box) ed è throttlata a un
campionamento ogni N frame, poi smorzata — quindi la frequenza di
campionamento è invisibile e lo stiramento si anima invece di scattare.

**⚠️ Le luci di produzione vivono nel JSON, non nel codice.** Fuori da
`?debug`, `LightRig` fa il fetch di **`public/lightconfig/app-state-config.json`**
una volta al mount e lo applica attraverso gli stessi percorsi di codice
dell'editor. Il JSON contiene 5 sezioni: `lights` (per posa), `materials`,
`rotation` (il feel del drag), `keylight`, `spotlight`. I default `value:`
scritti nei componenti Leva sono **solo il fallback se il fetch fallisce** —
quello che arriva in produzione è ciò che è stato autorato in `?debug` ed
esportato con "Salva Configurazione".

Per vedere quante luci sono accese per posa:

```bash
node -e "const L=require('./public/lightconfig/app-state-config.json').lights;
for (const [p,c] of Object.entries(L)) console.log(p, Object.entries(c).filter(([k,v])=>k.endsWith('_intensity')&&v>0).length)"
```

---

## Modalità debug (`?debug`) — il playground di authoring

Con `?debug` nell'URL compare il pannello Leva (ridimensionabile trascinandone
il bordo sinistro) e si sbloccano gli editor. **È uno strumento per trovare
numeri, non qualcosa che l'utente finale vede.** Senza il flag il canvas resta
pulito.

> `<Leva>` è **sempre** montato, anche in produzione, con `hidden={!DEBUG}`:
> Leva crea comunque un pannello di default non appena esiste una qualsiasi
> `useControls` nell'albero, e non c'è altro modo di sopprimerlo se non non
> chiamare affatto `useControls`.

### `editMode` — le modalità sono esclusive

Un select Leva (`⚙️ Editor · Modalità`) sceglie fra
`'none' | 'lights' | 'meshes' | 'timeline'`, passato come prop da un'unica
sorgente in `Scene.jsx`. L'esclusività non è cosmetica: prima, un singolo
click sul modello poteva selezionare una mesh *e* un helper di luce sottostante
insieme, perché i due sistemi usano pipeline di eventi R3F indipendenti e
`stopPropagation()` su una non blocca mai l'altra. La soluzione vera non è
gattare i click handler ma mettere `raycast={() => null}` sulla geometria di
hit-test del sistema inattivo, togliendola del tutto dalla lista di
intersezione del raycaster.

> ⚠️ Non assegnare **mai** `raycast={undefined}`: crea una proprietà propria
> che maschera `THREE.Mesh.prototype.raycast` con `undefined` e il raycaster
> di three.js crasha provando a chiamarla. Assegna sempre una funzione vera.

`editMode` governa anche la **visibilità dei pannelli**, tramite il predicato
`render` per-folder di Leva. Attenzione: `render` nasconde solo la riga nella
UI, **non smonta la `useControls`** — i valori tunati sopravvivono al cambio
di modalità e al ritorno (uno smontaggio vero li riporterebbe ai default
hardcoded dello schema).

| Modalità | Cosa sblocca | Navigazione fra pose |
| --- | --- | --- |
| `none` | Niente — solo il prodotto | Libera |
| `lights` | Editor luci per-posa: click su un helper per selezionare, pannello laterale per intensità/colore/decay, `Ctrl/Cmd+Z` (history a 50 snapshot), gizmo su key/spot | **Libera** — la config è per-posa, quindi tunare le luci di una vista richiede di poter scorrere le viste |
| `meshes` | Editor mesh: doppio selettore Gruppo/Mesh, `TransformControls` + slider Pos/Rot | **Bloccata** su `lockedPose` |
| `timeline` | Come `meshes` più lo scrubber keyframe | **Bloccata** su `lockedPose` |

### Pose lock (Mesh/Timeline)

Entrare in Mesh o Timeline (o cambiare `lockedPose` mentre ci sei dentro)
scatta sulla posa bloccata. Il lock è applicato su **due livelli**, non solo
sul trigger: `goTo()` stesso controlla la modalità e ignora silenziosamente
qualunque richiesta per una posa diversa — quindi il lock tiene chiunque
chiami `goTo` — e i pulsanti del pager HUD sono `disabled` per tutte le altre
pose, così è visivamente ovvio perché non succede niente.

Nota: drag e frecce sono sospesi in Mesh/Timeline, **ma la rotellina no** —
l'handler dello zoom non ha alcun controllo su `disabled` e resta vivo in ogni
modalità.

### Editor mesh (`MeshController.jsx`)

Due selettori **mutuamente esclusivi** — Gruppo e Mesh — più il click 3D sul
modello (che popola sempre il campo Mesh). L'ultimo campo toccato vince e
azzera l'altro. Tutto ciò che sta a valle (pivot, halo, opacità, gizmo,
keyframe) è scritto una volta sola contro `selection.meshes`, indifferente al
fatto che sia un gruppo o una mesh singola.

**Perché esiste un pivot runtime.** Molte sub-mesh di questo GLB esportato da
Maya hanno l'origine locale lontanissima dalla geometria visibile (pattern
"freeze transform": la posizione vera è cotta nei dati dei vertici, non nella
trasformazione del nodo). Ruotare `mesh.rotation` direttamente le farebbe
spazzare un arco attorno a un punto arbitrario invece di girare su se stesse.
Alla selezione la mesh viene quindi **riparentata temporaneamente** sotto un
`THREE.Group` posizionato al centro del suo bounding box geometrico, con
`Object3D.attach()` (che preserva la trasformazione mondiale calcolando da sé
la locale compensativa, quindi la mesh non salta mai). Alla deselezione il
cleanup fa il contrario e **cuoce** la trasformazione nella mesh: le modifiche
persistono. Per i gruppi il pivot sta al centro dell'unione dei bounding box,
parentato sotto la radice GLTF, e la posizione mondiale va convertita con
`scene.worldToLocal()` — `scene` **non** è l'identità nel mondo (eredita
rotazione dalla posa e scala dalla normalizzazione).

Gli slider Pos (`±100`) / Rot (`±180°`) sono un **offset relativo** a quel
centro, non valori assoluti — lo spazio nativo del GLB è grande (posizioni di
pivot nell'ordine delle decine di unità), da cui il range ampio.

> ⚠️ **Il gizmo pubblica gli offset via `onObjectChange`, non `onChange` — non
> "semplificare" tornando indietro.** `TransformControls` emette il suo evento
> `change` generico dal setter di proprietà che installa su `object`, quindi
> lo emette anche quando drei fa `attach()` su un nuovo pivot al cambio di
> selezione — e la callback che React invoca in quel momento è ancora la
> closure del render *precedente*, con il `pivotInfo` vecchio. Il risultato
> era che l'offset vecchio veniva riscritto in Leva *dopo* il reset a zero e
> applicato fedelmente alla nuova selezione. `objectChange` viene emesso solo
> da `pointerMove`, cioè solo durante un drag reale del gizmo.

**Halo di selezione**: un guscio backface-only leggermente ingrandito per
mesh, figlio della *mesh stessa* (non del pivot), scalato **attorno al centro
geometrico** — altrimenti riprodurrebbe esattamente il bug di off-center che
il pivot esiste per risolvere. Ogni halo è taggato `userData.__editorHelper`:
qualunque cosa attraversi lo scene graph deve saltarlo (la classificazione dei
gruppi e la misura del box luci lo fanno).

### Timeline (`editMode === 'timeline'`)

Primo passo di una timeline di keyframe in stile Maya, esplicitamente limitata
a **data model + UI minima di scrub**: niente autoplay Play/Pause, niente
save/load su JSON (entrambi rinviati). Non aggiunge logica di selezione o
pivot: riusa integralmente quella dell'editor mesh e ci sovrappone i keyframe
sugli stessi campi `posX..rotZ`. I keyframe sono tracciati **per selezione**
(gli offset sono relativi a un centro specifico e non significano nulla
condivisi fra selezioni diverse); lo scrub interpola linearmente fra i due
keyframe che circondano il playhead e chiama lo stesso setter che usano già
gizmo e slider.

### Salvare e ricaricare

I pulsanti **"Salva Configurazione"** / **"Carica JSON"** sono l'eccezione al
gating per modalità: restano visibili per tutta la sessione `?debug` perché
serializzano **tutto** lo stato tunabile in un colpo solo — le luci per posa,
i materiali, il feel della rotazione, key light e spotlight — in un unico
blob JSON. È quel file che va messo in `public/lightconfig/app-state-config.json`
per portare l'authoring in produzione.

---

## Pipeline asset (OBJ → GLB)

L'OBJ sorgente (`assets-src/Array_L_WEB_Retopo.obj`, non committato per
dimensione) viene convertito e ottimizzato in `public/models/keyboard.glb`
(~1,1 MB), l'unico asset che l'app carica davvero:

```bash
npm run asset:convert    # OBJ → GLB grezzo via obj2gltf (richiede --max-old-space-size=8192)
npm run asset:optimize   # weld → prune (--keep-attributes) → compressione Draco
npm run asset:inspect    # gltf-transform inspect sul GLB finale
```

Vincoli **non negoziabili** su questa pipeline:

- **I nomi dei nodi esportati devono mantenere le loro substring
  distintive** — sono l'unico criterio di classificazione dei gruppi.
- **Mai eseguire `gltf-transform optimize` o `join`** sull'output: fondono le
  mesh (e i loro nomi di nodo), il che rompe sia la classificazione per nodo
  sia il clone di materiale per gruppo su cui si regge tutto il sistema dei
  materiali.
- **`prune` va eseguito con `--keep-attributes`**, altrimenti si perdono le UV.
- **Niente `simplify`**: è già un retopo web-ready; decimarlo sfaccetta i
  keycap arrotondati.

Il GLTF è caricato con compressione Draco; il decoder è self-hosted in
`public/draco/` e passato esplicitamente come secondo argomento a `useGLTF`.

---

## Stato e limiti noti

**Luci: copertura completa.** Tutte e 21 le pose del JSON di produzione hanno
luci autorate (da 7 a 19 luci accese per posa). In precedenza solo `TL`,
`CFL` e `BFL` erano illuminate e ogni altra vista — `TOP` e `FRONT` incluse —
si vedeva nera in produzione: se trovi quell'avvertenza citata altrove, è
obsoleta. Resta valido il principio: **una vista nera è prima di tutto una
questione di contenuto del JSON, non un bug del rig.** Controllalo con lo
snippet della sezione
[Illuminazione](#illuminazione-e-configurazione-di-produzione) prima di
indagare su `LightRig.jsx`.

**Anti-aliasing e ombre di contatto fra mesh non ci sono ancora.** Il rig
volumetrico non produce alcuna occlusione fra mesh, e non per svista: le
`rectAreaLight` non supportano le ombre in three.js e le point light le
supportano solo via cube map (6 render di scena per luce), quindi **31 delle
34 luci non possono fisicamente proiettare ombre**. L'unica ombra reale è
quella della direzionale. Il progetto per colmare la cosa — AO screen-space a
metà risoluzione, shadow map congelata, accumulo progressivo a scena ferma per
l'AA — è documentato in dettaglio in [CLAUDE.md](CLAUDE.md), sezione *"Planned
work: anti-aliasing and contact shadows"*. È **progettato, non implementato**:
non cercare un `EffectComposer` nel codice.

**Lo zoom di prodotto non esiste ancora.** L'unico zoom oggi è la rotellina:
un moltiplicatore libero sulla distanza della camera. La feature di prodotto
sarebbe un insieme di **inquadrature nominate e autorate per posa** — va
considerata da costruire, non da cercare nel codice. (Una vista esplosa era
stata costruita e poi rimossa del tutto, in favore del meccanismo più generale
di selezione/trasformazione di `MeshController.jsx`, che può riprodurre
l'"explode" come posa autorata invece che come animazione hardcoded. Non
esiste attualmente nessuna UI di vista esplosa.)

**Niente test, niente linter.** Le regressioni si prendono guidando l'app.
Nota in particolare che **non si può fare il fingerprint del rig hashando i
valori smorzati**: lo smorzamento di `maath/easing` è asintotico e il delta
del primo frame varia a ogni run, quindi due esecuzioni di codice *identico*
producono dump diversi. Verifica invece contro la fonte di verità — che
l'i-esima luce nell'ordine di traversata porti l'intensità della chiave
corrispondente del JSON.

**Debug e prodotto vanno tenuti separati.** Quando modifichi qualcosa, i
controlli e la UI di debug restano dietro il flag `DEBUG`
(`new URLSearchParams(window.location.search).has('debug')`, **ricalcolato per
file**, non condiviso via context o prop) invece di filtrare nella UI di
prodotto sempre attiva. `editMode`, al contrario, **è** passato come prop da
un'unica `useControls` in `Scene.jsx`: la mutua esclusione non funziona se
ogni file ha una sua idea della modalità corrente, mentre `DEBUG` è un flag
statico deciso al caricamento della pagina e ricalcolabile ovunque senza
rischi.
