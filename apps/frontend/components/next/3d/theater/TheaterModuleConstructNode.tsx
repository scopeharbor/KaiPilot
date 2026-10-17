'use client'

/**
 * 9 模块三维装配构件节点
 *
 * 规范遵循：v3-next-layer1-theater-3d-m1
 * - proposal.md §3 (9 模块构件三维视觉语义与克制建造表现)
 * - design.md Decision 3 (4 态视觉表现与几何语义)
 * - RL-14: 确定性拓扑渲染
 * - RL-15: 防 Slop，原生阻尼函数，坚决不引入 GSAP
 */

import * as React from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ProjectDraftModule, ProjectDraftModuleStatus } from '@aiproj/types'
import {
  getModuleConstructVisualState,
  type ModuleConstructVisualState,
  type TheaterSceneMode,
} from './theater-scene-mapper'

export interface TheaterModuleConstructNodeProps {
  module: ProjectDraftModule
  moduleStatus?: ProjectDraftModuleStatus
  sceneMode?: TheaterSceneMode
  tier?: 'high' | 'low' | 'fallback'
}

/**
 * 9 模块专属几何体组件（程序化几何语义）
 */
function ModuleGeometry({ module }: { module: ProjectDraftModule }) {
  switch (module) {
    case 'charter':
      // 立方基石 Pillar
      return <boxGeometry args={[0.9, 0.9, 0.9]} />
    case 'wbs':
      // 分形拓扑分支
      return <cylinderGeometry args={[0.3, 0.5, 0.9, 8]} />
    case 'tasks':
      // 六边形阵列体
      return <cylinderGeometry args={[0.55, 0.55, 0.5, 6]} />
    case 'dependencies':
      // 拓扑连接导轨圆环
      return <torusGeometry args={[0.45, 0.09, 8, 24]} />
    case 'acceptance':
      // 对锁式双层圆环
      return <torusGeometry args={[0.52, 0.08, 8, 24]} />
    case 'resource':
      // 多面复合棱柱
      return <dodecahedronGeometry args={[0.5, 0]} />
    case 'risk':
      // 战术预警菱形体
      return <octahedronGeometry args={[0.52, 0]} />
    case 'milestone':
      // 星标立柱
      return <coneGeometry args={[0.45, 0.9, 5]} />
    case 'ganttPreview':
      // 水平时空轨道弧面
      return <boxGeometry args={[1.1, 0.25, 0.25]} />
    default:
      return <boxGeometry args={[0.6, 0.6, 0.6]} />
  }
}

export function TheaterModuleConstructNode({
  module,
  moduleStatus,
  sceneMode = 'idle',
  tier = 'high',
}: TheaterModuleConstructNodeProps) {
  const meshRef = React.useRef<THREE.Mesh>(null)
  const visual = React.useMemo<ModuleConstructVisualState>(() => {
    return getModuleConstructVisualState(module, moduleStatus, sceneMode)
  }, [module, moduleStatus, sceneMode])

  // 原生阻尼平滑动画（RL-15: 严禁引入 GSAP，全量基于 THREE.MathUtils.damp）
  useFrame((state, delta) => {
    if (!meshRef.current) return
    if (tier === 'low') return // Low 档单帧静态冻结

    const mesh = meshRef.current

    if (visual.status === 'generating') {
      mesh.rotation.y += delta * 1.5
      mesh.rotation.x = THREE.MathUtils.damp(
        mesh.rotation.x,
        Math.sin(state.clock.elapsedTime * 2) * 0.2,
        3,
        delta,
      )
      const breathingScale = visual.scale * (1 + Math.sin(state.clock.elapsedTime * 3) * 0.06)
      mesh.scale.setScalar(THREE.MathUtils.damp(mesh.scale.x, breathingScale, 4, delta))
    } else if (visual.status === 'completed') {
      mesh.rotation.y += delta * 0.3
      mesh.scale.setScalar(THREE.MathUtils.damp(mesh.scale.x, visual.scale, 4, delta))
    } else {
      mesh.rotation.y += delta * 0.1
      mesh.scale.setScalar(THREE.MathUtils.damp(mesh.scale.x, visual.scale, 4, delta))
    }
  })

  return (
    <group
      position={visual.position}
      data-testid={`module-node-${module}`}
      userData={{ module, status: visual.status }}
    >
      {/* 核心几何网格 */}
      <mesh ref={meshRef} castShadow={tier === 'high'} receiveShadow={tier === 'high'}>
        <ModuleGeometry module={module} />
        <meshStandardMaterial
          color={visual.color}
          wireframe={visual.wireframe}
          transparent={true}
          opacity={visual.opacity}
          roughness={0.25}
          metalness={0.75}
          emissive={visual.color}
          emissiveIntensity={visual.glowIntensity}
        />
      </mesh>

      {/* generating 态额外呼吸外发光线框（Low 档精简） */}
      {tier === 'high' && visual.status === 'generating' && (
        <mesh scale={1.25}>
          <ModuleGeometry module={module} />
          <meshBasicMaterial
            color={visual.color}
            wireframe={true}
            transparent={true}
            opacity={0.3}
          />
        </mesh>
      )}
    </group>
  )
}
