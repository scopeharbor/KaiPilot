'use client'

import * as React from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export interface InstancedStarfieldProps {
  count?: number
  isSubmitting?: boolean
  tier?: 'high' | 'low' | 'fallback'
}

// 采用确定性伪随机生成器，保证每次水合布局完全一致，杜绝视觉跳动（RL-14）
function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

export function InstancedStarfield({
  count = 2000,
  isSubmitting = false,
  tier = 'high',
}: InstancedStarfieldProps) {
  const meshRef = React.useRef<THREE.InstancedMesh>(null)
  const dummy = React.useMemo(() => new THREE.Object3D(), [])

  // 实际生效粒子数：低端档位固定 400，沉浸档位 2000
  const actualCount = tier === 'low' ? Math.min(count, 400) : count

  React.useLayoutEffect(() => {
    if (!meshRef.current || !('setMatrixAt' in meshRef.current)) return

    const mesh = meshRef.current
    const palette = [
      new THREE.Color('#38bdf8'), // 冷青
      new THREE.Color('#00f0ff'), // 天青
      new THREE.Color('#ffffff'), // 白光星芒
      new THREE.Color('#7dd3fc'), // 浅天青
    ]

    for (let i = 0; i < actualCount; i++) {
      const x = (seededRandom(i * 3 + 1) - 0.5) * 22
      const y = (seededRandom(i * 3 + 2) - 0.5) * 16
      const z = (seededRandom(i * 3 + 3) - 0.5) * 14 - 1

      const scale = 0.6 + seededRandom(i * 7 + 4) * 1.4
      dummy.position.set(x, y, z)
      dummy.scale.set(scale, scale, scale)
      dummy.updateMatrix()

      mesh.setMatrixAt(i, dummy.matrix)

      // 颜色随机分配
      const colorIndex = Math.floor(seededRandom(i * 11 + 5) * palette.length)
      mesh.setColorAt(i, palette[colorIndex]!)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true
    }
  }, [actualCount, dummy])

  useFrame((_, delta) => {
    if (!meshRef.current || tier === 'fallback') return

    // 低端档位冻结旋转或单帧静态，沉浸档慢速常态漂移
    if (tier !== 'low') {
      const baseSpeed = isSubmitting ? 0.06 : 0.015
      meshRef.current.rotation.y += delta * baseSpeed
      meshRef.current.rotation.x += delta * (baseSpeed * 0.4)
    }
  })

  React.useEffect(() => {
    return () => {
      if (meshRef.current) {
        meshRef.current.geometry?.dispose()
        if (Array.isArray(meshRef.current.material)) {
          meshRef.current.material.forEach((m) => m.dispose())
        } else {
          meshRef.current.material?.dispose()
        }
      }
    }
  }, [])

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, actualCount]} frustumCulled={false}>
      <sphereGeometry args={[0.024, 6, 6]} />
      <meshBasicMaterial
        transparent
        opacity={0.85}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  )
}
