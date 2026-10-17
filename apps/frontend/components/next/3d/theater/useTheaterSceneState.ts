'use client'

/**
 * 生成剧场 3D 场景状态自适应 Hook
 *
 * 规范遵循：v3-next-layer1-theater-3d-m1
 * - proposal.md §2 (State-Driven Scene)
 * - tasks.md 2.3
 * - RL-06: 零全局副作用，卸载时状态完整清理
 * - RL-14: 确定性映射，平滑调度派生
 */

import * as React from 'react'
import { PROJECT_DRAFT_MODULES, type ProjectDraftModule } from '@aiproj/types'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { selectDraftProgressPercent } from '@/lib/ai-draft/progress-projection'
import {
  mapDraftStateToSceneMode,
  getModuleConstructVisualState,
  type ModuleConstructVisualState,
  type TheaterSceneMode,
} from './theater-scene-mapper'

export interface TheaterSceneState {
  sceneMode: TheaterSceneMode
  activeModule: ProjectDraftModule | null
  activeModuleIndex: number
  moduleStates: Record<ProjectDraftModule, ModuleConstructVisualState>
  completedCount: number
  totalCount: number
  overallProgress: number
}

export function useTheaterSceneState(): TheaterSceneState {
  const status = useAiProjectDraftStore((s) => s.status)
  const draftStatus = useAiProjectDraftStore((s) => s.draftStatus)
  const draftFailure = useAiProjectDraftStore((s) => s.draftFailure)
  const moduleStatuses = useAiProjectDraftStore((s) => s.moduleStatuses)
  const progressProjection = useAiProjectDraftStore((s) => s.progressProjection)

  const sceneMode = React.useMemo(
    () => mapDraftStateToSceneMode(status, draftStatus, draftFailure),
    [status, draftStatus, draftFailure],
  )

  const { activeModule, activeModuleIndex, moduleStates, completedCount } = React.useMemo(() => {
    let currentActive: ProjectDraftModule | null = null
    let activeIdx = -1
    let completed = 0

    const states = {} as Record<ProjectDraftModule, ModuleConstructVisualState>

    for (let i = 0; i < PROJECT_DRAFT_MODULES.length; i++) {
      const mod = PROJECT_DRAFT_MODULES[i]
      if (!mod) continue
      const modStatus = moduleStatuses[mod]
      if (modStatus === 'completed') {
        completed++
      } else if (modStatus === 'generating' && !currentActive) {
        currentActive = mod
        activeIdx = i
      }
      states[mod] = getModuleConstructVisualState(mod, modStatus, sceneMode)
    }

    if (!currentActive && sceneMode === 'generating') {
      for (let i = 0; i < PROJECT_DRAFT_MODULES.length; i++) {
        const mod = PROJECT_DRAFT_MODULES[i]
        if (!mod) continue
        const modStatus = moduleStatuses[mod]
        if (modStatus === 'failed') {
          currentActive = mod
          activeIdx = i
          break
        }
        if (!modStatus || modStatus === 'pending') {
          currentActive = mod
          activeIdx = i
          break
        }
      }
    }

    return {
      activeModule: currentActive,
      activeModuleIndex: activeIdx,
      moduleStates: states,
      completedCount: completed,
    }
  }, [moduleStatuses, sceneMode])

  const overallProgress = React.useMemo(() => {
    if (sceneMode === 'settled' || sceneMode === 'review') return 100
    if (progressProjection) {
      const percent = selectDraftProgressPercent(progressProjection)
      if (percent != null) return percent
    }
    return Math.round((completedCount / PROJECT_DRAFT_MODULES.length) * 100)
  }, [sceneMode, progressProjection, completedCount])

  return {
    sceneMode,
    activeModule,
    activeModuleIndex,
    moduleStates,
    completedCount,
    totalCount: PROJECT_DRAFT_MODULES.length,
    overallProgress,
  }
}
