import * as THREE from 'three'

/**
 * Precompilazione degli shader TRASPARENTI dei materiali di gruppo, e
 * costruzione anticipata degli indici di linea del wireframe.
 *
 * ## Il difetto che risolve
 *
 * La prima animazione con uno step `setOpacity` produce uno scatto visibile,
 * una volta sola per sessione, e poi mai più. Non è la camera: è la
 * dissolvenza. `opacityRegistry.own()` mette `material.transparent = true`, e
 * in three.js quella NON è una variabile di stato del renderer — è un
 * `#define` dentro il fragment shader:
 *
 *   - `getParameters`      →  `opaque: material.transparent === false && …`
 *   - `getProgramCacheKey` →  `if (parameters.opaque) _programLayers.enable(17)`
 *   - `WebGLProgram`       →  `parameters.opaque ? '#define OPAQUE' : ''`
 *
 * Cioè `transparent` è un BIT DELLA CHIAVE DI CACHE del programma. Ribaltarlo
 * non trova nessun programma esistente e ne fa compilare e linkare uno nuovo,
 * sincronicamente, per ogni combinazione di define coinvolta — e su questa
 * scena sono gli shader peggiori possibili: `MeshPhysicalMaterial` con
 * clearcoat, 26 point light, 6 rectAreaLight (LTC), la directional con shadow
 * map e la spot.
 *
 * **Misurato in browser su questo asset**: un frame normale costa `0.4 ms` di
 * CPU; il frame che deve compilare e linkare UNA di queste combinazioni ne
 * costa **192** (1000 la primissima, che paga anche l'avvio del compilatore
 * del driver). Ecco lo scatto. Non si ripresenta perché i programmi di un
 * materiale vivono in `materialProperties.programs`, una Map per-materiale
 * indicizzata per chiave di cache, svuotata SOLO quando il materiale viene
 * distrutto — e i materiali di gruppo non si distruggono mai.
 *
 * ⚠️ **Con la cache shader su disco di Chrome già calda lo scatto sparisce, ma
 * il difetto no.** Chi ha già aperto l'app varie volte non lo vede più: la
 * ricompilazione c'è lo stesso, solo che il driver restituisce un binario già
 * pronto. Per questo la verifica corretta NON è cronometrare i frame, è
 * contare i programmi:
 *
 *     gl.info.programs.length   // prima e dopo il primo play
 *
 * Se il warm-up funziona, la differenza è **0**. Con i frame si misura il
 * costo della cache di Chrome, non quello del difetto.
 *
 * ## Quando va fatto — la parte che è già stata sbagliata una volta
 *
 * ⚠️ **Non basta scaldare al mount.** La prima versione lo faceva, ed era
 * inutile: `applyMaterialProps` scrive `clearcoat`, e `clearcoat > 0` è a sua
 * volta un define (`USE_CLEARCOAT`). I valori autorati arrivano *dopo*, col
 * fetch del JSON di produzione (`app-load-materials`), e su questo asset
 * cambiano la combinazione — `landing` sta a 0, tutti gli altri gruppi sopra.
 * Risultato misurato: scaldava le varianti pre-JSON, il JSON le invalidava, e
 * il primo play compilava comunque 2 programmi, **esattamente come senza
 * warm-up**. L'unico effetto era un programma sprecato in cache.
 *
 * Da qui `programSignature()`: invece di sapere QUALI eventi toccano i
 * materiali (il fetch di produzione, "Carica JSON", gli slider Leva, e domani
 * le texture ad alta definizione, che sono anch'esse define), si osserva
 * direttamente lo stato che entra nella chiave di cache e si riscalda quando
 * cambia. Corretto per costruzione invece che per elenco di casi.
 *
 * ## Come è fatto il giro
 *
 * Flip → `gl.render()` → ripristino, **tutto nello stesso tick sincrono**, e
 * non un `compileAsync` con ripristino nel `.then()`. Due ragioni:
 *
 *  1. **Nessuna finestra di rischio.** Fra flip e ripristino non gira
 *     nient'altro. Con un `await` in mezzo, un'animazione lanciata in
 *     quell'istante prenderebbe possesso di questi stessi materiali e il
 *     ripristino le scriverebbe sopra `transparent = false`, spegnendole la
 *     dissolvenza.
 *  2. **`compileAsync` non basterebbe.** three chiama `gl.linkProgram` nel
 *     costruttore di `WebGLProgram`, ma rimanda a `onFirstUse` il
 *     `LINK_STATUS` e soprattutto la risoluzione di TUTTE le location delle
 *     uniform — che con 34 luci è gran parte del costo, ed è lavoro sincrono
 *     che scatterebbe comunque al primo disegno, cioè dentro la dissolvenza.
 *     Solo un render vero lo paga in anticipo.
 *
 * ⚠️ **Presuppone che il NUMERO di luci non cambi mai** — la chiave dipende dai
 * conteggi, non dalle intensità. È già un invariante del rig (LightRig anima le
 * intensità, mai i conteggi); montare/smontare una luce farebbe scaldare la
 * chiave sbagliata e riporterebbe lo scatto.
 *
 * Nota: scalda anche il percorso clone-on-write dell'opacityRegistry senza
 * saperlo. Un clone ha parametri identici all'originale, quindi stessa chiave,
 * e `acquireProgram` condivide per chiave a livello di renderer: trova il
 * programma già lì e ne incrementa solo il refcount.
 */

/**
 * I materiali di gruppo presenti nella scena del modello, comprese le mesh
 * NASCOSTE da una variante.
 *
 * ⚠️ Deliberatamente NON passa da `collectMeshGroups`/`prepareGroupMaterials`,
 * che saltano le mesh `__variantHidden`: quelle mesh non vengono mai
 * disegnate, quindi i loro materiali non hanno alcun programma in cache
 * (verificato in browser: `programs.size === 0` per `patchesANSI` con ISO
 * selezionato) e la prima dissolvenza dello swap di variante pagherebbe la
 * compilazione a freddo. Qui si raccoglie per tag `__groupMaterialFor`, che
 * c'è comunque.
 */
export function collectGroupMaterials(modelScene) {
  const materials = new Set()
  const hidden = []
  if (!modelScene) return { materials: [], hidden }
  modelScene.traverse((o) => {
    if (!o.isMesh || !o.material?.userData?.__groupMaterialFor) return
    materials.add(o.material)
    if (o.userData?.__variantHidden) hidden.push(o)
  })
  return { materials: [...materials], hidden }
}

/**
 * Firma compatta di ciò che, in questi materiali, entra nella CHIAVE DI CACHE
 * del programma — cioè che cosa obbligherebbe a ricompilare.
 *
 * Non ci sono dentro `color`, `roughness`, `metalness`, `envMapIntensity`,
 * `clearcoatRoughness`, `opacity`: sono uniform, cambiarle è gratis. Ci sono
 * invece le soglie che accendono un define (`clearcoat > 0` → `USE_CLEARCOAT`)
 * e la presenza delle mappe, che oggi il GLB non ha ma che CLAUDE.md dà come
 * in arrivo — quando arriveranno, questa firma se ne accorgerà da sola.
 */
export function programSignature(materials) {
  return materials
    .map((m) =>
      [
        m.clearcoat > 0,
        m.sheen > 0,
        m.transmission > 0,
        m.iridescence > 0,
        m.anisotropy > 0,
        m.flatShading,
        m.vertexColors,
        !!m.map,
        !!m.normalMap,
        !!m.roughnessMap,
        !!m.metalnessMap,
        !!m.aoMap,
        !!m.emissiveMap,
        !!m.alphaMap,
        !!m.clearcoatMap,
        !!m.envMap,
        m.side,
      ]
        .map((v) => (v === true ? '1' : v === false ? '0' : String(v)))
        .join(''),
    )
    .join('|')
}

/**
 * Compila le varianti trasparenti, una volta, disegnando un frame.
 *
 * ⚠️ `renderTarget` NON è un parametro di comodo: deve essere lo STESSO
 * bersaglio su cui la produzione disegna. `toneMapping` e `outputColorSpace`
 * sono anch'essi define nel fragment shader, e three ne sceglie il valore in
 * base a dove si sta disegnando — sullo schermo valgono quelli del renderer
 * (ACES, sRGB), dentro un render target valgono `NoToneMapping` e lineare.
 * Sono quindi due CHIAVI DI CACHE diverse. Da quando esiste
 * `runtime/postfx/PostFx.jsx` la scena finisce in un render target: scaldare
 * sullo schermo compilerebbe programmi che non verranno mai usati, e il primo
 * `setOpacity` ne compilerebbe 2 nuovi in mezzo alla dissolvenza — cioè
 * esattamente il difetto che questo modulo esiste per prevenire, ricreato da
 * un'altra strada e altrettanto invisibile (nessun errore, nessuna differenza
 * a video: si vede solo su `gl.info.programs.length`).
 *
 * `null` = schermo, ed è il valore giusto quando il post-processing è spento.
 *
 * @returns {number} quanti materiali sono stati scaldati (0 = non fatto nulla)
 */
/**
 * Costruisce in anticipo gli INDICI DI LINEA che `setWireframe` pretende al
 * primo disegno.
 *
 * ## Il difetto, che NON è una compilazione di shader
 *
 * `wireframe` non è un define e non entra nella chiave di cache del programma
 * (three scambia l'index buffer al momento del disegno,
 * `WebGLRenderer.js:1111`), quindi il warm-up qui sopra non lo copre e non
 * dovrebbe: misurato, `gl.info.programs.length` legge 11 prima e 11 dopo. Il
 * costo sta altrove ed è memoria: three genera l'attributo di linee alla prima
 * mesh disegnata con `wireframe = true`, sei indici per triangolo, cioè ~2.03
 * milioni di voci (~8 MB) sulle 338.586 facce di questo asset.
 *
 * Misurato in browser: il frame che accende il wireframe costa **148.7 ms la
 * prima volta e 81 la seconda**, contro una mediana di 32. Gli 81 ms sono il
 * disegno delle linee e non se ne vanno mai — sono il prezzo di quella vista —
 * ma i ~68 ms di differenza sono la costruzione, e si pagano una volta sola.
 * Questa funzione li sposta all'avvio.
 *
 * ⚠️ CLAUDE.md registrava la decisione OPPOSTA («deliberatamente NON
 * pre-riscaldato, che addebiterebbe a ogni sessione una vista che i più non
 * aprono»), e l'argomento era giusto. Quello che lo scioglie non è cambiare
 * idea: è la CONDIZIONE. Il chiamante (KeyboardModel.jsx) invoca questa funzione
 * solo se le animazioni autorate del prodotto contengono davvero uno step
 * `setWireframe` — quindi paga solo il prodotto che quella vista ce l'ha, e la
 * paga durante la dissolvenza d'ingresso invece che in mezzo a un'animazione.
 * Un prodotto senza wireframe non alloca un byte.
 *
 * ## Perché un render target 4×4
 *
 * Gli indici di linea sono per GEOMETRIA e vengono creati al primo disegno,
 * indipendentemente da quanti pixel quel disegno copra: un bersaglio minuscolo
 * li costruisce e li carica tutti pagando fill zero. Serve anche a non far
 * lampeggiare un frame di wireframe sullo schermo, che a differenza del flip di
 * `transparent` (invisibile, opacità ancora 1) si vedrebbe benissimo.
 *
 * @returns {number} quante geometrie sono state disegnate (0 = non fatto nulla)
 */
export function warmWireframeBuffers({ gl, scene, camera, materials, hidden = [] }) {
  if (!gl || !scene || !camera) return 0
  const list = [...new Set(materials)].filter((m) => m && m.wireframe !== true)
  if (!list.length) return 0

  const wasVisible = hidden.map((o) => o.visible)
  const prevTarget = gl.getRenderTarget()
  const target = new THREE.WebGLRenderTarget(4, 4)
  try {
    for (const m of list) m.wireframe = true
    // Come per il warm-up trasparente: le mesh nascoste da una variante vanno
    // mostrate, o le loro geometrie non vengono disegnate e quindi nemmeno
    // indicizzate — e la prima animazione dopo uno swap di variante ripagherebbe
    // la costruzione per quella metà del modello.
    for (const o of hidden) o.visible = true
    gl.setRenderTarget(target)
    gl.render(scene, camera)
  } finally {
    // `finally` per la stessa ragione dell'altro warm-up: se il render lancia,
    // lasciare i materiali in wireframe significherebbe un prodotto a fil di
    // ferro per il resto della sessione.
    gl.setRenderTarget(prevTarget)
    for (const m of list) m.wireframe = false
    for (let i = 0; i < hidden.length; i++) hidden[i].visible = wasVisible[i]
    // Solo il bersaglio: gli indici di linea vivono in `WebGLGeometries`,
    // indicizzati per GEOMETRIA, e sopravvivono — è tutto il punto.
    target.dispose()
  }
  return list.length
}

export function warmTransparentPrograms({
  gl,
  scene,
  camera,
  materials,
  hidden = [],
  renderTarget = null,
}) {
  if (!gl || !scene || !camera) return 0
  const list = [...new Set(materials)].filter((m) => m && m.transparent !== true)
  if (!list.length) return 0

  const wasTransparent = list.map((m) => m.transparent)
  const wasVisible = hidden.map((o) => o.visible)
  const prevTarget = gl.getRenderTarget()
  try {
    for (const m of list) {
      m.transparent = true
      // ⚠️ `needsUpdate` qui NON è ridondante, anche se `transparent` cambia da
      // sé la chiave di cache. `setProgram` la ricalcola solo se
      // `material.version !== materialProperties.__version`: dentro quel ramo
      // controlla luci, color space, skinning, morph, clipping, fog… ma NON
      // `transparent`. Senza bump di versione il renderer riuserebbe il
      // programma opaco già in cache e non compilerebbe nulla — warm-up
      // silenziosamente inutile.
      m.needsUpdate = true
    }
    // Le mesh nascoste da una variante vanno mostrate per questo frame, o i
    // loro materiali non vengono disegnati e quindi nemmeno compilati (vedi
    // collectGroupMaterials). Un frame con entrambi i layout a video, a canvas
    // ancora in dissolvenza d'ingresso: invisibile.
    for (const o of hidden) o.visible = true

    gl.setRenderTarget(renderTarget)
    gl.render(scene, camera)
  } finally {
    // Prima di ogni altro ripristino: se `gl.render` lancia, lasciare il
    // renderer puntato altrove spegnerebbe il frame successivo.
    gl.setRenderTarget(prevTarget)
    // `finally`: se il render lancia, i materiali non devono restare
    // trasparenti — sarebbero ~264 mesh nel pass ordinato per distanza per
    // tutta la sessione, cioè l'artefatto che DEPTH_WRITE_MIN esiste per
    // contenere — né le mesh di una variante devono restare visibili.
    for (let i = 0; i < list.length; i++) {
      list[i].transparent = wasTransparent[i]
      // Necessario: il render ha lasciato il programma TRASPARENTE come
      // `currentProgram` del materiale. Senza invalidare, il frame successivo
      // non ricalcola la chiave e continuerebbe a disegnare con quello
      // (identico a opacità 1, ma è una bugia che si paga altrove).
      list[i].needsUpdate = true
    }
    for (let i = 0; i < hidden.length; i++) hidden[i].visible = wasVisible[i]
  }
  return list.length
}
