'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from 'lucide-react'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import {
  formatRecoveryCodesForDownload,
  twoFactorApi,
  twoFactorErrorMessage,
  twoFactorStateLabel,
  type TwoFactorEnrollment,
  type TwoFactorStatus,
} from '@/lib/api/two-factor'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useAuthStore } from '@/stores/auth-store'
import { AuthenticatorQrPanel } from '@/components/auth/AuthenticatorQrPanel'

/**
 * 向导阶段。
 * - `overview`：已启用 / 未启用的常态；
 * - `enrolling`：已生成待确认密钥，等待用户扫码并输入验证码；
 * - `codes`：刚拿到恢复码，**只有这一次**能看到明文，必须显式确认已保存。
 */
type Stage = 'overview' | 'enrolling' | 'codes'

/** 恢复码明文只活在这个阶段的组件状态里：不写 localStorage、不进任何全局 store。 */
interface RecoveryCodesView {
  codes: string[]
  /** 是重新生成还是首次启用——两种场景的提示语不同。 */
  reason: 'enabled' | 'regenerated'
}

/** 复制按钮：复制成功后短暂显示对勾。 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      onClick={() => {
        void copyTextToClipboard(value).then((ok) => {
          if (!ok) return
          setCopied(true)
          window.setTimeout(() => setCopied(false), 2000)
        })
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      {copied ? '已复制' : '复制'}
    </Button>
  )
}

/** 把一次性口令 / 恢复码输入收敛到一个受控小表单，供确认、关闭、重置三处复用。 */
function CodePrompt({
  id,
  label,
  hint,
  submitLabel,
  submitVariant = 'primary',
  pending,
  error,
  onSubmit,
  onCancel,
  allowRecoveryCode = true,
  withPassword = false,
}: {
  id: string
  label: string
  hint: string
  submitLabel: string
  submitVariant?: 'primary' | 'danger'
  pending: boolean
  error: string
  onSubmit: (input: { code: string; password?: string }) => void
  onCancel?: () => void
  allowRecoveryCode?: boolean
  /** 高风险动作（更换认证器 / 关闭 2FA）额外要求密码重认证。 */
  withPassword?: boolean
}) {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')

  const incomplete = code.trim().length === 0 || (withPassword && password.length === 0)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || incomplete) return
    onSubmit({ code: code.trim(), password: withPassword ? password : undefined })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      {withPassword ? (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-password`} className="block text-sm font-medium text-gray-700">
            当前账号密码
          </label>
          <Input
            id={`${id}-password`}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={`${id}-password-hint`}
            className="max-w-xs"
          />
          <p id={`${id}-password-hint`} className="text-xs leading-5 text-gray-500">
            变更第二因子属于高风险操作，需要同时出示密码与当前验证码。 使用 Google / 企业 SSO
            登录的账号无需填写。
          </p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-sm font-medium text-gray-700">
          {label}
        </label>
        <Input
          id={id}
          value={code}
          onChange={(event) =>
            setCode(
              allowRecoveryCode
                ? event.target.value.toUpperCase()
                : event.target.value.replace(/\D/g, ''),
            )
          }
          inputMode={allowRecoveryCode ? 'text' : 'numeric'}
          maxLength={allowRecoveryCode ? 24 : 6}
          autoComplete="one-time-code"
          placeholder={allowRecoveryCode ? '000000 或 XXXX-XXXX-XXXX-XXXX' : '000000'}
          aria-describedby={`${id}-hint`}
          aria-invalid={error.length > 0 || undefined}
          className="max-w-xs font-mono tracking-[0.15em]"
        />
        <p id={`${id}-hint`} className="text-xs leading-5 text-gray-500">
          {hint}
        </p>
      </div>

      {error ? (
        <Alert variant="danger" className="text-sm">
          {error}
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={submitVariant} disabled={pending || incomplete}>
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            取消
          </Button>
        ) : null}
      </div>
    </form>
  )
}

/** 恢复码清单：仅此一次可见，提供复制与下载。 */
function RecoveryCodesPanel({
  view,
  accountLabel,
  onAcknowledge,
}: {
  view: RecoveryCodesView
  accountLabel: string
  onAcknowledge: () => void
}) {
  const [acknowledged, setAcknowledged] = useState(false)
  const plainText = formatRecoveryCodesForDownload(view.codes, accountLabel)

  function download() {
    // 浏览器内生成的 Blob 下载：恢复码不经过任何网络请求就落到本地文件。
    const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'aiproj-recovery-codes.txt'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    setAcknowledged(true)
  }

  return (
    <div className="space-y-4">
      <Alert variant="warning">
        <div className="space-y-1">
          <p className="font-medium">
            {view.reason === 'enabled' ? '两步验证已启用。' : '恢复码已重新生成，旧码立即失效。'}
          </p>
          <p className="text-sm leading-6">
            以下 {view.codes.length}{' '}
            条恢复码只显示这一次，关闭后无法再次查看。请离线保存，在认证器丢失时用它们登录。
            每条只能使用一次。
          </p>
        </div>
      </Alert>

      <ul className="grid grid-cols-1 gap-2 rounded-[var(--radius-md)] border border-border bg-gray-50 p-4 sm:grid-cols-2">
        {view.codes.map((code) => (
          <li key={code} className="font-mono text-sm tracking-[0.08em] text-gray-800">
            {code}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={download}>
          <Download className="h-4 w-4" aria-hidden />
          下载为 .txt
        </Button>
        <CopyButton value={view.codes.join('\n')} label="复制全部恢复码" />
      </div>

      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary-600 focus-visible:shadow-focus"
        />
        我已把恢复码保存到安全的地方。
      </label>

      <Button type="button" onClick={onAcknowledge} disabled={!acknowledged}>
        完成
      </Button>
    </div>
  )
}

/**
 * 账号两步验证设置面板（`/settings/security/two-factor`）。
 *
 * 只操作**当前登录用户自己**的 2FA——没有任何按 userId 管理他人的入口。
 * 明文密钥与恢复码只在组件本地 state 里存在，用完即弃：不落 localStorage、
 * 不进 auth store、不写 URL。
 */
export function TwoFactorSettings() {
  const user = useAuthStore((state) => state.user)
  const [status, setStatus] = useState<TwoFactorStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [stage, setStage] = useState<Stage>('overview')
  const [enrollment, setEnrollment] = useState<TwoFactorEnrollment | null>(null)
  const [recoveryView, setRecoveryView] = useState<RecoveryCodesView | null>(null)

  /** 当前的绑定向导是「更换认证器」还是首次绑定——两者提示语与后续动作不同。 */
  const [rebinding, setRebinding] = useState(false)

  const [pendingAction, setPendingAction] = useState<
    'setup' | 'confirm' | 'disable' | 'regenerate' | 'rebind' | null
  >(null)
  const [actionError, setActionError] = useState('')
  const [openPrompt, setOpenPrompt] = useState<'disable' | 'regenerate' | 'rebind' | null>(null)

  const accountLabel = user?.email ?? '当前账号'

  const refresh = useCallback(async () => {
    try {
      setStatus(await twoFactorApi.status())
      setLoadError('')
    } catch {
      setLoadError('无法读取两步验证状态，请刷新页面重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function startSetup() {
    setPendingAction('setup')
    setActionError('')
    try {
      setEnrollment(await twoFactorApi.setup())
      setRebinding(false)
      setStage('enrolling')
    } catch (reason) {
      setActionError(twoFactorErrorMessage(reason))
    } finally {
      setPendingAction(null)
    }
  }

  /**
   * 更换认证器：先用**当前**第二因子授权，服务端才生成新密钥并给出新二维码。
   * 授权这一步不能省——否则被窃取的会话就能把第二因子换到攻击者的手机上。
   */
  async function startRebind(currentCode: string, password?: string) {
    setPendingAction('rebind')
    setActionError('')
    try {
      setEnrollment(await twoFactorApi.setup({ currentCode, password }))
      setRebinding(true)
      setOpenPrompt(null)
      setStage('enrolling')
    } catch (reason) {
      setActionError(twoFactorErrorMessage(reason))
    } finally {
      setPendingAction(null)
    }
  }

  async function confirmSetup(code: string) {
    setPendingAction('confirm')
    setActionError('')
    try {
      const result = await twoFactorApi.confirm(code)
      setStatus(result)
      // 明文密钥的使命到此为止，立刻从内存里丢掉。
      setEnrollment(null)
      setRecoveryView({
        codes: result.recoveryCodes,
        reason: rebinding ? 'regenerated' : 'enabled',
      })
      setRebinding(false)
      setStage('codes')
    } catch (reason) {
      setActionError(twoFactorErrorMessage(reason))
    } finally {
      setPendingAction(null)
    }
  }

  async function disable(code: string, password?: string) {
    setPendingAction('disable')
    setActionError('')
    try {
      setStatus(await twoFactorApi.disable(code, password))
      setOpenPrompt(null)
      setStage('overview')
    } catch (reason) {
      setActionError(twoFactorErrorMessage(reason))
    } finally {
      setPendingAction(null)
    }
  }

  async function regenerate(code: string) {
    setPendingAction('regenerate')
    setActionError('')
    try {
      const result = await twoFactorApi.regenerateRecoveryCodes(code)
      setStatus(result)
      setOpenPrompt(null)
      setRecoveryView({ codes: result.recoveryCodes, reason: 'regenerated' })
      setStage('codes')
    } catch (reason) {
      setActionError(twoFactorErrorMessage(reason))
    } finally {
      setPendingAction(null)
    }
  }

  if (loading) {
    return (
      <Card variant="outlined">
        <CardContent className="flex items-center gap-2 pt-[var(--card-pad)] text-sm text-gray-500">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          正在读取两步验证状态…
        </CardContent>
      </Card>
    )
  }

  if (loadError) {
    return <Alert variant="danger">{loadError}</Alert>
  }

  // —— 阶段三：恢复码（只显示一次）——
  if (stage === 'codes' && recoveryView) {
    return (
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary-500" aria-hidden />
            保存你的恢复码
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RecoveryCodesPanel
            view={recoveryView}
            accountLabel={accountLabel}
            onAcknowledge={() => {
              setRecoveryView(null)
              setStage('overview')
              void refresh()
            }}
          />
        </CardContent>
      </Card>
    )
  }

  // —— 阶段二：扫码并确认 ——
  if (stage === 'enrolling' && enrollment) {
    return (
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary-500" aria-hidden />
            绑定认证器
          </CardTitle>
          <CardDescription>
            用 Google Authenticator、1Password、Microsoft Authenticator 等任意兼容 TOTP
            的应用扫描二维码。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <AuthenticatorQrPanel enrollment={enrollment} />

          {rebinding ? (
            <Alert variant="info">
              旧认证器在你确认新验证码之前仍然有效；确认成功后立即失效，并会发给你一组新的恢复码。
            </Alert>
          ) : null}

          <CodePrompt
            id="two-factor-confirm"
            label="输入认证器显示的 6 位验证码"
            hint={
              rebinding
                ? '填入刚扫出来的那条新认证器条目当前显示的验证码，完成更换。'
                : '验证通过后两步验证立即生效，并会发给你一组恢复码。'
            }
            submitLabel={rebinding ? '确认更换' : '确认并启用'}
            pending={pendingAction === 'confirm'}
            error={actionError}
            allowRecoveryCode={false}
            onSubmit={({ code }) => void confirmSetup(code)}
            onCancel={() => {
              setEnrollment(null)
              setRebinding(false)
              setActionError('')
              setStage('overview')
              void refresh()
            }}
          />
        </CardContent>
      </Card>
    )
  }

  // —— 阶段一：常态总览 ——
  const enabled = status?.enabled ?? false
  const lowRecoveryCodes = enabled && (status?.recoveryCodesRemaining ?? 0) <= 2

  return (
    <div className="space-y-6">
      <Card variant="outlined">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              {enabled ? (
                <ShieldCheck className="h-5 w-5 text-success" aria-hidden />
              ) : (
                <ShieldOff className="h-5 w-5 text-gray-400" aria-hidden />
              )}
              认证器应用（TOTP）
            </CardTitle>
            <Badge
              variant={
                enabled
                  ? 'success'
                  : status?.state === 'needs_reenrollment'
                    ? 'warning'
                    : status?.state === 'pending_setup'
                      ? 'info'
                      : 'neutral'
              }
            >
              {twoFactorStateLabel(status?.state)}
            </Badge>
          </div>
          <CardDescription>
            登录时除密码外再输入认证器生成的一次性验证码。即使密码泄露，攻击者也无法登录。
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {enabled ? (
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-gray-500">启用时间</dt>
                <dd className="text-gray-800">
                  {status?.confirmedAt
                    ? new Date(status.confirmedAt).toLocaleString('zh-CN')
                    : '——'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">最近使用</dt>
                <dd className="text-gray-800">
                  {status?.lastUsedAt ? new Date(status.lastUsedAt).toLocaleString('zh-CN') : '——'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">剩余恢复码</dt>
                <dd className={lowRecoveryCodes ? 'font-medium text-warning' : 'text-gray-800'}>
                  {status?.recoveryCodesRemaining ?? 0} 条
                </dd>
              </div>
            </dl>
          ) : (
            <div className="space-y-2 text-sm leading-6 text-gray-600">
              <p>启用后，你需要：</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>在手机上安装任意兼容 TOTP 的认证器应用；</li>
                <li>扫描二维码完成绑定；</li>
                <li>保存一组恢复码，用于认证器丢失时登录。</li>
              </ol>
              {status?.pending ? (
                <Alert variant="info" className="mt-3">
                  上次设置未完成。重新开始会生成新的密钥，此前扫过的二维码将失效。
                </Alert>
              ) : null}
              {status?.state === 'needs_reenrollment' ? (
                <Alert variant="warning" className="mt-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      检测到此前的认证器绑定已失效，系统已自动解除，账号当前只靠密码保护。
                      请重新扫码绑定。
                    </span>
                  </div>
                </Alert>
              ) : null}
            </div>
          )}

          {lowRecoveryCodes ? (
            <Alert variant="warning">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>恢复码即将用尽。请重新生成一组，否则认证器丢失后将无法自助登录。</span>
              </div>
            </Alert>
          ) : null}

          {actionError && openPrompt === null ? (
            <Alert variant="danger" className="text-sm">
              {actionError}
            </Alert>
          ) : null}

          {enabled ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  setActionError('')
                  setOpenPrompt(openPrompt === 'rebind' ? null : 'rebind')
                }}
              >
                <Smartphone className="h-4 w-4" aria-hidden />
                更换认证器（扫新二维码）
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setActionError('')
                  setOpenPrompt(openPrompt === 'regenerate' ? null : 'regenerate')
                }}
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                重新生成恢复码
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setActionError('')
                  setOpenPrompt(openPrompt === 'disable' ? null : 'disable')
                }}
              >
                关闭两步验证
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              onClick={() => void startSetup()}
              disabled={pendingAction !== null}
            >
              {pendingAction === 'setup' ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ShieldCheck className="h-4 w-4" aria-hidden />
              )}
              {status?.pending ? '继续设置' : '开始设置'}
            </Button>
          )}
        </CardContent>
      </Card>

      {openPrompt === 'rebind' ? (
        <Card variant="outlined">
          <CardHeader>
            <CardTitle className="text-base">更换认证器</CardTitle>
            <CardDescription>
              换新手机或重装了认证器 App 时用这个：验证身份后会给出一张全新的二维码，
              扫码并确认后旧认证器立即失效，同时发一组新的恢复码。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodePrompt
              id="two-factor-rebind"
              withPassword
              label="当前认证器的验证码或恢复码"
              hint="这一步是授权：仅仅拿到登录会话，不足以把你的第二因子换到别的设备上。"
              submitLabel="验证并生成新二维码"
              pending={pendingAction === 'rebind'}
              error={actionError}
              onSubmit={({ code, password }) => void startRebind(code, password)}
              onCancel={() => {
                setOpenPrompt(null)
                setActionError('')
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {openPrompt === 'regenerate' ? (
        <Card variant="outlined">
          <CardHeader>
            <CardTitle className="text-base">重新生成恢复码</CardTitle>
            <CardDescription>
              生成新的一组恢复码，当前全部恢复码会立即失效。需要先验证身份。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodePrompt
              id="two-factor-regenerate"
              label="验证码或恢复码"
              hint="输入认证器当前显示的验证码；认证器不可用时也可用一条尚未使用的恢复码。"
              submitLabel="生成新恢复码"
              pending={pendingAction === 'regenerate'}
              error={actionError}
              onSubmit={({ code }) => void regenerate(code)}
              onCancel={() => {
                setOpenPrompt(null)
                setActionError('')
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {openPrompt === 'disable' ? (
        <Card variant="outlined">
          <CardHeader>
            <CardTitle className="text-base">关闭两步验证</CardTitle>
            <CardDescription>
              关闭后账号将只靠密码保护，恢复码也会一并删除。需要先验证身份。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodePrompt
              id="two-factor-disable"
              withPassword
              label="验证码或恢复码"
              hint="这一步刻意要求第二因子：仅仅拿到登录会话，不足以摘掉你的两步验证。"
              submitLabel="确认关闭"
              submitVariant="danger"
              pending={pendingAction === 'disable'}
              error={actionError}
              onSubmit={({ code, password }) => void disable(code, password)}
              onCancel={() => {
                setOpenPrompt(null)
                setActionError('')
              }}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
