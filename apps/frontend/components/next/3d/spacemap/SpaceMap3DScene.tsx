'use client'

/**
 * 3D 星系拓扑沙盘根场景容器与深空氛围
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - proposal.md §2 (深空指数雾, 环境光, 恒星照度, 1500 背景恒星微粒)
 * - design.md Decision 2, Decision 4, Performance Budget §1, §2
 * - tasks.md 4.1
 * - RL-06 (显存回收生命周期): 卸载与视角切换时显式递归遍历 dispose() 释放显存
 * - RL-15 (防 Slop): 单 Draw Call <instancedMesh> 渲染背景微星，控制 Draw Call < 40
 */

import * as React from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { SpaceMapCameraController, type CameraShotId } from './SpaceMapCameraController'
import { SpaceMapSectorMesh } from './SpaceMapSectorMesh'
import { SpaceMapOrbitRails } from './SpaceMapOrbitRails'
import { SpaceMapStarNode } from './SpaceMapStarNode'
import type { GalaxySector } from './spacemap-galaxy-layout'
import type { StarVisualState } from './spacemap-state-mapper'
import { computeSpaceMapLOD, type SpaceMapLODLevel } from './spacemap-lod'

export interface SpaceMap3DSceneProps {
  stars?: StarVisualState[]
  sectors?: GalaxySector[]
  selectedId?: number | null
  onSelectStar?: (projectId: number) => void
  onPointerOverStar?: (event: ThreeEvent<PointerEvent>, star: StarVisualState) => void
  onPointerOutStar?: (event: ThreeEvent<PointerEvent>) => void
  tier?: 'high' | 'low' | 'fallback'
  shot?: CameraShotId
  onShotChange?: (shot: CameraShotId) => void
}

/** 确定性伪随机数生成器（RL-14） */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

/**
 * 单 Draw Call 实例化背景恒星微粒场 (1500 颗微星)
 */
function BackgroundInstancedStarfield({
  count = 1500,
  tier = 'high',
}: {
  count?: number
  tier?: 'high' | 'low' | 'fallback'
}) {
  const meshRef = React.useRef<THREE.InstancedMesh>(null)
  const dummy = React.useMemo(() => new THREE.Object3D(), [])
  const actualCount = tier === 'low' ? Math.min(count, 300) : count

  React.useLayoutEffect(() => {
    if (!meshRef.current || !('setMatrixAt' in meshRef.current)) return

    const mesh = meshRef.current
    const colors = [
      new THREE.Color('#38bdf8'), // 冷青
      new THREE.Color('#00f0ff'), // 天青
      new THREE.Color('#f8fafc'), // 白芒
      new THREE.Color('#94a3b8'), // 冷灰
    ]

    for (let i = 0; i < actualCount; i++) {
      const x = (seededRandom(i * 3 + 1) - 0.5) * 220
      const y = (seededRandom(i * 3 + 2) - 0.5) * 160
      const z = (seededRandom(i * 3 + 3) - 0.5) * 180

      const scale = 0.35 + seededRandom(i * 7 + 4) * 0.75
      dummy.position.set(x, y, z)
      dummy.scale.set(scale, scale, scale)
      dummy.updateMatrix()

      mesh.setMatrixAt(i, dummy.matrix)

      const colorIndex = Math.floor(seededRandom(i * 11 + 5) * colors.length)
      mesh.setColorAt(i, colors[colorIndex]!)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true
    }
  }, [actualCount, dummy])

  useFrame((_, delta) => {
    if (!meshRef.current || tier === 'low' || tier === 'fallback') return
    meshRef.current.rotation.y += delta * 0.003
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, actualCount]}
      data-testid="instanced-starfield"
      frustumCulled={false}
    >
      <sphereGeometry args={[0.22, 6, 6]} />
      <meshBasicMaterial transparent opacity={0.65} />
    </instancedMesh>
  )
}

/**
 * 前景项目恒星单 Draw Call 批量渲染构件 (<instancedMesh>) 与视距 LOD 支撑
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - design.md Decision 2, Decision 3, §Risks 第 299 行
 * - 参照 M0 InstancedStarfield.tsx 范式：单 Draw Call 批量渲染全部项目恒星
 * - 选中 / Hover 个体高亮通过 instance 级颜色与缩放矩阵属性实现，不得退回逐 Mesh
 */
function SpaceMapForegroundStarfield({
  stars = [],
  selectedId = null,
  hoveredId = null,
  onSelectStar,
  onPointerOverStar,
  onPointerOutStar,
  tier = 'high',
}: {
  stars?: StarVisualState[]
  selectedId?: number | null
  hoveredId?: number | null
  onSelectStar?: (projectId: number) => void
  onPointerOverStar?: (event: ThreeEvent<PointerEvent>, star: StarVisualState) => void
  onPointerOutStar?: (event: ThreeEvent<PointerEvent>) => void
  tier?: 'high' | 'low' | 'fallback'
}) {
  const meshRef = React.useRef<THREE.InstancedMesh>(null)
  const dummy = React.useMemo(() => new THREE.Object3D(), [])
  const count = stars.length

  React.useLayoutEffect(() => {
    if (!meshRef.current || typeof meshRef.current.setMatrixAt !== 'function' || count === 0) return

    const mesh = meshRef.current

    for (let i = 0; i < count; i++) {
      const star = stars[i]!
      dummy.position.set(star.position[0], star.position[1], star.position[2])

      // 缩放计算：基础半径 * 基础 scale，选中态/hover 态通过 instance 矩阵属性缩放
      let s = star.radius * star.scale
      if (star.projectId === selectedId) {
        s *= 1.35
      } else if (star.projectId === hoveredId) {
        s *= 1.2
      } else if (!star.isMatch) {
        s *= 0.85
      }

      dummy.scale.set(s, s, s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)

      // 颜色计算：中性色令牌，未匹配项虚化淡出，选中/hover 态通过 instance 颜色提亮
      const color = new THREE.Color(star.color)
      if (!star.isMatch) {
        color.multiplyScalar(0.25)
      } else if (star.projectId === selectedId) {
        color.lerp(new THREE.Color('#00f0ff'), 0.5).multiplyScalar(1.4)
      } else if (star.projectId === hoveredId) {
        color.multiplyScalar(1.25)
      }

      mesh.setColorAt(i, color)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true
    }
  }, [count, stars, selectedId, hoveredId, dummy])

  useFrame((_, delta) => {
    if (!meshRef.current || tier === 'low' || tier === 'fallback') return
    meshRef.current.rotation.y += delta * 0.002
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

  if (count === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      data-testid="foreground-instanced-stars"
      userData={{ lodTier: 'instanced-batch' }}
      frustumCulled={false}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation()
        const idx = e.instanceId
        if (idx !== undefined && idx !== null && stars[idx]) {
          onSelectStar?.(stars[idx].projectId)
        }
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        const idx = e.instanceId
        if (idx !== undefined && idx !== null && stars[idx]) {
          onPointerOverStar?.(e, stars[idx])
        }
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        const idx = e.instanceId
        if (idx !== undefined && idx !== null && stars[idx]) {
          onPointerOverStar?.(e, stars[idx])
        }
      }}
      onPointerOut={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        onPointerOutStar?.(e)
      }}
    >
      <sphereGeometry args={[1, 16, 16]} />
      <meshStandardMaterial roughness={0.3} metalness={0.2} transparent opacity={0.95} />
    </instancedMesh>
  )
}

/**
 * 吸积盘光环单 Draw Call 批量渲染构件 (<instancedMesh>)
 */
function SpaceMapAccretionStarfield({
  stars = [],
  selectedId = null,
  hoveredId = null,
}: {
  stars?: StarVisualState[]
  selectedId?: number | null
  hoveredId?: number | null
  tier?: 'high' | 'low' | 'fallback'
}) {
  const meshRef = React.useRef<THREE.InstancedMesh>(null)
  const dummy = React.useMemo(() => new THREE.Object3D(), [])
  const count = stars.length

  React.useLayoutEffect(() => {
    if (!meshRef.current || typeof meshRef.current.setMatrixAt !== 'function' || count === 0) return

    const mesh = meshRef.current

    for (let i = 0; i < count; i++) {
      const star = stars[i]!
      if (!star.hasAccretionRing) {
        dummy.position.set(0, 0, 0)
        dummy.scale.set(0, 0, 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        continue
      }

      dummy.position.set(star.position[0], star.position[1], star.position[2])
      dummy.rotation.set(Math.PI / 2, 0, 0)

      let s = star.radius
      if (star.projectId === selectedId) {
        s *= 1.35
      } else if (star.projectId === hoveredId) {
        s *= 1.2
      } else if (!star.isMatch) {
        s *= 0.85
      }

      dummy.scale.set(s, s, s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)

      const color = new THREE.Color(star.color)
      if (!star.isMatch) {
        color.multiplyScalar(0.2)
      } else if (star.projectId === selectedId) {
        color.lerp(new THREE.Color('#00f0ff'), 0.6)
      }
      mesh.setColorAt(i, color)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true
    }
  }, [count, stars, selectedId, hoveredId, dummy])

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

  if (count === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      data-testid="accretion-instanced-mesh"
      userData={{ lodTier: 'instanced-batch' }}
      frustumCulled={false}
    >
      <ringGeometry args={[1.05, 1.65, 24]} />
      <meshBasicMaterial transparent opacity={0.35} side={THREE.DoubleSide} />
    </instancedMesh>
  )
}

export function SpaceMap3DScene({
  stars = [],
  sectors,
  selectedId = null,
  onSelectStar,
  onPointerOverStar,
  onPointerOutStar,
  tier = 'high',
  shot = 'overview',
  onShotChange,
}: SpaceMap3DSceneProps) {
  const { scene, camera } = useThree()
  const [hoveredStarId, setHoveredStarId] = React.useState<number | null>(null)
  const [sceneLOD, setSceneLOD] = React.useState<SpaceMapLODLevel>('lod-far')

  // 显存回收守护：卸载时遍历场景树显式调用 dispose() 释放显存 (RL-06)
  React.useEffect(() => {
    return () => {
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) {
          ;(obj as THREE.Mesh).geometry.dispose()
        }
        if ((obj as THREE.Mesh).material) {
          const mat = (obj as THREE.Mesh).material
          if (Array.isArray(mat)) {
            mat.forEach((m) => m.dispose())
          } else {
            mat.dispose()
          }
        }
      })
    }
  }, [scene])

  // 视距 LOD 计算：根据相机与场景的欧氏距离自适应切换视距分层档位
  useFrame(() => {
    if (!camera?.position) return
    const dist = camera.position.length()
    const currentLOD = computeSpaceMapLOD(dist)
    if (currentLOD !== sceneLOD) {
      setSceneLOD(currentLOD)
    }
  })

  const selectedStar = React.useMemo(() => {
    if (!selectedId) return null
    return stars.find((s) => s.projectId === selectedId) ?? null
  }, [selectedId, stars])

  const handlePointerOverStar = React.useCallback(
    (e: ThreeEvent<PointerEvent>, star: StarVisualState) => {
      setHoveredStarId(star.projectId)
      onPointerOverStar?.(e, star)
    },
    [onPointerOverStar],
  )

  const handlePointerOutStar = React.useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      setHoveredStarId(null)
      onPointerOutStar?.(e)
    },
    [onPointerOutStar],
  )

  return (
    <>
      {/* 深空指数消隐雾效 (FogExp2 契约，深空底色 #030712 密度 0.006) */}
      <fogExp2 attach="fog" args={['#030712', 0.006]} />

      {/* 场景光照体系：环境光 + 战术冷白主光 + 冷青辅助光 */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[30, 50, 40]} intensity={0.8} color="#f8fafc" />
      <directionalLight position={[-40, -20, -20]} intensity={0.35} color="#38bdf8" />

      {/* 镜头平滑机位调度器 */}
      <SpaceMapCameraController
        selectedStar={selectedStar}
        tier={tier}
        shot={shot}
        onShotChange={onShotChange}
      />

      {/* 四大星区底座与引力网格 (4 Draw Calls) */}
      <SpaceMapSectorMesh sectors={sectors} tier={tier} />

      {/* 星区引力连接导轨 (1 Draw Call) */}
      <SpaceMapOrbitRails />

      {/* 单 Draw Call 实例化背景恒星微粒场 (1500 颗微星, 1 Draw Call) */}
      <BackgroundInstancedStarfield count={1500} tier={tier} />

      {/* 前景项目恒星构件集群：单 Draw Call instancedMesh 批量渲染 + 视距 LOD 架构 */}
      <group data-testid="galaxy-stars-group" userData={{ lodLevel: sceneLOD }}>
        {/* 前景恒星核心：单 Draw Call 批量渲染全部恒星核心 (1 Draw Call) */}
        <SpaceMapForegroundStarfield
          stars={stars}
          selectedId={selectedId}
          hoveredId={hoveredStarId}
          onSelectStar={onSelectStar}
          onPointerOverStar={handlePointerOverStar}
          onPointerOutStar={handlePointerOutStar}
          tier={tier}
        />

        {/* 前景吸积盘光环：单 Draw Call 批量渲染 (1 Draw Call) */}
        <SpaceMapAccretionStarfield
          stars={stars}
          selectedId={selectedId}
          hoveredId={hoveredStarId}
          tier={tier}
        />

        {/* 视距 LOD 特写构件：仅当有星体选中进入特写近景时挂载（聚焦引力环与信号环绕微星），严格控制总 Draw Call < 40 */}
        {selectedStar && (
          <SpaceMapStarNode
            key={selectedStar.projectId}
            star={selectedStar}
            onSelect={onSelectStar}
            tier={tier}
            lodLevel="lod-near"
            isLODDetailOnly
          />
        )}
      </group>
    </>
  )
}
