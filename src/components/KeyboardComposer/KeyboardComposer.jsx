import { useEffect, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { Leva } from 'leva'
import styles from './KeyboardComposer.module.css'
import Scene from './Scene'
import Hud from './Hud'
import AnimationEditor from './AnimationEditor'
import { DEFAULT_MODEL_URL } from './KeyboardModel'
import { DEFAULT_MESH_GROUPS } from './materials/meshGroups'
import { DEFAULT_MESH_VARIANTS, normalizeVariantSelection } from './materials/meshVariants'
import { EMPTY_ANIMATIONS, normalizeAnimations } from './animation/animationSchema'

// Scelta delle varianti ricordata per la SESSIONE della scheda: sopravvive a un
// reload, si azzera chiudendo la scheda, che è dove riparte il default autorato.
const VARIANT_STORAGE_KEY = 'keyboardComposer.variants'

const readStoredVariants = () => {
  try {
    return JSON.parse(sessionStorage.getItem(VARIANT_STORAGE_KEY)) ?? null
  } catch {
    return null // sessionStorage può essere negato (Safari privato, iframe)
  }
}

// Pannello di tuning (luci, materiali, resa) visibile solo con `?debug`
// nell'URL: in produzione il canvas resta pulito, a tutto schermo.
const DEBUG = new URLSearchParams(window.location.search).has('debug')

// Larghezza del pannello Leva: default della libreria e limiti del resize a
// trascinamento (vedi DebugPanel). Il tool di debug ha pose con label lunghe,
// allargarlo aiuta a leggerle senza troncamenti.
const PANEL_WIDTH_DEFAULT = 280
const PANEL_WIDTH_MIN = 240
const PANEL_WIDTH_MAX = 640

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

/**
 * Pannello Leva con bordo sinistro trascinabile per allargarlo/stringerlo.
 * Il pannello è ancorato in alto a destra: trascinando l'handle verso sinistra
 * cresce. La larghezza è controllata via `theme.sizes.rootWidth` (Leva 0.10),
 * l'handle è un grip fisso allineato al bordo sinistro (offset = width + 10px
 * di margine del pannello).
 *
 * `<Leva>` va SEMPRE montato (anche fuori da `?debug`): Leva crea comunque un
 * pannello di default appena una `useControls` è in uso (LightRig, i controlli,
 * ecc.), e `hidden={!DEBUG}` è l'unico modo per nasconderlo in produzione. Solo
 * l'handle di resize è condizionato a DEBUG.
 */
function DebugPanel() {
  const [width, setWidth] = useState(PANEL_WIDTH_DEFAULT)
  const dragRef = useRef({ pointerId: null, startX: 0, startW: 0 })

  const onPointerDown = (e) => {
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startW: width }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.preventDefault()
  }
  const onPointerMove = (e) => {
    const d = dragRef.current
    if (d.pointerId !== e.pointerId) return
    // Trascinare a sinistra (clientX cala) allarga: startX - clientX > 0.
    setWidth(clamp(d.startW + (d.startX - e.clientX), PANEL_WIDTH_MIN, PANEL_WIDTH_MAX))
  }
  const onPointerUp = (e) => {
    const d = dragRef.current
    if (d.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = { pointerId: null, startX: 0, startW: 0 }
  }

  return (
    <>
      <Leva hidden={!DEBUG} collapsed theme={{ sizes: { rootWidth: `${width}px` } }} />
      {DEBUG && (
        <div
          className={styles.debugResize}
          style={{ right: `${width + 10}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="separator"
          aria-orientation="vertical"
          aria-label="Ridimensiona pannello debug"
        />
      )}
    </>
  )
}

/**
 * Vetrina 3D della tastiera a piena vista: nessun pannello di configurazione,
 * solo il modello. Trascina in verticale per il flusso front/retro a step di
 * 45°; in vista frontale trascina in orizzontale per i ±45° laterali.
 */
export default function KeyboardComposer({
  modelUrl = DEFAULT_MODEL_URL,
  // Elenco dei gruppi logici di mesh (classificazione per nome nodo, label,
  // vedi materials/meshGroups.js). Chi integra il componente con un GLB
  // dalle convenzioni di naming diverse può passare qui il proprio elenco.
  meshGroups = DEFAULT_MESH_GROUPS,
  // Insiemi di mesh alternative fra cui l'utente sceglie (layout ISO/ANSI e,
  // in futuro, altro). Stessa logica di `meshGroups`: elenco dichiarativo
  // sostituibile da chi integra il componente — vedi materials/meshVariants.js.
  meshVariants = DEFAULT_MESH_VARIANTS,
}) {
  const { progress } = useProgress()
  // Stato (non derivato al volo da `progress`): con l'asset già in cache
  // (visita successiva, mobile o desktop) `progress` può essere 100 già al
  // primissimo render, prima che il browser abbia dipinto lo stato opacity:0
  // di partenza — la transizione CSS del fade non avrebbe nulla da cui
  // animare e sparirebbe. Il giro di rAF garantisce che il primo paint
  // avvenga sempre a opacità 0, così il fade-in resta visibile in ogni caso.
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (progress !== 100) return
    const raf = requestAnimationFrame(() => setLoaded(true))
    return () => cancelAnimationFrame(raf)
  }, [progress])

  // Ponte fra gli overlay DOM (HUD, editor animazioni) e i controlli dentro il
  // Canvas: il ref viene popolato da useComposerControls con le pose/il focus
  // (`goTo`, `currentPoseKey`, `focusGroup`, `clearFocus`, `currentFocus`,
  // `isPoseSettled`, `isFocusSettled`), da AnimationDirector.jsx coi comandi
  // delle animazioni (`playAnimation`, `stopAnimation`, `currentAnimation`,
  // `animationState`, `triggerAnimation`) e da Scene.jsx con
  // `{ editMode, lockedPoseKey }` — seedato a un oggetto
  // vuoto (mai null) perché più scrittori indipendenti (alberi React diversi,
  // uno dentro <Canvas>) fanno Object.assign su di esso senza un ordine
  // garantito fra loro.
  const poseApi = useRef({})

  // Animazioni autorate. Lo stato vive QUI e non dietro un ponte imperativo
  // perché questo componente rende sia il sottoalbero del Canvas (<Scene>) sia
  // gli overlay DOM (<Hud>, <AnimationEditor>): i DATI scendono come prop
  // normali, solo i COMANDI hanno bisogno di `poseApi`.
  const [animations, setAnimations] = useState(EMPTY_ANIMATIONS)

  // Pubblicato per il salvataggio JSON globale (LightRig.jsx le legge da qui
  // insieme a __STATE_MATERIALS/__STATE_ROTATION/…).
  useEffect(() => {
    window.__STATE_ANIMATIONS = animations
  }, [animations])

  // Contropartita del salvataggio: sia "Carica JSON" sia il fetch di
  // produzione emettono questo evento (vedi LightRig.jsx).
  useEffect(() => {
    const handler = (e) => {
      if (e.detail) setAnimations(normalizeAnimations(e.detail))
    }
    window.addEventListener('app-load-animations', handler)
    return () => window.removeEventListener('app-load-animations', handler)
  }, [])

  // --- Varianti -----------------------------------------------------------
  // Precedenza: scelta di sessione → default autorato nel JSON → default
  // dichiarato nella config. Il seed legge sessionStorage una sola volta.
  const [variantSelection, setVariantSelection] = useState(() =>
    normalizeVariantSelection(readStoredVariants(), meshVariants),
  )
  // Binding variante → animazione di swap, autorato e salvato nel JSON.
  const [variantAnimations, setVariantAnimations] = useState({})

  useEffect(() => {
    try {
      sessionStorage.setItem(VARIANT_STORAGE_KEY, JSON.stringify(variantSelection))
    } catch {
      /* storage negato: la scelta resta valida per il solo tempo di vita della pagina */
    }
    // Ciò che finisce nel JSON è la selezione ATTIVA nel momento del
    // salvataggio: si sceglie il default autorandolo a video, come per tutto
    // il resto dello stato tunabile di questo componente.
    window.__STATE_VARIANTS = { selection: variantSelection, swapAnimations: variantAnimations }
  }, [variantSelection, variantAnimations])

  useEffect(() => {
    const handler = (e) => {
      if (!e.detail) return
      // Una scelta già fatta in questa sessione ha la precedenza sul default
      // che arriva dal JSON: il caricamento della configurazione non deve
      // ributtare l'utente sul layout di partenza.
      const stored = readStoredVariants()
      setVariantSelection(normalizeVariantSelection(stored ?? e.detail.selection, meshVariants))
      setVariantAnimations(e.detail.swapAnimations ?? {})
    }
    window.addEventListener('app-load-variants', handler)
    return () => window.removeEventListener('app-load-variants', handler)
  }, [meshVariants])

  // Comandi delle varianti sul ponte condiviso: li usano sia i toggle dell'HUD
  // sia l'azione `setVariant` del sequencer, che vive dentro il Canvas.
  useEffect(() => {
    Object.assign(poseApi.current, {
      currentVariants: () => variantSelection,
      variantSwapAnimation: (variantId) =>
        variantAnimations?.[variantId] ??
        meshVariants.find((v) => v.id === variantId)?.swapAnimation ??
        null,
      setVariant: (variantId, optionId) =>
        setVariantSelection((prev) =>
          prev[variantId] === optionId ? prev : { ...prev, [variantId]: optionId },
        ),
    })
  }, [variantSelection, variantAnimations, meshVariants])

  return (
    <section className={styles.section}>
      <DebugPanel />
      <div
        className={`${styles.canvasWrap} ${loaded ? styles.canvasWrapLoaded : ''}`}
      >
        <Scene
          modelUrl={modelUrl}
          apiRef={poseApi}
          meshGroups={meshGroups}
          animations={animations}
          meshVariants={meshVariants}
          variantSelection={variantSelection}
        />
        <Hud
          poseApi={poseApi}
          meshGroups={meshGroups}
          animations={animations}
          meshVariants={meshVariants}
          variantSelection={variantSelection}
        />
        <AnimationEditor
          poseApi={poseApi}
          animations={animations}
          onChange={setAnimations}
          meshGroups={meshGroups}
          modelUrl={modelUrl}
          meshVariants={meshVariants}
          variantAnimations={variantAnimations}
          onVariantAnimationsChange={setVariantAnimations}
        />
      </div>
    </section>
  )
}
