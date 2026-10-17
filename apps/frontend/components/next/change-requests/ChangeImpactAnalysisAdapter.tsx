'use client'

import * as React from 'react'
import { Activity, Ban, FlaskConical, GitBranch, RefreshCw, TriangleAlert, Zap } from 'lucide-react'
import {
  useConfirmImpactAnalysis,
  useConfirmStaleImpactAnalysis,
  useCreateImpactAnalysis,
  useImpactAnalysis,
  useListImpactAnalyses,
  useRefreshImpactAnalysis,
} from '@/lib/api/use-change-impact'
import type { ChangeImpactAnalysis, ChangeImpactItem } from '@/lib/api/change-requests'
import { usePermissions } from '@/hooks/use-permissions'
import { CHANGE_IMPACT_MANAGE, CHANGE_IMPACT_VIEW } from './cr-permissions'
import {
  CR_ANALYSIS_STATUS_LABELS,
  CR_IMPACT_DIMENSION_LABELS,
  CR_SEVERITY_LABELS,
  CR_SEVERITY_ORDER,
  CR_SEVERITY_TONES,
  formatCrDate,
} from './cr-meta'
import { cn } from '@/lib/utils'

/**
 * 六维影响分析暗黑仪器感适配面板（v3-ui-next-risk-change-domains W2 · tasks 2.7，
 * design Decision 5.2 / spec「六维影响深度分析面板接入」）。
 *
 * 旧轨 ChangeImpactPanel 复用评估（铁律：零旧轨视觉 import）：
 * - 该组件（components/views/change-requests/ChangeImpactPanel.tsx）为旧轨浅色视觉
 *   组件（消费 ui/Button/Card/Skeleton + bg-white/gray 系类名，无沉浸阶梯降级），
 *   判定为**不可整体复用**——本适配器按新轨方案 A 纯令牌重绘；
 * - 其承载的全部底层纯逻辑（use-change-impact 数据 Hook + change-requests.ts 类型）
 *   100% 复用，无重复造轮子；
 * - 面板契约：解算（create, change_impact:view）→ 六维受影响大盘（维度摘要 +
 *   严重度分布）→ 关键路径/阻断告警高亮 → 实体级穿透证据链（规则 ID R001–R009）→
 *   过期检测（staleReason + 重新评估）。
 */

export interface ChangeImpactAnalysisAdapterProps {
  projectId: number
  changeRequestId: number
  /** 变更对象上的当前影响分析引用（详情接口字段，缺省取最近一次分析）。 */
  currentAnalysisId?: number | null
}

/** 面板权限闸口（RL-06 零外发）：无 change_impact:view/manage 权限时不挂载任何数据查询。 */
export function ChangeImpactAnalysisAdapter(props: ChangeImpactAnalysisAdapterProps) {
  const { can } = usePermissions()
  const canView = can(CHANGE_IMPACT_VIEW) || can(CHANGE_IMPACT_MANAGE)
  if (!canView) {
    return (
      <section
        data-change-impact-denied
        className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-6"
      >
        <div className="flex items-center gap-2 text-xs text-[var(--nx-text-muted)]">
          <Ban className="h-4 w-4" aria-hidden />
          暂无六维影响分析查看权限（change_impact:view）。
        </div>
      </section>
    )
  }
  return <ChangeImpactAnalysisAdapterBody {...props} />
}

/** 面板主体：所有影响分析查询仅在通过权限闸口后挂载（RL-06）。 */
function ChangeImpactAnalysisAdapterBody({
  projectId,
  changeRequestId,
  currentAnalysisId,
}: ChangeImpactAnalysisAdapterProps) {
  const { can } = usePermissions()
  const canView = can(CHANGE_IMPACT_VIEW) || can(CHANGE_IMPACT_MANAGE)
  const canManage = can(CHANGE_IMPACT_MANAGE)

  const { data: listData, isLoading: listLoading } = useListImpactAnalyses(
    projectId,
    changeRequestId,
  )
  const recentAnalyses = listData?.data ?? []
  const activeAnalysisId = currentAnalysisId ?? recentAnalyses[0]?.id ?? 0

  const { data: analysisData, isLoading: analysisLoading } = useImpactAnalysis(
    activeAnalysisId,
    projectId,
  )
  const currentAnalysis: ChangeImpactAnalysis | undefined = analysisData?.data

  const createAnalysis = useCreateImpactAnalysis(projectId, changeRequestId)
  const refreshAnalysis = useRefreshImpactAnalysis(projectId)
  const confirmAnalysis = useConfirmImpactAnalysis(projectId)
  const confirmStale = useConfirmStaleImpactAnalysis(projectId)

  const [pendingAction, setPendingAction] = React.useState<string | null>(null)
  const [confirmReason, setConfirmReason] = React.useState('')
  const [showStaleConfirm, setShowStaleConfirm] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const busy = pendingAction !== null
  const run = (key: string, fn: () => void) => {
    setPendingAction(key)
    setActionError(null)
    try {
      fn()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '影响分析操作失败')
      setPendingAction(null)
    }
  }

  const isLoading = listLoading || (activeAnalysisId > 0 && analysisLoading)
  const noneEverCreated = recentAnalyses.length === 0

  const handleCreate = () => {
    if (!canView) return
    run('create', () =>
      createAnalysis.mutate(undefined, {
        onSuccess: () => setPendingAction(null),
        onError: (error) => {
          setActionError(error instanceof Error ? error.message : '解算失败，请重试')
          setPendingAction(null)
        },
      }),
    )
  }

  const handleRefresh = () => {
    if (!currentAnalysis || !canManage) return
    run('refresh', () =>
      refreshAnalysis.mutate(currentAnalysis.id, {
        onSuccess: () => setPendingAction(null),
        onError: (error) => {
          setActionError(error instanceof Error ? error.message : '重新评估失败，请重试')
          setPendingAction(null)
        },
      }),
    )
  }

  const handleConfirmStale = () => {
    if (!currentAnalysis || !canManage || confirmReason.trim() === '') return
    run('confirmStale', () =>
      confirmStale.mutate(
        { analysisId: currentAnalysis.id, reason: confirmReason.trim() },
        {
          onSuccess: () => {
            setPendingAction(null)
            setShowStaleConfirm(false)
            setConfirmReason('')
          },
          onError: (error) => {
            setActionError(error instanceof Error ? error.message : '确认失败，请重试')
            setPendingAction(null)
          },
        },
      ),
    )
  }

  const handleConfirmFresh = () => {
    if (!currentAnalysis || !canManage) return
    run('confirm', () =>
      confirmAnalysis.mutate(
        { analysisId: currentAnalysis.id, reason: confirmReason.trim() || undefined },
        {
          onSuccess: () => {
            setPendingAction(null)
            setShowStaleConfirm(false)
            setConfirmReason('')
          },
          onError: (error) => {
            setActionError(error instanceof Error ? error.message : '确认失败，请重试')
            setPendingAction(null)
          },
        },
      ),
    )
  }

  return (
    <section
      data-change-impact-adapter
      aria-label="六维影响分析面板"
      className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">六维影响分析</h3>
          {currentAnalysis ? (
            <span
              data-change-impact-status
              data-change-impact-status-value={currentAnalysis.status}
              className={cn(
                'rounded-sm border px-1.5 py-0.5 text-[10px]',
                currentAnalysis.status === 'completed'
                  ? 'border-[var(--nx-status-success)] text-[var(--nx-status-success)]'
                  : currentAnalysis.status === 'stale'
                    ? 'border-[var(--nx-status-warning)] text-[var(--nx-status-warning)]'
                    : currentAnalysis.status === 'failed'
                      ? 'border-[var(--nx-status-danger)] text-[var(--nx-status-danger)]'
                      : 'border-[var(--nx-border-focus)] text-[var(--nx-accent)]',
              )}
            >
              {CR_ANALYSIS_STATUS_LABELS[currentAnalysis.status] ?? currentAnalysis.status}
            </span>
          ) : null}
        </div>
        {currentAnalysis ? (
          <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
            #{currentAnalysis.id} · 规则 {currentAnalysis.ruleVersion} ·{' '}
            {formatCrDate(currentAnalysis.createdAt)}
          </span>
        ) : null}
      </header>

      {actionError ? (
        <p
          role="alert"
          data-change-impact-error
          className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.08)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
        >
          {actionError}
        </p>
      ) : null}

      {isLoading && !currentAnalysis ? (
        <div
          data-change-impact-loading
          role="status"
          aria-label="正在加载影响分析"
          aria-busy="true"
          className="space-y-2"
        >
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-10 animate-pulse rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
            />
          ))}
        </div>
      ) : null}

      {/* 空态：尚无快照（具备权限可触发解算；RL-01 解算为显式人工动作） */}
      {!isLoading && noneEverCreated && !currentAnalysis ? (
        <div
          data-change-impact-empty
          className="flex flex-col items-center gap-3 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-8 text-center"
        >
          <Activity className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-xs text-[var(--nx-text-secondary)]">
            尚未生成六维影响分析。点击「开始影响分析」将按规则引擎 R001–R009 解算本变更对范围 / 进度
            / 资源 / 风险 / 质量 / 假设的穿透影响。
          </p>
          {canView ? (
            <button
              type="button"
              data-change-impact-create
              disabled={busy}
              onClick={handleCreate}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3.5 text-xs text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Zap className="h-3.5 w-3.5" aria-hidden />
              {busy && pendingAction === 'create' ? '解算中…' : '开始影响分析'}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 过期警示（isStale：项目排程变更导致快照失效） */}
      {currentAnalysis?.isStale ? (
        <div
          data-change-impact-stale
          className="flex flex-col gap-2 rounded-sm border border-[var(--nx-status-warning)] bg-[rgba(245,158,11,0.08)] px-2.5 py-2"
        >
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-[var(--nx-status-warning)]">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              分析快照已过期：{currentAnalysis.staleReason ?? '项目数据可能已变更'}。审批引用
              该快照前需重新评估或书面确认过期理由。
            </span>
          </p>
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-change-impact-refresh
                disabled={busy}
                onClick={handleRefresh}
                className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-2.5 text-[11px] text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:opacity-40"
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
                {busy && pendingAction === 'refresh' ? '重新评估中…' : '重新评估'}
              </button>
              {!showStaleConfirm ? (
                <button
                  type="button"
                  data-change-impact-stale-confirm-toggle
                  disabled={busy}
                  onClick={() => setShowStaleConfirm(true)}
                  className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:opacity-40"
                >
                  确认继续使用
                </button>
              ) : null}
            </div>
          ) : null}
          {showStaleConfirm && canManage ? (
            <div className="flex flex-col gap-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2">
              <textarea
                data-change-impact-stale-reason
                rows={2}
                value={confirmReason}
                onChange={(event) => setConfirmReason(event.target.value)}
                placeholder="书面确认继续使用该过期快照的理由…"
                className="w-full resize-y rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-1.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-change-impact-stale-confirm-submit
                  disabled={busy || confirmReason.trim() === ''}
                  onClick={handleConfirmStale}
                  className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-status-warning)] px-2.5 text-[11px] text-[var(--nx-status-warning)] transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  确认
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowStaleConfirm(false)
                    setConfirmReason('')
                  }}
                  className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-border-hairline)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 六维受影响大盘 */}
      {currentAnalysis?.summary ? (
        <ImpactSummaryGrid
          analysis={currentAnalysis}
          canManage={canManage}
          busy={busy}
          pendingAction={pendingAction}
          onConfirmFresh={handleConfirmFresh}
        />
      ) : null}

      {/* 穿透证据链（实体级列表） */}
      {currentAnalysis && currentAnalysis.items.length > 0 ? (
        <ImpactItemDrilldown items={currentAnalysis.items} />
      ) : null}
    </section>
  )
}

function ImpactSummaryGrid({
  analysis,
  canManage,
  busy,
  pendingAction,
  onConfirmFresh,
}: {
  analysis: ChangeImpactAnalysis
  canManage: boolean
  busy: boolean
  pendingAction: string | null
  onConfirmFresh: () => void
}) {
  const summary = analysis.summary
  if (!summary) return null

  return (
    <div className="flex flex-col gap-3">
      {/* 关键路径与阻断告警（决策级高亮） */}
      <div className="flex flex-wrap gap-2">
        {summary.criticalPathAffected ? (
          <p
            data-change-impact-critical-path
            data-change-impact-critical-path-value="true"
            className="flex items-center gap-1.5 rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--nx-status-danger)]"
          >
            <GitBranch className="h-3.5 w-3.5" aria-hidden />
            触碰项目关键路径
          </p>
        ) : (
          <p
            data-change-impact-critical-path
            data-change-impact-critical-path-value="false"
            className="flex items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-text-muted)]"
          >
            <GitBranch className="h-3.5 w-3.5" aria-hidden />
            未触碰关键路径
          </p>
        )}
        {summary.hasBlockingWarnings ? (
          <p
            data-change-impact-blocking
            data-change-impact-blocking-value="true"
            className="flex items-center gap-1.5 rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--nx-status-danger)]"
          >
            <Ban className="h-3.5 w-3.5" aria-hidden />
            存在阻断性告警
          </p>
        ) : null}
      </div>

      {/* 严重度分布（含总计） */}
      <div
        data-change-impact-distribution
        className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5"
      >
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <span className="font-medium text-[var(--nx-text-primary)]">受影响实体统计</span>
          <span data-change-impact-total className="font-mono text-[var(--nx-text-secondary)]">
            共 {summary.totalAffected} 项受影响
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CR_SEVERITY_ORDER.map((severity) => {
            const count = summary.severityDistribution[severity] ?? 0
            if (count === 0) return null
            return (
              <span
                key={severity}
                data-change-impact-severity={severity}
                className={cn(
                  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px]',
                  severity === 'critical'
                    ? 'border-[var(--nx-status-danger)] text-[var(--nx-status-danger)]'
                    : severity === 'high'
                      ? 'border-[var(--nx-status-warning)] text-[var(--nx-status-warning)]'
                      : severity === 'medium'
                        ? 'border-[var(--nx-border-focus)] text-[var(--nx-accent)]'
                        : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
                )}
              >
                {CR_SEVERITY_LABELS[severity]} {count}
              </span>
            )
          })}
        </div>
      </div>

      {/* 六维维度摘要 */}
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {summary.dimensionSummaries.map((dimension) => (
          <div
            key={dimension.dimension}
            data-change-impact-dimension={dimension.dimension}
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
              {CR_IMPACT_DIMENSION_LABELS[dimension.dimension] ?? dimension.dimension}
            </p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-sm text-[var(--nx-text-primary)]">
                {dimension.affectedCount}
              </span>
              <span className="text-[10px] text-[var(--nx-text-muted)]">项受影响</span>
              <span
                className={cn(
                  'ml-auto rounded-sm border px-1 py-px text-[9px]',
                  CR_SEVERITY_TONES[dimension.highestSeverity] === 'danger'
                    ? 'border-[var(--nx-status-danger)] text-[var(--nx-status-danger)]'
                    : CR_SEVERITY_TONES[dimension.highestSeverity] === 'warning'
                      ? 'border-[var(--nx-status-warning)] text-[var(--nx-status-warning)]'
                      : CR_SEVERITY_TONES[dimension.highestSeverity] === 'accent'
                        ? 'border-[var(--nx-border-focus)] text-[var(--nx-accent)]'
                        : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
                )}
              >
                最高 {CR_SEVERITY_LABELS[dimension.highestSeverity]}
              </span>
            </p>
            {dimension.topEvidence.length > 0 ? (
              <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
                {dimension.topEvidence.join('；')}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      {/* 未过期快照的人工确认（manage） */}
      {canManage && analysis.status !== 'stale' ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-change-impact-confirm
            disabled={busy}
            onClick={onConfirmFresh}
            className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:opacity-40"
          >
            {busy && pendingAction === 'confirm' ? '确认中…' : '确认分析'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** 实体级穿透证据链（展开式列表，规则 ID + 严重度 + 证据摘要）。 */
function ImpactItemDrilldown({ items }: { items: ChangeImpactItem[] }) {
  const [expanded, setExpanded] = React.useState<number | null>(null)
  const visible = items.filter((item) => item.isVisible).slice(0, 12)

  if (visible.length === 0) return null

  return (
    <div data-change-impact-items className="flex flex-col gap-1">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
        穿透证据链（{visible.length} / {items.length}）
      </h4>
      {visible.map((item) => (
        <div
          key={`${item.entityType}-${item.entityId}-${item.ruleId}`}
          data-change-impact-item
          className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]"
        >
          <button
            type="button"
            data-change-impact-item-toggle
            onClick={() => setExpanded(expanded === item.entityId ? null : item.entityId)}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--nx-border-focus)]"
          >
            <span
              className={cn(
                'shrink-0 rounded-sm border px-1 py-px text-[9px]',
                item.severity === 'critical'
                  ? 'border-[var(--nx-status-danger)] text-[var(--nx-status-danger)]'
                  : item.severity === 'high'
                    ? 'border-[var(--nx-status-warning)] text-[var(--nx-status-warning)]'
                    : item.severity === 'medium'
                      ? 'border-[var(--nx-border-focus)] text-[var(--nx-accent)]'
                      : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
              )}
            >
              {CR_SEVERITY_LABELS[item.severity]}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
              {item.entityType}#{item.entityId}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-[var(--nx-accent)]">
              {item.ruleId}
            </span>
            <span className="shrink-0 text-[10px] text-[var(--nx-text-muted)]">
              深度 {item.depth}
            </span>
          </button>
          {expanded === item.entityId ? (
            <div className="border-t border-[var(--nx-border-hairline)] px-2.5 py-2 text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
              {item.evidence ? <p>证据：{item.evidence}</p> : null}
              <p className="mt-0.5">
                维度：{CR_IMPACT_DIMENSION_LABELS[item.dimension] ?? item.dimension}
                {item.propagationPath && item.propagationPath.length > 0
                  ? ` · 传播 ${item.propagationPath.length} 跳`
                  : ''}
              </p>
              {item.requiresReview ? (
                <p className="mt-0.5 text-[var(--nx-status-warning)]">需要人工复核</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export default ChangeImpactAnalysisAdapter
