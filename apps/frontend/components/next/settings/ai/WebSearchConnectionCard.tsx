'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, Loader2, Save } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import {
  COPILOT_WEB_SEARCH_PROVIDER_KINDS,
  COPILOT_WEB_SEARCH_PROVIDER_META,
  type CopilotWebSearchGovernance,
  type CopilotWebSearchProviderKind,
} from '@aiproj/types'
import {
  copilotWebSearchApi,
  type CopilotWebSearchSettingsUpdateInput,
} from '@/lib/api/copilot-web-search'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'

/**
 * AI 连接页 ·「网页搜索」连接方式（2026-09-26）。
 *
 * - 默认提供方为免费公开搜索（DuckDuckGo + 维基百科），无需密钥即可用；
 * - 可切换 Tavily / Brave / 博查（填 API Key，只写不回显）或自建 SearXNG（填地址）；
 *   付费提供方调用失败时服务端自动退回免费搜索；
 * - 总开关 + 「允许 AI 同事使用」开启后，成员在 AI 同事里按次打开「网页搜索」才会真正去搜；
 * - 读设置对成员开放；修改需要 copilot:web_search:manage。
 * - 双层同意（2026-10-05）：超级管理员在平台开启后个人帐号即可用；团队 / 企业组织还要
 *   组织管理员在本卡片开启。个人帐号只读展示平台设置。
 */

export const webSearchKeys = {
  all: ['copilot-web-search'] as const,
  settings: () => [...webSearchKeys.all, 'settings'] as const,
}

const inputClass =
  'h-8 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-60'

function Toggle({
  checked,
  onChange,
  disabled,
  label,
  testId,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
  testId: string
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-[var(--nx-text-secondary)]">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        data-testid={testId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-[var(--nx-accent)]' : 'bg-[var(--nx-bg-2)]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </button>
    </label>
  )
}

const splitDomains = (text: string) =>
  text
    .split(/[\s,，;；]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)

/** 双层同意状态说明（不提示去找谁开启，只说明现状）。 */
function governanceNote(governance: CopilotWebSearchGovernance | undefined): string | null {
  if (!governance) return null
  if (governance.mode === 'platform') {
    return '这是平台设置：开启后个人帐号即可使用；团队 / 企业组织还需要各自的组织管理员开启。'
  }
  if (governance.mode === 'personal') {
    return governance.platformApproved
      ? '个人帐号沿用平台的网页搜索设置，已可在 AI 同事里使用。'
      : '个人帐号沿用平台的网页搜索设置，平台尚未开放。'
  }
  const platform = governance.platformApproved ? '平台已开放' : '平台尚未开放'
  const organization = governance.organizationApproved ? '本组织已开启' : '本组织未开启'
  return `${platform} · ${organization}：两者都开启后成员才能使用。`
}

export function WebSearchConnectionCard() {
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: webSearchKeys.settings(),
    queryFn: () => copilotWebSearchApi.getSettings(),
  })
  const governance = settingsQuery.data?.governance
  // 个人帐号沿用平台设置，只读
  const canManage = can('copilot:web_search:manage') && governance?.mode !== 'personal'
  const available = governance
    ? governance.effectiveEnabled
    : !!settingsQuery.data?.enabled && !!settingsQuery.data.allowForGeneralCopilot
  const note = governanceNote(governance)

  const [enabled, setEnabled] = React.useState(false)
  const [allowCopilot, setAllowCopilot] = React.useState(false)
  const [kind, setKind] = React.useState<CopilotWebSearchProviderKind>('free')
  const [baseUrl, setBaseUrl] = React.useState('')
  const [apiKey, setApiKey] = React.useState('')
  const [dailyLimit, setDailyLimit] = React.useState(50)
  const [allowed, setAllowed] = React.useState('')
  const [denied, setDenied] = React.useState('')

  // 服务端数据到达（或保存后刷新）时同步表单
  const data = settingsQuery.data
  React.useEffect(() => {
    if (!data) return
    setEnabled(data.enabled)
    setAllowCopilot(data.allowForGeneralCopilot)
    setKind(data.providerKind ?? 'free')
    setBaseUrl(data.providerBaseUrl ?? '')
    setDailyLimit(data.dailyQueryLimit)
    setAllowed(data.allowedDomains.join('\n'))
    setDenied(data.deniedDomains.join('\n'))
    setApiKey('')
  }, [data])

  const save = useMutation({
    mutationFn: (input: CopilotWebSearchSettingsUpdateInput) =>
      copilotWebSearchApi.updateSettings(input),
    onSuccess: (summary) => {
      queryClient.setQueryData(webSearchKeys.settings(), summary)
      toast({ variant: 'success', title: '网页搜索设置已保存' })
    },
    onError: (error: Error) =>
      toast({ variant: 'error', title: '保存失败', description: error.message }),
  })

  const meta = COPILOT_WEB_SEARCH_PROVIDER_META[kind]
  const keyReady = !meta.requiresKey || apiKey.trim() !== '' || data?.providerKeyConfigured
  const urlReady = !meta.requiresBaseUrl || baseUrl.trim() !== ''

  function handleSave() {
    const input: CopilotWebSearchSettingsUpdateInput = {
      enabled,
      allowForGeneralCopilot: allowCopilot,
      providerKind: kind,
      providerBaseUrl: meta.requiresBaseUrl
        ? baseUrl.trim() || null
        : (data?.providerBaseUrl ?? null),
      dailyQueryLimit: dailyLimit,
      allowedDomains: splitDomains(allowed),
      deniedDomains: splitDomains(denied),
      ...(apiKey.trim() ? { providerApiKey: apiKey.trim() } : {}),
    }
    save.mutate(input)
  }

  return (
    <section
      data-testid="web-search-connection-card"
      className="flex flex-col gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Globe className="h-4.5 w-4.5 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-[var(--nx-text-primary)]">网页搜索连接</h2>
            <p className="mt-0.5 text-xs text-[var(--nx-text-muted)]">
              让 AI 同事回答时查网页资料并附上来源。默认用免费公开搜索，无需密钥。
            </p>
          </div>
        </div>
        <span
          data-testid="web-search-status"
          className={cn(
            'rounded-full px-2.5 py-0.5 text-[11px]',
            available
              ? 'bg-[rgba(16,185,129,0.12)] text-[var(--nx-status-success)]'
              : 'bg-[var(--nx-bg-2)] text-[var(--nx-text-muted)]',
          )}
        >
          {available ? 'AI 同事可用' : '未开启'}
        </span>
      </header>

      {note ? (
        <p
          data-testid="web-search-governance"
          className="-mt-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-[11px] text-[var(--nx-text-secondary)]"
        >
          {note}
        </p>
      ) : null}

      {settingsQuery.isLoading ? (
        <div className="h-24 animate-pulse rounded bg-[var(--nx-border-hairline)]" />
      ) : settingsQuery.isError ? (
        <p className="text-xs text-[var(--nx-status-warning)]">无法载入网页搜索设置</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Toggle
                label="启用网页搜索"
                testId="web-search-enabled"
                checked={enabled}
                onChange={setEnabled}
                disabled={!canManage}
              />
              <Toggle
                label="允许 AI 同事使用（成员每次提问时自己决定是否联网）"
                testId="web-search-allow-copilot"
                checked={allowCopilot}
                onChange={setAllowCopilot}
                disabled={!canManage}
              />
              <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
                每日搜索次数上限（全组织）
                <input
                  type="number"
                  min={1}
                  max={10000}
                  className={inputClass}
                  value={dailyLimit}
                  disabled={!canManage}
                  onChange={(e) => setDailyLimit(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            </div>

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
                搜索提供方
                <select
                  data-testid="web-search-provider"
                  className={inputClass}
                  value={kind}
                  disabled={!canManage}
                  onChange={(e) => setKind(e.target.value as CopilotWebSearchProviderKind)}
                >
                  {COPILOT_WEB_SEARCH_PROVIDER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {COPILOT_WEB_SEARCH_PROVIDER_META[k].label}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-[var(--nx-text-muted)]">{meta.description}</span>
              </label>
              {meta.requiresKey ? (
                <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
                  API Key
                  <input
                    type="password"
                    autoComplete="off"
                    data-testid="web-search-api-key"
                    className={inputClass}
                    value={apiKey}
                    disabled={!canManage}
                    placeholder={
                      data?.providerKeyConfigured
                        ? `已设置（${data.providerKeyHint ?? '…'}），留空保持不变`
                        : '粘贴 API Key'
                    }
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <span className="text-[11px] text-[var(--nx-text-muted)]">
                    服务端加密保存，不会回显；调用失败时自动改用免费搜索。
                  </span>
                </label>
              ) : null}
              {meta.requiresBaseUrl ? (
                <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
                  SearXNG 地址
                  <input
                    type="url"
                    data-testid="web-search-base-url"
                    className={inputClass}
                    value={baseUrl}
                    disabled={!canManage}
                    placeholder="https://searx.example.com"
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </label>
              ) : null}
            </div>
          </div>

          <details className="text-xs text-[var(--nx-text-secondary)]">
            <summary className="cursor-pointer select-none text-[var(--nx-text-muted)]">
              来源网站限制（可选）
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                只采用这些网站（留空 = 不限制）
                <textarea
                  rows={3}
                  className={cn(inputClass, 'h-auto py-1.5')}
                  value={allowed}
                  disabled={!canManage}
                  placeholder={'例如：\n*.gov.cn\nkubernetes.io'}
                  onChange={(e) => setAllowed(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                排除这些网站
                <textarea
                  rows={3}
                  className={cn(inputClass, 'h-auto py-1.5')}
                  value={denied}
                  disabled={!canManage}
                  placeholder="每行一个域名"
                  onChange={(e) => setDenied(e.target.value)}
                />
              </label>
            </div>
          </details>

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--nx-border-hairline)] pt-3">
            <span className="text-[11px] text-[var(--nx-text-muted)]">
              {canManage
                ? !keyReady
                  ? '当前提供方需要 API Key，未填写时会使用免费搜索'
                  : !urlReady
                    ? '请填写 SearXNG 地址，未填写时会使用免费搜索'
                    : '保存后立即生效'
                : governance?.mode === 'personal'
                  ? '个人帐号沿用平台设置'
                  : '当前帐号只能查看网页搜索设置'}
            </span>
            {canManage ? (
              <button
                type="button"
                data-testid="web-search-save"
                onClick={handleSave}
                disabled={save.isPending}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-accent)] bg-[var(--nx-accent)] px-3 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {save.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Save className="h-3.5 w-3.5" aria-hidden />
                )}
                保存网页搜索设置
              </button>
            ) : null}
          </footer>
        </>
      )}
    </section>
  )
}
