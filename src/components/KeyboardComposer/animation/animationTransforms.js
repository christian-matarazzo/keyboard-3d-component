import { ACTIONS } from './actions'
import { buildStepGroups, newAnimation, newStep } from './animationSchema'

/**
 * Trasformazioni di AUTORAZIONE su un'animazione già scritta: duplicarla,
 * duplicarne pezzi, generarne l'inversa. JS puro, nessun React e nessun
 * runtime — lavora sul dato statico (la stessa forma che finisce nel JSON), e
 * l'editor si limita a chiamarlo e a infilare il risultato nella lista.
 *
 * ⚠️ Il "come si disfa un'azione" NON vive qui: vive nel registry, accanto a
 * cosa quell'azione fa (`inverse`/`inverseNote` in actions.js). Qui c'è solo la
 * meccanica che vale per tutte — ordine dei gruppi, catena delle pose, timing,
 * flag dell'animazione risultante.
 */

/** Copia profonda di uno step con id NUOVO (l'id è la chiave delle istanze vive). */
export function cloneStep(step) {
  return { ...structuredClone(step), id: newStep(step.action).id }
}

/**
 * Copia di un blocco di step. Il primo apre sempre un gruppo suo: incollato o
 * duplicato altrove, un blocco è una wave a sé — gli altri conservano il
 * proprio `parallel`, che è ciò che li tiene sincronizzati fra loro.
 */
export function cloneSteps(steps = []) {
  return steps.map((s, i) => ({ ...cloneStep(s), parallel: i > 0 && s.parallel === true }))
}

/**
 * Duplica un'animazione per farne una variante. Tiene il prerequisito di
 * sequenza: una variante di A2 sta nello stesso punto della catena di A2, non
 * all'inizio.
 */
export function cloneAnimation(animation, { label } = {}) {
  return {
    ...structuredClone(animation),
    id: newAnimation().id,
    label: label ?? `${animation?.label ?? 'Senza nome'} · copia`,
    steps: cloneSteps(animation?.steps ?? []),
  }
}

/**
 * Genera l'animazione che DISFA quella data — l'esploso che si ricompone.
 *
 * Due meccaniche, entrambe non ovvie:
 *
 * 1. **L'ordine si rovescia per GRUPPI, non per step.** Un gruppo di azioni
 *    sincronizzate (le `parallel`) resta sincronizzato e nel suo ordine
 *    interno: sono partite insieme, tornano indietro insieme. Rovesciare la
 *    lista piatta le smembrerebbe, e la capofila finirebbe in coda.
 * 2. **La catena delle pose scala di uno.** «Vai a P2» torna alla posa da cui
 *    era partito, cioè al `goToPose` che lo precede; il primo di tutti torna
 *    alla posa d'ingresso, che il chiamante passa come `originPose` (la home:
 *    è da lì che partono entrambe le modalità di prodotto, vedi CLAUDE.md).
 *
 * L'animazione prodotta nasce con `startFrom: 'keep'` + `stopOnFinish: true`, e
 * non è una preferenza: è la stessa coppia obbligata della transizione di
 * rientro in idle. Un play che azzera smonterebbe proprio lo stato che questa
 * esiste per disfare (e i suoi step non troverebbero più nulla da riportare
 * indietro); partendo concatenata eredita le istanze vive di quella diretta, e
 * senza `stopOnFinish` resterebbero accese a fine corsa.
 *
 * @returns {{ animation: object, notes: string[] }} — `notes` elenca ciò che è
 *   stato saltato e perché: un inverso è un PUNTO DI PARTENZA da correggere a
 *   mano, non un risultato garantito, e va detto a chi lo genera.
 */
export function reverseAnimation(animation, { originPose = null, label } = {}) {
  const steps = animation?.steps ?? []
  const notes = new Set()

  // Posa da cui ogni `goToPose` era partito, nell'ordine ORIGINALE.
  const poseSteps = steps.filter((s) => s.action === 'goToPose')
  const previousPose = new Map()
  poseSteps.forEach((s, i) => {
    previousPose.set(s.id, i === 0 ? originPose : poseSteps[i - 1].params?.poseKey ?? null)
  })
  if (poseSteps.length > 0 && !originPose) {
    notes.add('posa di partenza ignota: l’ultimo «vai alla posa» resta invariato')
  }

  const groups = []
  for (const group of buildStepGroups(steps).reverse()) {
    const inverted = []
    for (const step of group) {
      const action = ACTIONS[step.action]
      if (!action) continue
      const inv = action.inverse?.(step, { previousPose: previousPose.get(step.id) })
      if (!inv) {
        notes.add(
          `«${action.label}» saltata${action.inverseNote ? ` — ${action.inverseNote}` : ''}`,
        )
        continue
      }
      inverted.push(invertedStep(step, action, inv))
    }
    if (inverted.length > 0) groups.push(inverted)
  }

  return {
    animation: {
      ...newAnimation(),
      label: label ?? `${animation?.label ?? 'Senza nome'} · inverso`,
      hidden: animation?.hidden === true,
      startFrom: 'keep',
      stopOnFinish: true,
      // Un inverso ha senso solo dopo la diretta: la sequenza è già scritta
      // nella natura delle due, tanto vale dichiararla.
      requires: animation?.id ?? '',
      steps: groups.flatMap((g) => g.map((s, i) => ({ ...s, parallel: i > 0 }))),
    },
    notes: [...notes],
  }
}

/**
 * Costruisce lo step invertito. Parte dai default dell'azione di destinazione
 * (che può essere DIVERSA — «inquadra gruppo» si inverte in «torna
 * all'insieme») e ci riporta sopra solo ciò che ha senso trasferire.
 */
function invertedStep(step, action, inv) {
  const nextKey = inv.action ?? step.action
  const next = ACTIONS[nextKey]
  const fresh = newStep(nextKey)
  const sameAction = nextKey === step.action
  // Il ritmo si conserva solo fra azioni della stessa specie: una durata di
  // 0.6 s copiata su un'azione che non è a durata non significherebbe nulla.
  const keepTiming = sameAction || (action.durationDriven && next.durationDriven)
  return {
    ...fresh,
    enabled: step.enabled !== false,
    parallel: false, // riscritto dal chiamante, a gruppo chiuso
    delay: sameAction ? step.delay ?? 0 : 0,
    wait: sameAction ? step.wait : fresh.wait,
    duration: keepTiming ? step.duration ?? fresh.duration : fresh.duration,
    easing: keepTiming ? step.easing ?? fresh.easing : fresh.easing,
    maxWait: sameAction ? step.maxWait : fresh.maxWait,
    // I parametri dell'originale si trasferiscono SOLO a parità di azione: su
    // un'azione diversa sarebbero chiavi estranee (normalizeAnimations le
    // scarterebbe comunque al giro successivo, ma tanto vale non scriverle).
    params: sameAction
      ? { ...fresh.params, ...structuredClone(step.params ?? {}), ...structuredClone(inv.params ?? {}) }
      : { ...fresh.params, ...structuredClone(inv.params ?? {}) },
  }
}
