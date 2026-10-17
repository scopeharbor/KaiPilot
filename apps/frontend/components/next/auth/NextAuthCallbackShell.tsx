'use client'

import React from 'react'
import { AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { BrandLoader } from '@/components/ui/BrandLogo'
import { useNextTrackStore, type ImmersionTier } from '@/stores/next-track-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { safeNextPath } from '@/lib/auth/safe-next-path'
import { cn } from '@/lib/utils'
import '@/app/(next)/next-tokens.css'

export interface NextAuthCallbackShellProps {
  /** 加载阶段文案，例如「正在完成 Google 登录…」、「正在完成企业 SSO 登录…」 */
  loadingLabel?: string
  /** 握手或解析错误，存在时渲染暗黑仪器风错误卡片 */
  error?: string | null
  /** 错误卡片标题，例如「Google 登录未完成」、「企业 SSO 登录未完成」 */
  errorTitle?: string
  /** 安全回跳地址（若提供，在返回登录页时作为 next 参数携带） */
  nextPath?: string | null
  /** 自定义返回登录点击回调（优先于默认路由跳转，便于单测与自定义宿主） */
  onReturnToLogin?: () => void
  /** 别名支持 */
  onBackToLogin?: () => void
  /** 沉浸档位覆盖（默认消费 useImmersionTier 动态合成） */
  immersionTier?: ImmersionTier
  /** 自定义类名 */
  className?: string
}

/**
 * 通用第三方单点登录 (OAuth / SSO) 深空回调协议桩外壳。
 *
 * 遵循 v3-ui-next-batch2-auth-shell-assimilation D23 与 RL-15 视觉红线：
 * - 握手加载期：Layer 1 深空黑底 (`#040508`) + BrandLoader (64px) + .nx-space-atmosphere 纯 CSS 微光
 * - 异常失败期：Layer 2 暗黑仪器卡片 (`#121418`) + AlertCircle + 双轨智能导流「返回登录」按钮
 * - 精确档 (`data-immersion="precise"`) / prefers-reduced-motion：纯平深空黑底降级，彻底关闭光晕
 * - 零 3D / 零 WebGL / 零 Canvas，纯客户端无写操作。
 */
export function NextAuthCallbackShell({
  loadingLabel = '正在完成登录…',
  error,
  errorTitle = '登录未完成',
  nextPath,
  onReturnToLogin,
  onBackToLogin,
  immersionTier,
  className,
}: NextAuthCallbackShellProps) {
  const router = useRouter()
  const activeImmersion = useImmersionTier()
  const tier = immersionTier ?? activeImmersion

  const handleReturn = () => {
    if (onReturnToLogin) {
      onReturnToLogin()
      return
    }
    if (onBackToLogin) {
      onBackToLogin()
      return
    }
    const track = useNextTrackStore.getState().track
    const base = track === 'next' ? '/next-login' : '/login'
    const safeNext = nextPath ? safeNextPath(nextPath, '') : ''
    const target =
      safeNext &&
      safeNext !== '/login' &&
      safeNext !== '/next-login' &&
      safeNext !== '/dashboard' &&
      safeNext !== '/next'
        ? `${base}?next=${encodeURIComponent(safeNext)}`
        : base
    router.replace(target)
  }

  if (error) {
    return (
      <main
        data-next-track
        data-auth-callback-shell
        data-immersion={tier}
        className={cn(
          'nx-space-atmosphere flex min-h-screen items-center justify-center bg-[var(--nx-space-bg,#040508)] px-4 py-8 text-[var(--nx-text-primary,#f1f5f9)]',
          className,
        )}
      >
        <div
          role="alert"
          aria-live="assertive"
          className="relative z-10 w-full max-w-md rounded-xl border border-[var(--nx-border-hairline,rgba(255,255,255,0.08))] bg-[var(--nx-workspace-surface,#121418)] p-6 text-center shadow-2xl sm:p-8"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--nx-status-warning,#f59e0b)]/10 text-[var(--nx-status-warning,#f59e0b)]">
            <AlertCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-[var(--nx-text-primary,#f1f5f9)]">
            {errorTitle}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--nx-text-secondary,#94a3b8)]">{error}</p>
          <button
            type="button"
            onClick={handleReturn}
            data-next-action="return-to-login"
            className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-[var(--nx-border-hairline,rgba(255,255,255,0.08))] bg-[var(--nx-bg-0,#0a0b0d)] px-4 text-sm font-medium text-[var(--nx-text-primary,#f1f5f9)] transition-colors hover:border-[var(--nx-border-focus,rgba(56,189,248,0.4))] hover:bg-[var(--nx-workspace-surface,#121418)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus,rgba(56,189,248,0.4))]"
          >
            返回登录
          </button>
        </div>
      </main>
    )
  }

  return (
    <main
      data-next-track
      data-auth-callback-shell
      data-immersion={tier}
      aria-busy="true"
      className={cn(
        'nx-space-atmosphere flex min-h-screen items-center justify-center bg-[var(--nx-space-bg,#040508)] px-4 py-8 text-[var(--nx-text-primary,#f1f5f9)]',
        className,
      )}
    >
      <div className="relative z-10 text-center">
        <BrandLoader
          size={64}
          label={loadingLabel}
          className="[&>span]:text-[var(--nx-text-secondary,#94a3b8)]"
        />
      </div>
    </main>
  )
}

export default NextAuthCallbackShell
