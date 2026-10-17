'use client'

/**
 * 生成剧场全屏 3D 沉浸视口容器与降级守卫
 *
 * 规范遵循：v3-next-layer1-theater-3d-m1
 * - proposal.md §4, §5 (DOM + WebGL 分层模型与三档降级契约)
 * - design.md Decision 4, Decision 5
 * - tasks.md 5.1
 * - Layer 0 (z-0), fixed inset-0, pointer-events-none, aria-hidden="true", tabIndex={-1}
 * - 在 fallback 档位下绝对不初始化 Canvas，退回既有 2D 剧场
 * - 在 low 档位下采用 frameloop="demand"，静态单帧，固定 DPR 1.0
 * - 在 high 档位下激活 WebGL2 + DPR [1.0, 1.5]
 * - 场景挂载就绪后执行 700ms 交叉淡入 (Cross-fade)
 * - 捕获 webglcontextlost 自愈降级
 */

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Canvas } from '@react-three/fiber'
import { safeCanvasEvents } from '@/components/next/3d/shared/safe-canvas-events'
import {
  PROJECT_DRAFT_MODULES,
  type ProjectDraftModule,
  type ProjectDraftModuleStatus,
} from '@aiproj/types'
import { Theater3DScene } from './Theater3DScene'
import { useTheaterSceneState } from './useTheaterSceneState'
import { useImmersionDegradation } from '../login/useImmersionDegradation'

export const LazyTheater3DCanvas = dynamic(
  () => import('./Theater3DCanvas').then((mod) => mod.Theater3DCanvas),
  { ssr: false },
)

export interface Theater3DCanvasProps {
  forceTier?: 'high' | 'low' | 'fallback'
  className?: string
  onContextLost?: () => void
}

export function Theater3DCanvas({
  forceTier,
  className = '',
  onContextLost,
}: Theater3DCanvasProps) {
  const {
    tier,
    isFallback,
    isFadedIn,
    handleCanvasCreated,
    handleContextLost: baseHandleContextLost,
  } = useImmersionDegradation({ forceTier })

  const { sceneMode, activeModule, moduleStates } = useTheaterSceneState()

  const handleContextLost = React.useCallback(() => {
    baseHandleContextLost()
    onContextLost?.()
  }, [baseHandleContextLost, onContextLost])

  // Fallback 极简降级档：完全不渲染 Canvas 节点，零 WebGL 上下文初始化，退回既有 2D 剧场
  if (isFallback) {
    return null
  }

  const moduleStatusesRecord: Partial<Record<ProjectDraftModule, ProjectDraftModuleStatus>> = {}
  for (const mod of PROJECT_DRAFT_MODULES) {
    if (moduleStates[mod]) {
      moduleStatusesRecord[mod] = moduleStates[mod].status
    }
  }

  return (
    <div
      data-testid="theater-3d-container"
      aria-hidden="true"
      tabIndex={-1}
      className={`fixed inset-0 pointer-events-none z-0 overflow-hidden ${className}`}
    >
      <Canvas
        events={safeCanvasEvents}
        dpr={tier === 'low' ? 1.0 : [1.0, 1.5]}
        frameloop={tier === 'low' ? 'demand' : 'always'}
        gl={{
          antialias: tier === 'high',
          powerPreference: 'high-performance',
          alpha: true,
        }}
        camera={{ position: [0, 0, 12.0], fov: 60 }}
        onCreated={({ gl }) => {
          handleCanvasCreated()
          const dom = gl?.domElement
          if (dom && typeof dom.addEventListener === 'function') {
            dom.addEventListener('webglcontextlost', (e) => {
              e.preventDefault()
              handleContextLost()
            })
          }
        }}
        className={`w-full h-full transition-opacity duration-700 ease-in ${
          isFadedIn ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden="true"
        tabIndex={-1}
        style={{ pointerEvents: 'none' }}
      >
        <Theater3DScene
          sceneMode={sceneMode}
          activeModule={activeModule}
          moduleStatuses={moduleStatusesRecord}
          tier={tier}
        />
      </Canvas>
    </div>
  )
}
