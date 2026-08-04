import { DEFAULT_ROTATION } from '../state/defaults'
import { renderInMode, useLevaSection } from './useLevaSection'

/**
 * I parametri di "feel" della navigazione: velocità del drag, molla di
 * assestamento, elastico oltre lo step, tempi del focus.
 *
 * ⚠️ I VALORI stanno in DEFAULT_ROTATION (state/defaults.js), non qui: sono
 * valori di PRODUZIONE — la scena si muove così anche senza pannello — e
 * tenerli dentro uno schema Leva significava tenere il comportamento del
 * prodotto dentro l'UI di authoring. Qui restano gli estremi degli slider e le
 * etichette, che sono davvero dell'editor.
 *
 * Questa sezione è la più calda di tutte: `useComposerControls` la legge a OGNI
 * FRAME, e per questo non la legge da React ma dallo store (`store.get`) con un
 * ref riallineato da una sottoscrizione. Vedi lì.
 */
export default function RotationTuner({ store }) {
  useLevaSection(
    store,
    'rotation',
    {
      dragSpeed: { value: DEFAULT_ROTATION.dragSpeed, min: 0.001, max: 0.012, step: 0.0005, label: 'velocità drag' },
      followTime: { value: DEFAULT_ROTATION.followTime, min: 0.05, max: 0.6, step: 0.01, label: 'inerzia in drag' },
      commitFraction: { value: DEFAULT_ROTATION.commitFraction, min: 0.1, max: 0.9, step: 0.05, label: 'soglia step' },
      springStiffness: { value: DEFAULT_ROTATION.springStiffness, min: 20, max: 300, step: 5, label: 'molla rigidità' },
      springDamping: { value: DEFAULT_ROTATION.springDamping, min: 0.2, max: 1.2, step: 0.05, label: 'molla smorzamento' },
      rubberFactor: { value: DEFAULT_ROTATION.rubberFactor, min: 0, max: 0.6, step: 0.05, label: 'elastico oltre-step' },
      rubberCapDeg: { value: DEFAULT_ROTATION.rubberCapDeg, min: 0, max: 20, step: 1, label: 'elastico max ( )' },
      timeScale: { value: DEFAULT_ROTATION.timeScale, min: 0.3, max: 1.5, step: 0.05, label: 'velocità animazione' },
      // Aria attorno alle estensioni PROIETTATE del modello, sul caso peggiore
      // del grafo delle pose. Il minimo è 1: sotto, qualche posa taglia.
      fitMargin: { value: DEFAULT_ROTATION.fitMargin, min: 1, max: 2.5, step: 0.05, label: 'margine insieme' },
      // ⚠️ Manopola SEPARATA da quella sopra apposta: prima il margine
      // dell'insieme entrava nella distanza dei focus per costruzione, quindi
      // stringere l'inquadratura generale riscriveva in silenzio ogni
      // inquadratura di gruppo autorata. Vedi state/defaults.js.
      focusMargin: { value: DEFAULT_ROTATION.focusMargin, min: 1, max: 2.5, step: 0.05, label: 'margine focus' },
      zoomOutMobile: { value: DEFAULT_ROTATION.zoomOutMobile, min: 1, max: 1.8, step: 0.05, label: 'zoom-out mobile' },
      // Transizione dello zoom sui gruppi (dolly + spostamento del pivot).
      // Volutamente NON la molla delle pose: quella integra angoli con la
      // compensazione d'ampiezza di stepAmp, semanticamente scorrelata da una
      // carrellata. Smorzamento maath sul delta GREZZO (non scalato da
      // timeScale), così questo numero è leggibile come "tempo di assestamento
      // in secondi" e resta l'unica manopola del focus.
      focusDamp: { value: DEFAULT_ROTATION.focusDamp, min: 0.1, max: 2, step: 0.05, label: 'transizione focus' },
      // Uscita dal focus (zoom-out verso l'insieme): manopola propria, perché è
      // il movimento che chiude ogni animazione e accompagna la dissolvenza
      // dell'opacità — vederlo alla stessa velocità dell'entrata lo fa sembrare
      // frettoloso. Default uguale a focusDamp: comportamento invariato finché
      // non lo si tocca.
      focusOutDamp: { value: DEFAULT_ROTATION.focusOutDamp, min: 0.1, max: 3, step: 0.05, label: 'zoom-out (uscita)' },
    },
    // Modalità "Resa" insieme a materiali e post-processing: vedi ModeTuner.jsx.
    // La navigazione resta VIVA in quella modalità (solo 'meshes' la blocca), ed
    // è la condizione perché queste manopole si possano tarare — si giudicano
    // trascinando il modello, non guardandolo fermo.
    { folder: 'Rotazione', render: renderInMode('render') },
  )

  return null
}
