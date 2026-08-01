/**
 * DISPONIBILITÀ AR — rilevamento per CAPACITÀ, non per larghezza di viewport.
 *
 * Il requisito è "solo in mobile", ma una media query sarebbe la verifica
 * sbagliata: una finestra desktop stretta la supera e non ha nessuna fotocamera
 * da aprire, mentre un tablet larghissimo la fallisce e ce l'ha. Quello che
 * conta davvero è se esiste un visualizzatore AR di sistema a cui passare il
 * modello — e sono due, incompatibili fra loro:
 *
 *  - iOS   → AR Quick Look. Vuole un file USDZ, ed è l'UNICA strada: Safari
 *            iOS non ha WebXR, quindi non c'è un percorso "web" alternativo da
 *            preferire.
 *  - Android → Scene Viewer (app di sistema di ARCore), raggiunta con un
 *            `intent://`. Prende un GLB da un URL e fa da sé tracciamento,
 *            posizionamento e scala.
 *
 * ⚠️ Su iOS si richiede ESPLICITAMENTE Safari. Quick Look si apre con un
 * `<a rel="ar">`, e il test canonico (`relList.supports('ar')`) risponde di sì
 * anche in Chrome/Firefox/Edge per iOS — che sono WebKit anch'essi. Ma lì
 * l'aggancio a Quick Look di uno USDZ generato al volo (un blob, vedi
 * `launchAr.js`) non funziona: serve un file servito da un URL. Meglio non
 * mostrare affatto il bottone che mostrarne uno che non fa niente — chi lo
 * tocca non ha modo di capire perché.
 *
 * ⚠️ E si richiede il TOUCH anche su Android: `Android` compare nello user
 * agent di parecchi ambienti senza ARCore (emulatori, TV, chioschi). Il fallback
 * dell'intent li copre comunque, ma non c'è ragione di offrire loro il bottone.
 */

/** @typedef {{ supported: boolean, platform: 'quick-look'|'scene-viewer'|null }} ArSupport */

const NOT_SUPPORTED = Object.freeze({ supported: false, platform: null })

// Browser iOS che NON sono Safari. Tutti WebKit, tutti bocciati (vedi sopra).
const IOS_NON_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|Brave/

/**
 * ⚠️ Da chiamare SOLO dopo il montaggio (in un effect), mai in fase di render:
 * legge `navigator` e `document`, che in SSR non esistono, e il valore
 * cambierebbe fra HTML del server e prima idratazione.
 *
 * @returns {ArSupport}
 */
export function detectArSupport() {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return NOT_SUPPORTED

  const ua = navigator.userAgent || ''
  const touchPoints = navigator.maxTouchPoints || 0

  // iPadOS ≥ 13 si dichiara "Macintosh" nello user agent: il touch è l'unico
  // segnale rimasto per distinguerlo da un Mac vero.
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && touchPoints > 1)

  if (isIOS) {
    if (IOS_NON_SAFARI.test(ua)) return NOT_SUPPORTED
    const relList = document.createElement('a').relList
    const quickLook = !!relList?.supports?.('ar')
    return quickLook ? Object.freeze({ supported: true, platform: 'quick-look' }) : NOT_SUPPORTED
  }

  if (/Android/i.test(ua) && touchPoints > 0)
    return Object.freeze({ supported: true, platform: 'scene-viewer' })

  return NOT_SUPPORTED
}
