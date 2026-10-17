'use client'

import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  EyeOff,
  FileDown,
  FileJson,
  Inbox,
  Layers,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useMultiProjectImpactSnapshot,
  useRefreshMultiProjectImpactSnapshot,
  useExportMultiProjectImpact,
  useFollowUpDraftMultiProjectImpact,
} from '@/hooks/use-multi-project-impact-analysis'
import { cn } from '@/lib/utils'
import type {
  MultiProjectImpactDimension,
  MultiProjectImpactFollowUpDraft,
  MultiProjectImpactFollowUpTarget,
  MultiProjectImpactPropagationPath,
  MultiProjectImpactSeverity,
  MultiProjectImpactSnapshot,
  MultiProjectImpactWarningCode,
} from '@aiproj/types'
import {
  MULTI_PROJECT_IMPACT_DIMENSIONS,
  MULTI_PROJECT_IMPACT_FOLLOW_UP_TARGETS,
} from '@aiproj/types'
import { IMPACT_SEVERITY_META, IMPACT_STATUS_META } from './PmoImpactSnapshotList'
import { PmoImpactAiExplanationModal } from './PmoImpactAiExplanationModal'

// ─── 标签表（RL-14：静态枚举 → 中文标签，零动态渲染）────────────────────────

const DIMENSION_LABELS: Record<MultiProjectImpactDimension, string> = {
  schedule: '进度',
  resource: '资源',
  risk: '风险',
  scope: '范围',
  quality: '质量',
  okr: 'OKR',
  bi_metric: 'BI 指标',
  cost: '成本',
}

const FOLLOW_UP_TARGET_LABELS: Record<MultiProjectImpactFollowUpTarget, string> = {
  multi_project_dependency_crud: '多项目依赖 CRUD',
  dependency_detection_rerun: '依赖检测重跑',
  manual_risk_draft: '风险人工草案',
  change_request_summary: '变更申请摘要',
  report_summary: '报表摘要',
  manual_summary: '人工摘要',
}

const WARNING_LABELS: Partial<Record<MultiProjectImpactWarningCode, string>> = {
  hidden_dependency_present: '存在隐藏依赖',
  hidden_project_present: '存在隐藏项目',
  hidden_task_present: '存在隐藏任务',
  hidden_milestone_present: '存在隐藏里程碑',
  hidden_risk_present: '存在隐藏风险',
  stale_source_data: '源数据已过期',
  stale_detection_result: '检测结果已过期',
  ai_unavailable: 'AI 不可用',
  feature_disabled: '功能未启用',
  propagation_depth_limit_reached: '已达传播深度上限',
  node_limit_reached: '已达节点数上限',
  edge_limit_reached: '已达边数上限',
  buffer_absorbed: '延迟被缓冲吸收',
  data_quality_flag: '数据质量标记',
}

const SEVERITY_ORDER: MultiProjectImpactSeverity[] = [
  'blocker',
  'critical',
  'high',
  'medium',
  'low',
  'none',
]

/** 收集快照中全部可见受影响端点（脱敏端点不计入统计与草案引用，RL-05）。 */
function visibleEndpointsOf(snapshot: MultiProjectImpactSnapshot) {
  const out: Array<{
    pathIndex: number
    endpointIndex: number
    path: MultiProjectImpactPropagationPath
    severity: MultiProjectImpactSeverity
    endpoint: MultiProjectImpactPropagationPath['affectedEndpoints'][number]
  }> = []
  snapshot.propagationSummary.propagationPaths.forEach((path, pathIndex) => {
    path.affectedEndpoints.forEach((endpoint, endpointIndex) => {
      if (endpoint.visibility !== 'visible') return
      out.push({ pathIndex, endpointIndex, path, severity: endpoint.severity, endpoint })
    })
  })
  return out
}

function dimensionDistributionOf(snapshot: MultiProjectImpactSnapshot): Array<{
  dimension: MultiProjectImpactDimension
  count: number
}> {
  const counts = new Map<MultiProjectImpactDimension, number>()
  for (const { endpoint } of visibleEndpointsOf(snapshot)) {
    for (const dimension of endpoint.affectedDimensions) {
      counts.set(dimension, (counts.get(dimension) ?? 0) + 1)
    }
  }
  return MULTI_PROJECT_IMPACT_DIMENSIONS.filter((d) => (counts.get(d) ?? 0) > 0).map((d) => ({
    dimension: d,
    count: counts.get(d) ?? 0,
  }))
}

/** 红区项目：含 blocker/critical 可见受影响端点的项目（去重项目标签）。 */
function redZoneProjectsOf(snapshot: MultiProjectImpactSnapshot): Array<{
  projectLabel: string
  endpointCount: number
}> {
  const byProject = new Map<string, number>()
  for (const { endpoint } of visibleEndpointsOf(snapshot)) {
    if (endpoint.severity === 'blocker' || endpoint.severity === 'critical') {
      const label = endpoint.projectLabel || '（未知项目）'
      byProject.set(label, (byProject.get(label) ?? 0) + 1)
    }
  }
  return [...byProject.entries()].map(([projectLabel, endpointCount]) => ({
    projectLabel,
    endpointCount,
  }))
}

/** 导出下载（jsdom 等环境无 createObjectURL 时仅回执不下载）。 */
function triggerContentDownload(filename: string, content: string, type: string): void {
  if (typeof URL.createObjectURL !== 'function') return
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export interface PmoImpactSnapshotDetailPanelProps {
  organizationId: number
  snapshotId: number
  /** 折叠详情区（返回列表）。 */
  onClose: () => void
}

/**
 * 影响分析快照详情面板（v3-ui-next-pmo-domain W8 · tasks 8.3，
 * spec「多项目影响分析工作台」详情/刷新/导出/跟进草稿）。
 *
 * - 呈现影响维度分布（受影响端点维度聚合）、受影响实体（传播路径逐级）与
 *   红区项目（blocker/critical）；脱敏端点仅以「隐藏」呈现，无猜测值；
 * - 动作：refresh（仅 multi_project_impact:manage）、导出（JSON/CSV 回执 +
 *   下载）、跟进草稿生成（成功仅提示已建草稿，绝不自动提交——RL-01）、
 *   AI 解释显式触发浮层（RL-01，禁用自动调用）；
 * - 状态徽标沿用列表双通道色；错误 404/403 中性受限态，其余可重试。
 */
export function PmoImpactSnapshotDetailPanel({
  organizationId,
  snapshotId,
  onClose,
}: PmoImpactSnapshotDetailPanelProps) {
  const { hasPermission } = usePermissions()
  const canManage = hasPermission('multi_project_impact:manage')

  const snapshotQuery = useMultiProjectImpactSnapshot(organizationId, snapshotId)
  const refreshMutation = useRefreshMultiProjectImpactSnapshot(organizationId)
  const exportMutation = useExportMultiProjectImpact(organizationId)
  const followUpMutation = useFollowUpDraftMultiProjectImpact(organizationId)

  const [followUpTarget, setFollowUpTarget] = React.useState<MultiProjectImpactFollowUpTarget | ''>(
    '',
  )
  const [followUpDraft, setFollowUpDraft] = React.useState<MultiProjectImpactFollowUpDraft | null>(
    null,
  )
  const [exportReceipt, setExportReceipt] = React.useState<{
    format: 'json' | 'csv'
    bytes: number
  } | null>(null)
  const [aiOpen, setAiOpen] = React.useState(false)

  const snapshot = snapshotQuery.data ?? null
  const mutationError =
    refreshMutation.error ?? exportMutation.error ?? followUpMutation.error ?? null
  const mutationErrorMessage = mutationError instanceof Error ? mutationError.message : null

  const endpointHashes = React.useMemo(() => {
    if (!snapshot) return []
    return [...new Set(visibleEndpointsOf(snapshot).map(({ endpoint }) => endpoint.evidenceHash))]
  }, [snapshot])

  const handleRefresh = () => {
    refreshMutation.mutate(snapshotId)
  }

  const handleExport = (format: 'json' | 'csv') => {
    exportMutation.mutate(
      { snapshotId, format },
      {
        onSuccess: (result) => {
          setExportReceipt({
            format: result.format as 'json' | 'csv',
            bytes: result.content.length,
          })
          triggerContentDownload(
            `impact-analysis-${snapshotId}.${result.format}`,
            result.content,
            result.format === 'json' ? 'application/json' : 'text/csv',
          )
        },
      },
    )
  }

  const handleFollowUp = () => {
    if (!followUpTarget || endpointHashes.length === 0) return
    followUpMutation.mutate(
      { snapshotId, affectedEndpointHashes: endpointHashes, targetCapability: followUpTarget },
      { onSuccess: (draft) => setFollowUpDraft(draft) },
    )
  }

  const shellClass = 'flex flex-col gap-3 rounded-xl border border-[var(--nx-border-hairline)] p-4'

  // ── 三态：骨架 ──
  if (snapshotQuery.isLoading || snapshotQuery.isPending) {
    return (
      <section
        data-imp-detail
        data-imp-detail-loading
        role="status"
        aria-busy="true"
        aria-label="快照详情加载中"
        className={shellClass}
      >
        <div className="h-6 w-48 rounded bg-[var(--nx-bg-1)]" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-16 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
          ))}
        </div>
        <div className="h-40 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
      </section>
    )
  }

  // ── 三态：错误（404/403 中性受限 vs 可重试）──
  if (snapshotQuery.isError || !snapshot) {
    const status = (snapshotQuery.error as { status?: number } | undefined)?.status
    const restricted = status === 403 || status === 404 || !snapshot
    return (
      <section data-imp-detail data-imp-detail-error className={shellClass}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-8 py-10 text-center">
            <ShieldAlert
              className={cn(
                'h-7 w-7',
                restricted ? 'text-[var(--nx-text-muted)]' : 'text-[var(--nx-status-warning)]',
              )}
              aria-hidden
            />
            <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">
              {restricted ? '快照不存在或无权访问' : '快照详情加载失败'}
            </h3>
            <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
              {restricted
                ? '该影响分析快照可能已删除或不在当前组织范围内。'
                : '快照详情暂时无法加载，请稍后重试。'}
            </p>
            {!restricted ? (
              <button
                type="button"
                data-imp-detail-retry
                onClick={() => void snapshotQuery.refetch()}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
              >
                <Loader2 className="h-3.5 w-3.5" aria-hidden />
                重新载入
              </button>
            ) : null}
          </div>
          <button
            type="button"
            data-imp-detail-close
            aria-label="关闭快照详情"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </section>
    )
  }

  const dimensionRows = dimensionDistributionOf(snapshot)
  const redZoneRows = redZoneProjectsOf(snapshot)
  const severitySummary = [...SEVERITY_ORDER]
    .filter((level) => (snapshot.propagationSummary.severityDistribution[level] ?? 0) > 0)
    .map((level) => ({
      level,
      count: snapshot.propagationSummary.severityDistribution[level] ?? 0,
    }))
  const statusMeta = IMPACT_STATUS_META[snapshot.status]

  return (
    <section data-imp-detail className={shellClass}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-[var(--nx-text-primary)]">
            快照 #{snapshot.id} 详情
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--nx-text-muted)]">
            <span data-imp-detail-rule className="font-mono">
              规则 {snapshot.ruleVersion}
            </span>
            <span aria-hidden>·</span>
            <span data-imp-detail-scope-hash className="font-mono">
              scope {snapshot.scopeHash.slice(0, 10)}…
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            data-imp-detail-status
            className={cn('inline-flex items-center gap-1.5 text-xs', statusMeta.tone)}
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
            {snapshot.isStale ? '已过期' : statusMeta.label}
          </span>
          <button
            type="button"
            data-imp-detail-close
            aria-label="关闭快照详情"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </header>

      {/* 摘要统计 */}
      <dl data-imp-detail-stats className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md bg-[var(--nx-bg-0)] px-2.5 py-2">
          <dt className="text-[10px] text-[var(--nx-text-muted)]">受影响端点</dt>
          <dd
            data-imp-stat-affected
            className="mt-0.5 font-mono text-sm text-[var(--nx-text-primary)]"
          >
            {snapshot.propagationSummary.totalAffectedEndpoints}
          </dd>
        </div>
        <div className="rounded-md bg-[var(--nx-bg-0)] px-2.5 py-2">
          <dt className="text-[10px] text-[var(--nx-text-muted)]">阻断端点</dt>
          <dd
            data-imp-stat-blocked
            className="mt-0.5 font-mono text-sm text-[var(--nx-text-primary)]"
          >
            {snapshot.propagationSummary.blockedEndpoints}
          </dd>
        </div>
        <div className="rounded-md bg-[var(--nx-bg-0)] px-2.5 py-2">
          <dt className="text-[10px] text-[var(--nx-text-muted)]">最大深度</dt>
          <dd className="mt-0.5 font-mono text-sm text-[var(--nx-text-primary)]">
            {snapshot.propagationSummary.maxDepth}
          </dd>
        </div>
        <div className="rounded-md bg-[var(--nx-bg-0)] px-2.5 py-2">
          <dt className="text-[10px] text-[var(--nx-text-muted)]">平均延期</dt>
          <dd className="mt-0.5 font-mono text-sm text-[var(--nx-text-primary)]">
            {snapshot.propagationSummary.averageDelayDays.toFixed(1)} 天
          </dd>
        </div>
      </dl>

      {/* 严重度分布（双通道） */}
      {severitySummary.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" data-imp-severity-summary>
          {severitySummary.map(({ level, count }) => (
            <span
              key={level}
              data-imp-severity-summary-item={level}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1 text-[11px]',
                IMPACT_SEVERITY_META[level].tone,
              )}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
              {IMPACT_SEVERITY_META[level].label} ×{count}
            </span>
          ))}
        </div>
      ) : null}

      {/* 影响维度分布 */}
      <div data-imp-dimensions className="flex flex-col gap-1.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
          <Layers className="h-3.5 w-3.5" aria-hidden />
          影响维度分布
        </h3>
        {dimensionRows.length === 0 ? (
          <p data-imp-dimensions-empty className="text-[11px] text-[var(--nx-text-muted)]">
            无可见受影响端点（脱敏端点不计入维度分布）
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {dimensionRows.map(({ dimension, count }) => (
              <span
                key={dimension}
                data-imp-dimension-chip={dimension}
                className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-0.5 font-mono text-[11px] text-[var(--nx-text-primary)]"
              >
                {DIMENSION_LABELS[dimension]} ×{count}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 红区项目 */}
      <div data-imp-redzone className="flex flex-col gap-1.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
          <AlertTriangle className="h-3.5 w-3.5 text-[var(--nx-status-danger)]" aria-hidden />
          红区项目（阻断/危急受影响端点）
        </h3>
        {redZoneRows.length === 0 ? (
          <p data-imp-redzone-empty className="text-[11px] text-[var(--nx-text-muted)]">
            当前快照无红区项目
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {redZoneRows.map(({ projectLabel, endpointCount }) => (
              <span
                key={projectLabel}
                data-imp-redzone-chip
                className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-status-danger)]/30 bg-[var(--nx-status-danger)]/5 px-2 py-0.5 text-[11px] text-[var(--nx-status-danger)]"
              >
                {projectLabel}
                <span className="font-mono">×{endpointCount}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 受影响实体（传播路径） */}
      <div data-imp-paths className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
          <Inbox className="h-3.5 w-3.5" aria-hidden />
          受影响实体
        </h3>
        {snapshot.propagationSummary.propagationPaths.length === 0 ? (
          <p data-imp-paths-empty className="text-[11px] text-[var(--nx-text-muted)]">
            该快照未产生传播路径
          </p>
        ) : (
          <ol className="space-y-2">
            {snapshot.propagationSummary.propagationPaths.map((path, pathIndex) => (
              <li
                key={pathIndex}
                data-imp-path={pathIndex}
                className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5 text-[11px]"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium text-[var(--nx-text-primary)]">
                    源点：{path.sourceRef.sourceLabel}
                  </span>
                  <span className="text-[var(--nx-text-muted)]">
                    {path.sourceRef.sourceType} · 深度 {path.depth} · 总延期 {path.totalDelayDays}{' '}
                    天
                  </span>
                </div>
                <ul className="mt-1.5 space-y-1">
                  {path.affectedEndpoints.map((endpoint, endpointIndex) => {
                    if (endpoint.visibility !== 'visible') {
                      return (
                        <li
                          key={endpointIndex}
                          data-imp-endpoint-redacted
                          className="flex items-center gap-1.5 text-[var(--nx-text-muted)]"
                        >
                          <EyeOff className="h-3 w-3" aria-hidden />
                          （隐藏端点 · 无可见信息）
                        </li>
                      )
                    }
                    const meta = IMPACT_SEVERITY_META[endpoint.severity]
                    return (
                      <li
                        key={endpointIndex}
                        data-imp-endpoint-visible
                        data-severity={endpoint.severity}
                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-l-2 pl-2"
                        style={{ borderLeftColor: 'var(--nx-border-hairline)' }}
                      >
                        <span
                          className={cn('inline-flex items-center gap-1', meta.tone)}
                          data-imp-endpoint-severity
                        >
                          <span aria-hidden className="h-1 w-1 rounded-full bg-current" />
                          {meta.label}
                        </span>
                        <span className="text-[var(--nx-text-primary)]">
                          {endpoint.endpointLabel}
                        </span>
                        <span className="text-[var(--nx-text-muted)]">
                          {endpoint.projectLabel} · 传播 {endpoint.propagatedDelayDays}d
                          {endpoint.bufferAbsorbedDays > 0
                            ? ` · 缓冲吸收 ${endpoint.bufferAbsorbedDays}d`
                            : ''}
                          {endpoint.remainingBufferDays > 0
                            ? ` · 剩余 ${endpoint.remainingBufferDays}d`
                            : ''}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Warnings */}
      {snapshot.warnings.length > 0 ? (
        <div data-imp-detail-warnings className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-medium text-[var(--nx-status-warning)]">分析警告</h3>
          <ul className="space-y-1">
            {snapshot.warnings.map((warning, index) => (
              <li
                key={`${warning.code}-${index}`}
                className="flex items-start gap-1.5 text-[11px] text-[var(--nx-text-secondary)]"
              >
                <AlertTriangle
                  className="mt-0.5 h-3 w-3 shrink-0 text-[var(--nx-status-warning)]"
                  aria-hidden
                />
                <span>
                  {WARNING_LABELS[warning.code] ? (
                    <span className="text-[var(--nx-text-primary)]">
                      {WARNING_LABELS[warning.code]}：
                    </span>
                  ) : null}
                  {warning.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 时间元数据 */}
      <dl className="grid grid-cols-2 gap-2 rounded-md bg-[var(--nx-bg-0)] px-3 py-2 text-[11px]">
        <div>
          <dt className="text-[10px] text-[var(--nx-text-muted)]">生成时间</dt>
          <dd className="mt-0.5 font-mono text-[var(--nx-text-secondary)]">
            {new Date(snapshot.generatedAt).toLocaleString('zh-CN')}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] text-[var(--nx-text-muted)]">过期时间</dt>
          <dd className="mt-0.5 font-mono text-[var(--nx-text-secondary)]">
            {new Date(snapshot.expiresAt).toLocaleString('zh-CN')}
          </dd>
        </div>
      </dl>

      {/* 动作区 */}
      {mutationError ? (
        <p
          data-imp-detail-action-error
          role="alert"
          className="rounded-md border border-[var(--nx-status-danger)]/30 bg-[var(--nx-status-danger)]/5 px-3 py-2 text-xs text-[var(--nx-status-danger)]"
        >
          {mutationErrorMessage ?? '操作失败，请稍后重试。'}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--nx-border-hairline)] pt-3">
        <button
          type="button"
          data-imp-refresh
          disabled={!canManage || refreshMutation.isPending}
          title={canManage ? '重新计算该快照' : '刷新需要 multi_project_impact:manage 权限'}
          onClick={handleRefresh}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {refreshMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          )}
          刷新快照
        </button>
        <button
          type="button"
          data-imp-export-json
          disabled={exportMutation.isPending}
          onClick={() => handleExport('json')}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
        >
          <FileJson className="h-3.5 w-3.5" aria-hidden />
          导出 JSON
        </button>
        <button
          type="button"
          data-imp-export-csv
          disabled={exportMutation.isPending}
          onClick={() => handleExport('csv')}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
        >
          <FileDown className="h-3.5 w-3.5" aria-hidden />
          导出 CSV
        </button>
        <button
          type="button"
          data-imp-ai-open
          onClick={() => setAiOpen(true)}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
        >
          <Sparkles className="h-3.5 w-3.5 text-[var(--nx-ai)]" aria-hidden />
          AI 解释
        </button>
      </div>

      {/* 跟进草稿区 */}
      <div className="flex flex-col gap-2 border-t border-[var(--nx-border-hairline)] pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-secondary)]">
            生成跟进草稿至
            <select
              data-imp-followup-target
              value={followUpTarget}
              onChange={(event) => {
                setFollowUpTarget(event.target.value as MultiProjectImpactFollowUpTarget | '')
                setFollowUpDraft(null)
              }}
              className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
            >
              <option value="">选择目标能力…</option>
              {MULTI_PROJECT_IMPACT_FOLLOW_UP_TARGETS.map((target) => (
                <option key={target} value={target}>
                  {FOLLOW_UP_TARGET_LABELS[target]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-imp-followup-run
            disabled={
              followUpTarget === '' || endpointHashes.length === 0 || followUpMutation.isPending
            }
            onClick={handleFollowUp}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {followUpMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden />
            )}
            生成跟进草稿
          </button>
          {endpointHashes.length === 0 ? (
            <span className="text-[10px] text-[var(--nx-text-muted)]">
              无可引用受影响端点（无可见端点时不能生成跟进草稿）
            </span>
          ) : null}
        </div>

        {exportReceipt ? (
          <p
            data-imp-export-receipt
            className="rounded-md bg-[var(--nx-bg-0)] px-3 py-2 text-[11px] text-[var(--nx-text-secondary)]"
          >
            <CheckCircle2
              className="mr-1 inline h-3.5 w-3.5 text-[var(--nx-status-success)]"
              aria-hidden
            />
            导出任务已发起：{exportReceipt.format.toUpperCase()} 回执就绪（快照 #{snapshotId} ·
            {(exportReceipt.bytes / 1024).toFixed(1)} KB），已开始下载。
          </p>
        ) : null}

        {followUpDraft ? (
          <div
            data-imp-followup-receipt
            className="flex flex-col gap-1.5 rounded-md border border-[var(--nx-border-focus)]/30 bg-[var(--nx-bg-0)] px-3 py-2.5"
          >
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-text-primary)]">
              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--nx-status-success)]" aria-hidden />
              跟进草稿已创建（{FOLLOW_UP_TARGET_LABELS[followUpDraft.targetCapability]}）
            </p>
            <p className="text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
              草稿引用 {followUpDraft.affectedEndpointHashes.length} 个受影响端点，需人工确认后才
              会应用任何变更——本页不会自动提交（RL-01）。
            </p>
            {followUpDraft.featureUnavailable ? (
              <p
                data-imp-followup-manual
                className="text-[11px] leading-relaxed text-[var(--nx-status-warning)]"
              >
                目标能力不可用（人工摘要 fallback）：{followUpDraft.manualSummary}
              </p>
            ) : null}
            <p className="font-mono text-[10px] text-[var(--nx-text-muted)]">
              草稿有效期至 {new Date(followUpDraft.expiresAt).toLocaleString('zh-CN')}
            </p>
          </div>
        ) : null}
      </div>

      <PmoImpactAiExplanationModal
        organizationId={organizationId}
        snapshotId={snapshotId}
        open={aiOpen}
        onClose={() => setAiOpen(false)}
      />
    </section>
  )
}

export default PmoImpactSnapshotDetailPanel
