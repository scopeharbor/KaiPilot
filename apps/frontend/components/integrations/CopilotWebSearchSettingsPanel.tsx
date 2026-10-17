'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  Save,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  copilotWebSearchApi,
  type CopilotWebSearchSettingsUpdateInput,
} from '@/lib/api/copilot-web-search'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import type { ApiError } from '@/lib/api-client'

const QUERY_KEY = ['copilot-tools', 'web-search'] as const

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:shadow-focus focus-visible:outline-none',
        checked ? 'bg-primary-600' : 'bg-gray-200',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

function errorText(error: unknown) {
  const apiError = error as ApiError | undefined
  if (apiError?.code === 'PERMISSION_DENIED') return '没有管理网页搜索设置的权限'
  return apiError?.message || '保存失败，请稍后重试'
}

/**
 * Copilot 工具：外部网页搜索设置面板（v3-copilot-optional-web-search-configuration）。
 *
 * - 读：GET 低敏投影（configured + masked provider label，无 credential）
 * - 写：需要 copilot:web_search:manage；无权限 → 只读模式
 * - 默认关闭：enabled=false；必须按次同意（requirePerTurnConsent 服务端锁定 true）
 */
export function CopilotWebSearchSettingsPanel({
  enabled: featureEnabled = true,
}: {
  /** 视图层 feature flag：关闭时不渲染（组件测试用）。 */
  enabled?: boolean
}) {
  const queryClient = useQueryClient()
  const canManage = useAuthStore((state) => state.hasPermission('copilot:web_search:manage'))
  const domReady = useAuthStore((state) => state.hasHydrated)

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: copilotWebSearchApi.getStatus,
  })

  const [form, setForm] = React.useState<{
    enabled: boolean
    providerConnectionId: number | null
    allowedDomains: string[]
    deniedDomains: string[]
    dailyQueryLimit: number
    maxResultsPerQuery: number
    timeoutMs: number
    allowForAiCreate: boolean
    allowForGeneralCopilot: boolean
  } | null>(null)
  const [savedAt, setSavedAt] = React.useState<number | null>(null)

  // 数据到达后初始化本地编辑态（域名名单缺省为空数组，避免形状不符的投影带崩渲染）
  React.useEffect(() => {
    if (query.data && form === null) {
      setForm({
        enabled: query.data.enabled,
        providerConnectionId: query.data.providerConnectionId,
        allowedDomains: query.data.allowedDomains ?? [],
        deniedDomains: query.data.deniedDomains ?? [],
        dailyQueryLimit: query.data.dailyQueryLimit,
        maxResultsPerQuery: query.data.maxResultsPerQuery,
        timeoutMs: query.data.timeoutMs,
        allowForAiCreate: query.data.allowForAiCreate,
        allowForGeneralCopilot: query.data.allowForGeneralCopilot,
      })
    }
  }, [query.data, form])

  const save = useMutation({
    mutationFn: (input: CopilotWebSearchSettingsUpdateInput) =>
      copilotWebSearchApi.updateSettings(input),
    onSuccess: () => {
      setSavedAt(Date.now())
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })

  const dirty =
    form !== null &&
    (form.enabled !== query.data?.enabled ||
      form.dailyQueryLimit !== query.data?.dailyQueryLimit ||
      form.maxResultsPerQuery !== query.data?.maxResultsPerQuery ||
      form.allowForAiCreate !== query.data?.allowForAiCreate ||
      form.allowForGeneralCopilot !== query.data?.allowForGeneralCopilot ||
      form.allowedDomains.length !== query.data?.allowedDomainCount ||
      form.deniedDomains.length !== query.data?.deniedDomainCount)

  if (!featureEnabled) return null

  if (!domReady) {
    return <div className="h-28 animate-pulse rounded-[var(--radius-lg)] bg-gray-100" />
  }

  if (query.isError) {
    return (
      <section className="rounded-[var(--radius-lg)] border border-border bg-gray-0">
        <div className="border-b border-border p-4">
          <h2 className="text-md font-semibold text-gray-900">Copilot 工具</h2>
        </div>
        <EmptyState
          icon={ShieldAlert}
          title="网页搜索设置加载失败"
          description="请检查网络或稍后重试。"
        />
      </section>
    )
  }

  if (!query.data || !form) {
    return (
      <section className="rounded-[var(--radius-lg)] border border-border bg-gray-0">
        <div className="border-b border-border p-4">
          <h2 className="text-md font-semibold text-gray-900">Copilot 工具</h2>
        </div>
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      </section>
    )
  }

  const data = query.data

  return (
    <section
      aria-labelledby="copilot-tools-web-search-heading"
      className="rounded-[var(--radius-lg)] border border-border bg-gray-0"
    >
      <div className="flex items-start gap-3 border-b border-border p-4">
        <span className="rounded-[var(--radius-md)] bg-gray-100 p-2 text-gray-700">
          <Search className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="copilot-tools-web-search-heading"
              className="text-md font-semibold text-gray-900"
            >
              Copilot 工具：外部网页搜索
            </h2>
            <Badge variant={data.enabled ? 'success' : 'neutral'}>
              {data.enabled ? '已启用' : '默认关闭'}
            </Badge>
          </div>
          <p className="mt-1 text-sm leading-6 text-gray-600">
            可选的外部网页搜索工具。默认关闭：只有组织启用、成员有权限，且你在每次提问时
            显式开启「允许本次使用网页搜索」后，Copilot 才可能查询外部资料。每次调用都
            单独计量并落低敏审计；外部来源会与项目内部事实明确分区。
          </p>
        </div>
      </div>

      {!canManage ? (
        <div className="p-4">
          <p className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">当前状态：</span>
            {data.enabled
              ? data.configured
                ? '已启用（provider 已配置）'
                : '已启用（provider 未配置，实际不会联网）'
              : '未启用'}
            。{data.maskedProviderLabel ? ` 搜索服务：${data.maskedProviderLabel}。` : ''}
            {data.requirePerTurnConsent ? ' 每次使用需按次同意。' : ''}
            你可以在使用页面的开关处控制每一次提问是否允许联网搜索。
          </p>
          <p className="mt-3 flex items-center gap-1 text-sm text-gray-500">
            <KeyRound className="h-4 w-4" />
            API 密钥只存储在后端加密服务中，本页面不显示、也不要求填写。
          </p>
        </div>
      ) : (
        <div className="space-y-4 p-4">
          {/* 总开关 */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900">启用外部网页搜索</p>
              <p className="mt-0.5 text-xs leading-5 text-gray-500">
                关闭时 Copilot 与 AI 快速创建不会发起任何外部请求（默认）。
              </p>
            </div>
            <Switch
              checked={form.enabled}
              onChange={(next) => setForm({ ...form, enabled: next })}
              disabled={save.isPending}
              label="启用外部网页搜索"
            />
          </div>

          {/* provider 状态 */}
          <div className="rounded-[var(--radius-md)] border border-border bg-gray-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                  <KeyRound className="h-4 w-4 text-gray-500" />
                  搜索服务连接
                </p>
                <p className="mt-0.5 text-xs leading-5 text-gray-500">
                  {data.configured
                    ? `已配置：${data.maskedProviderLabel}`
                    : '未配置。请先在 AI 连接中保存一个带 API 密钥的连接，再回填连接 ID。'}
                </p>
              </div>
              <Link
                href="/settings/ai-connections"
                className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline focus-visible:shadow-focus"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                管理 AI 连接
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-700">Provider 连接 ID</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={form.providerConnectionId ?? ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      providerConnectionId: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  placeholder="留空 = 未配置"
                  className="mt-1 w-full rounded-[var(--radius-md)] border border-input bg-white px-3 py-2 text-sm outline-none focus-visible:shadow-focus"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-700">每自然日搜索额度</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10000}
                  value={form.dailyQueryLimit}
                  onChange={(e) =>
                    setForm({ ...form, dailyQueryLimit: Number(e.target.value) || 1 })
                  }
                  className="mt-1 w-full rounded-[var(--radius-md)] border border-input bg-white px-3 py-2 text-sm outline-none focus-visible:shadow-focus"
                />
              </label>
            </div>
          </div>

          {/* 域名策略 */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-gray-700">
                允许域名（准入制，每行一个，支持 *.gov.cn）
              </span>
              <textarea
                value={form.allowedDomains.join('\n')}
                onChange={(e) =>
                  setForm({
                    ...form,
                    allowedDomains: e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                rows={3}
                className="mt-1 w-full rounded-[var(--radius-md)] border border-input bg-white px-3 py-2 font-mono text-xs outline-none focus-visible:shadow-focus"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-700">
                拒绝域名（黑名单，每行一个）
              </span>
              <textarea
                value={form.deniedDomains.join('\n')}
                onChange={(e) =>
                  setForm({
                    ...form,
                    deniedDomains: e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                rows={3}
                className="mt-1 w-full rounded-[var(--radius-md)] border border-input bg-white px-3 py-2 font-mono text-xs outline-none focus-visible:shadow-focus"
              />
            </label>
          </div>

          {/* 场景开关 */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border p-3">
              <div>
                <p className="text-sm font-medium text-gray-900">允许用于通用 Copilot</p>
                <p className="mt-0.5 text-xs text-gray-500">在 Copilot 会话中可用</p>
              </div>
              <Switch
                checked={form.allowForGeneralCopilot}
                onChange={(next) => setForm({ ...form, allowForGeneralCopilot: next })}
                disabled={save.isPending}
                label="允许用于通用 Copilot"
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border p-3">
              <div>
                <p className="text-sm font-medium text-gray-900">允许用于 AI 快速创建</p>
                <p className="mt-0.5 text-xs text-gray-500">在 AI 一句话建项时可用</p>
              </div>
              <Switch
                checked={form.allowForAiCreate}
                onChange={(next) => setForm({ ...form, allowForAiCreate: next })}
                disabled={save.isPending}
                label="允许用于 AI 快速创建"
              />
            </div>
          </div>

          {/* 用量 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Globe className="h-3.5 w-3.5" />
              今日已用 {data.quota.usedToday} / {data.quota.limitToday}
            </span>
            <span>按次同意：{data.requirePerTurnConsent ? '必须' : '必须'}</span>
            <span>单次结果上限：{query.data?.maxResultsPerQuery ?? form.maxResultsPerQuery}</span>
          </div>

          {save.isError ? (
            <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warning bg-warning-bg p-3 text-sm text-warning">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorText(save.error)}</span>
            </div>
          ) : null}

          {savedAt ? (
            <p className="text-xs text-success">
              已保存（{new Date(savedAt).toLocaleTimeString('zh-CN')}）。provider 密钥不会
              出现在响应中。
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                save.mutate({
                  enabled: form.enabled,
                  providerConnectionId: form.providerConnectionId,
                  allowedDomains: form.allowedDomains,
                  deniedDomains: form.deniedDomains,
                  dailyQueryLimit: form.dailyQueryLimit,
                  maxResultsPerQuery: form.maxResultsPerQuery,
                  timeoutMs: form.timeoutMs,
                  allowForAiCreate: form.allowForAiCreate,
                  allowForGeneralCopilot: form.allowForGeneralCopilot,
                })
              }
              disabled={!dirty || save.isPending}
              loading={save.isPending}
            >
              <Save className="h-4 w-4" />
              保存设置
            </Button>
            {form.allowedDomains.length === 0 && form.enabled ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setForm({ ...form, enabled: false })}
                disabled={save.isPending}
              >
                <Trash2 className="h-4 w-4" />
                关闭（未配置域名不会联网）
              </Button>
            ) : null}
          </div>
          <p className="text-xs leading-5 text-gray-500">
            外部搜索使用隔离的 fixture/受控 provider；真实 provider 接入需单独授权。搜索结果
            仅作为带引用的参考，不会自动写入正式项目。
          </p>
        </div>
      )}
    </section>
  )
}
