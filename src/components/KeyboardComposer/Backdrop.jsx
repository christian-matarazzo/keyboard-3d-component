import { useMemo } from 'react'
import * as THREE from 'three'
import { MeshReflectorMaterial } from '@react-three/drei'

/**
 * Backdrop trasparente: piano orizzontale che raccoglie il riflesso del
 * modello e lascia trasparire lo sfondo CSS della sezione (#101012).
 * Una alphaMap radiale lo dissolve verso i bordi, così il riflesso è
 * concentrato sotto il modello e il piano non mostra mai cuciture.
 * L'ombra morbida è delle ContactShadows in Scene.jsx (1 mm sopra questo
 * piano); qui si aggiunge solo la riflessione sfocata delle luci.
 */
export default function Backdrop() {
  // Gradiente radiale bianco→trasparente usato come maschera di opacità.
  const alphaMap = useMemo(() => {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    )
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    return new THREE.CanvasTexture(canvas)
  }, [])

  return (
    <mesh position={[0, -1.501, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[24, 24]} />
      <MeshReflectorMaterial
        transparent
        opacity={0.5}
        alphaMap={alphaMap}
        color="#000000"
        mirror={0.55}
        resolution={512}
        blur={[400, 100]}
        mixBlur={0.9}
        mixStrength={2}
        depthScale={0.6}
        minDepthThreshold={0.4}
        maxDepthThreshold={1.2}
        roughness={1}
        metalness={0}
        depthWrite={false}
      />
    </mesh>
  )
}
