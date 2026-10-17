'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Canvas } from '@react-three/fiber'
import { safeCanvasEvents } from '@/components/next/3d/shared/safe-canvas-events'
import { LoginStaticFallback } from './LoginStaticFallback'
import { LoginSpaceScene } from './LoginSpaceScene'
import { useImmersionDegradation } from './useImmersionDegradation'

export const LazyLoginSpaceCanvas = dynamic(
  () => import('./LoginSpaceCanvas').then((mod) => mod.LoginSpaceCanvas),
  {
    ssr: false,
    loading: () => <LoginStaticFallback />,
  },
)

export interface LoginSpaceCanvasProps {
  isFocused?: boolean
  isSubmitting?: boolean
  forceTier?: 'high' | 'low' | 'fallback'
}

/**
 * 登录页全屏 3D 沉浸视口容器与降级守卫
 *
 * 规范遵循：v3-next-layer1-login-3d-m0 design.md Decision 2, Decision 3, Decision 6
 * - Layer 0 (z-0), fixed inset-0, pointer-events-none, aria-hidden="true", tabIndex={-1}
 * - 在 fallback 档位下绝对不初始化 Canvas，纯 CSS 静态呈现
 * - 在 low 档位下采用 frameloop="demand"，单帧冻结，固定 DPR 1.0
 * - 在 high 档位下激活 WebGL2 + DPR [1.0, 1.5]
 * - 场景挂载就绪后执行 700ms 交叉淡入 (Cross-fade)
 * - 捕获 webglcontextlost 自愈降级
 */
export function LoginSpaceCanvas({
  isFocused = false,
  isSubmitting = false,
  forceTier,
}: LoginSpaceCanvasProps) {
  const { tier, isFallback, isFadedIn, handleCanvasCreated, handleContextLost } =
    useImmersionDegradation({ forceTier })

  // 极简降级档：完全不渲染 Canvas 节点，零 WebGL 上下文初始化
  if (isFallback) {
    return <LoginStaticFallback />
  }

  return (
    <div
      data-testid="login-space-container"
      aria-hidden="true"
      tabIndex={-1}
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
    >
      {/* 静态占位底图（用于首帧渲染与平滑淡出，避免黑屏/白屏撕裂） */}
      <LoginStaticFallback
        className={`transition-opacity duration-700 ease-out ${
          isFadedIn ? 'opacity-0' : 'opacity-100'
        }`}
      />

      {/* R3F 3D 场景视口 */}
      <Canvas
        events={safeCanvasEvents}
        dpr={tier === 'low' ? 1.0 : [1.0, 1.5]}
        frameloop={tier === 'low' ? 'demand' : 'always'}
        gl={{
          antialias: tier === 'high',
          powerPreference: 'high-performance',
          alpha: true,
        }}
        camera={{ position: [0, 0, 5.0], fov: 60 }}
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
        <LoginSpaceScene tier={tier} isFocused={isFocused} isSubmitting={isSubmitting} />
      </Canvas>
    </div>
  )
}
