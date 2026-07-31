import * as THREE from 'three'
import { wrapGroupInPivot } from './pivot'

/**
 * Possesso condiviso dei pivot di animazione.
 *
 * UNA REGOLA SOLA: **un pivot per mesh, sempre.** Non esistono pivot "di
 * gruppo": una trasformazione rigida di gruppo è un CENTRO condiviso scritto nel
 * canale di ogni mesh, non un contenitore diverso. È la semplificazione da cui
 * discende tutto il resto di questo file.
 *
 * ⚠️ Perché era diverso, e perché non lo è più. Prima il bersaglio di un acquire
 * poteva essere una mesh o un INSIEME di mesh, e l'insieme era la chiave
 * dell'handle. Due bersagli che si sovrapponevano senza coincidere erano quindi
 * due pivot che si contendevano gli stessi figli — il primo a smontarsi avrebbe
 * riparentato mesh che nel frattempo stavano sotto l'altro — e il registry li
 * RIFIUTAVA, con una mappa mesh→proprietario, un `canClaim` e un `console.warn`.
 * Corretto ma inservibile in autorazione: "sposta 105 mesh, poi riportane
 * indietro 4" era rifiutato, lo step non faceva nulla in silenzio, e per
 * ottenerlo bisognava spezzare a mano il selettore in due insiemi disgiunti
 * (4 e 101) sapendo perché. Con il possesso per mesh la sovrapposizione
 * PARZIALE non esiste più: due step che toccano mesh in comune condividono gli
 * handle di quelle mesh e basta. Sono spariti `canClaim`, la mappa dei
 * proprietari, la chiave d'insieme, il warning — e l'analisi statica che
 * serviva ad anticiparlo in editor.
 *
 * CANALI. Un handle porta una mappa di contributi, uno per STEP (chiave =
 * step.id): due step dello stesso tipo sullo stesso bersaglio non si
 * sovrascrivono, e aggiungere un'azione che trasforma non tocca questo file.
 * Ogni canale è un MOTO RIGIDO nello spazio locale della scena:
 *
 *     x ↦ c + T + Q·(x − c)
 *
 * — un centro `c`, una traslazione `T`, una rotazione `Q`. Il centro è ciò che
 * distingue "ognuna sul proprio centro" (c = centro della mesh) da "il gruppo
 * come corpo rigido" (c = centro comune) senza cambiare nulla nella gerarchia.
 *
 * ⚠️ I canali si compongono come moti rigidi VERI (vedi `compose`), non
 * sommando posizioni e moltiplicando quaternioni separatamente: con centri
 * diversi le due cose non coincidono, e due rotazioni rigide di gruppo attorno
 * allo stesso centro darebbero un risultato sbagliato. L'ordine è quello di
 * inserimento, cioè quello in cui gli step sono partiti.
 */

// Scratch di modulo: `compose` gira per ogni mesh e per ogni frame finché uno
// step non è a regime, quindi non alloca.
const _q = new THREE.Quaternion()
const _t = new THREE.Vector3()
const _sum = new THREE.Vector3()

/**
 * Chiave del canale delle TRASLAZIONI/collocazioni autorate, condivisa da tutti
 * gli step `transformOffset` che toccano una stessa mesh — a differenza delle
 * azioni rotatorie, che ne hanno una per step.
 *
 * ⚠️ È condivisa apposta, ed è ciò che fa funzionare "riportalo a posto": uno
 * step che risolve mesh già spostate ritrova il canale a metà strada e ci
 * riparte, quindi `position: [0,0,0]` significa davvero "torna alla posa di
 * riposo" invece di "nessuno spostamento rispetto a dove ti trovi adesso". Con
 * un canale per step il secondo partirebbe da zero e non muoverebbe nulla.
 */
export const OFFSET_CHANNEL = 'offset'

export function createPivotRegistry(getScene) {
  const handles = new Map() // Mesh -> handle

  const makeHandle = (mesh, wrap) => {
    const handle = {
      mesh,
      pivot: wrap.pivot,
      // Centro della mesh nello spazio locale della scena. È sia la posa a
      // riposo del pivot sia il centro di default dei canali.
      basePosition: wrap.basePosition,
      refs: 1,
      channels: new Map(), // step.id -> { center, translation, quat }

      /**
       * Canale di una chiave, creato al volo.
       *
       * ⚠️ `center` si scrive SOLO alla creazione. Cambiarlo su un canale che
       * porta già una rotazione sposterebbe la mesh di scatto (la posa dipende
       * dal centro appena `quat` non è l'identità), e succederebbe proprio nel
       * caso che conta: uno step che riprende in mano l'offset di un altro per
       * riportarlo a zero.
       */
      channel(key, center) {
        let ch = this.channels.get(key)
        if (!ch) {
          ch = {
            center: (center ?? this.basePosition).clone(),
            translation: new THREE.Vector3(),
            quat: new THREE.Quaternion(),
          }
          this.channels.set(key, ch)
        }
        return ch
      },

      clear(key) {
        this.channels.delete(key)
      },

      compose() {
        // ⚠️ ROTAZIONI PRIMA, TRASLAZIONI DOPO, e non è un dettaglio: significa
        // "gira su se stessa DOPO essere stata portata fuori", cioè il caso
        // esploso-e-rotante. Componendo invece i canali in blocco nell'ordine di
        // inserimento, una rotazione registrata dopo un offset farebbe orbitare
        // la mesh attorno al punto da cui è partita.
        //
        // Le rotazioni si compongono come moti rigidi veri, ognuna attorno al
        // PROPRIO centro: (R, t) parte dall'identità e ogni canale ci si applica
        // sopra, R ← Q·R e t ← c + Q·(t − c). Sommare posizioni e moltiplicare
        // quaternioni separatamente sarebbe equivalente solo a centro unico —
        // con due rotazioni rigide di gruppo attorno allo stesso centro darebbe
        // un risultato sbagliato.
        _q.set(0, 0, 0, 1)
        _t.set(0, 0, 0)
        _sum.set(0, 0, 0)
        for (const ch of this.channels.values()) {
          _t.sub(ch.center).applyQuaternion(ch.quat).add(ch.center)
          _q.premultiply(ch.quat)
          _sum.add(ch.translation)
        }
        // Il pivot deve far subire ai figli esattamente quel moto. Con
        // quaternion a riposo identity, un figlio nato in `basePosition`
        // finisce in R·basePosition + t + ΣT.
        this.pivot.quaternion.copy(_q)
        this.pivot.position.copy(this.basePosition).applyQuaternion(_q).add(_t).add(_sum)
      },

      release(opts) {
        if (this.refs <= 0) return
        if (--this.refs > 0) return
        handles.delete(mesh)
        // Default: RIPRISTINA (non cuoce) — vedi la nota in pivot.js sul perché
        // è non negoziabile per le animazioni.
        wrap.restore(opts)
      },
    }
    handles.set(mesh, handle)
    return handle
  }

  /**
   * Handle di UNA mesh: pivot sul suo centro, parentato sotto la root della
   * scena e con quaternion a identity.
   *
   * ⚠️ Identity sotto `scene`, non l'orientamento proprio della mesh, ed è
   * portante: significa che gli assi del pivot SONO quelli del modello, quindi
   * "ruota attorno a Y" vuol dire la Y del modello per costruzione. Prima il
   * pivot di mesh singola ereditava l'orientamento della mesh — che nei GLB
   * esportati da Maya è spesso inclinato — e serviva coniugare l'asse richiesto
   * dentro il frame del pivot (`axisSpace`, `restWorldQuat`,
   * `axisInPivotFrame`): tutta macchina che esisteva solo per rimediare a una
   * scelta di orientamento, e che sparisce facendo la scelta giusta. Resta il
   * ramo orientato in pivot.js, che serve a MeshController: lì il gizmo DEVE
   * mostrare l'orientamento proprio della mesh.
   */
  const acquire = (mesh) => {
    const existing = handles.get(mesh)
    if (existing) {
      existing.refs++
      return existing
    }
    const wrap = wrapGroupInPivot([mesh], getScene())
    return wrap ? makeHandle(mesh, wrap) : null
  }

  const acquireAll = (meshes) => (meshes ?? []).map(acquire).filter(Boolean)

  /** Rete di sicurezza allo smontaggio del director. */
  const releaseAll = () => {
    for (const handle of [...handles.values()]) {
      handle.refs = 1
      handle.release()
    }
  }

  const stats = () => ({ pivots: handles.size, pivotedMeshes: handles.size })

  return { acquire, acquireAll, releaseAll, stats }
}
