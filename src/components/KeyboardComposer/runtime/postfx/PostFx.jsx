import { useEffect, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { useComposerSection } from '../../state/useComposerSection'
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
 * `GTAOPass`/`SMAAPass`) sono già dentro `three` sotto `examples/jsm/`. Non
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
 * ⚠️ Questo NON risolve l'aliasing dominante di questa scena, che è
 * *speculare* (highlight sub-pixel sui bordi arrotondati dei keycap, con
 * clearcoat e ~34 luci) e non di copertura. L'MSAA moltiplica i campioni di
 * copertura, non le valutazioni di shading: lo lascia dov'è. Serve
 * accumulazione temporale, ed è un passo successivo — questo qui è
 * l'infrastruttura su cui appoggiarla.
 */

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
const createTarget = (width, height, samples) => {
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
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
  // duplica). Oggi i passaggi che scambiano sono due, quindi il giro torna al
  // punto di partenza e un riferimento fisso funzionerebbe per caso; aggiungere
  // un terzo pass (SMAA) lo romperebbe a frame alterni, e il sintomo sarebbe
  // un'AO che sfarfalla — non un errore.
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
  const { msaaSamples, pixelRatioCap, aoEnabled, aoResolutionScale } = settings

  const composerRef = useRef(null)
  const aoRef = useRef(null)

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
    const ratio = Math.min(dpr, pixelRatioCap)
    const width = Math.max(1, Math.floor(size.width * ratio))
    const height = Math.max(1, Math.floor(size.height * ratio))

    const composer = new EffectComposer(gl, createTarget(width, height, msaaSamples))
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
    // di CLAUDE.md prescrive — scena lineare → AO → tone map → (SMAA per ultima,
    // che invece vuole ingresso in sRGB).
    let ao = null
    if (aoEnabled) {
      ao = createAoPass(scene, camera, width, height, settings)
      composer.addPass(ao)
    }
    aoRef.current = ao

    // Ultimo della catena: tone mapping + conversione di spazio colore.
    composer.addPass(new OutputPass())

    composerRef.current = composer
    return () => {
      composerRef.current = null
      aoRef.current = null
      composer.dispose()
    }
    // `size` volutamente fuori: il ridimensionamento è l'effetto qui sotto, che
    // non rialloca. Ricostruire la catena a ogni pixel di resize è la
    // microfreeze descritta in CLAUDE.md.
    // `size` volutamente fuori (vedi sopra), e con lui tutte le manopole dell'AO
    // TRANNE le due che cambiano la STRUTTURA della catena: `aoEnabled` (un pass
    // in più o in meno) e `aoResolutionScale` (la dimensione dei suoi target).
    // Le altre sono uniform e si applicano a caldo, nell'effetto qui sotto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, msaaSamples, pixelRatioCap, aoEnabled, aoResolutionScale])

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

  // Ridimensionamento, con antirimbalzo. `setSize` rialloca i due buffer del
  // composer: farlo a ogni evento di resize trasforma il trascinamento del
  // bordo della finestra in una serie di microfreeze. Nell'intervallo
  // l'immagine resta scalata, che è il compromesso normale.
  useEffect(() => {
    const id = setTimeout(() => {
      const composer = composerRef.current
      if (!composer) return
      composer.setPixelRatio(Math.min(dpr, pixelRatioCap))
      composer.setSize(size.width, size.height)
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
  useFrame(() => {
    composerRef.current?.render()
  }, 1)

  return null
}
