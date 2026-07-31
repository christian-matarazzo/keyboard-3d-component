import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { prepareGroupMaterials } from './materials/groupMaterials'
import {
  collectGroupMaterials,
  programSignature,
  warmTransparentPrograms,
} from './materials/warmupTransparency'
import { useComposerControls } from './useComposerControls'
import { ARRAY_MODEL_L } from './products/arrayModelL'

export const DRACO_PATH = '/draco/'
// Compatibilità: il GLB del primo prodotto. Il percorso vero arriva sempre da
// `product.modelUrl` (vedi products/), questa costante resta solo perché è
// esportata e usata come default da chi non passa nulla (Hud.jsx, preload).
export const DEFAULT_MODEL_URL = ARRAY_MODEL_L.modelUrl

// Selezione mesh/gruppo (gizmo di trasformazione, MeshController.jsx) è uno
// strumento di authoring: attivo solo con ?debug E in editMode === 'meshes'
// (vedi Scene.jsx) — condivide il canvas con l'editor luci di LightRig.jsx,
// che raycasta indipendentemente sui suoi helper, quindi le due modalità
// devono essere mutuamente esclusive o i click si sovrappongono.
const DEBUG = new URLSearchParams(window.location.search).has('debug')

// Larghezza finale del modello in unità scena, indipendente dalle unità
// del file sorgente (l'OBJ è in centimetri).
const TARGET_WIDTH = 3.2

export function KeyboardModel({ product, apiRef, onSizeComputed, onSelectMesh, controlsDisabled, editMode = 'none', homePoseKey = null, appMode = 'idle', focusOverrides = null }) {
  const { modelUrl, meshGroups, poseGraph } = product
  const { scene } = useGLTF(modelUrl, DRACO_PATH)

  // Auto-fit: centra il modello e lo scala a TARGET_WIDTH, così camera e
  // ombre funzionano qualunque siano le unità dell'asset.
  const { scale, offset, finalSize } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const s = TARGET_WIDTH / Math.max(size.x, size.z, 1e-6)
    return { scale: s, offset: center.multiplyScalar(-1), finalSize: size.clone().multiplyScalar(s) }
  }, [scene])

  // Comunica al LightRig (volumetrico) la bounding box finale del modello, da
  // cui deriva la griglia di luci e le rectAreaLight per faccia.
  useEffect(() => {
    if (onSizeComputed && finalSize) onSizeComputed(finalSize)
  }, [finalSize, onSizeComputed])

  // Scopre/clona i materiali reali del GLB per gruppo (vedi
  // materials/groupMaterials.js) — idempotente: Scene.jsx's MaterialTuner fa
  // la stessa chiamata sulla stessa `scene` condivisa per pescare i valori
  // da esporre in Leva, senza assunzioni sull'ordine di montaggio reciproco.
  useEffect(() => {
    prepareGroupMaterials(scene, meshGroups)
  }, [scene, meshGroups])

  const portrait = useThree((s) => s.size.width < s.size.height)
  const gl = useThree((s) => s.gl)
  const rootScene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  // Precompila le varianti TRASPARENTI degli shader dei materiali di gruppo,
  // così la prima animazione con una dissolvenza non paga una compilazione di
  // shader (misurata: 192 ms di main thread) in mezzo al movimento di camera.
  // Il meccanismo sta in materials/warmupTransparency.js — in breve:
  // `transparent` è un bit della chiave di cache del programma, non uno stato
  // del renderer. Non è gated da DEBUG: lo scatto si vedeva in produzione per
  // primo.
  //
  // ⚠️ Non è un one-shot al mount, e la prima versione che lo era NON
  // funzionava: i valori dei materiali arrivano dopo, col JSON di produzione,
  // e fra questi c'è `clearcoat`, che è a sua volta un define. Si osserva
  // quindi la FIRMA di ciò che entra nella chiave di cache e si riscalda
  // quando cambia — vale per il fetch di produzione, per "Carica JSON", per
  // gli slider Leva e per le texture che arriveranno.
  //
  // Il giro di conferma (`sig !== pendingRef`) è un antirimbalzo: trascinando
  // uno slider Leva attraverso lo zero di `clearcoat` la firma sfarfalla, e
  // senza si ricompilerebbe a ogni valore intermedio. Costa un tick di ritardo
  // sul primo warm-up, che cade comunque dentro la dissolvenza d'ingresso.
  const warmRef = useRef({ warmed: null, pending: null })
  useEffect(() => {
    warmRef.current = { warmed: null, pending: null }
    const check = () => {
      const { materials, hidden } = collectGroupMaterials(scene)
      if (!materials.length) return
      const sig = programSignature(materials)
      const st = warmRef.current
      if (sig === st.warmed) return (st.pending = null)
      if (sig !== st.pending) return (st.pending = sig)
      st.warmed = sig
      st.pending = null
      warmTransparentPrograms({
        gl,
        scene: rootScene, // la scena R3F, non quella del GLTF: servono le luci
        camera,
        materials,
        hidden,
      })
    }
    const id = setInterval(check, 400)
    return () => clearInterval(id)
  }, [scene, gl, rootScene, camera])

  // Posa d'ingresso: su desktop è la POSA HOME autorata in ?debug e salvata
  // nel JSON (di default l'ingresso landscape dichiarato dal prodotto — per
  // ARRAY_MODEL_L il corner "initial position" del cliente, pitch 35.264° +
  // yaw 45°, stop ViewCube). Su mobile portrait vale invece l'ingresso
  // portrait del prodotto (per ARRAY_MODEL_L: pitch 90° + yaw 90°, faccia
  // tasti alla camera, asse lungo verticale): il fit su schermo alto è la
  // ragione per cui quell'ingresso è una scelta di layout, non una posa di
  // prodotto, quindi la home NON lo sostituisce.
  // Niente roll su wrapper esterno: così il pitch resta sull'asse orizzontale
  // dello schermo e lo swipe verticale trascina il modello seguendo il dito,
  // identico al desktop.
  const homeCoord = poseGraph.poses[homePoseKey] ?? null
  useComposerControls({
    initialRotation: portrait
      ? { x: poseGraph.entryPortrait.x, y: poseGraph.entryPortrait.y }
      : homeCoord
        ? { x: homeCoord.pitch, y: homeCoord.yaw }
        : { x: poseGraph.entryLandscape.x, y: poseGraph.entryLandscape.y },
    apiRef, // esposto alla pulsantiera delle viste, che sta fuori dal Canvas
    disabled: controlsDisabled,
    editMode,
    homePoseKey,
    scene, // per il fit dinamico in Luci sulla posa bloccata (vedi useComposerControls.js)
    // Navigazione: il grafo del prodotto attivo (pose, adiacenza, offset
    // portrait) — era importato staticamente, ora scende da qui.
    poseGraph,
    // Zoom sui gruppi: `meshGroups` classifica le mesh da misurare,
    // `focusOverrides` porta le inquadrature autorate (Scene.jsx/FocusTuner).
    meshGroups,
    focusOverrides,
  })

  // `initialRotation` viene letta una sola volta (finché la posa non è
  // "initialized", vedi useComposerControls.js): una home che cambia DOPO —
  // lo slider Leva in ?debug, o il JSON di produzione, che arriva via fetch
  // asincrono a modello già montato — non muoverebbe nulla. Qui la si segue
  // con un goTo, cioè con la stessa molla di tutto il resto.
  //  - solo in idle: in config_mode/durante un'animazione ci sono già altri
  //    scrittori sui target della camera;
  //  - mai in portrait: lì l'ingresso è una scelta di fit (vedi sopra), non la
  //    home, e uno snap a caricamento finito sarebbe uno strappo;
  //  - mai al mount: il primo valore è già dentro `initialRotation`.
  const appliedHomeRef = useRef(homePoseKey)
  useEffect(() => {
    if (homePoseKey === appliedHomeRef.current) return
    appliedHomeRef.current = homePoseKey
    if (portrait || appMode !== 'idle') return
    apiRef?.current?.goTo?.(homePoseKey)
  }, [homePoseKey, portrait, appMode, apiRef])

  // Un solo <group>, quello della scala: la camera orbita da sola, quindi non
  // serve alcun wrapper da ruotare (i due <group> esterni che c'erano qui —
  // uno vuoto, uno con il solo ref passato all'hook — erano a trasformata
  // identità e non venivano letti da nessuno).
  return (
    <group scale={scale}>
      <primitive
        object={scene}
        position={offset}
        // INTERCETTAMENTO CLICK (solo ?debug, modalità Mesh):
        onPointerDown={(e) => {
          if (!DEBUG || editMode !== 'meshes') return
          // Previene che il click si propaghi ad altre mesh sottostanti
          e.stopPropagation()
          if (onSelectMesh) onSelectMesh(e.object)
        }}
      />
    </group>
  )
}

/**
 * Da chiamare il prima possibile nel sito host per anticipare il fetch.
 * Accetta l'URL di un GLB o direttamente un prodotto (`products/`).
 */
export function preloadKeyboardModel(source = DEFAULT_MODEL_URL) {
  useGLTF.preload(typeof source === 'string' ? source : source.modelUrl, DRACO_PATH)
}
