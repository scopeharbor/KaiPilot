'use client'

/**
 * 空间地图全屏 3D 沉浸视口容器与三档降级守卫
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - proposal.md §4, §5 (DOM + WebGL 分层模型与三档降级矩阵契约)
 * - design.md Decision 6, Decision 7, Decision 8
 * - tasks.md 5.3
 * - Layer 0 (z-0), fixed inset-0, pointer-events-none, aria-hidden="true", tabIndex={-1}
 * - Fallback 降级档：完全零 Canvas 节点，自动退回既有 2D 空间地图
 * - Low 档位：frameloop="demand"，静态单帧，DPR 固定 1.0
 * - High 档位：WebGL2 + DPR [1.0, 1.5]，frameloop="always"
 * - 捕获 webglcontextlost、软渲染器与 data-immersion="precise" 自愈降级
 */

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { safeCanvasEvents } from '@/components/next/3d/shared/safe-canvas-events'
import { probeWebGLCapabilities, type WebGLCapabilities } from '@/lib/next/3d/webgl-capabilities'
import { SpaceMap3DScene } from './SpaceMap3DScene'
import { SpaceMapGalaxyScene, SpaceMapGalaxyLabelLayer } from './SpaceMapGalaxyScene'
import type { CameraShotId } from './SpaceMapCameraController'
import type { StarVisualState } from './spacemap-state-mapper'
import type { GalaxySector } from './spacemap-galaxy-layout'

export const LazySpaceMap3DCanvas = dynamic(
  () => import('./SpaceMap3DCanvas').then((mod) => mod.SpaceMap3DCanvas),
  { ssr: false },
)

export interface SpaceMap3DCanvasProps {
  stars?: StarVisualState[]
  sectors?: GalaxySector[]
  selectedId?: number | null
  onSelectStar?: (projectId: number) => void
  onPointerOverStar?: (event: ThreeEvent<PointerEvent>, star: StarVisualState) => void
  onPointerOutStar?: (event: ThreeEvent<PointerEvent>) => void
  forceTier?: 'high' | 'low' | 'fallback'
  className?: string
  onContextLost?: () => void
  onDegradeToFallback?: () => void
  shot?: CameraShotId
  onShotChange?: (shot: CameraShotId) => void
  /**
   * fullscreen（默认）：全屏背景层 + 旧星区场景；
   * stage：嵌入父容器（absolute 填满）+ 项目星系场景——空间地图弹窗使用，星系就在眼前而不是被卡片挡在背后。
   */
  variant?: 'fullscreen' | 'stage'
  /** stage 场景中心标签（组织名）。 */
  coreLabel?: string
}

export function SpaceMap3DCanvas({
  stars = [],
  sectors,
  selectedId = null,
  onSelectStar,
  onPointerOverStar,
  onPointerOutStar,
  forceTier,
  className = '',
  onContextLost,
  onDegradeToFallback,
  shot = 'overview',
  onShotChange,
  variant = 'fullscreen',
  coreLabel,
}: SpaceMap3DCanvasProps) {
  const isStage = variant === 'stage'
  const [isMounted, setIsMounted] = React.useState(false)
  const [caps, setCaps] = React.useState<WebGLCapabilities | null>(null)
  const [hasContextLost, setHasContextLost] = React.useState(false)
  const [isFadedIn, setIsFadedIn] = React.useState(false)

  // 卸载期上下文丢失守卫：R3F 卸载 Canvas 时会调用 gl.forceContextLoss()，浏览器会向
  // 该 canvas 派发 webglcontextlost。若放任其触发降级回调，镜头切换 / 浮层关闭这类正常
  // 卸载也会把外层 viewMode 永久打回 2D（切回空间拓扑时不再回到 3D）。仅存活态的真实
  // 上下文丢失才允许自愈降级。
  const isAliveRef = React.useRef(true)
  React.useEffect(() => {
    isAliveRef.current = true
    return () => {
      isAliveRef.current = false
    }
  }, [])

  React.useEffect(() => {
    setIsMounted(true)
    if (!forceTier) {
      try {
        setCaps(probeWebGLCapabilities())
      } catch {
        setCaps({
          supported: false,
          isSoftwareRenderer: false,
          reducedMotion: false,
          tier: 'fallback',
        })
      }
    }
  }, [forceTier])

  // 监听 prefers-reduced-motion 动态偏好
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!mql) return
    const handleChange = () => {
      try {
        setCaps(probeWebGLCapabilities())
      } catch {
        setCaps({
          supported: false,
          isSoftwareRenderer: false,
          reducedMotion: false,
          tier: 'fallback',
        })
      }
    }
    mql.addEventListener?.('change', handleChange)
    return () => mql.removeEventListener?.('change', handleChange)
  }, [])

  // 计算最终生效档位
  const effectiveTier: 'high' | 'low' | 'fallback' = React.useMemo(() => {
    if (forceTier) return forceTier
    if (hasContextLost) return 'fallback'
    if (!isMounted || !caps) return 'fallback'
    return caps.tier
  }, [forceTier, hasContextLost, isMounted, caps])

  // 探测未决（caps 为 null 的首帧）不得触发降级——否则每次真实挂载都在探测完成前
  // 误触 onDegradeToFallback 回退 2D（竞态：capability 竞态，实测浏览器必现）。
  const isCapsResolved = forceTier !== undefined || hasContextLost || (isMounted && caps !== null)
  const isFallback = isCapsResolved && effectiveTier === 'fallback'
  // 探测未决期同样不渲染 Canvas（等价 loading 空帧，但不降级）
  const isProbing = !isCapsResolved

  // 当处于 fallback 档位时，通知外层退回既有 2D 地图
  React.useEffect(() => {
    if (isFallback) {
      onDegradeToFallback?.()
    }
  }, [isFallback, onDegradeToFallback])

  const handleContextLost = React.useCallback(() => {
    // 卸载期 forceContextLoss 触发的 webglcontextlost 不是真实降级信号，直接忽略
    if (!isAliveRef.current) return
    setHasContextLost(true)
    onContextLost?.()
    onDegradeToFallback?.()
  }, [onContextLost, onDegradeToFallback])

  const handleCanvasCreated = React.useCallback(() => {
    setIsFadedIn(true)
  }, [])

  // 星系标签 DOM 覆盖层（stage 模式）：内容由 React 渲染，位置由场景内
  // GalaxyLabelProjector 每帧命令式投影写入；替代 drei Html 的嵌套 root 方案
  const labelLayerRef = React.useRef<HTMLDivElement | null>(null)

  // Fallback 纯 CSS 降级档：零 Canvas / 零 WebGL 初始化，100% 展现既有 2D 空间地图
  if (isFallback || isProbing) {
    return null
  }

  return (
    <div
      data-testid="spacemap-3d-container"
      aria-hidden="true"
      tabIndex={-1}
      data-spacemap-variant={variant}
      className={`${isStage ? 'absolute' : 'fixed'} inset-0 pointer-events-none z-0 overflow-hidden ${className}`}
    >
      <Canvas
        events={safeCanvasEvents}
        dpr={effectiveTier === 'low' ? 1.0 : [1.0, 1.5]}
        // stage 场景含镜头缓动与轨道控制，需要持续帧；fullscreen 低档保持静态单帧
        frameloop={effectiveTier === 'low' && !isStage ? 'demand' : 'always'}
        gl={{
          antialias: effectiveTier === 'high',
          powerPreference: effectiveTier === 'high' ? 'high-performance' : 'low-power',
          alpha: true,
        }}
        camera={isStage ? { position: [0, 26, 44], fov: 50 } : { position: [0, 45, 105], fov: 55 }}
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
        className={`w-full h-full transition-opacity duration-500 ease-out ${
          isFadedIn ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden="true"
        tabIndex={-1}
        style={{ pointerEvents: 'auto' }}
      >
        {isStage ? (
          <SpaceMapGalaxyScene
            stars={stars}
            selectedId={selectedId}
            onSelectStar={onSelectStar}
            onPointerOverStar={onPointerOverStar}
            onPointerOutStar={onPointerOutStar}
            tier={effectiveTier === 'high' ? 'high' : 'low'}
            labelLayerRef={labelLayerRef}
          />
        ) : (
          <SpaceMap3DScene
            stars={stars}
            sectors={sectors}
            selectedId={selectedId}
            onSelectStar={onSelectStar}
            onPointerOverStar={onPointerOverStar}
            onPointerOutStar={onPointerOutStar}
            tier={effectiveTier}
            shot={shot}
            onShotChange={onShotChange}
          />
        )}
      </Canvas>
      {isStage && (
        <div
          ref={labelLayerRef}
          data-testid="spacemap-galaxy-label-layer"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[1] overflow-hidden"
        >
          <SpaceMapGalaxyLabelLayer stars={stars} selectedId={selectedId} coreLabel={coreLabel} />
        </div>
      )}
    </div>
  )
}
