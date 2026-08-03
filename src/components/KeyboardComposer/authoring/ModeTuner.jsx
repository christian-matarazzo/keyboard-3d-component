import { LEVA_MODE_FOLDER, useLevaSection } from './useLevaSection'

/**
 * La cartella "⚙️ Editor · Modalità": modalità di authoring attiva e posa home.
 *
 * Era una `useControls` dentro Scene.jsx, ed era il pezzo di Leva più
 * imbarazzante di tutti — perché `editMode` non è authoring, entra nel
 * comportamento di PRODUZIONE (`controlsDisabled`), e perché il suo percorso
 * testuale (`'⚙️ Editor · Modalità.editMode'`) era citato da cinque cartelle in
 * tre file. Un pannello di debug che non si può togliere non è un pannello di
 * debug.
 *
 * Ora il valore vive in `store.ui` e questo componente è solo la sua manopola:
 * si monta in `?debug`, e quando non c'è nessuno a montarlo `ui.editMode` resta
 * a `'none'`, che è esattamente la produzione.
 *
 * ⚠️ `homePose` è UNA manopola per tre usi: posa d'ingresso in landscape
 * (KeyboardModel.jsx), posa a cui si rientra uscendo da config (
 * KeyboardComposer.jsx) e posa su cui la modalità Mesh blocca la navigazione.
 */

// Le etichette dell'HUD sono duplicate per design (più pose condividono la
// stessa label breve, es. 'TL'/'TR'/'CFB' → '3/4 FT'): non possono essere usate
// da sole come chiave dell'options Leva, si disambigua accodando la chiave posa.
const homePoseOptions = (poseGraph) =>
  Object.fromEntries(poseGraph.keys.map((key) => [`${poseGraph.label(key)} · ${key}`, key]))

export default function ModeTuner({ store, poseGraph }) {
  useLevaSection(
    store,
    'ui',
    {
      editMode: {
        options: {
          Nessuno: 'none',
          Luci: 'lights',
          // Resa: materiali per gruppo, feel della navigazione e
          // post-processing. Le tre cartelle non hanno una superficie 3D
          // propria — nessun gizmo, nessuna selezione — quindi restavano
          // visibili in OGNI modalità, ed erano l'unico pezzo di pannello che
          // non rispondeva a questo selettore. Stanno insieme perché sono le
          // sezioni GLOBALI del prodotto: valgono per tutte le pose, a
          // differenza delle luci (per posa) e dei focus (per gruppo).
          Resa: 'render',
          Mesh: 'meshes',
          Animazioni: 'anim',
          Focus: 'focus',
        },
        value: 'none',
        label: 'Modalità',
      },
      // Opzioni e valore iniziale vengono dal grafo del PRODOTTO attivo: era
      // `value: 'TL'`, cioè una chiave di ARRAY_MODEL_L scritta a mano.
      homePose: {
        options: homePoseOptions(poseGraph),
        value:
          poseGraph.findPoseKey(poseGraph.entryLandscape.x, poseGraph.entryLandscape.y) ??
          poseGraph.keys[0],
        label: 'Posa home',
      },
    },
    // ⚠️ L'etichetta della cartella non è cosmetica: entra in LEVA_MODE_PATH,
    // che è ciò che i `render` delle altre cartelle interrogano.
    { folder: LEVA_MODE_FOLDER, collapsed: false },
  )

  return null
}
