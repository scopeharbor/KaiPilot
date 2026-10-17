'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Clock,
  EyeOff,
  Grid3X3,
  List,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react'
import { resourceContentionApi, resourceContentionKeys } from '@/lib/api/resource-contentions'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import {
  asSinglePayload,
  buildContentionListRow,
  buildContentionMatrixModel,
  classifyApiError,
  CONTENTION_REDACTED_PLACEHOLDER,
  CONTENTION_REASON_FILTER_OPTIONS,
  CONTENTION_SEVERITY_FILTER_OPTIONS,
  CONTENTION_SEVERITY_META,
  contentionStateToQuery,
  formatContentionWindow,
  hasActiveContentionFilters,
  parseContentionUrlState,
  resolveErrorMessageText,
  serializeContentionUrlState,
  type ContentionMatrixModel,
  type ContentionMatrixRowModel,
  type ContentionUrlState,
} from '@/lib/next/org-contentions/org-contentions-adapter'
import type {
  ResourceContentionMatrix,
  ResourceContentionReasonCode,
  ResourceContentionSeverity,
  ResourceContentionSummary,
} from '@aiproj/types'
import { ContentionEvidenceDrawer } from './ContentionEvidenceDrawer'
import {
  ContentionSuggestionDrawer,
  type ContentionSuggestionKind,
} from './ContentionSuggestionDrawer'

/**
 * 资源争用检测工作台（v3-ui-next-org-portfolio-domains W5 · tasks 5.2/5.3，
 * spec「资源争用检测与需求预测：summary 卡 + list/matrix 双视图」）。
 *
 * - 数据源 100% 复用既有 hooks：useResourceContentionSummary/Items/Matrix
 *   （/resource-contentions summary/items/matrix，组织隔离由 hooks 内建）；
 * - URL query 是筛选唯一事实来源（restorable filters）：severity/reasonCode/view/page
 *   全部序列化写回 router，刷新/分享不丢状态（design Decision 5）；
 * - list/matrix 双视图：矩阵为 DOM 网格（颜色+文字双通道，RL-15），列表行承载
 *   证据/建议抽屉入口（evidence/suggestions 端点只读；403 受限中性态由抽屉呈现）；
 * - 只读铁律：本工作台零写入口（RL-01），一切交互仅触发 GET 重查；
 * - 加载骨架（aria-busy）/ 语义空态 / 错误区分（受限中性 vs 5xx 可重试）三态闭环。
 */

const SEVERITY_ORDER: readonly ResourceContentionSeverity[] = [
  'critical',
  'high',
  'warning',
  'info',
]

const iconClass =
  'inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]'
const labelClass = 'mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]'
const selectClass =
  'h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]'

// ── 矩阵网格（DOM 双通道：色阶 + 文字） ────────────────────────────────────

export interface ContentionMatrixViewProps {
  model: ContentionMatrixModel
  windowText: string
}

/**
 * 5×N 资源×日期争用网格（含受限中性化单元格；颜色 + 文字双通道传达）。
 * 行操作仅止于查看（本视图不承载抽屉入口——矩阵行无 contentionId 事实键，
 * 证据/建议抽屉由列表行提供）。
 */
export function ContentionMatrixView({ model, windowText }: ContentionMatrixViewProps) {
  if (model.rows.length === 0) {
    return (
      <div
        data-contention-matrix-empty
        className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
      >
        <Grid3X3 className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-secondary)]">当前筛选条件下无争用记录</p>
        <p className="text-[11px] text-[var(--nx-text-muted)]">
          调整严重度/原因筛选或扩大日期窗口后重试。
        </p>
      </div>
    )
  }
  return (
    <div
      data-contention-matrix-view
      className="flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="font-mono text-[11px] text-[var(--nx-text-muted)]">{windowText}</p>
        <p className="text-[10px] text-[var(--nx-text-muted)]">
          色阶×文字双通道 · 受限单元格中性化（RL-05）
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border border-[var(--nx-border-hairline)]">
        <table
          className="w-full min-w-max border-collapse text-left text-[11px]"
          aria-label="资源争用矩阵"
        >
          <thead>
            <tr className="bg-[var(--nx-workspace-surface)] text-[var(--nx-text-muted)]">
              <th
                scope="col"
                className="sticky left-0 z-10 bg-[var(--nx-workspace-surface)] px-3 py-2 text-left font-medium"
              >
                资源 / 角色
              </th>
              {model.columns.map((column) => (
                <th
                  key={column.date}
                  scope="col"
                  className="px-2 py-2 text-center font-mono font-medium"
                >
                  {column.date}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-center font-medium">
                争用数
              </th>
              <th scope="col" className="px-2 py-2 text-center font-medium">
                最高严重度
              </th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <MatrixRow key={row.resourceId} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MatrixRow({ row }: { row: ContentionMatrixRowModel }) {
  return (
    <tr
      data-contention-matrix-row={row.resourceId}
      className="border-t border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]"
    >
      <td className="sticky left-0 z-10 bg-[var(--nx-workspace-bg)] px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          {row.redacted ? (
            <>
              <EyeOff className="h-3 w-3 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
              <span className="text-[var(--nx-text-muted)]">{CONTENTION_REDACTED_PLACEHOLDER}</span>
            </>
          ) : (
            <>
              <Users className="h-3 w-3 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
              <span className="text-[var(--nx-text-primary)]">{row.resourceDisplay}</span>
            </>
          )}
        </div>
        {row.roleDisplay ? (
          <p className="mt-0.5 pl-[18px] text-[10px] text-[var(--nx-text-muted)]">
            {row.roleDisplay}
          </p>
        ) : null}
      </td>
      {row.cells.map((cell) => {
        if (cell.redacted) {
          return (
            <td
              key={cell.date}
              aria-label={`${cell.date} 不可见`}
              className="px-2 py-1.5 text-center text-[10px] text-[var(--nx-text-muted)]"
              title="受限单元格不可见"
            >
              ·
            </td>
          )
        }
        if (cell.hasSignal && cell.severityChipClass && cell.severityLabel) {
          return (
            <td
              key={cell.date}
              aria-label={`${cell.date} ${cell.severityLabel}`}
              className="px-2 py-1.5 text-center"
            >
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
                  cell.severityChipClass,
                )}
              >
                {cell.severityLabel}
                {cell.loadPercent !== null ? (
                  <span className="font-mono opacity-80">{cell.loadPercent}%</span>
                ) : null}
              </span>
            </td>
          )
        }
        return (
          <td
            key={cell.date}
            aria-label={`${cell.date} 无争用`}
            className="px-2 py-1.5 text-center text-[10px] text-[var(--nx-text-muted)]"
          >
            {cell.loadPercent !== null ? `${cell.loadPercent}%` : '·'}
          </td>
        )
      })}
      <td className="px-2 py-1.5 text-center font-mono">
        {row.totalContentionsDisplay ?? <span className="text-[var(--nx-text-muted)]">—</span>}
      </td>
      <td className="px-2 py-1.5 text-center">
        {row.maxSeverityLabel && row.maxSeverityChipClass ? (
          <span
            className={cn(
              'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
              row.maxSeverityChipClass,
            )}
          >
            {row.maxSeverityLabel}
          </span>
        ) : (
          <span className="text-[var(--nx-text-muted)]">—</span>
        )}
      </td>
    </tr>
  )
}

// ── 工作台骨架屏 ─────────────────────────────────────────────────────────

function ContentionSkeleton() {
  return (
    <div
      data-contention-skeleton
      role="status"
      aria-busy="true"
      aria-label="正在加载资源争用数据"
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
          />
        ))}
      </div>
      <div className="h-9 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
      <div className="h-64 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
    </div>
  )
}

// ── 工作台 ────────────────────────────────────────────────────────────────

export function ContentionWorkspace() {
  const router = useRouter()
  const pathname = usePathname() ?? '/next/organization/resource-contentions'
  const searchParams = useSearchParams()

  const [urlState, setUrlState] = React.useState<ContentionUrlState>(() =>
    parseContentionUrlState(searchParams),
  )

  // 浏览器前进/后退或外部导航落回本页时，URL 再次成为事实源（restorable）。
  React.useEffect(() => {
    const fromUrl = parseContentionUrlState(searchParams)
    const currentQs = serializeContentionUrlState(urlState).toString()
    const nextQs = serializeContentionUrlState(fromUrl).toString()
    if (currentQs !== nextQs) {
      setUrlState(fromUrl)
    }
  }, [searchParams])

  const updateUrlState = (patch: Partial<ContentionUrlState>) => {
    setUrlState((current) => {
      const next: ContentionUrlState = { ...current, ...patch }
      const qs = serializeContentionUrlState(next).toString()
      const target = qs === '' ? pathname : `${pathname}?${qs}`
      const currentQs = searchParams.toString()
      if (currentQs !== qs) {
        router.push(target)
      }
      return next
    })
  }

  const setFilter = (patch: {
    severity?: ResourceContentionSeverity | ''
    reasonCode?: ResourceContentionReasonCode | ''
  }) => {
    updateUrlState({ ...patch, page: 1 })
  }

  const query = React.useMemo(() => contentionStateToQuery(urlState), [urlState])

  // 组织 ID 取自 auth store 有效租户上下文（页面层已就绪门禁，hooks 内建组织隔离）。
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  // 数据层复用既有 lib/api 契约与 query key 工厂（resourceContentionApi /
  // resourceContentionKeys）。说明：lib/next 页面在此直接消费 lib/api 层——
  // `hooks/use-resource-contention-detection.ts` 的 `.then(r => r.data)` 二次解包
  // 已在 W1（D-A）修复，单对象端点（summary/matrix/detail/evidence/suggestions）
  // 走 `apiFetch` 直出载荷；本组件仍以标准 useQuery 直连已查证契约并经域内
  // asSinglePayload 兼容历史信封两态，不新增 fetch 封装、不改写 query key。
  const summaryQuery = useQuery({
    queryKey: resourceContentionKeys.summary(organizationId ?? 0, query),
    queryFn: () =>
      resourceContentionApi
        .summary(organizationId as number, query)
        .then((result) => asSinglePayload<ResourceContentionSummary>(result)),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
  const itemsQuery = useQuery({
    queryKey: resourceContentionKeys.items(organizationId ?? 0, query),
    queryFn: () => resourceContentionApi.items(organizationId as number, query),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })
  const matrixQuery = useQuery({
    queryKey: resourceContentionKeys.matrix(organizationId ?? 0, query),
    queryFn: () =>
      resourceContentionApi
        .matrix(organizationId as number, query)
        .then((result) => asSinglePayload<ResourceContentionMatrix>(result)),
    enabled: organizationId !== null,
    staleTime: 60_000,
  })

  // 打开抽屉状态（证据 / 建议）
  const [evidenceId, setEvidenceId] = React.useState<string | null>(null)
  const [suggestionTarget, setSuggestionTarget] = React.useState<{
    contentionId: string
    kind: ContentionSuggestionKind
  } | null>(null)

  const matrixModel = React.useMemo<ContentionMatrixModel | null>(
    () => (matrixQuery.data ? buildContentionMatrixModel(matrixQuery.data) : null),
    [matrixQuery.data],
  )
  const matrixWindowText = React.useMemo(() => {
    const matrix = matrixQuery.data as ResourceContentionMatrix | undefined
    return matrix ? formatContentionWindow(matrix.from, matrix.to) : ''
  }, [matrixQuery.data])

  const view = urlState.view
  const listMode = view === 'list'

  // 三态判定：骨架（无数据加载中）→ 致命错误（当前视图无任何可用数据）→ 空态 → 内容
  const loading =
    (summaryQuery.isLoading && summaryQuery.data === undefined) ||
    (listMode
      ? itemsQuery.isLoading && itemsQuery.data === undefined
      : matrixQuery.isLoading && matrixQuery.data === undefined)

  const primaryError = summaryQuery.isError
    ? summaryQuery.error
    : listMode
      ? itemsQuery.error
      : matrixQuery.error
  const fatalError =
    (summaryQuery.isError && summaryQuery.data === undefined) ||
    (listMode
      ? itemsQuery.isError && itemsQuery.data === undefined
      : matrixQuery.isError && matrixQuery.data === undefined)
  const errorKind = fatalError && primaryError ? classifyApiError(primaryError).kind : null

  // 数据可用但次要查询失败的残余错误（列表/矩阵之外的另一视图查询）。
  const partialError = !fatalError
    ? summaryQuery.isError || (listMode ? matrixQuery.isError : itemsQuery.isError)
    : false

  const retryAll = () => {
    if (summaryQuery.isError) void summaryQuery.refetch()
    if (itemsQuery.isError) void itemsQuery.refetch()
    if (matrixQuery.isError) void matrixQuery.refetch()
  }

  const summary = summaryQuery.data
  const totalContentions = summary?.totalContentions ?? 0
  const isEmpty = Boolean(summary && totalContentions === 0)

  return (
    <div data-contention-workspace aria-busy={loading || undefined} className="flex flex-col gap-4">
      {/* 页头 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={iconClass}>
            <Zap className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1
              data-contention-title
              className="text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              资源争用检测
            </h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              组织级资源争用告警：跨项目过载 / 不可用分配 / 关键技能争用 —— 只读咨询（RL-01）
            </p>
          </div>
        </div>
        {hasActiveContentionFilters(urlState) ? (
          <button
            type="button"
            data-contention-filters-reset
            onClick={() => setFilter({ severity: '', reasonCode: '' })}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            重置筛选
          </button>
        ) : null}
      </header>

      {loading ? (
        <ContentionSkeleton />
      ) : fatalError ? (
        // 主导查询无可用数据时的错误卡（受限中性 / 未找到中性 / 5xx 重试）
        <div
          data-contention-error
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          {errorKind === 'forbidden' ? (
            <>
              <EyeOff className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
              <p className="text-sm text-[var(--nx-text-secondary)]">争用数据不可见</p>
              <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                当前组织上下文下无查看争用聚合的权限。请联系组织管理员授予资源/组合视野权限。
              </p>
            </>
          ) : errorKind === 'not_found' ? (
            <>
              <ShieldAlert className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
              <p className="text-sm text-[var(--nx-text-secondary)]">争用数据暂不可用</p>
              <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                数据源未就绪（统一中性处理）。
              </p>
            </>
          ) : (
            <>
              <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
              <p className="text-sm text-[var(--nx-text-secondary)]">争用数据加载失败</p>
              <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                {errorKind === 'server' || errorKind === 'network'
                  ? resolveErrorMessageText(primaryError, '服务暂时不可用或网络异常')
                  : '数据加载异常'}
              </p>
              {errorKind === 'server' || errorKind === 'network' ? (
                <button
                  type="button"
                  data-contention-retry
                  onClick={retryAll}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  重试
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : isEmpty ? (
        <div
          data-contention-empty
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-8 py-14 text-center"
        >
          <Zap className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            暂未检测到资源争用
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            当前时间窗口内无跨项目过载、不可用分配或其他资源争用。争用检测随资源
            排程变化自动刷新，无需人工触发。
          </p>
        </div>
      ) : (
        <>
          {/* 严重度摘要卡（双通道：色阶 + 中文标签 + 计数） */}
          {summary ? (
            <section
              data-contention-summary
              aria-label="争用严重度摘要"
              className="grid grid-cols-2 gap-3 md:grid-cols-4"
            >
              {SEVERITY_ORDER.map((severity) => {
                const meta = CONTENTION_SEVERITY_META[severity]
                const count = summary.severityCounts[severity] ?? 0
                return (
                  <button
                    key={severity}
                    type="button"
                    data-contention-summary-card={severity}
                    aria-label={`${meta.label}: ${count} 项`}
                    onClick={() =>
                      setFilter({ severity: urlState.severity === severity ? '' : severity })
                    }
                    className={cn(
                      'flex items-center gap-3 rounded-lg border bg-[var(--nx-bg-0)] px-3.5 py-3 text-left transition-colors hover:border-[var(--nx-border-focus)]',
                      meta.chipClass,
                    )}
                  >
                    <span className="text-2xl font-semibold tabular-nums">{count}</span>
                    <span className="text-xs text-[var(--nx-text-secondary)]">{meta.label}</span>
                  </button>
                )
              })}
            </section>
          ) : null}

          {/* 新鲜度 / 脱敏警告 */}
          {summary &&
          (summary.sourceFreshness.some((f) => f.isStale) || summary.warnings.length > 0) ? (
            <div
              data-contention-warnings
              className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2"
            >
              {summary.sourceFreshness
                .filter((f) => f.isStale)
                .map((f) => (
                  <span
                    key={f.source}
                    className="inline-flex items-center gap-1 rounded-sm border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-status-warning)]"
                  >
                    <Clock className="h-3 w-3" aria-hidden />
                    来源 {f.source} 可能过期
                  </span>
                ))}
              {summary.warnings.map((warning, index) => (
                <span
                  key={`${warning.code}-${index}`}
                  className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]"
                  title={warning.code}
                >
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  {warning.message}
                </span>
              ))}
            </div>
          ) : null}

          {/* 筛选条 + 视图切换（URL 写回） */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <label className={labelClass} htmlFor="contention-severity-filter">
                  严重度
                </label>
                <select
                  id="contention-severity-filter"
                  data-contention-severity-filter
                  value={urlState.severity}
                  onChange={(event) =>
                    setFilter({ severity: event.target.value as ResourceContentionSeverity | '' })
                  }
                  className={selectClass}
                >
                  {CONTENTION_SEVERITY_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="contention-reason-filter">
                  原因
                </label>
                <select
                  id="contention-reason-filter"
                  data-contention-reason-filter
                  value={urlState.reasonCode}
                  onChange={(event) =>
                    setFilter({
                      reasonCode: event.target.value as ResourceContentionReasonCode | '',
                    })
                  }
                  className={selectClass}
                >
                  {CONTENTION_REASON_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div
              role="radiogroup"
              aria-label="视图切换"
              className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-0.5"
            >
              <button
                type="button"
                role="radio"
                aria-checked={!listMode}
                data-contention-view-matrix
                onClick={() => updateUrlState({ view: 'matrix', page: 1 })}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition-colors',
                  !listMode
                    ? 'bg-[var(--nx-accent)]/10 text-[var(--nx-text-primary)]'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                <Grid3X3 className="h-3.5 w-3.5" aria-hidden />
                矩阵
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={listMode}
                data-contention-view-list
                onClick={() => updateUrlState({ view: 'list', page: 1 })}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition-colors',
                  listMode
                    ? 'bg-[var(--nx-accent)]/10 text-[var(--nx-text-primary)]'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                <List className="h-3.5 w-3.5" aria-hidden />
                列表
              </button>
            </div>
            {summary ? (
              <p className="ml-auto text-[11px] text-[var(--nx-text-muted)]">
                共{' '}
                <span className="font-mono text-[var(--nx-text-secondary)]">
                  {totalContentions}
                </span>{' '}
                项 · 涉及资源{' '}
                <span className="font-mono text-[var(--nx-text-secondary)]">
                  {summary.affectedResourceCount}
                </span>{' '}
                · 项目{' '}
                <span className="font-mono text-[var(--nx-text-secondary)]">
                  {summary.affectedProjectCount}
                </span>
              </p>
            ) : null}
          </div>

          {/* 视图内容 */}
          {!listMode && matrixModel ? (
            <ContentionMatrixView model={matrixModel} windowText={matrixWindowText || '争用矩阵'} />
          ) : null}
          {listMode ? <ContentionListView /> : null}

          {/* 残余错误提示（数据可用但另一视图查询失败，5xx/网络可重试） */}
          {partialError ? (
            <div
              data-contention-partial-error
              className="flex items-center justify-between gap-2 rounded-sm border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.08)] px-3 py-2"
            >
              <p className="text-[11px] text-[var(--nx-status-danger)]">
                部分争用数据加载失败，可重试。
              </p>
              <button
                type="button"
                data-contention-partial-retry
                onClick={retryAll}
                className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-accent)]"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                重试
              </button>
            </div>
          ) : null}
        </>
      )}

      {/* 只读抽屉（零写入口） */}
      <ContentionEvidenceDrawer
        contentionId={evidenceId}
        open={evidenceId !== null}
        onClose={() => setEvidenceId(null)}
      />
      <ContentionSuggestionDrawer
        contentionId={suggestionTarget?.contentionId ?? null}
        open={suggestionTarget !== null}
        initialKind={suggestionTarget?.kind ?? 'rule'}
        onClose={() => setSuggestionTarget(null)}
      />
    </div>
  )

  /** 列表视图（仅 list mode 挂载；行内证据/建议抽屉入口，全部只读）。 */
  function ContentionListView() {
    const items = itemsQuery.data?.data ?? []
    const meta = itemsQuery.data?.meta
    const itemsLoading = itemsQuery.isLoading
    const itemsError = itemsQuery.isError

    if (itemsLoading && items.length === 0) {
      return (
        <div data-contention-list-loading role="status" aria-busy="true" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
            />
          ))}
        </div>
      )
    }
    if (itemsError && items.length === 0) return null

    if (items.length === 0) {
      return (
        <div
          data-contention-list-empty
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
        >
          <List className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">当前筛选条件下无争用记录</p>
          <p className="text-[11px] text-[var(--nx-text-muted)]">调整严重度/原因筛选后重试。</p>
        </div>
      )
    }

    const totalPages = meta?.totalPages ?? 1
    const page = urlState.page

    return (
      <div className="flex flex-col gap-3">
        <ul data-contention-list className="flex flex-col gap-2" aria-label="争用列表">
          {items.map((item) => {
            const row = buildContentionListRow(item)
            return (
              <li
                key={row.contentionId}
                data-contention-list-row={row.contentionId}
                className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3.5 transition-colors hover:border-[var(--nx-border-focus)]"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
                      row.severityChipClass,
                    )}
                  >
                    {row.severityLabel}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13px] font-semibold text-[var(--nx-text-primary)]">
                        {row.reasonLabel}
                      </span>
                      {row.redacted ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--nx-text-muted)]">
                          <EyeOff className="h-3 w-3" aria-hidden />
                          {row.redactionLabel}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                      {row.description}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--nx-text-muted)]">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" aria-hidden />
                        {row.resourceRedacted ? (
                          <span className="flex items-center gap-1">
                            <EyeOff className="h-3 w-3" aria-hidden />
                            {row.resourceDisplay}
                          </span>
                        ) : (
                          row.resourceDisplay
                        )}
                      </span>
                      {row.projectNames.length > 0 ? (
                        <span>项目：{row.projectNames.join(' · ')}</span>
                      ) : null}
                      <span className="font-mono">{formatContentionWindow(row.from, row.to)}</span>
                      {row.loadPercent !== null ? (
                        <span className="font-mono">负载 {row.loadPercent}%</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      data-contention-row-evidence
                      aria-label={`查看 ${row.contentionId} 证据`}
                      onClick={() => setEvidenceId(row.contentionId)}
                      className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
                    >
                      证据
                    </button>
                    <button
                      type="button"
                      data-contention-row-suggestion-rule
                      aria-label={`查看 ${row.contentionId} 规则建议`}
                      onClick={() =>
                        setSuggestionTarget({ contentionId: row.contentionId, kind: 'rule' })
                      }
                      className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
                    >
                      规则建议
                    </button>
                    <button
                      type="button"
                      data-contention-row-suggestion-ai
                      aria-label={`查看 ${row.contentionId} AI 建议`}
                      onClick={() =>
                        setSuggestionTarget({ contentionId: row.contentionId, kind: 'ai' })
                      }
                      className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
                    >
                      <Sparkles className="h-3 w-3" aria-hidden />
                      AI 建议
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>

        {/* 分页（写回 URL page） */}
        {totalPages > 1 ? (
          <nav aria-label="争用列表分页" className="flex items-center justify-center gap-4 pt-1">
            <button
              type="button"
              data-contention-page-prev
              disabled={page <= 1}
              onClick={() => updateUrlState({ page: Math.max(1, page - 1) })}
              className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft className="h-3 w-3" aria-hidden />
              上一页
            </button>
            <span className="text-[11px] text-[var(--nx-text-muted)]" aria-live="polite">
              第 {meta?.page ?? page} / {totalPages} 页（共 {meta?.total ?? items.length} 项）
            </span>
            <button
              type="button"
              data-contention-page-next
              disabled={page >= totalPages}
              onClick={() => updateUrlState({ page: page + 1 })}
              className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一页
              <ArrowRight className="h-3 w-3" aria-hidden />
            </button>
          </nav>
        ) : null}
      </div>
    )
  }
}

export default ContentionWorkspace
