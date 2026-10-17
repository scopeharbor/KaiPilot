'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, LoaderCircle, LockKeyhole, Undo2 } from 'lucide-react'
import {
  authApi,
  googlePreflightMessage,
  isTwoFactorChallenge,
  type AuthSession,
} from '@/lib/api/auth'
import { loginErrorMessage } from '@/components/auth/LoginForm'
import { ForegroundCutout } from '@/components/next/3d/shared/ForegroundCutout'
import { NxThemeToggle } from '@/components/next/layout/NxThemeToggle'
import { SourceCodeLink } from '@/components/edition/SourceCodeLink'
import { TextVariantSwitcher } from '@/components/locale/text-variant-switcher'
import { useNxTheme } from '@/hooks/use-nx-theme'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useTwoFactorChallengeStore } from '@/stores/two-factor-challenge-store'
import { safeNextPath } from '@/lib/auth/safe-next-path'
import type { PendingTwoFactorChallenge } from '@/components/auth/TwoFactorChallengeForm'
import { LazyLoginSpaceCanvas } from '@/components/next/3d/login/LoginSpaceCanvas'

export interface NextLoginFormProps {
  nextPath?: string
  onFocusChange?: (focused: boolean) => void
  onSubmittingChange?: (submitting: boolean) => void
}

/**
 * 新 UI 登录表单（v3-ui-next-track-foundation D-d / spec「新 UI 登录页」）。
 *
 * 认证动作 100% 复用既有链路：`authApi.login` + 2FA 挑战判定
 * （`isTwoFactorChallenge` / `useTwoFactorChallengeStore`）+ `setSession`，
 * 零新增后端端点、零新 token 逻辑。
 *
 * - 登录成功：`setSession` 落会话，切换偏好记为 `next`（source `next_login`），
 *   经 `safeNextPath` 过滤后导航至新轨首页（默认 `/next`）；
 * - 视觉：新轨风格（暗色卡片、发丝线边框），消费 `--nx-*` 令牌；
 * - Google 登录：与旧轨同一 `/auth/google/config` 授权地址，回跳 `nextPath`（默认 `/next`）；
 *   回调失败 / 需两步验证时后端仍回到 `/login` 由旧轨页处理；
 * - 错误呈现：复用旧轨错误码映射（如 `INVALID_CREDENTIALS` → 中文提示），
 *   绝不泄露额外内部状态。
 */
export function NextLoginForm({
  nextPath = '/next',
  onFocusChange,
  onSubmittingChange,
}: NextLoginFormProps) {
  useNxTheme()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const startChallenge = useTwoFactorChallengeStore((state) => state.start)
  const [googleUrl, setGoogleUrl] = useState<string | null>(null)
  const [googleNotice, setGoogleNotice] = useState<string | null>(null)

  // Google 登录：与旧轨同一 `/auth/google/config`，回跳目标为新轨路径，回调页据此落到新 UI。
  useEffect(() => {
    let mounted = true
    authApi
      .googleConfig(nextPath)
      .then((config) => {
        if (!mounted) return
        setGoogleUrl(config.authorizationUrl)
        const status = config.preflight?.status
        if (config.missingEnvKeys.length > 0) {
          setGoogleNotice('Google 登录尚未配置，请联系管理员。')
        } else if (status && status !== 'configured') {
          setGoogleNotice(googlePreflightMessage(status))
        }
      })
      .catch(() => {
        if (mounted) setGoogleNotice('Google 登录配置暂时不可用。')
      })
    return () => {
      mounted = false
    }
  }, [nextPath])

  /** 会话落地：写 store、锁偏好 `next` 并跳转目标路由。 */
  const completeSession = useCallback(
    (session: AuthSession, destination: string) => {
      useAuthStore.getState().setSession(session)
      useNextTrackStore.getState().setTrack('next', 'next_login')
      router.replace(destination)
      router.refresh()
    },
    [router],
  )

  /** 2FA 挑战透传：与旧轨同一票据、同一 store、同一挑战路由。 */
  const goToChallenge = useCallback(
    (challenge: PendingTwoFactorChallenge, destination: string) => {
      startChallenge({ ...challenge, nextPath: safeNextPath(destination) })
      router.replace(challenge.purpose === 'enroll' ? '/2fa/setup' : '/2fa/challenge')
    },
    [router, startChallenge],
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    onSubmittingChange?.(true)
    setError('')
    try {
      const result = await authApi.login({ email: email.trim(), password })
      if (isTwoFactorChallenge(result)) {
        // 密码正确但账号开了两步验证：切到第二因子步，立即清空密码。
        setPassword('')
        goToChallenge(
          {
            challengeToken: result.challengeToken,
            expiresAt: result.expiresAt,
            purpose: result.purpose,
            skippable: result.skippable,
            methods: result.methods,
          },
          nextPath,
        )
        return
      }
      completeSession(result, safeNextPath(nextPath, '/next'))
    } catch (reason) {
      setError(loginErrorMessage(reason))
    } finally {
      setSubmitting(false)
      onSubmittingChange?.(false)
    }
  }

  return (
    <div
      data-next-track
      className="relative flex min-h-screen items-center justify-center bg-[var(--nx-space-bg)] px-4 py-10 text-[var(--nx-text-primary)]"
    >
      {/* Layer 0 (z-0): 3D 深空视口 / 纯 CSS 静态降级底图 */}
      <LazyLoginSpaceCanvas isFocused={isFocused} isSubmitting={submitting} />

      {/* Layer 0.5 (z-[1]): 前景剪纸剪影（DOM+WebGL 深度合成，防「平卡片盖场景」） */}
      <ForegroundCutout />

      {/* 顶部右侧：明暗主题切换 + 界面文字变体切换（登录页无顶栏，入口直接挂页面上） */}
      <div
        data-login-controls
        className="fixed right-6 top-6 z-20 flex items-center gap-2 sm:right-10 sm:top-8"
      >
        <NxThemeToggle />
        <TextVariantSwitcher />
      </div>

      {/* Layer 1 (z-10): 语义化 DOM 表单卡片（前景剪纸切角边缘） */}
      <div className="relative z-10 w-full max-w-md pointer-events-auto">
        <div
          data-login-card
          className="rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]/90 p-6 backdrop-blur-md [clip-path:polygon(0_0,calc(100%-18px)_0,100%_18px,100%_100%,0_100%)] sm:p-8"
        >
          <div className="mb-8">
            <div className="mb-3 flex items-center gap-2 text-[var(--nx-space-cyan)]">
              <LockKeyhole className="h-4 w-4" aria-hidden />
              <span className="text-sm font-medium">安全登录</span>
            </div>
            <h2 className="text-2xl font-semibold tracking-[0.02em] text-[var(--nx-text-primary)]">
              欢迎回来
            </h2>
            <p className="mt-2 text-sm text-[var(--nx-text-secondary)]">
              使用你的开项账号进入新页面。
            </p>
          </div>

          <form onSubmit={submit} className="space-y-5" noValidate>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--nx-text-secondary)]">
                邮箱
              </span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onFocus={() => {
                  setIsFocused(true)
                  onFocusChange?.(true)
                }}
                onBlur={() => {
                  setIsFocused(false)
                  onFocusChange?.(false)
                }}
                className="h-11 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-base text-[var(--nx-text-primary)] transition-colors placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--nx-border-focus)]"
                placeholder="name@example.com"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--nx-text-secondary)]">
                密码
              </span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onFocus={() => {
                  setIsFocused(true)
                  onFocusChange?.(true)
                }}
                onBlur={() => {
                  setIsFocused(false)
                  onFocusChange?.(false)
                }}
                className="h-11 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-base text-[var(--nx-text-primary)] transition-colors placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--nx-border-focus)]"
                placeholder="密码"
              />
            </label>

            {error ? (
              <div
                role="alert"
                className="rounded-md border border-[var(--nx-status-danger)]/40 bg-[var(--nx-status-danger)]/10 px-3 py-2.5 text-sm text-[var(--nx-status-danger)]"
              >
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting || !email.trim() || !password}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--nx-space-cyan)] px-4 text-sm font-medium text-[var(--nx-space-bg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-workspace-surface)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                  登录中…
                </>
              ) : (
                <>
                  登录
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 space-y-3 border-t border-[var(--nx-border-hairline)] pt-5">
            <a
              data-next-login-google
              href={googleUrl ?? undefined}
              aria-disabled={!googleUrl}
              onClick={(event) => {
                if (!googleUrl) {
                  event.preventDefault()
                  return
                }
                // 回来后留在新 UI（与密码登录同一偏好来源）。
                useNextTrackStore.getState().setTrack('next', 'next_login')
              }}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 text-sm font-medium text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-border-focus)] aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              <img
                src="/branding/google-logo.svg"
                alt=""
                aria-hidden="true"
                className="h-4 w-4 shrink-0 object-contain"
              />
              使用 Google 登录
            </a>
            {googleNotice ? (
              <p className="text-xs leading-5 text-[var(--nx-status-warning)]">{googleNotice}</p>
            ) : null}
            <Link
              href="/login"
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 text-sm font-medium text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
            >
              <Undo2 className="h-4 w-4" aria-hidden />
              切回旧版登录
            </Link>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-[var(--nx-text-muted)]">AI 驱动，项目从容。</p>
        {/* 源代码入口（AGPL 第 13 条）：未配置地址时不渲染 */}
        <SourceCodeLink className="mt-2 flex justify-center" />
      </div>

      {/* 电影级品牌排版（左上角固定，DOM 信息层；DOM 序在表单之后以保分层契约） */}
      <header
        data-login-brand
        className="pointer-events-none fixed left-6 top-6 z-10 select-none sm:left-10 sm:top-8"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--nx-space-cyan)]">
          OPENXIANG
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-[0.06em] text-[var(--nx-text-primary)]">
          开项
        </h1>
        <div className="mt-2 h-px w-16 bg-[var(--nx-border-focus)] opacity-70" aria-hidden />
        <p className="mt-2 max-w-[220px] text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
          一句话启动项目，AI 生成完整计划
        </p>
      </header>
    </div>
  )
}
