import fs from 'node:fs/promises'
import path from 'node:path'

/*
 * SCRITTURA DELLA CONFIGURAZIONE AUTORATA, DAL BROWSER AL DISCO.
 *
 * Il pulsante "Salva" dell'editor produceva un download: il file finiva in
 * ~/Downloads e andava ricopiato a mano in `public/` al percorso di
 * `configUrl`. Un passaggio manuale ripetuto a ogni iterazione, in un flusso
 * (autora → salva → ricarica → verifica) che si percorre decine di volte in
 * una sessione, e con un modo di sbagliare silenzioso: si autora, si salva, si
 * ricarica — e si sta guardando ancora il file vecchio perché la copia non è
 * stata fatta.
 *
 * Il browser non può scrivere su disco, quindi il salvataggio ha bisogno di una
 * controparte lato server. Questa è: un endpoint del SOLO dev server
 * (`apply: 'serve'`) che riceve il JSON e sovrascrive il file dentro
 * `publicDir`.
 *
 * ⚠️ `apply: 'serve'` non è una precauzione formale: è ciò che tiene l'endpoint
 * fuori da qualunque artefatto. `vite build` non carica i plugin marcati così,
 * e comunque un plugin di Vite non finisce mai dentro il bundle — quindi né la
 * SPA in `dist/` né il pacchetto in `dist-lib/` contengono niente di tutto
 * questo. Chi installa il pacchetto non ottiene un endpoint di scrittura: il
 * lato client (LightEditor.jsx) tratta l'assenza dell'endpoint come normale e
 * ripiega sul download di prima.
 *
 * ⚠️ Scrivere in `public/` NON ricarica la pagina, ed è la ragione per cui
 * questa strada è praticabile. Verificato su Vite 6.4: un file che non sta nel
 * module graph e non è HTML esce da `handleHMRUpdate` con
 * `[no modules matched]`, senza `full-reload`. Se un giorno cambiasse, il
 * salvataggio distruggerebbe la sessione di authoring che lo ha invocato —
 * cronologia di undo compresa — e questo commento è il posto dove cercare.
 */

export const AUTHOR_SAVE_ENDPOINT = '/__author/save-config'

// Il file autorato di questo repo pesa ~90 kB; il tetto esiste solo perché un
// endpoint che accumula in memoria quello che gli arriva non deve dipendere
// dalla buona fede del chiamante.
const MAX_BODY_BYTES = 8 * 1024 * 1024

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`corpo oltre ${MAX_BODY_BYTES} byte`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

export default function authorSavePlugin() {
  return {
    name: 'keyboard-composer:author-save',
    apply: 'serve',
    configureServer(server) {
      const publicDir = server.config.publicDir

      server.middlewares.use(AUTHOR_SAVE_ENDPOINT, async (req, res) => {
        const send = (code, payload) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(payload))
        }
        const fail = (code, error) => send(code, { ok: false, error })

        if (req.method !== 'POST') return fail(405, 'usare POST')
        if (!publicDir) return fail(500, '`publicDir` disattivata su questo server')

        let body
        try {
          body = JSON.parse(await readBody(req))
        } catch (err) {
          return fail(400, `richiesta illeggibile: ${err.message}`)
        }

        const { path: target, json } = body ?? {}
        if (typeof target !== 'string' || typeof json !== 'string')
          return fail(400, 'servono `path` (stringa) e `json` (stringa)')

        // Il contenuto viene riparsato prima di toccare il disco: il file che
        // si sta sovrascrivendo è quello che il prodotto carica all'avvio, e un
        // JSON troncato lo lascerebbe irrecuperabile dall'editor stesso (il
        // fetch fallisce, lo store resta sui default, e ciò che si era autorato
        // non è più da nessuna parte).
        try {
          JSON.parse(json)
        } catch (err) {
          return fail(400, `il contenuto non è JSON valido: ${err.message}`)
        }

        // Tre vincoli sul percorso, e nessuno è ridondante: relativo alla
        // radice perché è la forma in cui `configUrl` è dichiarato, `.json`
        // perché questo endpoint serve a una cosa sola, e il confronto sul
        // percorso RISOLTO perché `/../` dentro l'URL è il modo ovvio per
        // scrivere fuori da `public/`.
        const rel = decodeURIComponent(target.split(/[?#]/)[0])
        if (!rel.startsWith('/')) return fail(400, `percorso non relativo alla radice: ${rel}`)
        if (!rel.toLowerCase().endsWith('.json')) return fail(400, `non è un .json: ${rel}`)

        const root = path.resolve(publicDir)
        const abs = path.resolve(root, `.${rel}`)
        if (abs !== root && !abs.startsWith(root + path.sep))
          return fail(400, `percorso fuori da public/: ${rel}`)

        // La cartella deve esistere già: questo endpoint sovrascrive una
        // configurazione servita, non crea alberi. Un percorso sbagliato deve
        // dare errore, non seminare un file che nessuno leggerà mai.
        const dir = path.dirname(abs)
        try {
          if (!(await fs.stat(dir)).isDirectory()) throw new Error('non è una cartella')
        } catch {
          return fail(400, `cartella inesistente: ${path.relative(root, dir) || '.'}`)
        }

        // Scrittura atomica (tmp + rename): il file viene riletto dal fetch di
        // `ConfigLoader` a ogni ricarica, e una scrittura interrotta a metà lo
        // lascerebbe visibile e monco. Il rename dentro la stessa cartella è
        // atomico sui filesystem che ci interessano.
        const tmp = `${abs}.${process.pid}.tmp`
        try {
          // Nessuna newline finale aggiunta: il file va confrontato con
          // `store.toJSON()` (vedi CLAUDE.md, "the round trip"), e
          // `JSON.stringify(…, null, 2)` non ne produce.
          await fs.writeFile(tmp, json, 'utf8')
          await fs.rename(tmp, abs)
        } catch (err) {
          await fs.rm(tmp, { force: true }).catch(() => {})
          return fail(500, `scrittura fallita: ${err.message}`)
        }

        const shown = path.relative(server.config.root, abs).split(path.sep).join('/')
        server.config.logger.info(`salvata configurazione autorata → ${shown}`, { timestamp: true })
        return send(200, { ok: true, path: rel, bytes: Buffer.byteLength(json) })
      })
    },
  }
}
