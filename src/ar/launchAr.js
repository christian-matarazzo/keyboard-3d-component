/**
 * CONSEGNA DEL MODELLO AL VISUALIZZATORE AR DI SISTEMA.
 *
 * Due piattaforme, due strade che non si somigliano per niente — e nessuna
 * delle due renderizza la NOSTRA scena. Si passa il modello ad ARKit/ARCore e
 * loro fanno tracciamento, piano d'appoggio, ombra di contatto e illuminazione
 * dall'ambiente reale. Conseguenza da mettere in conto e non da "aggiustare":
 * in AR non esistono né il rig di 34 luci, né i materiali autorati, né la
 * variante di layout selezionata. Si vede il GLB così com'è.
 *
 * ⚠️ Perché NON `@google/model-viewer`, che farebbe esattamente questo lavoro.
 * Il caret di npm su una versione `0.x` blocca la minor, quindi `^0.172` /
 * `^0.182` / `^0.183` — i peer dichiarati da model-viewer 4.1 / 4.2 / 4.3 — non
 * possono soddisfarsi con il `three@0.178` su cui è tarato tutto lo stack R3F
 * di questo progetto. L'unico modo di installarlo sarebbe `--legacy-peer-deps`,
 * cioè una seconda copia di three accanto alla prima. Il codice qui sotto è la
 * parte di model-viewer che serve davvero, e non aggiunge una sola dipendenza:
 * l'intent di Scene Viewer sono dieci righe, e `USDZExporter` è già dentro
 * `three@0.178`.
 *
 * ⚠️ Il modello caricato è l'asset METRICO (`scripts/make-ar-asset.mjs`), non
 * `public/models/keyboard.glb`: quest'ultimo è in millimetri e in AR sarebbe
 * largo 332 metri. Il perché lungo sta in cima allo script.
 */

// USDZ generati in questa sessione, per URL sorgente. L'esportazione costa
// qualche secondo su un telefono (~350k vertici) e il risultato è immutabile,
// quindi il secondo tocco deve essere istantaneo.
// ⚠️ Gli object URL non si revocano mai entro la sessione: Quick Look legge il
// file DOPO che Safari ha lasciato la pagina, e revocarlo gli toglie il modello
// da sotto i piedi. Sono pochi MB che vivono quanto la scheda.
const usdzCache = new Map()

/**
 * ANDROID — Scene Viewer, l'app di sistema di ARCore, raggiunta con un intent.
 *
 * ⚠️ Scene Viewer scarica il GLB DA SÉ, come app separata: l'URL dev'essere
 * assoluto e raggiungibile dalla rete del telefono. Da `localhost` non funziona
 * mai (è il localhost dell'app, non il nostro) — in sviluppo va aperto l'IP di
 * rete del dev server, o un deploy.
 *
 * `mode=ar_only` salta l'anteprima 3D e va dritto alla fotocamera, che è il
 * comportamento chiesto qui. Su un dispositivo senza ARCore fallirebbe, ed è a
 * quello che serve `browser_fallback_url`: riporta alla pagina da cui si è
 * partiti invece di lasciare un vicolo cieco.
 */
function launchSceneViewer({ modelUrl, title }) {
  const file = new URL(modelUrl, window.location.href).href
  const params = new URLSearchParams({ file, mode: 'ar_only', title })

  // ⚠️ Il frammento `#Intent;…` è sintassi dell'intent di Android, non un
  // frammento di URL: non va codificato. Solo il valore di
  // `browser_fallback_url` (una URL dentro una URL) va codificato.
  const intent =
    `intent://arvr.google.com/scene-viewer/1.0?${params.toString()}` +
    '#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;' +
    `S.browser_fallback_url=${encodeURIComponent(window.location.href)};end;`

  window.location.href = intent
}

/**
 * iOS — AR Quick Look, che vuole uno USDZ. Non essendocene uno versionato, lo
 * si genera sul telefono dal GLB già caricato.
 *
 * Va bene proprio perché questo asset non ha texture (verificato con
 * `npm run asset:inspect`: "No textures found"): l'esportatore di three deve
 * scrivere solo geometria e scalari PBR, senza ricodificare immagini. È il caso
 * migliore per `USDZExporter`, ed è la ragione per cui questa strada è
 * praticabile a mano.
 */
async function buildUsdzUrl({ modelUrl, dracoPath, title }) {
  const cached = usdzCache.get(modelUrl)
  if (cached) return cached

  // Import dinamico: tre moduli di three che non c'entrano niente con il
  // configuratore finiscono in un chunk a parte, scaricato solo da chi tocca
  // davvero il bottone — cioè solo su iOS Safari.
  const [{ GLTFLoader }, { DRACOLoader }, { USDZExporter }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/loaders/DRACOLoader.js'),
    import('three/examples/jsm/exporters/USDZExporter.js'),
  ])

  const draco = new DRACOLoader().setDecoderPath(dracoPath)
  const loader = new GLTFLoader().setDRACOLoader(draco)

  try {
    const gltf = await loader.loadAsync(modelUrl)
    const buffer = await new USDZExporter().parseAsync(gltf.scene, { quickLookCompatible: true })

    // ⚠️ Un `File` e non un `Blob`: Quick Look si fida dell'ESTENSIONE, e un
    // object URL di un Blob non ne ha nessuna. Il nome del File è ciò che
    // Safari legge per riconoscere lo USDZ.
    const file = new File([buffer], `${title.replace(/\s+/g, '-').toLowerCase()}.usdz`, {
      type: 'model/vnd.usdz+zip',
    })
    const url = URL.createObjectURL(file)
    usdzCache.set(modelUrl, url)
    return url
  } finally {
    draco.dispose()
  }
}

/**
 * ⚠️ Quick Look si apre SOLO da un `<a rel="ar">` che contiene un `<img>` come
 * unico figlio. È un requisito di Safari, non una convenzione: senza l'immagine
 * il link viene trattato come un normale collegamento e lo USDZ viene scaricato
 * invece che aperto in AR. L'immagine qui è un GIF trasparente 1×1 inline —
 * non si vede, ma deve esserci.
 */
function clickQuickLookAnchor(url) {
  const anchor = document.createElement('a')
  anchor.setAttribute('rel', 'ar')
  anchor.href = url
  anchor.style.display = 'none'

  const img = document.createElement('img')
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  anchor.appendChild(img)

  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * Apre il modello nel visualizzatore AR di sistema.
 *
 * @param {Object}  opts
 * @param {'quick-look'|'scene-viewer'} opts.platform  da `detectArSupport()`
 * @param {string}  opts.modelUrl   l'asset METRICO
 * @param {string}  opts.dracoPath  decoder Draco (solo iOS: Scene Viewer ha il suo)
 * @param {string}  opts.title      etichetta mostrata da Scene Viewer, nome del file USDZ
 */
export async function launchAr({ platform, modelUrl, dracoPath = '/draco/', title = 'Modello' }) {
  if (platform === 'scene-viewer') {
    // Nessun await: l'intent è una navigazione, non un caricamento. Il GLB lo
    // scarica Scene Viewer per conto suo.
    launchSceneViewer({ modelUrl, title })
    return
  }

  if (platform === 'quick-look') {
    const url = await buildUsdzUrl({ modelUrl, dracoPath, title })
    clickQuickLookAnchor(url)
    return
  }

  throw new Error(`[ar] piattaforma non gestita: ${platform}`)
}

/** Vero se lo USDZ è già in cache, cioè se il prossimo lancio è immediato. */
export const isArReady = (modelUrl) => usdzCache.has(modelUrl)
