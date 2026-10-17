'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Calendar,
  Code2,
  ExternalLink,
  Info,
  Loader2,
  MessageSquare,
  Plug,
  RefreshCw,
  ShieldAlert,
  Unplug,
} from 'lucide-react'
import { integrationsApi, integrationKeys } from '@/lib/api/integrations'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'
import type { IntegrationProvider, IntegrationProviderDto } from '@aiproj/types'

/**
 * 第三方集成工作区（/next/settings/integrations，
 * v3-ui-next-settings-admin-domains W5 · tasks 5.7，spec「第三方集成与回调契约」）。
 *
 * - 准入 `integration:connect`（RBAC 事实源 `start/rbac/permissions.ts`）：
 *   无权限时渲染受限横幅且底层接口 0 请求（RL-06）；
 * - 诚实披露：当前版本仅校验 OAuth 回调链路，不交换 token，不执行外部数据同步或推送；
 * - Provider 状态列表：GitHub、GitLab、Google Calendar、Slack 等多类目分组；
 * - 连接（authorize / check）与断开（disconnect，强二次确认）；
 * - `focusCategory` 参数高亮聚焦；
 * - 暗黑仪器感 `--nx-*` 令牌，1px 发丝线，精确档（precise）降级，三态闭环。
 */

export interface IntegrationsWorkspaceProps {
  className?: string
  focusCategory?: string
}

const CATEGORY_META: Record<
  string,
  { title: string; description: string; icon: React.ComponentType<{ className?: string }> }
> = {
  code_repository: {
    title: '代码仓库连接',
    description:
      '建立 GitHub 与 GitLab 只读 OAuth 连接，校验回调链路，为后续 Issue/PR/MR 状态流转准备。',
    icon: Code2,
  },
  calendar: {
    title: '日历连接',
    description: '建立 Google Calendar 与 Outlook 日历 OAuth 入口；当前仅校验回调，不交换 token。',
    icon: Calendar,
  },
  message: {
    title: '消息通知',
    description: '准备 Slack、飞书、钉钉第三方通知连接入口；当前不会向外部发送消息。',
    icon: MessageSquare,
  },
}

const STATUS_BADGE: Record<string, { label: string; badgeClass: string; dotClass: string }> = {
  connected: {
    label: '已连接',
    badgeClass:
      'border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.1)] text-[var(--nx-status-success)]',
    dotClass: 'bg-[var(--nx-status-success)]',
  },
  preconnected: {
    label: '预连接完成',
    badgeClass:
      'border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.1)] text-[var(--nx-status-success)]',
    dotClass: 'bg-[var(--nx-status-success)]',
  },
  ready: {
    label: '可连接',
    badgeClass:
      'border-[rgba(56,189,248,0.3)] bg-[rgba(56,189,248,0.1)] text-[var(--nx-space-cyan)]',
    dotClass: 'bg-[var(--nx-space-cyan)]',
  },
  disconnected: {
    label: '未连接',
    badgeClass:
      'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-muted)]',
    dotClass: 'bg-[var(--nx-text-muted)]',
  },
  not_configured: {
    label: '待配置',
    badgeClass:
      'border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.1)] text-[var(--nx-status-warning)]',
    dotClass: 'bg-[var(--nx-status-warning)]',
  },
  disabled: {
    label: '已停用',
    badgeClass:
      'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-muted)]',
    dotClass: 'bg-[var(--nx-text-muted)]',
  },
  needs_reauth: {
    label: '需重连',
    badgeClass:
      'border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.08)] text-[var(--nx-status-danger)]',
    dotClass: 'bg-[var(--nx-status-danger)]',
  },
  check_failed: {
    label: '检查异常',
    badgeClass:
      'border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.1)] text-[var(--nx-status-warning)]',
    dotClass: 'bg-[var(--nx-status-warning)]',
  },
}

export function IntegrationsWorkspace({
  className,
  focusCategory: propFocusCategory,
}: IntegrationsWorkspaceProps) {
  const tier = useImmersionTier()
  const { can } = usePermissions()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  const focusCategory = propFocusCategory ?? searchParams?.get('focusCategory') ?? undefined
  const hasConnectPermission = can('integration:connect')

  // 查询全部集成 Provider 状态
  const listQuery = useQuery({
    queryKey: integrationKeys.list(),
    queryFn: () => integrationsApi.list(),
    enabled: hasConnectPermission,
  })

  // 断开二次确认状态
  const [disconnectTarget, setDisconnectTarget] = React.useState<IntegrationProviderDto | null>(
    null,
  )
  const [disconnectError, setDisconnectError] = React.useState<string | null>(null)

  // 授权与检查状态跟踪
  const [authorizingProvider, setAuthorizingProvider] = React.useState<string | null>(null)
  const [checkingProvider, setCheckingProvider] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  // 断开连接 Mutation
  const disconnectMutation = useMutation({
    mutationFn: (provider: IntegrationProvider) => integrationsApi.disconnect(provider),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationKeys.all })
      setDisconnectTarget(null)
      setDisconnectError(null)
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || '断开连接失败'
      setDisconnectError(msg)
    },
  })

  // 检查状态 Mutation
  const checkMutation = useMutation({
    mutationFn: (provider: IntegrationProvider) => integrationsApi.check(provider),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationKeys.all })
      setCheckingProvider(null)
    },
    onError: (err: unknown) => {
      const msg = (err as { message?: string })?.message || '检查集成状态失败'
      setActionError(msg)
      setCheckingProvider(null)
    },
  })

  // 发起授权流程
  async function handleAuthorize(provider: IntegrationProviderDto) {
    try {
      setAuthorizingProvider(provider.provider)
      setActionError(null)
      const res = await integrationsApi.authorize(provider.provider)
      if (res.authorizationUrl) {
        window.location.href = res.authorizationUrl
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || '发起集成授权失败'
      setActionError(msg)
      setAuthorizingProvider(null)
    }
  }

  function handleCheck(provider: IntegrationProviderDto) {
    setCheckingProvider(provider.provider)
    setActionError(null)
    checkMutation.mutate(provider.provider)
  }

  function handleDisconnectConfirm() {
    if (!disconnectTarget) return
    disconnectMutation.mutate(disconnectTarget.provider)
  }

  // 权限防御（RL-06）：无权限受限横幅且底层 0 请求
  if (!hasConnectPermission) {
    return (
      <div
        data-permission-fallback
        className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
      >
        <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
          没有第三方集成管理权限
        </h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          配置第三方 OAuth 集成连接需要 integration:connect 权限。请联系组织管理员为你授权。
        </p>
      </div>
    )
  }

  const rawList = listQuery.data
  const providers: IntegrationProviderDto[] = Array.isArray(rawList)
    ? rawList
    : rawList &&
        typeof rawList === 'object' &&
        'data' in rawList &&
        Array.isArray((rawList as { data: unknown }).data)
      ? (rawList as { data: IntegrationProviderDto[] }).data
      : []

  // 按 category 分组
  const groupedProviders: Record<string, IntegrationProviderDto[]> = {
    code_repository: [],
    calendar: [],
    message: [],
  }

  providers.forEach((item) => {
    const cat = item.category || 'code_repository'
    if (!groupedProviders[cat]) {
      groupedProviders[cat] = []
    }
    groupedProviders[cat].push(item)
  })

  return (
    <div
      data-integrations-workspace
      data-immersion={tier}
      className={cn('flex flex-col gap-6', className)}
    >
      {/* 头部标题与诚实披露 */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Plug className="h-5 w-5 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">第三方集成</h1>
            <p className="mt-0.5 text-xs text-[var(--nx-text-muted)]">
              管理与 GitHub、GitLab、Google Calendar 等外部服务的 OAuth 预连接。
            </p>
          </div>
        </div>

        <button
          type="button"
          data-testid="refresh-integrations-button"
          onClick={() => void listQuery.refetch()}
          disabled={listQuery.isFetching}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5', listQuery.isFetching && 'animate-spin')}
            aria-hidden
          />
          刷新
        </button>
      </header>

      {/* 诚实披露横幅：对齐旧轨与 spec 规范 */}
      <div
        data-testid="honest-disclosure-banner"
        className="flex items-start gap-3 rounded-lg border border-[rgba(56,189,248,0.3)] bg-[rgba(56,189,248,0.06)] p-3.5 text-xs text-[var(--nx-text-secondary)]"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-accent)]" />
        <div className="leading-relaxed">
          <p className="font-medium text-[var(--nx-text-primary)]">预连接链路说明与安全承诺</p>
          <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
            当前版本仅校验 OAuth 回调链路可用性，
            <strong className="text-[var(--nx-text-primary)] font-semibold">
              绝不交换用户 token
            </strong>
            ，亦不会开始向外部服务推送数据或同步私有事件。
          </p>
        </div>
      </div>

      {actionError ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] p-3 text-xs text-[var(--nx-status-danger)]"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      ) : null}

      {/* 主视图三态 */}
      {listQuery.isLoading ? (
        <div
          data-integrations-skeleton
          aria-busy="true"
          className="flex flex-col gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-6"
        >
          <div className="h-5 w-48 animate-pulse rounded bg-[var(--nx-border-hairline)]" />
          <div className="h-20 w-full animate-pulse rounded bg-[var(--nx-border-hairline)]" />
          <div className="h-20 w-full animate-pulse rounded bg-[var(--nx-border-hairline)]" />
        </div>
      ) : listQuery.isError ? (
        <div
          data-integrations-error
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-12 text-center"
        >
          <ShieldAlert className="h-7 w-7 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">无法载入第三方集成列表</p>
          <button
            type="button"
            data-testid="retry-integrations-button"
            onClick={() => void listQuery.refetch()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新载入
          </button>
        </div>
      ) : providers.length === 0 ? (
        <div
          data-integrations-empty
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-14 text-center"
        >
          <Plug className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-sm font-medium text-[var(--nx-text-secondary)]">暂无可用集成</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            当前环境尚未注册任何第三方集成服务提供商配置。
          </p>
        </div>
      ) : (
        <div data-integrations-list className="flex flex-col gap-6">
          {Object.entries(groupedProviders).map(([catKey, items]) => {
            if (!items || items.length === 0) return null
            const catMeta = CATEGORY_META[catKey] || {
              title: catKey,
              description: '',
              icon: Plug,
            }
            const Icon = catMeta.icon
            const isFocused = focusCategory === catKey

            return (
              <section
                key={catKey}
                data-category-section={catKey}
                data-focus-category={isFocused ? catKey : undefined}
                className={cn(
                  'flex flex-col gap-3 rounded-lg border p-4 transition-all',
                  isFocused
                    ? 'border-[var(--nx-accent)] bg-[rgba(56,189,248,0.03)] ring-1 ring-[var(--nx-accent)] shadow-[0_0_15px_rgba(56,189,248,0.08)]'
                    : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]',
                )}
              >
                <div className="flex items-center gap-2 border-b border-[var(--nx-border-hairline)] pb-2.5">
                  <Icon className="h-4 w-4 text-[var(--nx-accent)]" />
                  <h2 className="text-xs font-semibold text-[var(--nx-text-primary)]">
                    {catMeta.title}
                  </h2>
                  {isFocused ? (
                    <span className="ml-1 rounded border border-[var(--nx-accent)] bg-[rgba(56,189,248,0.15)] px-1.5 py-0.2 text-[10px] text-[var(--nx-accent)]">
                      聚焦类目
                    </span>
                  ) : null}
                  <p className="ml-auto text-[11px] text-[var(--nx-text-muted)]">
                    {catMeta.description}
                  </p>
                </div>

                <div className="grid gap-3">
                  {items.map((item) => {
                    const statusConfig = STATUS_BADGE[item.status] || {
                      label: item.status,
                      badgeClass:
                        'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-muted)]',
                      dotClass: 'bg-[var(--nx-text-muted)]',
                    }
                    const isConnected =
                      item.status === 'connected' || item.status === 'preconnected'
                    const isAuthorizing = authorizingProvider === item.provider
                    const isChecking = checkingProvider === item.provider

                    return (
                      <div
                        key={item.provider}
                        data-provider-card={item.provider}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3 transition-colors hover:border-[rgba(255,255,255,0.15)]"
                      >
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2.5">
                            <span className="text-xs font-semibold text-[var(--nx-text-primary)]">
                              {item.displayName}
                            </span>
                            <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                              ({item.provider})
                            </span>
                            <span
                              data-testid={`status-badge-${item.provider}`}
                              className={cn(
                                'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                                statusConfig.badgeClass,
                              )}
                            >
                              <span
                                className={cn('h-1.5 w-1.5 rounded-full', statusConfig.dotClass)}
                              />
                              {statusConfig.label}
                            </span>
                          </div>
                          <p className="text-[11px] text-[var(--nx-text-muted)]">
                            {item.description || item.note}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          {isConnected ? (
                            <>
                              <button
                                type="button"
                                data-testid={`check-${item.provider}`}
                                onClick={() => handleCheck(item)}
                                disabled={isChecking}
                                className="flex h-7 items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
                              >
                                {isChecking ? (
                                  <Loader2 className="h-3 w-3 animate-spin text-[var(--nx-accent)]" />
                                ) : (
                                  <RefreshCw className="h-3 w-3" />
                                )}
                                检查状态
                              </button>

                              <button
                                type="button"
                                data-testid={`disconnect-${item.provider}`}
                                onClick={() => setDisconnectTarget(item)}
                                className="flex h-7 items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-status-danger)] transition-colors hover:border-[rgba(239,68,68,0.4)] hover:bg-[rgba(239,68,68,0.1)]"
                              >
                                <Unplug className="h-3 w-3" />
                                断开连接
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              data-testid={`connect-${item.provider}`}
                              onClick={() => handleAuthorize(item)}
                              disabled={isAuthorizing}
                              className="flex h-7 items-center gap-1 rounded border border-[var(--nx-accent)] bg-[var(--nx-accent)] px-3 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                              {isAuthorizing ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <ExternalLink className="h-3 w-3" />
                              )}
                              发起连接
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* 断开连接二次确认对话框（RL-01 敏感操作闭环） */}
      {disconnectTarget ? (
        <div
          data-testid="disconnect-confirm-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="disconnect-confirm-title"
        >
          <div className="w-full max-w-md rounded-lg border border-[rgba(239,68,68,0.3)] bg-[var(--nx-workspace-surface)] p-6 shadow-2xl">
            <div className="flex items-center gap-2.5 text-[var(--nx-status-danger)]">
              <ShieldAlert className="h-5 w-5" aria-hidden />
              <h3 id="disconnect-confirm-title" className="text-base font-semibold">
                断开第三方集成确认
              </h3>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
              确定要断开与「
              <strong className="text-[var(--nx-text-primary)]">
                {disconnectTarget.displayName}
              </strong>
              」的集成连接吗？断开后将清除已建立的 OAuth 回调配置与预连接状态。
            </p>

            {disconnectError ? (
              <div
                role="alert"
                className="mt-3 flex items-center gap-2 rounded border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.1)] p-2.5 text-xs text-[var(--nx-status-danger)]"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{disconnectError}</span>
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                data-testid="cancel-disconnect-button"
                onClick={() => {
                  setDisconnectTarget(null)
                  setDisconnectError(null)
                }}
                disabled={disconnectMutation.isPending}
                className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="confirm-disconnect-button"
                onClick={handleDisconnectConfirm}
                disabled={disconnectMutation.isPending}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[var(--nx-status-danger)] px-3.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {disconnectMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                确认断开
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default IntegrationsWorkspace
