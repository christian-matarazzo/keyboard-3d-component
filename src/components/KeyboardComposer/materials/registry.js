/**
 * Registro delle finiture disponibili nel configuratore.
 *
 * Ogni finitura definisce i parametri PBR per i tre slot logici del modello:
 *  - keycaps  → materiale OBJ `initialShadingGroup` (Keycaps_Set + viti)
 *  - body     → materiale OBJ `standardSurface3SG`  (rotori + piastre Slate)
 *  - damping  → materiale OBJ `standardSurface2SG`  (Damping_Module + Damping_Foots)
 *
 * Quando il cliente fornirà i materiali definitivi basta aggiornare/aggiungere
 * voci qui: ogni slot accetta anche `map`, `normalMap`, `roughnessMap` come URL
 * di texture, caricate in modo asincrono senza cambi di API.
 */
export const finishes = [
  {
    id: 'grafite',
    label: 'Grafite',
    swatch: '#3a3a3c',
    slots: {
      keycaps: { color: '#2b2b2e', roughness: 0.55, metalness: 0.05 },
      body: { color: '#4a4a4e', roughness: 0.35, metalness: 0.9 },
      damping: { color: '#1c1c1e', roughness: 0.9, metalness: 0 },
    },
  },
  {
    id: 'argento',
    label: 'Argento',
    swatch: '#d6d6db',
    slots: {
      keycaps: { color: '#e8e8ed', roughness: 0.5, metalness: 0.05 },
      body: { color: '#c9c9ce', roughness: 0.3, metalness: 0.95 },
      damping: { color: '#8e8e93', roughness: 0.9, metalness: 0 },
    },
  },
  {
    id: 'arancio',
    label: 'Arancio cosmico',
    swatch: '#f56300',
    slots: {
      keycaps: { color: '#2b2b2e', roughness: 0.55, metalness: 0.05 },
      body: { color: '#d15a1e', roughness: 0.32, metalness: 0.85 },
      damping: { color: '#1c1c1e', roughness: 0.9, metalness: 0 },
    },
  },
  {
    id: 'blu',
    label: 'Blu profondo',
    swatch: '#2d4a6b',
    slots: {
      keycaps: { color: '#d9d9de', roughness: 0.55, metalness: 0.05 },
      body: { color: '#2d4a6b', roughness: 0.35, metalness: 0.9 },
      damping: { color: '#16222f', roughness: 0.9, metalness: 0 },
    },
  },
]

export function getFinish(finishes_, id) {
  return finishes_.find((f) => f.id === id) ?? finishes_[0]
}
