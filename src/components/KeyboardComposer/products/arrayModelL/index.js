import { defineProduct } from '../productSchema'
import { ARRAY_MODEL_L_POSE_GRAPH } from './poseGraph'
import { ARRAY_MODEL_L_MESH_GROUPS } from './meshGroups'
import { ARRAY_MODEL_L_MESH_VARIANTS } from './meshVariants'

/**
 * ARRAY_MODEL_L — il primo (e finora unico) prodotto del configuratore.
 *
 * ⚠️ `configUrl` NON segue la convenzione per-prodotto
 * (`/lightconfig/<id>/app-state-config.json`): resta il percorso storico,
 * perché è il file che l'autore scarica da ?debug e ricopia a mano in
 * `public/lightconfig/`. Cambiarlo qui vorrebbe dire spostare quel file e
 * rifare quel gesto senza guadagnarci nulla finché il prodotto è uno solo. Il
 * SECONDO prodotto prenderà il default per id, e a quel punto varrà la pena
 * spostare anche questo.
 */
export const ARRAY_MODEL_L = defineProduct({
  id: 'ARRAY_MODEL_L',
  label: 'Array Model L',
  modelUrl: '/models/keyboard.glb',
  configUrl: '/lightconfig/app-state-config.json',
  poseGraph: ARRAY_MODEL_L_POSE_GRAPH,
  meshGroups: ARRAY_MODEL_L_MESH_GROUPS,
  meshVariants: ARRAY_MODEL_L_MESH_VARIANTS,
})

export default ARRAY_MODEL_L
export { ARRAY_MODEL_L_POSE_GRAPH, ARRAY_MODEL_L_MESH_GROUPS, ARRAY_MODEL_L_MESH_VARIANTS }
