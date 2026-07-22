import * as THREE from 'three'

// Mappatura primaria: nome del materiale ereditato dall'OBJ → slot logico.
const MATERIAL_TO_SLOT = {
  initialShadingGroup: 'keycaps',
  standardSurface3SG: 'body',
  standardSurface2SG: 'damping',
  standardSurface4SG: 'landing',
}

// Fallback: substring del nome del nodo → slot (i nomi possono includere
// prefissi della gerarchia Maya, quindi si confronta con includes()).
const NODE_TO_SLOT = [
  ['Keycaps', 'keycaps'],
  ['Countersunk', 'keycaps'],
  ['Rotor', 'body'],
  ['Slate', 'body'],
  ['Damping', 'damping'],
  ['Landing', 'landing'],
  ['Foot', 'landing'],
  ['Rialzo', 'landing'],
]

/**
 * Traversa la scena una sola volta e raggruppa le mesh per slot logico.
 * Attiva anche cast/receive shadow su ogni mesh.
 */
export function collectSlotMeshes(scene) {
  const slots = { keycaps: [], body: [], damping: [], landing: [] }
  scene.traverse((obj) => {
    if (!obj.isMesh) return
    obj.castShadow = true
    obj.receiveShadow = true
    let slot = MATERIAL_TO_SLOT[obj.material?.name]
    if (!slot) {
      const hit = NODE_TO_SLOT.find(([token]) => obj.name.includes(token))
      slot = hit ? hit[1] : 'body'
    }
    slots[slot].push(obj)
  })
  return slots
}

// Cache module-level: un materiale per (finitura, slot), creato una sola
// volta e riassegnato per riferimento → swap istantaneo, zero allocazioni.
const materialCache = new Map()
const textureLoader = new THREE.TextureLoader()

const TEXTURE_PROPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']

function getMaterial(finish, slotName) {
  const key = `${finish.id}:${slotName}`
  if (materialCache.has(key)) return materialCache.get(key)

  const def = { ...(finish.slots[slotName] ?? {}) }
  const textureUrls = {}
  for (const prop of TEXTURE_PROPS) {
    if (def[prop]) {
      textureUrls[prop] = def[prop]
      delete def[prop]
    }
  }

  const material = new THREE.MeshPhysicalMaterial(def)
  material.name = key

  // Le texture (fornite dal cliente in seguito) si caricano in async e
  // aggiornano il materiale già in scena senza reload del modello.
  for (const [prop, url] of Object.entries(textureUrls)) {
    textureLoader.load(url, (texture) => {
      if (prop === 'map') texture.colorSpace = THREE.SRGBColorSpace
      texture.flipY = false
      material[prop] = texture
      material.needsUpdate = true
    })
  }

  materialCache.set(key, material)
  return material
}

/**
 * Ritocca dal vivo il materiale di uno slot già in scena (pannello ?debug).
 * Muta il materiale in cache: lo swap è istantaneo, senza riallocazioni.
 */
export function tuneSlotMaterial(finishId, slotName, props) {
  const material = materialCache.get(`${finishId}:${slotName}`)
  if (!material) return
  if (props.color != null) material.color.set(props.color)
  if (props.roughness != null) material.roughness = props.roughness
  if (props.metalness != null) material.metalness = props.metalness
  if (props.envMapIntensity != null) material.envMapIntensity = props.envMapIntensity
  if (props.clearcoat != null) material.clearcoat = props.clearcoat
  if (props.clearcoatRoughness != null) material.clearcoatRoughness = props.clearcoatRoughness
}

/** Applica una finitura a tutti gli slot, in tempo reale. */
export function applyFinish(slotMeshes, finish) {
  for (const [slotName, meshes] of Object.entries(slotMeshes)) {
    const material = getMaterial(finish, slotName)
    for (const mesh of meshes) mesh.material = material
  }
}
