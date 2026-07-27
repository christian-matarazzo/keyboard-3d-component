import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { useControls } from 'leva'
import { easing } from 'maath'
import { collectSlotMeshes, applyFinish } from './materials/applyFinish'
import { useComposerControls } from './useComposerControls'
import { ENTRY_LANDSCAPE, ENTRY_PORTRAIT } from './poseGraph'

export const DRACO_PATH = '/draco/'
export const DEFAULT_MODEL_URL = '/models/keyboard.glb'

// Selezione mesh (gizmo di trasformazione, MeshController.jsx) è uno
// strumento di authoring: attivo solo con ?debug E in editMode === 'meshes'
// (vedi Scene.jsx) — condivide il canvas con l'editor luci di LightRig.jsx,
// che raycasta indipendentemente sui suoi helper, quindi le due modalità
// devono essere mutuamente esclusive o i click si sovrappongono.
const DEBUG = new URLSearchParams(window.location.search).has('debug')

// Larghezza finale del modello in unità scena, indipendente dalle unità
// del file sorgente (l'OBJ è in centimetri).
const TARGET_WIDTH = 3.2

// Peso FISSO per slot (design, non tuning): quanto ogni strato logico si
// allontana dalla base nell'esploso, in unità di "distanza" (Leva sotto).
// Landing (piedini/rialzo, il più in basso nel montaggio reale) resta a 0
// come riferimento; gli altri salgono in proporzione alla loro posizione
// nello stack fisico (damping → body → keycaps). Tutti NON-NEGATIVI, stessa
// direzione: un'esplosione "a strati" più prevedibile di far salire alcuni
// pezzi e scendere altri (che rischierebbe di far uscire i piedini dal fit
// di inquadratura calcolato sul modello assemblato).
const EXPLODE_LAYER = { landing: 0, damping: 0.3, body: 0.65, keycaps: 1 }

export function KeyboardModel({ url = DEFAULT_MODEL_URL, finish, apiRef, explodeApiRef, onSizeComputed, onSelectMesh, controlsDisabled, editMode = 'none' }) {
  const groupRef = useRef()
  const { scene } = useGLTF(url, DRACO_PATH)

  // Auto-fit: centra il modello e lo scala a TARGET_WIDTH, così camera e
  // ombre funzionano qualunque siano le unità dell'asset. `nativeSize` è la
  // dimensione PRE-scala (unità native del GLB): è il riferimento corretto
  // per l'offset dei gruppi dell'esploso qui sotto, perché quei gruppi
  // vivono nello stesso frame in cui questo Box3 è stato calcolato (root di
  // `scene`, identity transform) — mai `finalSize` (post-scala, 30-60x più
  // piccola: offset visivamente impercettibile).
  const { scale, offset, finalSize, nativeSize } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const s = TARGET_WIDTH / Math.max(size.x, size.z, 1e-6)
    return { scale: s, offset: center.multiplyScalar(-1), finalSize: size.clone().multiplyScalar(s), nativeSize: size }
  }, [scene])

  // Comunica al LightRig (volumetrico) la bounding box finale del modello, da
  // cui deriva la griglia di luci e le rectAreaLight per faccia.
  useEffect(() => {
    if (onSizeComputed && finalSize) onSizeComputed(finalSize)
  }, [finalSize, onSizeComputed])

  const slotMeshes = useMemo(() => collectSlotMeshes(scene), [scene])

  useEffect(() => {
    if (finish) applyFinish(slotMeshes, finish)
  }, [slotMeshes, finish])

  // --- Vista esplosa ------------------------------------------------------
  // Un gruppo per slot, aggiunto come figlio DIRETTO di `scene` (transform
  // identity, stesso frame di `nativeSize` sopra) e riempito via
  // Object3D.attach(): ricalcola la trasformata locale di ogni mesh per
  // preservarne la posa mondiale, quindi funziona indipendentemente da
  // quanto sia profonda/ruotata la gerarchia nativa del GLB sotto quella
  // mesh (stesso meccanismo, stessa precondizione — solo scale uniforme
  // nella catena — già usato/documentato in MeshController.jsx per il pivot
  // dell'editor mesh). L'esploso anima solo `group.position.y`: le singole
  // mesh non vengono più toccate frame per frame.
  const explodeGroupsRef = useRef({})

  useEffect(() => {
    const groups = explodeGroupsRef.current
    for (const slot of Object.keys(EXPLODE_LAYER)) {
      const name = `__explodeGroup_${slot}`
      let group = scene.getObjectByName(name)
      if (!group) {
        group = new THREE.Group()
        group.name = name
        scene.add(group)
      }
      groups[slot] = group
    }
    for (const [slot, meshes] of Object.entries(slotMeshes)) {
      const group = groups[slot]
      if (!group) continue
      for (const mesh of meshes) {
        // Non rubare una mesh che MeshController.jsx (?debug, editMode
        // 'meshes') sta editando sotto il suo pivot temporaneo: tornerà qui
        // da sola a fine editing (il suo cleanup fa parent.attach(mesh), e
        // "parent" è già questo gruppo, catturato prima della creazione del
        // pivot). Idempotente: un secondo mount sulla stessa `scene` cache
        // (StrictMode dev) trova gruppi/parent già corretti e non fa nulla.
        if (mesh.parent?.name === '__meshEditorPivot') continue
        if (mesh.parent !== group) group.attach(mesh)
      }
    }
  }, [scene, slotMeshes])

  // Parametri regolabili dal pannello (?debug): i default sono i valori di
  // produzione. Solo distanza/durata sono "feel" tunabile — i pesi per slot
  // (EXPLODE_LAYER) sono una scelta di design, non tuning.
  const [explodeCtrl] = useControls('Vista esplosa', () => ({
    distanza: { value: 0.5, min: 0, max: 1.5, step: 0.05, label: 'Distanza' },
    durata: { value: 0.35, min: 0.1, max: 1, step: 0.05, label: 'Durata transizione' },
  }), { collapsed: true })

  const explodedRef = useRef(false) // stato committed (toggle)
  const explodeProgress = useRef(0) // 0..1 animato, smorzato verso il target

  useFrame((_, delta) => {
    easing.damp(explodeProgress, 'current', explodedRef.current ? 1 : 0, explodeCtrl.durata, delta)
    const p = explodeProgress.current
    for (const [slot, layer] of Object.entries(EXPLODE_LAYER)) {
      const group = explodeGroupsRef.current[slot]
      if (group) group.position.y = p * layer * explodeCtrl.distanza * nativeSize.y
    }
  })

  // API imperativa per l'HUD (DOM, fuori dal Canvas): ref DEDICATO,
  // indipendente da apiRef/useComposerControls (pose/camera) e popolato/
  // ripulito da un solo effetto di questo componente — nessuna assunzione
  // di ordine fra effetti di hook diversi.
  useEffect(() => {
    if (!explodeApiRef) return
    explodeApiRef.current = {
      toggle() { explodedRef.current = !explodedRef.current },
      isExploded() { return explodedRef.current },
    }
    return () => {
      explodeApiRef.current = null
    }
  }, [explodeApiRef])

  const portrait = useThree((s) => s.size.width < s.size.height)

  // Posa d'ingresso: su desktop il corner "initial position" del cliente
  // (pitch 35.264° + yaw 45°, stop ViewCube — vedi poseGraph.js). Su mobile
  // portrait la vista verticale (faccia tasti alla camera, asse lungo
  // verticale, manopole in alto) resta pitch 90° + yaw 90° (Rx·Ry, ordine
  // 'XYZ'). Niente roll su wrapper esterno: così il pitch resta sull'asse
  // orizzontale dello schermo e lo swipe verticale trascina il modello
  // seguendo il dito, identico al desktop.
  useComposerControls(groupRef, {
    initialRotation: portrait
      ? { x: ENTRY_PORTRAIT.x, y: ENTRY_PORTRAIT.y }
      : { x: ENTRY_LANDSCAPE.x, y: ENTRY_LANDSCAPE.y },
    apiRef, // esposto alla pulsantiera delle viste, che sta fuori dal Canvas
    disabled: controlsDisabled
  })

  return (
    <group>
      <group ref={groupRef}>
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
      </group>
    </group>
  )
}

/** Da chiamare il prima possibile nel sito host per anticipare il fetch. */
export function preloadKeyboardModel(url = DEFAULT_MODEL_URL) {
  useGLTF.preload(url, DRACO_PATH)
}
