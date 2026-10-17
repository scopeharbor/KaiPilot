'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, LoaderCircle, LockKeyhole } from 'lucide-react'
import {
  authApi,
  googleErrorMessage,
  googlePreflightMessage,
  isTwoFactorChallenge,
  type AuthSession,
} from '@/lib/api/auth'
import { useAuthStore } from '@/stores/auth-store'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { SourceCodeLink } from '@/components/edition/SourceCodeLink'
import { useTwoFactorChallengeStore } from '@/stores/two-factor-challenge-store'
import { safeNextPath } from '@/lib/auth/safe-next-path'
import type { PendingTwoFactorChallenge } from '@/components/auth/TwoFactorChallengeForm'
import type { TwoFactorMethod } from '@/lib/api/two-factor'

/** 登录错误码 → 中文文案（新轨登录表单复用同一映射，design D-d）。 */
export function loginErrorMessage(error: unknown): string {
  const apiError = error as { code?: string; message?: string }
  if (apiError.code === 'INVALID_CREDENTIALS' || apiError.code === 'AUTH_REQUIRED') {
    return '邮箱或密码不正确，请重新检查。'
  }
  if (apiError.code === 'ACCOUNT_LOCKED') {
    return apiError.message ?? '登录尝试过多，请稍后再试。'
  }
  return apiError.message ?? '暂时无法登录，请检查网络后重试。'
}

/** 第二因子方式字符串 → 闭集，未知值丢弃（不把服务端原样回显进 UI 逻辑）。 */
function parseTwoFactorMethods(raw: string | null): TwoFactorMethod[] {
  if (!raw) return ['totp']
  const parsed = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is TwoFactorMethod => value === 'totp' || value === 'recovery_code')
  return parsed.length > 0 ? parsed : ['totp']
}

/**
 * 从 URL fragment 读取 Google 回调带回的 2FA 挑战（后端 `auth_controller.googleCallback`）。
 *
 * 用 fragment 而非 query：挑战令牌不会进服务端访问日志，也不随 Referer 外泄。
 * 读取后立即用 `replaceState` 抹掉，避免留在地址栏与历史记录里。
 */
function consumeGoogleTwoFactorChallenge(): {
  challenge: PendingTwoFactorChallenge
  next: string | null
} | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash.replace(/^#/, '')
  if (hash.length === 0) return null

  const params = new URLSearchParams(hash)
  const challengeToken = params.get('twoFactorChallenge')
  if (!challengeToken) return null

  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  return {
    challenge: {
      challengeToken,
      expiresAt: params.get('twoFactorExpiresAt') ?? new Date(Date.now() + 60_000).toISOString(),
      // 未知值一律按最保守的 verify 处理（不会误开绑定界面）。
      purpose: params.get('twoFactorPurpose') === 'enroll' ? 'enroll' : 'verify',
      skippable: params.get('twoFactorSkippable') === 'true',
      methods: parseTwoFactorMethods(params.get('twoFactorMethods')),
    },
    next: params.get('next'),
  }
}

export function LoginForm({
  nextPath,
  showDevelopmentAccount = false,
  googleCallbackError = null,
}: {
  nextPath: string
  showDevelopmentAccount?: boolean
  /** 来自 `/login?sso_error=<code>` 的低敏错误码（由页面读取 query 后传入）。 */
  ssoError?: string | null
  /** 来自 `/login?google_error=<code>` 的 Google 登录低敏错误码（typed code，design D）。 */
  googleCallbackError?: string | null
}) {
  const router = useRouter()
  const setSession = useAuthStore((state) => state.setSession)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [googleError, setGoogleError] = useState('')
  const [googleUrl, setGoogleUrl] = useState<string | null>(null)
  const [googleMissingKeys, setGoogleMissingKeys] = useState<string[]>([])
  const [googlePreflight, setGooglePreflight] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const startChallenge = useTwoFactorChallengeStore((state) => state.start)

  /** 会话落地：写 store 并跳转到目标路由。 */
  const completeSession = useCallback(
    (session: AuthSession, destination: string) => {
      setSession(session)
      router.replace(destination)
      router.refresh()
    },
    [router, setSession],
  )

  /**
   * 把挑战票据交给 sessionStorage 并导航到对应的独立路由。
   *
   * 用 `replace` 而非 `push`：登录页不该留在历史里让用户「后退」回到一个
   * 已经消费掉的密码步。目标路径先过 `safeNextPath`，防开放重定向。
   */
  const goToChallenge = useCallback(
    (challenge: PendingTwoFactorChallenge, destination: string) => {
      startChallenge({ ...challenge, nextPath: safeNextPath(destination) })
      router.replace(challenge.purpose === 'enroll' ? '/2fa/setup' : '/2fa/challenge')
    },
    [router, startChallenge],
  )

  // Google OAuth 回调若命中 2FA，会 302 回本页并把挑战放在 URL fragment 里。
  useEffect(() => {
    const pending = consumeGoogleTwoFactorChallenge()
    if (!pending) return
    goToChallenge(pending.challenge, pending.next ?? nextPath)
  }, [goToChallenge, nextPath])

  useEffect(() => {
    let mounted = true
    authApi
      .googleConfig(nextPath)
      .then((config) => {
        if (!mounted) return
        setGoogleUrl(config.authorizationUrl)
        setGoogleMissingKeys(config.missingEnvKeys)
        const status = config.preflight?.status
        setGooglePreflight(
          status && status !== 'configured' ? googlePreflightMessage(status) : null,
        )
      })
      .catch(() => {
        if (mounted) setGoogleError('Google 登录配置暂时不可用。')
      })
    return () => {
      mounted = false
    }
  }, [nextPath])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result = await authApi.login({ email: email.trim(), password })
      if (isTwoFactorChallenge(result)) {
        // 密码正确但账号开了两步验证：切到第二因子步。此处拿到的**不是**会话，
        // 立即清空密码，避免它继续留在内存与表单里。
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
      completeSession(result, nextPath)
    } catch (reason) {
      setError(loginErrorMessage(reason))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(320px,0.85fr)_minmax(460px,1.15fr)]">
      <section className="bg-primary-50 px-6 py-6 sm:px-10 lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
        <Link
          href="/"
          className="w-fit text-base font-semibold text-primary-700 focus-visible:rounded-sm focus-visible:shadow-focus"
        >
          <BrandLogo size={34} showName imageClassName="h-[34px] w-[34px]" />
        </Link>
        <div className="mt-8 max-w-md lg:my-auto lg:py-12">
          <BrandLogo
            size={80}
            showName={false}
            imageClassName="mb-6 h-[72px] w-[72px] lg:mb-8 lg:h-20 lg:w-20"
            className="block"
          />
          <h1 className="text-balance text-2xl font-semibold tracking-[-0.03em] text-heading lg:text-3xl">
            回到你的项目工作台
          </h1>
          <p className="mt-3 max-w-[48ch] text-pretty text-sm leading-6 text-gray-600 lg:mt-4 lg:text-base lg:leading-7">
            登录后继续管理计划、团队与 AI 协作。AI 能力使用你在「设置 → AI 连接」里添加的模型 Key。
          </p>
        </div>
        <p className="hidden text-xs text-gray-500 lg:block">AI 驱动，项目从容。</p>
      </section>

      <section className="flex items-center justify-center px-6 py-8 sm:px-10 lg:py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="mb-3 flex items-center gap-2 text-primary-700">
              <LockKeyhole className="h-4 w-4" aria-hidden />
              <span className="text-sm font-medium">安全登录</span>
            </div>
            <h2 className="text-balance text-2xl font-semibold tracking-[-0.02em] text-heading">
              欢迎回来
            </h2>
            <p className="mt-2 text-sm text-gray-600">使用你的开项账号继续。</p>
          </div>

          <form onSubmit={submit} className="space-y-5" noValidate>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">邮箱</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-11 w-full rounded-md border border-border-strong bg-background px-3 text-base text-heading shadow-xs transition-colors focus:border-primary-500 focus:shadow-focus"
                placeholder="name@example.com"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">密码</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-11 w-full rounded-md border border-border-strong bg-background px-3 text-base text-heading shadow-xs transition-colors focus:border-primary-500 focus:shadow-focus"
                placeholder="输入密码"
              />
            </label>

            {error ? (
              <div role="alert" className="rounded-md bg-danger-bg px-3 py-2.5 text-sm text-danger">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting || !email.trim() || !password}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus-visible:shadow-focus disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {submitting ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                  正在登录…
                </>
              ) : (
                <>
                  登录
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </>
              )}
            </button>
          </form>

          {showDevelopmentAccount ? (
            <div className="mt-6 rounded-md bg-surface px-3 py-3 text-xs leading-5 text-gray-600">
              本机开发账号：<span className="font-mono text-gray-800">admin@aiproj.local</span>
              <br />
              默认密码：<span className="font-mono text-gray-800">password123</span>
            </div>
          ) : null}

          <div className="mt-6 space-y-3 border-t border-border pt-5">
            <a
              href={googleUrl ?? undefined}
              aria-disabled={!googleUrl}
              onClick={(event) => {
                if (!googleUrl) event.preventDefault()
              }}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-border-strong bg-background px-4 text-sm font-medium text-heading transition-colors hover:bg-gray-50 focus-visible:shadow-focus aria-disabled:cursor-not-allowed aria-disabled:bg-gray-100 aria-disabled:text-gray-400"
            >
              <img
                src="/branding/google-logo.svg"
                alt=""
                aria-hidden="true"
                className="h-4 w-4 shrink-0 object-contain"
              />
              使用 Google 登录
            </a>
            {googleMissingKeys.length > 0 ? (
              <p className="text-xs leading-5 text-warning">
                Google 登录尚未配置：{googleMissingKeys.join('、')}。
              </p>
            ) : null}
            {googlePreflight ? (
              <p className="text-xs leading-5 text-warning">{googlePreflight}</p>
            ) : null}
            {googleError ? <p className="text-xs text-warning">{googleError}</p> : null}
            {googleErrorMessage(googleCallbackError) ? (
              <p role="alert" className="text-xs leading-5 text-danger">
                {googleErrorMessage(googleCallbackError)}
              </p>
            ) : null}
          </div>
          <SourceCodeLink className="mt-4 flex justify-center text-gray-500" />
        </div>
      </section>
    </main>
  )
}
