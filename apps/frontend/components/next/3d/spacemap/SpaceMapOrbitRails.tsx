'use client'

/**
 * 星区引力连接导轨与星系发丝轨道
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - proposal.md §2 (发丝引力导轨, 连接四大星区)
 * - design.md Decision 2 (引力导轨几何拓扑)
 * - tasks.md 3.2
 * - RL-06 / RL-15: LineBasicMaterial 低明度发丝线条，组件卸载显式 dispose 释放几何显存
 */

import * as React from 'react'
import * as THREE from 'three'
import { GALAXY_SECTORS } from './spacemap-galaxy-layout'

export function SpaceMapOrbitRails() {
  const geometry = React.useMemo(() => {
    const corePos = new THREE.Vector3(...GALAXY_SECTORS.core.center)
    const govPos = new THREE.Vector3(...GALAXY_SECTORS.governance.center)
    const knowPos = new THREE.Vector3(...GALAXY_SECTORS.knowledge.center)
    const projPos = new THREE.Vector3(...GALAXY_SECTORS.projects.center)

    const points: THREE.Vector3[] = [
      // 核心 -> 治理
      corePos,
      govPos,
      // 核心 -> 知识
      corePos,
      knowPos,
      // 核心 -> 业务项目
      corePos,
      projPos,
      // 治理 -> 业务项目
      govPos,
      projPos,
      // 知识 -> 业务项目
      knowPos,
      projPos,
    ]

    const geom = new THREE.BufferGeometry().setFromPoints(points)
    return geom
  }, [])

  React.useEffect(() => {
    return () => {
      geometry.dispose()
    }
  }, [geometry])

  return (
    <group data-testid="galaxy-orbit-rails">
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color="#64748b" transparent opacity={0.25} linewidth={1} />
      </lineSegments>
    </group>
  )
}
