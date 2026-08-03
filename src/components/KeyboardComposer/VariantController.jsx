import { useEffect, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { applyVariantVisibility } from './materials/meshVariants'

/**
 * Applica la selezione delle varianti all'albero reale del GLB.
 *
 * Vive dentro il Canvas (fratello di KeyboardModel/LightRig/AnimationDirector),
 * non rende nulla, e carica il GLB in proprio — stessa cache drei di tutti gli
 * altri, nessun fetch aggiuntivo. La SELEZIONE invece è stato React in
 * KeyboardComposer.jsx: qui si esegue soltanto.
 *
 * **Hold di transizione.** Durante uno swap animato entrambe le opzioni devono
 * restare visibili per potersi incrociare in dissolvenza, ma il commit della
 * scelta arriva all'INIZIO (così il toggle dell'HUD risponde subito). Senza una
 * deroga esplicita questo effetto spegnerebbe la mesh uscente nello stesso
 * frame in cui comincia a sfumare. L'azione `setVariant` chiama quindi
 * `holdVariant(id)` prima di committare e `releaseVariantHold(id)` a
 * dissolvenza finita; finché l'hold è attivo la visibilità di quella variante è
 * roba dell'animazione, non di questo effetto.
 */
export default function VariantController({
  product,
  apiRef,
  variants,
  selection,
}) {
  const { scene } = useGLTF(product.modelUrl, product.dracoPath)
  const holdsRef = useRef(new Set())

  useEffect(() => {
    applyVariantVisibility(scene, variants, selection, holdsRef.current)
    // Accendere e spegnere mesh cambia ciò che proietta ombra, e le shadow map
    // sono congelate (runtime/ShadowFreeze.jsx): senza questa riga la variante
    // uscente continuerebbe a proiettare la propria ombra finché qualcos'altro
    // non invalida. Difetto silenzioso — il modello è giusto, l'ombra no.
    apiRef?.current?.invalidateShadows?.()
  }, [scene, variants, selection, apiRef])

  useEffect(() => {
    if (!apiRef) return
    Object.assign(apiRef.current, {
      holdVariant: (id) => holdsRef.current.add(id),
      releaseVariantHold: (id) => {
        holdsRef.current.delete(id)
        // Ri-applica subito: la selezione può essere cambiata mentre l'hold era
        // attivo, ed è questo il momento in cui la mesh uscente va spenta.
        applyVariantVisibility(scene, variants, selection, holdsRef.current)
        apiRef.current.invalidateShadows?.()
      },
    })
    return () => {
      delete apiRef.current.holdVariant
      delete apiRef.current.releaseVariantHold
    }
  }, [apiRef, scene, variants, selection])

  return null
}
