/**
 * Il flag di authoring, in un posto solo.
 *
 * Era ricalcolato in sei file con la stessa riga (`new URLSearchParams(...)`),
 * il che andava bene finché il suo compito era nascondere un pannello. Non va
 * più bene ora, per due motivi:
 *
 * 1. `?debug` deve poter essere sovrascritto da chi INTEGRA il componente
 *    (un'app che vuole l'editor su una propria rotta, o che non lo vuole
 *    nemmeno con `?debug` nell'URL). Sei letterali sparsi non hanno un punto
 *    di override; una funzione sì.
 * 2. ⚠️ SSR. Toccare `window` a livello di modulo fa esplodere l'import in
 *    Next/Remix, dove il primo render avviene su Node. Il componente è
 *    destinato a essere importato da un e-commerce React: `isDebug()` è una
 *    funzione, non una costante valutata all'import, e fuori dal browser
 *    risponde `false` invece di lanciare.
 *
 * ⚠️ Da qui in poi questo flag NON è il modo in cui l'authoring resta fuori dal
 * bundle di produzione: quello è il dynamic import di `authoring/`. Questo
 * decide soltanto SE caricarlo.
 */

const hasWindow = () => typeof window !== 'undefined' && !!window.location

/** Override esplicito dell'integratore, prevalente sull'URL. Vedi `setDebug`. */
let forced = null

/**
 * @returns {boolean} true se l'authoring è attivo (`?debug` nell'URL, o
 *   l'override impostato con `setDebug`).
 */
export const isDebug = () => {
  if (forced !== null) return forced
  if (!hasWindow()) return false
  return new URLSearchParams(window.location.search).has('debug')
}

/**
 * Forza il flag indipendentemente dall'URL. `null` restituisce il controllo
 * all'URL. Va chiamata prima del mount: il caricamento dell'authoring avviene
 * una volta sola.
 */
export const setDebug = (value) => {
  forced = value === null ? null : !!value
}
