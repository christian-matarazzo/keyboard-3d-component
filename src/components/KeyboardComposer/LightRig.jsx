import { useMemo } from 'react'
import { useControls } from 'leva'

const RIG_POSITION = [0, 0.1, 0] // pivot del modello

export default function LightRig({ modelSize } = {}) {
  // Matrice Volumetrica Fissa: 26 punti luce distribuiti attorno al modello.
  const volumetric = useControls('Luci · Matrice Volumetrica (26 pti)', {
    intensity: { value: 2.0, min: 0, max: 50, step: 0.1 },
    color: '#ffffff',
    distance: { value: 6, min: 0, max: 30, step: 0.1 },
    decay: { value: 2, min: 0, max: 5, step: 0.1 },
    margin: { value: 1.0, min: 0, max: 3, step: 0.1 },
    showHelpers: { value: false, label: 'mostra punti' },
  })

  // Calcolo dei 26 punti volumetrici base modelSize e margin
  const volumetricPoints = useMemo(() => {
    if (!modelSize) return []
    const m = volumetric.margin
    const xs = [-modelSize.x / 2 - m, 0, modelSize.x / 2 + m]
    const ys = [modelSize.y / 2 + m, 0, -modelSize.y / 2 - m]
    const zs = [-modelSize.z / 2 - m, 0, modelSize.z / 2 + m]

    const pts = []
    for (let y of ys) {
      for (let z of zs) {
        for (let x of xs) {
          // Ometti il punto centrale
          if (Math.abs(y) < 0.001 && Math.abs(x) < 0.001 && Math.abs(z) < 0.001) continue
          pts.push([x, y, z])
        }
      }
    }
    return pts
  }, [modelSize, volumetric.margin])

  return (
    <group position={RIG_POSITION}>
      {volumetricPoints.map((pos, i) => (
        <group key={i} position={pos}>
          <pointLight
            intensity={volumetric.intensity}
            color={volumetric.color}
            distance={volumetric.distance}
            decay={volumetric.decay}
          />
          {volumetric.showHelpers && (
            <mesh>
              <sphereGeometry args={[0.05, 16, 16]} />
              <meshBasicMaterial color={volumetric.color} wireframe />
            </mesh>
          )}
        </group>
      ))}
    </group>
  )
}
