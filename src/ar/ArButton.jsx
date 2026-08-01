import { useCallback, useEffect, useState } from 'react'
import styles from './ArButton.module.css'
import { detectArSupport } from './arSupport'
import { launchAr, isArReady } from './launchAr'

/**
 * BOTTONE "PROVA IN AR" — chicca del PLAYGROUND, non del componente.
 *
 * Sta qui e non dentro `components/KeyboardComposer/` per la stessa ragione per
 * cui ci sta `PLAYGROUND_BRANDING` (vedi App.jsx): è roba dell'ambiente di
 * prova interno, e chi installa il pacchetto non deve ereditarla. Il
 * configuratore non sa che questo bottone esiste, e `npm run build:lib` non lo
 * tocca.
 *
 * Compare solo se esiste un visualizzatore AR di sistema a cui parlare — cioè
 * di fatto solo su iOS Safari e su Android (`arSupport.js`), che è il "solo in
 * mobile" chiesto, verificato per capacità invece che per larghezza di
 * viewport.
 *
 * ⚠️ Nessuna anteprima intermedia: un tocco e si apre la fotocamera di sistema.
 * Su Android è immediato (è una navigazione a un intent). Su iOS invece lo USDZ
 * va prodotto sul telefono, e sono qualche secondo — da cui lo stato
 * `preparing`, che è l'unica UI di questo componente.
 *
 * ⚠️ E da cui anche lo stato `ready`, che sembra ridondante e non lo è: la
 * generazione è asincrona, quindi il click sull'`<a rel="ar">` finisce FUORI
 * dal gesto dell'utente. Safari normalmente lo consente lo stesso (è la stessa
 * tecnica di model-viewer), ma se un giorno smettesse di farlo il bottone non
 * diventerebbe muto: resta acceso, e il tocco successivo trova lo USDZ già in
 * cache e apre Quick Look DENTRO il gesto. Una rete di sicurezza che costa uno
 * stato.
 */

const LABELS = {
  idle: 'Prova in AR',
  preparing: 'Preparazione…',
  ready: 'Apri in AR',
  error: 'AR non disponibile',
}

function ArIcon() {
  // Cubo fra parentesi d'inquadratura: il glifo che sia ARKit sia ARCore usano
  // per "posiziona nello spazio".
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M3 8V4h4M17 4h4v4M21 16v4h-4M7 20H3v-4" strokeLinecap="square" />
      <path d="M12 8.2 15.6 10v4L12 15.8 8.4 14v-4L12 8.2Z" strokeLinejoin="round" />
    </svg>
  )
}

export default function ArButton({
  // L'asset METRICO prodotto da `scripts/make-ar-asset.mjs`, non il GLB del
  // configuratore: quello è in millimetri e in AR sarebbe largo 332 metri.
  modelUrl = '/ar/keyboard-ar.glb',
  dracoPath = '/draco/',
  title = 'Array Model L',
}) {
  // `null` = non ancora deciso. ⚠️ Il rilevamento NON può stare nel render:
  // legge `navigator`/`document`, quindi va fatto dopo il montaggio.
  const [support, setSupport] = useState(null)
  const [phase, setPhase] = useState('idle')

  useEffect(() => {
    setSupport(detectArSupport())
  }, [])

  // Se si torna alla pagina da Quick Look, lo USDZ è già in cache: il bottone
  // lo dichiara, così un secondo giro è a costo zero.
  useEffect(() => {
    if (phase === 'idle' && isArReady(modelUrl)) setPhase('ready')
  }, [phase, modelUrl])

  const onClick = useCallback(async () => {
    if (!support?.supported) return
    setPhase('preparing')
    try {
      await launchAr({ platform: support.platform, modelUrl, dracoPath, title })
      // Solo iOS ha uno stato "pronto" da dichiarare — è lì che esiste una
      // cache dello USDZ. Su Android il tocco è una navigazione a un intent:
      // tornando indietro (magari dalla bfcache) il bottone deve dire ancora
      // "Prova in AR", perché è esattamente quello che farà.
      if (support.platform === 'quick-look') setPhase('ready')
      else setPhase('idle')
    } catch (err) {
      console.error('[ar] apertura fallita', err)
      setPhase('error')
    }
  }, [support, modelUrl, dracoPath, title])

  if (!support?.supported) return null

  const className = [styles.button, styles[phase]].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      aria-busy={phase === 'preparing'}
      aria-label={LABELS[phase]}
    >
      <ArIcon />
      {LABELS[phase]}
    </button>
  )
}
