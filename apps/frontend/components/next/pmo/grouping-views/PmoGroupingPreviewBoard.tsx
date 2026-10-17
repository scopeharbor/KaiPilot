'use client'

import * as React from 'react'
import { AlertCircle, ArrowDownUp, Clock, Eye, Layers, RefreshCw, Save } from 'lucide-react'
import { useGroupingViewPreview } from '@/hooks/use-portfolio-grouping-views'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import type {
  PmoGroupingViewDefinition,
  PmoGroupingViewPreviewRequest,
  PmoGroupingViewPreviewResponse,
  PmoGroupingViewPrimaryKey,
  PmoGroupingViewQueryDefinition,
  PmoGroupingViewSortKey,
} from '@aiproj/types'
import { PMO_GROUPING_VIEW_PRIMARY_KEYS, PMO_GROUPING_VIEW_SORT_KEYS } from '@aiproj/types'

/**
 * 组合实时预览工作台（v3-ui-next-pmo-domain W3 · tasks 3.3）。
 *
 * - 分组维度（PmoGroupingViewPrimaryKey）、排序键与方向切换后自动调用
 *   `useGroupingViewPreview()` 解算组合切片并渲染分组卡/列表；
 * - 激活某个已保存视图且配置未被手工调整时按 `{ viewId }` 解算（服务端按视图
 *   定义执行）；一旦切换维度/排序/方向即转为「临时配置」按 `{ query }` 解算；
 * - 「保存为视图」联动上层保存对话框并预填当前配置（仅 portfolio:manage 可见）；
 * - 骨架（首次解算 aria-busy）/ 空态 / 错误重试三态齐备；预览为只读计算，
 *   全部交互不产生任何写请求（RL-01）。
 */

export interface PmoGroupingPreviewBoardProps {
  /** 当前激活的已保存视图（列表选中）。 */
  activeView: PmoGroupingViewDefinition | null
  /** 是否具备 portfolio:manage（保存入口门禁）。 */
  canManage: boolean
  /** 请求打开保存对话框（携带当前预览配置）。 */
  onSaveAsView: (query: PmoGroupingViewQueryDefinition) => void
}

export const GV_DIM_LABELS: Record<string, string> = {
  [PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS]: '状态',
  [PMO_GROUPING_VIEW_PRIMARY_KEYS.HEALTH]: '健康度',
  [PMO_GROUPING_VIEW_PRIMARY_KEYS.TRAFFIC_LIGHT]: '交通灯',
  [PMO_GROUPING_VIEW_PRIMARY_KEYS.MANAGER]: '负责人',
  [PMO_GROUPING_VIEW_PRIMARY_KEYS.PROJECT_TYPE]: '项目类型',
  [PMO_GROUPING_VIEW_PRIMARY_KEYS.LIFECYCLE_PHASE]: '生命周期',
  [PMO_GROUPING_VIEW_PRIMARY_KEYS.DEPARTMENT]: '部门',
  [PMO_GROUPING_VIEW_PRIMARY_KEYS.SOURCE_FRESHNESS]: '数据新鲜度',
}

export const GV_SORT_LABELS: Record<string, string> = {
  [PMO_GROUPING_VIEW_SORT_KEYS.GROUP_NAME]: '分组名',
  [PMO_GROUPING_VIEW_SORT_KEYS.PROJECT_COUNT]: '项目数',
  [PMO_GROUPING_VIEW_SORT_KEYS.PROGRESS_AVG]: '平均进度',
  [PMO_GROUPING_VIEW_SORT_KEYS.HEALTH_STATUS]: '健康状态',
  [PMO_GROUPING_VIEW_SORT_KEYS.TRAFFIC_LIGHT]: '交通灯',
  [PMO_GROUPING_VIEW_SORT_KEYS.UPDATED_AT]: '更新时间',
}

const GV_METRIC_LABELS: Record<string, string> = {
  total_projects: '项目总数',
  active_projects: '活跃项目',
  archived_projects: '归档项目',
  at_risk_projects: '风险项目',
  blocked_projects: '受阻项目',
  delivery_on_track_percent: '按期交付',
  overall_progress_avg: '平均进度',
  overdue_project_percent: '延期项目占比',
  traffic_light_red_count: '红灯项目',
  traffic_light_yellow_count: '黄灯项目',
  traffic_light_green_count: '绿灯项目',
  traffic_light_gray_count: '灰灯项目',
}

function formatKpiValue(value: number | null, unit: string): string {
  if (value === null) return '—'
  if (unit === 'percent') return `${value}%`
  return String(value)
}

export function PmoGroupingPreviewBoard({
  activeView,
  canManage,
  onSaveAsView,
}: PmoGroupingPreviewBoardProps) {
  const tier = useImmersionTier()
  const preview = useGroupingViewPreview()

  const [primary, setPrimary] = React.useState<PmoGroupingViewPrimaryKey>(
    PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
  )
  const [sortKey, setSortKey] = React.useState<PmoGroupingViewSortKey>(
    PMO_GROUPING_VIEW_SORT_KEYS.PROJECT_COUNT,
  )
  const [order, setOrder] = React.useState<'asc' | 'desc'>('desc')
  /** 控件是否已被手工调整（离开「跟随已保存视图」态）。 */
  const [dirty, setDirty] = React.useState(false)
  const [result, setResult] = React.useState<PmoGroupingViewPreviewResponse | null>(null)
  const [hasSettled, setHasSettled] = React.useState(false)
  const lastRequestRef = React.useRef<PmoGroupingViewPreviewRequest | null>(null)

  // 激活视图变化 → 控件跟随视图定义；清空上一次解算结果。
  React.useEffect(() => {
    if (!activeView) return
    setPrimary(activeView.query.primaryGrouping)
    setSortKey(activeView.query.sort ?? PMO_GROUPING_VIEW_SORT_KEYS.PROJECT_COUNT)
    setOrder(activeView.query.order ?? 'desc')
    setDirty(false)
    setResult(null)
    setHasSettled(false)
  }, [activeView?.id])

  const requestKey =
    dirty || !activeView ? `q:${primary}|${sortKey}|${order}` : `v:${activeView.id}`
  const requestRef = React.useRef<PmoGroupingViewPreviewRequest | null>(null)
  requestRef.current =
    dirty || !activeView
      ? { query: { primaryGrouping: primary, sort: sortKey, order } }
      : { viewId: activeView.id }

  // 每次渲染刷新执行器（捕获最新 mutation），自动解算 effect 只按 requestKey
  // 触发，避免 mutation 状态流转导致执行器身份变化而无限重跑。
  const runPreviewRef = React.useRef<(request: PmoGroupingViewPreviewRequest) => void>(() => {})
  runPreviewRef.current = (request: PmoGroupingViewPreviewRequest) => {
    lastRequestRef.current = request
    void preview
      .mutateAsync(request)
      .then((envelope) => {
        setResult(envelope.data)
        setHasSettled(true)
      })
      .catch(() => {
        setHasSettled(true)
      })
  }

  // 配置/视图变化 → 自动重新解算（组合实时预览）；requestKey 为原始值，
  // 相同请求不会重复触发。
  React.useEffect(() => {
    if (!activeView && !dirty) return
    const request = requestRef.current
    if (request) runPreviewRef.current(request)
  }, [requestKey, activeView, dirty])

  const isLoading = preview.isPending
  const errorMessage = preview.error
    ? preview.error instanceof Error
      ? preview.error.message
      : null
    : null

  const handleControlChange = (update: () => void) => {
    setDirty(true)
    update()
  }

  const handleRetry = () => {
    const request = lastRequestRef.current
    if (!request) return
    setHasSettled(false)
    runPreviewRef.current(request)
  }

  const dimLabel = GV_DIM_LABELS[primary] ?? primary
  const sortLabel = GV_SORT_LABELS[sortKey] ?? sortKey
  const customMode = dirty || !activeView

  return (
    <section
      data-gv-board
      aria-label="组合预览工作台"
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] p-3',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-surface)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-surface)]',
      )}
    >
      {/* ─── 解算配置工具栏 ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
          <Layers className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />
          解算配置
        </div>
        <label className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--nx-text-muted)]">分组维度</span>
          <select
            data-gv-primary-select
            value={primary}
            onChange={(event) =>
              handleControlChange(() => setPrimary(event.target.value as PmoGroupingViewPrimaryKey))
            }
            aria-label="分组维度"
            className="h-7 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-primary)] outline-none transition-colors focus:border-[var(--nx-border-focus)]"
          >
            {Object.values(PMO_GROUPING_VIEW_PRIMARY_KEYS).map((key) => (
              <option key={key} value={key}>
                {GV_DIM_LABELS[key] ?? key}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--nx-text-muted)]">排序</span>
          <select
            data-gv-sort-select
            value={sortKey}
            onChange={(event) =>
              handleControlChange(() => setSortKey(event.target.value as PmoGroupingViewSortKey))
            }
            aria-label="排序键"
            className="h-7 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-primary)] outline-none transition-colors focus:border-[var(--nx-border-focus)]"
          >
            {Object.values(PMO_GROUPING_VIEW_SORT_KEYS).map((key) => (
              <option key={key} value={key}>
                {GV_SORT_LABELS[key] ?? key}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-gv-order-toggle
          aria-label={`切换排序方向，当前${order === 'asc' ? '升序' : '降序'}`}
          onClick={() =>
            handleControlChange(() => setOrder((previous) => (previous === 'asc' ? 'desc' : 'asc')))
          }
          className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
        >
          <ArrowDownUp className="h-3 w-3" aria-hidden />
          {order === 'asc' ? '升序' : '降序'}
        </button>

        {!customMode ? (
          <span
            data-gv-follow-view
            className="flex items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--nx-text-muted)]"
          >
            <Eye className="h-2.5 w-2.5" aria-hidden />
            跟随视图 · {activeView?.name}
          </span>
        ) : (
          <span
            data-gv-custom-mode
            className="flex items-center gap-1 rounded-sm border border-[rgba(245,158,11,0.35)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--nx-status-warning)]"
          >
            临时配置（未保存）
          </span>
        )}

        <div className="flex-1" />

        {isLoading ? (
          <span
            data-gv-preview-pending
            role="status"
            className="flex items-center gap-1 text-[10px] text-[var(--nx-text-muted)]"
          >
            <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
            解算中…
          </span>
        ) : null}

        {canManage ? (
          <button
            type="button"
            data-gv-save-as-view
            onClick={() =>
              onSaveAsView({
                primaryGrouping: primary,
                sort: sortKey,
                order,
              })
            }
            className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <Save className="h-3.5 w-3.5" aria-hidden />
            保存为视图
          </button>
        ) : null}
      </div>

      <p className="px-0.5 text-[10px] text-[var(--nx-text-muted)]">
        按「{dimLabel}」分组 · 按「{sortLabel}」{order === 'asc' ? '升序' : '降序'}
      </p>

      {/* ─── 解算结果区 ─────────────────────────────────── */}
      {!hasSettled && isLoading ? (
        <div
          data-gv-preview-skeleton
          role="status"
          aria-busy="true"
          aria-label="组合解算加载中"
          className="flex flex-col gap-2 py-1"
        >
          <div className="h-6 w-72 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
            ))}
          </div>
        </div>
      ) : preview.isError ? (
        <div
          data-gv-preview-error
          role="alert"
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <AlertCircle className="h-6 w-6 text-[var(--nx-status-danger)]" aria-hidden />
          <p className="text-xs font-medium text-[var(--nx-text-primary)]">组合解算失败</p>
          <p className="max-w-sm text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
            {errorMessage ?? '数据不存在或服务暂时不可用，请稍后重试。'}
          </p>
          <button
            type="button"
            data-gv-preview-retry
            onClick={handleRetry}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新解算
          </button>
        </div>
      ) : result ? (
        <PreviewResult result={result} stale={isLoading} />
      ) : (
        <div
          data-gv-preview-idle
          className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
        >
          <Eye className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-xs font-medium text-[var(--nx-text-primary)]">尚未开始解算组合</p>
          <p className="max-w-sm text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            从左侧选择系统预设或自定义视图，或调整上方分组维度 / 排序后自动解算组合切片。
          </p>
        </div>
      )}
    </section>
  )
}

// ─── 解算结果渲染（纯展示，零请求） ─────────────────────────────────────────

function PreviewResult({
  result,
  stale,
}: {
  result: PmoGroupingViewPreviewResponse
  stale: boolean
}) {
  const staleSources = result.freshness.filter((entry) => entry.isStale)
  const firstFresh = result.freshness.find((entry) => entry.lastUpdatedAt)

  return (
    <div data-gv-preview-result className={cn('flex flex-col gap-3', stale && 'opacity-70')}>
      {/* Meta bar */}
      <div className="flex flex-wrap items-center gap-3 px-0.5 text-[10px] text-[var(--nx-text-muted)]">
        <span data-gv-meta-projects>
          可见项目 {result.meta.visibleProjectCount} · 分组 {result.meta.primaryGroupCount}
        </span>
        {result.meta.truncated ? (
          <span
            data-gv-meta-truncated
            className="rounded-sm border border-[rgba(245,158,11,0.35)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--nx-status-warning)]"
          >
            结果已截断
          </span>
        ) : null}
        {staleSources.length > 0 ? (
          <span
            data-gv-freshness-stale
            className="flex items-center gap-1 rounded-sm border border-[rgba(245,158,11,0.35)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--nx-status-warning)]"
          >
            <Clock className="h-2.5 w-2.5" aria-hidden />
            数据可能过期
          </span>
        ) : firstFresh?.lastUpdatedAt ? (
          <span className="flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" aria-hidden />
            更新于 {new Date(firstFresh.lastUpdatedAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      {result.groups.length === 0 ? (
        <div
          data-gv-preview-empty
          className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <p className="text-xs font-medium text-[var(--nx-text-primary)]">没有可呈现的项目分组</p>
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            当前配置下无可见项目数据，可尝试切换分组维度或排序。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {result.groups.map((group) => (
            <div
              key={`${group.groupKey}-${group.groupValue}`}
              data-gv-group-card
              data-gv-group-key={group.groupValue || '(未分类)'}
              className="flex min-w-0 flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-[var(--nx-text-primary)]">
                  {group.groupValue || '(未分类)'}
                </span>
                <span
                  data-gv-group-count
                  className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--nx-text-secondary)]"
                >
                  {group.projectCount} 项
                </span>
              </div>
              {group.kpis.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {group.kpis.map((kpi) => (
                    <span
                      key={kpi.key}
                      data-gv-group-kpi
                      data-gv-group-kpi-key={kpi.key}
                      className="flex items-baseline gap-1 rounded-sm bg-[var(--nx-bg-0)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-secondary)]"
                    >
                      <span className="text-[var(--nx-text-primary)]">
                        {formatKpiValue(kpi.value, kpi.unit)}
                      </span>
                      <span className="text-[9px] text-[var(--nx-text-muted)]">
                        {GV_METRIC_LABELS[kpi.key] ?? kpi.key}
                      </span>
                    </span>
                  ))}
                </div>
              ) : null}
              {group.secondaryGroups && group.secondaryGroups.length > 0 ? (
                <div className="flex flex-col gap-1 border-t border-[var(--nx-border-hairline)] pt-1.5">
                  {group.secondaryGroups.map((sub) => (
                    <div
                      key={`${sub.secondaryKey}-${sub.secondaryValue}`}
                      data-gv-group-secondary
                      className="flex items-center justify-between gap-2 px-0.5 text-[10px] text-[var(--nx-text-muted)]"
                    >
                      <span className="truncate">{sub.secondaryValue || '(未分类)'}</span>
                      <span className="shrink-0 font-mono text-[9px]">{sub.projectCount} 项</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {group.warnings.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {group.warnings.map((warning, index) => (
                    <span
                      key={`${warning.code}-${index}`}
                      data-gv-group-warning
                      title={warning.message}
                      className="rounded-sm border border-[rgba(245,158,11,0.3)] px-1 py-px font-mono text-[9px] text-[var(--nx-status-warning)]"
                    >
                      {warning.code}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {result.warnings.length > 0 ? (
        <div
          data-gv-preview-warnings
          className="flex flex-col gap-1 rounded-md border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.06)] px-2.5 py-2"
        >
          {result.warnings.map((warning, index) => (
            <p
              key={`${warning.code}-${index}`}
              className="flex items-start gap-1.5 text-[10px] leading-relaxed text-[var(--nx-text-secondary)]"
            >
              <AlertCircle
                className="mt-0.5 h-3 w-3 shrink-0 text-[var(--nx-status-warning)]"
                aria-hidden
              />
              {warning.message}
            </p>
          ))}
        </div>
      ) : null}

      {result.compare && !result.compare.available ? (
        <p
          data-gv-compare-note
          className="rounded-sm border border-[var(--nx-border-hairline)] px-2.5 py-1.5 text-[10px] text-[var(--nx-text-muted)]"
        >
          比较模式暂不可用
        </p>
      ) : null}
    </div>
  )
}

export default PmoGroupingPreviewBoard
