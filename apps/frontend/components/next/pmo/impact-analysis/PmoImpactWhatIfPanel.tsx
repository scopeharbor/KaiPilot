'use client'

import * as React from 'react'
import { GitCompareArrows, Loader2, ShieldAlert, TriangleAlert } from 'lucide-react'
import {
  useMultiProjectImpactSnapshot,
  useWhatIfMultiProjectImpact,
} from '@/hooks/use-multi-project-impact-analysis'
import { cn } from '@/lib/utils'
import type {
  MultiProjectImpactScenarioType,
  MultiProjectImpactSnapshot,
  MultiProjectImpactWhatIfOutput,
  MultiProjectImpactWhatIfResponse,
} from '@aiproj/types'
import { MULTI_PROJECT_IMPACT_SCENARIO_TYPES } from '@aiproj/types'
import { IMPACT_SEVERITY_META } from './PmoImpactSnapshotList'

/** 快照可见受影响端点收敛（type:id 去重；脱敏端点不进入候选，RL-05）。 */
function visibleEndpointCandidatesOf(snapshot: MultiProjectImpactSnapshot): Array<{
  ref: string
  type: string
  id: number
  label: string
}> {
  const seen = new Set<string>()
  const options: Array<{ ref: string; type: string; id: number; label: string }> = []
  for (const path of snapshot.propagationSummary.propagationPaths) {
    for (const endpoint of path.affectedEndpoints) {
      if (endpoint.visibility !== 'visible') continue
      const ref = `${endpoint.endpointType}:${endpoint.endpointId}`
      if (seen.has(ref)) continue
      seen.add(ref)
      options.push({
        ref,
        type: endpoint.endpointType,
        id: endpoint.endpointId,
        label: `${endpoint.endpointLabel}（${endpoint.projectLabel}）`,
      })
    }
  }
  return options
}

// 场景元数据（字段配置与自动假设文案；kind select 字段静态选项）
const SCENARIO_FIELD_META: Record<
  MultiProjectImpactScenarioType,
  {
    label: string
    fields: Array<{
      key: string
      kind: 'number' | 'text' | 'select'
      label: string
      defaultValue: string
      options?: Array<{ value: string; label: string }>
    }>
    buildAssumption: (values: Record<string, string>) => string
  }
> = {
  delay: {
    label: '延期（delay）',
    fields: [{ key: 'delayDays', kind: 'number', label: '延期天数', defaultValue: '7' }],
    buildAssumption: (v) => `假设目标端点延期 ${v.delayDays ?? '0'} 天`,
  },
  status_change: {
    label: '状态变更（status_change）',
    fields: [{ key: 'newStatus', kind: 'text', label: '目标状态', defaultValue: 'paused' }],
    buildAssumption: (v) => `假设目标端点状态调整为 ${v.newStatus ?? '（未填）'}`,
  },
  dependency_disablement: {
    label: '依赖停用（dependency_disablement）',
    fields: [
      { key: 'dependencyIdToDisable', kind: 'number', label: '停用依赖 ID', defaultValue: '' },
    ],
    buildAssumption: (v) => `假设停用依赖 #${v.dependencyIdToDisable ?? '（未填）'}`,
  },
  buffer_adjustment: {
    label: '缓冲调整（buffer_adjustment）',
    fields: [
      {
        key: 'bufferAdjustmentDays',
        kind: 'number',
        label: '缓冲调整天数（可负）',
        defaultValue: '0',
      },
    ],
    buildAssumption: (v) => `假设缓冲调整 ${v.bufferAdjustmentDays ?? '0'} 天`,
  },
  dependency_risk_change: {
    label: '依赖风险变化（dependency_risk_change）',
    fields: [
      {
        key: 'newRiskLevel',
        kind: 'select',
        label: '新风险级',
        defaultValue: 'high',
        options: [
          { value: 'critical', label: '危急' },
          { value: 'high', label: '高' },
          { value: 'medium', label: '中' },
          { value: 'low', label: '低' },
        ],
      },
    ],
    buildAssumption: (v) => `假设依赖风险升至 ${v.newRiskLevel ?? '（未填）'}`,
  },
  endpoint_completion_assumption: {
    label: '端点完成假设（endpoint_completion_assumption）',
    fields: [
      {
        key: 'completionAssumption',
        kind: 'text',
        label: '完成假设（如 delayed_until_freeze）',
        defaultValue: '',
      },
    ],
    buildAssumption: (v) => `假设端点完成状态：${v.completionAssumption ?? '（未填）'}`,
  },
}

const SCENARIO_DEFAULTS: Record<MultiProjectImpactScenarioType, Record<string, string>> = {
  delay: { delayDays: '7' },
  status_change: { newStatus: 'paused' },
  dependency_disablement: { dependencyIdToDisable: '' },
  buffer_adjustment: { bufferAdjustmentDays: '0' },
  dependency_risk_change: { newRiskLevel: 'high' },
  endpoint_completion_assumption: { completionAssumption: '' },
}

export interface PmoImpactWhatIfPanelProps {
  organizationId: number
  snapshotId: number
}

/**
 * What-if 试算面板（v3-ui-next-pmo-domain W8 · tasks 8.4，
 * spec「多项目影响分析工作台」What-if 只读试算）。
 *
 * - 场景类型（MultiProjectImpactScenarioType 闭集）+ 目标端点（快照可见受影响
 *   端点收敛）+ 场景参数输入 → `useWhatIfMultiProjectImpact` 只读试算；
 * - 回放结果：基线 vs 场景输出、严重度增量、变更端点统计；全程仅允许
 *   list/detail GET 与 /what-if 试算 POST，零业务写（RL-01）；
 * - 目标端点无可见候选时禁用试算并诚实提示；`isHypothetical / isApplied=false`
 *   以双通道呈现「未应用任何变更」。
 */
export function PmoImpactWhatIfPanel({ organizationId, snapshotId }: PmoImpactWhatIfPanelProps) {
  const snapshotQuery = useMultiProjectImpactSnapshot(organizationId, snapshotId)
  const whatIfMutation = useWhatIfMultiProjectImpact(organizationId)

  const [scenarioType, setScenarioType] = React.useState<MultiProjectImpactScenarioType>('delay')
  const [values, setValues] = React.useState<Record<string, string>>({ ...SCENARIO_DEFAULTS.delay })
  const [targetRef, setTargetRef] = React.useState('project:0')
  const [result, setResult] = React.useState<MultiProjectImpactWhatIfResponse | null>(null)

  const snapshot = snapshotQuery.data ?? null

  // 目标端点候选：全部可见受影响端点收敛去重（type:id）
  const endpointOptions = React.useMemo(() => {
    if (!snapshot) return []
    return visibleEndpointCandidatesOf(snapshot)
  }, [snapshot])

  // 快照切换/端点候选变化时收敛 targetRef 到首项
  React.useEffect(() => {
    if (endpointOptions.length > 0) setTargetRef(endpointOptions[0]!.ref)
  }, [endpointOptions])

  const switchScenario = (next: MultiProjectImpactScenarioType) => {
    setScenarioType(next)
    setValues({ ...SCENARIO_DEFAULTS[next] })
    setResult(null)
  }

  const meta = SCENARIO_FIELD_META[scenarioType]
  // 数值参数校验：空串/NaN 一律禁用；delayDays 必须非负（buffer 调整允许负值）。
  const parsedNumericInvalid = meta.fields.some((field) => {
    if (field.kind !== 'number') return false
    const raw = values[field.key] ?? field.defaultValue
    if (raw === '' || Number.isNaN(Number(raw))) return true
    if (field.key === 'delayDays' && Number(raw) < 0) return true
    return false
  })
  const canRun =
    !snapshotQuery.isLoading &&
    snapshotQuery.data !== undefined &&
    endpointOptions.length > 0 &&
    !parsedNumericInvalid &&
    !whatIfMutation.isPending

  const handleRun = () => {
    const target = endpointOptions.find((option) => option.ref === targetRef)
    if (!target) return
    whatIfMutation.mutate(
      {
        snapshotId,
        scenarios: [
          {
            scenarioType,
            assumption: meta.buildAssumption(values),
            targetEndpointType: target.type,
            targetEndpointId: target.id,
            params: values,
          },
        ],
      },
      { onSuccess: (response) => setResult(response) },
    )
  }

  const shellClass = 'flex flex-col gap-3 rounded-xl border border-[var(--nx-border-hairline)] p-4'

  return (
    <section data-imp-whatif className={shellClass}>
      <header className="flex items-center gap-2">
        <GitCompareArrows className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
        <h2 className="text-sm font-semibold text-[var(--nx-text-primary)]">
          What-if 试算 <span className="font-mono text-[var(--nx-text-muted)]">#{snapshotId}</span>
        </h2>
      </header>
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
        <TriangleAlert
          className="mt-0.5 h-3 w-3 shrink-0 text-[var(--nx-status-warning)]"
          aria-hidden
        />
        假设性试算：结果为只读回放，不写入、不修改任何正式计划（RL-01）。
      </p>

      {snapshotQuery.isLoading || snapshotQuery.isPending ? (
        <div data-imp-whatif-loading role="status" aria-busy="true" className="space-y-2">
          <div className="h-8 animate-pulse rounded bg-[var(--nx-bg-1)]" />
          <div className="h-24 animate-pulse rounded bg-[var(--nx-bg-1)]" />
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--nx-text-muted)]">场景类型</span>
              <select
                data-imp-whatif-scenario
                value={scenarioType}
                onChange={(event) => {
                  const next = event.target.value as MultiProjectImpactScenarioType
                  if (SCENARIO_FIELD_META[next]) switchScenario(next)
                }}
                className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              >
                {MULTI_PROJECT_IMPACT_SCENARIO_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {SCENARIO_FIELD_META[type].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--nx-text-muted)]">
                目标端点（受影响实体）
              </span>
              <select
                data-imp-whatif-target
                value={targetRef}
                onChange={(event) => setTargetRef(event.target.value)}
                disabled={endpointOptions.length === 0}
                className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-50"
              >
                {endpointOptions.length === 0 ? (
                  <option value="project:0">（快照无可见受影响端点）</option>
                ) : (
                  endpointOptions.map((option) => (
                    <option key={option.ref} value={option.ref}>
                      {option.label}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>

          {/* 场景参数输入 */}
          <div
            data-imp-whatif-params
            className={cn('grid gap-2', meta.fields.length > 1 ? 'sm:grid-cols-2' : '')}
          >
            {meta.fields.map((field) => (
              <label key={field.key} className="flex flex-col gap-1">
                <span className="text-[11px] text-[var(--nx-text-muted)]">{field.label}</span>
                {field.kind === 'select' ? (
                  <select
                    data-imp-whatif-param={field.key}
                    value={values[field.key] ?? field.defaultValue}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                    className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                  >
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    data-imp-whatif-param={field.key}
                    type={field.kind === 'number' ? 'number' : 'text'}
                    value={values[field.key] ?? field.defaultValue}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                    className={cn(
                      'h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none',
                      field.kind === 'number' ? 'font-mono' : '',
                    )}
                  />
                )}
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-imp-whatif-run
              disabled={!canRun}
              onClick={handleRun}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3.5 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {whatIfMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  试算中…
                </>
              ) : (
                '运行试算'
              )}
            </button>
            {endpointOptions.length === 0 ? (
              <span className="text-[10px] text-[var(--nx-text-muted)]">
                快照无可见受影响端点，暂无可试算目标。
              </span>
            ) : null}
            {parsedNumericInvalid ? (
              <span className="text-[10px] text-[var(--nx-status-danger)]">请输入非负数值。</span>
            ) : null}
          </div>

          {whatIfMutation.isError ? (
            <p
              data-imp-whatif-error
              role="alert"
              className="flex items-start gap-1.5 rounded-md border border-[var(--nx-status-danger)]/30 bg-[var(--nx-status-danger)]/5 px-3 py-2 text-xs text-[var(--nx-status-danger)]"
            >
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {whatIfMutation.error instanceof Error
                ? whatIfMutation.error.message
                : '试算失败，请稍后重试。'}
            </p>
          ) : null}

          {whatIfMutation.isSuccess && result && !whatIfMutation.isPending ? (
            <div data-imp-whatif-result className="flex flex-col gap-2">
              {result.data.map((output, index) => (
                <WhatIfOutputCard key={output.scenarioHash ?? index} output={output} />
              ))}
              {result.meta.isStale ? (
                <p
                  data-imp-whatif-stale-note
                  className="flex items-start gap-1.5 rounded-md border border-[var(--nx-status-warning)]/30 bg-[var(--nx-status-warning)]/5 px-3 py-2 text-[11px] text-[var(--nx-status-warning)]"
                >
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  源快照已过期（{result.meta.staleReason ?? '快照 TTL 过期'}
                  ），试算结果仅供方向性参考。
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

function WhatIfOutputCard({ output }: { output: MultiProjectImpactWhatIfOutput }) {
  const baselineTotal = output.baseline.totalAffected
  const scenarioTotal = output.scenarioOutput.totalAffected
  const delta = scenarioTotal - baselineTotal
  const deltaLabel = delta === 0 ? '无变化' : delta > 0 ? `+${delta}` : String(delta)
  const changedCounts = {
    added: output.changedEndpoints.added.length,
    removed: output.changedEndpoints.removed.length,
    severityChanged: output.changedEndpoints.severityChanged.length,
  }
  const hasSeverityDelta = output.changedEndpoints.severityChanged.length > 0

  return (
    <div className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--nx-text-primary)]">{output.scenario.assumption}</p>
        <span
          data-imp-whatif-hypothetical
          className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-border-focus)]/40 px-1.5 py-0.5 text-[10px] text-[var(--nx-accent)]"
        >
          假设性 · 未应用
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-[var(--nx-bg-0)] px-2 py-1.5">
          <dt className="text-[10px] text-[var(--nx-text-muted)]">基线受影响</dt>
          <dd
            data-imp-whatif-baseline
            className="mt-0.5 font-mono text-sm text-[var(--nx-text-primary)]"
          >
            {baselineTotal}
          </dd>
        </div>
        <div className="rounded-md bg-[var(--nx-bg-0)] px-2 py-1.5">
          <dt className="text-[10px] text-[var(--nx-text-muted)]">场景受影响</dt>
          <dd
            data-imp-whatif-scenario-total
            className="mt-0.5 font-mono text-sm text-[var(--nx-text-primary)]"
          >
            {scenarioTotal}
          </dd>
        </div>
        <div className="rounded-md bg-[var(--nx-bg-0)] px-2 py-1.5">
          <dt className="text-[10px] text-[var(--nx-text-muted)]">增量</dt>
          <dd
            data-imp-whatif-delta
            className={cn(
              'mt-0.5 font-mono text-sm',
              delta > 0
                ? 'text-[var(--nx-status-danger)]'
                : delta < 0
                  ? 'text-[var(--nx-status-success)]'
                  : 'text-[var(--nx-text-muted)]',
            )}
          >
            {deltaLabel}
          </dd>
        </div>
      </dl>
      <p className="mt-1.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
        新增 {changedCounts.added} · 移除 {changedCounts.removed} · 严重度变化{' '}
        {changedCounts.severityChanged}
      </p>
      {hasSeverityDelta ? (
        <ul data-imp-whatif-severity-changes className="mt-1.5 space-y-1">
          {output.changedEndpoints.severityChanged.map((change, index) => {
            const baselineMeta = IMPACT_SEVERITY_META[change.baselineSeverity]
            const newMeta = IMPACT_SEVERITY_META[change.newSeverity]
            return (
              <li
                key={`${change.endpoint.endpointId}-${index}`}
                className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--nx-text-secondary)]"
              >
                {change.endpoint.endpointLabel}
                <span className={cn('font-medium', baselineMeta.tone)}>{baselineMeta.label}</span>→
                <span className={cn('font-medium', newMeta.tone)}>{newMeta.label}</span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

export default PmoImpactWhatIfPanel
