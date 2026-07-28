import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useGLTF, TransformControls } from '@react-three/drei'
import { useControls } from 'leva'
import { DRACO_PATH } from './KeyboardModel'
import { collectMeshGroups, collectMeshList, DEFAULT_MESH_GROUPS } from './materials/meshGroups'

const HALO_SCALE = 1.04
const HALO_COLOR = '#4dabf7'

// Timeline (editMode 'timeline'): durata fissa per questa prima passata,
// nessun salvataggio/riproduzione automatica ancora (vedi CLAUDE.md quando
// verrà aggiornato). Un keyframe è uno snapshot di posX..rotZ a un istante
// `time`, per una data `selectionKey` — la stessa forma che gizmo/slider già
// scrivono, quindi "applicare" un keyframe è solo un setMeshCtrl in più.
const TIMELINE_DURATION = 5

function interpolateKeyframes(kfs, t) {
  const pick = (kf) => ({ posX: kf.posX, posY: kf.posY, posZ: kf.posZ, rotX: kf.rotX, rotY: kf.rotY, rotZ: kf.rotZ })
  const lerp = (a, b, f) => a + (b - a) * f
  if (t <= kfs[0].time) return pick(kfs[0])
  const last = kfs[kfs.length - 1]
  if (t >= last.time) return pick(last)
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1]
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time
      const f = span > 0 ? (t - a.time) / span : 0
      return {
        posX: lerp(a.posX, b.posX, f), posY: lerp(a.posY, b.posY, f), posZ: lerp(a.posZ, b.posZ, f),
        rotX: lerp(a.rotX, b.rotX, f), rotY: lerp(a.rotY, b.rotY, f), rotZ: lerp(a.rotZ, b.rotZ, f),
      }
    }
  }
  return pick(last)
}

/**
 * Editor mesh/gruppo (?debug, editMode === 'meshes'): due selettori Leva
 * separati e mutuamente esclusivi — "Gruppo" (uno dei meshGroups) o "Mesh"
 * (una mesh individuale, come prima). Selezionando un gruppo, il gizmo e gli
 * slider di trasformazione operano sul CENTRO DI MASSA CUMULATIVO di tutte
 * le mesh del gruppo (trasformazione rigida in blocco); selezionando una
 * singola mesh, il comportamento resta IDENTICO a prima (pivot sul centro
 * geometrico della singola mesh) — le due modalità condividono lo stesso
 * meccanismo di "wrap in un pivot temporaneo" ma con logiche di calcolo del
 * centro deliberatamente separate, non unificate, proprio per non alterare
 * il comportamento mesh-singola esistente.
 */
export default function MeshController({ modelUrl, selectedMesh, onSelectMesh, editMode = 'none', meshGroups = DEFAULT_MESH_GROUPS, timelineApiRef }) {
  // Timeline riusa integralmente selezione/pivot/gizmo di Mesh: nessuna
  // logica separata, solo un secondo editMode che attiva lo stesso ramo.
  const active = editMode === 'meshes' || editMode === 'timeline'
  const { scene } = useGLTF(modelUrl, DRACO_PATH)

  const meshList = useMemo(() => collectMeshList(scene, meshGroups), [scene, meshGroups])
  const meshOptions = useMemo(() => {
    const opts = { '— nessuna —': '' }
    for (const m of meshList) opts[m.label] = m.uuid
    return opts
  }, [meshList])
  const meshByUuid = useMemo(() => new Map(meshList.map((m) => [m.uuid, m.mesh])), [meshList])

  const meshGroupsData = useMemo(() => collectMeshGroups(scene, meshGroups), [scene, meshGroups])
  const groupOptions = useMemo(() => {
    const opts = { '— nessuno —': '' }
    for (const g of meshGroups) opts[g.label] = g.id
    return opts
  }, [meshGroups])

  // posX/Y/Z e rotX/Y/Z sono offset RELATIVI al centro (di massa, singolo o
  // cumulativo) della selezione corrente — vedi pivotInfo.
  const [meshCtrl, setMeshCtrl] = useControls('⚙️ Editor Mesh (Debug)', () => ({
    groupId: { options: groupOptions, value: '', label: 'Gruppo' },
    meshName: { options: meshOptions, value: '', label: 'Mesh' },
    mode: { options: ['translate', 'rotate'], value: 'translate', label: 'Modalità' },
    opacity: { value: 1, min: 0, max: 1, step: 0.01, label: 'Opacità' },
    posX: { value: 0, min: -100, max: 100, step: 0.05, label: 'Pos X (rel.)' },
    posY: { value: 0, min: -100, max: 100, step: 0.05, label: 'Pos Y (rel.)' },
    posZ: { value: 0, min: -100, max: 100, step: 0.05, label: 'Pos Z (rel.)' },
    rotX: { value: 0, min: -180, max: 180, step: 1, label: 'Rot X° (rel.)' },
    rotY: { value: 0, min: -180, max: 180, step: 1, label: 'Rot Y° (rel.)' },
    rotZ: { value: 0, min: -180, max: 180, step: 1, label: 'Rot Z° (rel.)' },
  }), { collapsed: false, render: (get) => ['meshes', 'timeline'].includes(get('⚙️ Editor · Modalità.editMode')) }, [groupOptions, meshOptions])
  const { groupId, meshName, mode, opacity, posX, posY, posZ, rotX, rotY, rotZ } = meshCtrl

  useEffect(() => {
    if (!active) onSelectMesh?.(null)
  }, [active, onSelectMesh])

  useEffect(() => {
    if (!active) return
    const mesh = meshName ? meshByUuid.get(meshName) : null
    if ((mesh ?? null) !== selectedMesh) onSelectMesh?.(mesh ?? null)
  }, [meshName, active, meshByUuid])

  // Specchio dell'effetto sopra, direzione opposta: un click 3D su una mesh
  // (KeyboardModel.jsx chiama onSelectMesh(e.object) direttamente, bypassando
  // Leva) aggiorna `selectedMesh` ma senza questo effetto `meshName`/
  // `groupId` non lo saprebbero mai — il dropdown/gizmo resterebbero
  // agganciati alla selezione precedente (o a un gruppo, stato "split-brain").
  // Confrontato per UUID contro `meshName`, la stessa chiave che l'effetto
  // sopra usa nella direzione inversa: entrambi convergono sullo stesso
  // valore di verità.
  //
  // Deps DELIBERATAMENTE senza `active`: sulla transizione di riattivazione
  // (si rientra in Mesh/Timeline con un `meshName` non ancora ripulito
  // dall'effetto di disattivazione, che tocca solo `selectedMesh`) includere
  // `active` farebbe rifirare questo effetto sullo stesso giro in cui quello
  // sopra rilegge il `meshName` stale, innescando un ping-pong di un paio di
  // render prima di assestarsi. Omettendolo, questo effetto reagisce solo a
  // un vero cambio di `selectedMesh` — a quel punto `meshName` è già
  // riconciliato. Il guard `!active` in corpo resta come difesa.
  useEffect(() => {
    if (!active) return
    const clickedUuid = selectedMesh ? selectedMesh.uuid : ''
    if (clickedUuid === meshName) return
    suppressClearRef.current = true // riusa il guard dell'effetto di mutua esclusione sotto
    setMeshCtrl({ meshName: clickedUuid, groupId: '' })
  }, [selectedMesh])

  // Selettori "Gruppo"/"Mesh" mutuamente esclusivi: scegliendone uno si
  // azzera l'altro. Traccia quale dei due è CAMBIATO rispetto al render
  // precedente (via ref) invece di due effetti simmetrici che si
  // azzererebbero a vicenda in un ping-pong — suppressClearRef consuma la
  // propria stessa scrittura senza rivalutare la logica di pulizia.
  const prevGroupId = useRef('')
  const prevMeshName = useRef('')
  const suppressClearRef = useRef(false)

  useEffect(() => {
    if (suppressClearRef.current) {
      suppressClearRef.current = false
      prevGroupId.current = groupId
      prevMeshName.current = meshName
      return
    }
    const groupChanged = groupId !== prevGroupId.current
    const meshChanged = meshName !== prevMeshName.current
    prevGroupId.current = groupId
    prevMeshName.current = meshName

    if (groupChanged && groupId !== '' && meshName !== '') {
      suppressClearRef.current = true
      setMeshCtrl({ meshName: '' })
    } else if (meshChanged && meshName !== '' && groupId !== '') {
      suppressClearRef.current = true
      setMeshCtrl({ groupId: '' })
    }
  }, [groupId, meshName])

  // Selezione derivata: un gruppo (tutte le sue mesh) o una singola mesh.
  const selection = useMemo(() => {
    if (groupId) return { type: 'group', groupId, meshes: meshGroupsData[groupId] ?? [] }
    if (meshName) {
      const mesh = meshByUuid.get(meshName)
      return mesh ? { type: 'mesh', mesh, meshes: [mesh] } : null
    }
    return null
  }, [groupId, meshName, meshGroupsData, meshByUuid])

  // Timeline: una traccia di keyframe indipendente per ogni selezione (un
  // gruppo o una mesh ha il proprio set di posX..rotZ nel tempo — non ha
  // senso condividerli, sono trasformazioni relative a centri diversi).
  const selectionKey = selection
    ? selection.type === 'group' ? `group:${selection.groupId}` : `mesh:${selection.mesh.uuid}`
    : null
  const [keyframesBySelection, setKeyframesBySelection] = useState({})
  const [playhead, setPlayhead] = useState(0)
  const playheadRef = useRef(playhead)
  playheadRef.current = playhead
  const keyframesRef = useRef(keyframesBySelection)
  keyframesRef.current = keyframesBySelection

  // Specchi di render usati dagli effetti di ciclo di vita qui sotto, che
  // sono agganciati a `selectionKey` (una STRINGA stabile) e non a
  // `selection` (un oggetto ricreato dal useMemo ogni volta che una delle sue
  // dipendenze cambia identità). Era la causa dei riavvolgimenti "spontanei"
  // del pivot: bastava che meshGroupsData/meshByUuid venissero ricalcolati
  // perché pivot/halo/opacità venissero smontati e rimontati senza che
  // l'utente avesse cambiato selezione — con il rischio, nella finestra fra
  // smontaggio e rimontaggio, che l'offset corrente venisse riapplicato o
  // azzerato contro un pivot sbagliato.
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const editModeRef = useRef(editMode)
  editModeRef.current = editMode

  // --- Pivot al centro (di massa singolo o cumulativo) -----------------
  // Mesh singola: ESATTAMENTE la logica precedente (invariata) — pivot al
  // centro del bounding box locale della mesh, parentato sotto il SUO
  // proprio parent. Molte sub-mesh di questo GLB hanno origine locale
  // lontana dal loro volume visibile (freeze transform Maya): per questo
  // serve un pivot invece di ruotare/traslare la mesh sulla propria origine.
  //
  // Gruppo: pivot al centro dell'UNIONE dei bounding box world-space di
  // tutte le mesh del gruppo (stessa approssimazione "centro di massa via
  // bounding box", generalizzata a N mesh), parentato sotto la root della
  // scena GLTF (l'unico contenitore comune stabile quando le mesh del
  // gruppo hanno parent diversi tra loro). `scene` non ha rotazione/scale
  // proprie ma NON è affatto a identity in world space (eredita rotazione
  // di posa + scala TARGET_WIDTH dai <group> antenati in KeyboardModel.jsx):
  // serve comunque worldToLocal per convertire il centro world-space nel
  // frame locale di `scene`, esattamente come fa il ramo mesh-singola sopra
  // per il proprio `parent`. Object3D.attach() ricalcola la trasformata
  // locale di ogni mesh per preservarne la posa mondiale, quindi funziona
  // indipendentemente da quanto sia profonda/ruotata la gerarchia nativa del
  // GLB sotto ciascuna mesh — stessa precondizione di sempre (solo scale
  // uniforme nella catena di parent).
  const [pivotInfo, setPivotInfo] = useState(null)

  useEffect(() => {
    const selection = selectionRef.current
    // `active` in dipendenza: uscendo da Mesh/Timeline il pivot va DISFATTO,
    // non lasciato appeso. Il cleanup fa attach() verso i parent originali,
    // che "cuoce" la trasformata corrente nella mesh — quindi l'edit resta,
    // ma la scena torna pulita (niente pivot orfani, halo e opacità
    // ripristinati) e ciò che le altre modalità misurano (fit dinamico della
    // camera, scatola luci) è l'albero reale senza impalcature dell'editor.
    if (!active || !selection || selection.meshes.length === 0) { setPivotInfo(null); return }

    // Il reset degli slider avviene NELLO STESSO effetto che crea il pivot
    // (stesso commit React, quindi stesso batch di aggiornamenti di stato):
    // prima era un effetto separato agganciato a [pivotInfo], che girava un
    // render DOPO — e per coprire quella finestra serviva un flag
    // (suppressApplyRef) che poteva essere consumato dalla modifica sbagliata
    // e lasciare l'offset vecchio applicato a un pivot nuovo. Ora
    // pivot e valori arrivano insieme e l'effetto "applica offset" è
    // puramente idempotente (pivot = base + offset corrente).
    const resetPatch = () => {
      const patch = { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0 }
      if (selection.type === 'mesh') patch.meshName = selection.mesh.uuid
      const kfs = editModeRef.current === 'timeline' && selectionKey ? keyframesRef.current[selectionKey] : null
      if (kfs && kfs.length > 0) Object.assign(patch, interpolateKeyframes(kfs, playheadRef.current))
      return patch
    }

    if (selection.type === 'mesh') {
      const mesh = selection.mesh
      const parent = mesh.parent
      if (!parent) { setPivotInfo(null); return }

      mesh.updateWorldMatrix(true, false)
      mesh.geometry.computeBoundingBox()
      const localCenter = mesh.geometry.boundingBox.getCenter(new THREE.Vector3())
      const worldCenter = mesh.localToWorld(localCenter.clone())

      // Orientamento del pivot = orientamento mondiale della mesh, espresso
      // nello spazio locale di `parent` (via getWorldQuaternion, non
      // copiando il quaternion locale: robusto a prescindere da come pivot e
      // mesh verranno manipolati più avanti).
      const parentWorldQuat = parent.getWorldQuaternion(new THREE.Quaternion())
      const meshWorldQuat = mesh.getWorldQuaternion(new THREE.Quaternion())

      const pivot = new THREE.Group()
      pivot.name = '__meshEditorPivot'
      parent.add(pivot)
      pivot.position.copy(parent.worldToLocal(worldCenter.clone()))
      pivot.quaternion.copy(parentWorldQuat.invert().multiply(meshWorldQuat))
      pivot.attach(mesh)

      setPivotInfo({ pivot, basePosition: pivot.position.clone(), baseQuaternion: pivot.quaternion.clone() })
      setMeshCtrl(resetPatch())

      return () => {
        parent.attach(mesh) // "cuoce" l'edit corrente nella trasformata locale originale della mesh
        parent.remove(pivot)
      }
    }

    // Gruppo: centro = centro dell'unione dei bounding box world-space.
    const meshes = selection.meshes
    meshes.forEach((m) => m.updateWorldMatrix(true, false))
    const box = new THREE.Box3()
    for (const m of meshes) box.union(new THREE.Box3().setFromObject(m))
    const worldCenter = box.getCenter(new THREE.Vector3())

    const pivot = new THREE.Group()
    pivot.name = '__meshEditorPivot'
    scene.add(pivot)
    pivot.position.copy(scene.worldToLocal(worldCenter.clone()))
    // Quaternion lasciato a identity: con più mesh di orientamento diverso
    // non esiste un singolo "orientamento del gruppo" ben definito — la
    // rotazione rigida in blocco funziona comunque via composizione
    // parent/figlio di attach(), qualunque sia l'orientamento di partenza
    // del pivot.

    const originalParents = meshes.map((m) => m.parent)
    for (const m of meshes) pivot.attach(m)

    setPivotInfo({ pivot, basePosition: pivot.position.clone(), baseQuaternion: pivot.quaternion.clone() })
    setMeshCtrl(resetPatch())

    return () => {
      meshes.forEach((m, i) => originalParents[i]?.attach(m))
      pivot.parent?.remove(pivot)
    }
    // Agganciato alla CHIAVE stabile della selezione, non all'oggetto
    // `selection`: vedi selectionRef sopra.
  }, [selectionKey, active, scene])

  // Timeline: scorrere il playhead applica il valore interpolato tra i due
  // keyframe più vicini della selezione corrente — riusa lo stesso
  // setMeshCtrl(posX..rotZ) che gizmo/slider già scrivono, quindi l'effetto
  // "applica l'offset al pivot" sotto fa il resto senza duplicazione.
  useEffect(() => {
    if (editMode !== 'timeline' || !selectionKey) return
    const kfs = keyframesBySelection[selectionKey]
    if (!kfs || kfs.length === 0) return
    setMeshCtrl(interpolateKeyframes(kfs, playhead))
  }, [playhead, selectionKey, keyframesBySelection, editMode])

  // Applica l'offset relativo al pivot. Puramente IDEMPOTENTE — "il pivot è
  // sempre base + offset corrente" — e quindi sicuro da rieseguire su
  // qualunque cambio, incluso `pivotInfo` stesso (che ora è in dipendenza):
  // non esiste più uno stato "in volo" da proteggere con un flag, perché il
  // pivot nuovo e i valori azzerati/interpolati arrivano nello stesso commit
  // (vedi l'effetto del pivot sopra). Rieseguire su pivotInfo è anzi
  // necessario: garantisce che un pivot appena creato riceva subito i valori
  // correnti invece di restare disallineato fino al primo movimento di slider.
  useEffect(() => {
    if (!pivotInfo) return
    pivotInfo.pivot.position.copy(pivotInfo.basePosition).add(new THREE.Vector3(posX, posY, posZ))
    const deltaQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(rotX), THREE.MathUtils.degToRad(rotY), THREE.MathUtils.degToRad(rotZ))
    )
    pivotInfo.pivot.quaternion.copy(pivotInfo.baseQuaternion).multiply(deltaQuat)
  }, [pivotInfo, posX, posY, posZ, rotX, rotY, rotZ])

  // --- Halo di selezione ----------------------------------------------
  // Guscio invertito per OGNI mesh della selezione (1 per la mesh singola, N
  // per un gruppo): figlio della mesh stessa (non del pivot), così eredita
  // la trasformata mondiale reale a prescindere dal wrap/unwrap del pivot.
  // Scale applicato ATTORNO al centro geometrico locale di ciascuna mesh
  // (non all'origine locale) via position+scale combinati sulla stessa
  // mesh. `raycast = () => null` altrimenti un click sul bordo (dove l'halo
  // sporge oltre la mesh reale) selezionerebbe l'halo invece della mesh.
  useEffect(() => {
    const selection = selectionRef.current
    // `active` in dipendenza: senza, l'halo blu (e l'opacità qui sotto)
    // restavano applicati al modello anche dopo essere passati in modalità
    // Luci o Nessuno, perché la selezione Leva sopravvive al cambio modalità.
    if (!active || !selection) return
    const halos = selection.meshes.map((mesh) => {
      mesh.geometry.computeBoundingBox()
      const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3())
      const halo = new THREE.Mesh(
        mesh.geometry,
        new THREE.MeshBasicMaterial({
          color: HALO_COLOR,
          side: THREE.BackSide,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        })
      )
      halo.scale.setScalar(HALO_SCALE)
      halo.position.copy(center).multiplyScalar(1 - HALO_SCALE)
      halo.renderOrder = 999
      halo.raycast = () => null
      // Marcatore per chi traversa la scena: l'halo è un guscio ingrandito
      // del 4%, non geometria del prodotto — va escluso sia dalla
      // classificazione in gruppi (materials/meshGroups.js) sia dalla misura
      // della bounding box del light box (LightRig.jsx).
      halo.userData.__editorHelper = true
      mesh.add(halo)
      return { mesh, halo }
    })

    return () => {
      for (const { mesh, halo } of halos) {
        mesh.remove(halo)
        halo.material.dispose()
      }
    }
  }, [selectionKey, active])

  // Opacità: aiuto visivo temporaneo su tutte le mesh della selezione, si
  // ripristina al deselezionare (via cleanup). Deduplica per identità del
  // materiale: le mesh di un gruppo possono condividere UN solo materiale
  // clonato (vedi materials/groupMaterials.js) — senza dedup, la seconda
  // mesh che condivide lo stesso materiale leggerebbe come "opacità
  // originale" il valore appena scritto dalla prima, corrompendo il
  // ripristino al deselezionare.
  useEffect(() => {
    const selection = selectionRef.current
    if (!active || !selection) return
    const seen = new Set()
    const restores = []
    for (const mesh of selection.meshes) {
      const mat = mesh.material
      if (!mat || seen.has(mat)) continue
      seen.add(mat)
      const prevTransparent = mat.transparent
      const prevOpacity = mat.opacity
      mat.transparent = true
      mat.opacity = opacity
      mat.needsUpdate = true
      restores.push(() => {
        mat.transparent = prevTransparent
        mat.opacity = prevOpacity
        mat.needsUpdate = true
      })
    }
    return () => restores.forEach((restore) => restore())
  }, [selectionKey, active, opacity])

  // --- Ponte imperativo per Timeline.jsx (fuori dal Canvas) -------------
  // Refs, aggiornate a ogni render: le AZIONI (sotto) vivono in un effetto
  // montato una sola volta (deps [timelineApiRef]) e le leggono da qui invece
  // che dalle variabili closure dirette, altrimenti — essendo l'effetto
  // creato una volta sola — le closure imprigionerebbero i valori del primo
  // render (es. "Aggiungi keyframe" catturerebbe sempre posX..rotZ di allora,
  // ignorando un trascinamento del gizmo avvenuto dopo senza cambiare
  // selectionKey/keyframesBySelection/playhead).
  const selectionKeyRef = useRef(selectionKey)
  selectionKeyRef.current = selectionKey
  const meshCtrlRef = useRef(meshCtrl)
  meshCtrlRef.current = meshCtrl
  // `keyframesRef` è dichiarato più in alto (accanto allo stato dei keyframe):
  // serve anche all'effetto del pivot, che è definito prima di questo blocco.

  useEffect(() => {
    if (!timelineApiRef) return
    if (!timelineApiRef.current) timelineApiRef.current = {}
    Object.assign(timelineApiRef.current, {
      duration: TIMELINE_DURATION,
      addKeyframe() {
        const key = selectionKeyRef.current
        if (!key) return
        const { posX, posY, posZ, rotX, rotY, rotZ } = meshCtrlRef.current
        const t = playheadRef.current
        setKeyframesBySelection((prev) => {
          const existing = (prev[key] ?? []).filter((k) => Math.abs(k.time - t) > 1e-3)
          const next = [
            ...existing,
            { id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, time: t, posX, posY, posZ, rotX, rotY, rotZ },
          ].sort((a, b) => a.time - b.time)
          return { ...prev, [key]: next }
        })
      },
      removeKeyframe(id) {
        const key = selectionKeyRef.current
        if (!key) return
        setKeyframesBySelection((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((k) => k.id !== id) }))
      },
      jumpToKeyframe(id) {
        const kf = (keyframesRef.current[selectionKeyRef.current] ?? []).find((k) => k.id === id)
        if (kf) setPlayhead(kf.time)
      },
      setPlayhead(t) {
        setPlayhead(Math.max(0, Math.min(TIMELINE_DURATION, t)))
      },
    })
  }, [timelineApiRef])

  // Campi di sola lettura per Timeline.jsx — "eventualmente corretti" va bene
  // qui (poll a 150ms), quindi un effetto reattivo normale è sufficiente.
  useEffect(() => {
    if (!timelineApiRef?.current) return
    timelineApiRef.current.selectionLabel = selection
      ? selection.type === 'group'
        ? (meshGroups.find((g) => g.id === selection.groupId)?.label ?? selection.groupId)
        : (selection.mesh.name || selection.mesh.uuid)
      : null
    timelineApiRef.current.keyframes = selectionKey ? (keyframesBySelection[selectionKey] ?? []) : []
    timelineApiRef.current.playhead = playhead
  }, [timelineApiRef, selection, selectionKey, keyframesBySelection, playhead, meshGroups])

  if (!active || !selection || !pivotInfo) return null

  return (
    <TransformControls
      object={pivotInfo.pivot}
      mode={mode}
      onMouseDown={() => {
        // Blocca la rotazione/navigazione della camera mentre si trascina la mesh
        if (window.__abortComposerDrag) window.__abortComposerDrag()
      }}
      // `onObjectChange`, NON `onChange`. `change` è generico: three lo
      // emette dal setter di ogni proprietà osservata di TransformControls
      // (vedi il defineProperty in TransformControls.js), quindi anche
      // quando drei fa `controls.attach(nuovoPivot)` al cambio selezione. In
      // quell'istante la callback invocata è ancora la closure del render
      // PRECEDENTE, che punta al pivot VECCHIO — fermo a `base + offset` —
      // e quindi ripubblicava quell'offset in Leva subito dopo che
      // l'effetto del pivot lo aveva azzerato: il valore finiva applicato
      // alla mesh/gruppo appena selezionato (bug osservato: selezionare
      // direttamente un'altra selezione senza passare da un click a vuoto
      // trascinava con sé il valore degli slider). `objectChange` invece
      // three lo emette SOLO da pointerMove, cioè solo quando è l'utente a
      // trascinare davvero il gizmo — mai su attach/detach/cambio modo.
      // La guardia d'identità sotto è difesa in profondità: durante un drag
      // reale la selezione non cambia, quindi non scatta mai.
      onObjectChange={(e) => {
        const controlled = e?.target?.object
        if (controlled && controlled !== pivotInfo.pivot) return
        const offset = pivotInfo.pivot.position.clone().sub(pivotInfo.basePosition)
        const deltaQuat = pivotInfo.baseQuaternion.clone().invert().multiply(pivotInfo.pivot.quaternion)
        const deltaEuler = new THREE.Euler().setFromQuaternion(deltaQuat)
        setMeshCtrl({
          posX: offset.x, posY: offset.y, posZ: offset.z,
          rotX: THREE.MathUtils.radToDeg(deltaEuler.x),
          rotY: THREE.MathUtils.radToDeg(deltaEuler.y),
          rotZ: THREE.MathUtils.radToDeg(deltaEuler.z),
        })
      }}
    />
  )
}
