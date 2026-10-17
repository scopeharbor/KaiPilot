'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { TwoFactorChallengeForm } from '@/components/auth/TwoFactorChallengeForm'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { isChallengeUsable, useTwoFactorChallengeStore } from '@/stores/two-factor-challenge-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { safeNextPath } from '@/lib/auth/safe-next-path'
import { cn } from '@/lib/utils'
import type { AuthSession, TwoFactorChallengePurpose } from '@/lib/api/auth'

const COPY: Record<TwoFactorChallengePurpose, { title: string; body: string; badge: string }> = {
  enroll: {
    badge: '2FA 绑定',
    title: '给账号加把锁',
    body: '用手机上的认证器 App 扫一次码，以后登录多输 6 位数字，密码泄露也进不来。',
  },
  verify: {
    badge: '2FA 验证',
    title: '多一步，安全得多',
    body: '即使密码泄露，没有你手机上的认证器也无法登录你的项目工作台。',
  },
}

export interface NextTwoFactorStepShellProps {
  expected: TwoFactorChallengePurpose
  children?: ReactNode
}

/**
 * 新轨 2FA 深空沉浸外壳与暗黑仪器容器（v3-ui-next-batch2-auth-shell-assimilation 任务 2.1）。
 *
 * - Layer 1 深空沉浸背景（#040508，`.nx-space-atmosphere` 纯 CSS 渐变微光，零 WebGL/Canvas）；
 * - Layer 2 暗黑仪器卡片（#121418，1px 发丝线边框 `border-[var(--nx-border-hairline)]`，冷青 `#38bdf8` 徽章）；
 * - 精确档（`precise`）纯平降级与 WCAG AA 对比度；
 * - 安全票据守卫与双轨偏好取消/过期返回分支（新轨偏好回 `/next-login`，旧轨回 `/login`）；
 * - 底层安全协议与 TOTP 流程 100% 零修改。
 */
export function NextTwoFactorStepShell({ expected, children }: NextTwoFactorStepShellProps) {
  const router = useRouter()
  const setSession = useAuthStore((state) => state.setSession)
  const challengeToken = useTwoFactorChallengeStore((state) => state.challengeToken)
  const expiresAt = useTwoFactorChallengeStore((state) => state.expiresAt)
  const purpose = useTwoFactorChallengeStore((state) => state.purpose)
  const skippable = useTwoFactorChallengeStore((state) => state.skippable)
  const methods = useTwoFactorChallengeStore((state) => state.methods)
  const nextPath = useTwoFactorChallengeStore((state) => state.nextPath)
  const hasHydrated = useTwoFactorChallengeStore((state) => state.hasHydrated)
  const clear = useTwoFactorChallengeStore((state) => state.clear)

  const track = useNextTrackStore((state) => state.track)
  const source = useNextTrackStore((state) => state.source)
  const isNextTrack = track === 'next' || source === 'next_login'
  const loginPath = isNextTrack ? '/next-login' : '/login'

  const activeTier = useImmersionTier()

  useEffect(() => {
    void useTwoFactorChallengeStore.persist.rehydrate()
  }, [])

  const usable = isChallengeUsable({ challengeToken, expiresAt })
  const matches = purpose === expected
  const settledRef = useRef(false)

  useEffect(() => {
    if (!hasHydrated || settledRef.current) return
    if (!usable || !matches) {
      router.replace(loginPath)
    }
  }, [hasHydrated, usable, matches, router, loginPath])

  if (!hasHydrated || !usable || !matches || !challengeToken || !expiresAt || !purpose) {
    return (
      <main
        data-next-track
        data-immersion={activeTier}
        data-testid="two-factor-skeleton"
        role="status"
        aria-busy="true"
        className="nx-space-atmosphere flex min-h-screen items-center justify-center bg-[var(--nx-space-bg)] px-4 py-10 text-[var(--nx-text-primary)]"
      >
        <div
          className={cn(
            'w-full max-w-md rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-6 sm:p-8',
            activeTier === 'precise' ? 'shadow-none' : 'shadow-2xl',
          )}
        >
          <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
            <LoaderCircle
              className="h-8 w-8 animate-spin text-[var(--nx-space-cyan)]"
              aria-hidden
            />
            <p className="text-sm text-[var(--nx-text-secondary)]">正在校验登录状态…</p>
          </div>
        </div>
      </main>
    )
  }

  function finish(session: AuthSession) {
    settledRef.current = true
    setSession(session)
    clear()
    const defaultDestination = isNextTrack ? '/next' : '/dashboard'
    const destination =
      !nextPath || nextPath === '/dashboard' || nextPath === '/login' || nextPath === '/next-login'
        ? defaultDestination
        : safeNextPath(nextPath, defaultDestination)
    router.replace(destination)
    router.refresh()
  }

  function abandon() {
    settledRef.current = true
    clear()
    router.replace(loginPath)
  }

  const copy = COPY[expected]
  const enrolling = expected === 'enroll'

  return (
    <main
      data-next-track
      data-immersion={activeTier}
      className="nx-space-atmosphere flex min-h-screen items-center justify-center bg-[var(--nx-space-bg)] px-4 py-10 text-[var(--nx-text-primary)]"
    >
      <div className={cn('w-full', enrolling ? 'max-w-xl' : 'max-w-md')}>
        <div
          className={cn(
            'rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-6 sm:p-8',
            activeTier === 'precise' ? 'shadow-none' : 'shadow-2xl',
          )}
        >
          <div className="mb-6 flex items-center justify-between border-b border-[var(--nx-border-hairline)] pb-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
              aria-label="开项首页"
            >
              <BrandLogo size={28} showName className="text-[var(--nx-text-primary)]" />
            </Link>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1 text-xs font-medium text-[var(--nx-space-cyan)]">
              {enrolling ? (
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <LockKeyhole className="h-3.5 w-3.5" aria-hidden />
              )}
              <span>{copy.badge}</span>
            </div>
          </div>

          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-[-0.02em] text-[var(--nx-text-primary)] sm:text-2xl">
              {copy.title}
            </h1>
            <p className="mt-1.5 text-sm leading-6 text-[var(--nx-text-secondary)]">{copy.body}</p>
          </div>

          <div className="two-factor-form-wrapper [&_input]:border-[var(--nx-border-hairline)] [&_input]:bg-[var(--nx-bg-0)] [&_input]:text-[var(--nx-text-primary)] [&_input:focus]:border-[var(--nx-border-focus)] [&_input:focus]:ring-2 [&_input:focus]:ring-[var(--nx-border-focus)] [&_input]:placeholder:text-[var(--nx-text-muted)] [&_.text-heading]:text-[var(--nx-text-primary)] [&_.text-gray-600]:text-[var(--nx-text-secondary)] [&_.text-gray-500]:text-[var(--nx-text-muted)] [&_.text-gray-700]:text-[var(--nx-text-secondary)] [&_.text-gray-800]:text-[var(--nx-text-primary)] [&_button.bg-primary-600]:bg-[var(--nx-space-cyan)] [&_button.bg-primary-600]:text-[var(--nx-space-bg)] [&_button.bg-primary-600:hover]:opacity-90 [&_.text-primary-700]:text-[var(--nx-space-cyan)] [&_.border-border]:border-[var(--nx-border-hairline)] [&_.border-border-strong]:border-[var(--nx-border-hairline)] [&_.bg-surface]:bg-[var(--nx-bg-0)] [&_.bg-gray-50]:bg-[var(--nx-bg-0)] [&_.bg-background]:bg-[var(--nx-bg-0)] [&_button]:transition-colors">
            {children ?? (
              <TwoFactorChallengeForm
                challenge={{ challengeToken, expiresAt, purpose, skippable, methods }}
                onAuthenticated={finish}
                onCancel={abandon}
              />
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-[var(--nx-text-muted)]">AI 驱动，项目从容。</p>
      </div>
    </main>
  )
}
