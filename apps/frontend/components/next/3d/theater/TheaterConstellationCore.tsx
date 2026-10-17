'use client'

/**
 * 中心拓扑导轨与星座沙盘基底
 *
 * 规范遵循：v3-next-layer1-theater-3d-m1
 * - proposal.md §3 (防 Slop 规范，克制拓扑导轨)
 * - design.md Decision 3 (拓扑坐标连线与中央微光核心)
 * - RL-06: 显存回收，dispose 几何体与材质
 * - RL-15: 坚决不引入过曝高光与后处理库
 */

import * as React from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  PROJECT_DRAFT_MODULES,
  type ProjectDraftModule,
  type ProjectDraftModuleStatus,
} from '@aiproj/types'
import { MODULE_POSITIONS, MODULE_COLORS, type TheaterSceneMode } from './theater-scene-mapper'

export interface TheaterConstellationCoreProps {
  sceneMode?: TheaterSceneMode
  moduleStatuses?: Partial<Record<ProjectDraftModule, ProjectDraftModuleStatus>>
  tier?: 'high' | 'low' | 'fallback'
}

export function TheaterConstellationCore({
  sceneMode = 'idle',
  moduleStatuses = {},
  tier = 'high',
}: TheaterConstellationCoreProps) {
  const coreRef = React.useRef<THREE.Group>(null)
  const ringRef = React.useRef<THREE.Mesh>(null)

  // 预生成各模块到中央核心 [0, 0, 0] 的拓扑连线 Three.js Line 对象
  const railLines = React.useMemo(() => {
    const map = new Map<ProjectDraftModule, THREE.Line>()
    const origin = new THREE.Vector3(0, 0, 0)
    for (const mod of PROJECT_DRAFT_MODULES) {
      const pos = MODULE_POSITIONS[mod]
      const geom = new THREE.BufferGeometry().setFromPoints([
        origin,
        new THREE.Vector3(pos[0], pos[1], pos[2]),
      ])
      const mat = new THREE.LineBasicMaterial({
        color: MODULE_COLORS[mod],
        transparent: true,
        opacity: 0.15,
      })
      const line = new THREE.Line(geom, mat)
      map.set(mod, line)
    }
    return map
  }, [])

  // 状态变更时动态更新导轨材质色彩与发光不透明度
  React.useEffect(() => {
    for (const mod of PROJECT_DRAFT_MODULES) {
      const line = railLines.get(mod)
      if (!line) continue
      const status = moduleStatuses[mod] || 'pending'
      const baseColor = MODULE_COLORS[mod]
      const mat = line.material as THREE.LineBasicMaterial
      if (status === 'failed') {
        mat.color.set('#ef4444')
        mat.opacity = 0.3
      } else {
        mat.color.set(baseColor)
        mat.opacity = status === 'completed' ? 0.45 : status === 'generating' ? 0.6 : 0.15
      }
    }
  }, [railLines, moduleStatuses])

  // 组件卸载时释放连线几何体与材质显存（RL-06）
  React.useEffect(() => {
    return () => {
      railLines.forEach((line) => {
        line.geometry.dispose()
        ;(line.material as THREE.Material).dispose()
      })
    }
  }, [railLines])

  // 中央核心与外环自转阻尼
  useFrame((_, delta) => {
    if (tier === 'low') return

    if (coreRef.current) {
      const speed = sceneMode === 'generating' ? 0.8 : sceneMode === 'review' ? 0.2 : 0.4
      coreRef.current.rotation.y += delta * speed
      coreRef.current.rotation.x += delta * (speed * 0.5)
    }

    if (ringRef.current) {
      ringRef.current.rotation.z -= delta * 0.25
    }
  })

  return (
    <group data-testid="constellation-core-group">
      {/* 中央微光能量核心 */}
      <group ref={coreRef} position={[0, 0, 0]}>
        <mesh>
          <icosahedronGeometry args={[0.55, 1]} />
          <meshStandardMaterial
            color="#00f0ff"
            wireframe={sceneMode === 'idle'}
            transparent={true}
            opacity={sceneMode === 'disrupted' ? 0.4 : 0.85}
            roughness={0.2}
            metalness={0.8}
            emissive="#00f0ff"
            emissiveIntensity={sceneMode === 'disrupted' ? 0.1 : 0.5}
          />
        </mesh>
        <mesh>
          <octahedronGeometry args={[0.75, 0]} />
          <meshBasicMaterial color="#38bdf8" wireframe={true} transparent={true} opacity={0.3} />
        </mesh>
      </group>

      {/* 水平对齐能量环 */}
      <mesh ref={ringRef} position={[0, 0, 0]} rotation={[Math.PI / 4, 0, 0]}>
        <torusGeometry args={[1.2, 0.02, 8, 48]} />
        <meshBasicMaterial color="#38bdf8" transparent={true} opacity={0.35} />
      </mesh>

      {/* 9 模块拓扑连接导轨 */}
      {PROJECT_DRAFT_MODULES.map((mod) => {
        const line = railLines.get(mod)
        if (!line) return null
        const status = moduleStatuses[mod] || 'pending'

        return (
          <group key={`rail-${mod}`} data-testid={`rail-${mod}`} userData={{ status }}>
            <primitive object={line} />
          </group>
        )
      })}

      {/* 底部悬浮投影底座环（深空基底） */}
      <mesh position={[0, -4.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.8, 3.8, 32]} />
        <meshBasicMaterial color="#38bdf8" wireframe={true} transparent={true} opacity={0.12} />
      </mesh>
    </group>
  )
}
