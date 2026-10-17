'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Download,
  LoaderCircle,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import { authApi } from '@/lib/api/auth'
import {
  formatRecoveryCodesForDownload,
  twoFactorErrorMessage,
  type TwoFactorEnrollment,
  type TwoFactorMethod,
} from '@/lib/api/two-factor'
import { AuthenticatorQrPanel } from '@/components/auth/AuthenticatorQrPanel'
import type { AuthSession, TwoFactorChallengePurpose } from '@/lib/api/auth'

/** 登录页第二因子挑战（由 LoginForm 在拿到挑战票据后渲染）。 */
export interface PendingTwoFactorChallenge {
  challengeToken: string
  expiresAt: string
  purpose: TwoFactorChallengePurpose
  skippable?: boolean
  methods: TwoFactorMethod[]
}

/** 把剩余毫秒渲染成 `m:ss`。 */
function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * 登录第二步。两种形态（与服务端 challenge.purpose 一一对应）：
 *
 * - `verify`（账号已绑定）：直接输认证器当前显示的 6 位验证码；
 * - `enroll`（账号尚未绑定）：**先给二维码**，用户用认证器 App 扫码拿到一次性验证码，
 *   再填回来完成绑定并登录——即 Auth0/Okta Universal Login 的 enrollment-at-login。
 *   绑定成功会同时下发一次性恢复码，必须先让用户保存再进入应用。
 *
 * 本组件只持有挑战票据，不接触密码，也拿不到任何会话凭证——兑换成功后把 session
 * 交给上层写入 store。挑战过期或尝试次数用尽时唯一出路是回密码步重来。
 */
export function TwoFactorChallengeForm({
  challenge,
  onAuthenticated,
  onCancel,
}: {
  challenge: PendingTwoFactorChallenge
  onAuthenticated: (session: AuthSession) => void | Promise<void>
  onCancel: () => void
}) {
  const enrolling = challenge.purpose === 'enroll'

  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [enrollment, setEnrollment] = useState<TwoFactorEnrollment | null>(null)
  const [enrollmentLoading, setEnrollmentLoading] = useState(enrolling)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [savedAcknowledged, setSavedAcknowledged] = useState(false)
  const [pendingSession, setPendingSession] = useState<AuthSession | null>(null)
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, new Date(challenge.expiresAt).getTime() - Date.now()),
  )
  const inputRef = useRef<HTMLInputElement>(null)

  // 绑定阶段还没有恢复码可用，只认刚扫进认证器的一次性口令。
  const recoveryAvailable = !enrolling && challenge.methods.includes('recovery_code')
  const expired = remainingMs <= 0

  // 拿到票据后立刻换取该次绑定的二维码内容（密钥只走 POST body，不进 URL）。
  useEffect(() => {
    if (!enrolling) return
    let cancelled = false
    setEnrollmentLoading(true)
    authApi
      .loginTwoFactorEnrollment(challenge.challengeToken)
      .then((result) => {
        if (!cancelled) setEnrollment(result)
      })
      .catch((reason) => {
        if (!cancelled) setError(twoFactorErrorMessage(reason))
      })
      .finally(() => {
        if (!cancelled) setEnrollmentLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enrolling, challenge.challengeToken])

  // 挑战有 5 分钟硬期限，倒数到 0 就明确告知已失效，而不是让用户对着一个
  // 注定失败的输入框反复尝试。
  useEffect(() => {
    const expiresAtMs = new Date(challenge.expiresAt).getTime()
    const timer = window.setInterval(() => {
      setRemainingMs(Math.max(0, expiresAtMs - Date.now()))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [challenge.expiresAt])

  // 切换输入方式后清空并聚焦：两种码格式完全不同，留着上一次的残值只会误导。
  useEffect(() => {
    setCode('')
    setError('')
    inputRef.current?.focus()
  }, [useRecoveryCode])

  const finish = useCallback(
    async (session: AuthSession) => {
      await onAuthenticated(session)
    },
    [onAuthenticated],
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || expired) return
    setSubmitting(true)
    setError('')
    try {
      const result = await authApi.loginTwoFactor({
        challengeToken: challenge.challengeToken,
        code: code.trim(),
      })
      const { recoveryCodes: issued, ...session } = result
      if (issued && issued.length > 0) {
        // 首次绑定成功：恢复码只此一次可见，必须先让用户保存再进应用。
        setRecoveryCodes(issued)
        setPendingSession(session)
        return
      }
      await finish(session)
    } catch (reason) {
      setError(twoFactorErrorMessage(reason))
      setCode('')
      inputRef.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  async function skip() {
    if (skipping) return
    setSkipping(true)
    setError('')
    try {
      await finish(await authApi.loginTwoFactorSkip(challenge.challengeToken))
    } catch (reason) {
      setError(twoFactorErrorMessage(reason))
    } finally {
      setSkipping(false)
    }
  }

  function downloadRecoveryCodes() {
    if (!recoveryCodes) return
    const blob = new Blob([formatRecoveryCodesForDownload(recoveryCodes, '你的账号')], {
      type: 'text/plain;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'aiproj-recovery-codes.txt'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    setSavedAcknowledged(true)
  }

  // —— 绑定成功后的恢复码交接（进入应用前的最后一道）——
  if (recoveryCodes && pendingSession) {
    return (
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <div className="mb-3 flex items-center gap-2 text-success">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            <span className="text-sm font-medium">两步验证已启用</span>
          </div>
          <h2 className="text-balance text-2xl font-semibold tracking-[-0.02em] text-heading">
            保存你的恢复码
          </h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            这 {recoveryCodes.length} 条恢复码
            <strong className="font-semibold">只显示这一次</strong>
            。认证器丢失时用它们登录，每条只能用一次。
          </p>
        </div>

        <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-[var(--radius-md)] border border-border bg-gray-50 p-3">
          {recoveryCodes.map((value) => (
            <li key={value} className="font-mono text-xs tracking-[0.04em] text-gray-800">
              {value}
            </li>
          ))}
        </ul>

        <div className="mt-4 space-y-4">
          <button
            type="button"
            onClick={downloadRecoveryCodes}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border-strong bg-background px-4 text-sm font-medium text-heading transition-colors hover:bg-gray-50 focus-visible:shadow-focus"
          >
            <Download className="h-4 w-4" aria-hidden />
            下载为 .txt
          </button>

          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={savedAcknowledged}
              onChange={(event) => setSavedAcknowledged(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary-600 focus-visible:shadow-focus"
            />
            我已把恢复码保存到安全的地方。
          </label>

          <button
            type="button"
            disabled={!savedAcknowledged}
            onClick={() => void finish(pendingSession)}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus-visible:shadow-focus disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            进入工作台
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={enrolling ? 'w-full max-w-xl' : 'w-full max-w-sm'}>
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-primary-700">
          {enrolling ? (
            <Smartphone className="h-4 w-4" aria-hidden />
          ) : (
            <ShieldCheck className="h-4 w-4" aria-hidden />
          )}
          <span className="text-sm font-medium">{enrolling ? '设置两步验证' : '两步验证'}</span>
        </div>
        <h2 className="text-balance text-2xl font-semibold tracking-[-0.02em] text-heading">
          {enrolling ? '扫码绑定你的认证器' : '再确认一次是你本人'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          {enrolling
            ? '用认证器 App 扫描下方二维码，然后填入 App 显示的 6 位验证码完成绑定。'
            : useRecoveryCode
              ? '输入一条此前保存的恢复码。每条恢复码只能使用一次。'
              : '打开认证器 App，输入当前显示的 6 位验证码。'}
        </p>
      </div>

      {enrolling ? (
        <div className="mb-6 rounded-[var(--radius-md)] border border-border bg-surface p-4">
          <AuthenticatorQrPanel enrollment={enrollment} loading={enrollmentLoading} size={176} />
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-5" noValidate>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-700">
            {useRecoveryCode ? '恢复码' : '验证码'}
          </span>
          <input
            ref={inputRef}
            name={useRecoveryCode ? 'recoveryCode' : 'totpCode'}
            type="text"
            // 一次性口令用 one-time-code，移动端会从系统建议里补全；
            // 恢复码不是一次性口令，用 off 避免错误的自动填充。
            autoComplete={useRecoveryCode ? 'off' : 'one-time-code'}
            inputMode={useRecoveryCode ? 'text' : 'numeric'}
            maxLength={useRecoveryCode ? 24 : 6}
            required
            autoFocus={!enrolling}
            disabled={expired}
            value={code}
            onChange={(event) =>
              setCode(
                useRecoveryCode
                  ? event.target.value.toUpperCase()
                  : // 只留数字：用户从认证器复制时常带空格
                    event.target.value.replace(/\D/g, ''),
              )
            }
            aria-describedby="two-factor-help"
            className={[
              'h-11 w-full rounded-md border border-border-strong bg-background px-3 text-heading shadow-xs transition-colors focus:border-primary-500 focus:shadow-focus disabled:cursor-not-allowed disabled:bg-gray-100',
              useRecoveryCode
                ? 'font-mono text-base tracking-[0.1em]'
                : 'text-center font-mono text-xl tracking-[0.5em]',
            ].join(' ')}
            placeholder={useRecoveryCode ? 'XXXX-XXXX-XXXX-XXXX' : '000000'}
          />
        </label>

        <p id="two-factor-help" className="text-xs leading-5 text-gray-500">
          {expired ? (
            <span className="text-warning">本次验证已超时，请返回重新登录。</span>
          ) : (
            <>本次验证剩余有效时间 {formatRemaining(remainingMs)}。</>
          )}
        </p>

        {error ? (
          <div role="alert" className="rounded-md bg-danger-bg px-3 py-2.5 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting || expired || code.trim().length === 0}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus-visible:shadow-focus disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {submitting ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              正在验证…
            </>
          ) : (
            <>
              {enrolling ? '绑定并登录' : '验证并登录'}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </>
          )}
        </button>
      </form>

      <div className="mt-6 space-y-3 border-t border-border pt-5">
        {enrolling ? (
          challenge.skippable ? (
            <button
              type="button"
              onClick={() => void skip()}
              disabled={skipping || expired}
              className="text-sm font-medium text-gray-600 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:shadow-focus disabled:cursor-not-allowed disabled:text-gray-400"
            >
              {skipping ? '正在跳过…' : '暂时跳过，下次再设置'}
            </button>
          ) : (
            <p className="text-xs leading-5 text-gray-500">
              本站点要求所有账号完成两步验证绑定后才能登录。
            </p>
          )
        ) : recoveryAvailable ? (
          <button
            type="button"
            onClick={() => setUseRecoveryCode((previous) => !previous)}
            className="text-sm font-medium text-primary-700 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:shadow-focus"
          >
            {useRecoveryCode ? '改用认证器验证码' : '认证器不可用？改用恢复码'}
          </button>
        ) : (
          <p className="text-xs leading-5 text-gray-500">
            该账号没有可用的恢复码。若认证器已丢失，请联系管理员协助恢复账号。
          </p>
        )}

        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 text-sm text-gray-600 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:shadow-focus"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          返回重新登录
        </button>
      </div>
    </div>
  )
}
