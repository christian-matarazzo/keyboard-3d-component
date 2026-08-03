import DebugPanel from './DebugPanel'
import AnimationEditor from './AnimationEditor'
import MeshController from './MeshController'
import ModeTuner from './ModeTuner'
import RotationTuner from './RotationTuner'
import PostFxTuner from './PostFxTuner'
import ViewSettingsTuner from './ViewSettingsTuner'
import MaterialTuner from './MaterialTuner'
import FocusTuner from './FocusTuner'
import LightGizmos from './LightGizmos'
import LightEditor from './LightEditor'
import { useComposerSection } from '../state/useComposerSection'

/**
 * IL CONFINE.
 *
 * Questo è l'unico modulo che il resto del componente importa in modo
 * DINAMICO, ed è per questo che tutto l'authoring — i pannelli Leva, l'editor
 * delle animazioni, l'editor delle mesh, i gizmo, e `leva` con le sue
 * dipendenze — finisce in un chunk separato che chi non apre l'editor non
 * scarica mai.
 *
 * ⚠️ Prima il flag `?debug` decideva soltanto se RENDERIZZARE. Gli import
 * erano statici, quindi in produzione l'utente scaricava comunque tutto:
 * quattromilasettecento righe di editor e una libreria di UI, per non vederle.
 * Adesso `?debug` decide se CARICARE, e il flag non è più il meccanismo — è
 * solo l'interruttore.
 *
 * ⚠️ DUE PUNTI DI MONTAGGIO, UN SOLO CHUNK. L'authoring vive metà nel DOM
 * (pannelli) e metà dentro il Canvas (gizmo, helper, editor mesh). Sono due
 * componenti perché l'albero è diviso, ma un solo `import()`: entrambi
 * risolvono lo stesso specificatore, quindi il bundler produce un chunk solo e
 * il secondo montaggio non paga un secondo scaricamento.
 */

/** La metà DOM: i pannelli. Montata dalla shell, fuori dal Canvas. */
export function AuthoringDom({
  store,
  poseApi,
  product,
  animations,
  onAnimationsChange,
  variantAnimations,
  onVariantAnimationsChange,
  appConfig,
  onAppConfigChange,
}) {
  return (
    <>
      <DebugPanel poseApi={poseApi} />
      <ModeTuner store={store} poseGraph={product.poseGraph} />
      <RotationTuner store={store} />
      <PostFxTuner store={store} />
      <ViewSettingsTuner store={store} apiRef={poseApi} />
      <FocusTuner store={store} groups={product.meshGroups} />
      <AnimationEditor
        poseApi={poseApi}
        store={store}
        animations={animations}
        onChange={onAnimationsChange}
        product={product}
        variantAnimations={variantAnimations}
        onVariantAnimationsChange={onVariantAnimationsChange}
        appConfig={appConfig}
        onAppConfigChange={onAppConfigChange}
      />
    </>
  )
}

/**
 * La metà 3D: ciò che deve stare dentro il Canvas perché disegna o raycasta.
 * `keyLightRef`/`spotLightRef` sono la giunzione coi due lumi renderizzati dal
 * runtime (runtime/ShadowLights.jsx): l'editor li muove senza possederli.
 * `lightEditorRef` è la stessa idea applicata al rig volumetrico — LightRig.jsx
 * lo riempie, LightEditor lo legge (vedi il blocco in testa a LightEditor.jsx).
 *
 * ⚠️ `LightEditor` usa `<Html>` di drei, quindi rende DOM pur stando dentro il
 * Canvas: è il motivo per cui vive qui e non in AuthoringDom.
 */
export function AuthoringScene({
  store,
  apiRef,
  product,
  selectedMesh,
  onSelectMesh,
  keyLightRef,
  spotLightRef,
  lightEditorRef,
}) {
  const { editMode } = useComposerSection(store, 'ui')

  return (
    <>
      <MaterialTuner store={store} product={product} />
      <MeshController
        product={product}
        selectedMesh={selectedMesh}
        onSelectMesh={onSelectMesh}
        store={store}
        editMode={editMode}
      />
      <LightGizmos
        store={store}
        keyLightRef={keyLightRef}
        spotLightRef={spotLightRef}
        active={editMode === 'lights'}
      />
      <LightEditor
        store={store}
        apiRef={apiRef}
        product={product}
        rigRef={lightEditorRef}
        editMode={editMode}
      />
    </>
  )
}
