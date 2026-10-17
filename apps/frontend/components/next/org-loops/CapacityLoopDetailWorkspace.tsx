'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Database, History, Loader2, RefreshCw } from 'lucide-react'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { useRcclLoopDetail, useRefreshRcclBaseline } from '@/hooks/use-resource-capacity-loops'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import {
  granularityLabelOf,
  loopStateMeta,
  loopWindowLabel,
  resolveRcclDetailPayload,
} from '@/lib/next/org-loops/org-loops-adapter'
import { cn } from '@/lib/utils'
import { LoopScenarioPanel } from './LoopScenarioPanel'
import { LoopActionBar } from './LoopActionBar'

/**
 * 容量闭环详情工作台（v3-ui-next-org-portfolio-domains W6 · tasks 6.4–6.6，
 * spec「资源容量闭环咨询工作台（列表与详情）」）。
 *
 * - 消费 useRcclLoopDetail（GET /organizations/:organizationId/.../:loopId，
 *   组织级 hooks 内部自带租户上下文）；envelope/裸载荷双形状收敛在适配层；
 * - 分区：事实表（基线快照 + 就绪状态 + manage 门禁「刷新基线」，后端当前显式
 *   降级语义原样回显）、What-if 情景面板（LoopScenarioPanel）、人工决策与受控
 *   移交动作条（LoopActionBar）、观察/复核时间线；
 * - 咨询姿态红线文案常驻：「选择仅表达方向，不构成对任何正式资源记录的写入授权」
 *   与「本页面所有建议均为咨询性质且未被应用」（RL-06）；
 * - 三态闭环：几何匹配骨架屏（aria-busy）/ 中性「未找到」态（RL-05：非法或跨
 *   租户 loopId 零存在性泄露）/ 5xx 错误重试；
 * - 沉浸阶梯：precise 下纯色工作面、剥离氛围光晕。
 */
export interface CapacityLoopDetailWorkspaceProps {
  loopId: number
}

export function CapacityLoopDetailWorkspace({ loopId }: CapacityLoopDetailWorkspaceProps) {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const tier = useImmersionTier()

  const { data, isLoading, isError, error, refetch } = useRcclLoopDetail(loopId)
  const refreshBaseline = useRefreshRcclBaseline(loopId)

  const [baselineConfirmOpen, setBaselineConfirmOpen] = React.useState(false)
  const [baselineError, setBaselineError] = React.useState<string | null>(null)
  const [baselineResult, setBaselineResult] = React.useState<string | null>(null)
  const baselineDialogRef = React.useRef<HTMLDivElement | null>(null)

  // 在途刷新基线期间与弹窗「取消」按钮同判据：Escape 不关闭确认弹窗。
  useDialogA11y({
    ref: baselineDialogRef,
    open: baselineConfirmOpen,
    onClose: () => setBaselineConfirmOpen(false),
    canClose: () => !refreshBaseline.isPending,
  })

  const canManage = hasPermission('resource_capacity_loop:manage')
  const detail = React.useMemo(() => resolveRcclDetailPayload(data), [data])

  function confirmRefreshBaseline() {
    setBaselineConfirmOpen(true)
    setBaselineError(null)
    setBaselineResult(null)
  }

  function runRefreshBaseline() {
    refreshBaseline.mutate(undefined, {
      onSuccess: (result) => {
        setBaselineConfirmOpen(false)
        const degraded = result as {
          refreshed?: boolean
          degradedReason?: string
          detail?: string
        }
        setBaselineResult(
          degraded.refreshed === false
            ? `基线刷新未产生变更（${degraded.degradedReason ?? '降级'}）：${degraded.detail ?? ''}`
            : '基线刷新已触发，请稍后重载查看。',
        )
      },
      onError: (mutationError) => setBaselineError(messageOf(mutationError, '刷新基线失败')),
    })
  }

  if (isLoading) {
    return (
      <div
        data-rccl-detail
        data-rccl-detail-loading
        aria-busy="true"
        className={cn(
          'flex flex-col gap-3 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
          tier === 'precise'
            ? 'bg-[var(--nx-workspace-bg)]'
            : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
        )}
      >
        <div className="h-6 w-64 rounded bg-[var(--nx-bg-1)]" />
        <div className="h-40 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
        <div className="h-40 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
      </div>
    )
  }

  // ── 中性「未找到」态（RL-05：跨组织/非法 loopId 不区分呈现）──
  if (isError || detail === null) {
    const status = (error as { status?: number } | undefined)?.status
    const neutral = detail === null && !isError ? true : status === 404 || status === 403
    return (
      <div
        data-rccl-detail
        data-rccl-detail-error
        role="alert"
        className={cn(
          'flex flex-col items-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] px-8 py-14 text-center',
          tier === 'precise'
            ? 'bg-[var(--nx-workspace-bg)]'
            : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
        )}
      >
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
          {neutral ? '容量环未找到' : '加载失败'}
        </h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          {neutral
            ? '该容量环不存在、已被移除，或当前会话无权访问。未显示任何详情以避免泄露存在性。'
            : '容量环详情暂时无法加载，请稍后重试。'}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-rccl-detail-back-list
            onClick={() => router.push('/next/organization/resource-capacity-loops')}
            className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            返回容量环列表
          </button>
          {!neutral ? (
            <button
              type="button"
              data-rccl-detail-retry
              onClick={() => void refetch()}
              className="flex h-9 items-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              重试
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  const stateMeta = loopStateMeta(detail.loop.state)

  return (
    <div
      data-rccl-detail
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* ── 页头：标题 + 状态/修订/窗口 ── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Database className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1
              data-rccl-detail-title
              className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              {detail.loop.title}
            </h1>
            <p data-rccl-detail-meta className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              状态：
              <span
                data-rccl-detail-state
                data-state={detail.loop.state}
                className={`ml-1 inline-flex items-center rounded-full border px-2 py-0.5 align-middle text-[11px] ${stateMeta.chipClass}`}
              >
                {stateMeta.label}
              </span>
              <span className="ml-2">
                修订 v{detail.loop.revision} · {granularityLabelOf(detail.loop.granularity)}粒度 ·
                窗口 {loopWindowLabel(detail.loop.windowStart, detail.loop.windowEnd)}
              </span>
            </p>
          </div>
        </div>
        <button
          type="button"
          data-rccl-detail-back-list
          onClick={() => router.push('/next/organization/resource-capacity-loops')}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          返回列表
        </button>
      </header>

      {/* ── 基线事实区（事实表 + 刷新基线）── */}
      <section
        aria-labelledby="rccl-baseline-heading"
        className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="rccl-baseline-heading"
            className="text-sm font-semibold text-[var(--nx-text-primary)]"
          >
            基线快照（事实）
          </h2>
          {canManage && (detail.loop.state === 'draft' || detail.loop.state === 'simulated') ? (
            <button
              type="button"
              data-rccl-baseline-refresh-open
              onClick={confirmRefreshBaseline}
              disabled={refreshBaseline.isPending}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:opacity-50"
            >
              {refreshBaseline.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
              刷新基线
            </button>
          ) : null}
        </div>
        {detail.baseline ? (
          <div className="mt-2 space-y-2">
            <p className="text-xs">
              <span className="rounded-full border border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)] px-2 py-0.5 text-[11px] text-[var(--nx-status-success)]">
                事实数据
              </span>{' '}
              <span className="ml-1 text-[var(--nx-text-secondary)]">
                就绪状态：
                {detail.baseline.readyForSimulation
                  ? '可模拟'
                  : '来源缺失/过期——不可模拟（不会补零）'}
              </span>
            </p>
            <table
              data-rccl-fact-table
              className="w-full text-xs"
              aria-label="基线事实表（图表的表格替代）"
            >
              <tbody>
                <tr className="border-b border-[var(--nx-border-hairline)]">
                  <th
                    scope="row"
                    className="w-28 py-1.5 pr-4 text-left font-normal text-[var(--nx-text-muted)]"
                  >
                    快照 ID
                  </th>
                  <td className="py-1.5 font-mono text-[var(--nx-text-secondary)]">
                    {detail.baseline.id}
                  </td>
                </tr>
                <tr>
                  <th
                    scope="row"
                    className="w-28 py-1.5 pr-4 text-left font-normal text-[var(--nx-text-muted)]"
                  >
                    内容指纹
                  </th>
                  <td className="py-1.5 font-mono text-[11px] text-[var(--nx-text-secondary)]">
                    {detail.baseline.digest}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p
            data-rccl-baseline-empty
            className="mt-2 text-xs text-[var(--nx-text-muted)]"
            role="status"
          >
            尚未创建基线。缺失或受限的来源会显式标记，不会被补零。
          </p>
        )}
        {baselineResult ? (
          <p
            data-rccl-baseline-result
            className="mt-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
          >
            {baselineResult}
          </p>
        ) : null}
      </section>

      {/* ── What-if 情景面板 ── */}
      <LoopScenarioPanel loopId={loopId} detail={detail} canManage={canManage} />

      {/* ── 选择与 handoff 姿态区 ── */}
      <section
        aria-labelledby="rccl-selection-heading"
        className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
      >
        <h2
          id="rccl-selection-heading"
          className="text-sm font-semibold text-[var(--nx-text-primary)]"
        >
          当前选择与移交姿态
        </h2>
        {detail.currentSelection ? (
          <p
            data-rccl-selection-info
            className="mt-2 text-xs leading-relaxed text-[var(--nx-text-secondary)]"
          >
            当前选择：情景 #{detail.currentSelection.scenarioId} ——
            选择仅表达方向，不构成对任何正式资源记录的写入授权。下游仍须独立预览并再次显式确认。
          </p>
        ) : (
          <p data-rccl-selection-empty className="mt-2 text-xs text-[var(--nx-text-muted)]">
            尚未人工选择情景。只有授权人员可以基于最新模拟进行选择。
          </p>
        )}
        {detail.receipts.length > 0 ? (
          <ul data-rccl-receipt-list className="mt-2 flex flex-col gap-1 text-xs">
            {detail.receipts.map((receipt) => (
              <li key={receipt.id} className="text-[var(--nx-text-secondary)]">
                移交目标 {receipt.target} · 状态 {receipt.status} ——
                正式写入须在下游完成预览并二次确认后发生
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* ── 生命周期动作条（manage 门禁，RL-06）── */}
      <LoopActionBar loopId={loopId} detail={detail} canManage={canManage} />

      {/* ── 观察 / 复核时间线 ── */}
      <section
        aria-labelledby="rccl-observation-heading"
        className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
      >
        <h2
          id="rccl-observation-heading"
          className="flex items-center gap-1.5 text-sm font-semibold text-[var(--nx-text-primary)]"
        >
          <History className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />
          观察与复核时间线
        </h2>
        <ol
          data-rccl-timeline
          className="mt-2 list-inside list-decimal space-y-1 text-xs text-[var(--nx-text-secondary)]"
        >
          {detail.observations.map((observation) => (
            <li key={observation.id}>
              观察快照 #{observation.id} · 下游状态 {observation.status} ·{' '}
              {observation.comparable ? '同口径可比' : '不可比（口径失配，不显示改善百分比）'}
            </li>
          ))}
          {detail.reviews.map((review) => (
            <li key={`review-${review.id}`}>
              复核结论：{review.outcome}（人工结论；观察到的变化不能仅凭时间先后归因于该 选择）
            </li>
          ))}
          {detail.observations.length === 0 && detail.reviews.length === 0 ? (
            <li className="text-[var(--nx-text-muted)]">
              下游到达可观察状态后，可捕获同口径观察快照。
            </li>
          ) : null}
        </ol>
      </section>

      {/* 咨询姿态常驻标注（RL-06） */}
      <p data-rccl-posture-note className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
        本页面所有建议均为咨询性质且未被应用；正式资源写入始终由既有能力的预览与显式确认路径执行。
      </p>

      {/* 刷新基线确认弹窗（写动作二次确认 + 防抖） */}
      {baselineConfirmOpen ? (
        <div data-rccl-baseline-dialog-overlay className="fixed inset-0 z-50" role="presentation">
          <button
            type="button"
            aria-label="关闭刷新基线确认弹窗"
            tabIndex={-1}
            onClick={() => setBaselineConfirmOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
          />
          <div
            ref={baselineDialogRef}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-label="确认刷新基线"
            data-rccl-baseline-dialog
            className="absolute left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
          >
            <header className="border-b border-[var(--nx-border-hairline)] px-5 py-4">
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">确认刷新基线</h3>
            </header>
            <div className="px-5 py-4">
              <p className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
                将基于当前可见来源重新采集基线快照（修订 v{detail.loop.revision}）。基线刷新
                仅重建只读快照，不修改任何正式资源记录。
              </p>
              {baselineError ? (
                <p
                  data-rccl-baseline-error
                  role="alert"
                  className="mt-2 rounded-md border border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.14)] px-3 py-2 text-xs text-[var(--nx-status-danger)]"
                >
                  {baselineError}
                </p>
              ) : null}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
              <button
                type="button"
                data-rccl-baseline-dialog-cancel
                onClick={() => setBaselineConfirmOpen(false)}
                disabled={refreshBaseline.isPending}
                className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-rccl-baseline-dialog-confirm
                disabled={refreshBaseline.isPending}
                onClick={runRefreshBaseline}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
              >
                {refreshBaseline.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                )}
                确认刷新
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

export default CapacityLoopDetailWorkspace
