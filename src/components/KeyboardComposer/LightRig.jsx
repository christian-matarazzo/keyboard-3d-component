import { useEffect, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { easing } from 'maath'
import { useControls } from 'leva'

/**
 * Rig luci solidale alla camera — impianto DIAGONALE avvolgente (round 8,
 * sketch cliente su vista top) + rake laterale e rim di profondità (round 9).
 * Il group è ancorato al pivot del modello e ogni frame copia l'orientamento
 * della camera: le luci restano fisse rispetto al frame mentre il prodotto
 * ruota dentro lo studio.
 *
 * Composizione (posizioni rig-local: +Z verso l'osservatore, −Z dietro):
 *  - keyMain: sorgente DOMINANTE da alto-sinistra, radente — rastrella di
 *             taglio la faccia visibile facendo "rotolare" la luce sui
 *             keycaps (è ciò che genera la FORMA). Unico shadow caster.
 *  - keyFill: seconda sorgente all'angolo OPPOSTO basso-destra, debole —
 *             risale a sollevare il lato in ombra senza pareggiare il
 *             gradiente (la diagonale key→fill evita il "piatto").
 *  - rake:    luce RADENTE dal lato, quasi orizzontale — spazzola le facce
 *             rivolte alla camera nelle elevazioni a pitch 0 (front/back/
 *             laterali), dove la key colpisce solo i top e le facce frontali
 *             resterebbero al buio. Rivela il rilievo come filo di luce sui
 *             bordi, NON come fill piatto (round 9).
 *  - rim:     kicker da dietro-alto — accende il bordo lontano della sagoma
 *             così il prodotto si stacca dal fondo nero: è il principale
 *             segnale di PROFONDITÀ su set nero (round 9).
 *
 * NB (round 8): nessun point light frontale — riempiva ogni faccia in modo
 * uniforme e appiattiva le pose inclinate. La leggibilità delle pose scure
 * resta garantita dalla cupola diffusa (Environment) e dall'orbitale sotto
 * (KeyboardModel.jsx). Il dettaglio delle facce frontali lo dà il RAKE, non
 * un frontale.
 *
 * Il "filo di luce" continuo che avvolge i bordi vive nell'Environment
 * (Scene.jsx): sono riflessi speculari, non luci dirette.
 *
 * ── LUCI PER-VISTA (round 12) ──────────────────────────────────────────────
 * Richiesta cliente: illuminazioni diverse per singola posa invece di un unico
 * set che deve andar bene per tutte. Il "trigger event" è il commit posa: il
 * LightRig legge `apiRef.currentPoseKey()` ogni frame e, in PRODUZIONE, sfuma
 * (crossfade morbido) i valori delle quattro sorgenti verso il set associato a
 * quella posa in `LIGHTING_PER_POSE`. Le pose senza voce nella tabella usano il
 * preset base (`BASE_LIGHTS`, che è anche il default degli slider).
 *
 * Workflow di autoring ("cattura da ?debug", scelto dal cliente):
 *  1. apri con ?debug, naviga alla posa da illuminare;
 *  2. regola gli slider Leva finché la vista è perfetta (in ?debug gli slider
 *     pilotano le luci DIRETTAMENTE, live — l'animazione per-vista è sospesa);
 *  3. dal pannello "Cattura luci" (in basso a destra, solo ?debug) premi
 *     "Cattura vista" — nessuna console: il pannello legge i valori live via
 *     `lightsApi.readLights()`, li accumula per posa e li esporta come blocco
 *     pronto da incollare in `LIGHTING_PER_POSE` (vedi LightCapturePanel.jsx).
 * In produzione (senza ?debug) la tabella viene riprodotta con il crossfade.
 *
 * Ambito v1: le quattro sorgenti dirette del rig (key/fill/rake/rim). Le strip
 * dell'Environment e l'esposizione (Scene.jsx) restano globali — si potranno
 * portare per-vista con lo stesso schema se servirà.
 *
 * Tutti i valori sono regolabili dal vivo con `?debug`: i default qui sotto
 * SONO i valori di produzione (vedi GUIDA-TUNING.md).
 */

const DEBUG = new URLSearchParams(window.location.search).has('debug')

const RIG_POSITION = [0, 0.1, 0] // pivot del modello

// Layer dedicato al rake: la luce radente illumina SOLO le mesh su questo
// layer (i keycaps, marcati in KeyboardModel). Così il rake rivela il
// dettaglio dei tasti senza rasare — e bruciare — le piastre in alluminio
// del case, che restano sul solo layer 0. (three.js: luce e oggetto si
// illuminano solo se condividono un layer.)
export const RAKE_LAYER = 1

// Tempo di assestamento (secondi) del crossfade luci quando si cambia posa:
// abbastanza lento da leggersi come "l'illuminazione si accomoda sulla vista",
// non uno stacco. Coerente con il ritmo rallentato del movimento (round 12).
const LIGHT_FADE = 0.45

// ── Preset base delle quattro sorgenti ─────────────────────────────────────
// Unica fonte di verità: da qui derivano SIA i default degli slider Leva SIA il
// fallback per le pose senza override. Modificare qui = spostare il default di
// produzione.
const BASE_LIGHTS = {
  keyMain: { intensity: 16, position: [-3.2, 3.2, 2.2], angle: 0.6, penumbra: 0.9 },
  keyFill: { intensity: 6, position: [3, -2.2, 2.2], angle: 0.7, penumbra: 1 },
  rake: { intensity: 12, position: [-5, 0.7, 2.2], color: '#d8e2ff', angle: 0.85, penumbra: 1 },
  rim: { intensity: 14, position: [2.4, 3.2, -3.4], color: '#e6eeff', angle: 0.6, penumbra: 1 },
}

/**
 * Override delle luci per singola posa (chiavi del grafo, vedi poseGraph.js).
 * Ogni voce è un merge PARZIALE sul preset base: si scrivono solo i parametri
 * che cambiano per quella vista (es. `TOP: { keyMain: { intensity: 20 } }`),
 * il resto resta il base. Le pose non elencate usano interamente il base.
 *
 * Da popolare con `window.__captureLights()` in ?debug (vedi sopra). Vuoto =
 * comportamento identico a prima (un solo set per tutte).
 */
const LIGHTING_PER_POSE = {
  // Esempio (commentato): illuminazione dedicata alla vista dall'alto.
  // TOP: {
  //   keyMain: { intensity: 20, position: [-2.6, 3.6, 1.8] },
  //   rim: { intensity: 8 },
  // },
}

// Risolve il set target per una posa: base con l'override parziale della posa
// fuso sopra (per-sorgente, shallow: ogni sorgente ha solo scalari + un array
// posizione, che si sostituisce in blocco).
const resolveTarget = (poseKey) => {
  const over = (poseKey && LIGHTING_PER_POSE[poseKey]) || null
  if (!over) return BASE_LIGHTS
  const out = {}
  for (const slot in BASE_LIGHTS) {
    out[slot] = over[slot] ? { ...BASE_LIGHTS[slot], ...over[slot] } : BASE_LIGHTS[slot]
  }
  return out
}

// Arrotonda a 3 decimali: numeri puliti nello snippet esportato.
const round3 = (n) => Math.round(n * 1000) / 1000

// Snapshot dei valori live delle quattro sorgenti (dagli slider Leva),
// arrotondato e con position come array semplice — il formato di
// LIGHTING_PER_POSE. È ciò che il pannello di cattura accumula ed esporta.
const snapshotLights = (live) => ({
  keyMain: {
    intensity: round3(live.keyMain.intensity),
    position: live.keyMain.position.map(round3),
    angle: round3(live.keyMain.angle),
    penumbra: round3(live.keyMain.penumbra),
  },
  keyFill: {
    intensity: round3(live.keyFill.intensity),
    position: live.keyFill.position.map(round3),
    angle: round3(live.keyFill.angle),
    penumbra: round3(live.keyFill.penumbra),
  },
  rake: {
    intensity: round3(live.rake.intensity),
    position: live.rake.position.map(round3),
    color: live.rake.color,
    angle: round3(live.rake.angle),
    penumbra: round3(live.rake.penumbra),
  },
  rim: {
    intensity: round3(live.rim.intensity),
    position: live.rim.position.map(round3),
    color: live.rim.color,
    angle: round3(live.rim.angle),
    penumbra: round3(live.rim.penumbra),
  },
})

export default function LightRig({ apiRef, lightsApi } = {}) {
  const camera = useThree((s) => s.camera)
  const rigRef = useRef()
  const keyMainRef = useRef()
  const keyFillRef = useRef()
  const rakeRef = useRef()
  const rimRef = useRef()
  const targetRef = useRef()
  const rimTargetRef = useRef()

  const keyMain = useControls('Luci · key principale (alto-sx)', {
    intensity: { value: BASE_LIGHTS.keyMain.intensity, min: 0, max: 200, step: 1 },
    position: { value: BASE_LIGHTS.keyMain.position },
    angle: { value: BASE_LIGHTS.keyMain.angle, min: 0.1, max: 1.2 },
    penumbra: { value: BASE_LIGHTS.keyMain.penumbra, min: 0, max: 1 },
  })
  const keyFill = useControls('Luci · fill (basso-dx)', {
    intensity: { value: BASE_LIGHTS.keyFill.intensity, min: 0, max: 200, step: 1 },
    position: { value: BASE_LIGHTS.keyFill.position },
    angle: { value: BASE_LIGHTS.keyFill.angle, min: 0.1, max: 1.2 },
    penumbra: { value: BASE_LIGHTS.keyFill.penumbra, min: 0, max: 1 },
  })
  // Rake radente: basso e molto laterale, appena avanzato verso camera così
  // sfiora di taglio le facce frontali (rivela il rilievo). Freddo per un
  // tocco premium; intensità contenuta per non bruciare i bordi.
  const rake = useControls('Luci · rake laterale', {
    intensity: { value: BASE_LIGHTS.rake.intensity, min: 0, max: 60, step: 0.5 },
    position: { value: BASE_LIGHTS.rake.position },
    color: BASE_LIGHTS.rake.color,
    angle: { value: BASE_LIGHTS.rake.angle, min: 0.1, max: 1.4 },
    penumbra: { value: BASE_LIGHTS.rake.penumbra, min: 0, max: 1 },
  })
  // Rim di separazione: dietro-alto, mira leggermente alta così accende il
  // bordo superiore lontano e stacca la sagoma dal nero.
  const rim = useControls('Luci · rim (profondità)', {
    intensity: { value: BASE_LIGHTS.rim.intensity, min: 0, max: 200, step: 1 },
    position: { value: BASE_LIGHTS.rim.position },
    color: BASE_LIGHTS.rim.color,
    angle: { value: BASE_LIGHTS.rim.angle, min: 0.1, max: 1.2 },
    penumbra: { value: BASE_LIGHTS.rim.penumbra, min: 0, max: 1 },
  })

  // Valori live degli slider (aggiornati a ogni render): in ?debug pilotano le
  // luci direttamente e sono la sorgente della cattura (__captureLights).
  const liveRef = useRef({})
  liveRef.current = { keyMain, keyFill, rake, rim }

  // I target sono figli del rig (matrixWorld aggiornata dal grafo scena) e
  // vanno assegnati imperativamente.
  useLayoutEffect(() => {
    keyMainRef.current.target = targetRef.current
    keyFillRef.current.target = targetRef.current
    rakeRef.current.target = targetRef.current
    rimRef.current.target = rimTargetRef.current
    // Il rake illumina SOLO i keycaps (layer dedicato): niente burn sul case.
    rakeRef.current.layers.set(RAKE_LAYER)
  }, [])

  // API imperativa per il pannello di cattura (LightCapturePanel), che vive nel
  // DOM fuori dal Canvas e non può leggere gli slider Leva altrimenti. Espone
  // solo la lettura dei valori live correnti; posa, accumulo ed export li
  // gestisce il pannello (che ha già poseApi per la posa corrente). Solo ?debug.
  useEffect(() => {
    if (!lightsApi) return
    lightsApi.current = {
      readLights: () => snapshotLights(liveRef.current),
    }
    return () => {
      lightsApi.current = null
    }
  }, [lightsApi])

  // Colore temporaneo riusato per il crossfade (evita allocazioni per frame).
  const tmpColor = useRef(new THREE.Color())
  // Prima applicazione: snap secco al set della posa d'ingresso (niente
  // fade-in visibile al load).
  const snappedRef = useRef(false)

  // Le luci seguono la camera: oggi la camera non ruota (solo dolly), ma se
  // in futuro orbiterà il rig la seguirà da solo.
  //
  // In PRODUZIONE anima anche i parametri delle quattro sorgenti verso il set
  // della posa attiva (crossfade). In ?debug NON tocca nulla: gli slider Leva
  // pilotano le luci via le prop JSX (tuning manuale, cattura live).
  useFrame((_, delta) => {
    if (rigRef.current) rigRef.current.quaternion.copy(camera.quaternion)
    if (DEBUG) return

    const key = apiRef?.current?.currentPoseKey?.() || null
    const t = resolveTarget(key)
    const lights = {
      keyMain: keyMainRef.current,
      keyFill: keyFillRef.current,
      rake: rakeRef.current,
      rim: rimRef.current,
    }
    // Primo frame: posiziona secco sul target (nessun fade dal base al load).
    const st = snappedRef.current ? LIGHT_FADE : 0
    for (const slot in lights) {
      const light = lights[slot]
      if (!light) continue
      const target = t[slot]
      easing.damp(light, 'intensity', target.intensity, st, delta)
      easing.damp(light, 'angle', target.angle, st, delta)
      easing.damp(light, 'penumbra', target.penumbra, st, delta)
      easing.damp3(light.position, target.position, st, delta)
      if (target.color != null) {
        tmpColor.current.set(target.color)
        easing.dampC(light.color, tmpColor.current, st, delta)
      }
    }
    snappedRef.current = true
  })

  return (
    <group ref={rigRef} position={RIG_POSITION}>
      <spotLight
        ref={keyMainRef}
        castShadow
        position={keyMain.position}
        intensity={keyMain.intensity}
        angle={keyMain.angle}
        penumbra={keyMain.penumbra}
        decay={1.4}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0001}
      />
      <spotLight
        ref={keyFillRef}
        position={keyFill.position}
        intensity={keyFill.intensity}
        angle={keyFill.angle}
        penumbra={keyFill.penumbra}
        decay={1.4}
      />
      <spotLight
        ref={rakeRef}
        position={rake.position}
        intensity={rake.intensity}
        angle={rake.angle}
        penumbra={rake.penumbra}
        color={rake.color}
        decay={1.3}
      />
      <spotLight
        ref={rimRef}
        position={rim.position}
        intensity={rim.intensity}
        angle={rim.angle}
        penumbra={rim.penumbra}
        color={rim.color}
        decay={1.2}
      />
      <object3D ref={targetRef} position={[0, 0, 0]} />
      <object3D ref={rimTargetRef} position={[0, 0.4, 0]} />
    </group>
  )
}
