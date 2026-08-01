import * as THREE from 'three'
import { TransformControls, useHelper } from '@react-three/drei'
import { DEFAULT_KEYLIGHT, DEFAULT_SPOTLIGHT } from '../state/defaults'
import { useComposerSection } from '../state/useComposerSection'
import { renderInMode, useLevaSection } from './useLevaSection'

/**
 * I pannelli e i gizmo 3D delle due luci-ombra.
 *
 * Sono la metà di authoring di runtime/ShadowLights.jsx: là c'è la luce, qui
 * gli slider e la freccia che si trascina. Si incontrano su un ref, che il
 * chiamante (LightRig) crea e passa a entrambi.
 *
 * ⚠️ Gli estremi degli slider stanno qui, i VALORI stanno in state/defaults.js.
 * La distinzione conta: `min`/`max`/`step`/`label` sono ergonomia dell'editor e
 * possono cambiare senza conseguenze, i valori sono prodotto e finiscono nel
 * JSON salvato.
 */

const KEYLIGHT_SCHEMA = {
  enabled: { value: DEFAULT_KEYLIGHT.enabled, label: 'Accesa' },
  showGizmo: { value: DEFAULT_KEYLIGHT.showGizmo, label: 'Mostra Gizmo 3D' },
  intensity: { value: DEFAULT_KEYLIGHT.intensity, min: 0, max: 100, step: 0.05 },
  posX: { value: DEFAULT_KEYLIGHT.posX, min: -10, max: 10 },
  posY: { value: DEFAULT_KEYLIGHT.posY, min: -10, max: 10 },
  posZ: { value: DEFAULT_KEYLIGHT.posZ, min: -10, max: 10 },
  bias: { value: DEFAULT_KEYLIGHT.bias, min: -0.005, max: 0.005, step: 0.0001 },
  normalBias: { value: DEFAULT_KEYLIGHT.normalBias, min: -0.1, max: 0.1, step: 0.001 },
}

const SPOTLIGHT_SCHEMA = {
  enabled: { value: DEFAULT_SPOTLIGHT.enabled, label: 'Accesa' },
  showGizmo: { value: DEFAULT_SPOTLIGHT.showGizmo, label: 'Mostra Gizmo 3D' },
  intensity: { value: DEFAULT_SPOTLIGHT.intensity, min: 0, max: 100, step: 0.1 },
  angle: { value: DEFAULT_SPOTLIGHT.angle, min: 0.1, max: Math.PI / 2, step: 0.01 },
  penumbra: { value: DEFAULT_SPOTLIGHT.penumbra, min: 0, max: 1, step: 0.01 },
  distance: { value: DEFAULT_SPOTLIGHT.distance, min: 1, max: 50, step: 0.5 },
  posX: { value: DEFAULT_SPOTLIGHT.posX, min: -10, max: 10 },
  posY: { value: DEFAULT_SPOTLIGHT.posY, min: -10, max: 10 },
  posZ: { value: DEFAULT_SPOTLIGHT.posZ, min: -10, max: 10 },
  bias: { value: DEFAULT_SPOTLIGHT.bias, min: -0.005, max: 0.005, step: 0.0001 },
  normalBias: { value: DEFAULT_SPOTLIGHT.normalBias, min: -0.1, max: 0.1, step: 0.001 },
}

/**
 * Il gizmo di trascinamento di UNA luce. La posizione trascinata non torna più
 * dentro Leva ma dentro lo STORE: da lì Leva la riprende (via useLevaSection) e
 * la luce si riposiziona (via useComposerSection). Un solo verso, un solo
 * proprietario del valore.
 */
function LightGizmo({ store, section, lightRef, helper, helperArgs, active }) {
  const { enabled, showGizmo } = useComposerSection(store, section)
  const on = active && enabled && showGizmo

  // ⚠️ `useHelper` è un hook: va chiamato sempre, e si spegne passando un falsy
  // al posto del ref — non lo si può mettere dietro un early return.
  useHelper(on && lightRef, helper, ...helperArgs)

  if (!on) return null

  return (
    <TransformControls
      object={lightRef}
      mode="translate"
      size={0.7}
      // Appena il mouse preme il gizmo si annulla il drag di rotazione del
      // modello, o si trascinerebbero luce e camera insieme.
      onMouseDown={() => {
        if (window.__abortComposerDrag) window.__abortComposerDrag()
      }}
      onChange={() => {
        if (!lightRef.current) return
        store.set(section, {
          posX: lightRef.current.position.x,
          posY: lightRef.current.position.y,
          posZ: lightRef.current.position.z,
        })
      }}
    />
  )
}

/**
 * @param {boolean} active vero in modalità Luci con `?debug` — spegne insieme
 *   helper e gizmo, che sono le uniche parti cliccabili.
 */
export default function LightGizmos({ store, keyLightRef, spotLightRef, active }) {
  useLevaSection(store, 'keylight', KEYLIGHT_SCHEMA, {
    folder: 'Ombra: Directional (Keylight)',
    render: renderInMode('lights'),
  })
  useLevaSection(store, 'spotlight', SPOTLIGHT_SCHEMA, {
    folder: 'Ombra: Spotlight',
    render: renderInMode('lights'),
  })

  return (
    <>
      <LightGizmo
        store={store}
        section="keylight"
        lightRef={keyLightRef}
        helper={THREE.DirectionalLightHelper}
        helperArgs={[1, '#00ffcc']}
        active={active}
      />
      <LightGizmo
        store={store}
        section="spotlight"
        lightRef={spotLightRef}
        helper={THREE.SpotLightHelper}
        helperArgs={['#ff00cc']}
        active={active}
      />
    </>
  )
}
