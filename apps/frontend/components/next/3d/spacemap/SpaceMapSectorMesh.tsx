'use client'

/**
 * 星区边界网格与引力底座构件
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - proposal.md §2 (域=星区, 核心中枢/组织治理/业务项目/知识资源)
 * - design.md Decision 2 (星区拓扑结构与发丝网格)
 * - tasks.md 3.2
 * - RL-15: 维持冷灰与发丝边界低明度呈现，透明度控制在 0.15~0.25
 */

import * as React from 'react'
import * as THREE from 'three'
import { GALAXY_SECTORS, type GalaxySector, type GalaxySectorKey } from './spacemap-galaxy-layout'

export interface SpaceMapSectorMeshProps {
  sectors?: GalaxySector[]
  activeSectorKey?: GalaxySectorKey
  tier?: 'high' | 'low' | 'fallback'
}

export function SpaceMapSectorMesh({
  sectors = Object.values(GALAXY_SECTORS),
  tier = 'high',
}: SpaceMapSectorMeshProps) {
  return (
    <group data-testid="galaxy-sectors-group">
      {sectors.map((sector) => {
        return (
          <group
            key={sector.key}
            position={sector.center}
            data-testid={`sector-mesh-${sector.key}`}
            userData={{ sectorName: sector.name }}
          >
            {/* 星区外边界引力环 (发丝细线) */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[sector.radius - 0.35, sector.radius, 64]} />
              <meshBasicMaterial
                color={sector.colorToken}
                transparent
                opacity={0.22}
                side={THREE.DoubleSide}
              />
            </mesh>

            {/* 星区微弱半透明底座平盘 */}
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
              <circleGeometry args={[sector.radius, 32]} />
              <meshBasicMaterial
                color={sector.colorToken}
                transparent
                opacity={0.03}
                side={THREE.DoubleSide}
              />
            </mesh>

            {/* 高画质档位下呈现同心发丝导轨 */}
            {tier === 'high' && (
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <ringGeometry args={[sector.radius * 0.5 - 0.2, sector.radius * 0.5, 48]} />
                <meshBasicMaterial
                  color={sector.colorToken}
                  transparent
                  opacity={0.12}
                  side={THREE.DoubleSide}
                />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}
