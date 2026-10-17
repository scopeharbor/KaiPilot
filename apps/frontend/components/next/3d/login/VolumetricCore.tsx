'use client'

import * as React from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export interface VolumetricCoreProps {
  tier?: 'high' | 'low' | 'fallback'
}

export function VolumetricCore({ tier = 'high' }: VolumetricCoreProps) {
  const outerRef = React.useRef<THREE.Mesh>(null)
  const innerRef = React.useRef<THREE.Mesh>(null)

  useFrame((_, delta) => {
    if (tier === 'fallback' || tier === 'low') return

    if (outerRef.current) {
      outerRef.current.rotation.x += delta * 0.05
      outerRef.current.rotation.y += delta * 0.08
    }
    if (innerRef.current) {
      innerRef.current.rotation.y -= delta * 0.04
    }
  })

  React.useEffect(() => {
    return () => {
      outerRef.current?.geometry?.dispose()
      innerRef.current?.geometry?.dispose()
      if (outerRef.current?.material instanceof THREE.Material) {
        outerRef.current.material.dispose()
      }
      if (innerRef.current?.material instanceof THREE.Material) {
        innerRef.current.material.dispose()
      }
    }
  }, [])

  return (
    <group position={[0, 0, -2.0]}>
      {/* 核心微光发光体 */}
      <mesh ref={innerRef}>
        <sphereGeometry args={[0.75, 16, 16]} />
        <meshBasicMaterial
          color="#00f0ff"
          transparent
          opacity={0.14}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* 外围慢速缓动几何环带 */}
      <mesh ref={outerRef}>
        <icosahedronGeometry args={[1.25, 1]} />
        <meshBasicMaterial
          color="#38bdf8"
          wireframe
          transparent
          opacity={0.18}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  )
}
