'use client'

/**
 * 项目恒星与进度吸积盘三维构件
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - proposal.md §2 (项目=恒星, 吸积盘映射进度), §3 (双视角选中与射线拾取)
 * - design.md Decision 2 (几何构型与中性色令牌), Decision 3 (状态机参数)
 * - tasks.md 3.1
 * - RL-15 (防 Slop): 设计系统中性色冷青/琥珀黄/战术暗红，杜绝浮夸高光
 */

import * as React from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { StarVisualState } from './spacemap-state-mapper'
import { SpaceMapSignalOrbiter } from './SpaceMapSignalOrbiter'
import type { SpaceMapLODLevel } from './spacemap-lod'

export interface SpaceMapStarNodeProps {
  star: StarVisualState
  onSelect?: (projectId: number) => void
  onPointerOver?: (event: ThreeEvent<PointerEvent>, star: StarVisualState) => void
  onPointerOut?: (event: ThreeEvent<PointerEvent>) => void
  tier?: 'high' | 'low' | 'fallback'
  lodLevel?: SpaceMapLODLevel
  isLODDetailOnly?: boolean
}

function StarCoreGeometry({
  geometryType,
  radius,
}: {
  geometryType: StarVisualState['geometryType']
  radius: number
}) {
  switch (geometryType) {
    case 'icosahedron':
      // 归档/完成恒星：多面晶体微星
      return <icosahedronGeometry args={[radius, 1]} />
    case 'wireframe':
      // 草稿/规划中恒星：细分线框球体
      return <sphereGeometry args={[radius, 16, 16]} />
    case 'grey_matt':
      // 暂停/取消恒星：冷灰哑光球
      return <sphereGeometry args={[radius, 16, 16]} />
    case 'sphere':
    default:
      // 活跃项目恒星：细分程序化球体
      return <sphereGeometry args={[radius, 24, 24]} />
  }
}

export function SpaceMapStarNode({
  star,
  onSelect,
  onPointerOver,
  onPointerOut,
  tier = 'high',
  lodLevel = 'lod-near',
  isLODDetailOnly = false,
}: SpaceMapStarNodeProps) {
  const groupRef = React.useRef<THREE.Group>(null)
  const coreMeshRef = React.useRef<THREE.Mesh>(null)

  // 阻尼自转与动画
  useFrame((_, delta) => {
    if (tier === 'low' || !groupRef.current) return

    // 原生微弱平滑自转（非 detail-only 独立模式）
    if (coreMeshRef.current) {
      coreMeshRef.current.rotation.y += 0.006
    }

    // 阻尼缩放过渡
    const targetScale = star.scale
    groupRef.current.scale.x = THREE.MathUtils.damp(groupRef.current.scale.x, targetScale, 6, delta)
    groupRef.current.scale.y = THREE.MathUtils.damp(groupRef.current.scale.y, targetScale, 6, delta)
    groupRef.current.scale.z = THREE.MathUtils.damp(groupRef.current.scale.z, targetScale, 6, delta)
  })

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect?.(star.projectId)
  }

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    onPointerOver?.(e, star)
  }

  const handlePointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    onPointerOut?.(e)
  }

  const isWireframe = star.geometryType === 'wireframe'
  const isFarLOD = lodLevel === 'lod-far'

  return (
    <group
      ref={groupRef}
      position={star.position}
      scale={[star.scale, star.scale, star.scale]}
      data-testid={`star-node-${star.projectId}`}
      userData={{
        projectId: star.projectId,
        status: star.status,
        healthStatus: star.healthStatus,
        isSelected: star.isSelected,
        isMatch: star.isMatch,
        lodLevel,
        lodMode: isLODDetailOnly ? 'detail-only' : 'full',
      }}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      {/* 恒星核心球体（LOD Detail-Only 模式下由 instancedMesh 单 Draw Call 承担，此处跳过以杜绝重复 Draw Call） */}
      {!isLODDetailOnly && (
        <mesh ref={coreMeshRef} data-testid="star-core-mesh">
          <StarCoreGeometry geometryType={star.geometryType} radius={star.radius} />
          <meshStandardMaterial
            wireframe={isWireframe}
            color={star.color}
            emissive={star.color}
            emissiveIntensity={star.luminosity * star.emissiveMultiplier * 0.5}
            roughness={star.geometryType === 'grey_matt' ? 0.8 : 0.3}
            metalness={star.geometryType === 'icosahedron' ? 0.6 : 0.15}
            transparent={star.opacity < 1.0 || isWireframe}
            opacity={star.opacity}
          />
        </mesh>
      )}

      {/* 吸积盘光环（非 detail-only 独立模式下呈现；合批模式下由 instancedMesh 承担） */}
      {!isLODDetailOnly && star.hasAccretionRing && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[star.radius + 0.15, star.accretionOuterRadius, 32]} />
          <meshBasicMaterial
            color={star.color}
            transparent
            opacity={star.opacity * 0.4}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* 选中态聚焦引力光环 (Near LOD 特写关键构件) */}
      {star.isSelected && (
        <mesh rotation={[Math.PI / 2, 0, 0]} data-testid="star-focus-ring">
          <ringGeometry
            args={[star.accretionOuterRadius + 0.35, star.accretionOuterRadius + 0.55, 36]}
          />
          <meshBasicMaterial color="#00f0ff" transparent opacity={0.85} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* 4 类被动雷达信号环绕微天体（视距 LOD 剔除：远距离 lod-far 时剔除以压降 Draw Call，仅在 near/medium 呈现） */}
      {!isFarLOD &&
        star.signals.map((sig) => (
          <SpaceMapSignalOrbiter key={sig.id} signal={sig} tier={tier} parentRadius={star.radius} />
        ))}
    </group>
  )
}
