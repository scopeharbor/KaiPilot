'use client'

/**
 * 生成剧场 R3F 场景根容器与深空氛围
 *
 * 规范遵循：v3-next-layer1-theater-3d-m1
 * - proposal.md §2, §3 (深空氛围与场景状态机)
 * - design.md Decision 2, Decision 3, Decision 4
 * - RL-06: 完整显存回收生命周期，防泄漏
 * - RL-15: 防 Slop，拒绝无意义粒子与过曝光照
 */

import * as React from 'react'
import {
  PROJECT_DRAFT_MODULES,
  type ProjectDraftModule,
  type ProjectDraftModuleStatus,
} from '@aiproj/types'
import { TheaterSceneDirector } from './TheaterSceneDirector'
import { TheaterConstellationCore } from './TheaterConstellationCore'
import { TheaterModuleConstructNode } from './TheaterModuleConstructNode'
import type { TheaterSceneMode } from './theater-scene-mapper'

export interface Theater3DSceneProps {
  sceneMode?: TheaterSceneMode
  activeModule?: ProjectDraftModule | null
  moduleStatuses?: Partial<Record<ProjectDraftModule, ProjectDraftModuleStatus>>
  tier?: 'high' | 'low' | 'fallback'
}

export function Theater3DScene({
  sceneMode = 'idle',
  activeModule = null,
  moduleStatuses = {},
  tier = 'high',
}: Theater3DSceneProps) {
  return (
    <>
      {/* 深空指数雾（FogExp2 契约，深空底色 #05070f 密度 0.045） */}
      <fogExp2 attach="fog" args={['#05070f', 0.045]} />

      {/* 场景光照体系：环境光 + 战术冷白天光 + 冷青辅助光 */}
      <ambientLight intensity={0.45} />
      <directionalLight position={[5, 8, 5]} intensity={0.75} color="#e0f2fe" />
      <directionalLight position={[-4, -3, 2]} intensity={0.3} color="#38bdf8" />

      {/* 镜头调度导演控制器 */}
      <TheaterSceneDirector sceneMode={sceneMode} activeModule={activeModule} tier={tier} />

      {/* 中央星座核心与 9 模块拓扑连线导轨 */}
      <TheaterConstellationCore sceneMode={sceneMode} moduleStatuses={moduleStatuses} tier={tier} />

      {/* 9 核心模块三维装配构件集群 */}
      <group data-testid="theater-modules-group">
        {PROJECT_DRAFT_MODULES.map((mod) => (
          <TheaterModuleConstructNode
            key={mod}
            module={mod}
            moduleStatus={moduleStatuses[mod]}
            sceneMode={sceneMode}
            tier={tier}
          />
        ))}
      </group>
    </>
  )
}
