import { useEffect, useMemo, useState } from 'react'
import styles from './AnimationEditor.module.css'
import { ACTIONS, ACTION_GROUPS } from './animation/actions'
import { EASING_NAMES } from './animation/easings'
import { SELECTOR_KINDS } from './animation/selectors'
import { buildWaves, newAnimation, newStep, normalizeAnimations } from './animation/animationSchema'
import { DEFAULT_MESH_GROUPS } from './materials/meshGroups'
import { POSE_COORD, POSE_HUD_LABEL } from './poseGraph'

const DEBUG = new URLSearchParams(window.location.search).has('debug')

// POSE_HUD_LABEL ha etichette duplicate per design (più pose condividono la
// stessa label breve): si disambigua accodando la chiave, come
// LOCKED_POSE_OPTIONS in Scene.jsx.
const POSE_OPTIONS = Object.keys(POSE_COORD).map((key) => ({
  key,
  label: `${POSE_HUD_LABEL[key] ?? key} · ${key}`,
}))

const WAIT_LABEL = { settle: 'attendi', duration: 'durata', none: 'subito' }

/**
 * Editor delle animazioni autorate (?debug + editMode 'anim') — sostituisce la
 * vecchia Timeline a keyframe.
 *
 * Overlay DOM fuori dal Canvas, stessi idiomi di Hud.jsx: `DEBUG` ricalcolato
 * in locale, un poll a 150 ms sul ponte imperativo `poseApi` (per `editMode` e
 * per lo stato del runtime, che vive in ref dentro il Canvas e non in stato
 * React), `null` se non siamo in modalità.
 *
 * Due viste sugli STESSI dati:
 *  - lista a blocchi: una riga per step, coi campi dei parametri GENERATI dallo
 *    schema del registry (animation/actions.js) — aggiungere un'azione lì la fa
 *    comparire qui senza toccare questo file;
 *  - vista JSON: una textarea con testo in stato LOCALE, così un JSON a metà
 *    digitazione non distrugge il modello; si applica solo con "Applica",
 *    passando da `normalizeAnimations`.
 */
export default function AnimationEditor({
  poseApi,
  animations,
  onChange,
  meshGroups = DEFAULT_MESH_GROUPS,
}) {
  const [editMode, setEditMode] = useState(null)
  const [runState, setRunState] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [showJson, setShowJson] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState(null)
  const [meshCatalog, setMeshCatalog] = useState([])
  const [collapsed, setCollapsed] = useState(false)

  const items = animations?.items ?? []
  const current = items.find((a) => a.id === selectedId) ?? items[0] ?? null

  // Poll unico: modalità editor + stato del sequencer.
  useEffect(() => {
    const id = setInterval(() => {
      const api = poseApi.current
      const mode = api?.editMode ?? 'none'
      setEditMode((prev) => (prev === mode ? prev : mode))
      const st = api?.animationState?.() ?? null
      setRunState((prev) => {
        if (prev === st) return prev
        if (
          prev &&
          st &&
          prev.id === st.id &&
          prev.state === st.state &&
          prev.waveIndex === st.waveIndex &&
          prev.waitingTrigger?.name === st.waitingTrigger?.name
        ) {
          return prev
        }
        return st
      })
    }, 150)
    return () => clearInterval(id)
  }, [poseApi])

  // Catalogo mesh: chiesto una volta all'apertura (il GLB può non essere
  // ancora pronto al mount, quindi si riprova finché non risponde).
  useEffect(() => {
    if (editMode !== 'anim' || meshCatalog.length > 0) return
    const read = () => {
      const list = poseApi.current?.meshCatalog?.()
      if (list?.length) setMeshCatalog(list)
    }
    read()
    const id = setInterval(read, 400)
    return () => clearInterval(id)
  }, [editMode, meshCatalog.length, poseApi])

  // Entrando nella vista JSON si serializza l'animazione corrente; uscendo si
  // riparte dal modello (la textarea non è la fonte di verità).
  useEffect(() => {
    if (!showJson) return
    setJsonText(JSON.stringify(current ?? {}, null, 2))
    setJsonError(null)
  }, [showJson, current])

  const waves = useMemo(() => (current ? buildWaves(current) : []), [current])
  // Mappa step.id -> indice di wave, per rientrare le righe e evidenziare
  // quella in esecuzione senza ricalcolare la partizione nel render.
  const waveOfStep = useMemo(() => {
    const map = new Map()
    waves.forEach((wave, i) => wave.forEach((s) => map.set(s.id, i)))
    return map
  }, [waves])

  if (!DEBUG || editMode !== 'anim') return null

  // ── Mutazioni del modello ─────────────────────────────────────────────────
  const commit = (nextItems) => onChange({ ...animations, items: nextItems })
  const patchAnimation = (patch) =>
    commit(items.map((a) => (a.id === current.id ? { ...a, ...patch } : a)))
  const patchStep = (stepId, patch) =>
    patchAnimation({
      steps: current.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    })
  const patchParam = (stepId, key, value) =>
    patchAnimation({
      steps: current.steps.map((s) =>
        s.id === stepId ? { ...s, params: { ...s.params, [key]: value } } : s,
      ),
    })

  const addStep = (actionKey) => {
    if (!actionKey) return
    patchAnimation({ steps: [...current.steps, newStep(actionKey)] })
  }
  const removeStep = (stepId) =>
    patchAnimation({ steps: current.steps.filter((s) => s.id !== stepId) })
  const moveStep = (index, delta) => {
    const next = [...current.steps]
    const to = index + delta
    if (to < 0 || to >= next.length) return
    ;[next[index], next[to]] = [next[to], next[index]]
    patchAnimation({ steps: next })
  }
  const changeAction = (stepId, actionKey) => {
    // Cambiare azione ricrea lo step (parametri e default sono suoi), tenendo
    // l'id — così il runtime non lo scambia per uno step nuovo.
    const fresh = newStep(actionKey)
    patchStep(stepId, { ...fresh, id: stepId })
  }

  const createAnimation = () => {
    const anim = newAnimation(`Animazione ${items.length + 1}`)
    commit([...items, anim])
    setSelectedId(anim.id)
  }
  const deleteAnimation = () => {
    if (!current) return
    commit(items.filter((a) => a.id !== current.id))
    setSelectedId(null)
  }

  // ── Import / export del solo blocco animazioni ────────────────────────────
  // Distinto da "Salva Configurazione"/"Carica JSON" del LightRig, che
  // serializzano TUTTO lo stato tunabile (luci, materiali, focus…): qui si
  // porta via e si rimette solo questa sezione, per scambiarla fra sessioni o
  // tenerla sotto versione senza toccare il resto. Il formato è identico alla
  // chiave `animations` del blob globale, quindi i due sono compatibili.
  const exportAnimations = () => {
    const blob = new Blob([JSON.stringify(animations, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'animations.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const importAnimations = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result)
          const next = normalizeAnimations(parsed)
          if (next.items.length === 0) throw new Error('nessuna animazione valida nel file')
          // Sostituisce l'intero set (come "Carica JSON"), ma solo dopo
          // conferma se c'è già del lavoro in pancia.
          if (
            items.length > 0 &&
            !window.confirm(
              `Sostituire le ${items.length} animazioni correnti con le ${next.items.length} del file?`,
            )
          ) {
            return
          }
          onChange(next)
          setSelectedId(next.items[0].id)
        } catch (err) {
          window.alert(`Import fallito: ${err.message}`)
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonText)
      const normalized = normalizeAnimations([parsed])
      const anim = normalized.items[0]
      if (!anim) throw new Error('nessuna animazione valida nel JSON')
      // Si tiene l'id corrente, così i chip HUD e i riferimenti non cambiano
      // sotto i piedi per una modifica di contenuto.
      commit(items.map((a) => (a.id === current.id ? { ...anim, id: current.id } : a)))
      setJsonError(null)
    } catch (err) {
      setJsonError(err.message)
    }
  }

  // ── Comandi ───────────────────────────────────────────────────────────────
  const api = poseApi.current
  const playing = runState?.state === 'playing' || runState?.state === 'finished'
  const isCurrentPlaying = playing && runState?.id === current?.id

  const statusText = () => {
    if (!runState || runState.state === 'idle') return 'fermo'
    if (runState.waitingTrigger) return `in attesa · ${runState.waitingTrigger.label}`
    if (runState.state === 'finished') return 'concluso'
    return `wave ${runState.waveIndex + 1}/${runState.waveCount}`
  }

  return (
    <div className={`${styles.editor} ${collapsed ? styles.editorCollapsed : ''}`}>
      {/* Riga 1 — identità del pannello, stato e riduzione a icona. */}
      <div className={styles.headerTitle}>
        <span className={styles.paramLabel}>animazioni</span>
        <span className={styles.spacer} />
        <span
          className={`${styles.status} ${runState?.waitingTrigger ? styles.statusWaiting : ''}`}
        >
          {isCurrentPlaying ? statusText() : 'fermo'}
        </span>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnIcon}`}
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Espandi' : 'Riduci (per vedere il modello)'}
        >
          {collapsed ? '▢' : '—'}
        </button>
      </div>

      {/* Riga 2 — quale animazione, come si chiama, play/stop. Resta visibile
          anche da ridotto: è il minimo per lanciare una prova. */}
      <div className={styles.header}>
        <select
          className={`${styles.select} ${styles.grow}`}
          value={current?.id ?? ''}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Animazione"
        >
          {items.length === 0 && <option value="">— nessuna animazione —</option>}
          {items.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={styles.btn}
          disabled={!current || current.steps.length === 0}
          onClick={() => api?.playAnimation?.(current.id)}
        >
          ▶ play
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={!playing}
          onClick={() => api?.stopAnimation?.()}
        >
          ■ stop
        </button>
        {runState?.waitingTrigger && (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnActive}`}
            onClick={() => api?.triggerAnimation?.(runState.waitingTrigger.name)}
          >
            ⚡ {runState.waitingTrigger.label}
          </button>
        )}
      </div>

      {/* Riga 3 — gestione del set: crea/rinomina/elimina, import/export del
          solo blocco animazioni, vista JSON. */}
      {!collapsed && (
        <div className={styles.header}>
          {current && (
            <input
              className={`${styles.input} ${styles.grow}`}
              value={current.label}
              onChange={(e) => patchAnimation({ label: e.target.value })}
              aria-label="Nome animazione"
            />
          )}
          <button type="button" className={styles.btn} onClick={createAnimation}>
            + nuova
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDanger}`}
            onClick={deleteAnimation}
            disabled={!current}
          >
            × elimina
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={importAnimations}
            title="Carica un animations.json (sostituisce il set corrente)"
          >
            ↑ importa
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={exportAnimations}
            disabled={items.length === 0}
            title="Scarica il set corrente come animations.json"
          >
            ↓ esporta
          </button>
          <button
            type="button"
            className={`${styles.btn} ${showJson ? styles.btnActive : ''}`}
            onClick={() => setShowJson((v) => !v)}
            disabled={!current}
          >
            {'{ } json'}
          </button>
        </div>
      )}

      {!collapsed && current && !showJson && (
        <>
          <div className={styles.header}>
            <span className={styles.sectionLabel}>opzioni</span>
            <span className={styles.paramLabel}>loop</span>
            <select
              className={styles.select}
              value={current.loop?.mode ?? 'none'}
              onChange={(e) =>
                patchAnimation({ loop: { ...current.loop, mode: e.target.value } })
              }
            >
              <option value="none">nessuno</option>
              <option value="forever">infinito</option>
              <option value="count">n volte</option>
            </select>
            {current.loop?.mode === 'count' && (
              <input
                type="number"
                className={`${styles.input} ${styles.numSmall}`}
                value={current.loop.times ?? 1}
                min={1}
                onChange={(e) =>
                  patchAnimation({
                    loop: { ...current.loop, times: Number(e.target.value) || 1 },
                  })
                }
              />
            )}
            {current.loop?.mode !== 'none' && (
              <>
                <span className={styles.paramLabel}>da wave</span>
                <input
                  type="number"
                  className={`${styles.input} ${styles.numSmall}`}
                  value={current.loop.from ?? 0}
                  min={0}
                  onChange={(e) =>
                    patchAnimation({
                      loop: { ...current.loop, from: Number(e.target.value) || 0 },
                    })
                  }
                />
              </>
            )}
            <label className={styles.paramLabel}>
              <input
                type="checkbox"
                checked={current.hidden === true}
                onChange={(e) => patchAnimation({ hidden: e.target.checked })}
              />{' '}
              nascosta nell’HUD
            </label>
            <label className={styles.paramLabel}>
              <input
                type="checkbox"
                checked={current.restoreOnStop !== false}
                onChange={(e) => patchAnimation({ restoreOnStop: e.target.checked })}
              />{' '}
              stop ripristina il focus
            </label>
          </div>

          <span className={styles.sectionLabel}>step</span>
          <div className={styles.steps}>
            {current.steps.length === 0 && (
              <div className={styles.empty}>nessuno step — aggiungine uno qui sotto</div>
            )}
            {current.steps.map((step, i) => (
              <StepRow
                key={step.id}
                step={step}
                index={i}
                total={current.steps.length}
                waveIndex={waveOfStep.get(step.id)}
                running={
                  isCurrentPlaying && waveOfStep.get(step.id) === runState?.waveIndex
                }
                meshGroups={meshGroups}
                meshCatalog={meshCatalog}
                onPatch={(patch) => patchStep(step.id, patch)}
                onPatchParam={(key, value) => patchParam(step.id, key, value)}
                onChangeAction={(key) => changeAction(step.id, key)}
                onMove={(d) => moveStep(i, d)}
                onRemove={() => removeStep(step.id)}
                onPlayFrom={() =>
                  api?.playAnimation?.(current.id, { fromWave: waveOfStep.get(step.id) ?? 0 })
                }
              />
            ))}
          </div>

          <div className={styles.header}>
            <select
              className={`${styles.select} ${styles.grow}`}
              value=""
              onChange={(e) => {
                addStep(e.target.value)
                e.target.value = ''
              }}
              aria-label="Aggiungi step"
            >
              <option value="">+ aggiungi step…</option>
              {ACTION_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {Object.entries(ACTIONS)
                    .filter(([, a]) => a.group === group)
                    .map(([key, a]) => (
                      <option key={key} value={key}>
                        {a.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
        </>
      )}

      {!collapsed && current && showJson && (
        <>
          <textarea
            className={styles.json}
            value={jsonText}
            spellCheck={false}
            onChange={(e) => setJsonText(e.target.value)}
          />
          <div className={styles.header}>
            <button type="button" className={styles.btn} onClick={applyJson}>
              applica
            </button>
            {jsonError && <span className={styles.jsonError}>{jsonError}</span>}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Una riga della lista a blocchi ─────────────────────────────────────── */
function StepRow({
  step,
  index,
  total,
  waveIndex,
  running,
  meshGroups,
  meshCatalog,
  onPatch,
  onPatchParam,
  onChangeAction,
  onMove,
  onRemove,
  onPlayFrom,
}) {
  const action = ACTIONS[step.action]
  if (!action) return null

  const classes = [
    styles.step,
    step.parallel && index > 0 ? styles.stepParallel : '',
    step.enabled === false ? styles.stepDisabled : '',
    running ? styles.stepRunning : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      {/* Riga 1 — wave, ordinamento, abilitazione, azione, comandi. */}
      <div className={styles.stepLine}>
        <span className={styles.stepIndex} title="Wave di appartenenza">
          {waveIndex != null ? waveIndex + 1 : '–'}
        </span>

        <button
          type="button"
          className={`${styles.btn} ${styles.btnIcon}`}
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label="Sposta su"
        >
          ↑
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnIcon}`}
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          aria-label="Sposta giù"
        >
          ↓
        </button>

        <input
          type="checkbox"
          checked={step.enabled !== false}
          onChange={(e) => onPatch({ enabled: e.target.checked })}
          aria-label="Abilitato"
          title="Abilitato"
        />

        <select
          className={`${styles.select} ${styles.grow}`}
          value={step.action}
          onChange={(e) => onChangeAction(e.target.value)}
          aria-label="Azione"
        >
          {ACTION_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {Object.entries(ACTIONS)
                .filter(([, a]) => a.group === group)
                .map(([key, a]) => (
                  <option key={key} value={key}>
                    {a.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>

        {/* Il primo step non ha una wave precedente a cui accodarsi. */}
        <button
          type="button"
          className={`${styles.btn} ${styles.btnIcon} ${step.parallel ? styles.btnActive : ''}`}
          onClick={() => onPatch({ parallel: !step.parallel })}
          disabled={index === 0}
          title="In parallelo con lo step precedente"
        >
          ∥
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnIcon}`}
          onClick={onPlayFrom}
          title="Play da questa wave"
        >
          ▶
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnIcon} ${styles.btnDanger}`}
          onClick={onRemove}
          aria-label="Elimina step"
        >
          ×
        </button>
      </div>

      {/* Riga 2 — parametri dell'azione, generati dallo schema del registry. */}
      {(action.params ?? []).length > 0 && (
        <div className={styles.stepLine}>
          {action.params.map((schema) => (
            <ParamField
              key={schema.key}
              schema={schema}
              value={step.params?.[schema.key]}
              meshGroups={meshGroups}
              meshCatalog={meshCatalog}
              onChange={(v) => onPatchParam(schema.key, v)}
            />
          ))}
        </div>
      )}

      {/* Riga 3 — tempi. `duration` è la durata dell'AZIONE per le azioni a
          durata, `wait` decide se la wave si blocca ad aspettarla. */}
      <div className={styles.stepLine}>
        <label className={styles.paramLabel}>
          attesa
          <select
            className={styles.select}
            value={step.wait}
            onChange={(e) => onPatch({ wait: e.target.value })}
          >
            {Object.entries(WAIT_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {(step.wait === 'duration' || action.durationDriven) && (
          <label className={styles.paramLabel}>
            durata
            <input
              type="number"
              className={`${styles.input} ${styles.numSmall}`}
              value={step.duration}
              min={0}
              step={0.05}
              onChange={(e) => onPatch({ duration: Number(e.target.value) || 0 })}
            />
          </label>
        )}

        {action.durationDriven && (
          <label className={styles.paramLabel}>
            curva
            <select
              className={styles.select}
              value={step.easing}
              onChange={(e) => onPatch({ easing: e.target.value })}
            >
              {EASING_NAMES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={styles.paramLabel} title="Ritardo dall’inizio della propria wave">
          ritardo
          <input
            type="number"
            className={`${styles.input} ${styles.numSmall}`}
            value={step.delay}
            min={0}
            step={0.05}
            onChange={(e) => onPatch({ delay: Number(e.target.value) || 0 })}
          />
        </label>
      </div>
    </div>
  )
}

/* ── Un campo parametro, disegnato dallo schema del registry ────────────── */
function ParamField({ schema, value, meshGroups, meshCatalog, onChange }) {
  const label = schema.label ?? schema.key

  switch (schema.type) {
    case 'boolean':
      return (
        <label className={styles.paramLabel}>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />{' '}
          {label}
        </label>
      )

    case 'number':
      return (
        <label className={styles.paramLabel}>
          {label}{' '}
          <input
            type="number"
            className={`${styles.input} ${styles.num}`}
            value={value ?? ''}
            min={schema.min}
            max={schema.max}
            step={schema.step ?? 0.01}
            // `optional` = campo vuoto significa "usa il valore autorato nel
            // FocusTuner", non "zero".
            placeholder={schema.optional ? 'auto' : ''}
            onChange={(e) =>
              onChange(e.target.value === '' ? (schema.optional ? null : 0) : Number(e.target.value))
            }
          />
        </label>
      )

    case 'string':
      return (
        <label className={styles.paramLabel}>
          {label}{' '}
          <input
            className={styles.input}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )

    case 'select':
      return (
        <label className={styles.paramLabel}>
          {label}{' '}
          <select
            className={styles.select}
            value={value ?? schema.options[0]}
            onChange={(e) => onChange(e.target.value)}
          >
            {schema.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      )

    case 'group':
      return (
        <label className={styles.paramLabel}>
          {label}{' '}
          <select
            className={styles.select}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">— nessuno —</option>
            {meshGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      )

    case 'pose':
      return (
        <label className={styles.paramLabel}>
          {label}{' '}
          <select
            className={styles.select}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          >
            {POSE_OPTIONS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )

    case 'easing':
      return (
        <label className={styles.paramLabel}>
          {label}{' '}
          <select
            className={styles.select}
            value={value ?? 'linear'}
            onChange={(e) => onChange(e.target.value)}
          >
            {EASING_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )

    case 'vec3': {
      const v = Array.isArray(value) ? value : [0, 0, 0]
      return (
        <span className={styles.paramLabel}>
          {label}{' '}
          <span className={styles.vec}>
            {[0, 1, 2].map((i) => (
              <input
                key={i}
                type="number"
                className={`${styles.input} ${styles.numSmall}`}
                value={v[i] ?? 0}
                min={schema.min}
                max={schema.max}
                step={schema.step ?? 0.05}
                onChange={(e) => {
                  const next = [...v]
                  next[i] = Number(e.target.value) || 0
                  onChange(next)
                }}
              />
            ))}
          </span>
        </span>
      )
    }

    case 'selector':
      return (
        <SelectorField
          value={value}
          meshGroups={meshGroups}
          meshCatalog={meshCatalog}
          onChange={onChange}
        />
      )

    default:
      return null
  }
}

/* ── Editor del selettore di mesh ───────────────────────────────────────── */
const KIND_LABEL = {
  all: 'tutto',
  group: 'gruppo',
  allExcept: 'tutto tranne',
  meshes: 'mesh scelte',
}

function SelectorField({ value, meshGroups, meshCatalog, onChange }) {
  const sel = value ?? { kind: 'all' }
  const [filter, setFilter] = useState('')

  const toggleGroup = (id) => {
    const list = new Set(sel.groupIds ?? [])
    if (list.has(id)) list.delete(id)
    else list.add(id)
    onChange({ ...sel, groupIds: [...list] })
  }

  const names = sel.names ?? []
  const toggleMesh = (name) => {
    const list = new Set(names)
    if (list.has(name)) list.delete(name)
    else list.add(name)
    onChange({ ...sel, names: [...list] })
  }

  const q = filter.trim().toLowerCase()
  const visible = q
    ? meshCatalog.filter((m) => m.label.toLowerCase().includes(q))
    : meshCatalog

  return (
    <span className={styles.selector}>
      <span className={styles.selectorRow}>
        <select
          className={styles.select}
          value={sel.kind}
          onChange={(e) => onChange({ kind: e.target.value })}
          aria-label="Tipo di selezione"
        >
          {SELECTOR_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>

        {sel.kind === 'group' && (
          <select
            className={`${styles.select} ${styles.grow}`}
            value={sel.groupId ?? ''}
            onChange={(e) => onChange({ ...sel, groupId: e.target.value })}
          >
            <option value="">— nessuno —</option>
            {meshGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        )}

        {sel.kind === 'allExcept' &&
          meshGroups.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`${styles.chip} ${(sel.groupIds ?? []).includes(g.id) ? styles.chipOn : ''}`}
              onClick={() => toggleGroup(g.id)}
            >
              {g.label}
            </button>
          ))}
      </span>

      {/* Lista a caselle di spunta, non una <select multiple>: quella
          richiedeva ctrl/shift per la selezione multipla e un click distratto
          azzerava tutto. Qui ogni riga è indipendente e la scelta persiste.
          Si mostra la label dedup di collectMeshList ma si SALVA il nome del
          nodo: gli uuid di three si rigenerano a ogni parse del GLTF e non
          sono persistibili (vedi selectors.js). */}
      {sel.kind === 'meshes' && (
        <>
          <span className={styles.selectorRow}>
            <input
              className={`${styles.input} ${styles.grow}`}
              value={filter}
              placeholder="filtra…"
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filtra mesh"
            />
            <button
              type="button"
              className={styles.chip}
              onClick={() => onChange({ ...sel, names: visible.map((m) => m.name) })}
              title="Seleziona tutte le mesh visibili nella lista"
            >
              tutte
            </button>
            <button
              type="button"
              className={styles.chip}
              onClick={() => onChange({ ...sel, names: [] })}
            >
              nessuna
            </button>
            <span className={styles.meshCount}>{names.length} sel.</span>
          </span>

          <span className={styles.meshList}>
            {visible.length === 0 && (
              <span className={styles.meshItem}>
                {meshCatalog.length === 0 ? 'catalogo mesh non pronto…' : 'nessuna corrispondenza'}
              </span>
            )}
            {visible.map((m) => {
              const on = names.includes(m.name)
              return (
                <label
                  key={m.label}
                  className={`${styles.meshItem} ${on ? styles.meshItemOn : ''}`}
                >
                  <input type="checkbox" checked={on} onChange={() => toggleMesh(m.name)} />
                  {m.label}
                </label>
              )
            })}
          </span>
        </>
      )}
    </span>
  )
}
