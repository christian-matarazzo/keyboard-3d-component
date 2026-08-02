import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import styles from './KeyboardComposer.module.css'
import Scene from './Scene'
import Hud from './Hud'
import { setDracoPath } from './KeyboardModel'
import { normalizeVariantSelection } from './materials/meshVariants'
import { DEFAULT_PRODUCT_ID, resolveProduct } from './products'
import { EMPTY_ANIMATIONS } from './animation/animationSchema'
import ConfigLoader from './runtime/ConfigLoader'
import { createPublicApi } from './runtime/publicApi'
import { useEscapeToIdle } from './runtime/useEscapeToIdle'
import { createComposerStore } from './state/composerStore'
import { createInitialState } from './state/defaults'
import { useComposerSection } from './state/useComposerSection'
import { isDebug } from './state/debug'

// ⚠️ L'UNICO import dinamico del componente, e il motivo per cui l'authoring
// non pesa in produzione. Stesso specificatore usato da Scene.jsx per la metà
// 3D: un chunk solo per entrambi.
const AuthoringDom = lazy(() => import('./authoring').then((m) => ({ default: m.AuthoringDom })))

// Scelta delle varianti ricordata per la SESSIONE della scheda: sopravvive a un
// reload, si azzera chiudendo la scheda, che è dove riparte il default autorato.
// La chiave è per PRODOTTO: due modelli hanno varianti diverse, e una scelta
// ricordata dall'uno non ha significato per l'altro.
const variantStorageKey = (productId) => `keyboardComposer.variants.${productId}`

const readStoredVariants = (productId) => {
  try {
    return JSON.parse(sessionStorage.getItem(variantStorageKey(productId))) ?? null
  } catch {
    return null // sessionStorage può essere negato (Safari privato, iframe)
  }
}

// La sezione `app` del JSON globale (`idleAnimation`, i tempi del rientro) e i
// suoi default abitano in state/defaults.js insieme a tutti gli altri: qui resta
// solo il pezzo che dipende dal PRODOTTO e che quindi non poteva stare in una
// costante — la posa home. Vedi lì per il perché di ogni campo.

/**
 * Posa home di partenza di un prodotto: la posa d'ingresso landscape dichiarata
 * nel suo grafo, o la prima dichiarata se quell'ingresso non cade esattamente
 * su una posa. È solo il valore INIZIALE — la home vera si autora in ?debug e
 * arriva dalla sezione `app` del JSON di configurazione.
 */
const defaultHomePose = (poseGraph) =>
  poseGraph.findPoseKey(poseGraph.entryLandscape.x, poseGraph.entryLandscape.y) ??
  poseGraph.keys[0]


/**
 * Vetrina 3D della tastiera a piena vista: nessun pannello di configurazione,
 * solo il modello. Trascina in verticale per il flusso front/retro a step di
 * 45°; in vista frontale trascina in orizzontale per i ±45° laterali.
 */
export default function KeyboardComposer({
  // PRODOTTO — l'unità sostituibile del configuratore: GLB, JSON di
  // configurazione, grafo delle pose, gruppi di mesh e varianti in un solo
  // oggetto (vedi products/productSchema.js per il perché stanno insieme).
  // Tre forme accettate:
  //   product="ARRAY_MODEL_L"      id enumerativo del registro (PRODUCT_IDS)
  //   product={ARRAY_MODEL_L}      prodotto già definito
  //   product={{ ...ARRAY_MODEL_L, modelUrl: '…' }}   definizione derivata
  product = DEFAULT_PRODUCT_ID,
  // Override puntuali, precedenti al concetto di prodotto e ancora supportati
  // come scorciatoia: sovrascrivono il campo omonimo del prodotto risolto.
  // Per un modello nuovo si dichiara un prodotto, non si passano queste tre.
  modelUrl,
  meshGroups,
  meshVariants,
  // --- Integrazione -------------------------------------------------------
  // Chiamata UNA volta quando il componente è pronto a ricevere comandi, con
  // la facciata di runtime/publicApi.js. È il contratto consigliato: `poseApi`
  // viene riempito da sette scrittori in momenti diversi, quindi non esiste un
  // istante in cui "è pronto" che il chiamante possa indovinare da fuori — un
  // pulsante che chiamasse `play` troppo presto fallirebbe in silenzio.
  onReady,
  // Stessa facciata, per chi preferisce un ref React. Si può usare insieme a
  // `onReady`: sono due viste dello stesso oggetto.
  apiRef: externalApiRef,
  // Overlay DOM di prodotto (chip, selettori, telemetria). Spento di default:
  // chi integra il componente disegna i propri pulsanti e li collega all'API.
  // Il playground lo accende.
  hud = false,
  // `{ logoUrl, version, footer }` per l'HUD. Vuoto = nessun lockup: il
  // marchio interno non deve viaggiare dentro il pacchetto.
  branding = null,
  // Escape esce da `config`. È l'unica uscita da tastiera e NON dipende
  // dall'HUD: senza, chi non monta l'HUD lascia l'utente in una modalità con
  // drag e frecce spenti.
  escapeToIdle = true,
  // Carica l'ambiente di authoring (pannelli, editor, gizmo). Di default segue
  // `?debug` nell'URL; un integratore può forzarlo per aprire l'editor su una
  // propria rotta. Valutato UNA volta: il confine è un `import()`, non un
  // ramo di render.
  authoring: authoringProp,
  // Catena di post-processing (MSAA sul render target, e da qui in avanti
  // l'occlusione ambientale). Acceso di default; è una prop e non un valore
  // autorato perché l'accensione deve essere SINCRONA — vedi Scene.jsx. Chi
  // integra su hardware debole la spegne e torna esattamente al percorso di
  // rendering di prima.
  postfx = true,
}) {
  const authoringRef = useRef(authoringProp ?? isDebug())
  const authoring = authoringRef.current
  // Un solo punto di risoluzione, memoizzato: il prodotto risolto è dipendenza
  // di effetti e di useMemo in tutto l'albero, quindi la sua IDENTITÀ deve
  // essere stabile fra i render. Senza override e con un id del registro,
  // `resolveProduct` restituisce lo stesso oggetto congelato ogni volta.
  const resolved = useMemo(
    () => resolveProduct(product, { modelUrl, meshGroups, meshVariants }),
    [product, modelUrl, meshGroups, meshVariants],
  )
  // Gli altri campi del prodotto scendono dentro `resolved`: qui servono solo
  // il grafo (posa home di default) e le varianti (selezione utente).
  const { poseGraph, meshVariants: activeMeshVariants } = resolved
  // Specchio del prodotto risolto per i getter della facciata pubblica, che è
  // costruita una volta sola e non può chiudere su un valore di render.
  const productRef = useRef(resolved)
  productRef.current = resolved

  // ⚠️ Prima di qualunque `useGLTF`, e quindi in fase di render e non in un
  // effetto: il percorso del decoder Draco entra nella chiave di cache di drei,
  // e cambiarlo dopo il primo caricamento significherebbe un secondo decoder e
  // un secondo scaricamento del GLB. Idempotente e senza stato React — vedi
  // setDracoPath in KeyboardModel.jsx per il perché è globale.
  setDracoPath(resolved.dracoPath)
  const { progress } = useProgress()
  // Stato (non derivato al volo da `progress`): con l'asset già in cache
  // (visita successiva, mobile o desktop) `progress` può essere 100 già al
  // primissimo render, prima che il browser abbia dipinto lo stato opacity:0
  // di partenza — la transizione CSS del fade non avrebbe nulla da cui
  // animare e sparirebbe. Il giro di rAF garantisce che il primo paint
  // avvenga sempre a opacità 0, così il fade-in resta visibile in ogni caso.
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (progress !== 100) return
    const raf = requestAnimationFrame(() => setLoaded(true))
    return () => cancelAnimationFrame(raf)
  }, [progress])

  // Ponte fra gli overlay DOM (HUD, editor animazioni) e i controlli dentro il
  // Canvas: il ref viene popolato da useComposerControls con le pose/il focus
  // (`goTo`, `currentPoseKey`, `focusGroup`, `clearFocus`, `currentFocus`,
  // `isPoseSettled`, `isFocusSettled`), da AnimationDirector.jsx coi comandi
  // delle animazioni (`playAnimation`, `stopAnimation`, `currentAnimation`,
  // `animationState`, `triggerAnimation`), da Scene.jsx con
  // `{ editMode, homePoseKey }` e da questo stesso componente con le varianti
  // e la modalità di prodotto (`appMode`, `setAppMode`, `toggleAppMode`) —
  // seedato a un oggetto
  // vuoto (mai null) perché più scrittori indipendenti (alberi React diversi,
  // uno dentro <Canvas>) fanno Object.assign su di esso senza un ordine
  // garantito fra loro.
  const poseApi = useRef({})

  // --- Stato autorato -----------------------------------------------------
  // Il gemello del ponte imperativo, per i DATI: luci, materiali, feel della
  // camera, inquadrature, animazioni. Nasce qui — nello stesso punto in cui
  // nasce `poseApi`, e per la stessa ragione: questo componente è l'unico
  // antenato comune del Canvas e degli overlay DOM.
  //
  // Creato una volta sola e mai ricreato (il ref lazy invece di useState): la
  // sua identità è dipendenza di effetti in tutto l'albero, e uno store nuovo a
  // metà sessione butterebbe via lo stato autorato appena caricato. Vedi
  // state/composerStore.js per il perché di uno store al posto degli otto
  // `window.__STATE_*` e degli otto CustomEvent che c'erano prima.
  const storeRef = useRef(null)
  if (storeRef.current === null) {
    // La posa home compare in due sezioni e non è una svista: in `app` perché
    // è stato di prodotto e si salva, in `ui` perché è anche la manopola
    // dell'editor. Scene tiene allineate le due (vedi syncHomePose lì).
    const homePose = defaultHomePose(poseGraph)
    storeRef.current = createComposerStore(
      createInitialState({ app: { homePose }, ui: { homePose } }),
    )
  }
  const store = storeRef.current

  // --- Modalità di prodotto ('idle' | 'config') ---------------------------
  // `idle` è il modello nudo: si gira a mano (drag/frecce) e basta — nessun
  // chip, nessuna paginazione, nessuna animazione. `config` è il contrario:
  // il modello si comanda dai PULSANTI (viste, varianti, zoom sui gruppi,
  // animazioni autorate) e le gesture/i tasti di navigazione sono spenti, così
  // non ci sono due scrittori sui target di posa/zoom mentre una sequenza
  // gira. È il motivo per cui le animazioni salvate nel JSON hanno una
  // superficie di prodotto dedicata invece di essere sempre lanciabili.
  //
  // Lo stato vive qui (come `animations` e le varianti) perché questo
  // componente rende sia il Canvas sia gli overlay DOM: scende come prop, non
  // ha bisogno del ponte imperativo. Su `poseApi` va solo il COMANDO, per
  // chi non è figlio di questo albero (console di debug, futuri chiamanti).
  const [appMode, setAppMode] = useState('idle')
  // Modalità corrente letta dentro `changeAppMode`, che è una closure stabile
  // (deps []) usata anche da chi la raggiunge via `poseApi`. Gli effetti della
  // transizione stanno FUORI dall'updater di setState: un updater deve restare
  // puro (React lo può rieseguire — StrictMode lo fa di sistema), qui invece
  // ogni chiamata deve fermare l'animazione e riportare a casa esattamente una
  // volta.
  const appModeRef = useRef(appMode)
  appModeRef.current = appMode

  // Configurazione dell'app che non è né luce né materiale: l'animazione di
  // rientro in idle, i tempi della dissolvenza di uscita e la posa home.
  // Autorate nell'editor (?debug) e salvate nella sezione `app` del JSON.
  const appConfig = useComposerSection(store, 'app')
  const appConfigRef = useRef(appConfig)
  appConfigRef.current = appConfig
  const animationsRef = useRef(EMPTY_ANIMATIONS)

  // Aggiornamento PARZIALE: le chiavi che questa chiamata non nomina restano
  // quelle di prima — è il comportamento che serve sia all'editor (che tocca
  // una manopola per volta) sia al caricamento di un JSON più vecchio della
  // sezione, dove le chiavi mancanti devono restare ai default.
  const patchAppConfig = useCallback((patch) => store.set('app', patch), [store])

  // Identità stabile: Scene la usa come dipendenza di un effetto, e una
  // funzione ricreata a ogni render lo farebbe rigirare a vuoto.
  const handleHomePoseChange = useCallback(
    (homePose) => store.set('app', { homePose }),
    [store],
  )

  const changeAppMode = useCallback((next) => {
    const mode = next === 'config' ? 'config' : 'idle'
    if (appModeRef.current === mode) return
    appModeRef.current = mode
    setAppMode(mode)

    const api = poseApi.current
    // Le sequenze ripartono dal primo anello a ogni cambio di modalità, in
    // ENTRAMBI i versi: è lo stesso ragionamento della posa home e dello
    // smontaggio qui sotto — questo è l'unico punto in cui la scena torna a uno
    // stato noto, quindi è l'unico in cui ha senso che "A1 è stata eseguita"
    // decada. Prima del rientro autorato: anche quello è un play.
    api?.resetAnimationProgress?.()

    // Rientro in idle con una transizione AUTORATA: se è stata indicata
    // un'animazione (tipicamente "GoIdle") è lei a riportare la scena a
    // riposo, e fa tutto da sé — zoom, opacità, posa.
    //
    // ⚠️ `keep: true` non è un dettaglio: un play che azzera lo stato
    // precedente smonterebbe proprio ciò che questa animazione deve
    // disfare, e i suoi `clearFocus`/`setOpacity` non troverebbero più
    // nulla da dissolvere (stessa trappola documentata per `clearFocus`
    // in CLAUDE.md). L'animazione dovrebbe avere `stopOnFinish` acceso, o
    // le istanze ereditate resterebbero vive in idle.
    const idleAnim = appConfigRef.current.idleAnimation
    const hasIdleAnim =
      mode === 'idle' &&
      idleAnim &&
      (animationsRef.current?.items ?? []).some((a) => a.id === idleAnim)
    if (hasIdleAnim) {
      api?.playAnimation?.(idleAnim, { keep: true })
      return
    }

    // Senza animazione di rientro (o entrando in config): transizione secca.
    // Lo zoom su un gruppo appartiene alla sessione di configurazione e non
    // sopravvive in nessuno dei due versi; `stopAnimation` è il teardown vero
    // (opacità/pivot/varianti — vedi animation/) e va prima del movimento di
    // camera. Da qui in poi lo smontaggio è comunque MORBIDO: l'opacità
    // rientra in dissolvenza e lo zoom esce col proprio smorzamento.
    //
    // ⚠️ Lo smontaggio vale in ENTRAMBI i versi, non solo uscendo. Le
    // animazioni non si fermano più a mano da nessuna superficie di prodotto
    // (l'HUD le seleziona soltanto, vedi Hud.jsx): il cambio di modalità è
    // rimasto l'unico punto in cui la scena torna a uno stato noto, quindi
    // deve azzerare anche entrando — o un'animazione di rientro senza
    // `stopOnFinish` lascerebbe istanze vive dentro la sessione successiva.
    api?.clearFocus?.()
    api?.stopAnimation?.()
    // La posa home è il punto di partenza di ENTRAMBE le modalità: idle ci
    // rientra, e config ci parte, così ogni animazione autorata trova sempre
    // lo stesso stato iniziale invece della posa in cui l'utente ha lasciato
    // il modello girando a mano.
    const home = api?.homePoseKey
    if (home) api?.goTo?.(home)
  }, [])

  useEffect(() => {
    Object.assign(poseApi.current, {
      appMode: () => appMode,
      setAppMode: changeAppMode,
      toggleAppMode: () => changeAppMode(appMode === 'config' ? 'idle' : 'config'),
    })
  }, [appMode, changeAppMode])

  // Animazioni autorate. Vengono dallo store e scendono come PROP normali sia
  // nel sottoalbero del Canvas (<Scene>) sia negli overlay DOM (<Hud>,
  // <AnimationEditor>): solo i COMANDI hanno bisogno di `poseApi`.
  // La normalizzazione di schema avviene una volta all'ingresso, in
  // runtime/productConfig.js, non a ogni lettura.
  const animations = useComposerSection(store, 'animations')
  const setAnimations = useCallback((next) => store.replace('animations', next), [store])
  // Letto dentro `changeAppMode` (closure stabile) per verificare che
  // l'animazione di rientro esista davvero prima di lanciarla.
  animationsRef.current = animations

  // --- Varianti -----------------------------------------------------------
  // ⚠️ Le due metà della sezione `variants` hanno natura OPPOSTA e da qui in
  // poi vengono trattate in modo diverso:
  //
  //  - la SELEZIONE (quale layout è acceso) è stato dell'UTENTE, e non si
  //    salva nel JSON. Precedenza: scelta di sessione → `defaultOption`
  //    dichiarato in materials/meshVariants.js. Non c'è un terzo gradino: un
  //    layout di partenza autorato nel file di configurazione significherebbe
  //    che ricaricare la configurazione riporta l'utente su una scelta non
  //    sua, ed è una decisione di prodotto, non un'omissione. Un JSON più
  //    vecchio che contiene ancora `variants.selection` viene ignorato, non
  //    migrato (vedi il listener più sotto).
  //  - i BINDING variante → animazione di swap sono CONFIGURAZIONE autorata
  //    (nell'AnimationEditor, blocco "swap delle varianti") e restano nel
  //    JSON. ⚠️ Un binding assente non vuol dire "scambio di scatto": vuol dire
  //    l'animazione INTEGRATA (un incrocio morbido in dissolvenza, vedi
  //    BUILTIN_ANIMATIONS in animation/animationSchema.js). Autorarne una è
  //    quindi solo "la mia al posto di quella di serie".
  //
  // Il seed legge sessionStorage una sola volta.
  const [variantSelection, setVariantSelection] = useState(() =>
    normalizeVariantSelection(readStoredVariants(resolved.id), activeMeshVariants),
  )
  // Binding variante → animazione di swap, autorato e salvato nel JSON.
  const variantAnimations = useComposerSection(store, 'variants').swapAnimations
  const setVariantAnimations = useCallback(
    (swapAnimations) => store.set('variants', { swapAnimations }),
    [store],
  )

  // La selezione vive SOLO qui e in sessionStorage: sopravvive a un reload,
  // si azzera chiudendo la scheda, e non lascia traccia nel JSON globale.
  useEffect(() => {
    try {
      sessionStorage.setItem(variantStorageKey(resolved.id), JSON.stringify(variantSelection))
    } catch {
      /* storage negato: la scelta resta valida per il solo tempo di vita della pagina */
    }
  }, [variantSelection, resolved.id])

  // Nella sezione `variants` finiscono i soli binding, mai `selection`: è
  // `normalizeConfig` (runtime/productConfig.js) a scartarla in ingresso. Se un
  // giorno servisse rimetterla, va rimessa anche la precedenza "scelta di
  // sessione sopra il default caricato" — è quella che impediva a un
  // caricamento di configurazione di ributtare l'utente sul layout di partenza.

  // Comandi delle varianti sul ponte condiviso: li usano sia i toggle dell'HUD
  // sia l'azione `setVariant` del sequencer, che vive dentro il Canvas.
  useEffect(() => {
    Object.assign(poseApi.current, {
      currentVariants: () => variantSelection,
      variantSwapAnimation: (variantId) =>
        variantAnimations?.[variantId] ??
        activeMeshVariants.find((v) => v.id === variantId)?.swapAnimation ??
        null,
      setVariant: (variantId, optionId) =>
        setVariantSelection((prev) =>
          prev[variantId] === optionId ? prev : { ...prev, [variantId]: optionId },
        ),
    })
  }, [variantSelection, variantAnimations, activeMeshVariants])

  // --- Superficie pubblica -------------------------------------------------
  // Costruita una volta sola: legge tutto attraverso getter, quindi non va
  // ricreata quando cambiano animazioni, varianti o modalità — e un'identità
  // stabile è ciò che permette a chi la riceve di tenersela.
  const publicApi = useRef(null)
  if (publicApi.current === null) {
    publicApi.current = createPublicApi({
      apiRef: poseApi,
      getAnimations: () => animationsRef.current,
      getVariants: () => productRef.current.meshVariants,
      getPoseGraph: () => productRef.current.poseGraph,
    })
  }
  if (externalApiRef) externalApiRef.current = publicApi.current

  // `onReady` scatta quando il modello è caricato E il ponte ha i comandi che
  // servono: prima di quel momento un `play` cadrebbe nel vuoto senza dirlo.
  // Una volta sola, come si conviene a un contratto d'inizializzazione.
  const readyRef = useRef(false)
  useEffect(() => {
    if (readyRef.current || !loaded || !onReady) return
    if (!poseApi.current.playAnimation || !poseApi.current.goTo) return
    readyRef.current = true
    onReady(publicApi.current)
  }, [loaded, onReady])

  // Uscita da `config` con Escape: vive fuori dall'HUD perché l'HUD è
  // opzionale e l'uscita no.
  useEscapeToIdle({
    apiRef: poseApi,
    appMode,
    onAppModeChange: changeAppMode,
    enabled: escapeToIdle,
  })

  return (
    <section className={styles.section}>
      {/* Scarica il JSON autorato e idrata lo store. Parte al primo mount,
          prima del Canvas: con uno store l'ordine non conta più. */}
      <ConfigLoader store={store} product={resolved} />
      {/* Tutto l'authoring — pannelli Leva, editor animazioni, editor mesh e
          `leva` con le sue dipendenze — sta dietro questo `import()`. In
          produzione non viene scaricato: vedi authoring/index.jsx. */}
      {authoring && (
        <Suspense fallback={null}>
          <AuthoringDom
            store={store}
            poseApi={poseApi}
            product={resolved}
            animations={animations}
            onAnimationsChange={setAnimations}
            variantAnimations={variantAnimations}
            onVariantAnimationsChange={setVariantAnimations}
            appConfig={appConfig}
            onAppConfigChange={patchAppConfig}
          />
        </Suspense>
      )}
      <div
        className={`${styles.canvasWrap} ${loaded ? styles.canvasWrapLoaded : ''}`}
      >
        <Scene
          product={resolved}
          apiRef={poseApi}
          store={store}
          authoring={authoring}
          postfx={postfx}
          animations={animations}
          variantSelection={variantSelection}
          appMode={appMode}
          // Tempi del rientro di uscita, per il runtime delle animazioni: la
          // dissolvenza dell'opacità e il riposizionamento delle mesh, che
          // corrono insieme ma con durate proprie.
          release={{
            duration: appConfig.releaseDuration,
            easing: appConfig.releaseEasing,
            transforms: appConfig.releaseTransforms !== false,
            transformsDuration: appConfig.releaseTransformsDuration,
            transformsEasing: appConfig.releaseTransformsEasing,
          }}
          // La posa home nasce da una Leva dentro Scene e risale qui solo per
          // essere salvata insieme al resto della sezione `app`.
          onHomePoseChange={handleHomePoseChange}
        />
        {hud && (
          <Hud
            poseApi={poseApi}
            store={store}
            animations={animations}
            product={resolved}
            variantSelection={variantSelection}
            appMode={appMode}
            onAppModeChange={changeAppMode}
            branding={branding}
          />
        )}
      </div>
    </section>
  )
}
