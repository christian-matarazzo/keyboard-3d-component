import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { easing } from 'maath'

const SNAP_STEP = Math.PI / 4 // 45°
const VELOCITY_SMOOTHING = 0.7
// Limita l'inerzia: un fling al massimo salta ~2 giri, mai rotazioni infinite.
const MAX_VELOCITY = 12 // rad/s
// Mezza larghezza del modello + margine: usata per il fit responsive.
const FIT_HALF_WIDTH = 2.0

const snap = (angle) => Math.round(angle / SNAP_STEP) * SNAP_STEP
const clampVel = (v) => Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, v))
const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

/**
 * Controlli del configuratore, coordinati su un unico set di pointer event:
 *  - 1 dito / mouse: rotazione libera su X e Y (360°), snap a 45° al rilascio
 *  - 2 dita: pinch-to-zoom
 *  - rotella del mouse: zoom
 * La distanza iniziale della camera è calcolata dall'aspect ratio del canvas,
 * così su viewport stretti (mobile) il modello entra intero nel frame.
 */
export function useComposerControls(
  groupRef,
  { speed = 0.008, flingFactor = 0.15, smoothTime = 0.4, minZoom = 3 } = {},
) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const rot = useRef({
    targetY: 0, // yaw   (drag orizzontale)
    targetX: 0, // pitch (drag verticale)
    dragging: false,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    velocityY: 0,
    velocityX: 0,
  })
  const zoom = useRef({ target: null, current: null, max: 8 })
  const pointers = useRef(new Map())
  const pinch = useRef({ active: false, startDist: 0, startTarget: 0 })

  // Fit responsive: distanza minima perché il modello entri in orizzontale.
  useEffect(() => {
    const aspect = size.width / Math.max(size.height, 1)
    const tanHalfV = Math.tan((camera.fov * Math.PI) / 360)
    const fit = clamp(FIT_HALF_WIDTH / (tanHalfV * aspect), 5.2, 12)
    const z = zoom.current
    z.max = Math.max(8, fit)
    if (z.target == null) {
      // primo mount: nessuna animazione d'ingresso
      z.target = fit
      z.current = fit
      camera.position.setLength(fit)
    } else {
      z.target = fit
    }
  }, [size, camera])

  useEffect(() => {
    const el = gl.domElement
    const r = rot.current
    const z = zoom.current
    const pts = pointers.current
    const p = pinch.current
    el.style.cursor = 'grab'
    el.style.touchAction = 'none'

    const pinchDistance = () => {
      const [a, b] = [...pts.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }

    const onDown = (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // pointer sintetici (test) non catturabili: i gesti funzionano comunque
      }
      if (pts.size === 2) {
        // seconda dita: si passa da rotazione a pinch
        p.active = true
        p.startDist = Math.max(pinchDistance(), 1)
        p.startTarget = z.target ?? camera.position.length()
        r.dragging = false
        r.velocityY = 0
        r.velocityX = 0
      } else if (pts.size === 1) {
        r.dragging = true
        r.lastX = e.clientX
        r.lastY = e.clientY
        r.lastT = performance.now()
        r.velocityY = 0
        r.velocityX = 0
        el.style.cursor = 'grabbing'
      }
    }

    const onMove = (e) => {
      const pt = pts.get(e.pointerId)
      if (!pt) return
      pt.x = e.clientX
      pt.y = e.clientY

      if (p.active && pts.size >= 2) {
        // dita che si allontanano → zoom in (distanza camera ridotta)
        const factor = p.startDist / Math.max(pinchDistance(), 1)
        z.target = clamp(p.startTarget * factor, minZoom, z.max)
        return
      }

      if (!r.dragging) return
      const now = performance.now()
      const dx = e.clientX - r.lastX
      const dy = e.clientY - r.lastY
      const dt = Math.max((now - r.lastT) / 1000, 1e-4)
      const deltaY = dx * speed
      const deltaX = dy * speed
      r.targetY += deltaY
      r.targetX += deltaX
      // Velocità lisciata sugli ultimi campioni, per un fling stabile.
      r.velocityY =
        VELOCITY_SMOOTHING * r.velocityY +
        (1 - VELOCITY_SMOOTHING) * clampVel(deltaY / dt)
      r.velocityX =
        VELOCITY_SMOOTHING * r.velocityX +
        (1 - VELOCITY_SMOOTHING) * clampVel(deltaX / dt)
      r.lastX = e.clientX
      r.lastY = e.clientY
      r.lastT = now
    }

    const endRotation = () => {
      r.dragging = false
      el.style.cursor = 'grab'
      // Se il pointer era fermo da un po', niente inerzia.
      if (performance.now() - r.lastT > 120) {
        r.velocityY = 0
        r.velocityX = 0
      }
      r.targetY = snap(r.targetY + r.velocityY * flingFactor)
      r.targetX = snap(r.targetX + r.velocityX * flingFactor)
    }

    const onUp = (e) => {
      if (!pts.has(e.pointerId)) return
      pts.delete(e.pointerId)
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)

      if (p.active) {
        if (pts.size < 2) {
          p.active = false
          if (pts.size === 1) {
            // resta un dito: riparte la rotazione da qui, senza salti
            const [remaining] = [...pts.values()]
            r.dragging = true
            r.lastX = remaining.x
            r.lastY = remaining.y
            r.lastT = performance.now()
            r.velocityY = 0
            r.velocityX = 0
          }
        }
        return
      }

      if (r.dragging && pts.size === 0) endRotation()
    }

    const onWheel = (e) => {
      e.preventDefault() // sul canvas la rotella zooma, non scrolla la pagina
      if (z.target == null) {
        z.target = camera.position.length()
        z.current = z.target
      }
      z.target = clamp(z.target * (1 + e.deltaY * 0.0012), minZoom, z.max)
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl, camera, speed, flingFactor, minZoom])

  useFrame((_, delta) => {
    const group = groupRef.current
    const r = rot.current
    const z = zoom.current
    if (group) {
      // Durante il drag il follow è quasi 1:1; al rilascio settle morbido.
      const t = r.dragging ? 0.06 : smoothTime
      easing.damp(group.rotation, 'y', r.targetY, t, delta)
      easing.damp(group.rotation, 'x', r.targetX, t, delta)
    }
    if (z.target != null) {
      easing.damp(z, 'current', z.target, 0.25, delta)
      camera.position.setLength(z.current)
    }
  })
}
