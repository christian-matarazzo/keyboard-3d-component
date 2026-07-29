import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { DRACO_PATH } from './KeyboardModel'
import { collectMeshList, DEFAULT_MESH_GROUPS } from './materials/meshGroups'
import { DEFAULT_MESH_VARIANTS } from './materials/meshVariants'
import { createAnimationRuntime } from './animation/animationRuntime'
import { createOpacityRegistry } from './animation/opacityRegistry'
import { createPivotRegistry } from './animation/pivotRegistry'

const DEBUG = new URLSearchParams(window.location.search).has('debug')

/**
 * Esecutore delle animazioni autorate. Vive DENTRO il Canvas (fratello di
 * KeyboardModel/LightRig/MeshController sotto Scene.jsx), non rende nulla, e
 * possiede l'unico `useFrame` che fa girare il sequencer.
 *
 * Carica il GLB in proprio (`useGLTF`, stessa cache drei degli altri: nessun
 * fetch aggiuntivo) perché i selettori e i registry lavorano sull'albero reale
 * — letteralmente lo stesso in cui MeshController scrive le sue trasformate.
 *
 * ⚠️ Nessuna `priority` sul useFrame: una priority > 0 disattiva il render loop
 * automatico di R3F. L'ordine rispetto al useFrame di useComposerControls è
 * comunque irrilevante, perché il runtime aggiorna tutto prima di valutare
 * l'avanzamento e non valuta mai un passo nello stesso tick in cui lo avvia
 * (vedi animationRuntime.js).
 *
 * La lista `animations` arriva come PROP e viene specchiata in una ref: così i
 * tasti premuti nell'editor ri-renderizzano un componente che ritorna `null`, e
 * `playAnimation(id)` gioca sempre lo stato CORRENTE dell'editor — non serve
 * un'API separata di "anteprima non salvata".
 */
export default function AnimationDirector({
  modelUrl,
  apiRef,
  animations,
  editMode = 'none',
  meshGroups = DEFAULT_MESH_GROUPS,
  meshVariants = DEFAULT_MESH_VARIANTS,
}) {
  const { scene } = useGLTF(modelUrl, DRACO_PATH)

  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const animationsRef = useRef(animations)
  animationsRef.current = animations
  const groupsRef = useRef(meshGroups)
  groupsRef.current = meshGroups
  const variantsRef = useRef(meshVariants)
  variantsRef.current = meshVariants

  // Runtime + registry creati UNA volta sola: sono stato mutabile per-frame,
  // non stato React. Il ctx legge tutto da ref, quindi non invecchia mai.
  const runtimeRef = useRef(null)
  if (!runtimeRef.current) {
    const getScene = () => sceneRef.current
    const ctx = {
      getApi: () => apiRef?.current,
      getScene,
      getAnimations: () => animationsRef.current,
      get groups() {
        return groupsRef.current
      },
      get variants() {
        return variantsRef.current
      },
      opacity: createOpacityRegistry(getScene),
      pivots: createPivotRegistry(getScene),
      debug: DEBUG,
    }
    const runtime = createAnimationRuntime(ctx)
    // Riferimento circolare voluto: `waitTrigger` interroga il runtime stesso.
    ctx.runtime = runtime
    runtimeRef.current = { runtime, ctx }
  }

  useFrame((_, delta) => {
    runtimeRef.current.runtime.tick(delta)
  })

  // API imperativa, ripiegata sullo STESSO apiRef di tutto il resto
  // (Object.assign, mai riassegnazione: più scrittori indipendenti scrivono su
  // quell'oggetto senza un ordine di commit garantito fra loro).
  useEffect(() => {
    if (!apiRef) return
    const { runtime } = runtimeRef.current
    Object.assign(apiRef.current, {
      playAnimation: (id, opts) => runtime.play(id, opts),
      stopAnimation: () => runtime.stop(),
      currentAnimation: () => runtime.currentId(),
      animationState: () => runtime.getState(),
      triggerAnimation: (name) => runtime.trigger(name),
      // Catalogo delle mesh per il selettore dell'editor, che vive nel DOM
      // fuori dal Canvas e non ha accesso alla scena. Espone il NOME del nodo
      // (ciò che i selettori salvano) accanto alla label dedup di
      // collectMeshList, che è solo per l'occhio — vedi selectors.js sul
      // perché gli uuid non sono persistibili.
      meshCatalog: () =>
        collectMeshList(sceneRef.current, groupsRef.current).map((m) => ({
          name: m.mesh.name,
          label: m.label,
        })),
    })
    return () => {
      delete apiRef.current.playAnimation
      delete apiRef.current.stopAnimation
      delete apiRef.current.currentAnimation
      delete apiRef.current.animationState
      delete apiRef.current.triggerAnimation
      delete apiRef.current.meshCatalog
    }
  }, [apiRef])

  // L'editor mesh riparenta le stesse mesh dei pivot di animazione: i due non
  // possono essere vivi insieme. Entrando in Mesh si smonta l'animazione.
  useEffect(() => {
    if (editMode === 'meshes') runtimeRef.current.runtime.stop()
  }, [editMode])

  // Rete di sicurezza allo smontaggio: nessun materiale clonato e nessun pivot
  // deve sopravvivere al componente.
  useEffect(() => {
    const { runtime, ctx } = runtimeRef.current
    return () => {
      runtime.stop()
      ctx.opacity.releaseAll()
      ctx.pivots.releaseAll()
    }
  }, [])

  // Console di debug: è l'unico modo di pilotare il sequencer finché l'editor
  // non è a video, e resta il modo più rapido per verificarlo. Stesso idioma di
  // window.__focusGroup/__clearFocus in useComposerControls.js.
  useEffect(() => {
    if (!DEBUG) return
    const { runtime, ctx } = runtimeRef.current
    window.__playAnimation = (id, opts) => runtime.play(id, opts)
    window.__stopAnimation = () => runtime.stop()
    window.__animTrigger = (name) => runtime.trigger(name)
    window.__animState = () => runtime.getState()
    window.__animStats = () => ({ ...ctx.opacity.stats(), ...ctx.pivots.stats() })
    return () => {
      delete window.__playAnimation
      delete window.__stopAnimation
      delete window.__animTrigger
      delete window.__animState
      delete window.__animStats
    }
  }, [])

  return null
}
