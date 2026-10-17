'use client'

/**
 * 4 类被动雷达信号环绕微天体构件
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - proposal.md §2 (关键信号=环绕体, 4类被动雷达硬信号)
 * - design.md Decision 2 (信号环绕体几何隐喻与色温)
 * - tasks.md 3.3
 * - 4 类形状：进度偏差(asteroid 椭圆), 风险突变(cone 双锥体), 资源过载(box 方块), 里程碑滑移(needle 信标针)
 * - 基于原生时间增量在轨道上公转，严禁引入 GSAP (RL-15)
 */

import * as React from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { StarSignalVisual } from './spacemap-state-mapper'

export interface SpaceMapSignalOrbiterProps {
  signal: StarSignalVisual
  tier?: 'high' | 'low' | 'fallback'
  parentRadius?: number
}

function SignalGeometry({ shape }: { shape: StarSignalVisual['shape'] }) {
  switch (shape) {
    case 'asteroid':
      // 偏心椭圆小行星
      return <sphereGeometry args={[0.22, 10, 10]} />
    case 'cone':
      // 双锥体警戒卫星
      return <octahedronGeometry args={[0.25, 0]} />
    case 'box':
      // 四棱小方块集群
      return <boxGeometry args={[0.28, 0.28, 0.28]} />
    case 'needle':
      // 沿切线方向拖尾的细微信标针
      return <cylinderGeometry args={[0.05, 0.05, 0.55, 6]} />
    default:
      return <sphereGeometry args={[0.2, 8, 8]} />
  }
}

export function SpaceMapSignalOrbiter({ signal, tier = 'high' }: SpaceMapSignalOrbiterProps) {
  const orbiterGroupRef = React.useRef<THREE.Group>(null)
  const meshRef = React.useRef<THREE.Mesh>(null)

  // 沿轨道平滑公转计算
  useFrame(({ clock }) => {
    if (tier === 'low' || !orbiterGroupRef.current) return

    const t = clock.getElapsedTime()
    const angle = t * signal.orbitSpeed
    const r = signal.orbitRadius

    // 轨道倾角与旋转
    const x = r * Math.cos(angle)
    const z = r * Math.sin(angle)
    const y = Math.sin(signal.orbitTilt) * (r * 0.35) * Math.sin(angle)

    orbiterGroupRef.current.position.set(x, y, z)

    if (meshRef.current) {
      meshRef.current.rotation.x += 0.02
      meshRef.current.rotation.y += 0.03
    }
  })

  // 初始静态机位（用于 low 档首帧或非高档位）
  const initialPos: [number, number, number] = React.useMemo(() => {
    const r = signal.orbitRadius
    const angle = signal.orbitTilt * 2
    return [
      r * Math.cos(angle),
      Math.sin(signal.orbitTilt) * (r * 0.35) * Math.sin(angle),
      r * Math.sin(angle),
    ]
  }, [signal.orbitRadius, signal.orbitTilt])

  return (
    <group
      data-testid={`signal-orbiter-${signal.id}`}
      userData={{ shape: signal.shape, signalType: signal.signalType, severity: signal.severity }}
    >
      {/* 微弱环绕轨道发丝引力导轨 */}
      <mesh rotation={[signal.orbitTilt, 0, 0]}>
        <ringGeometry args={[signal.orbitRadius - 0.03, signal.orbitRadius + 0.03, 48]} />
        <meshBasicMaterial
          color={signal.color}
          transparent
          opacity={0.18}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 公转几何微天体 */}
      <group ref={orbiterGroupRef} position={initialPos}>
        <mesh ref={meshRef} scale={signal.shape === 'asteroid' ? [1.3, 0.8, 1.0] : [1, 1, 1]}>
          <SignalGeometry shape={signal.shape} />
          <meshStandardMaterial
            color={signal.color}
            emissive={signal.color}
            emissiveIntensity={0.6}
            roughness={0.4}
            metalness={0.2}
          />
        </mesh>
      </group>
    </group>
  )
}
