import { useComposerSection } from '../state/useComposerSection'

/**
 * Le due luci che proiettano ombra, e nient'altro.
 *
 * Erano due componenti che facevano tre mestieri insieme: rendere la luce,
 * ospitare il proprio pannello Leva e disegnare il gizmo di trascinamento. Il
 * primo è produzione, gli altri due sono authoring — e finché stavano nella
 * stessa funzione, `leva` e `TransformControls` erano codice di produzione.
 *
 * Qui resta il primo mestiere. Gli altri due vivono in
 * authoring/LightGizmos.jsx e si agganciano a queste luci attraverso i ref che
 * il chiamante passa a entrambi.
 *
 * ⚠️ `lightRef` non è un dettaglio implementativo ma il punto di giunzione fra
 * i due mondi: è il modo in cui l'editor può muovere una luce che non rende
 * più. Chi non ha authoring semplicemente non lo passa.
 */

/** Luce direzionale principale: è lei a fare l'ombra portata del modello. */
export function ShadowKeyLight({ store, lightRef }) {
  const { enabled, intensity, posX, posY, posZ, bias, normalBias } =
    useComposerSection(store, 'keylight')

  if (!enabled) return null

  return (
    <directionalLight
      ref={lightRef}
      position={[posX, posY, posZ]}
      intensity={intensity}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-bias={bias}
      shadow-normalBias={normalBias}
    >
      <orthographicCamera attach="shadow-camera" args={[-4, 4, 4, -4, 0.1, 20]} />
    </directionalLight>
  )
}

/** Faretto secondario, spento di default: si accende per resa in vista ravvicinata. */
export function ShadowSpotLight({ store, lightRef }) {
  const { enabled, intensity, angle, penumbra, distance, posX, posY, posZ, bias, normalBias } =
    useComposerSection(store, 'spotlight')

  if (!enabled) return null

  return (
    <spotLight
      ref={lightRef}
      position={[posX, posY, posZ]}
      intensity={intensity}
      angle={angle}
      penumbra={penumbra}
      distance={distance}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-bias={bias}
      shadow-normalBias={normalBias}
    />
  )
}
