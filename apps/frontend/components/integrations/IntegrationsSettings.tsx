'use client'

import * as React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import QRCode from 'qrcode'
import {
  CalendarDays,
  CheckCircle2,
  Code2,
  ExternalLink,
  HelpCircle,
  Loader2,
  MessageSquare,
  Plug,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Unplug,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { CopilotWebSearchSettingsPanel } from '@/components/integrations/CopilotWebSearchSettingsPanel'
import { OutgoingWebhookSubscriptionsPanel } from '@/components/integrations/OutgoingWebhookSubscriptionsPanel'
import { OutgoingWebhookDeliveryLedgerPanel } from '@/components/integrations/OutgoingWebhookDeliveryLedgerPanel'
import { OutgoingWebhookTemplatesPanel } from '@/components/integrations/OutgoingWebhookTemplatesPanel'
import { OutgoingWebhookStatsPanel } from '@/components/integrations/OutgoingWebhookStatsPanel'
import {
  useAuthorizeIntegration,
  useCheckIntegration,
  useDisconnectIntegration,
  useIntegrationQr,
  useIntegrations,
} from '@/hooks/use-integrations'
import { cn } from '@/lib/utils'
import type { ApiError } from '@/lib/api-client'
import { copyTextToClipboard } from '@/lib/clipboard'
import type {
  IntegrationProvider,
  IntegrationProviderDto,
  IntegrationQrResponse,
} from '@aiproj/types'

const CATEGORY_COPY = {
  calendar: {
    title: '日历连接',
    description: '先准备 Google 和 Outlook 日历 OAuth 入口；当前不会同步外部事件。',
    icon: CalendarDays,
  },
  message: {
    title: '消息通知',
    description: '先准备 Slack、飞书、钉钉连接入口；当前不会向外部发送消息。',
    icon: MessageSquare,
  },
  code_repository: {
    title: '代码仓库连接',
    description: '建立 GitHub 和 GitLab 只读 OAuth 连接，为后续 Issue/PR/MR 状态刷新做准备。',
    icon: Code2,
  },
} as const

const STATUS_BADGE: Record<
  string,
  { label: string; variant: 'warning' | 'success' | 'neutral' | 'info' | 'danger' }
> = {
  not_configured: { label: '待配置', variant: 'warning' },
  ready: { label: '可连接', variant: 'info' },
  preconnected: { label: '预连接', variant: 'success' },
  connected: { label: '已连接', variant: 'success' },
  disconnected: { label: '未连接', variant: 'neutral' },
  disabled: { label: '已停用', variant: 'neutral' },
  needs_reauth: { label: '需重连', variant: 'danger' },
  check_failed: { label: '检查失败', variant: 'warning' },
}

function errorText(error: unknown) {
  const apiError = error as ApiError | undefined
  if (!apiError) return '操作失败'
  if (apiError.code === 'not_configured') return '缺少 OAuth 应用配置'
  return apiError.message || '操作失败'
}

function missingKeys(error: unknown): string[] {
  const details = (error as ApiError | undefined)?.details as
    { missingEnvKeys?: string[] } | undefined
  return details?.missingEnvKeys ?? []
}

function useQrImage(payload: IntegrationQrResponse | null) {
  const [src, setSrc] = React.useState<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    if (!payload) {
      setSrc(null)
      return
    }
    QRCode.toDataURL(payload.authorizationUrl, {
      width: 220,
      margin: 2,
      color: { dark: '#111827', light: '#ffffff' },
    }).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [payload])
  return src
}

export function IntegrationsSettings({ focusCategory }: { focusCategory?: string | null }) {
  const providers = useIntegrations()
  const authorize = useAuthorizeIntegration()
  const qr = useIntegrationQr()
  const check = useCheckIntegration()
  const disconnect = useDisconnectIntegration()
  const [selectedGuide, setSelectedGuide] = React.useState<IntegrationProviderDto | null>(null)
  const [qrPayload, setQrPayload] = React.useState<IntegrationQrResponse | null>(null)
  const [actionError, setActionError] = React.useState<{
    provider: IntegrationProvider
    message: string
    missingKeys: string[]
  } | null>(null)

  const groups = React.useMemo(() => {
    const list = providers.data ?? []
    return {
      calendar: list.filter((provider) => provider.category === 'calendar'),
      message: list.filter((provider) => provider.category === 'message'),
      code_repository: list.filter((provider) => provider.category === 'code_repository'),
    }
  }, [providers.data])

  const connect = (provider: IntegrationProvider) => {
    setActionError(null)
    authorize.mutate(provider, {
      onSuccess: (data) => {
        window.location.assign(data.authorizationUrl)
      },
      onError: (error) => {
        setActionError({ provider, message: errorText(error), missingKeys: missingKeys(error) })
      },
    })
  }

  const openQr = (provider: IntegrationProvider) => {
    setActionError(null)
    qr.mutate(provider, {
      onSuccess: setQrPayload,
      onError: (error) => {
        setActionError({ provider, message: errorText(error), missingKeys: missingKeys(error) })
      },
    })
  }

  if (providers.isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-20 animate-pulse rounded-[var(--radius-lg)] bg-gray-100" />
        <div className="h-28 animate-pulse rounded-[var(--radius-lg)] bg-gray-100" />
        <div className="h-28 animate-pulse rounded-[var(--radius-lg)] bg-gray-100" />
      </div>
    )
  }

  if (providers.isError) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="集成配置加载失败"
        description="请检查网络或稍后重试。"
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-gray-900">集成设置</h1>
        <p className="max-w-3xl text-sm leading-6 text-gray-600">
          这里先完成 OAuth 连接入口、扫码连接和配置说明。当前版本不会交换
          token、同步外部日历，也不会向 Slack、飞书或钉钉发送消息。
        </p>
      </div>

      {actionError ? (
        <div className="rounded-[var(--radius-lg)] border border-warning bg-warning-bg p-4 text-sm text-warning">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">{actionError.message}</p>
              {actionError.missingKeys.length > 0 ? (
                <p className="mt-1 text-xs">
                  缺少环境变量：{actionError.missingKeys.join('、')}
                  。页面下方的配置说明会告诉你去哪里申请和填写。
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {(['calendar', 'message', 'code_repository'] as const).map((category) => {
        const copy = CATEGORY_COPY[category]
        const Icon = copy.icon
        const focused = focusCategory === category
        return (
          <section
            key={category}
            id={category}
            className={cn(
              'rounded-[var(--radius-lg)] border bg-gray-0',
              focused ? 'border-primary-200 shadow-[var(--shadow-xs)]' : 'border-border',
            )}
          >
            <div className="flex items-start gap-3 border-b border-border p-4">
              <span className="rounded-[var(--radius-md)] bg-gray-100 p-2 text-gray-700">
                <Icon className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-md font-semibold text-gray-900">{copy.title}</h2>
                <p className="mt-1 text-sm text-gray-600">{copy.description}</p>
              </div>
            </div>
            <div className="divide-y divide-border">
              {groups[category].map((provider) => (
                <ProviderRow
                  key={provider.provider}
                  provider={provider}
                  connecting={authorize.isPending && authorize.variables === provider.provider}
                  qrLoading={qr.isPending && qr.variables === provider.provider}
                  disconnecting={disconnect.isPending && disconnect.variables === provider.provider}
                  checking={check.isPending && check.variables === provider.provider}
                  onConnect={() => connect(provider.provider)}
                  onQr={() => openQr(provider.provider)}
                  onCheck={() => check.mutate(provider.provider)}
                  onDisconnect={() => disconnect.mutate(provider.provider)}
                  onGuide={() => setSelectedGuide(provider)}
                />
              ))}
            </div>
          </section>
        )
      })}

      <OutgoingWebhookSubscriptionsPanel />

      <OutgoingWebhookDeliveryLedgerPanel />

      <OutgoingWebhookTemplatesPanel />

      <OutgoingWebhookStatsPanel />

      {/* Copilot 工具（v3-copilot-optional-web-search-configuration）：组织级网页搜索设置 */}
      <CopilotWebSearchSettingsPanel />

      <Dialog open={!!selectedGuide} onOpenChange={(open) => !open && setSelectedGuide(null)}>
        <DialogContent>
          {selectedGuide ? (
            <>
              <DialogHeader>
                <DialogTitle>{selectedGuide.displayName} 配置说明</DialogTitle>
                <DialogDescription>
                  环境变量是可选部署配置，不代表用户已经绑定。填好后点击连接即可进入 OAuth。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="rounded-[var(--radius-md)] bg-gray-50 p-3 text-xs text-gray-700">
                  <p className="font-medium">需要填写</p>
                  <p className="mt-1 font-mono">{selectedGuide.requiredEnvKeys.join(', ')}</p>
                </div>
                <ol className="space-y-2">
                  {selectedGuide.setupGuide.map((step) => (
                    <li key={step.title} className="text-sm text-gray-700">
                      <p className="font-medium">{step.title}</p>
                      <p className="mt-0.5 text-gray-600">{step.description}</p>
                      {step.href ? (
                        <a
                          href={step.href}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-primary-600 hover:underline"
                        >
                          打开平台 <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <QrDialog payload={qrPayload} onClose={() => setQrPayload(null)} />
    </div>
  )
}

function ProviderRow({
  provider,
  connecting,
  qrLoading,
  disconnecting,
  checking,
  onConnect,
  onQr,
  onCheck,
  onDisconnect,
  onGuide,
}: {
  provider: IntegrationProviderDto
  connecting: boolean
  qrLoading: boolean
  disconnecting: boolean
  checking: boolean
  onConnect: () => void
  onQr: () => void
  onCheck: () => void
  onDisconnect: () => void
  onGuide: () => void
}) {
  const status = STATUS_BADGE[provider.status] ?? {
    label: '未连接',
    variant: 'neutral' as const,
  }
  const isGithub = provider.provider === 'github'
  const isGitlab = provider.provider === 'gitlab'
  const isCodeRepoWithOAuth = isGithub || isGitlab
  const displayAccount = provider.connectedAccountLogin ?? provider.connectedAccountEmail
  return (
    <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{provider.displayName}</h3>
          <Badge variant={status.variant}>{status.label}</Badge>
          {provider.authMethods.includes('qr_code') ? (
            <Badge variant="outline">支持扫码</Badge>
          ) : null}
          {isCodeRepoWithOAuth && provider.status === 'connected' ? (
            <Badge variant="outline">只读</Badge>
          ) : null}
        </div>
        <p className="text-sm leading-6 text-gray-600">{provider.description}</p>
        {provider.missingEnvKeys.length > 0 ? (
          <p className="text-xs text-warning">缺少：{provider.missingEnvKeys.join('、')}</p>
        ) : displayAccount ? (
          <p className="text-xs text-gray-500">
            已连接账号：{displayAccount}
            {provider.lastCheckedAt
              ? ` · 上次检查：${new Date(provider.lastCheckedAt).toLocaleString('zh-CN')}`
              : ''}
            {provider.lastError ? ` · 错误：${provider.lastError}` : ''}
          </p>
        ) : (
          <p className="text-xs text-gray-500">{provider.note}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {isCodeRepoWithOAuth && provider.status === 'needs_reauth' ? (
          <Button variant="primary" size="sm" onClick={onConnect} loading={connecting}>
            <Plug className="h-4 w-4" />
            重新授权
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={onConnect} loading={connecting}>
            <Plug className="h-4 w-4" />
            {provider.configured ? '连接' : '配置后连接'}
          </Button>
        )}
        {provider.authMethods.includes('qr_code') ? (
          <Button variant="outline" size="sm" onClick={onQr} loading={qrLoading}>
            <QrCode className="h-4 w-4" />
            扫码
          </Button>
        ) : null}
        {provider.status === 'connected' || provider.status === 'check_failed' ? (
          <Button variant="outline" size="sm" onClick={onCheck} loading={checking}>
            <RefreshCw className="h-4 w-4" />
            检查
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onGuide}>
          <HelpCircle className="h-4 w-4" />
          说明
        </Button>
        {provider.status === 'connected' || provider.status === 'check_failed' ? (
          <Button variant="ghost" size="sm" onClick={onDisconnect} loading={disconnecting}>
            <Unplug className="h-4 w-4" />
            断开
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function QrDialog({
  payload,
  onClose,
}: {
  payload: IntegrationQrResponse | null
  onClose: () => void
}) {
  const qrSrc = useQrImage(payload)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    setCopied(false)
  }, [payload])

  return (
    <Dialog open={!!payload} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {payload ? (
          <>
            <DialogHeader>
              <DialogTitle>{payload.qrTitle}</DialogTitle>
              <DialogDescription>{payload.qrDescription}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-60 w-60 items-center justify-center rounded-[var(--radius-lg)] border border-border bg-white p-3">
                {qrSrc ? (
                  <Image src={qrSrc} alt="OAuth 授权二维码" width={220} height={220} unoptimized />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                )}
              </div>
              <p className="text-center text-xs text-gray-500">
                过期时间：{new Date(payload.expiresAt).toLocaleString('zh-CN')}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void copyTextToClipboard(payload.authorizationUrl).then((ok) => {
                      if (ok) setCopied(true)
                    })
                  }}
                >
                  {copied ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {copied ? '已复制' : '复制链接'}
                </Button>
                <Button asChild size="sm">
                  <Link href={payload.authorizationUrl}>打开授权页</Link>
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
