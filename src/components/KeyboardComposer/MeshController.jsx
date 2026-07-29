import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useGLTF, TransformControls } from '@react-three/drei'
import { useControls } from 'leva'
import { DRACO_PATH } from './KeyboardModel'
import { collectMeshGroups, collectMeshList, DEFAULT_MESH_GROUPS } from './materials/meshGroups'
import { wrapMeshInPivot, wrapGroupInPivot } from './animation/pivot'

const HALO_SCALE = 1.04
const HALO_COLOR = '#4dabf7'

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
 *
 * Quella meccanica vive ora in animation/pivot.js, condivisa con le animazioni
 * autorate: identica al wrap, diversa allo SMONTAGGIO — qui `bake: true` (la
 * modifica dell'utente si cuoce nella mesh e persiste), lì ripristino esatto.
 */
export default function MeshController({ modelUrl, selectedMesh, onSelectMesh, editMode = 'none', meshGroups = DEFAULT_MESH_GROUPS }) {
  const active = editMode === 'meshes'
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
  }), { collapsed: false, render: (get) => get('⚙️ Editor · Modalità.editMode') === 'meshes' }, [groupOptions, meshOptions])
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
  // (si rientra in Mesh con un `meshName` non ancora ripulito
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

  // Chiave STABILE della selezione corrente (un gruppo o una mesh): è ciò su
  // cui sono agganciati gli effetti di ciclo di vita qui sotto — vedi
  // selectionRef.
  const selectionKey = selection
    ? selection.type === 'group' ? `group:${selection.groupId}` : `mesh:${selection.mesh.uuid}`
    : null

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
    // `active` in dipendenza: uscendo da Mesh il pivot va DISFATTO,
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
      return patch
    }

    // La meccanica del wrap vive in animation/pivot.js: è la stessa che usano
    // le animazioni (spin, offset autorati), estratta da qui senza cambiarla.
    // L'unica differenza è lo SMONTAGGIO — qui `bake: true`, cioè la
    // trasformata corrente viene cotta nella mesh e la modifica dell'utente
    // persiste. Le animazioni fanno l'opposto (ripristinano), vedi pivot.js.
    const wrap = selection.type === 'mesh'
      ? wrapMeshInPivot(selection.mesh, { name: '__meshEditorPivot' })
      : wrapGroupInPivot(selection.meshes, scene, { name: '__meshEditorPivot' })

    if (!wrap) { setPivotInfo(null); return }

    setPivotInfo({
      pivot: wrap.pivot,
      basePosition: wrap.basePosition,
      baseQuaternion: wrap.baseQuaternion,
    })
    setMeshCtrl(resetPatch())

    return () => wrap.restore({ bake: true })
    // Agganciato alla CHIAVE stabile della selezione, non all'oggetto
    // `selection`: vedi selectionRef sopra.
  }, [selectionKey, active, scene])

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
