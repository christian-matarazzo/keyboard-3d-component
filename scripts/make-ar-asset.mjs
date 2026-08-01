#!/usr/bin/env node
/**
 * ASSET AR — il GLB del prodotto reso autonomo: in METRI, con i materiali
 * autorati cotti dentro e una sola variante di layout.
 *
 * Il configuratore renderizza il modello; ARKit e ARCore no — a loro si
 * consegna un file e basta. Tutto ciò che nel configuratore vive a RUNTIME
 * (l'auto-fit, i materiali del JSON di configurazione, la selezione della
 * variante) in AR semplicemente non esiste, e senza questo script l'asset
 * arriva a destinazione sbagliato in tre modi diversi. Uno per sezione qui
 * sotto.
 *
 * ⚠️ Perché un file separato e non la correzione di `keyboard.glb`: le
 * trasformazioni autorate (offset delle mesh dell'editor, `transformOffset`
 * delle animazioni) sono espresse nelle unità e nella gerarchia in cui il
 * modello è stato autorato. Riscalare o ricucire l'asset di produzione le
 * sposterebbe tutte, in silenzio e ovunque. L'asset AR è un ramo morto:
 * nessun altro lo legge.
 *
 * ⚠️ E perché si tocca SOLO il chunk JSON del GLB. Scala, materiali e
 * gerarchia in glTF sono tutti dati JSON; la geometria — l'unica cosa
 * compressa Draco — sta nel chunk binario e qui passa intatta, byte per byte.
 * Decodificare e ricodificare per moltiplicare dei numeri costerebbe qualità e
 * minuti di CPU per nessun guadagno.
 *
 * ⚠️ Gli elenchi di gruppi e varianti si IMPORTANO da `products/arrayModelL/`,
 * non si ricopiano: sono gli stessi dati che classificano le mesh a runtime, e
 * l'ordine dell'array è significativo (`patchesISO` prima di `body`, o
 * `S05_L_ISO` finirebbe nel corpo perché contiene anche `S0`). Due copie che
 * divergono darebbero un asset AR colorato diversamente dal configuratore, e
 * se ne accorgerebbe solo chi guarda il telefono.
 *
 * Uso:
 *   node scripts/make-ar-asset.mjs [--scale 0.001] [--in <glb>] [--out <glb>]
 *                                  [--config <json>] [--variants layout=ansi]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { ARRAY_MODEL_L_MESH_GROUPS } from '../src/components/KeyboardComposer/products/arrayModelL/meshGroups.js'
import { ARRAY_MODEL_L_MESH_VARIANTS } from '../src/components/KeyboardComposer/products/arrayModelL/meshVariants.js'

const GLB_MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a // 'JSON'

// Nome riconoscibile nel nodo aggiunto: rende lo script idempotente
// (rilanciarlo su un file già convertito non lo scala una seconda volta) e
// rende ovvio, a chi ispeziona l'asset, che quel nodo non viene dal modello.
const AR_ROOT_NAME = '__AR_METRIC_ROOT'

const CLEARCOAT_EXT = 'KHR_materials_clearcoat'

const DEFAULTS = {
  scale: 0.001,
  in: 'public/models/keyboard.glb',
  out: 'public/ar/keyboard-ar.glb',
  config: 'public/lightconfig/app-state-config.json',
  variants: '',
}

// ─────────────────────────────────────────────────────────────────────────────
// Contenitore GLB
// ─────────────────────────────────────────────────────────────────────────────

/** Spacchetta un GLB nei suoi chunk, senza copiare il binario. */
function readChunks(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('il file non è un GLB (magic errata)')
  const total = dv.getUint32(8, true)
  const chunks = []
  let off = 12
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true)
    const type = dv.getUint32(off + 4, true)
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) })
    off += 8 + len
  }
  return chunks
}

/**
 * Riassembla i chunk. ⚠️ Il padding non è cosmetico: la spec impone che ogni
 * chunk sia multiplo di 4 byte, e che il riempimento sia SPAZI nel JSON e ZERI
 * nel binario — un parser rigoroso rifiuta il file se ci si mette il byte
 * sbagliato.
 */
function writeGlb(chunks) {
  const parts = []
  let total = 12
  for (const { type, data } of chunks) {
    const pad = (4 - (data.byteLength % 4)) % 4
    const head = Buffer.alloc(8)
    head.writeUInt32LE(data.byteLength + pad, 0)
    head.writeUInt32LE(type, 4)
    parts.push(head, Buffer.from(data), Buffer.alloc(pad, type === CHUNK_JSON ? 0x20 : 0x00))
    total += 8 + data.byteLength + pad
  }
  const header = Buffer.alloc(12)
  header.writeUInt32LE(GLB_MAGIC, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(total, 8)
  return Buffer.concat([header, ...parts])
}

// ─────────────────────────────────────────────────────────────────────────────
// Grafo dei nodi
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Indici dei nodi RAGGIUNGIBILI da una scena.
 *
 * Serve perché `selectVariants` stacca i nodi scartati dai loro genitori senza
 * rimuoverli da `gltf.nodes`: compattare l'array vorrebbe dire rinumerare ogni
 * riferimento del file (figli, scene, skin, animazioni), cioè molto rischio per
 * qualche decina di byte. Un nodo orfano non viene disegnato da nessun loader —
 * ma va escluso dal conteggio, o i materiali verrebbero cotti anche sulla
 * variante che abbiamo appena spento.
 */
function reachableNodes(gltf) {
  const seen = new Set()
  const walk = (i) => {
    if (seen.has(i) || !gltf.nodes[i]) return
    seen.add(i)
    for (const child of gltf.nodes[i].children ?? []) walk(child)
  }
  for (const scene of gltf.scenes) for (const i of scene.nodes ?? []) walk(i)
  return seen
}

/**
 * VARIANTI — tiene una sola opzione per variante e stacca le altre.
 *
 * ⚠️ Non è una comodità, è correttezza. Come dice `meshVariants.js`, nel GLB le
 * quattro mesh `S05_{L,R}_{ISO,ANSI}` esistono TUTTE E QUATTRO e senza una
 * selezione vengono disegnate insieme, compenetrandosi. Nel configuratore ci
 * pensa `VariantController` a runtime; in AR non c'è nessun runtime, quindi
 * l'asset mostrerebbe i due layout uno dentro l'altro.
 */
function selectVariants(gltf, variants, selection) {
  const dropped = new Set()
  const chosenById = {}

  for (const variant of variants) {
    const chosen = selection[variant.id] ?? variant.defaultOption
    const known = variant.options.map((o) => o.id)
    if (!known.includes(chosen))
      throw new Error(`[ar] opzione sconosciuta per la variante "${variant.id}": ${chosen} (attese: ${known.join(', ')})`)
    chosenById[variant.id] = chosen

    for (const option of variant.options) {
      if (option.id === chosen) continue
      for (const [i, node] of gltf.nodes.entries())
        if ((option.nameTokens ?? []).some((t) => (node.name ?? '').includes(t))) dropped.add(i)
    }
  }

  if (dropped.size > 0) {
    for (const node of gltf.nodes)
      if (node.children) node.children = node.children.filter((i) => !dropped.has(i))
    for (const scene of gltf.scenes)
      if (scene.nodes) scene.nodes = scene.nodes.filter((i) => !dropped.has(i))
  }

  return { chosenById, dropped: dropped.size }
}

// ─────────────────────────────────────────────────────────────────────────────
// Materiali
// ─────────────────────────────────────────────────────────────────────────────

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0))

/**
 * ⚠️ I colori del JSON di configurazione sono esadecimali che three legge come
 * sRGB; `baseColorFactor` in glTF è LINEARE. Passarli così come sono darebbe
 * colori visibilmente slavati — è la trappola classica di questo tipo di bake,
 * e l'unica che non si vede leggendo il file: il numero c'è, è solo lo spazio
 * colore sbagliato.
 */
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function hexToLinearRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) throw new Error(`[ar] colore non valido: ${hex}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255))
}

function buildMaterial(groupId, spec) {
  const material = {
    name: `AR_${groupId}`,
    pbrMetallicRoughness: {
      baseColorFactor: [...hexToLinearRgb(spec.color ?? '#ffffff'), 1],
      metallicFactor: clamp01(spec.metalness ?? 0),
      roughnessFactor: clamp01(spec.roughness ?? 1),
    },
  }

  // Il clearcoat è la differenza fra "plastica" e "plastica laccata" su questo
  // modello, quindi vale l'estensione. Sta in `extensionsUsed` e MAI in
  // `extensionsRequired`: un visualizzatore che non la conosce deve poter
  // ignorare la vernice e disegnare comunque il PBR di base, non rifiutare il
  // file.
  const clearcoat = clamp01(spec.clearcoat ?? 0)
  if (clearcoat > 0)
    material.extensions = {
      [CLEARCOAT_EXT]: {
        clearcoatFactor: clearcoat,
        clearcoatRoughnessFactor: clamp01(spec.clearcoatRoughness ?? 0),
      },
    }

  return material
}

/**
 * MATERIALI — sostituisce gli shading group di Maya con i 9 materiali autorati.
 *
 * ⚠️ Il motivo per cui questo passaggio è indispensabile, e non un
 * miglioramento: i materiali del GLB sono cinque, IDENTICI fra loro (grigio
 * 50%, non metallico, nessuna texture) e tagliano di traverso i gruppi logici
 * — `initialShadingGroup` da solo copre keycaps, body, patchesISO e
 * patchesANSI, che il configuratore dipinge nero, grigio metallico, rosso e
 * blu. Senza questo bake l'asset AR è una tastiera monocroma, ed è esattamente
 * ciò che il file contiene: non è l'AR a perdere i materiali, è il GLB a non
 * averli mai avuti.
 */
function bakeMaterials(gltf, groups, authored, reachable) {
  const fallbackId = groups.find((g) => g.fallback)?.id ?? groups[0]?.id ?? null
  const materialByGroup = new Map()
  const groupByMesh = new Map()
  const counts = {}
  const missing = new Set()

  for (const i of reachable) {
    const node = gltf.nodes[i]
    if (node.mesh === undefined) continue

    const name = node.name ?? ''
    // Stessa regola di `collectMeshGroups`: PRIMO gruppo il cui token compare
    // nel nome, altrimenti il bucket di raccolta. L'ordine dell'array decide.
    const hit = groups.find((g) => (g.nameTokens ?? []).some((t) => name.includes(t)))
    const groupId = hit ? hit.id : fallbackId
    counts[groupId] = (counts[groupId] ?? 0) + 1

    // ⚠️ In glTF due nodi possono puntare alla STESSA mesh. Oggi non succede
    // (105 nodi, 105 mesh), ma se succedesse assegnare il materiale alla mesh
    // dipingerebbe anche l'altro nodo — che magari è di un altro gruppo. Meglio
    // fermarsi che produrre un asset colorato a caso: la correzione sarebbe
    // duplicare la voce di mesh, che è JSON e non costa geometria.
    const previous = groupByMesh.get(node.mesh)
    if (previous && previous !== groupId)
      throw new Error(
        `[ar] la mesh ${node.mesh} è condivisa fra i gruppi "${previous}" e "${groupId}": ` +
          'va duplicata la voce in `meshes` prima di assegnare i materiali',
      )
    groupByMesh.set(node.mesh, groupId)

    const spec = authored[groupId]
    if (!spec) {
      missing.add(groupId)
      continue
    }

    let index = materialByGroup.get(groupId)
    if (index === undefined) {
      gltf.materials.push(buildMaterial(groupId, spec))
      index = gltf.materials.length - 1
      materialByGroup.set(groupId, index)
    }
    for (const primitive of gltf.meshes[node.mesh].primitives) primitive.material = index
  }

  if (materialByGroup.size > 0) {
    const used = new Set(gltf.extensionsUsed ?? [])
    const anyClearcoat = [...materialByGroup.values()].some((i) => gltf.materials[i].extensions?.[CLEARCOAT_EXT])
    if (anyClearcoat) used.add(CLEARCOAT_EXT)
    gltf.extensionsUsed = [...used]
  }

  return { counts, baked: materialByGroup.size, missing: [...missing] }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scala
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SCALA — da millimetri a metri.
 *
 * ⚠️ Il GLB di produzione è modellato in MILLIMETRI: la bounding box misurata
 * (`npm run asset:inspect`) è 332.5 × 42.7 × 148.8. Nel configuratore non se ne
 * accorge nessuno, perché `KeyboardModel.jsx` fa un auto-fit a `TARGET_WIDTH`
 * ed è dichiaratamente "indipendente dalle unità del file sorgente". L'AR
 * invece non ha un auto-fit: glTF definisce le sue unità come METRI, e ARKit e
 * ARCore le prendono per buone — piazzerebbero nella stanza una tastiera larga
 * 332 metri.
 */
function applyMetricScale(gltf, scale) {
  let wrapped = 0
  for (const scene of gltf.scenes) {
    const roots = scene.nodes ?? []
    if (roots.length === 0) continue
    gltf.nodes.push({ name: AR_ROOT_NAME, scale: [scale, scale, scale], children: [...roots] })
    scene.nodes = [gltf.nodes.length - 1]
    wrapped += roots.length
  }
  if (wrapped === 0) throw new Error('[ar] nessun nodo radice da riscalare')
  return wrapped
}

// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { ...DEFAULTS }
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    if (key && key in args) args[key] = key === 'scale' ? Number(argv[i + 1]) : argv[i + 1]
  }
  if (!Number.isFinite(args.scale) || args.scale <= 0) throw new Error(`[ar] --scale non valido: ${args.scale}`)

  // `--variants layout=ansi,altro=x` → { layout: 'ansi', altro: 'x' }
  const selection = {}
  for (const pair of String(args.variants).split(',').filter(Boolean)) {
    const [id, option] = pair.split('=')
    if (!id || !option) throw new Error(`[ar] --variants malformato: "${pair}" (atteso variante=opzione)`)
    selection[id.trim()] = option.trim()
  }
  return { ...args, selection }
}

const args = parseArgs(process.argv.slice(2))
const inPath = resolve(process.cwd(), args.in)
const outPath = resolve(process.cwd(), args.out)
const configPath = resolve(process.cwd(), args.config)

const chunks = readChunks(readFileSync(inPath))
const jsonChunk = chunks.find((c) => c.type === CHUNK_JSON)
if (!jsonChunk) throw new Error('[ar] GLB senza chunk JSON')

const gltf = JSON.parse(Buffer.from(jsonChunk.data).toString('utf8'))
if (!Array.isArray(gltf.nodes) || !Array.isArray(gltf.scenes)) throw new Error('[ar] GLB senza nodi o scene')
if (gltf.nodes.some((n) => n?.name === AR_ROOT_NAME))
  throw new Error(`[ar] ${args.in} è già un asset AR: rigeneralo dal GLB di produzione`)
gltf.materials ??= []

const config = JSON.parse(readFileSync(configPath, 'utf8'))
const authored = config.materials ?? {}
if (Object.keys(authored).length === 0)
  throw new Error(`[ar] ${args.config} non contiene una sezione \`materials\``)

// ⚠️ L'ORDINE dei tre passaggi conta. Le varianti per prime, o i materiali
// verrebbero cotti anche sulla geometria che stiamo per spegnere; la scala per
// ultima, perché aggiunge un nodo radice che non deve comparire nel conteggio
// dei gruppi.
const variants = selectVariants(gltf, ARRAY_MODEL_L_MESH_VARIANTS, args.selection)
const reachable = reachableNodes(gltf)
const materials = bakeMaterials(gltf, ARRAY_MODEL_L_MESH_GROUPS, authored, reachable)
const wrapped = applyMetricScale(gltf, args.scale)

// Traccia nell'asset da dove viene: chi lo trova fra sei mesi non deve dedurlo.
gltf.asset = {
  ...gltf.asset,
  extras: {
    ...gltf.asset?.extras,
    arMetricScale: args.scale,
    arSourceFile: args.in,
    arVariants: variants.chosenById,
  },
}

jsonChunk.data = Buffer.from(JSON.stringify(gltf), 'utf8')
const out = writeGlb(chunks)

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, out)

// ─────────────────────────────────────────────────────────────────────────────
// Resoconto. La tabella dei gruppi è l'unico modo di accorgersi che un
// `nameToken` ha smesso di corrispondere: la classificazione non fallisce mai
// rumorosamente, ricade sul bucket di raccolta — e un asset in cui tutto è
// finito in `body` è grigio uniforme esattamente come uno non cotto.
// ─────────────────────────────────────────────────────────────────────────────

console.log(`[ar] ${args.in} → ${args.out}  (${(out.byteLength / 1e6).toFixed(2)} MB)`)
console.log(`[ar] scala ${args.scale} su ${wrapped} nodo/i radice`)

for (const [id, option] of Object.entries(variants.chosenById))
  console.log(`[ar] variante ${id} = ${option}  (${variants.dropped} nodo/i scartati)`)

console.log(`[ar] materiali cotti: ${materials.baked}`)
for (const group of ARRAY_MODEL_L_MESH_GROUPS) {
  const n = materials.counts[group.id] ?? 0
  const spec = authored[group.id]
  console.log(`       ${group.id.padEnd(12)} ${String(n).padStart(3)} mesh  ${spec ? spec.color : '— nessun materiale autorato'}`)
}

if (materials.missing.length > 0)
  console.warn(`[ar] ⚠️ gruppi senza materiale autorato, restano grigi: ${materials.missing.join(', ')}`)

// ⚠️ Non è una svista: `envMapIntensity` è un concetto di three.js (quanto pesa
// l'environment map sul materiale), non di glTF né di USD, e non ha nessun
// campo in cui essere scritto. In AR l'ambiente è la stanza vera, quindi lì non
// avrebbe comunque significato — ma è la ragione per cui il risultato non sarà
// mai identico al configuratore.
console.log('[ar] envMapIntensity non è esportabile (concetto di three.js): atteso uno scarto di resa')
