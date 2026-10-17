'use client'

import * as React from 'react'
import QRCode from 'qrcode'
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
import { cn } from '@/lib/utils'
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
import { useImmersionTier } from '@/hooks/use-immersion-tier'

/**
 * 两步验证工作区（`/next/settings/security/two-factor`，v3-ui-next-settings-admin-domains
 * W1 · tasks 1.9，spec「个人两步验证向导」，design D-2FA）。
 *
 * 等价迁移旧轨 `components/settings/TwoFactorSettings.tsx` 的 overview / enrolling /
 * codes 三阶段向导，数据契约 100% 复用 `lib/api/two-factor.ts`
 * （`status/setup/confirm/disable/regenerateRecoveryCodes`），呈现换成新轨暗黑仪器面板：
 *
 * - 三阶段：未启用/已启用总览 → 扫码绑定（`enrolling`）→ 恢复码一次性确认（`codes`）；
 * - 安全约束：恢复码明文**只活组件内存**（不写 localStorage、不进全局 store、不写 URL），
 *   一次性展示 + 复制/下载 + 显式「已保存恢复码」确认后才离开该阶段；二维码 URI 与
 *   绑定密钥仅在绑定会话内回显，离开即丢；关闭 2FA 需输入动态口令，失败回显服务端
 *   错误文案（`twoFactorErrorMessage` 映射），按钮复位允许重试；
 * - 口令输入防抖：动态口令需稳定 300ms 后才允许提交，避免半截口令触发请求；
 * - 本页不提供管理员重置他人 2FA 入口（该能力只在 `/next/admin/users` 高危区，D-2FA）；
 * - 精确档（`precise`）剥离氛围光晕与全部过渡（RL-15）；三态：骨架 / 错误重试 / 内容。
 */

type Stage = 'overview' | 'enrolling' | 'codes'

/** 恢复码视图：明文只在这个阶段的组件状态里存在（不落任何持久化）。 */
interface RecoveryCodesView {
  codes: string[]
  /** 首次启用还是重新生成——两种场景提示语不同。 */
  reason: 'enabled' | 'regenerated'
}

/** 口令输入防抖窗口（ms）：稳定后才允许提交，避免半截口令触发请求。 */
const CODE_DEBOUNCE_MS = 300

export function TwoFactorWorkspace() {
  const tier = useImmersionTier()
  const user = useAuthStore((state) => state.user)
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  const precise = tier === 'precise'

  const [status, setStatus] = React.useState<TwoFactorStatus | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState('')

  const [stage, setStage] = React.useState<Stage>('overview')
  const [enrollment, setEnrollment] = React.useState<TwoFactorEnrollment | null>(null)
  const [recoveryView, setRecoveryView] = React.useState<RecoveryCodesView | null>(null)
  const [rebinding, setRebinding] = React.useState(false)

  const [pendingAction, setPendingAction] = React.useState<
    'setup' | 'confirm' | 'disable' | 'regenerate' | 'rebind' | null
  >(null)
  const [actionError, setActionError] = React.useState('')
  const [openPrompt, setOpenPrompt] = React.useState<'disable' | 'regenerate' | 'rebind' | null>(
    null,
  )

  const accountLabel = user?.email ?? '当前账号'

  const refresh = React.useCallback(async () => {
    try {
      setStatus(await twoFactorApi.status())
      setLoadError('')
    } catch {
      setLoadError('无法读取两步验证状态，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    // 会话水合前不发起状态请求：未恢复的会话态发请求只会拿到 401 并把用户误判成
    // 「加载失败」；水合后（含已登录判定）再取，与骨架屏语义一致。
    if (!hasHydrated) return
    void refresh()
  }, [hasHydrated, refresh])

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

  /** 更换认证器：先出示当前第二因子，服务端才生成新密钥（防会话被盗即换绑）。 */
  async function startRebind(code: string, password?: string) {
    setPendingAction('rebind')
    setActionError('')
    try {
      setEnrollment(await twoFactorApi.setup({ currentCode: code, password }))
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
      // 明文密钥使命结束，立刻从内存丢掉。
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

  if (!hasHydrated || loading) {
    return <TwoFactorSkeleton precise={precise} />
  }

  if (loadError) {
    return (
      <div
        data-two-factor-error
        role="alert"
        className={cn(
          'flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] p-8 text-center',
          precise ? 'bg-[var(--nx-workspace-bg)]' : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
        )}
      >
        <AlertCircle className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
          两步验证状态加载失败
        </h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">{loadError}</p>
        <button
          type="button"
          data-two-factor-retry
          onClick={() => {
            setLoading(true)
            void refresh()
          }}
          className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          重新载入
        </button>
      </div>
    )
  }

  return (
    <div
      data-two-factor-workspace
      data-stage={stage}
      data-immersion={tier}
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        precise ? 'bg-[var(--nx-workspace-bg)]' : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <ShieldCheck className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1
              data-two-factor-title
              className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              两步验证
            </h1>
            <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
              为 {accountLabel} 增加一道登录验证 · 本人账户能力
            </p>
          </div>
        </div>
      </header>

      {/* 阶段三：恢复码（仅此一次可见） */}
      {stage === 'codes' && recoveryView ? (
        <RecoveryCodesPanel
          view={recoveryView}
          accountLabel={accountLabel}
          precise={precise}
          onAcknowledge={() => {
            setRecoveryView(null)
            setStage('overview')
            void refresh()
          }}
        />
      ) : null}

      {/* 阶段二：扫码绑定并确认 */}
      {stage === 'enrolling' && enrollment ? (
        <section
          data-two-factor-enrolling
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
        >
          <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--nx-text-primary)]">
            <Smartphone className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            绑定认证器
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
            用 Google Authenticator、1Password、Microsoft Authenticator 等任意兼容 TOTP
            的应用扫描二维码，或手工录入下方密钥。
          </p>

          <AuthenticatorQrPanel enrollment={enrollment} precise={precise} />

          {rebinding ? (
            <p
              data-two-factor-rebind-notice
              className="mt-3 rounded border border-[var(--nx-status-warning)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs leading-relaxed text-[var(--nx-status-warning)]"
            >
              旧认证器在你确认新验证码之前仍然有效；确认成功后立即失效，并会发给你一组新的恢复码。
            </p>
          ) : null}

          <div className="mt-4">
            <CodePrompt
              id="next-two-factor-confirm"
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
              precise={precise}
              onSubmit={({ code }) => void confirmSetup(code)}
              onCancel={() => {
                setEnrollment(null)
                setRebinding(false)
                setActionError('')
                setStage('overview')
                void refresh()
              }}
            />
          </div>
        </section>
      ) : null}

      {/* 阶段一：常态总览 */}
      {stage === 'overview' ? (
        <TwoFactorOverview
          status={status}
          pendingAction={pendingAction}
          actionError={actionError}
          openPrompt={openPrompt}
          precise={precise}
          onStartSetup={() => void startSetup()}
          onOpenPrompt={(prompt) => {
            setActionError('')
            setOpenPrompt(openPrompt === prompt ? null : prompt)
          }}
          onDisable={(code, password) => void disable(code, password)}
          onRegenerate={(code) => void regenerate(code)}
          onRebind={(code, password) => void startRebind(code, password)}
        />
      ) : null}
    </div>
  )
}

/** 总览阶段：状态卡 + 动作按钮 + 展开的口令确认卡。 */
function TwoFactorOverview({
  status,
  pendingAction,
  actionError,
  openPrompt,
  precise,
  onStartSetup,
  onOpenPrompt,
  onDisable,
  onRegenerate,
  onRebind,
}: {
  status: TwoFactorStatus | null
  pendingAction: string | null
  actionError: string
  openPrompt: 'disable' | 'regenerate' | 'rebind' | null
  precise: boolean
  onStartSetup: () => void
  onOpenPrompt: (prompt: 'disable' | 'regenerate' | 'rebind') => void
  onDisable: (code: string, password?: string) => void
  onRegenerate: (code: string) => void
  onRebind: (code: string, password?: string) => void
}) {
  const enabled = status?.enabled ?? false
  const lowRecoveryCodes = enabled && (status?.recoveryCodesRemaining ?? 0) <= 2

  return (
    <section
      data-two-factor-overview
      data-enabled={enabled ? 'true' : 'false'}
      className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--nx-text-primary)]">
          {enabled ? (
            <ShieldCheck className="h-4 w-4 text-[var(--nx-status-success)]" aria-hidden />
          ) : (
            <ShieldOff className="h-4 w-4 text-[var(--nx-text-muted)]" aria-hidden />
          )}
          认证器应用（TOTP）
        </h2>
        <span
          data-two-factor-state-badge
          data-state={status?.state ?? 'disabled'}
          className={cn(
            'shrink-0 rounded border px-2 py-0.5 text-[10px] leading-none',
            enabled
              ? 'border-[var(--nx-status-success)] text-[var(--nx-status-success)]'
              : status?.state === 'needs_reenrollment'
                ? 'border-[var(--nx-status-warning)] text-[var(--nx-status-warning)]'
                : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
          )}
        >
          {twoFactorStateLabel(status?.state)}
        </span>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
        登录时除密码外再输入认证器生成的一次性验证码。即使密码泄露，攻击者也无法登录。
      </p>

      {enabled ? (
        <dl data-two-factor-metadata className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] text-[var(--nx-text-muted)]">启用时间</dt>
            <dd className="text-xs text-[var(--nx-text-primary)]">
              {status?.confirmedAt ? new Date(status.confirmedAt).toLocaleString('zh-CN') : '——'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-[var(--nx-text-muted)]">最近使用</dt>
            <dd className="text-xs text-[var(--nx-text-primary)]">
              {status?.lastUsedAt ? new Date(status.lastUsedAt).toLocaleString('zh-CN') : '——'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-[var(--nx-text-muted)]">剩余恢复码</dt>
            <dd
              data-two-factor-recovery-remaining
              className={cn(
                'text-xs',
                lowRecoveryCodes
                  ? 'font-medium text-[var(--nx-status-warning)]'
                  : 'text-[var(--nx-text-primary)]',
              )}
            >
              {status?.recoveryCodesRemaining ?? 0} 条
            </dd>
          </div>
        </dl>
      ) : (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
          <li>在手机上安装任意兼容 TOTP 的认证器应用；</li>
          <li>扫描二维码完成绑定；</li>
          <li>保存一组恢复码，用于认证器丢失时登录。</li>
        </ol>
      )}

      {status?.pending ? (
        <p
          data-two-factor-pending-notice
          className="mt-3 rounded border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs leading-relaxed text-[var(--nx-text-secondary)]"
        >
          上次设置未完成。重新开始会生成新的密钥，此前扫过的二维码将失效。
        </p>
      ) : null}

      {status?.state === 'needs_reenrollment' ? (
        <p
          data-two-factor-reenrollment-notice
          className="mt-3 flex items-start gap-2 rounded border border-[var(--nx-status-warning)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs leading-relaxed text-[var(--nx-status-warning)]"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            检测到此前的认证器绑定已失效，系统已自动解除，账号当前只靠密码保护。请重新扫码绑定。
          </span>
        </p>
      ) : null}

      {lowRecoveryCodes ? (
        <p
          data-two-factor-low-codes-notice
          className="mt-3 flex items-start gap-2 rounded border border-[var(--nx-status-warning)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs leading-relaxed text-[var(--nx-status-warning)]"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>恢复码即将用尽。请重新生成一组，否则认证器丢失后将无法自助登录。</span>
        </p>
      ) : null}

      {actionError && openPrompt === null ? (
        <p
          data-two-factor-action-error
          role="alert"
          className="mt-3 rounded border border-[var(--nx-status-danger)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs leading-relaxed text-[var(--nx-status-danger)]"
        >
          {actionError}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {enabled ? (
          <>
            <button
              type="button"
              data-two-factor-rebind-button
              onClick={() => onOpenPrompt('rebind')}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)]',
                'hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                !precise && 'transition-colors',
              )}
            >
              <Smartphone className="h-3.5 w-3.5" aria-hidden />
              更换认证器（扫新二维码）
            </button>
            <button
              type="button"
              data-two-factor-regenerate-button
              onClick={() => onOpenPrompt('regenerate')}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)]',
                'hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                !precise && 'transition-colors',
              )}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              重新生成恢复码
            </button>
            <button
              type="button"
              data-two-factor-disable-button
              onClick={() => onOpenPrompt('disable')}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-status-danger)]',
                'hover:border-[var(--nx-status-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                !precise && 'transition-colors',
              )}
            >
              关闭两步验证
            </button>
          </>
        ) : (
          <button
            type="button"
            data-two-factor-setup-button
            onClick={onStartSetup}
            disabled={pendingAction !== null}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)]',
              'hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
              'disabled:opacity-50',
              !precise && 'transition-colors',
            )}
          >
            {pendingAction === 'setup' ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            )}
            {status?.pending ? '继续设置' : '开始设置'}
          </button>
        )}
      </div>

      {openPrompt === 'rebind' ? (
        <PromptCard
          title="更换认证器"
          description="换新手机或重装了认证器 App 时用这个：验证身份后会给出一张全新的二维码，扫码并确认后旧认证器立即失效，同时发一组新的恢复码。"
          precise={precise}
        >
          <CodePrompt
            id="next-two-factor-rebind"
            withPassword
            label="当前认证器的验证码或恢复码"
            hint="这一步是授权：仅仅拿到登录会话，不足以把你的第二因子换到别的设备上。"
            submitLabel="验证并生成新二维码"
            pending={pendingAction === 'rebind'}
            error={actionError}
            precise={precise}
            onSubmit={({ code, password }) => onRebind(code, password)}
            onCancel={() => onOpenPrompt('rebind')}
          />
        </PromptCard>
      ) : null}

      {openPrompt === 'regenerate' ? (
        <PromptCard
          title="重新生成恢复码"
          description="生成新的一组恢复码，当前全部恢复码会立即失效。需要先验证身份。"
          precise={precise}
        >
          <CodePrompt
            id="next-two-factor-regenerate"
            label="验证码或恢复码"
            hint="输入认证器当前显示的验证码；认证器不可用时也可用一条尚未使用的恢复码。"
            submitLabel="生成新恢复码"
            pending={pendingAction === 'regenerate'}
            error={actionError}
            precise={precise}
            onSubmit={({ code }) => onRegenerate(code)}
            onCancel={() => onOpenPrompt('regenerate')}
          />
        </PromptCard>
      ) : null}

      {openPrompt === 'disable' ? (
        <PromptCard
          title="关闭两步验证"
          description="关闭后账号将只靠密码保护，恢复码也会一并删除。需要先验证身份。"
          precise={precise}
        >
          <CodePrompt
            id="next-two-factor-disable"
            withPassword
            label="验证码或恢复码"
            hint="这一步刻意要求第二因子：仅仅拿到登录会话，不足以摘掉你的两步验证。"
            submitLabel="确认关闭"
            submitVariant="danger"
            pending={pendingAction === 'disable'}
            error={actionError}
            precise={precise}
            onSubmit={({ code, password }) => onDisable(code, password)}
            onCancel={() => onOpenPrompt('disable')}
          />
        </PromptCard>
      ) : null}
    </section>
  )
}

function PromptCard({
  title,
  description,
  precise,
  children,
}: {
  title: string
  description: string
  precise: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'mt-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3.5',
        !precise && 'transition-colors',
      )}
    >
      <h3 className="text-xs font-medium text-[var(--nx-text-primary)]">{title}</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">{description}</p>
      <div className="mt-3">{children}</div>
    </div>
  )
}

/**
 * 一次性口令输入（确认 / 关闭 / 重置 / 换绑四处复用）：
 * 带 300ms 防抖——口令需稳定一段时间后才允许提交，避免半截口令触发请求。
 */
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
  precise,
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
  precise: boolean
}) {
  const [code, setCode] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [settled, setSettled] = React.useState(false)

  // 防抖：输入变化后重置稳定标记，静置 CODE_DEBOUNCE_MS 才放行提交。
  React.useEffect(() => {
    setSettled(false)
    const timer = window.setTimeout(() => setSettled(true), CODE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [code, password])

  const incomplete = code.trim().length === 0 || (withPassword && password.length === 0)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || incomplete || !settled) return
    onSubmit({ code: code.trim(), password: withPassword ? password : undefined })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      {withPassword ? (
        <div className="space-y-1">
          <label
            htmlFor={`${id}-password`}
            className="block text-[11px] text-[var(--nx-text-muted)]"
          >
            当前账号密码
          </label>
          <input
            id={`${id}-password`}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={`${id}-password-hint`}
            className="h-9 w-full max-w-xs rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-sm text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          />
          <p
            id={`${id}-password-hint`}
            className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
          >
            变更第二因子属于高风险操作，需要同时出示密码与当前验证码。使用 Google / 企业 SSO
            登录的账号无需填写。
          </p>
        </div>
      ) : null}

      <div className="space-y-1">
        <label htmlFor={id} className="block text-[11px] text-[var(--nx-text-muted)]">
          {label}
        </label>
        <input
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
          className="h-9 w-full max-w-xs rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 font-mono tracking-[0.15em] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        />
        <p id={`${id}-hint`} className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
          {hint}
        </p>
      </div>

      {error ? (
        <p
          data-two-factor-prompt-error
          role="alert"
          className="rounded border border-[var(--nx-status-danger)] bg-[var(--nx-bg-1)] px-3 py-2 text-xs text-[var(--nx-status-danger)]"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          data-two-factor-prompt-submit={id}
          disabled={pending || incomplete || !settled}
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-md border px-4 text-xs font-medium',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:opacity-50',
            submitVariant === 'danger'
              ? 'border-[var(--nx-status-danger)] bg-[var(--nx-bg-1)] text-[var(--nx-status-danger)]'
              : 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)]',
            !precise && 'transition-colors',
          )}
        >
          {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex h-9 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 text-xs text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            取消
          </button>
        ) : null}
      </div>
    </form>
  )
}

/** 恢复码清单：仅此一次可见，提供复制与下载，并由用户显式确认已保存。 */
function RecoveryCodesPanel({
  view,
  accountLabel,
  precise,
  onAcknowledge,
}: {
  view: RecoveryCodesView
  accountLabel: string
  precise: boolean
  onAcknowledge: () => void
}) {
  const [acknowledged, setAcknowledged] = React.useState(false)
  const plainText = formatRecoveryCodesForDownload(view.codes, accountLabel)

  function download() {
    // 浏览器内生成 Blob 下载：恢复码不经过任何网络请求就落到本地文件。
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
    <section
      data-two-factor-recovery-codes
      className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--nx-text-primary)]">
        <KeyRound className="h-4 w-4 text-[var(--nx-status-warning)]" aria-hidden />
        保存你的恢复码
      </h2>
      <p
        data-two-factor-recovery-notice
        className="mt-2 rounded border border-[var(--nx-status-warning)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs leading-relaxed text-[var(--nx-status-warning)]"
      >
        {view.reason === 'enabled' ? '两步验证已启用。' : '恢复码已重新生成，旧码立即失效。'} 以下{' '}
        {view.codes.length} 条恢复码只显示这一次，离开本页后无法再次查看。请离线保存，
        在认证器丢失时用它们登录；每条只能使用一次。
      </p>

      <ul
        data-two-factor-recovery-list
        className="mt-3 grid grid-cols-1 gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3 sm:grid-cols-2"
      >
        {view.codes.map((code) => (
          <li
            key={code}
            className="font-mono text-xs tracking-[0.08em] text-[var(--nx-text-primary)]"
          >
            {code}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          data-two-factor-recovery-download
          onClick={download}
          className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          下载为 .txt
        </button>
        <CopyRecoveryCodesButton value={view.codes.join('\n')} />
      </div>

      <label className="mt-3 flex items-start gap-2 text-xs text-[var(--nx-text-secondary)]">
        <input
          type="checkbox"
          data-two-factor-recovery-ack
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-[var(--nx-border-hairline)]"
        />
        我已把恢复码保存到安全的地方（离开本页后无法再次查看）。
      </label>

      <button
        type="button"
        data-two-factor-recovery-done
        onClick={onAcknowledge}
        disabled={!acknowledged}
        className={cn(
          'mt-3 flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:opacity-50',
          !precise && 'transition-colors',
        )}
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
        已保存恢复码
      </button>
    </section>
  )
}

/** 复制全部恢复码（明文只经剪贴板，不落任何持久化）。 */
function CopyRecoveryCodesButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <button
      type="button"
      data-two-factor-recovery-copy
      aria-label="复制全部恢复码"
      onClick={() => {
        void copyTextToClipboard(value).then((ok) => {
          if (!ok) return
          setCopied(true)
          window.setTimeout(() => setCopied(false), 2000)
        })
      }}
      className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      {copied ? '已复制' : '复制全部'}
    </button>
  )
}

/**
 * 绑定二维码面板（新轨呈现）：二维码 + 可手工录入的 Base32 密钥。
 *
 * 二维码里装的是共享密钥种子，只在绑定会话内出现；组件卸载即从内存丢弃
 * （`useEffect` 清理 + 无任何持久化写入）。
 */
function AuthenticatorQrPanel({
  enrollment,
  precise,
}: {
  enrollment: TwoFactorEnrollment
  precise: boolean
}) {
  const [qrSrc, setQrSrc] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(enrollment.otpauthUri, {
      width: 180,
      margin: 1,
      // 二维码要在浅色卡片上被手机稳定识别，固定黑白而不跟随主题变量。
      color: { dark: '#111827', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrSrc(url)
      })
      .catch(() => {
        // 渲染失败不阻断流程：始终提供可手工录入的密钥。
        if (!cancelled) setQrSrc(null)
      })
    return () => {
      cancelled = true
    }
  }, [enrollment.otpauthUri])

  return (
    <div data-two-factor-qr className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
      <div
        className={cn(
          'flex h-[204px] w-[204px] shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-white p-3',
          !precise && 'transition-colors',
        )}
      >
        {qrSrc ? (
          <img src={qrSrc} alt="两步验证配置二维码" width={180} height={180} />
        ) : (
          <span className="px-2 text-center text-[11px] text-gray-500">
            二维码不可用，请用右侧密钥手工录入
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
          <li>在手机上打开认证器 App（Google Authenticator、1Password 等）。</li>
          <li>扫描左侧二维码，App 里会出现一条每 30 秒刷新的 6 位验证码。</li>
          <li>把当前显示的验证码填到下方完成绑定。</li>
        </ol>
        <div>
          <p className="text-[11px] text-[var(--nx-text-muted)]">无法扫码？手工输入密钥</p>
          <code
            data-two-factor-secret
            className="mt-1 inline-block break-all rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1 font-mono text-xs tracking-[0.08em] text-[var(--nx-text-primary)]"
          >
            {enrollment.secret}
          </code>
        </div>
        <dl className="flex flex-wrap gap-3 text-[11px] text-[var(--nx-text-muted)]">
          <div className="flex gap-1">
            <dt>算法</dt>
            <dd className="font-mono text-[var(--nx-text-secondary)]">{enrollment.algorithm}</dd>
          </div>
          <div className="flex gap-1">
            <dt>位数</dt>
            <dd className="font-mono text-[var(--nx-text-secondary)]">{enrollment.digits}</dd>
          </div>
          <div className="flex gap-1">
            <dt>周期</dt>
            <dd className="font-mono text-[var(--nx-text-secondary)]">{enrollment.period}s</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

/** 三态之骨架：读取状态期间的高密度占位（`aria-busy`，零写请求）。 */
function TwoFactorSkeleton({ precise }: { precise: boolean }) {
  return (
    <div
      data-two-factor-skeleton
      role="status"
      aria-label="正在加载两步验证状态"
      aria-busy="true"
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        precise ? 'bg-[var(--nx-workspace-bg)]' : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      <div className="h-9 w-56 rounded-md bg-[var(--nx-bg-1)]" aria-hidden />
      <div
        className="h-40 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
        aria-hidden
      />
      <div
        className="h-12 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
        aria-hidden
      />
    </div>
  )
}

export default TwoFactorWorkspace
