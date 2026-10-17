'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Check, Loader2, Sparkles, Unlink, X } from 'lucide-react'
import {
  modelPricingApi,
  type ModelPricingCandidate,
  type ModelPricingCost,
  type ModelPricingDetail,
} from '@/lib/api/ai-connections'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { usePermissions } from '@/hooks/use-permissions'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import type { AiConnectionDto, AiConnectionModelDto } from '@aiproj/types'

/**
 * 模型定价弹层（2026-10-01）。
 *
 * 为什么需要它：第三方中转 / 私有端点在 models.dev 里往往没有可信挂牌价，
 * 成本因此长期显示「未定价」。这里给每条模型提供四件事：
 * 1. 定价状态（来源 + 币种 + 单价 + **是否近似价**）；
 * 2. **历史用量回算**——过去这些 token 按当前单价值多少钱，改价即时跟着变（账本历史行不改写）；
 * 3. 自动预填（精确命中直接套用；否则交模型从候选里挑一条，标注近似价与理由）；
 * 4. 人工填写实际结算单价（优先级最高，自动流程不覆盖）+ 解绑。
 */

/** 币种不限：后端校验 3–8 位字母代码，这里只做大写归一，不维护币种清单。 */
function normalizeCurrencyInput(raw: string): string {
  return raw
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 8)
}

const DECIDED_BY_LABELS: Record<string, string> = {
  manual: '人工定价',
  'exact-catalog': '目录精确命中',
  'ai-prefill': 'AI 预填',
  'first-party-fallback': '同名条目回退（近似）',
}

const COST_FIELDS: Array<{ key: keyof ModelPricingCost; label: string }> = [
  { key: 'input', label: '输入' },
  { key: 'output', label: '输出' },
  { key: 'cacheRead', label: '缓存读' },
  { key: 'cacheWrite', label: '缓存写' },
  { key: 'inputAudio', label: '音频输入' },
  { key: 'outputAudio', label: '音频输出' },
  { key: 'reasoning', label: '推理 token' },
]

function formatPrice(cost: ModelPricingCost | null): string {
  if (!cost) return '—'
  const parts = COST_FIELDS.filter((field) => cost[field.key] !== null).map(
    (field) => `${field.label} ${cost[field.key]}`,
  )
  return parts.length > 0 ? parts.join(' / ') : '—'
}

function formatTokens(value: number): string {
  return Number(value || 0).toLocaleString()
}

function formatCost(value: number | null, currency: string): string {
  if (value === null || value === undefined) return '未定价'
  return `${currency} ${value.toFixed(4)}`
}

export interface ModelPricingDialogProps {
  connection: AiConnectionDto
  onClose: () => void
}

export function ModelPricingDialog({ connection, onClose }: ModelPricingDialogProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  useDialogA11y({ ref: containerRef, open: true, onClose })

  const models = connection.models ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-label="模型定价"
        data-testid="model-pricing-dialog"
        className="mt-8 w-full max-w-3xl rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] shadow-xl focus:outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--nx-border-hairline)] p-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-[var(--nx-text-primary)]">
              模型定价 · {connection.displayName}
            </h2>
            <p className="text-[11px] leading-4 text-[var(--nx-text-muted)]">
              第三方中转在模型目录里可能没有挂牌价：先按「端点 +
              模型名」精确命中，命中不了才交给模型
              从候选里挑一条（标为近似价）。人工填写优先，自动流程不会覆盖。
            </p>
          </div>
          <button
            type="button"
            data-testid="close-model-pricing"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </header>

        <div className="flex flex-col gap-4 p-4">
          {models.length === 0 ? (
            <p className="text-xs text-[var(--nx-text-muted)]">该连接下没有模型。</p>
          ) : (
            models.map((model) => (
              <ModelPricingRow key={model.id} connectionId={Number(connection.id)} model={model} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function ModelPricingRow({
  connectionId,
  model,
}: {
  connectionId: number
  model: AiConnectionModelDto
}) {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const canManage = can('ai:connection:manage')
  const [manualOpen, setManualOpen] = React.useState(false)
  const [candidatesOpen, setCandidatesOpen] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [currency, setCurrency] = React.useState('USD')
  const [draft, setDraft] = React.useState<Record<string, string>>({})

  const modelId = Number(model.id)
  const detailQuery = useQuery({
    queryKey: ['ai', 'model-pricing', connectionId, modelId, 'summary'],
    queryFn: () => modelPricingApi.show(connectionId, modelId, false),
  })
  const historyQuery = useQuery({
    queryKey: ['ai', 'model-pricing', connectionId, modelId, 'history'],
    queryFn: () => modelPricingApi.show(connectionId, modelId, true),
    enabled: historyOpen,
  })

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['ai', 'model-pricing', connectionId, modelId] })
    void queryClient.invalidateQueries({ queryKey: ['ai', 'connections'] })
  }, [queryClient, connectionId, modelId])

  const prefill = useMutation({
    mutationFn: () => modelPricingApi.prefill(connectionId, modelId, true),
    onSuccess: (outcome) => {
      if (outcome.strategy === 'queued') {
        toast({ variant: 'success', title: '已开始后台预填', description: outcome.reason })
        ;[2_000, 7_000, 21_000].forEach((delay) => window.setTimeout(refresh, delay))
      } else if (outcome.applied) {
        toast({
          variant: 'success',
          title: outcome.approximate ? '已按近似价自动定价' : '已自动定价',
          description: outcome.reason,
        })
      } else {
        toast({ variant: 'error', title: '未能自动定价', description: outcome.reason })
        setCandidatesOpen(true)
      }
      refresh()
    },
    onError: (error: Error) =>
      toast({ variant: 'error', title: '自动预填失败', description: error.message }),
  })

  const saveManual = useMutation({
    mutationFn: () => {
      const cost: Partial<ModelPricingCost> = {}
      COST_FIELDS.forEach((field) => {
        const raw = draft[field.key]
        if (raw !== undefined && raw !== '') cost[field.key] = Number(raw)
      })
      return modelPricingApi.setManual(connectionId, modelId, { currency, cost })
    },
    onSuccess: () => {
      toast({ variant: 'success', title: '已保存人工定价' })
      setManualOpen(false)
      refresh()
    },
    onError: (error: Error) =>
      toast({ variant: 'error', title: '保存失败', description: error.message }),
  })

  const bindCandidate = useMutation({
    mutationFn: (candidate: ModelPricingCandidate) =>
      modelPricingApi.applyCatalog(connectionId, modelId, {
        catalogProviderId: candidate.providerId,
        catalogModelId: candidate.modelId,
        approximate: !candidate.endpointMatched,
        reason: `手工选择 ${candidate.providerId}`,
      }),
    onSuccess: () => {
      toast({ variant: 'success', title: '已绑定该目录条目' })
      setCandidatesOpen(false)
      refresh()
    },
    onError: (error: Error) =>
      toast({ variant: 'error', title: '绑定失败', description: error.message }),
  })

  const unbind = useMutation({
    mutationFn: () => modelPricingApi.unbind(connectionId, modelId),
    onSuccess: () => {
      toast({ variant: 'success', title: '已解绑定价' })
      refresh()
    },
    onError: (error: Error) =>
      toast({ variant: 'error', title: '解绑失败', description: error.message }),
  })

  const detail: ModelPricingDetail | undefined = detailQuery.data
  const pricing = detail?.pricing
  const back = historyQuery.data?.backCompute
  const busy =
    prefill.isPending || saveManual.isPending || bindCandidate.isPending || unbind.isPending

  const toggleManual = () => {
    if (!manualOpen) {
      setCurrency(pricing?.currency ?? 'USD')
      setDraft(
        Object.fromEntries(
          COST_FIELDS.map((field) => [
            field.key,
            pricing?.cost?.[field.key] === null || pricing?.cost?.[field.key] === undefined
              ? ''
              : String(pricing.cost[field.key]),
          ]),
        ),
      )
    }
    setManualOpen((open) => !open)
  }

  return (
    <section
      data-testid={`model-pricing-${model.id}`}
      className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="truncate font-mono text-xs text-[var(--nx-text-primary)]"
            title={model.modelName}
          >
            {model.modelName}
          </span>
          {!model.isActive ? (
            <span className="rounded-sm bg-[var(--nx-bg-2)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
              已停用
            </span>
          ) : null}
        </div>

        {pricing?.hasPricing ? (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="whitespace-nowrap rounded-sm bg-[rgba(16,185,129,0.12)] px-1.5 py-0.5 text-[var(--nx-status-success)]">
              {DECIDED_BY_LABELS[pricing.decidedBy ?? ''] ?? '已定价'}
            </span>
            {pricing.approximate ? (
              <span
                data-testid={`pricing-approximate-${model.id}`}
                className="whitespace-nowrap rounded-sm bg-[rgba(245,158,11,0.14)] px-1.5 py-0.5 text-[var(--nx-status-warning)]"
                title="并非该中转的实际结算价，按同名/自有条目近似"
              >
                近似价
              </span>
            ) : null}
            <span className="whitespace-nowrap font-mono text-[var(--nx-text-secondary)]">
              {pricing.currency}/百万token · {formatPrice(pricing.cost)}
            </span>
          </div>
        ) : (
          <span
            data-testid={`pricing-missing-${model.id}`}
            className="whitespace-nowrap rounded-sm bg-[var(--nx-bg-2)] px-1.5 py-0.5 text-[11px] text-[var(--nx-text-muted)]"
          >
            未定价
          </span>
        )}
      </div>

      {/* 历史用量回算：账本历史行不改写，这里按当前单价投影 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--nx-text-muted)]">
        {!historyOpen ? (
          <button
            type="button"
            data-testid={`load-back-compute-${model.id}`}
            onClick={() => setHistoryOpen(true)}
            className="rounded border border-[var(--nx-border-hairline)] px-2 py-1 text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            查看历史用量回算
          </button>
        ) : historyQuery.isLoading ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> 读取历史用量…
          </span>
        ) : back ? (
          <>
            <span>
              历史调用{' '}
              <span className="font-mono text-[var(--nx-text-secondary)]">{back.calls}</span> 次 ·
              token{' '}
              <span className="font-mono text-[var(--nx-text-secondary)]">
                {formatTokens(back.tokens.total)}
              </span>
            </span>
            <span data-testid={`back-compute-${model.id}`}>
              按当前单价回算：
              <span className="ml-1 font-mono text-[var(--nx-text-primary)]">
                {formatCost(back.estimatedCost, back.currency)}
              </span>
              {back.approximate ? <span className="ml-1">（近似价）</span> : null}
            </span>
            {back.unpricedCalls > 0 ? (
              <span title="这些历史行落库时没有定价，改价不会追溯改写它们">
                其中 {back.unpricedCalls} 次当时未定价
              </span>
            ) : null}
          </>
        ) : (
          <span>历史用量读取失败</span>
        )}
        {pricing?.reason ? <span className="truncate">理由：{pricing.reason}</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid={`pricing-prefill-${model.id}`}
          disabled={!canManage || busy}
          onClick={() => prefill.mutate()}
          className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
        >
          {prefill.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin text-[var(--nx-accent)]" />
          ) : (
            <Sparkles className="h-3 w-3 text-[var(--nx-accent)]" />
          )}
          自动预填
        </button>

        <button
          type="button"
          data-testid={`pricing-candidates-${model.id}`}
          disabled={!canManage}
          onClick={() => setCandidatesOpen((open) => !open)}
          className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
        >
          <Bot className="h-3 w-3" aria-hidden />
          目录候选
        </button>

        <button
          type="button"
          data-testid={`pricing-manual-${model.id}`}
          disabled={!canManage}
          onClick={toggleManual}
          className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
        >
          人工填写
        </button>

        {pricing?.hasPricing ? (
          <button
            type="button"
            data-testid={`pricing-unbind-${model.id}`}
            disabled={!canManage || busy}
            onClick={() => unbind.mutate()}
            className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-muted)] transition-colors hover:border-[rgba(239,68,68,0.4)] hover:text-[var(--nx-status-danger)] disabled:opacity-50"
          >
            <Unlink className="h-3 w-3" aria-hidden />
            解绑
          </button>
        ) : null}
      </div>

      {manualOpen ? (
        <div className="flex flex-col gap-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-[var(--nx-text-muted)]">币种</label>
            <input
              type="text"
              data-testid={`pricing-currency-${model.id}`}
              value={currency}
              placeholder="USD"
              onChange={(event) => setCurrency(normalizeCurrencyInput(event.target.value))}
              className="w-20 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1 text-[11px] uppercase text-[var(--nx-text-primary)]"
            />
            <span className="text-[11px] text-[var(--nx-text-muted)]">单位：每 1M token</span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {COST_FIELDS.map((field) => (
              <label key={field.key} className="flex flex-col gap-1">
                <span className="text-[11px] text-[var(--nx-text-muted)]">{field.label}</span>
                <input
                  type="number"
                  min={0}
                  step="0.0001"
                  data-testid={`pricing-input-${field.key}-${model.id}`}
                  value={draft[field.key] ?? ''}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                  className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1 text-[11px] text-[var(--nx-text-primary)]"
                />
              </label>
            ))}
          </div>

          <p className="text-[11px] leading-4 text-[var(--nx-text-muted)]">
            缓存、音频或推理价留空时，会按已包含在输入/输出 token
            中处理；只有供应商单独计价时才填写。
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid={`pricing-save-${model.id}`}
              disabled={busy}
              onClick={() => saveManual.mutate()}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded px-2.5 text-xs transition-colors disabled:opacity-50',
                'bg-[var(--nx-accent)]/15 text-[var(--nx-accent)] hover:bg-[var(--nx-accent)]/25',
              )}
            >
              {saveManual.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" aria-hidden />
              )}
              保存人工定价
            </button>
            <span className="text-[11px] text-[var(--nx-text-muted)]">
              人工定价优先，自动预填不会覆盖它。
            </span>
          </div>
        </div>
      ) : null}

      {candidatesOpen ? (
        <CandidateList
          connectionId={connectionId}
          modelId={modelId}
          onPick={bindCandidate}
          busy={busy}
        />
      ) : null}
    </section>
  )
}

function CandidateList({
  connectionId,
  modelId,
  onPick,
  busy,
}: {
  connectionId: number
  modelId: number
  onPick: { mutate: (candidate: ModelPricingCandidate) => void }
  busy: boolean
}) {
  const candidatesQuery = useQuery({
    queryKey: ['ai', 'model-pricing-candidates', connectionId, modelId],
    queryFn: () => modelPricingApi.candidates(connectionId, modelId),
  })

  return (
    <div className="flex flex-col gap-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
      {candidatesQuery.isLoading ? (
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> 读取目录候选…
        </span>
      ) : !candidatesQuery.data ? (
        <span className="text-[11px] text-[var(--nx-status-danger)]">目录候选读取失败</span>
      ) : candidatesQuery.data.candidates.length === 0 ? (
        <p className="text-[11px] text-[var(--nx-text-muted)]">
          目录里没有同名条目，请用「人工填写」录入实际结算单价。
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {candidatesQuery.data.candidates.map((candidate) => (
            <li
              key={`${candidate.providerId}:${candidate.modelId}`}
              className="flex flex-wrap items-center justify-between gap-2 text-[11px]"
            >
              <span className="min-w-0 truncate text-[var(--nx-text-secondary)]">
                <span className="font-mono">{candidate.providerId}</span> · {candidate.modelId} ·{' '}
                {formatPrice(candidate.cost)}
                {candidate.endpointMatched ? ' 〔端点命中〕' : ''}
                {candidate.providerBranded ? ' 〔自有条目〕' : ''}
              </span>
              <button
                type="button"
                data-testid={`pricing-pick-${candidate.providerId}-${modelId}`}
                disabled={busy}
                onClick={() => onPick.mutate(candidate)}
                className="h-6 shrink-0 whitespace-nowrap rounded border border-[var(--nx-border-hairline)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                用这条
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default ModelPricingDialog
