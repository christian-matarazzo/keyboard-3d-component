/**
 * Registro delle finiture disponibili nel configuratore.
 *
 * Ogni finitura definisce i parametri PBR per i tre slot logici del modello:
 *  - keycaps  → materiale OBJ `initialShadingGroup` (Keycaps_Set + viti)
 *  - body     → materiale OBJ `standardSurface3SG`  (rotori + piastre Slate)
 *  - damping  → materiale OBJ `standardSurface2SG`  (Damping_Module + Damping_Foots)
 *  - landing  → materiale OBJ `standardSurface4SG`  (Basetta angolata)
 *
 * Quando il cliente fornirà i materiali definitivi basta aggiornare/aggiungere
 * voci qui: ogni slot accetta anche `map`, `normalMap`, `roughnessMap` come URL
 * di texture, caricate in modo asincrono senza cambi di API.
 *
 * Nota anti-"bruciature": metalness alta + roughness bassa produce riflessi
 * speculari duri che bruciano su certe pose. Il body resta percettivamente
 * alluminio con metalness ~0.65 e roughness ~0.5; `envMapIntensity` dosa
 * quanto l'environment si riflette sul materiale (1 = pieno).
 *
 * Look cinematico (riferimento shooting Apple): `clearcoat` +
 * `clearcoatRoughness` aggiungono lo strato "vetroso" che accende le bande
 * speculari lunghe delle strip light durante la rotazione — è ciò che
 * distingue il prodotto premium dalla plastica.
 */
export const finishes = [
  {
    id: 'grafite',
    label: 'Grafite',
    swatch: '#3a3a3c',
    slots: {
      keycaps: { color: '#000000', roughness: 0.5, metalness: 0.05, envMapIntensity: 1.1, clearcoat: 0.5, clearcoatRoughness: 0.3 },
      // Alluminio anodizzato SATINATO: roughness alta + envMap contenuta →
      // niente speculari duri a incidenza radente (la bruciatura ricorrente
      // del case). I solchi delle piastre restano leggibili via diffuso.
      body: { color: '#46464c', roughness: 0.62, metalness: 0.0, envMapIntensity: 0.55, clearcoat: 0.0, clearcoatRoughness: 0.2 },
      damping: { color: '#1c1c1e', roughness: 0.9, metalness: 0, envMapIntensity: 0.5 },
      landing: { color: '#46464c', roughness: 0.62, metalness: 0.0, envMapIntensity: 0.55, clearcoat: 0.0, clearcoatRoughness: 0.2 },
    },
  },
  {
    id: 'argento',
    label: 'Argento',
    swatch: '#d6d6db',
    slots: {
      keycaps: { color: '#e8e8ed', roughness: 0.55, metalness: 0.30, envMapIntensity: 0.7 },
      body: { color: '#c9c9ce', roughness: 0.45, metalness: 0.7, envMapIntensity: 0.7 },
      damping: { color: '#8e8e93', roughness: 0.9, metalness: 0, envMapIntensity: 0.5 },
      landing: { color: '#c9c9ce', roughness: 0.45, metalness: 0.7, envMapIntensity: 0.7 },
    },
  },
  {
    id: 'arancio',
    label: 'Arancio cosmico',
    swatch: '#f56300',
    slots: {
      keycaps: { color: '#2b2b2e', roughness: 0.6, metalness: 0.05, envMapIntensity: 0.7 },
      body: { color: '#d15a1e', roughness: 0.48, metalness: 0.6, envMapIntensity: 0.7 },
      damping: { color: '#1c1c1e', roughness: 0.9, metalness: 0, envMapIntensity: 0.5 },
      landing: { color: '#d15a1e', roughness: 0.48, metalness: 0.6, envMapIntensity: 0.7 },
    },
  },
  {
    id: 'blu',
    label: 'Blu profondo',
    swatch: '#2d4a6b',
    slots: {
      keycaps: { color: '#d9d9de', roughness: 0.6, metalness: 0.05, envMapIntensity: 0.7 },
      body: { color: '#2d4a6b', roughness: 0.5, metalness: 0.65, envMapIntensity: 0.7 },
      damping: { color: '#16222f', roughness: 0.9, metalness: 0, envMapIntensity: 0.5 },
      landing: { color: '#2d4a6b', roughness: 0.5, metalness: 0.65, envMapIntensity: 0.7 },
    },
  },
]

export function getFinish(finishes_, id) {
  return finishes_.find((f) => f.id === id) ?? finishes_[0]
}
