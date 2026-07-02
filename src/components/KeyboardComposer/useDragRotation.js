import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { easing } from 'maath'

const SNAP_STEP = Math.PI / 4 // 45°
const VELOCITY_SMOOTHING = 0.7
// Limita l'inerzia: un fling al massimo salta ~2 giri, mai rotazioni infinite.
const MAX_VELOCITY = 12 // rad/s

const snap = (angle) => Math.round(angle / SNAP_STEP) * SNAP_STEP
const clampVel = (v) => Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, v))

/**
 * Rotazione libera su entrambi gli assi con drag del pointer:
 * drag orizzontale → asse Y, drag verticale → asse X, senza limiti (360°).
 * Al rilascio la velocità residua proietta l'angolo di arrivo, agganciato
 * al multiplo di 45° più vicino per ciascun asse, con smorzamento critico
 * (easing.damp) per un settle organico.
 */
export function useDragRotation(
  groupRef,
  { speed = 0.008, flingFactor = 0.15, smoothTime = 0.4 } = {},
) {
  const gl = useThree((s) => s.gl)
  const state = useRef({
    targetY: 0, // yaw   (drag orizzontale)
    targetX: 0, // pitch (drag verticale)
    dragging: false,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    velocityY: 0,
    velocityX: 0,
  })

  useEffect(() => {
    const el = gl.domElement
    const s = state.current
    el.style.cursor = 'grab'
    el.style.touchAction = 'none'

    const onDown = (e) => {
      if (!e.isPrimary) return
      s.dragging = true
      s.lastX = e.clientX
      s.lastY = e.clientY
      s.lastT = performance.now()
      s.velocityY = 0
      s.velocityX = 0
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // pointer sintetici (test) non catturabili: il drag funziona comunque
      }
      el.style.cursor = 'grabbing'
    }

    const onMove = (e) => {
      if (!s.dragging || !e.isPrimary) return
      const now = performance.now()
      const dx = e.clientX - s.lastX
      const dy = e.clientY - s.lastY
      const dt = Math.max((now - s.lastT) / 1000, 1e-4)
      const deltaY = dx * speed
      const deltaX = dy * speed
      s.targetY += deltaY
      s.targetX += deltaX
      // Velocità lisciata sugli ultimi campioni, per un fling stabile.
      s.velocityY =
        VELOCITY_SMOOTHING * s.velocityY +
        (1 - VELOCITY_SMOOTHING) * clampVel(deltaY / dt)
      s.velocityX =
        VELOCITY_SMOOTHING * s.velocityX +
        (1 - VELOCITY_SMOOTHING) * clampVel(deltaX / dt)
      s.lastX = e.clientX
      s.lastY = e.clientY
      s.lastT = now
    }

    const onUp = (e) => {
      if (!s.dragging) return
      s.dragging = false
      el.style.cursor = 'grab'
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      // Se il pointer era fermo da un po', niente inerzia.
      if (performance.now() - s.lastT > 120) {
        s.velocityY = 0
        s.velocityX = 0
      }
      s.targetY = snap(s.targetY + s.velocityY * flingFactor)
      s.targetX = snap(s.targetX + s.velocityX * flingFactor)
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
  }, [gl, speed, flingFactor])

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return
    const s = state.current
    // Durante il drag il follow è quasi 1:1; al rilascio settle morbido.
    const t = s.dragging ? 0.06 : smoothTime
    easing.damp(group.rotation, 'y', s.targetY, t, delta)
    easing.damp(group.rotation, 'x', s.targetX, t, delta)
  })
}
