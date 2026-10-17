'use client'

import * as React from 'react'
import {
  BadgeCheck,
  CircleAlert,
  Layers,
  Lock,
  PlayCircle,
  RefreshCw,
  Route,
  ShieldAlert,
} from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/hooks/use-permissions'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { selectPlanTier, useAuthStore } from '@/stores/auth-store'
import { useRoutingRules, useRoutingSimulate } from '@/hooks/use-compiler-routing'
import { compilerRoutingApi } from '@/lib/api/compiler-routing'
import { COMPILER_ROUTING_QUERY_KEYS } from '@/lib/api/compiler-routing-query-keys'
import type {
  CompilerScenarioKind,
  RoutingRuleAuthoringRequest,
  RoutingRulePreviewResponse,
  RoutingRuleView,
} from '@aiproj/types/compiler-dynamic-routing'

/**
 * 编译器路由管理工作区（/next/admin/compiler-routing，
 * v3-ui-next-settings-admin-domains W7 · tasks 7.4/7.6）。
 *
 * - 数据 100% 复用既有 `useRoutingRules`（GET `/ai/compiler/routing/rules`）与
 *   `useRoutingSimulate`（POST `/ai/compiler/routing/simulate`，dry-run 零副作用）；
 * - 三切片：规则查看器（`ai:compiler:routing:view`）→ 模拟面板（只读诊断）→
 *   规则编辑器（仅 `ai:compiler:routing:manage` 可见）；
 * - 落库纪律（RL-01/RL-06）：编辑器必须先「模拟预览」产出差异，再经显式二次确认
 *   才携带 confirmToken 调用 PATCH 落库；未预览 / 未确认一律不发写请求；
 * - 路由运行统计只读区：注册表版本 / 规则数 / 启用停用 / 来源分布（既有快照派生，
 *   不新增端点）；RL-12 禁存 prompt/输出全文，模拟输入仅含场景与 stage 元数据；
 * - 三态：骨架（aria-busy）/ 语义空态 / 错误卡「重新载入」；精确档剥离氛围光晕（RL-15）。
 */

const SCENARIO_KINDS: readonly CompilerScenarioKind[] = [
  'default_plan',
  'lightweight_draft',
  'deterministic_validation',
  'artifact_review',
]

const KNOWN_STAGES = ['intent_ingestion', 'intent_parsing', 'dag_stub'] as const

type RoutingTab = 'rules' | 'simulate' | 'editor'

function NoticeCard({
  testId,
  icon: Icon,
  title,
  description,
  tone = 'var(--nx-text-muted)',
}: {
  testId: string
  icon: React.ComponentType<{
    className?: string
    'aria-hidden'?: boolean
    style?: React.CSSProperties
  }>
  title: string
  description: string
  tone?: string
}) {
  return (
    <div
      data-permission-fallback
      data-testid={testId}
      className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
    >
      <Icon className="h-8 w-8" aria-hidden style={{ color: tone }} />
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">{title}</h3>
      <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">{description}</p>
    </div>
  )
}

/** 企业版锁定占位（free 档且无路由查看权）：零请求。 */
export function CompilerRoutingLockedNotice() {
  return (
    <div data-enterprise-locked>
      <NoticeCard
        testId="compiler-routing-locked"
        icon={Lock}
        title="企业版能力 · 编译器路由管理"
        description="编译器路由管理面向 team / enterprise 组织开放。当前组织为免费档，升级套餐并授予 ai:compiler:routing:view 后可用；此处不发起任何数据请求。"
      />
    </div>
  )
}

/** 受限横幅（付费档但无路由查看权）：零请求。 */
export function CompilerRoutingRestrictedNotice() {
  return (
    <NoticeCard
      testId="compiler-routing-restricted"
      icon={ShieldAlert}
      tone="var(--nx-status-warning)"
      title="没有查看路由管理的权限"
      description="需要 ai:compiler:routing:view 权限方可查看编译器路由规则注册表。请联系系统管理员授予权限。"
    />
  )
}

export function CompilerRoutingWorkspace() {
  const { can } = usePermissions()
  const planTier = useAuthStore(selectPlanTier)

  if (!can('ai:compiler:routing:view')) {
    return planTier === 'free' ? (
      <CompilerRoutingLockedNotice />
    ) : (
      <CompilerRoutingRestrictedNotice />
    )
  }

  return <CompilerRoutingConsole />
}

function CompilerRoutingConsole() {
  const tier = useImmersionTier()
  const { can } = usePermissions()
  const [tab, setTab] = React.useState<RoutingTab>('rules')
  const canManage = can('ai:compiler:routing:manage')

  const tabs: ReadonlyArray<{ id: RoutingTab; label: string }> = [
    { id: 'rules', label: '规则注册表' },
    { id: 'simulate', label: '路由模拟' },
    ...(canManage ? [{ id: 'editor' as const, label: '规则编排' }] : []),
  ]

  return (
    <section
      data-compiler-routing-workspace
      data-immersion={tier}
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-workspace-bg)]',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Route className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">编译器路由</h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              路由规则注册表 · dry-run 模拟诊断 · 受控规则编排（预览 → 确认 → 落库）
            </p>
          </div>
        </div>
        <span className="text-[11px] text-[var(--nx-text-muted)]">
          模拟为只读诊断：不执行 stage、不写库、不调用真实模型
        </span>
      </header>

      <div
        role="tablist"
        aria-label="路由管理切片"
        data-routing-tabs
        className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-1"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            data-routing-tab={item.id}
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'h-7 rounded-sm px-3 text-xs transition-colors',
              tab === item.id
                ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'rules' ? <RoutingRulesSection /> : null}
      {tab === 'simulate' ? <RoutingSimulateSection /> : null}
      {tab === 'editor' && canManage ? <RoutingEditorSection /> : null}
    </section>
  )
}

/** origin 归一化：`apiFetch` 已解包 `{data}` 信封，hook 返回值可能仍为信封形态。 */
function normalizeSnapshot(payload: unknown): { version: string; rules: RoutingRuleView[] } | null {
  if (!payload || typeof payload !== 'object') return null
  const outer = payload as {
    data?: unknown
    version?: unknown
    rules?: unknown
    ruleCount?: unknown
  }
  const inner =
    outer.version === undefined && outer.data && typeof outer.data === 'object'
      ? (outer.data as { version?: unknown; rules?: unknown })
      : outer
  const rules = Array.isArray(inner.rules) ? (inner.rules as RoutingRuleView[]) : []
  const version = typeof inner.version === 'string' ? inner.version : 'unknown'
  return { version, rules }
}

/** origin 归一化：模拟响应同样兼容信封/已解包两种形态。 */
function normalizeSimulate(payload: unknown): {
  decision: {
    reasonCode: string
    selectedStageIds: string[]
    skippedStageIds: string[]
    selectedStageCount: number
    originalStageCount: number
    isFallback: boolean
  }
  valid: boolean
  errors: string[]
  noSideEffect: boolean
} | null {
  if (!payload || typeof payload !== 'object') return null
  const outer = payload as { data?: unknown } & Record<string, unknown>
  const inner = (outer.data && typeof outer.data === 'object' ? outer.data : outer) as Record<
    string,
    unknown
  >
  const decision = inner.decision as Record<string, unknown> | undefined
  if (!decision) return null
  return {
    decision: {
      reasonCode: String(decision.reasonCode ?? ''),
      selectedStageIds: Array.isArray(decision.selectedStageIds)
        ? (decision.selectedStageIds as string[])
        : [],
      skippedStageIds: Array.isArray(decision.skippedStageIds)
        ? (decision.skippedStageIds as string[])
        : [],
      selectedStageCount: Number(decision.selectedStageCount ?? 0),
      originalStageCount: Number(decision.originalStageCount ?? 0),
      isFallback: Boolean(decision.isFallback),
    },
    valid: Boolean(inner.valid),
    errors: Array.isArray(inner.errors) ? (inner.errors as string[]) : [],
    noSideEffect: inner.noSideEffect !== false,
  }
}

function RoutingRulesSection() {
  const query = useRoutingRules()

  if (query.isLoading) {
    return (
      <div data-routing-rules-loading role="status" aria-busy="true" aria-label="正在加载路由规则">
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-20 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
            />
          ))}
        </div>
      </div>
    )
  }

  if (query.isError) {
    return (
      <div
        data-routing-rules-error
        role="alert"
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-10 text-center"
      >
        <CircleAlert className="h-6 w-6 text-[var(--nx-status-danger)]" aria-hidden />
        <p className="text-xs text-[var(--nx-text-secondary)]">路由规则注册表加载失败。</p>
        <button
          type="button"
          data-routing-rules-retry
          onClick={() => void query.refetch()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          重新载入
        </button>
      </div>
    )
  }

  const snapshot = normalizeSnapshot(query.data)
  if (!snapshot || snapshot.rules.length === 0) {
    return (
      <div
        data-routing-rules-empty
        className="rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-10 text-center text-xs text-[var(--nx-text-muted)]"
      >
        当前无注册的路由规则，编译器将使用默认执行计划。
      </div>
    )
  }

  const enabledCount = snapshot.rules.filter((rule) => rule.enabled).length
  const defaultCount = snapshot.rules.filter((rule) => rule.isDefault).length
  const orgCount = snapshot.rules.filter((rule) => rule.source === 'org_persisted').length

  return (
    <div className="flex flex-col gap-3" data-routing-rules>
      <section
        data-routing-stats
        aria-label="路由运行统计（只读）"
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
      >
        <RoutingStat id="version" label="注册表版本" value={snapshot.version} />
        <RoutingStat id="total" label="规则总数" value={String(snapshot.rules.length)} />
        <RoutingStat
          id="enabled"
          label="启用 / 停用"
          value={`${enabledCount} / ${snapshot.rules.length - enabledCount}`}
        />
        <RoutingStat
          id="source"
          label="组织持久化 / 代码默认"
          value={`${orgCount} / ${defaultCount}`}
        />
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        {snapshot.rules.map((rule) => (
          <article
            key={rule.id}
            data-routing-rule={rule.id}
            className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">{rule.id}</h3>
              <RoutingBadge
                label={rule.enabled ? '启用' : '停用'}
                tone={rule.enabled ? 'ok' : 'off'}
              />
              {rule.isDefault ? <RoutingBadge label="默认" tone="info" /> : null}
              <RoutingBadge
                label={rule.source === 'code_default' ? '代码默认' : '组织持久化'}
                tone="info"
              />
            </div>
            <dl className="mt-2 flex flex-col gap-1 text-[11px] text-[var(--nx-text-secondary)]">
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--nx-text-muted)]">版本</dt>
                <dd className="font-mono">
                  {rule.version.major}.{rule.version.minor}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--nx-text-muted)]">场景</dt>
                <dd className="text-right">{rule.scenarioKinds.join('、') || '（无）'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--nx-text-muted)]">选择 stage</dt>
                <dd className="text-right">{rule.allowedStageIds.join('、') || '（无）'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--nx-text-muted)]">跳过 stage</dt>
                <dd className="text-right">{rule.allowedSkippedStageIds.join('、') || '（无）'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[var(--nx-text-muted)]">Reason</dt>
                <dd className="font-mono">{rule.reasonCode}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  )
}

function RoutingStat({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div
      data-routing-stat={id}
      className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-3"
    >
      <p className="truncate font-mono text-sm font-semibold text-[var(--nx-text-primary)]">
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">{label}</p>
    </div>
  )
}

function RoutingBadge({ label, tone }: { label: string; tone: 'ok' | 'off' | 'info' }) {
  const color =
    tone === 'ok'
      ? 'var(--nx-status-success)'
      : tone === 'off'
        ? 'var(--nx-text-muted)'
        : 'var(--nx-accent)'
  return (
    <span
      data-routing-badge={tone}
      className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px]"
      style={{ color }}
    >
      {label}
    </span>
  )
}

function RoutingSimulateSection() {
  const [scenarioKind, setScenarioKind] = React.useState<CompilerScenarioKind>('default_plan')
  const [input, setInput] = React.useState<{
    scenarioKind: CompilerScenarioKind
    candidateStageIds: string[]
    availableHandlerStageIds: string[]
    contractVersion: string
    dependencies: { stageId: string; dependsOn: string[] }[]
  } | null>(null)
  const query = useRoutingSimulate(input)
  const result = normalizeSimulate(query.data)

  return (
    <div className="flex flex-col gap-3" data-routing-simulate>
      <p
        data-routing-simulate-disclaimer
        className="rounded-md border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.07)] px-3 py-2 text-[11px] leading-relaxed text-[var(--nx-status-warning)]"
      >
        模拟为只读诊断：不执行任何 stage、不写入数据、不调用真实模型；输入仅含场景类型与 stage
        元数据（不含任何 prompt 或模型输出，RL-12）。
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
          场景类型
          <select
            data-routing-simulate-scenario
            value={scenarioKind}
            onChange={(event) => setScenarioKind(event.target.value as CompilerScenarioKind)}
            className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-primary)]"
          >
            {SCENARIO_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-routing-simulate-run
          disabled={query.isLoading}
          onClick={() =>
            setInput({
              scenarioKind,
              candidateStageIds: [...KNOWN_STAGES],
              availableHandlerStageIds: [...KNOWN_STAGES],
              contractVersion: '2.0',
              dependencies: [
                { stageId: 'intent_parsing', dependsOn: ['intent_ingestion'] },
                { stageId: 'dag_stub', dependsOn: ['intent_ingestion', 'intent_parsing'] },
              ],
            })
          }
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] disabled:opacity-40"
        >
          <PlayCircle className="h-3.5 w-3.5" aria-hidden />
          {query.isLoading ? '模拟中…' : '执行模拟'}
        </button>
      </div>

      {query.isLoading ? (
        <div
          data-routing-simulate-loading
          role="status"
          aria-busy="true"
          className="h-28 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
        />
      ) : null}

      {query.isError ? (
        <div
          data-routing-simulate-error
          role="alert"
          className="rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-5 py-6 text-xs text-[var(--nx-text-secondary)]"
        >
          模拟失败，请检查输入后重试。
        </div>
      ) : null}

      {result ? (
        <div
          data-routing-simulate-result
          className="flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4 text-[11px] text-[var(--nx-text-secondary)]"
        >
          <div className="flex flex-wrap items-center gap-2">
            <RoutingBadge
              label={result.valid ? '有效' : '无效'}
              tone={result.valid ? 'ok' : 'off'}
            />
            <RoutingBadge label="noSideEffect" tone="info" />
          </div>
          <p>Reason：{result.decision.reasonCode}</p>
          <p>选中 stage：{result.decision.selectedStageIds.join('、') || '（无）'}</p>
          <p>跳过 stage：{result.decision.skippedStageIds.join('、') || '（无）'}</p>
          <p>
            选中/原始：
            {result.decision.selectedStageCount}/{result.decision.originalStageCount} · Fallback：
            {result.decision.isFallback ? '是' : '否'}
          </p>
          {result.errors.length > 0 ? (
            <ul className="mt-1 list-disc pl-4 text-[var(--nx-status-danger)]">
              {result.errors.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** origin 归一化：预览响应兼容信封/已解包两种形态，避免共享 api 客户端解包语义漂移。 */
function normalizePreview(payload: unknown): RoutingRulePreviewResponse | null {
  if (!payload || typeof payload !== 'object') return null
  const outer = payload as { data?: unknown; confirmToken?: unknown }
  const inner = (
    outer.confirmToken === undefined && outer.data && typeof outer.data === 'object'
      ? outer.data
      : outer
  ) as Partial<RoutingRulePreviewResponse>
  if (!inner || typeof inner !== 'object' || !inner.after) return null
  return inner as RoutingRulePreviewResponse
}

/** 规则编排：草稿 → 模拟预览（必做）→ 二次确认 → confirmToken 落库。 */
function RoutingEditorSection() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = React.useState<RoutingRuleAuthoringRequest | null>(null)
  const [preview, setPreview] = React.useState<RoutingRulePreviewResponse | null>(null)
  const [confirming, setConfirming] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const previewMutation = useMutation({
    mutationFn: (request: RoutingRuleAuthoringRequest) => compilerRoutingApi.previewRule(request),
    onSuccess: (response) => {
      setError(null)
      setPreview(normalizePreview(response))
    },
    onError: (mutationError) => {
      setPreview(null)
      setError((mutationError as { message?: string }).message ?? '预览失败')
    },
  })

  const confirmMutation = useMutation({
    mutationFn: (confirmToken: string) => compilerRoutingApi.confirmRule(confirmToken),
    onSuccess: () => {
      setPreview(null)
      setDraft(null)
      setConfirming(false)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: COMPILER_ROUTING_QUERY_KEYS.rules() })
    },
    onError: (mutationError) => {
      setConfirming(false)
      setError((mutationError as { message?: string }).message ?? '落库失败')
    },
  })

  // 落库二次确认弹：在途 confirmToken 提交时拒绝 Escape 关闭（与「取消」按钮可点状态同口径）。
  const commitDialogRef = React.useRef<HTMLElement | null>(null)
  useDialogA11y({
    ref: commitDialogRef,
    open: confirming && preview !== null,
    onClose: () => setConfirming(false),
    canClose: () => !confirmMutation.isPending,
  })

  function startNewRule() {
    setDraft({
      id: 'custom-rule-v1',
      version: { major: 1, minor: 0 },
      compatibleContracts: { min: '1.0', max: '2.0' },
      scenarioKinds: ['default_plan'],
      allowedStageIds: ['intent_ingestion'],
      allowedSkippedStageIds: [],
      reasonCode: 'ROUTE_MATCHED',
      enabled: true,
    })
    setPreview(null)
    setError(null)
  }

  if (!draft) {
    return (
      <div className="flex flex-col gap-3" data-routing-editor-idle>
        <p className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
          规则变更属受控写：必须先运行「预览变更」查看差异，再经显式确认落库；未确认离开不会保存。
        </p>
        <button
          type="button"
          data-routing-editor-new
          onClick={startNewRule}
          className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)]"
        >
          <Layers className="h-3.5 w-3.5" aria-hidden />
          新建规则草稿
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-routing-editor>
      <p
        data-routing-editor-disclaimer
        className="rounded-md border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.07)] px-3 py-2 text-[11px] leading-relaxed text-[var(--nx-status-warning)]"
      >
        ⚠️ 规则变更属写入动作：必须经预览/差异 → 显式确认 → 审计后才落库。未确认离开不会保存。
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-[11px] text-[var(--nx-text-muted)]">
          规则 ID
          <input
            data-routing-editor-id
            value={draft.id}
            onChange={(event) => {
              setDraft({ ...draft, id: event.target.value })
              setPreview(null)
            }}
            className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)]"
          />
        </label>
        <div className="flex flex-col gap-1 text-[11px] text-[var(--nx-text-muted)]">
          版本
          <p className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs leading-8 text-[var(--nx-text-primary)]">
            {draft.version.major}.{draft.version.minor}
          </p>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[11px] text-[var(--nx-text-muted)]">场景类型</legend>
        <div className="flex flex-wrap gap-3">
          {SCENARIO_KINDS.map((kind) => (
            <label
              key={kind}
              className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-secondary)]"
            >
              <input
                type="checkbox"
                data-routing-editor-scenario={kind}
                checked={draft.scenarioKinds.includes(kind)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...draft.scenarioKinds, kind]
                    : draft.scenarioKinds.filter((item) => item !== kind)
                  setDraft({ ...draft, scenarioKinds: next })
                  setPreview(null)
                }}
              />
              {kind}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[11px] text-[var(--nx-text-muted)]">选择 stage</legend>
        <div className="flex flex-wrap gap-3">
          {KNOWN_STAGES.map((stage) => (
            <label
              key={stage}
              className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-secondary)]"
            >
              <input
                type="checkbox"
                data-routing-editor-stage={stage}
                checked={draft.allowedStageIds.includes(stage)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...draft.allowedStageIds, stage]
                    : draft.allowedStageIds.filter((item) => item !== stage)
                  setDraft({ ...draft, allowedStageIds: next })
                  setPreview(null)
                }}
              />
              {stage}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-[11px] text-[var(--nx-text-secondary)]">
        <input
          type="checkbox"
          data-routing-editor-enabled
          checked={draft.enabled}
          onChange={(event) => {
            setDraft({ ...draft, enabled: event.target.checked })
            setPreview(null)
          }}
        />
        启用该规则
      </label>

      {error ? (
        <p
          data-routing-editor-error
          role="alert"
          className="rounded-md border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[11px] text-[var(--nx-status-danger)]"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-routing-editor-preview
          disabled={previewMutation.isPending}
          onClick={() => previewMutation.mutate(draft)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] disabled:opacity-40"
        >
          {previewMutation.isPending ? '预览中…' : '预览变更'}
        </button>
        <button
          type="button"
          data-routing-editor-discard
          onClick={() => {
            setDraft(null)
            setPreview(null)
            setError(null)
          }}
          className="inline-flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)]"
        >
          取消
        </button>
        <button
          type="button"
          data-routing-editor-confirm
          disabled={!preview || confirmMutation.isPending}
          onClick={() => setConfirming(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-primary)] disabled:opacity-40"
        >
          <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
          确认并落库
        </button>
      </div>

      {preview ? (
        <div
          data-routing-editor-preview-result
          className="flex flex-col gap-1.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4 text-[11px] text-[var(--nx-text-secondary)]"
        >
          <div className="flex items-center gap-2">
            <RoutingBadge label="previewOnly" tone="info" />
          </div>
          {preview.before ? (
            <p>
              旧规则：{preview.before.id} · 场景 {preview.before.scenarioKinds.join('、')} ·
              {preview.before.enabled ? ' 启用' : ' 停用'}
            </p>
          ) : (
            <p className="text-[var(--nx-text-muted)]">（新增规则，无旧版本）</p>
          )}
          <p>
            新规则：{preview.after.id} · 场景 {preview.after.scenarioKinds.join('、') || '（无）'} ·
            {preview.after.enabled ? ' 启用' : ' 停用'}
          </p>
          <p>
            选择 stage：{preview.after.allowedStageIds.join('、') || '无'} · 跳过：
            {preview.after.allowedSkippedStageIds.join('、') || '无'}
          </p>
          <p>受影响场景：{preview.affectedScenarioKinds.join('、') || '（无）'}</p>
        </div>
      ) : null}

      {confirming && preview ? (
        <div className="fixed inset-0 z-50" role="presentation">
          <button
            type="button"
            aria-label="关闭规则落库确认"
            tabIndex={-1}
            onClick={() => setConfirming(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="确认路由规则落库"
            data-testid="routing-commit-dialog"
            ref={commitDialogRef}
            tabIndex={-1}
            className="absolute left-1/2 top-1/2 flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-5 shadow-[0_0_48px_rgba(0,0,0,0.5)]"
          >
            <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
              确认路由规则落库
            </h3>
            <p className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
              确认后将携带预览凭证落库并写入审计；受影响场景：
              {preview.affectedScenarioKinds.join('、') || '（无）'}。取消则不发送任何写请求。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-routing-commit-cancel
                onClick={() => setConfirming(false)}
                className="inline-flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)]"
              >
                取消
              </button>
              <button
                type="button"
                data-routing-commit-submit
                disabled={confirmMutation.isPending}
                onClick={() => confirmMutation.mutate(preview.confirmToken)}
                className="inline-flex h-8 items-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-text-primary)] disabled:opacity-40"
              >
                {confirmMutation.isPending ? '提交中…' : '确认并落库'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export { CompilerRoutingWorkspace as default }
