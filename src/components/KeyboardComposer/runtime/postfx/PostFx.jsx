import { useEffect, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js'
import { useComposerSection } from '../../state/useComposerSection'
import { isDebug } from '../../state/debug'
import { DEFAULT_POSTFX } from '../../state/defaults'

/**
 * La catena di post-processing: render target multicampionato + uscita.
 *
 * Rende `null` e possiede l'unico `useFrame` con priorità positiva dell'intera
 * applicazione. Codice di PRODUZIONE, come i suoi vicini `MaterialApplier` e
 * `ShadowLights`: nessun `leva`, nessun componente di authoring, montato
 * incondizionatamente da Scene.jsx. La taratura vive nella sezione `postfx`
 * dello store, quindi si autora nel playground e viaggia nel JSON fino al
 * prodotto — l'interruttore no, e il perché è in state/defaults.js.
 *
 * ## Perché i pass di `three` e non `postprocessing`
 *
 * `EffectComposer`, `RenderPass`, `OutputPass` (e, per i passi successivi,
 * `GTAOPass`/`FXAAPass`) sono già dentro `three` sotto `examples/jsm/`. Non
 * sono una dipendenza nuova: sono lo stesso peer che l'host installa comunque,
 * e `vite.config.js` li lascia esterni da sé (la regola su EXTERNAL confronta
 * anche i SOTTOPERCORSI — `three/…` — apposta). Il pacchetto npm non cresce di
 * un byte e non guadagna un peer.
 *
 * `@react-three/postprocessing` avrebbe portato con sé `postprocessing`, che
 * peer-pinna `three` con un caret `^0.x`: esattamente il problema delle due
 * copie di `three` per cui EXTERNAL esiste, e per cui `@google/model-viewer` è
 * stato scartato dalla feature AR.
 *
 * ## Due cose che sembrano mancare e invece sono giuste
 *
 * ⚠️ **Il tone mapping resta sul renderer**, non si sposta. Sembra sbagliato
 * (`OutputPass` "fa il tone mapping"), ma three lo risolve già da sé: il define
 * `toneMapping` di un materiale vale `renderer.toneMapping` solo quando si
 * disegna sullo SCHERMO, e `NoToneMapping` quando si disegna in un render
 * target. Quindi il `RenderPass` riempie il target in HDR lineare da solo, e
 * `OutputPass` legge `renderer.toneMapping`/`outputColorSpace` per applicare
 * ACES + sRGB sul quad finale. Mettere `NoToneMapping` sul renderer
 * spegnerebbe anche il secondo, e l'immagine uscirebbe piatta.
 *
 * ⚠️ **`samples` va chiesto a mano.** Il render target di default di
 * `EffectComposer` non ne ha, e l'MSAA del framebuffer di default
 * (`antialias: true`) non c'entra più nulla nel momento in cui si rende
 * attraverso un composer: l'ultimo disegno sullo schermo è un quad fullscreen,
 * che di bordi geometrici non ne ha. Senza questa riga il primo pass aggiunto
 * PEGGIORA l'immagine invece di migliorarla. Per lo stesso motivo Scene.jsx
 * spegne `antialias` sul Canvas quando questo componente è montato: sarebbe un
 * framebuffer multicampionato allocato e mai usato.
 *
 * ⚠️ L'MSAA moltiplica i campioni di COPERTURA, non le valutazioni di shading,
 * quindi per costruzione non tocca l'aliasing speculare. Su questa scena però
 * quell'aliasing è stato MISURATO e non c'è (materiali ruvidi, keycap neri,
 * highlight larghi): l'accumulazione temporale che questo commento indicava
 * come passo successivo è ARCHIVIATA, vale 0.018/255 — vedi CLAUDE.md,
 * "Anti-aliasing". Non costruirla senza rimisurare.
 *
 * ## Perché l'MSAA è spento (misurato 2026-08-04)
 *
 * ⚠️ **`msaaSamples` è la manopola peggiore di questo file, e per anni è stata
 * l'unica accesa.** La misura che la giustificava («sopra `pixelRatioCap` 1.25
 * passare da 4 a 2 campioni è indistinguibile») era vera e fuori campo: il
 * prodotto spedito sta a **1.0**, dove non era mai stata verificata. Rifatta lì
 * — build di produzione, Intel Iris Xe / ANGLE D3D11, `devicePixelRatio` 1,
 * finestra 1920×855 (1.64 Mpx), tempi GPU del solo `composer.render()` presi con
 * `EXT_disjoint_timer_query_webgl2` (l'intervallo rAF non serve: a 60 Hz satura
 * a 16.7 ms e nasconde tutto ciò che sta sotto):
 *
 *            configurazione   a riposo (cop. 0.15)   saturo (cop. 0.96)
 *            msaa0 + none            10.3 ms               63.4 ms
 *            msaa0 + fxaa            12.7                  65.6
 *            msaa2 + none            16.3                  71.7
 *            msaa0 + smaa            18.4                  70.6
 *            msaa4 + none            19.2                  75.7
 *            msaa2 + fxaa            22.6                  77.2
 *
 * cioè MSAA 2× costa **+6.0 ms a riposo e +8.2 saturo** (3.7 e 5.0 ms per Mpx di
 * target), contro +2.4/+2.1 di FXAA (1.3 ms/Mpx) e +8.1/+7.2 di SMAA (4.4). Ed è
 * SUPERADDITIVO con un pass a valle (msaa2+fxaa costa 13.8 sopra la base contro i
 * 10.3 della somma): ogni confine di pass su un target multicampionato paga un
 * blit di resolve, e questa scena è satura proprio su quell'asse.
 *
 * ## Cosa si compra con quei millisecondi: la manopola `aa` e il gradino > 1
 *
 * Qualità misurata come delta medio per pixel sui pixel di BORDO (2.9%
 * dell'immagine, maschera per gradiente locale sulla luma) contro l'immagine
 * supercampionata 2× — target 6.57 Mpx ridotto in scala dal quad finale, cioè un
 * box filter 2×2 esatto. Più basso è meglio:
 *
 *            msaa4 + none  @1      3.97      19.2 ms
 *            msaa0 + none  @1.4    4.00     ~17.4
 *            msaa2 + none  @1      4.61      16.3      ← ciò che si spediva
 *            msaa0 + none  @1.2    4.72      13.4
 *            msaa0 + smaa  @1      4.88      18.8
 *            msaa0 + fxaa  @1.2    5.01      17.2
 *            msaa0 + fxaa  @1      5.16      12.7
 *            msaa0 + none  @1      6.27      10.3
 *
 * ⚠️ **Supercampionare DOMINA l'MSAA sulla frontiera qualità/costo**: a scala 1.2
 * si ottiene la stessa qualità di bordo di MSAA 2× per 3 ms in meno, e a 1.4 si
 * batte MSAA 4× costando meno. Sono campioni veri contro campioni veri, e i
 * secondi li paga anche dove non servono. Da qui il default spedito: MSAA spento,
 * `aa: 'none'`, e il budget speso alzando `dynamicScaleMax`.
 *
 * ⚠️ **SMAA è stato provato e RIMOSSO**, non dimenticato. Due ragioni, entrambe
 * misurate: è dominato (4.88 a 18.8 ms, cioè peggio del supercampionamento a 1.4
 * che costa meno), e il suo `SMAAPass` porta le texture di area/ricerca in base64
 * dentro il chunk `three` — **465 → 505 kB gzip**, 40 kB che pagherebbe ogni
 * integratore per un'opzione che ha perso la misura. Se qualcuno lo rimette:
 * va DOPO `OutputPass`, non prima. Misurato anche quello — 4.88 dopo contro 5.98
 * prima, cioè la posizione che la documentazione di three prescrive è la peggiore
 * delle due su questa catena (il suo shader di blend fa `pow(C, 2.2)`, cioè dà
 * per sRGB un ingresso che la doc dichiara lineare).
 *
 * ⚠️ **Il pass di AA costa per pixel di TARGET, non per pixel COPERTO**, cioè
 * è l'unico costo di questo file che non passa dal modello. La scala dinamica
 * lo scopre solo se glielo si dice: vedi `aaCostMsPerMpx` in `wantedScaleRaw`.
 * Senza quel termine il budget continuerebbe a promettere millisecondi che il
 * pass si è già preso, e "niente cali di framerate" si perderebbe in silenzio.
 *
 * ## Il supercampionamento non arrivava a destinazione (2026-08-04)
 *
 * ⚠️ **Fino a `createResolveOutputPass` la riduzione finale era UN SOLO TAP
 * BILINEARE**, e con lei metà del vantaggio che aveva fatto vincere il
 * supercampionamento nella tabella qui sopra. `OutputShader` fa letteralmente
 * `gl_FragColor = texture2D( tDiffuse, vUv )`: un tap bilineare pesa 2×2 texel,
 * cioè è il box ESATTO del rapporto 2 e di nessun altro. Il gradino spedito è
 * 1.4, dove quel tap salta texel interi.
 *
 * Si vedeva, e il sintomo non era "immagine morbida" ma una **seghettatura
 * luminosa**: misurata su una cattura del prodotto, le due creste di
 * ombreggiatura sullo smusso del fianco (la silhouette e lo spigolo interno)
 * sono larghe **1 px** con picchi 115-126 su un fondo locale di 60, migrano di
 * 1 px ogni 24 righe e restano in fase fra loro — 24 px di riga dritta, poi lo
 * scatto. È il campionamento puntuale di una cresta più stretta del pixel: i
 * campioni per risolverla c'erano già nel target a 1.4, li buttava via l'ultimo
 * quad.
 *
 * ⚠️ La conseguenza sulla tabella: i numeri di errore di bordo delle righe a
 * scala > 1 sono stati misurati CON questo difetto, cioè penalizzano il
 * supercampionamento. Non vanno cancellati, vanno riletti — e rimisurati prima
 * di riaprire il confronto con l'MSAA.
 */

/**
 * --- Scala dinamica della risoluzione ------------------------------------
 *
 * Il "perché" e la legge (`scala = √(budget / pixel coperti)`) stanno in
 * state/defaults.js, su `dynamicScale`; la geometria che stima i pixel coperti
 * sta in cameraFraming.js. Qui restano i due numeri di MECCANISMO, che non sono
 * materia di authoring perché non cambiano l'aspetto, solo il modo in cui la
 * manopola si muove.
 *
 * ⚠️ Cambiare scala RIALLOCA i due render target del composer (più quelli
 * dell'AO): è la stessa microfreeze che l'effetto di ridimensionamento qui
 * sotto antirimbalza, e per la stessa ragione non può succedere per frame. Da
 * qui entrambe le costanti — la quantizzazione taglia il continuo dello zoom in
 * pochi gradini, il tempo di guardia impedisce che il dolly del focus (~0.6 s
 * smorzati) li attraversi tutti riallocando a ogni passo.
 *
 * ⚠️ E soprattutto: la scala NON passa dal useLayoutEffect che costruisce la
 * catena. `pixelRatioCap` sì (è autorata, cambia di rado), ma ricostruire vuol
 * dire un `GTAOPass` nuovo, cioè materiali nuovi, cioè una compilazione di
 * shader — esattamente lo stallo che questa manopola esiste per evitare, fatto
 * scattare dal tentativo di evitarlo. La sola via è `composer.setPixelRatio()`,
 * che rialloca i buffer lasciando in piedi i pass.
 */

/** Gradini del moltiplicatore. Sotto questa granularità si riallocherebbe per nulla. */
const SCALE_STEP = 0.1

/** Secondi minimi fra due riallocazioni. Copre il dolly del focus con al più un cambio. */
const SCALE_COOLDOWN_S = 0.35

/**
 * Margine di RISALITA, in unità di scala.
 *
 * ⚠️ È il pezzo che mancava, e la sua assenza si sentiva come uno stutter
 * periodico — non come un frame rate basso. MISURATO in fullscreen (finestra
 * 1900×925, render target 3.06 Mpx): girando fra le pose la copertura oscilla fra
 * 0.1635 (TBL) e 0.1821 (CFT), cioè l'11%, e quell'11% stava a cavallo di una
 * soglia di gradino. Risultato: **6 riallocazioni in 18 cambi di posa**, fra 2258
 * e 2509 px, **~245 MB di render target buttati e riallocati ogni volta** (RGBA16F
 * multicampionato ×4 a 3 Mpx, per due buffer). In una finestra piccola non si
 * nota, a schermo pieno è esattamente la botta che si sente.
 *
 * Da qui un controller asimmetrico: si SCENDE subito (si è oltre budget, il frame
 * sta già costando troppo) e si RISALE solo con questo margine di vantaggio, così
 * due stati che differiscono di meno di un gradino non possono farsi rimbalzare.
 */
const SCALE_RAISE_MARGIN = 0.05

/**
 * Il continuo → un gradino intero, per confrontare INTERI e non float sommati.
 *
 * ⚠️ `floor` e non `round`, e non è un dettaglio: arrotondando, una scala
 * desiderata di 0.99 diventa 1.0, cioè si rende PIÙ pixel di quanti il budget
 * consenta — e soprattutto si finisce a sedere esattamente sulla soglia, che è la
 * condizione del rimbalzo qui sopra. Troncando, il gradino scelto è sempre dentro
 * il budget e i due stati misurati (0.999 e 0.947) cadono nello STESSO gradino.
 */
const tierFloor = (value) => Math.floor(value / SCALE_STEP)

/**
 * Lo stesso, ma per i TETTI. `Math.floor(1.5 / 0.1)` fa 14, non 15: in binario
 * 1.5/0.1 vale 14.999999999999998, e un tetto autorato a 1.5 diventerebbe 1.4
 * senza che nessuno capisca perché. Il troncamento serve alla legge continua
 * (vedi sopra), non a un limite che l'autore ha scritto a mano.
 */
const tierRound = (value) => Math.round(value / SCALE_STEP)

/** Il gradino di piena qualità, come intero. */
const FULL_TIER = tierRound(1)

/**
 * Tetto ASSOLUTO alla superficie del render target, in megapixel.
 *
 * ⚠️ È il tetto che conta davvero, e `dynamicScaleMax` da solo non lo
 * sostituisce: quello è un moltiplicatore, quindi non sa quanto è grande la
 * finestra: 1.5× su un canvas incorporato sono 30 MB, 1.5× a schermo pieno su
 * un 4K sono centinaia. L'aritmetica, per i due buffer del composer:
 *
 *   colore  RGBA `HalfFloat` = 8 B/px, ×2 buffer, ×`msaaSamples` sui campioni
 *   profondità `UnsignedInt` = 4 B/px, ×2 buffer
 *
 * cioè ~24 B/px con MSAA spento (il default spedito) e ~40 con `msaaSamples: 2`.
 * A 4 Mpx si sta fra 96 e 160 MB, che su una GPU integrata che condivide la
 * memoria di sistema è il massimo difendibile. `FXAAPass` non aggiunge nulla al
 * conto: è uno `ShaderPass`, riusa il ping-pong. Rialzare questo tetto è una
 * decisione di memoria, non di qualità.
 */
const MAX_TARGET_MPX = 4

/**
 * Il gradino massimo che il tetto di memoria concede, data la taglia a scala 1.
 * `√(tetto / pixel)` è la stessa inversione di `wantedScaleRaw`: i pixel vanno
 * come `scala²`.
 */
const pixelCeilingTier = (fullPixels) =>
  fullPixels > 0 ? tierFloor(Math.sqrt((MAX_TARGET_MPX * 1e6) / fullPixels)) : FULL_TIER

/**
 * La scala che terrebbe il frame dentro il budget, NON limitata a 1.
 *
 * `costo ≈ (fillCostMsPerMpx · copertura + aaCostMsPerMpx) · pixel`, con i
 * pixel che vanno come `scala²`: invertendo,
 * `scala = √(budget / (costo_per_Mpx · pixel_a_scala_1))`.
 *
 * ⚠️ I due addendi del costo NON sono la stessa grandezza, ed è il motivo per
 * cui la formula ha dovuto generalizzarsi. Il fill si paga sui pixel COPERTI
 * dal modello (quindi moltiplicato per la copertura); il pass di AA si paga su
 * TUTTI i pixel del target, perché è un quad fullscreen — a modello lontano la
 * copertura crolla e il fill con lei, il costo dell'AA no. Con `aa: 'none'` il
 * secondo termine è zero e questa espressione collassa ESATTAMENTE nella
 * vecchia `√(budgetPx / pixel_coperti)`: nessuna deriva sul comportamento che
 * c'era prima.
 *
 * ⚠️ Il valore torna GREZZO, senza tetto: il tetto si applica al gradino, non
 * qui. Serve così al margine di risalita — un valore già tagliato a 1 non
 * potrebbe mai superare `(gradino + margine)` una volta scesi sotto, e il
 * controller resterebbe incastrato in basso per sempre. Errore fatto e corretto
 * in fase di progetto, vale la pena non rifarlo.
 *
 * ⚠️ `coverage` nullo non è zero: significa "non lo so ancora" (il modello non ha
 * comunicato la taglia) e deve valere piena risoluzione, cioè il comportamento di
 * prima che questa legge esistesse. Un `?? 0` avrebbe scalato al pavimento
 * all'avvio.
 */
const wantedScaleRaw = (s, coverage, fullPixels) => {
  if (!s.dynamicScale || coverage == null || !(fullPixels > 0)) return null
  const msPerMpx =
    s.fillCostMsPerMpx * Math.max(0, coverage) + (s.aa && s.aa !== 'none' ? s.aaCostMsPerMpx : 0)
  const budgetPx = (s.frameBudgetMs / Math.max(msPerMpx, 0.01)) * 1e6
  return Math.sqrt(budgetPx / fullPixels)
}

/**
 * Il gradino da applicare, dato quello corrente. Il pavimento `dynamicScaleMin`
 * resta il limite di MORBIDEZZA accettata — quando è lui a vincere, la finestra è
 * troppo grande per questo hardware e la scelta fra fluidità e nitidezza torna
 * all'autore.
 *
 * ⚠️ Il tetto NON è più fisso a `FULL_TIER`, e il cambio è il punto di tutto il
 * supercampionamento: fino a ieri questa legge poteva solo TOGLIERE risoluzione,
 * cioè spendeva il budget solo per difendersi e mai per guadagnare. Ma il budget
 * è dichiarato, non consumato: dove avanza — canvas incorporati, e tutta la
 * navigazione a riposo, dove la copertura misurata è ~0.20 — si può renderizzare
 * SOPRA la densità nativa e far ridurre in scala il quad finale. Sono campioni
 * veri, non ricostruzione: è l'antialiasing più forte che esista, e per
 * costruzione non può sforare `frameBudgetMs`, perché è la stessa legge a
 * concederlo.
 *
 * ⚠️ Su schermo HiDPI il primo effetto non è supercampionare, è tornare al
 * NATIVO. Con `devicePixelRatio` 1.25 e `pixelRatioCap` 1 il composer disegna a
 * 0.8× e il browser riscala in su: un gradino 1.25 annulla quell'upscaling prima
 * di aggiungere un solo campione in più. Su questa macchina è probabilmente il
 * guadagno di nitidezza più grande dell'intera manopola.
 *
 * ⚠️ E il tetto è DUE tetti, non uno: `dynamicScaleMax` (scelta d'autore) e
 * `pixelCeilingTier` (memoria). Nessuno dei due può però spingere SOTTO
 * `FULL_TIER` — sono guardie contro il supercampionamento, non un secondo
 * pavimento: il pavimento è `dynamicScaleMin`, e ha un'altra ragione d'essere.
 */
const nextTier = (s, raw, current, fullPixels) => {
  if (raw == null) return FULL_TIER
  const minTier = Math.max(1, Math.ceil(s.dynamicScaleMin / SCALE_STEP))
  const maxTier = Math.max(
    FULL_TIER,
    Math.min(tierRound(s.dynamicScaleMax ?? 1), pixelCeilingTier(fullPixels)),
  )
  const wanted = Math.min(maxTier, Math.max(minTier, tierFloor(raw)))
  // Isteresi: scendere è immediato, risalire chiede un vantaggio reale. Vale
  // anche attraversando FULL_TIER — anzi lì serve di più, perché è la soglia su
  // cui la copertura a riposo oscilla dell'11% fra una posa e l'altra.
  if (wanted > current && raw < (current + 1) * SCALE_STEP + SCALE_RAISE_MARGIN) return current
  return wanted
}

/**
 * Il render target su cui si disegna la scena.
 *
 * `HalfFloatType` non è opzionale: la scena entra qui in HDR LINEARE (il tone
 * mapping arriva solo alla fine, vedi sopra), e in 8 bit per canale le alte
 * luci si troncherebbero prima di essere compresse — con ~34 luci e il
 * clearcoat, su questo modello è visibile.
 *
 * La `DepthTexture` serve al `GTAOPass`: è da lì che ricostruisce le normali,
 * ed è l'unico modo di NON fargli disegnare un prepass di normali tutto suo
 * (+108 draw call per frame, vedi sotto).
 *
 * ⚠️ Funziona anche con `samples > 0`, ma non gratis e non per ovvietà: three
 * risolve il framebuffer multicampionato con una `blitFramebuffer` che include
 * `DEPTH_BUFFER_BIT` solo se `resolveDepthBuffer` è vero (lo è di default) e il
 * target ha un depth buffer. Spegnere `resolveDepthBuffer` per risparmiare la
 * risoluzione consegnerebbe all'AO una texture di profondità vuota.
 */
const createTarget = (width, height, samples, hdr = true) => {
  const target = new THREE.WebGLRenderTarget(width, height, {
    // ⚠️ SPERIMENTALE (`hdrTarget: false`): 8 bit per canale invece di 16.
    // Dimezza i byte per campione, che su una scena bandwidth-bound è l'unico
    // tipo di risparmio che si veda — ma la scena entra qui in HDR LINEARE, e
    // in 8 bit lineari le ombre di un prodotto NERO bandeggiano e le alte luci
    // si troncano prima che ACES possa comprimerle. Vedi state/defaults.js.
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    samples,
  })
  target.depthTexture = new THREE.DepthTexture(width, height)
  target.depthTexture.format = THREE.DepthFormat
  target.depthTexture.type = THREE.UnsignedIntType
  return target
}

/**
 * Il pass di occlusione ambientale, a risoluzione ridotta e senza prepass.
 *
 * ## Le tre cose che `GTAOPass` fa di suo e che qui non vanno bene
 *
 * 1. ⚠️ **Si disegna il proprio G-buffer di normali**, cioè un'altra passata di
 *    GEOMETRIA sull'intera scena: +108 draw call per frame, che raddoppierebbe
 *    l'asse su cui questa scena è già carica. `setGBuffer(depth, undefined)`
 *    lascia `normalTexture` indefinita, e il pass compila con
 *    `NORMAL_VECTOR_TYPE = 0`, cioè normali RICOSTRUITE dalla profondità. Si
 *    perde un po' di qualità sui bordi netti; su questo profilo di costo è uno
 *    scambio ovvio.
 * 2. ⚠️ **Il costruttore alloca comunque quel render target di normali**, prima
 *    che si possa dirgli di non usarlo: `setGBuffer` viene chiamato una volta
 *    senza argomenti dal costruttore stesso. Non si può evitare passando
 *    `parameters.depthTexture` al costruttore — in quel ramo `normalRenderTarget`
 *    non viene mai creato e la riga successiva di `setGBuffer` lo dereferenzia,
 *    quindi il costruttore lancerebbe. La sola via è costruire, riconfigurare e
 *    poi liberare l'orfano a mano (`setSize`/`dispose` continuano a
 *    referenziarlo, ma su un target mai disegnato sono innocui).
 * 3. ⚠️ **`EffectComposer.setSize` impone a ogni pass la risoluzione PIENA.**
 *    L'AO a metà risoluzione va quindi difeso sovrascrivendo `setSize`
 *    sull'istanza, o il primo ridimensionamento della finestra la riporta a
 *    piena e il costo raddoppia in silenzio.
 */
const createAoPass = (scene, camera, width, height, settings) => {
  const scale = settings.aoResolutionScale
  const aoSize = (w, h) => [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))]

  const pass = new GTAOPass(scene, camera, ...aoSize(width, height))

  // (1) Normali dalla profondità, nessun prepass di geometria.
  pass.setGBuffer(null, undefined)

  // (2) Libera il target di normali che il costruttore ha allocato comunque.
  //     Non lo si annulla: `setSize` e `dispose` lo referenziano ancora. Su un
  //     target in cui non si disegna mai, `dispose()` non riallocherà nulla.
  pass.normalRenderTarget?.dispose()

  // (3) Difende la risoluzione ridotta dal `setSize` del composer.
  const baseSetSize = GTAOPass.prototype.setSize
  pass.setSize = function (w, h) {
    baseSetSize.call(this, ...aoSize(w, h))
  }

  // ⚠️ La texture di profondità va riletta dal buffer che il pass riceve, non
  // fissata una volta. `EffectComposer` scambia i due render target a ogni pass
  // con `needsSwap`, e i due hanno DEPTH TEXTURE DISTINTE (`clone()` la
  // duplica). Con `aa: 'none'` i passaggi che scambiano sono due, quindi il giro
  // torna al punto di partenza e un riferimento fisso funzionerebbe per caso;
  // il pass di AA è il terzo e lo romperebbe a frame alterni — sintomo: un'AO
  // che sfarfalla, non un errore. Da qui la rilettura a ogni frame.
  const baseRender = GTAOPass.prototype.render
  pass.render = function (renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const depth = readBuffer?.depthTexture
    if (depth && this.depthTexture !== depth) {
      this.depthTexture = depth
      this.gtaoMaterial.uniforms.tDepth.value = depth
      this.pdMaterial.uniforms.tDepth.value = depth
    }
    baseRender.call(this, renderer, writeBuffer, readBuffer, deltaTime, maskActive)
  }

  applyAoSettings(pass, settings)
  return pass
}

/**
 * Le tecniche di AA a valle, e — la metà che conta — DOVE ognuna va messa.
 *
 * ⚠️ Sbagliare il posto non alza errori: dà un'immagine leggermente sbagliata
 * che si scambia per "l'AA non funziona". `FXAAPass` ragiona su luma PERCETTIVA
 * (soglie 0.0312/0.063 tarate su valori sRGB), quindi va DOPO `OutputPass`,
 * sull'immagine già compressa da ACES e codificata. Prima, sui valori HDR
 * lineari che possono superare 1, troverebbe bordi dove non ce ne sono e li
 * mancherebbe nelle ombre.
 *
 * ⚠️ **La tabella ha una voce sola apposta, e SMAA non c'è per misura.** Vedi il
 * blocco in testa al file: dominato in qualità-per-millisecondo dal
 * supercampionamento, e +40 kB gzip nel chunk `three` di ogni integratore. Se lo
 * si rimette, `beforeOutput: false` anche per lui: la posizione che la doc di
 * three prescrive (prima di `OutputPass`, «operates in linear-srgb») è quella
 * che ha misurato PEGGIO, 5.98 contro 4.88 di errore di bordo, ed è coerente col
 * suo `SMAABlendShader` che fa `pow(C, 2.2)` — cioè tratta l'ingresso da sRGB.
 * La struttura resta a tabella per questo: aggiungere una tecnica è una riga, e
 * la riga dice anche dove va.
 */
const AA_PASSES = {
  fxaa: { create: () => new FXAAPass(), beforeOutput: false },
}

/**
 * Larghezza della banda, in unità di scala, dentro cui il pass di AA a valle ha
 * senso di esistere. Mezzo gradino attorno all'1:1 esatto con lo schermo.
 *
 * ⚠️ È stretta perché la misura lo è: FXAA vince SOLO a 1:1 (errore di bordo
 * 5.16 contro 6.27). Sopra perde contro i campioni veri (5.01 contro 4.72 a
 * scala 1.2) e sotto PEGGIORA l'immagine (11.35 contro 10.14 a 0.6, 8.25 contro
 * 7.66 a 0.8), perché sfuoca ciò che l'upscaling ha già sfuocato. Prima questa
 * scelta era affidata all'autore — `aa: 'fxaa'` di libreria, `'none'` nel JSON
 * del prodotto — cioè a indovinare a mano in quale regime avrebbe girato la
 * macchina di qualcun altro. Ora il pass si spegne da sé fuori banda, e `aa`
 * torna a dire solo "questa tecnica è disponibile".
 */
const AA_BAND = SCALE_STEP / 2

/** Il target è più grande dello schermo di almeno questo: sotto, non si riduce. */
const RESOLVE_EPS = 0.02

/** Il rapporto fra i pixel del target e quelli dello schermo. 1 = nessuna riduzione. */
const screenRatio = (composerRatio, dpr) => composerRatio / Math.max(dpr, 1e-6)

/** Il pass di AA a valle è acceso solo dentro la banda attorno all'1:1. */
const applyAaGate = (pass, composerRatio, dpr) => {
  if (pass) pass.enabled = Math.abs(screenRatio(composerRatio, dpr) - 1) <= AA_BAND
}

/**
 * I due marcatori da riscrivere in `OutputShader`. Separati dal codice perché
 * sono l'unica cosa di questo file che dipende dal SORGENTE di three e non dalla
 * sua API: se un aggiornamento li sposta, si vuole accorgersene qui e ricadere
 * sul pass intatto, non spedire uno shader mezzo patchato.
 */
const RESOLVE_MARKERS = {
  uniform: 'uniform sampler2D tDiffuse;',
  tap: 'gl_FragColor = texture2D( tDiffuse, vUv );',
}

/**
 * ⚠️ La media si fa in HDR LINEARE, cioè PRIMA del tone mapping, ed è
 * deliberato: è lo stesso ordine di un resolve MSAA e dello schermo
 * supercampionato contro cui è tarata la tabella di qualità in testa al file.
 * Mediare dopo la curva sarebbe percettivamente più uniforme, ma richiederebbe
 * di duplicare qui la catena di `#ifdef` del tone mapping di three, che è
 * esattamente il tipo di copia che diverge in silenzio a ogni aggiornamento. Su
 * questa scena lo scarto fra i due ordini è calcolabile e minuscolo: sulla
 * cresta misurata (126 contro 60 in sRGB, 4.3:1 in lineare) un pixel mezzo
 * coperto esce a 98/255 invece di 93, cioè 5 livelli — sotto la soglia a cui
 * qualsiasi altra manopola di questo file è stata giudicata.
 */
const RESOLVE_TAP_GLSL = `
			if ( uResolveOffset.x > 0.0 ) {

				gl_FragColor = 0.25 * (
					texture2D( tDiffuse, vUv + vec2( -uResolveOffset.x, -uResolveOffset.y ) ) +
					texture2D( tDiffuse, vUv + vec2(  uResolveOffset.x, -uResolveOffset.y ) ) +
					texture2D( tDiffuse, vUv + vec2( -uResolveOffset.x,  uResolveOffset.y ) ) +
					texture2D( tDiffuse, vUv + vec2(  uResolveOffset.x,  uResolveOffset.y ) )
				);

			} else {

				gl_FragColor = texture2D( tDiffuse, vUv );

			}`

/**
 * L'uscita — tone mapping e spazio colore — con la RIDUZIONE fatta come si deve.
 *
 * Quando il gradino della scala dinamica sta sopra 1, il target è più grande
 * dello schermo e questo quad è il posto in cui i campioni in più diventano
 * immagine. `OutputShader` ci mette un solo tap bilineare (vedi il blocco in
 * testa al file per che aspetto ha il difetto e per come è stato misurato); qui
 * lo si sostituisce con **quattro tap bilineari** disposti a un quarto
 * dell'impronta, cioè un box che copre ±metà impronta — la riduzione che il
 * rapporto chiede, quale che sia.
 *
 * Cosa NON costa: nessun pass nuovo, nessun render target nuovo, nessuna banda
 * in più. Sono tre fetch aggiuntive su un quad che veniva disegnato comunque, e
 * questa scena è satura sulla banda, non sull'aritmetica (16 → 4 campioni di AO
 * valgono zero millisecondi, misurato). Misurato anche il costo di queste:
 * **sotto 0.2 ms** su 1.64 Mpx di schermo, cioè sotto il pavimento del banco —
 * i numeri sono in state/defaults.js su `resolveBox`, insieme a quanto compra.
 *
 * ⚠️ **Uniform e non `#define`.** `OutputPass.render()` fa
 * `this.material.defines = {}` alla prima chiamata per ricostruire i define del
 * tone mapping: un define nostro sparirebbe lì, in silenzio, e resterebbe da
 * capire perché il filtro non si accende mai. Con `uResolveOffset` a zero il
 * ramo `else` è quello di prima, e la condizione è uniforme su tutto il quad.
 *
 * ⚠️ **La taglia della sorgente si legge dal `readBuffer`, non da `setSize`.**
 * `EffectComposer.setSize` la passerebbe a ogni pass, ma solo a quelli GIÀ
 * aggiunti: qui i pass si aggiungono dopo `setSize`/`setPixelRatio` (l'ordine è
 * obbligato, vedi la costruzione), quindi un pass appena creato non l'ha mai
 * ricevuta. Leggerla dal buffer che si sta per campionare la rende vera per
 * costruzione a ogni frame — compresi quelli subito dopo un cambio di gradino.
 *
 * @param {boolean} resolveBox valore iniziale della manopola omonima; si muove
 *   a caldo scrivendo `pass.resolveBox`.
 */
const createResolveOutputPass = (resolveBox) => {
  const pass = new OutputPass()
  const source = pass.material.fragmentShader

  if (!source.includes(RESOLVE_MARKERS.uniform) || !source.includes(RESOLVE_MARKERS.tap)) {
    // three ha riscritto OutputShader: si torna al tap singolo di prima, che è
    // un peggioramento dell'immagine e non un guasto.
    if (isDebug()) {
      console.warn('[PostFx] OutputShader cambiato: riduzione a box non applicata')
    }
    return pass
  }

  pass.uniforms.uResolveOffset = { value: new THREE.Vector2(0, 0) }
  pass.material.fragmentShader = source
    .replace(RESOLVE_MARKERS.uniform, `${RESOLVE_MARKERS.uniform}\n\t\tuniform vec2 uResolveOffset;`)
    .replace(RESOLVE_MARKERS.tap, RESOLVE_TAP_GLSL)
  pass.material.needsUpdate = true
  pass.resolveBox = resolveBox

  const offset = pass.uniforms.uResolveOffset.value
  const drawingBuffer = new THREE.Vector2()
  const baseRender = OutputPass.prototype.render
  pass.render = function (renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const image = readBuffer?.texture?.image
    const srcW = image?.width ?? 0
    const srcH = image?.height ?? 0
    renderer.getDrawingBufferSize(drawingBuffer)
    // Solo disegnando a schermo c'è una riduzione: verso un altro buffer del
    // composer la taglia è la stessa e il box sfocherebbe e basta.
    const ratio = this.renderToScreen && drawingBuffer.x > 0 ? srcW / drawingBuffer.x : 1
    if (this.resolveBox && ratio > 1 + RESOLVE_EPS && srcW > 0 && srcH > 0) {
      offset.set(ratio / 4 / srcW, ratio / 4 / srcH)
    } else {
      offset.set(0, 0)
    }
    baseRender.call(this, renderer, writeBuffer, readBuffer, deltaTime, maskActive)
  }

  return pass
}

/** Le manopole autorate → gli uniform del pass. Separata perché si applica a caldo. */
const applyAoSettings = (pass, s) => {
  pass.blendIntensity = s.aoIntensity
  pass.updateGtaoMaterial({
    radius: s.aoRadius,
    distanceExponent: s.aoDistanceExponent,
    thickness: s.aoThickness,
    samples: s.aoSamples,
    // Raggio in unità di SCENA, non in pixel: così l'occlusione di contatto non
    // cambia dimensione fisica quando la camera si avvicina in focus.
    screenSpaceRadius: false,
  })
}

export default function PostFx({ store, apiRef }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)

  // Il fondo su DEFAULT_POSTFX non è difensivismo: uno store costruito senza
  // `createInitialState` nasce con le sezioni a `{}`, e un `samples: undefined`
  // sul render target è un MSAA spento in silenzio.
  const settings = { ...DEFAULT_POSTFX, ...useComposerSection(store, 'postfx') }
  const { msaaSamples, pixelRatioCap, aoEnabled, aoResolutionScale, hdrTarget, aa } = settings

  const composerRef = useRef(null)
  const aoRef = useRef(null)
  // I due pass che si muovono senza ricostruire la catena: l'uscita (la manopola
  // `resolveBox` è un uniform) e l'AA a valle (si accende e si spegne col
  // gradino, vedi AA_BAND).
  const outputRef = useRef(null)
  const aaRef = useRef(null)

  // Il pixel ratio a piena qualità: il tetto autorato, non oltre il `dpr` che
  // il Canvas ha davvero. Specchiato in una ref perché il useFrame qui sotto lo
  // rimoltiplica per la scala corrente, e `dpr` NON è fra le dipendenze della
  // costruzione (ci pensa l'effetto di ridimensionamento).
  const baseRatio = Math.min(dpr, pixelRatioCap)
  const baseRatioRef = useRef(baseRatio)
  baseRatioRef.current = baseRatio

  // Pixel che il render target avrebbe a scala 1: l'altro fattore del budget,
  // ed è la grandezza che alla vecchia legge mancava del tutto. `focusZoom` è un
  // rapporto e vale lo stesso in un canvas 798×718 e a tutto schermo su un 1080p,
  // dove i pixel sono 3.6× — cioè la stessa animazione a 12 fps in un caso e a 6
  // nell'altro, la contraddizione già registrata in CLAUDE.md fra le "known
  // strains". Specchiato in un ref come baseRatio, e per lo stesso motivo.
  const fullPixelsRef = useRef(0)
  fullPixelsRef.current = size.width * size.height * baseRatio * baseRatio

  // Lo stesso specchio per le manopole lette dentro il useFrame.
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // Gradino di scala ATTUALMENTE applicato al render target, come intero (vedi
  // tierFloor). Non è uno stato React: cambiarlo non deve far rendere nulla,
  // deve solo ridimensionare dei buffer.
  const tierRef = useRef(FULL_TIER)
  const cooldownRef = useRef(0)

  // Costruzione. `useLayoutEffect` e non `useEffect`: il useFrame qui sotto
  // parte già dal primo frame utile, e con un composer nullo R3F non
  // renderizzerebbe affatto (la priorità positiva ha già disattivato il render
  // automatico) — un frame nero all'ingresso.
  //
  // Cambiare `msaaSamples` ricrea il target, e va bene: `samples` non entra
  // nella chiave di cache dei programmi dei materiali, quindi non ricompila
  // nulla. È esattamente il motivo per cui questa manopola può stare nel JSON
  // autorato mentre l'interruttore no.
  useLayoutEffect(() => {
    // La catena nasce sempre a piena qualità: il gradino ricomincia da 1, o il
    // primo frame dopo una ricostruzione userebbe una scala di cui non esiste
    // più il target che la giustificava.
    tierRef.current = FULL_TIER
    cooldownRef.current = 0

    const ratio = Math.min(dpr, pixelRatioCap)
    const width = Math.max(1, Math.floor(size.width * ratio))
    const height = Math.max(1, Math.floor(size.height * ratio))

    const composer = new EffectComposer(gl, createTarget(width, height, msaaSamples, hdrTarget))
    // ⚠️ `setSize` PRIMA di `setPixelRatio`, e l'ordine inverso non è
    // equivalente. Ricevendo un render target il costruttore assume
    // `_width = renderTarget.width`, cioè una misura già in PIXEL; ma
    // `setPixelRatio` non fa altro che richiamare `setSize(_width, _height)`,
    // che rimoltiplica per il ratio. Chiamandolo per primo si riallocano
    // entrambi i buffer a (pixel × ratio) — su uno schermo retina un target
    // 7680×4320 vivo giusto il tempo della riga successiva.
    composer.setSize(size.width, size.height)
    composer.setPixelRatio(ratio)
    composer.addPass(new RenderPass(scene, camera))

    // L'AO va PRIMA dell'uscita: opera su colore lineare in HDR, non su valori
    // già compressi dal tone mapping. È l'ordine che la sezione "planned work"
    // di CLAUDE.md prescrive — scena lineare → AO → tone map → AA per ultimo,
    // che invece vuole ingresso in sRGB.
    let ao = null
    if (aoEnabled) {
      ao = createAoPass(scene, camera, width, height, settings)
      composer.addPass(ao)
    }
    aoRef.current = ao

    // L'antialiasing a valle, prima o dopo l'uscita a seconda della tecnica —
    // il perché è su AA_PASSES, ed è l'unica cosa non ovvia di queste righe.
    const aaSpec = AA_PASSES[aa] ?? null
    const aaPass = aaSpec ? aaSpec.create() : null
    if (aaPass && aaSpec.beforeOutput) composer.addPass(aaPass)

    // ⚠️ La taglia va data a mano ai pass aggiunti DOPO `setSize`, cioè a tutti
    // quelli di questa funzione: `EffectComposer.setSize` la gira solo a quelli
    // già in lista. Senza questa riga `FXAAPass` resta sul default del suo
    // shader (1/1024, 1/512) fino al primo ridimensionamento della finestra —
    // cioè applica un antialiasing tarato su una risoluzione che non esiste.
    aaPass?.setSize(width, height)
    // La catena nasce a piena qualità (`tierRef` è appena tornato a FULL_TIER),
    // quindi il rapporto iniziale è quello del solo `pixelRatioCap`.
    applyAaGate(aaPass, ratio, dpr)
    aaRef.current = aaPass

    // Tone mapping + conversione di spazio colore. Ultimo della catena solo
    // finché nessuno gli mette l'AA dietro: in quel caso `EffectComposer`
    // sposta da sé `renderToScreen` sull'ultimo pass, e questo finisce a
    // scrivere in un buffer invece che a schermo. Va bene: i valori che
    // produce (ACES + sRGB) sono gli stessi in entrambi i casi, perché
    // `OutputPass` li ricava da `renderer.toneMapping`/`outputColorSpace` e
    // non da dove sta disegnando.
    const output = createResolveOutputPass(settings.resolveBox)
    composer.addPass(output)
    outputRef.current = output
    if (aaPass && !aaSpec.beforeOutput) composer.addPass(aaPass)

    composerRef.current = composer
    return () => {
      composerRef.current = null
      aoRef.current = null
      outputRef.current = null
      aaRef.current = null
      // ⚠️ `EffectComposer.dispose()` libera i propri due target e la sua
      // `copyPass`, e NIENTE dei pass che gli sono stati aggiunti — controllato
      // nel sorgente, non dedotto. Con una catena costruita una volta sola non
      // si vedeva; ora `aa` e `aoEnabled` sono manopole, cioè questo effetto si
      // rifà ogni volta che si cambia idea nell'editor, e ogni giro
      // abbandonerebbe i target dell'AO — e quelli di qualunque tecnica di AA
      // che, a differenza di `FXAAPass`, ne allochi di propri.
      aaPass?.dispose()
      ao?.dispose()
      // Vale per l'uscita esattamente come per gli altri due, e prima non lo si
      // faceva: `OutputPass` possiede un materiale e un quad a schermo intero.
      // Con la catena costruita una volta sola era un oggetto abbandonato per
      // sessione; oggi che si ricostruisce a ogni cambio di `aa`/`aoEnabled` è
      // uno per giro.
      output.dispose()
      composer.dispose()
    }
    // `size` volutamente fuori: il ridimensionamento è l'effetto qui sotto, che
    // non rialloca. Ricostruire la catena a ogni pixel di resize è la
    // microfreeze descritta in CLAUDE.md.
    // `size` volutamente fuori (vedi sopra), e con lui tutte le manopole dell'AO
    // TRANNE le due che cambiano la STRUTTURA della catena: `aoEnabled` (un pass
    // in più o in meno) e `aoResolutionScale` (la dimensione dei suoi target).
    // Le altre sono uniform e si applicano a caldo, nell'effetto qui sotto.
    // `aa` è qui e non fra le uniform a caldo per la stessa ragione di
    // `aoEnabled`: è un pass in più o in meno, cioè la STRUTTURA della catena.
    // Ricostruire non ricompila i materiali della scena (la chiave di cache dei
    // programmi dipende da dove si disegna, e la scena continua a disegnare nel
    // solito render target), quindi può stare fra i valori autorati — a
    // differenza dell'interruttore del composer, che invece no.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, msaaSamples, pixelRatioCap, aoEnabled, aoResolutionScale, hdrTarget, aa])

  // Taratura a caldo: raggio, intensità, spessore, campioni. Sono uniform e
  // define del solo materiale dell'AO — mai dei materiali della scena — quindi
  // muoverle da uno slider non ricompila i 34-luci e si può fare a video.
  useEffect(() => {
    if (aoRef.current) applyAoSettings(aoRef.current, settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.aoRadius,
    settings.aoIntensity,
    settings.aoThickness,
    settings.aoDistanceExponent,
    settings.aoSamples,
  ])

  // `resolveBox` è la manopola più a caldo di tutte: muove un solo uniform, e
  // solo nei frame in cui il target è più grande dello schermo. Nessuna
  // ricostruzione, quindi NON sta fra le dipendenze del useLayoutEffect —
  // esiste per poter fare l'A/B in pannello sullo stesso frame.
  useEffect(() => {
    if (outputRef.current) outputRef.current.resolveBox = settings.resolveBox
  }, [settings.resolveBox])

  // Ridimensionamento, con antirimbalzo. `setSize` rialloca i due buffer del
  // composer: farlo a ogni evento di resize trasforma il trascinamento del
  // bordo della finestra in una serie di microfreeze. Nell'intervallo
  // l'immagine resta scalata, che è il compromesso normale.
  useEffect(() => {
    const id = setTimeout(() => {
      const composer = composerRef.current
      if (!composer) return
      // ⚠️ Il ratio va rimoltiplicato per la scala dinamica CORRENTE, non
      // riportato al tetto: un ridimensionamento della finestra durante un focus
      // altrimenti rimetterebbe di soppiatto la piena risoluzione proprio nello
      // stato che questa manopola esiste per alleggerire, e il useFrame non se
      // ne accorgerebbe (per lui il gradino non è cambiato).
      const composerRatio = Math.min(dpr, pixelRatioCap) * tierRef.current * SCALE_STEP
      composer.setPixelRatio(composerRatio)
      composer.setSize(size.width, size.height)
      // Il rapporto col nuovo schermo può aver cambiato banda anche a gradino
      // fermo: passare da un monitor a `devicePixelRatio` 1 a uno a 1.5 sposta
      // l'1:1 senza che la legge muova un dito.
      applyAaGate(aaRef.current, composerRatio, dpr)
    }, 100)
    return () => clearTimeout(id)
  }, [size.width, size.height, dpr, pixelRatioCap])

  // Il render target su cui si disegna davvero, pubblicato sul ponte.
  //
  // ⚠️ Non è una comodità: senza, `materials/warmupTransparency.js`
  // SMETTEREBBE DI FUNZIONARE, in silenzio. Quel modulo precompila gli shader
  // trasparenti disegnando un frame vero, e i define `toneMapping` /
  // `outputColorSpace` — che three sceglie in base a dove si sta disegnando —
  // fanno parte della chiave di cache del programma. Un warm-up sullo schermo
  // mentre la produzione disegna in un render target scalda chiavi che nessuno
  // userà mai: nessun errore, nessuna differenza visibile, e il primo
  // `setOpacity` ricompila 2 programmi esattamente come senza warm-up. È il
  // difetto che quel file esiste per prevenire, ricreato da un'altra strada.
  useEffect(() => {
    if (!apiRef) return
    Object.assign(apiRef.current, {
      postfxTarget: () => composerRef.current?.renderTarget1 ?? null,
    })
    return () => {
      delete apiRef.current.postfxTarget
    }
  }, [apiRef])

  // Priorità 1: R3F disattiva il proprio render automatico non appena esiste un
  // solo subscriber con priorità positiva, ed esegue prima TUTTI quelli a
  // priorità 0 in ordine crescente. Cioè AnimationDirector, LightRig,
  // useComposerControls e ShadowFreeze girano già prima di questa riga, e
  // l'ordine "prima si muove la scena, poi si compone" viene gratis — non c'è
  // niente da coordinare a mano.
  useFrame((_, delta) => {
    const composer = composerRef.current
    if (!composer) return

    // Scala dinamica, prima del render e non dopo: il segnale è già aggiornato
    // (useComposerControls gira a priorità 0, cioè prima di questa riga), quindi
    // il frame che sta per essere disegnato è già quello alla scala giusta —
    // non si insegue lo stato del frame precedente.
    const s = settingsRef.current
    cooldownRef.current -= delta
    // La copertura arriva da useComposerControls (`apiRef.frameCoverage()`) e si
    // riferisce all'inquadratura di DESTINAZIONE, non a quella corrente: il
    // gradino cambia una volta sola, nell'istante del comando, invece di
    // attraversarne due a metà della carrellata riallocando i render target
    // mentre il modello si muove. Vedi lì per il resto dell'argomento.
    const cov = apiRef?.current?.frameCoverage?.() ?? null
    const raw = wantedScaleRaw(s, cov, fullPixelsRef.current)
    const wanted = nextTier(s, raw, tierRef.current, fullPixelsRef.current)
    if (wanted !== tierRef.current && cooldownRef.current <= 0) {
      tierRef.current = wanted
      cooldownRef.current = SCALE_COOLDOWN_S
      // Solo `setPixelRatio`: rialloca i due target (e, tramite il `setSize` dei
      // pass, quelli dell'AO) senza toccare la catena. Vedi il blocco in testa
      // al file per cosa succederebbe passando invece dalla ricostruzione.
      const composerRatio = baseRatioRef.current * wanted * SCALE_STEP
      composer.setPixelRatio(composerRatio)
      // ⚠️ Il gradino decide anche SE il pass di AA a valle ha senso: sopra 1:1
      // ci sono campioni veri e FXAA li sfoca, sotto sfoca un upscaling. Si passa
      // da `enabled` e non dalla ricostruzione della catena perché
      // `EffectComposer.render()` salta i pass spenti e RICALCOLA
      // `renderToScreen` da `isLastEnabledPass` a ogni frame — quindi l'uscita
      // torna a essere l'ultimo pass da sola, senza che nessuno glielo dica.
      applyAaGate(aaRef.current, composerRatio, dpr)
    }

    composer.render()
  }, 1)

  return null
}
