import { DEFAULT_POSTFX } from '../state/defaults'
import { renderInMode, useLevaSection } from './useLevaSection'

/**
 * Le manopole del post-processing: antialiasing e occlusione ambientale.
 *
 * ⚠️ Manca di proposito l'INTERRUTTORE del composer. Non è una dimenticanza:
 * accendere e spegnere la catena sposta la scena fra schermo e render target, e
 * con essa i define `toneMapping`/`outputColorSpace` di ogni materiale, cioè la
 * loro chiave di cache — 192 ms di ricompilazione a programma, in mezzo a
 * qualunque cosa stia succedendo. È una prop di `KeyboardComposer`, valutata una
 * volta sola al montaggio. Qui ci sono solo i valori che si possono muovere a
 * caldo: uniform del materiale dell'AO, o al più una riallocazione dei suoi
 * render target.
 *
 * Come per RotationTuner, i VALORI stanno in `DEFAULT_POSTFX`
 * (state/defaults.js) e non qui: sono valori di produzione — la scena si
 * comporta così anche senza pannello — e questa sezione viaggia nel JSON
 * autorato, quindi ciò che si tara qui è ciò che vede il prodotto finale.
 */
export default function PostFxTuner({ store }) {
  useLevaSection(
    store,
    'postfx',
    {
      msaaSamples: {
        value: DEFAULT_POSTFX.msaaSamples,
        options: { spento: 0, '2×': 2, '4×': 4, '8×': 8 },
        label: 'MSAA',
      },
      pixelRatioCap: {
        value: DEFAULT_POSTFX.pixelRatioCap,
        min: 1,
        max: 2,
        step: 0.25,
        label: 'tetto pixel ratio',
      },
      // Le manopole della scala dinamica sono a caldo come le uniform dell'AO:
      // non ricostruiscono la catena, riallocano solo i buffer al prossimo
      // cambio di gradino.
      dynamicScale: { value: DEFAULT_POSTFX.dynamicScale, label: 'scala dinamica' },
      // Il budget di FILL per frame. 14 ≈ 60 fps (i ~2-3 ms non-fill sono già
      // scontati), 30 ≈ 30 fps con più nitidezza negli stati pesanti.
      frameBudgetMs: {
        value: DEFAULT_POSTFX.frameBudgetMs,
        min: 6,
        max: 40,
        step: 0.5,
        label: 'budget frame (ms)',
      },
      // ⚠️ Taratura per MACCHINA, non gusto: ms di fill per megapixel coperto.
      // Si misura nello stato peggiore (modello che riempie il viewport), mai a
      // riposo — vedi state/defaults.js.
      fillCostMsPerMpx: {
        value: DEFAULT_POSTFX.fillCostMsPerMpx,
        min: 4,
        max: 80,
        step: 1,
        label: 'costo fill (ms/Mpx)',
      },
      dynamicScaleMin: {
        value: DEFAULT_POSTFX.dynamicScaleMin,
        min: 0.4,
        max: 1,
        step: 0.05,
        label: 'scala minima',
      },
      aoEnabled: { value: DEFAULT_POSTFX.aoEnabled, label: 'occlusione ambientale' },
      aoResolutionScale: {
        value: DEFAULT_POSTFX.aoResolutionScale,
        options: { '1/1': 1, '1/2': 0.5, '1/4': 0.25 },
        label: 'risoluzione AO',
      },
      // Il modello è largo 3.2 unità di scena: 0.12 è l'ordine di grandezza
      // della fuga fra due keycap. Sopra ~0.5 non è più occlusione di contatto
      // ma ombreggiatura d'insieme, ed è un altro effetto.
      aoRadius: {
        value: DEFAULT_POSTFX.aoRadius,
        min: 0.02,
        max: 0.6,
        step: 0.01,
        label: 'raggio (unità scena)',
      },
      aoIntensity: {
        value: DEFAULT_POSTFX.aoIntensity,
        min: 0,
        max: 2,
        step: 0.05,
        label: 'intensità',
      },
      // Alza per togliere gli aloni chiari attorno alle silhouette, abbassa se
      // il contatto sparisce del tutto.
      aoThickness: { value: DEFAULT_POSTFX.aoThickness, min: 0.1, max: 4, step: 0.1, label: 'spessore' },
      aoDistanceExponent: {
        value: DEFAULT_POSTFX.aoDistanceExponent,
        min: 0.5,
        max: 4,
        step: 0.1,
        label: 'caduta con distanza',
      },
      // ⚠️ NON è la manopola da abbassare se serve margine, per quanto lo
      // sembri: 16 → 4 è stato misurato e vale zero. Il costo dell'AO qui è
      // banda, non aritmetica — vedi state/defaults.js.
      aoSamples: { value: DEFAULT_POSTFX.aoSamples, min: 4, max: 32, step: 1, label: 'campioni' },
    },
    // Modalità "Resa" insieme a materiali e rotazione: vedi ModeTuner.jsx.
    { folder: 'Post-processing', render: renderInMode('render') },
  )

  return null
}
