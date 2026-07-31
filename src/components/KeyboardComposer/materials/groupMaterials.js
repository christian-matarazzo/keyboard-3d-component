import { collectMeshGroups } from './meshGroups'

/**
 * Scopre e clona i materiali reali del GLB per ciascun gruppo, invece di
 * costruire materiali nuovi da zero a partire da preset autorati a mano (il
 * vecchio sistema "finish" in registry.js/applyFinish.js, rimosso): con
 * texture ad alta definizione in arrivo sulle mesh, sostituire il materiale
 * a blocco avrebbe distrutto qualunque texture map già presente sul
 * materiale originale del GLB. `Material.clone()` invece copia le
 * PROPRIETÀ (incluse le texture map, per riferimento — tre.js copia i
 * riferimenti, mai i pixel) senza toccarle: si clona una volta per gruppo,
 * così ogni gruppo resta tunabile in modo indipendente pur partendo dai
 * valori già autorati in Maya/DCC.
 *
 * Idempotente: ogni clone è marcato (`userData.__groupMaterialFor`), quindi
 * chiamare questa funzione più volte sulla stessa `scene` (es. da
 * KeyboardModel.jsx E da Scene.jsx, componenti fratelli che condividono la
 * `scene` via cache di useGLTF) non ri-clona né duplica materiali GPU: chi
 * arriva dopo trova i cloni già pronti e li riusa.
 */
export function prepareGroupMaterials(scene, groups, fallbackGroupId) {
  const meshGroups = collectMeshGroups(scene, groups, fallbackGroupId)
  const materialsByGroup = {}

  for (const [groupId, meshes] of Object.entries(meshGroups)) {
    // Scope PER GRUPPO, non condiviso fra gruppi: più gruppi possono
    // condividere lo stesso materiale Maya originale (body/rotors/tasselli
    // in questo asset condividono standardSurface3SG) — se questa mappa
    // fosse unica per l'intera funzione, il primo gruppo a clonare
    // "vincerebbe" e gli altri riuserebbero silenziosamente IL SUO clone,
    // vanificando il tuning indipendente per gruppo che è lo scopo del file.
    const cloneByOriginal = new Map()
    const groupMaterials = []

    for (const mesh of meshes) {
      const original = mesh.material
      if (!original) continue

      if (original.userData?.__groupMaterialFor === groupId) {
        if (!groupMaterials.includes(original)) groupMaterials.push(original)
        continue
      }

      let clone = cloneByOriginal.get(original)
      if (!clone) {
        clone = original.clone()
        clone.name = `${groupId}:${cloneByOriginal.size}`
        clone.userData.__groupMaterialFor = groupId
        cloneByOriginal.set(original, clone)
        groupMaterials.push(clone)
      }
      mesh.material = clone
    }

    materialsByGroup[groupId] = groupMaterials
  }

  return materialsByGroup
}

/**
 * Ritocca dal vivo un materiale già scoperto/clonato (pannello ?debug). Muta
 * l'oggetto passato in place — nessuna cache/lookup per chiave: chi chiama
 * possiede già il riferimento (vedi MaterialGroupTuner in Scene.jsx).
 */
export function applyMaterialProps(material, props) {
  if (props.color != null) material.color.set(props.color)
  if (props.roughness != null) material.roughness = props.roughness
  if (props.metalness != null) material.metalness = props.metalness
  if (props.envMapIntensity != null) material.envMapIntensity = props.envMapIntensity
  if (props.clearcoat != null) material.clearcoat = props.clearcoat
  if (props.clearcoatRoughness != null) material.clearcoatRoughness = props.clearcoatRoughness
}
