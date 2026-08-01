import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Html, useProgress } from '@react-three/drei'
import { KeyboardModel } from './KeyboardModel'
import LightRig from './LightRig'
import AnimationDirector from './AnimationDirector'
import VariantController from './VariantController'
import MaterialApplier from './runtime/MaterialApplier'
import { useComposerSection } from './state/useComposerSection'

// ⚠️ Stesso specificatore dell'import in KeyboardComposer.jsx, e non è un
// caso: due `lazy` sullo stesso modulo producono UN chunk solo, quindi il
// montaggio dentro il Canvas non paga un secondo scaricamento.
const AuthoringScene = lazy(() =>
  import('./authoring').then((m) => ({ default: m.AuthoringScene })),
)

function Loader() {
  const { progress } = useProgress()
  return (
    <Html center>
      <div
        style={{
          color: 'rgba(255,255,255,0.75)',
          fontSize: 14,
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        Caricamento… {Math.round(progress)}%
      </div>
    </Html>
  )
}

export default function Scene({
  // Prodotto già risolto e congelato da KeyboardComposer.jsx: GLB, JSON di
  // configurazione, grafo delle pose, gruppi e varianti. Scende intero fino a
  // chi ne ha bisogno invece di essere spacchettato in quattro prop.
  product,
  apiRef,
  // Lo stato autorato (luci, materiali, feel, inquadrature): il gemello di
  // `apiRef` per i DATI, creato in KeyboardComposer.jsx e sceso come prop
  // normale — vedi state/composerStore.js. Attraversa il confine del Canvas
  // come prop e non come context proprio come già fa `apiRef`: R3F usa un
  // riconciliatore separato, e le prop lo attraversano senza sorprese.
  store,
  animations,
  variantSelection,
  // Modalità di prodotto ('idle' | 'config'): lo stato vive in
  // KeyboardComposer.jsx (rende sia il Canvas sia gli overlay DOM), qui serve
  // solo a spegnere drag/frecce in config — vedi controlsDisabled sotto.
  // Vero quando l'editor è attivo: carica il sottoalbero 3D di authoring.
  authoring = false,
  appMode = 'idle',
  // `{ duration, easing }` della dissolvenza di uscita delle animazioni: di
  // sola andata verso AnimationDirector.
  release,
  // La posa home è una Leva di questo componente, ma è stato di PRODOTTO e va
  // salvata: risale a KeyboardComposer.jsx, unico scrittore di __STATE_APP.
  onHomePoseChange,
}) {
  const { modelUrl, meshGroups, meshVariants, poseGraph } = product

  const [modelSize, setModelSize] = useState(null)
  const [selectedMesh, setSelectedMesh] = useState(null)
  // Giunzione fra le due luci-ombra renderizzate dal rig e i gizmo
  // dell'authoring, che le muovono senza possederle. I ref nascono qui perché
  // questo è l'antenato comune dei due sottoalberi.
  const keyLightRef = useRef()
  const spotLightRef = useRef()
  // Inquadrature autorate dei gruppi: scendono fino a useComposerControls (via
  // KeyboardModel), che è chi le applica alla camera. Vengono dallo store, non
  // più raccolte a mano dai pannelli: prima il valore autorevole era la somma
  // di N componenti Leva, quindi in produzione (pannelli nascosti ma montati)
  // funzionava per caso, e senza pannelli non sarebbe funzionato affatto.
  const focusOverrides = useComposerSection(store, 'focus')

  // Modalità editor esclusiva (Nessuno/Luci/Mesh): l'editor luci (LightRig,
  // helper cliccabili) e l'editor mesh (KeyboardModel + MeshController)
  // condividono lo stesso canvas e raycastano indipendentemente — prima di
  // questo switch un click sul modello poteva selezionare anche una luce
  // sottostante (onPointerDown della mesh e onClick degli helper luce sono
  // due pipeline di eventi R3F separate, stopPropagation sull'una non ferma
  // l'altra). Un solo sistema alla volta riceve i click (vedi editMode
  // passato a KeyboardModel/LightRig/MeshController); il drag di rotazione
  // si disattiva solo in Mesh (in Luci serve poter cambiare posa per
  // configurare le luci vista per vista — vedi controlsDisabled sotto).
  // 'focus' si comporta come 'lights': niente click/gizmo, navigazione VIVA —
  // le inquadrature dei gruppi si autorano posa per posa, quindi bisogna poter
  // girare attorno al modello mentre si tarano. Anche 'anim' (editor delle
  // animazioni) sta in quel gruppo: le animazioni si provano navigando, e sono
  // loro stesse a muovere posa e focus.
  //
  // `homePose` è UNA manopola sola per tre usi: posa d'ingresso in landscape
  // (KeyboardModel.jsx), posa a cui si rientra uscendo da config_mode
  // (KeyboardComposer.jsx) e posa su cui la modalità Mesh blocca la
  // navigazione. Prima era la sola "posa bloccata" della modalità Mesh.
  // I due valori vivono nello store, non in Leva: `editMode` entra nel
  // comportamento di PRODUZIONE (vedi controlsDisabled più sotto), e finché era
  // una `useControls` il pannello di authoring non era rimovibile. La manopola
  // che li muove è authoring/ModeTuner.jsx, montato qui sotto.
  const { editMode, homePose } = useComposerSection(store, 'ui')

  // La posa home è stato di prodotto, non di tuning: va nel JSON globale come
  // materiali/focus/animazioni. Non si scrive però direttamente su
  // `window.__STATE_APP`: la sezione `app` contiene anche l'animazione di
  // rientro e i tempi di rilascio, che vivono in KeyboardComposer.jsx — due
  // scrittori sullo stesso globale si sovrascriverebbero a vicenda.
  useEffect(() => {
    onHomePoseChange?.(homePose)
  }, [homePose, onHomePoseChange])

  // La posa home autorata arriva nella sezione `app` del JSON e va riportata su
  // `ui`, che è dove la manopola la legge. Sottoscrizione e non evento: così
  // copre anche il caso in cui la configurazione sia già stata caricata prima
  // che questo componente esistesse — che con un CustomEvent era stato perso.
  useEffect(() => {
    if (!store) return
    const syncHomePose = (app) => {
      if (app?.homePose && poseGraph.has(app.homePose)) store.set('ui', { homePose: app.homePose })
    }
    syncHomePose(store.get('app'))
    return store.subscribe('app', syncHomePose)
  }, [store, poseGraph])

  // Entrando in modalità Mesh (o cambiando la posa home mentre già ci si
  // è dentro), snappa/ri-snappa alla posa home configurabile (non più
  // hardcoded a 'TL') — non al selezionare una mesh/gruppo, altrimenti
  // risalterebbe lì ogni volta che si cambia selezione dentro la stessa
  // sessione di editing.
  useEffect(() => {
    if (!apiRef?.current) return
    if (editMode === 'meshes') apiRef.current.goTo?.(homePose)
  }, [editMode, homePose, apiRef])

  // Ponte verso Hud.jsx (fuori dal Canvas): pubblica editMode e
  // la posa home sullo stesso apiRef.current condiviso con
  // useComposerControls.js (dentro il Canvas) — Object.assign, mai
  // riassegnazione, perché i due scrittori non hanno un ordine garantito fra
  // loro (alberi React separati, uno dentro <Canvas>).
  useEffect(() => {
    if (!apiRef) return
    Object.assign(apiRef.current, { editMode, homePoseKey: homePose })
  }, [editMode, homePose, apiRef])

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 0.1, 5.2] }} // livellata sul pivot; il fov deriva dalla focale (useComposerControls)
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.0,
      }}
      style={{ width: '100%', height: '100%' }}
      // Con ?debug espone scena/camera per la verifica automatica delle pose
      // (screenshot + drag sintetici), come il pannello leva.
      onCreated={(state) => {
        if (new URLSearchParams(window.location.search).has('debug'))
          window.__r3f_state = state
      }}
      // Deseleziona quando si clicca sullo sfondo vuoto
      onPointerMissed={() => setSelectedMesh(null)}
    >
      <Suspense fallback={<Loader />}>
        {/* Modello centrato: ruotando su X i bordi non escono dal frame. */}
        <group position={[0, 0.1, 0]}>
          <KeyboardModel
            product={product}
            apiRef={apiRef}
            store={store}
            onSizeComputed={setModelSize}
            onSelectMesh={setSelectedMesh}
            // Due sorgenti indipendenti spengono drag/frecce:
            //  - Mesh, che blocca la posa (vedi sopra) — in Luci/Focus/Anim
            //    invece serve poter cambiare posa per autorare vista per vista
            //    (vedi anche onWheel in useComposerControls.js, che resta
            //    sempre attivo — zoom mai disattivato da nessuna modalità);
            //  - config_mode, la modalità di PRODOTTO in cui si comanda il
            //    modello dai pulsanti invece che a mano. Vale solo con
            //    editMode 'none': dentro un editor di authoring la
            //    navigazione deve restare viva comunque, altrimenti si
            //    autorerebbe alla cieca.
            controlsDisabled={editMode === 'meshes' || (appMode === 'config' && editMode === 'none')}
            editMode={editMode}
            homePoseKey={homePose}
            appMode={appMode}
            focusOverrides={focusOverrides}
          />
        </group>
        {/* Runtime: applica i materiali autorati al GLB. Prima era una riga
            dentro un pannello Leva, cioè i materiali di produzione dipendevano
            dal fatto che l'editor fosse montato. */}
        <MaterialApplier store={store} modelUrl={modelUrl} groups={meshGroups} />

        {/* Rig volumetrico: griglia di point light + rectAreaLight per faccia
            attorno al bounding box del modello, più le due luci-ombra
            (key/spot) con gizmo di editing. Sostituisce lo studio fotografico
            camera-solidale + Environment/Lightformer della vecchia versione:
            è l'unica sorgente di luce della scena. */}
        <LightRig
          modelSize={modelSize}
          apiRef={apiRef}
          store={store}
          editMode={editMode}
          product={product}
          keyLightRef={keyLightRef}
          spotLightRef={spotLightRef}
        />
        {/* L'authoring 3D: gizmo, helper, editor mesh e i tuner che hanno
            bisogno del GLB. Caricato solo in `?debug`, e dallo STESSO chunk
            dei pannelli DOM — un `import()` solo. */}
        {authoring && (
          <AuthoringScene
            store={store}
            apiRef={apiRef}
            product={product}
            selectedMesh={selectedMesh}
            onSelectMesh={setSelectedMesh}
            keyLightRef={keyLightRef}
            spotLightRef={spotLightRef}
          />
        )}
        {/* AGGIUNGI IL CONTROLLER */}
        {/* Esecutore delle animazioni autorate: un solo useFrame, nessun
            render. Sempre montato (non gated da ?debug): in produzione è chi
            fa girare le animazioni lanciate dai chip dell'HUD. */}
        <AnimationDirector
          modelUrl={modelUrl}
          apiRef={apiRef}
          store={store}
          animations={animations}
          editMode={editMode}
          meshGroups={meshGroups}
          meshVariants={meshVariants}
          release={release}
        />
        {/* Accende le mesh della variante scelta e spegne le alternative: nel
            GLB convivono tutte (ISO e ANSI insieme), quindi senza questo si
            compenetrano. */}
        <VariantController
          modelUrl={modelUrl}
          apiRef={apiRef}
          variants={meshVariants}
          selection={variantSelection}
        />
      </Suspense>
    </Canvas>
  )
}
