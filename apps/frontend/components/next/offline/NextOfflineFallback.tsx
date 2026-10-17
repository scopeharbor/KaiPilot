'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { WifiOff } from 'lucide-react'
import { useNextTrackStore, type TrackType } from '@/stores/next-track-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'

export interface NextOfflineFallbackProps {
  /** 手动指定的轨道偏好（用于测试或容器覆盖；缺省从 useNextTrackStore 读取）。 */
  track?: TrackType
  /** 注入的重试导航回调（缺省调用 router.replace 并按双轨偏好跳转）。 */
  onRetry?: (targetHref: string) => void
  /** 根容器自定义样式类。 */
  className?: string
}

/**
 * PWA 离线深空兜底展示组件（v3-ui-next-batch2-auth-shell-assimilation W3 / task 3.1）。
 *
 * - 纯静态 Client Component：零外部网络请求、零写操作、零 Service Worker 注册逻辑改动；
 * - 视觉语言同化至新轨 Layer 1 深空沉浸（#040508）与 Layer 2 暗黑仪器卡片（#121418）；
 * - 边框采用 1px 发丝线（--nx-border-hairline）；
 * - 双通道指示：冷青（--nx-space-cyan）与琥珀（--nx-status-warning / amber-400）状态指示；
 * - 「重试连接」按当前双轨偏好（track）智能导流至 `/next` 或 `/dashboard`；
 * - 支持精确档（precise）纯平背景降级。
 */
function useSafeRouter() {
  try {
    return useRouter()
  } catch {
    return null
  }
}

export function NextOfflineFallback({
  track: propTrack,
  onRetry,
  className,
}: NextOfflineFallbackProps) {
  const router = useSafeRouter()
  const storeTrack = useNextTrackStore((state) => state.track)
  const currentTrack = propTrack ?? storeTrack
  const immersionTier = useImmersionTier()

  const [offlineWarning, setOfflineWarning] = useState(false)

  // 双轨导流目标：next → /next，默认/legacy → /dashboard
  const targetHref = currentTrack === 'next' ? '/next' : '/dashboard'

  const handleRetry = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
      if (!isOnline) {
        event.preventDefault()
        // 网络仍未恢复：触发轻度离线提示，严格零网络写请求（RL-01）
        setOfflineWarning(true)
        return
      }
      setOfflineWarning(false)
      if (onRetry) {
        event.preventDefault()
        onRetry(targetHref)
      } else if (router) {
        event.preventDefault()
        router.replace(targetHref)
      }
    },
    [onRetry, router, targetHref],
  )

  return (
    <main
      data-next-track
      data-offline-fallback
      data-immersion={immersionTier}
      role="main"
      className={cn(
        'flex min-h-dvh flex-col items-center justify-center bg-[var(--nx-space-bg)] px-4 text-[var(--nx-text-primary)]',
        immersionTier !== 'precise' && 'nx-space-atmosphere',
        className,
      )}
    >
      <div
        data-offline-card
        data-testid="offline-card"
        className={cn(
          'relative z-10 mx-auto w-full max-w-md rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-6 text-center sm:p-8',
          immersionTier !== 'precise' && 'shadow-2xl shadow-black/60',
        )}
      >
        {/* 双通道冷青/琥珀状态微标 */}
        <div className="mb-6 flex items-center justify-center gap-2">
          <span
            data-testid="status-badge-cyan"
            data-channel="cyan"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--nx-space-cyan)]/30 bg-[var(--nx-space-cyan)]/10 px-2.5 py-0.5 text-xs font-mono text-[var(--nx-space-cyan)]"
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full bg-[var(--nx-space-cyan)]',
                immersionTier !== 'precise' && 'animate-pulse',
              )}
              aria-hidden
            />
            离线外壳 · 活跃
          </span>
          <span
            data-testid="status-badge-amber"
            data-channel="amber"
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-mono text-amber-400"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
            链路状态 · 断开
          </span>
        </div>

        {/* 状态图标：双通道冷青光环 + 琥珀 WifiOff 警示 */}
        <div className="mb-6 flex justify-center">
          <div
            data-testid="offline-icon-container"
            className={cn(
              'flex h-16 w-16 items-center justify-center rounded-full border border-[var(--nx-space-cyan)]/30 bg-[var(--nx-bg-0)] ring-1 ring-amber-500/30',
              immersionTier !== 'precise' && 'shadow-[0_0_24px_rgba(56,189,248,0.12)]',
            )}
          >
            <WifiOff className="h-8 w-8 text-amber-400" aria-hidden />
          </div>
        </div>

        <h1 className="mb-2 text-2xl font-semibold tracking-[0.02em] text-[var(--nx-text-primary)]">
          当前处于离线状态
        </h1>

        <p className="mb-8 text-sm leading-relaxed text-[var(--nx-text-secondary)]">
          网络连接已断开，部分功能暂时不可用。 请检查网络连接后重试。
        </p>

        <div className="space-y-3">
          <Link
            href={targetHref}
            onClick={handleRetry}
            data-testid="retry-button"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--nx-space-cyan)] px-6 text-sm font-medium text-[var(--nx-space-bg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-workspace-surface)]"
          >
            重试连接
          </Link>

          {offlineWarning ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="offline-warning-banner"
              className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400"
            >
              网络连接尚未恢复，请检查本地网络设置后重试
            </div>
          ) : null}

          <p className="text-xs text-[var(--nx-text-muted)]">开项 OpenXiang — 离线模式</p>
        </div>
      </div>
    </main>
  )
}

export default NextOfflineFallback
