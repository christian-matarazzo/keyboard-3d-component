import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { easing } from 'maath'

/**
 * Zoom con la rotella del mouse: dolly della camera lungo la sua direzione
 * di vista, con distanza clampata e smorzamento per un movimento fluido.
 */
export function useWheelZoom({ min = 3, max = 8, sensitivity = 0.0012 } = {}) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const zoom = useRef({ target: null, current: null })

  useEffect(() => {
    const el = gl.domElement
    const z = zoom.current

    const onWheel = (e) => {
      e.preventDefault() // sul canvas la rotella zooma, non scrolla la pagina
      if (z.target == null) {
        z.target = camera.position.length()
        z.current = z.target
      }
      z.target = Math.max(min, Math.min(max, z.target * (1 + e.deltaY * sensitivity)))
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [gl, camera, min, max, sensitivity])

  useFrame((_, delta) => {
    const z = zoom.current
    if (z.target == null) return
    easing.damp(z, 'current', z.target, 0.25, delta)
    camera.position.setLength(z.current)
  })
}
