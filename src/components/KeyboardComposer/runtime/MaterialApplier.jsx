import { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { applyMaterialProps, prepareGroupMaterials } from '../materials/groupMaterials'
import { useComposerSection } from '../state/useComposerSection'

/**
 * Applica alla scena i materiali autorati, gruppo per gruppo.
 *
 * Sono trenta righe, ed erano una riga sola sepolta dentro un pannello Leva
 * (`MaterialGroupTuner`, in Scene.jsx). Era quella riga a rendere `leva` un
 * pacchetto di PRODUZIONE: senza il pannello montato, in produzione i materiali
 * autorati non venivano applicati affatto.
 *
 * ⚠️ Un gruppo ASSENTE dalla sezione non viene toccato: resta il materiale del
 * GLB, autorato in Maya. Non è un caso limite ma il comportamento normale per
 * un prodotto senza JSON, ed è anche il motivo per cui non esiste un default
 * "materiale di sistema" da applicare — sovrascriverebbe l'unica fonte
 * autorevole con un grigio inventato.
 */
export default function MaterialApplier({ store, product }) {
  const { modelUrl, dracoPath, meshGroups: groups } = product
  // Stessa cache di drei condivisa con KeyboardModel/LightRig/MeshController:
  // nessun fetch aggiuntivo. `prepareGroupMaterials` è idempotente, quindi non
  // si fanno assunzioni sull'ordine di montaggio fra fratelli.
  const { scene } = useGLTF(modelUrl, dracoPath)
  const materialsByGroup = useMemo(() => prepareGroupMaterials(scene, groups), [scene, groups])
  const materials = useComposerSection(store, 'materials')

  useEffect(() => {
    for (const group of groups) {
      const values = materials?.[group.id]
      if (!values) continue
      for (const material of materialsByGroup[group.id] ?? []) applyMaterialProps(material, values)
    }
  }, [groups, materials, materialsByGroup])

  return null
}
