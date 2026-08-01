import { useEffect, useState } from 'react'
import styles from './Hud.module.css'
import { cycleVariant } from './runtime/variantCommands'

/**
 * HUD di prodotto — l'overlay grafico consegnato dal cliente (Dither, screen
 * `General Concept.png`). Vive nel DOM sopra il canvas, `pointer-events:none`:
 * solo la pulsantiera (chip di layout e animazioni, interruttore di modalità)
 * riattiva i click. Sempre montato (non gated da `?debug`): è UI di prodotto,
 * non tuning.
 *
 * Ha due facce, secondo `appMode` (vedi KeyboardComposer.jsx): in `idle`
 * restano solo lockup, telemetria, footer e l'interruttore "Configura" — il
 * modello si gira a mano; in `config` compaiono le due righe di chip (layout e
 * animazioni) e le gesture di navigazione sono spente, quindi è da qui che si
 * comanda tutto.
 *
 * ⚠️ La pulsantiera è deliberatamente MINIMA: niente paginazione `01–05` delle
 * pose e niente chip di zoom sui gruppi. Le pose e le inquadrature restano
 * primitive vive (`goTo`, `focusGroup`/`clearFocus` sul ponte imperativo), ma
 * in prodotto le guida SOLO un'animazione autorata — non c'era modo di avere
 * due scrittori sugli stessi target senza rendere metà pulsantiera inerte a
 * turno. Il pager e i chip di focus sono stati rimossi, non nascosti: non
 * reintrodurli qui, si autora un'animazione.
 *
 * ⚠️ Le animazioni non si FERMANO da qui: i chip sono un selettore. Una
 * sequenza finita lascia la scena come l'ha portata (zoom, opacità, rotazioni
 * persistenti) e la si azzera solo lanciandone una autorata `startFrom:
 * 'reset'` o uscendo da config_mode (Escape, o "Chiudi").
 *
 * ⚠️ Ed è QUI che si fa valere l'ordine delle sequenze: un'animazione che
 * dichiara un prerequisito (`requires`, vedi animation/animationSchema.js) ha
 * il chip spento finché quello non è stato eseguito. Il gate è nell'HUD e non
 * nel runtime per la stessa ragione della modalità di prodotto: in ?debug si
 * deve poter lanciare qualunque animazione mentre la si autora.
 *
 * Ponti imperativi (ref popolati dentro il Canvas):
 *  - `poseApi` → `currentPoseKey()` per la vista attiva in telemetria (poll
 *    leggero), `playAnimation`/`animationState` per i chip.
 *  - stesso ponte per lo zoom di prodotto (`clearFocus()`/`currentFocus()`,
 *    usati qui solo dalla scala di uscita di Escape).
 *
 * FPS = fps reali del browser, contati direttamente in `requestAnimationFrame`
 * (indipendenti dal render-loop R3F). MB = peso reale del modello caricato
 * (byte del `.glb`, da Performance Resource Timing).
 *
 * Font/colori/spaziatura arrivano dallo style guide: Suisse Int'l Mono,
 * letter-spacing −2%, sempre CAPS-LOCK (text-transform sul contenitore).
 */
export default function Hud({
  poseApi,
  store,
  animations,
  // Prodotto attivo: da qui vengono le varianti mostrate nei chip, le etichette
  // di posa del readout e l'URL del GLB di cui pesare i byte scaricati.
  product,
  variantSelection = {},
  // Modalità di prodotto: `idle` mostra il solo modello (si gira a mano),
  // `config` mostra la pulsantiera — layout e animazioni — mentre drag/frecce
  // sono spenti (vedi KeyboardComposer.jsx).
  // Prop e non poll sul ponte imperativo: lo stato vive nel genitore comune di
  // Canvas e overlay, quindi è un DATO, non un comando.
  appMode = 'idle',
  onAppModeChange,
  // `{ logoUrl, logoAlt, version, footer: [string] }`. Assente = nessun
  // marchio: il lockup del cliente non viaggia dentro il pacchetto.
  branding = null,
}) {
  const { meshVariants, poseGraph, modelUrl } = product

  const [poseKey, setPoseKey] = useState(null)
  const [locked, setLocked] = useState(false)
  const [animState, setAnimState] = useState({
    id: null,
    state: 'idle',
    waitingTrigger: null,
    // Sequenze: id delle animazioni già eseguite in questa sessione. Sono
    // quelle che sbloccano i chip di chi le dichiara come prerequisito.
    completed: [],
    completedKey: '',
  })
  const [fps, setFps] = useState(0)
  const [modelMB, setModelMB] = useState(null)
  const [ramMB, setRamMB] = useState(null)

  // Posa attiva (solo per la telemetria: la pulsantiera non naviga più) +
  // stato di blocco della modalità Mesh: poll leggero (imperativo, non
  // reattivo — stesso bridge di poseApi, popolato anche da Scene.jsx con
  // `editMode`).
  useEffect(() => {
    const id = setInterval(() => {
      const api = poseApi.current
      const k = api?.currentPoseKey?.() ?? null
      setPoseKey((prev) => (prev === k ? prev : k))

      const isLocked = (api?.editMode ?? 'none') === 'meshes'
      setLocked((prev) => (prev === isLocked ? prev : isLocked))

      // Animazione in corso + eventuale evento atteso: si deriva dalla
      // sorgente imperativa, non da stato locale, così resta onesto anche
      // quando l'animazione viene fermata da fuori (console di debug, o la
      // guardia all'ingresso in modalità Mesh).
      const anim = api?.animationState?.() ?? null
      const nextAnim = {
        id: anim && anim.state !== 'idle' ? anim.id : null,
        state: anim?.state ?? 'idle',
        waitingTrigger: anim?.waitingTrigger ?? null,
        completed: anim?.completed ?? [],
        completedKey: anim?.completedKey ?? '',
      }
      setAnimState((prev) =>
        prev.id === nextAnim.id &&
        prev.state === nextAnim.state &&
        prev.waitingTrigger?.name === nextAnim.waitingTrigger?.name &&
        prev.completedKey === nextAnim.completedKey
          ? prev
          : nextAnim,
      )
    }, 150)
    return () => clearInterval(id)
  }, [poseApi])

  // Uscita rapida, dal più specifico al più generico. ⚠️ Escape NON ferma più
  // l'animazione: un'animazione non si smonta a mano, lascia la scena come
  // l'ha portata e i soli modi formalizzati di azzerarla sono lanciarne
  // un'altra che riparte da zero (`startFrom: 'reset'`) o uscire da
  // config_mode — che è esattamente ciò che Escape fa qui quando ce n'è una
  // attiva, saltando il gradino intermedio dello zoom (che appartiene a lei).
  // L'uscita con Escape non è più qui: sta in runtime/useEscapeToIdle.js,
  // chiamato da KeyboardComposer. L'HUD è opzionale, l'uscita da `config` no.

  // FPS reali del browser: conto i frame di rAF e ricalcolo ogni ~500ms.
  // Questo è il refresh effettivo del browser (60, 120, 144, 240…), non un
  // valore derivato dal render-loop R3F.
  useEffect(() => {
    let raf
    let frames = 0
    let last = performance.now()
    const tick = () => {
      frames++
      const now = performance.now()
      const dt = now - last
      if (dt >= 500) {
        const f = Math.round((frames * 1000) / dt)
        setFps((prev) => (prev === f ? prev : f))
        frames = 0
        last = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Peso reale del modello: byte scaricati del `.glb` dal Performance Resource
  // Timing. Il fetch (drei useGLTF) può non essere ancora finito al mount →
  // ripeto finché la voce risorsa compare, poi mi fermo.
  useEffect(() => {
    let id
    const read = () => {
      // ⚠️ Si confronta il solo NOME DEL FILE, non l'URL intero. `modelUrl` può
      // essere assoluto (una CDN) o avere un hash di build, e in quel caso non
      // compare mai per intero dentro `e.name` — la telemetria mostrava
      // "0.00 MB" senza dire perché.
      const fileName = String(modelUrl).split('/').pop()
      const entry = performance
        .getEntriesByType('resource')
        .find((e) => e.name.endsWith(fileName))
      // encodedBodySize = byte del corpo (il file glb); transferSize può
      // essere 0 se servito da cache → fallback su encoded/decoded.
      const bytes =
        entry?.encodedBodySize || entry?.transferSize || entry?.decodedBodySize
      if (bytes) {
        setModelMB(bytes / (1024 * 1024))
        clearInterval(id)
      }
    }
    read()
    id = setInterval(read, 300)
    return () => clearInterval(id)
  }, [modelUrl])

  // RAM usata dalla tab per far girare il modello: `performance.memory`
  // (heap JS, non VRAM) esiste solo su Chrome/Edge — su Firefox/Safari resta
  // `null` e il contatore mostra "—".
  useEffect(() => {
    if (!performance.memory) return
    const read = () => setRamMB(performance.memory.usedJSHeapSize / (1024 * 1024))
    read()
    const id = setInterval(read, 500)
    return () => clearInterval(id)
  }, [])

  const viewLabel = poseKey ? poseGraph.label(poseKey) : '—'
  const memLabel = modelMB != null ? `${modelMB.toFixed(2)} MB` : '— MB'
  const fpsLabel = fps.toFixed(2)
  const ramLabel = ramMB != null ? `RAM ${Math.round(ramMB)} MB` : 'RAM —'

  const animItems = (animations?.items ?? []).filter((a) => a.hidden !== true)

  // In idle l'HUD è ridotto al lockup + telemetria + footer: la pulsantiera
  // (layout e animazioni) è la superficie di config_mode, dove la navigazione
  // a mano è spenta e il modello si comanda solo da qui. Nascosta, non
  // disabilitata: in idle non c'è nulla da configurare, e un pulsante inerte
  // sarebbe rumore.
  const configMode = appMode === 'config'

  // Fa RUOTARE una variante di modello: dall'opzione corrente alla successiva,
  // e dall'ultima si torna alla prima. Un solo comando invece di un pulsante
  // per opzione — con due opzioni è un interruttore, con più di due è un giro.
  //
  // Lo scambio passa SEMPRE da un'animazione, mai da uno scatto: se per quella
  // variante ne è stata autorata una (binding nell'editor) si lancia quella,
  // altrimenti l'integrata (`BUILTIN_VARIANT_SWAP_ID`, un incrocio morbido in
  // dissolvenza — vedi animationSchema.js). Lo scatto resta solo come rete di
  // sicurezza per quando il runtime non c'è ancora o l'id non si risolve.
  // La regola dello scambio (animazione autorata → integrata → scatto secco)
  // vive in runtime/variantCommands.js: era l'unico posto del codice che la
  // conoscesse, ed era dentro un overlay opzionale.
  const handleCycleVariant = (variant) =>
    cycleVariant(poseApi.current, variant, variantSelection, animations)

  return (
    <div className={styles.hud} aria-hidden="false">
      {/* ── Riga superiore ──────────────────────────────────────────────── */}
      <header className={styles.top}>
        {/* ⚠️ Il lockup NON è più cablato qui. Era il logo del cliente, con la
            sua URL assoluta: un pacchetto che se lo porta dietro lo spedisce a
            chiunque lo installi. Ora arriva dalla prop `branding`, e senza
            quella prop semplicemente non c'è marchio. */}
        <div className={styles.brand}>
          {branding?.logoUrl && (
            <img
              className={styles.logo}
              src={branding.logoUrl}
              alt={branding.logoAlt ?? ''}
              draggable="false"
            />
          )}
        </div>

        <div className={styles.telemetry}>
          <span>FPS {fpsLabel}</span>
          <i className={styles.sep} />
          <span>{viewLabel}</span>
          <i className={styles.sep} />
          <span>{memLabel}</span>
          <i className={styles.sep} />
          <span>{ramLabel}</span>
        </div>

        <div className={styles.version}>{branding?.version ?? ''}</div>
      </header>

      {/* ── Pila dei chip ──────────────────────────────────────────────────
          Le righe (varianti, animazioni e in fondo l'interruttore di modalità)
          stanno in UNA colonna flex, non a quote assolute calcolate come
          multipli di --chip-h: basta che una riga vada a capo perché le quote
          fisse le facciano sovrapporre. Impilandole, ogni riga occupa
          l'altezza che le serve e le altre si spostano da sole. L'ordine nel
          DOM è quello visivo, dall'alto in basso. */}
      <div className={styles.chipStack}>
      {configMode && (
      <>
      {/* ── Varianti di modello (il "layout") ──────────────────────────────
          UN comando per variante (layout ISO/ANSI oggi, in futuro il rialzo o
          altro), non un pulsante per opzione: mostra quella accesa e a ogni
          clic passa alla successiva, tornando alla prima dopo l'ultima. Con
          due opzioni è un interruttore, con più di due è un giro — e il
          comando resta uno solo comunque, il che è il motivo per cui è fatto
          così: la pulsantiera non cresce con le opzioni. Quando ce n'è più di
          due si mostra anche a che punto del giro si è.
          L'elenco viene dalla prop `meshVariants`, quindi aggiungerne una non
          richiede toccare questo file. La scelta è ricordata per la sessione
          della scheda ed è ciò che decide quali mesh alternative del GLB sono
          accese — vedi materials/meshVariants.js. */}
      {meshVariants.length > 0 && (
        <nav className={styles.variantBar} aria-label="Varianti">
          {meshVariants.map((variant) => {
            const options = variant.options ?? []
            if (options.length === 0) return null
            const i = options.findIndex((o) => o.id === variantSelection[variant.id])
            const current = options[i] ?? options[0]
            const next = options[(Math.max(i, 0) + 1) % options.length]
            // Una variante con una sola opzione non ha nulla da ruotare: resta
            // a video come lettura di stato, ma non è un comando.
            // Spento anche in modalità Mesh come il resto della pila, per un
            // motivo tutto suo: l'animazione di swap prenderebbe i pivot del
            // registry sulle stesse mesh che l'editor tiene avvolte nel suo, e
            // i due non devono MAI essere vivi insieme.
            const single = options.length < 2
            const disabled = locked || single
            return (
              <span key={variant.id} className={styles.variantGroup} role="group" aria-label={variant.label}>
                <span className={styles.variantLabel}>{variant.label}</span>
                <button
                  type="button"
                  className={`${styles.variantCycle} ${disabled ? styles.variantChipDisabled : ''}`}
                  aria-disabled={disabled || undefined}
                  disabled={disabled}
                  aria-label={
                    single
                      ? `${variant.label}: ${current.label}`
                      : `${variant.label}: ${current.label}. Passa a ${next.label}`
                  }
                  title={single ? undefined : `Passa a ${next.label}`}
                  onClick={() => {
                    if (disabled) return
                    handleCycleVariant(variant)
                  }}
                >
                  <span>{current.label}</span>
                  {options.length > 2 && (
                    <span className={styles.variantCount} aria-hidden="true">
                      {Math.max(i, 0) + 1}/{options.length}
                    </span>
                  )}
                  {!single && (
                    <span className={styles.variantNext} aria-hidden="true">
                      ↻
                    </span>
                  )}
                </button>
              </span>
            )
          })}
        </nav>
      )}

      {/* ── Animazioni autorate ────────────────────────────────────────────
          Un chip per animazione visibile — con la rimozione del pager e dei
          chip di zoom sono l'unica cosa che muove il modello in prodotto.
          ⚠️ È un SELETTORE, non un interruttore: il click
          lancia sempre, e sull'animazione già attiva la rilancia da capo —
          non la ferma. Un'animazione lascia la scena come l'ha portata (zoom,
          opacità, rotazioni persistenti restano) e si azzera solo lanciandone
          una autorata con "al play: azzera lo stato precedente", oppure
          uscendo da config_mode. Quando uno step `waitTrigger` blocca la
          sequenza compare un chip in più, che è la superficie di prodotto
          degli eventi opzionali (es. "avvia i rotori"). Le animazioni sono
          autorate in ?debug e arrivano dal JSON globale. */}
      {(animItems.length > 0 || animState.waitingTrigger) && (
        <nav className={styles.animBar} aria-label="Animazioni">
          {animItems.map((anim) => {
            const active = anim.id === animState.id
            // Sequenza: un'animazione con un prerequisito resta spenta finché
            // quello non è stato ESEGUITO (arrivato a fine wave) in questa
            // sessione — l'avanzamento si azzera cambiando modalità. Lo stato
            // arriva dal runtime, unico a sapere quando una sequenza finisce.
            const before = anim.requires
              ? (animations?.items ?? []).find((a) => a.id === anim.requires)
              : null
            const chainLocked = !!anim.requires && !animState.completed.includes(anim.requires)
            const disabled = locked || chainLocked
            return (
              <button
                key={anim.id}
                type="button"
                className={`${styles.animChip} ${active ? styles.animChipActive : ''} ${disabled ? styles.animChipDisabled : ''} ${chainLocked && !locked ? styles.animChipLocked : ''}`}
                aria-pressed={active}
                aria-disabled={disabled || undefined}
                disabled={disabled}
                title={chainLocked ? `Prima: ${before?.label ?? anim.requires}` : undefined}
                onClick={() => {
                  if (disabled) return
                  // Anche sull'attiva: rilancia. Cosa succede a ciò che sta
                  // già in scena lo decide l'animazione stessa col suo
                  // `startFrom`, non questo pulsante.
                  poseApi.current?.playAnimation?.(anim.id)
                }}
              >
                {anim.label}
              </button>
            )
          })}
          {animState.waitingTrigger && (
            <button
              type="button"
              className={`${styles.animChip} ${styles.animChipTrigger}`}
              onClick={() => poseApi.current?.triggerAnimation?.(animState.waitingTrigger.name)}
            >
              {animState.waitingTrigger.label}
            </button>
          )}
        </nav>
      )}

      </>
      )}

      {/* ── Interruttore idle ⇄ config ──────────────────────────────────────
          L'unico comando presente in ENTRAMBE le modalità: sta per ULTIMO
          nella pila, cioè in basso, così resta alla stessa quota mentre le
          righe sopra compaiono e scompaiono. In modalità Mesh è inerte come
          tutto il resto: lì la posa è bloccata e i pivot dell'editor non
          devono mai convivere con quelli di un'animazione. */}
      <nav className={styles.modeBar} aria-label="Modalità">
        <button
          type="button"
          className={`${styles.modeBtn} ${configMode ? styles.modeBtnActive : ''} ${locked ? styles.modeBtnDisabled : ''}`}
          aria-pressed={configMode}
          aria-disabled={locked || undefined}
          disabled={locked}
          onClick={() => {
            if (locked) return
            onAppModeChange?.(configMode ? 'idle' : 'config')
          }}
        >
          {configMode ? 'Chiudi' : 'Configura'}
        </button>
      </nav>
      </div>

      {/* ── Riga inferiore ──────────────────────────────────────────────────
          Tre celle libere, vuote se non c'è `branding.footer`: le diciture
          interne ("For internal use only") appartengono al playground, non a
          un componente che finisce dentro il sito di qualcun altro. */}
      {branding?.footer?.length > 0 && (
        <footer className={styles.bottom}>
          {branding.footer.map((cell, i) => (
            <span key={i}>{cell}</span>
          ))}
        </footer>
      )}
    </div>
  )
}
