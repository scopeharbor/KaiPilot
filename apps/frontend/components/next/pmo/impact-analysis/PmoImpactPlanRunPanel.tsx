'use client'

import * as React from 'react'
import { CalendarRange, CheckCircle2, Layers, Loader2, Play, ShieldAlert } from 'lucide-react'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { usePermissions } from '@/hooks/use-permissions'
import {
  usePlanMultiProjectImpactAnalysis,
  useRunMultiProjectImpactAnalysis,
} from '@/hooks/use-multi-project-impact-analysis'
import { cn } from '@/lib/utils'
import type { MultiProjectImpactPlan, MultiProjectImpactScope } from '@aiproj/types'

/**
 * 计划→运行两段式向导（v3-ui-next-pmo-domain W8 · tasks 8.2，
 * spec「多项目影响分析工作台」快照生命周期）。
 *
 * - 项目范围（项目 ID 必填）+ 日期窗口（可选）+ 传播深度选择 → plan；
 *   plan 摘要（范围哈希/规则版本/预计成本/警告）→ run（manage 门禁 +
 *   二次确认对话框）；
 * - plan/run/refresh 为写类动作，后端 policy 要求 `multi_project_impact:manage`；
 *   无 manage 时向导只读呈现并禁用（RL-06），提示文案诚实说明 G2 现状；
 * - run 成功后 hook 自动失效 `['organizations',orgId,'multi-project-impact-
 *   analyses']` 列表缓存（快照列表即时刷新），向导回退到初始态；
 * - 默认范围上限与旧页一致：maxNodes 500 / maxEdges 1000 / maxScenarios 5。
 */
export interface PmoImpactPlanRunPanelProps {
  organizationId: number
}

const DEPTH_OPTIONS = [
  { value: 3, label: '浅（≤3 层）' },
  { value: 5, label: '标准（≤5 层）' },
  { value: 10, label: '深（≤10 层）' },
] as const

export function PmoImpactPlanRunPanel({ organizationId }: PmoImpactPlanRunPanelProps) {
  const { hasPermission } = usePermissions()
  const canManage = hasPermission('multi_project_impact:manage')

  const planMutation = usePlanMultiProjectImpactAnalysis(organizationId)
  const runMutation = useRunMultiProjectImpactAnalysis(organizationId)

  const [projectIdsDraft, setProjectIdsDraft] = React.useState('')
  const [depth, setDepth] = React.useState<number>(5)
  const [dateStart, setDateStart] = React.useState('')
  const [dateEnd, setDateEnd] = React.useState('')
  const [plan, setPlan] = React.useState<MultiProjectImpactPlan | null>(null)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [justRan, setJustRan] = React.useState(false)
  const runConfirmRef = React.useRef<HTMLDivElement | null>(null)

  // 运行分析在途期间与「确认运行」按钮 disabled 同判据：Escape 不关闭确认弹层。
  useDialogA11y({
    ref: runConfirmRef,
    open: confirmOpen && plan !== null,
    onClose: () => setConfirmOpen(false),
    canClose: () => !runMutation.isPending,
  })

  const parsedIds = React.useMemo(() => {
    return [...new Set(projectIdsDraft.split(',').map((token) => Number(token.trim())))]
      .filter((id) => Number.isInteger(id) && id > 0)
      .sort((a, b) => a - b)
  }, [projectIdsDraft])

  const canPlan = canManage && parsedIds.length > 0 && !planMutation.isPending

  const buildScope = (): MultiProjectImpactScope => ({
    projectIds: parsedIds,
    maxPropagationDepth: depth,
    maxNodes: 500,
    maxEdges: 1000,
    dateWindowStart: dateStart || null,
    dateWindowEnd: dateEnd || null,
    maxScenarios: 5,
  })

  const handlePlan = () => {
    setJustRan(false)
    planMutation.mutate(buildScope(), {
      onSuccess: (result) => setPlan(result),
    })
  }

  const handleRunConfirm = () => {
    if (!plan?.runToken) return
    setJustRan(false)
    runMutation.mutate(plan.runToken, {
      onSuccess: () => {
        setPlan(null)
        setConfirmOpen(false)
        setJustRan(true)
      },
    })
  }

  const planError = planMutation.error ?? runMutation.error
  const errorMessage = planError && planError instanceof Error ? planError.message : null

  const inputClass =
    'h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none'

  return (
    <section
      data-imp-plan-panel
      className="flex flex-col gap-3 rounded-xl border border-[var(--nx-border-hairline)] p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--nx-text-primary)]">
            <Layers className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            创建分析计划
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
            计划（范围与成本预估）→ 人工确认运行 → 生成影响分析快照
          </p>
        </div>
        {!canManage ? (
          <span
            data-imp-plan-manage-hint
            className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] px-2 py-1 text-[10px] text-[var(--nx-text-muted)]"
          >
            <ShieldAlert className="h-3 w-3" aria-hidden />
            运行分析需要 multi_project_impact:manage（当前角色未授予，可浏览既有快照）
          </span>
        ) : null}
      </header>

      {/* 向导表单 */}
      <div
        data-imp-plan-form
        className="flex flex-wrap items-end gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
      >
        <label className="flex min-w-52 flex-1 flex-col gap-1">
          <span className="text-[11px] text-[var(--nx-text-muted)]">
            项目范围（项目 ID，逗号分隔）
          </span>
          <input
            data-imp-plan-project-ids
            type="text"
            placeholder="如 1,2,3"
            value={projectIdsDraft}
            onChange={(event) => setProjectIdsDraft(event.target.value)}
            className={cn(inputClass, 'font-mono')}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--nx-text-muted)]">传播深度</span>
          <select
            data-imp-plan-depth
            value={depth}
            onChange={(event) => setDepth(Number(event.target.value))}
            className={inputClass}
          >
            {DEPTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--nx-text-muted)]">日期窗口起</span>
          <input
            data-imp-plan-date-start
            type="date"
            value={dateStart}
            onChange={(event) => setDateStart(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--nx-text-muted)]">日期窗口止</span>
          <input
            data-imp-plan-date-end
            type="date"
            value={dateEnd}
            onChange={(event) => setDateEnd(event.target.value)}
            className={inputClass}
          />
        </label>
        <button
          type="button"
          data-imp-plan-action
          disabled={!canPlan}
          onClick={handlePlan}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3.5 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {planMutation.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              计划生成中…
            </>
          ) : (
            '生成分析计划'
          )}
        </button>
      </div>

      {planError ? (
        <p
          data-imp-plan-error
          role="alert"
          className="flex items-start gap-1.5 rounded-md border border-[var(--nx-status-danger)]/30 bg-[var(--nx-status-danger)]/5 px-3 py-2 text-xs text-[var(--nx-status-danger)]"
        >
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {errorMessage ?? '操作失败，请稍后重试。'}
        </p>
      ) : null}

      {/* plan 摘要 */}
      {plan ? (
        <div
          data-imp-plan-summary
          className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-focus)]/40 bg-[var(--nx-workspace-surface)] p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--nx-text-primary)]">
              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--nx-status-success)]" aria-hidden />
              分析计划就绪
            </h3>
            <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
              规则 {plan.ruleVersion}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-md bg-[var(--nx-bg-0)] px-2.5 py-2">
              <dt className="text-[10px] text-[var(--nx-text-muted)]">范围哈希</dt>
              <dd
                data-imp-plan-scope-hash
                className="mt-0.5 font-mono text-[var(--nx-text-primary)]"
              >
                {plan.scopeHash.slice(0, 12)}…
              </dd>
            </div>
            <div className="rounded-md bg-[var(--nx-bg-0)] px-2.5 py-2">
              <dt className="text-[10px] text-[var(--nx-text-muted)]">预计节点</dt>
              <dd data-imp-plan-nodes className="mt-0.5 font-mono text-[var(--nx-text-primary)]">
                {plan.estimatedCost.approximateNodes}
              </dd>
            </div>
            <div className="rounded-md bg-[var(--nx-bg-0)] px-2.5 py-2">
              <dt className="text-[10px] text-[var(--nx-text-muted)]">预计边</dt>
              <dd data-imp-plan-edges className="mt-0.5 font-mono text-[var(--nx-text-primary)]">
                {plan.estimatedCost.approximateEdges}
              </dd>
            </div>
            <div className="rounded-md bg-[var(--nx-bg-0)] px-2.5 py-2">
              <dt className="text-[10px] text-[var(--nx-text-muted)]">预计耗时</dt>
              <dd className="mt-0.5 font-mono text-[var(--nx-text-primary)]">
                {(plan.estimatedCost.estimatedDurationMs / 1000).toFixed(1)}s
              </dd>
            </div>
          </dl>
          {plan.warnings.length > 0 ? (
            <ul
              data-imp-plan-warnings
              className="space-y-1 text-[11px] text-[var(--nx-status-warning)]"
            >
              {plan.warnings.map((warning) => (
                <li key={warning.code} className="flex items-start gap-1.5">
                  <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  {warning.message}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex items-center justify-between gap-2 border-t border-[var(--nx-border-hairline)] pt-2.5">
            <span className="text-[10px] text-[var(--nx-text-muted)]">
              计划有效期至{' '}
              <time className="font-mono">{new Date(plan.expiresAt).toLocaleString('zh-CN')}</time>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                data-imp-run-open
                onClick={() => setConfirmOpen(true)}
                disabled={!canManage || runMutation.isPending}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3.5 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" aria-hidden />
                运行分析
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {justRan ? (
        <p
          data-imp-run-success
          className="flex items-center gap-1.5 rounded-md border border-[var(--nx-status-success)]/30 bg-[var(--nx-status-success)]/5 px-3 py-2 text-xs text-[var(--nx-status-success)]"
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          分析完成，新快照已生成并出现在下方列表。
        </p>
      ) : null}

      {/* 二次确认对话框 */}
      {confirmOpen && plan ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="presentation"
        >
          <button
            type="button"
            data-imp-run-confirm-scrim
            aria-label="取消运行确认"
            tabIndex={-1}
            onClick={() => setConfirmOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
          />
          <div
            ref={runConfirmRef}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-label="确认运行影响分析"
            data-imp-run-confirm-dialog
            className="relative w-full max-w-md rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-5 shadow-[0_0_48px_rgba(0,0,0,0.5)]"
          >
            <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">确认运行分析</h3>
            <p className="mt-2 text-xs leading-relaxed text-[var(--nx-text-muted)]">
              将按当前计划运行多项目影响分析并生成新快照。预计约{' '}
              <span className="font-mono text-[var(--nx-text-primary)]">
                {plan.estimatedCost.approximateNodes}
              </span>{' '}
              节点 /
              <span className="font-mono text-[var(--nx-text-primary)]">
                {' '}
                {plan.estimatedCost.approximateEdges}
              </span>{' '}
              边；范围哈希{' '}
              <span className="font-mono text-[var(--nx-text-primary)]">
                {plan.scopeHash.slice(0, 12)}…
              </span>
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                data-imp-run-cancel
                onClick={() => setConfirmOpen(false)}
                className="flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
              >
                取消
              </button>
              <button
                type="button"
                data-imp-run-confirm
                disabled={runMutation.isPending}
                onClick={handleRunConfirm}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)]/50 bg-[var(--nx-status-danger)]/10 px-3.5 text-xs font-medium text-[var(--nx-status-danger)] transition-colors hover:border-[var(--nx-status-danger)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {runMutation.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    运行中…
                  </>
                ) : (
                  '确认运行'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="flex items-center gap-1.5 text-[10px] text-[var(--nx-text-muted)]">
        <CalendarRange className="h-3 w-3" aria-hidden />
        日期窗口与传播深度为可选分析范围约束；运行前请人工核对项目范围与成本预估。
      </p>
    </section>
  )
}

export default PmoImpactPlanRunPanel
