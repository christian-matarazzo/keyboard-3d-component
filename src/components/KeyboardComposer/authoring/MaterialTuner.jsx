import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { getDracoPath } from '../KeyboardModel'
import { prepareGroupMaterials } from '../materials/groupMaterials'
import { DEFAULT_MATERIAL } from '../state/defaults'
import { renderInMode, useLevaSection } from './useLevaSection'

/**
 * Ritocco live del materiale di un gruppo (pannello ?debug).
 *
 * ⚠️ I default vengono letti dal materiale REALE già presente sul GLB (autorato
 * in Maya/DCC), non da un preset "finish" scritto a mano — vedi
 * materials/groupMaterials.js per il perché. DEFAULT_MATERIAL interviene solo
 * quando il gruppo non ha mesh da cui leggere.
 *
 * Il seed dal GLB resta di competenza dell'AUTHORING, e non è una sfumatura:
 * serve a dare un fondo agli slider, non a decidere la resa. Il runtime
 * (runtime/MaterialApplier.jsx) applica solo ciò che è autorato per davvero, e
 * lascia stare il resto.
 *
 * Componente per-gruppo, non un loop di `useControls` dentro il padre: mappare
 * un array di lunghezza variabile su una CHIAMATA DI HOOK dentro un ciclo
 * violerebbe le Rules of Hooks; mappare l'array su un COMPONENTE per iterazione
 * (ognuno con la propria istanza React, quindi la propria singola chiamata
 * fissa) è invece il pattern sicuro.
 */
function MaterialGroupTuner({ store, group, materials }) {
  const seed = materials[0] ?? null

  useLevaSection(
    store,
    'materials',
    {
      color: { value: seed ? `#${seed.color.getHexString()}` : DEFAULT_MATERIAL.color },
      roughness: { value: seed?.roughness ?? DEFAULT_MATERIAL.roughness, min: 0, max: 1 },
      metalness: { value: seed?.metalness ?? DEFAULT_MATERIAL.metalness, min: 0, max: 1 },
      envMapIntensity: { value: seed?.envMapIntensity ?? DEFAULT_MATERIAL.envMapIntensity, min: 0, max: 2 },
      clearcoat: { value: seed?.clearcoat ?? DEFAULT_MATERIAL.clearcoat, min: 0, max: 1 },
      clearcoatRoughness: { value: seed?.clearcoatRoughness ?? DEFAULT_MATERIAL.clearcoatRoughness, min: 0, max: 1 },
    },
    // Modalità "Resa" insieme a rotazione e post-processing: vedi ModeTuner.jsx.
    // ⚠️ Questo componente vive DENTRO il Canvas (AuthoringScene) mentre il
    // selettore di modalità sta nel DOM (AuthoringDom): funziona lo stesso
    // perché `renderInMode` interroga lo store di Leva, che è globale e non
    // segue l'albero React — è la stessa ragione per cui `useControls` si può
    // chiamare da dentro il reconciler di R3F.
    {
      folder: `Materiale · ${group.label.toLowerCase()}`,
      groupId: group.id,
      render: renderInMode('render'),
    },
  )

  return null
}

/** Un folder Leva per gruppo di mesh, dall'elenco del prodotto attivo. */
export default function MaterialTuner({ store, modelUrl, groups }) {
  const { scene } = useGLTF(modelUrl, getDracoPath())
  const materialsByGroup = useMemo(() => prepareGroupMaterials(scene, groups), [scene, groups])

  return groups.map((group) => (
    <MaterialGroupTuner
      key={group.id}
      store={store}
      group={group}
      materials={materialsByGroup[group.id] ?? []}
    />
  ))
}
