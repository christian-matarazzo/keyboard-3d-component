import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'

/**
 * Congela le shadow map delle due luci-ombra, e le rigenera solo quando
 * qualcosa le ha davvero invalidate.
 *
 * ## Perché si può
 *
 * Una shadow map dipende da DUE cose: la luce e la geometria. Non dalla camera.
 * In questa scena la camera orbita di continuo (molla della posa, dolly del
 * focus) ma **il modello non ruota mai** — è la camera a girargli attorno, vedi
 * useComposerControls.js — e la key light è ferma su una posizione autorata.
 * Cioè: three ridisegna 264 draw call per frame per ottenere, frame dopo frame,
 * ESATTAMENTE la stessa texture.
 *
 * `shadow.autoUpdate = false` la disegna una volta; `shadow.needsUpdate = true`
 * la fa ridisegnare al prossimo render e poi three rimette il flag a false da
 * sé. Restituisce 264 draw call per frame senza cambiare di un pixel
 * l'immagine a riposo, ed è il budget con cui si paga tutto il
 * post-processing.
 *
 * ## Che cosa la invalida davvero
 *
 * Quattro sorgenti, e la scelta è di essere GENEROSI: rigenerare di troppo
 * costa quanto costava prima (cioè quanto oggi), rigenerare di meno lascia in
 * scena un'ombra che non corrisponde più al modello — un difetto silenzioso e
 * bruttissimo da diagnosticare, perché tutto il resto si muove correttamente.
 *
 *  1. **Un'animazione in corso.** Non solo perché muove la camera (quella non
 *     conta), ma perché `transformOffset` e `spinGroup` spostano GEOMETRIA e
 *     `setOpacity` cambia che cosa proietta ombra. Finché gira si rigenera ogni
 *     frame, esattamente come prima: durante un'animazione non si guadagna
 *     nulla, e va bene così — è a riposo che si guadagna tutto.
 *  2. **L'editor mesh** (`editMode === 'meshes'`): i gizmo spostano mesh a mano.
 *     È authoring, il costo è irrilevante, quindi si rigenera sempre invece di
 *     rincorrere gli eventi del gizmo.
 *  3. **Le manopole delle due luci**, via `store.subscribe`: spostare la key
 *     light è l'unico modo in cui la mappa cambia senza che si muova nulla in
 *     scena.
 *  4. **Il cambio di variante**, che accende e spegne mesh (VariantController
 *     chiama `invalidateShadows` dal ponte).
 *
 * ⚠️ Il budget è in FRAME, non booleano, e nemmeno questo è un dettaglio: la
 * mappa si ridisegna al prossimo `gl.render`, e chi invalida (un effetto React,
 * un ascoltatore dello store) non ha un ordine garantito rispetto al useFrame
 * di questo componente. Un solo frame di margine e un'invalidazione arrivata
 * "tardi" nel frame verrebbe consumata a vuoto.
 */

/** Frame di rigenerazione concessi a ogni invalidazione. Vedi sopra: 1 non basta. */
const INVALIDATE_FRAMES = 2

/**
 * Frame di rigenerazione al montaggio e a ogni cambio di dimensione del
 * modello. Sono generosi di proposito: qui cadono il fit automatico di
 * KeyboardModel, l'applicazione dei materiali autorati e la prima passata del
 * rig, tutti asincroni fra loro.
 */
const WARMUP_FRAMES = 8

export default function ShadowFreeze({
  store,
  apiRef,
  // Gli STESSI ref che Scene.jsx passa a LightRig (e quindi a ShadowLights) e
  // ai gizmo di authoring: qui non si possiede nessuna luce, si legge soltanto
  // quella che qualcun altro rende. Stessa giunzione descritta in
  // runtime/ShadowLights.jsx.
  keyLightRef,
  spotLightRef,
  // Il modello ha finito di misurarsi: la geometria a video è cambiata.
  modelSize,
  editMode = 'none',
}) {
  const pendingRef = useRef(WARMUP_FRAMES)
  const invalidate = (frames = INVALIDATE_FRAMES) => {
    pendingRef.current = Math.max(pendingRef.current, frames)
  }
  // La closure di `invalidate` è stabile (legge solo una ref), ma la si passa a
  // effetti con dipendenze diverse: una ref evita di rimontarli.
  const invalidateRef = useRef(invalidate)
  invalidateRef.current = invalidate

  // (3) Le manopole delle luci-ombra, più i materiali. Sottoscrizione e non
  // prop: queste sezioni cambiano anche quando arriva il JSON di produzione,
  // cioè DOPO il montaggio e potenzialmente dopo il budget di warm-up, e un
  // componente che rende `null` non ha ragione di ri-renderizzare per questo.
  //
  // `materials` oggi muove solo colore/rugosità/clearcoat, che nella shadow map
  // (che è profondità) non entrano. È qui lo stesso perché il GLB testurato in
  // arrivo può portare `alphaMap` e trasparenza, e quelli sì che cambiano ciò
  // che proietta ombra: costa una sottoscrizione e chiude la classe invece del
  // caso singolo.
  useEffect(() => {
    if (!store) return
    const bump = () => invalidateRef.current(INVALIDATE_FRAMES)
    const offs = ['keylight', 'spotlight', 'materials'].map((s) => store.subscribe(s, bump))
    return () => offs.forEach((off) => off())
  }, [store])

  // La geometria si è ri-misurata (fit iniziale, cambio di prodotto).
  useEffect(() => {
    invalidateRef.current(WARMUP_FRAMES)
  }, [modelSize])

  // (4) Il ponte imperativo, per chi cambia la scena da fuori di qui:
  // VariantController oggi, e chiunque altro spenga o sposti mesh domani.
  useEffect(() => {
    if (!apiRef) return
    Object.assign(apiRef.current, {
      invalidateShadows: (frames) => invalidateRef.current(frames),
    })
    return () => {
      delete apiRef.current.invalidateShadows
    }
  }, [apiRef])

  useFrame(() => {
    const api = apiRef?.current
    // (1) e (2). `animationState()` è la stessa sonda che l'HUD interroga.
    //
    // ⚠️ Il campo è `state`, non un booleano, e `'idle'` è l'UNICO valore che
    // significa "ferma". In particolare `'releasing'` va incluso: il rientro di
    // uscita riporta indietro le mesh traslate (`releaseTransforms`), quindi la
    // geometria si muove ancora eccome mentre nessuna sequenza sta girando.
    const animState = api?.animationState?.()?.state ?? 'idle'
    if (editMode === 'meshes' || animState !== 'idle') {
      pendingRef.current = Math.max(pendingRef.current, INVALIDATE_FRAMES)
    }

    const spend = pendingRef.current > 0
    for (const ref of [keyLightRef, spotLightRef]) {
      const light = ref?.current
      if (!light?.shadow) continue
      // Il congelamento si applica qui e non in un effetto perché la luce può
      // essere montata/smontata dalla sua manopola `enabled`: al rimontaggio
      // three riparte con `autoUpdate = true` e una sola passata di effetto se
      // lo perderebbe.
      if (light.shadow.autoUpdate) light.shadow.autoUpdate = false
      if (spend) light.shadow.needsUpdate = true
    }
    if (spend) pendingRef.current -= 1
  })

  return null
}
