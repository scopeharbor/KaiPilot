'use client'

import * as React from 'react'
import { flexRender } from '@tanstack/react-table'
import {
  getCoreRowModel,
  useLegacyTable,
  type LegacyColumnDef as ColumnDef,
} from '@tanstack/react-table/legacy'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FilterX,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import {
  deleteRisk,
  listRisks,
  transitionRiskStatus,
  type Risk,
  type RiskCategory,
  type RiskListResponse,
  type RiskStatus,
} from '@/lib/api/risks'
import { useAuthStore } from '@/stores/auth-store'
import { usePermissions } from '@/hooks/use-permissions'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { cn } from '@/lib/utils'
import {
  RISK_CATEGORY_LABELS,
  RISK_LEVEL_SHORT_LABELS,
  RISK_SCALE_LABELS,
  RISK_STATUS_LABELS,
  RISK_TONE_LABELS,
  nextRiskStatuses,
  riskExposureTone,
  riskScoreTone,
  type RiskCellRef,
  type RiskTone,
} from '@/components/next/charts/risk/risk-meta'

/**
 * 风险登记底册（操作面版，v3-ui-next-risk-change-domains W1 · tasks 1.5，
 * spec「风险登记底册、多维检索与受控全生命周期管理」）。
 *
 * - 数据：既有端点 GET /projects/:projectId/risks（分页遍历拉取全量底册，
 *   矩阵单元格收敛过滤无服务端参数，必须持全量做确定性本地筛选）；
 * - 多维筛选：分类 / 状态 / 敞口分值区间 / 关键字 + 5×5 矩阵单元格联动过滤胶囊；
 * - 受控状态推进：状态下拉仅呈现 @aiproj/types RISK_ALLOWED_TRANSITIONS 白名单目标
 *   （非法流转 UI 不可达），提交调用 POST /risks/:id/status；
 * - 两步确认删除：二次确认弹窗后调用 DELETE /risks/:id（写能力才暴露入口）；
 * - 写成功统一失效 ['risks'] / ['risks-v2'] / ['risk-matrix']（RL-04 联动）；
 * - 行权限：risk:update / risk:manage 全量编辑，risk:update_own 仅本人负责行；
 *   无权一律物理隐藏编辑入口并回退只读徽章（RL-06）。
 */

const PAGE_SIZE = 10
const TONE_TEXT: Record<RiskTone, string> = {
  low: 'text-[var(--nx-status-success)]',
  medium: 'text-[var(--nx-status-warning)]',
  high: 'text-[var(--nx-status-danger)]',
}

/** 确定性日期展示（UTC 日历日）。 */
export function formatRiskDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 分页遍历拉取项目风险全量底册（perPage 服务端上限 100，封顶 1000 条）。 */
async function fetchAllRisks(projectId: number): Promise<Risk[]> {
  const pageSize = 100
  const all: Risk[] = []
  let page = 1
  for (;;) {
    const res: RiskListResponse = await listRisks(projectId, { page, perPage: pageSize })
    all.push(...(res.data ?? []))
    const totalPages = res.meta?.totalPages ?? 1
    if (page >= totalPages || totalPages <= 0 || all.length >= 1000) break
    page += 1
  }
  return all
}

/** 本操作面底册查询键（统一失效走 ['risks'] 前缀）。 */
export const riskOperationalRegisterKey = (projectId: number) =>
  ['risks', 'operational-register', projectId] as const

export interface RiskOperationalTableProps {
  projectId: number
  /** 矩阵单元格联动过滤（概率 × 影响）；null = 无单元格筛选 */
  cellFilter: RiskCellRef | null
  /** 清除矩阵单元格筛选（底册本地过滤条件由组件自持） */
  onClearCellFilter: () => void
  /** 打开风险详情编辑抽屉（行内受控编辑入口） */
  onEditRisk: (riskId: number) => void
}

export function RiskOperationalTable({
  projectId,
  cellFilter,
  onClearCellFilter,
  onEditRisk,
}: RiskOperationalTableProps) {
  const queryClient = useQueryClient()
  const { canAny } = usePermissions()
  const currentUserId = useAuthStore((state) => state.user?.id ?? null)

  const canUpdateRisk = canAny(['risk:manage', 'risk:update'])
  const canDeleteRisk = canAny(['risk:manage', 'risk:delete'])
  const canUpdateOwn = canAny(['risk:update_own'])

  // ---------------- 数据 ----------------
  const {
    data: risks,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: riskOperationalRegisterKey(projectId),
    queryFn: () => fetchAllRisks(projectId),
    enabled: projectId > 0,
  })

  // ---------------- 本地筛选态 ----------------
  const [categoryFilter, setCategoryFilter] = React.useState<RiskCategory | 'all'>('all')
  const [statusFilter, setStatusFilter] = React.useState<RiskStatus | 'all'>('all')
  const [minScore, setMinScore] = React.useState<number | null>(null)
  const [maxScore, setMaxScore] = React.useState<number | null>(null)
  const [keyword, setKeyword] = React.useState('')
  const [page, setPage] = React.useState(1)

  React.useEffect(() => {
    setPage(1)
  }, [categoryFilter, statusFilter, minScore, maxScore, keyword, cellFilter])

  // ---------------- 写操作 ----------------
  const [deletingRisk, setDeletingRisk] = React.useState<Risk | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const invalidateAll = React.useCallback(() => {
    setActionError(null)
    setDeletingRisk(null)
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['risks'] }),
      queryClient.invalidateQueries({ queryKey: ['risks-v2'] }),
      queryClient.invalidateQueries({ queryKey: ['risk-matrix'] }),
    ])
  }, [queryClient])

  const transitionMutation = useMutation({
    mutationFn: ({ riskId, status }: { riskId: number; status: RiskStatus }) =>
      transitionRiskStatus(projectId, riskId, status),
    onSuccess: () => invalidateAll(),
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : '状态推进失败，请重试')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (riskId: number) => deleteRisk(projectId, riskId),
    onSuccess: () => invalidateAll(),
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : '删除风险失败，请重试')
      setDeletingRisk(null)
    },
  })

  const anyWritePending = transitionMutation.isPending || deleteMutation.isPending

  // 删除确认弹层：Escape 关闭；删除请求在途时拒绝关闭（与弹层「取消」按钮 disabled 同判据）。
  const deleteDialogRef = React.useRef<HTMLDivElement | null>(null)
  useDialogA11y({
    ref: deleteDialogRef,
    open: deletingRisk !== null,
    onClose: () => setDeletingRisk(null),
    canClose: () => !deleteMutation.isPending,
  })

  // ---------------- 行权限 ----------------
  const canEditRow = (risk: Risk) =>
    canUpdateRisk || (canUpdateOwn && risk.ownerId !== null && risk.ownerId === currentUserId)

  // ---------------- 派生视图 ----------------
  const allRisks = risks ?? []
  const filteredRows = React.useMemo(() => {
    const query = keyword.trim().toLowerCase()
    return allRisks.filter((risk) => {
      if (cellFilter) {
        if (risk.probability !== cellFilter.probability || risk.impact !== cellFilter.impact) {
          return false
        }
      }
      if (categoryFilter !== 'all' && risk.category !== categoryFilter) return false
      if (statusFilter !== 'all' && risk.status !== statusFilter) return false
      if (minScore !== null && (risk.score ?? risk.probability * risk.impact) < minScore) {
        return false
      }
      if (maxScore !== null && (risk.score ?? risk.probability * risk.impact) > maxScore) {
        return false
      }
      if (query) {
        const haystack = `${risk.riskCode ?? ''} ${risk.title} ${risk.description}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [allRisks, cellFilter, categoryFilter, statusFilter, minScore, maxScore, keyword])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const hasLocalFilter =
    categoryFilter !== 'all' ||
    statusFilter !== 'all' ||
    minScore !== null ||
    maxScore !== null ||
    keyword.trim() !== '' ||
    cellFilter !== null

  const cellFilteredCount = React.useMemo(() => {
    if (!cellFilter) return 0
    return allRisks.filter(
      (risk) => risk.probability === cellFilter.probability && risk.impact === cellFilter.impact,
    ).length
  }, [allRisks, cellFilter])

  const columns = React.useMemo<ColumnDef<Risk>[]>(
    () => [
      {
        accessorKey: 'riskCode',
        header: '编号',
        cell: ({ row }) => (
          <span data-risk-cell-code className="font-mono text-[11px] text-[var(--nx-text-muted)]">
            {row.original.riskCode ?? `#${row.original.id}`}
          </span>
        ),
      },
      {
        accessorKey: 'title',
        header: '标题',
        cell: ({ row }) => (
          <div className="max-w-64">
            <p
              data-risk-cell-title
              className="truncate text-[13px] font-medium text-[var(--nx-text-primary)]"
            >
              {row.original.title}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
              {row.original.description}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'category',
        header: '分类',
        cell: ({ row }) => {
          const category = row.original.category as RiskCategory
          return (
            <span
              data-risk-cell-category
              className="inline-block rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
            >
              {RISK_CATEGORY_LABELS[category] ?? category}
            </span>
          )
        },
      },
      {
        accessorKey: 'probability',
        id: 'exposure',
        header: '概率 × 影响',
        cell: ({ row }) => {
          const { probability, impact } = row.original
          const tone = riskExposureTone(probability, impact)
          return (
            <span
              data-risk-cell-exposure
              data-risk-cell-exposure-tone={tone}
              title={`概率 ${RISK_LEVEL_SHORT_LABELS[probability - 1]} · 影响 ${RISK_LEVEL_SHORT_LABELS[impact - 1]}`}
              className={cn('whitespace-nowrap font-mono text-xs', TONE_TEXT[tone])}
            >
              {probability} × {impact}
            </span>
          )
        },
      },
      {
        accessorKey: 'score',
        header: '分值',
        cell: ({ row }) => {
          const risk = row.original
          const score = risk.score ?? risk.probability * risk.impact
          const tone = riskScoreTone(score)
          return (
            <span
              data-risk-cell-score
              data-risk-cell-score-tone={tone}
              aria-label={`敞口得分 ${score}，${RISK_TONE_LABELS[tone]}`}
              className={cn('font-mono text-xs font-semibold', TONE_TEXT[tone])}
            >
              {score}
            </span>
          )
        },
      },
      {
        accessorKey: 'status',
        id: 'status',
        header: '状态',
        cell: ({ row }) => {
          const risk = row.original
          const status = risk.status
          const allowed = nextRiskStatuses(status)
          if (!canUpdateRisk || allowed.length === 0) {
            return (
              <span
                data-risk-cell-status
                className="inline-block rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
              >
                {RISK_STATUS_LABELS[status] ?? status}
              </span>
            )
          }
          return (
            <select
              data-risk-status-select
              aria-label={`${risk.title} 状态`}
              value={status}
              disabled={anyWritePending}
              onChange={(event) => {
                const next = event.target.value as RiskStatus
                if (next !== status) {
                  transitionMutation.mutate({ riskId: risk.id, status: next })
                }
              }}
              className="h-7 max-w-28 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1 text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-50"
            >
              <option value={status} disabled={allowed.length > 0}>
                {RISK_STATUS_LABELS[status] ?? status}
              </option>
              {allowed.map((next) => (
                <option key={next} value={next}>
                  {RISK_STATUS_LABELS[next] ?? next}
                </option>
              ))}
            </select>
          )
        },
      },
      {
        accessorKey: 'ownerId',
        header: '责任人',
        cell: ({ row }) => {
          const ownerId = row.original.ownerId
          return (
            <span
              data-risk-cell-owner
              className="font-mono text-[11px] text-[var(--nx-text-secondary)]"
            >
              {ownerId === null ? '—' : `#${ownerId}`}
            </span>
          )
        },
      },
      {
        accessorKey: 'targetResolutionDate',
        header: '目标解决',
        cell: ({ row }) => (
          <span
            data-risk-cell-target
            className="whitespace-nowrap font-mono text-[11px] text-[var(--nx-text-secondary)]"
          >
            {formatRiskDate(row.original.targetResolutionDate)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '操作',
        cell: ({ row }) => {
          const risk = row.original
          const editable = canEditRow(risk)
          const deletable = canDeleteRisk
          if (!editable && !deletable) {
            return (
              <span data-risk-cell-actions className="text-[10px] text-[var(--nx-text-muted)]">
                只读
              </span>
            )
          }
          return (
            <div data-risk-cell-actions className="flex items-center gap-1">
              {editable ? (
                <button
                  type="button"
                  data-risk-edit-open
                  aria-label={`编辑 ${risk.title}`}
                  disabled={anyWritePending}
                  onClick={() => {
                    setActionError(null)
                    setDeletingRisk(null)
                    onEditRisk(risk.id)
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-sm border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:opacity-50"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
              {deletable ? (
                <button
                  type="button"
                  data-risk-delete-open
                  aria-label={`删除 ${risk.title}`}
                  disabled={anyWritePending}
                  onClick={() => {
                    setActionError(null)
                    setDeletingRisk(risk)
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-sm border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-status-danger)] hover:text-[var(--nx-status-danger)] disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
          )
        },
      },
    ],
    [
      canUpdateRisk,
      canDeleteRisk,
      canEditRow,
      currentUserId,
      canUpdateOwn,
      anyWritePending,
      onEditRisk,
    ],
  )

  const table = useLegacyTable({
    data: pageRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  })

  const clearAllFilters = () => {
    setCategoryFilter('all')
    setStatusFilter('all')
    setMinScore(null)
    setMaxScore(null)
    setKeyword('')
    onClearCellFilter()
    setPage(1)
  }

  const selectClass =
    'h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none'
  const scoreOptions = React.useMemo(() => Array.from({ length: 25 }, (_, i) => i + 1), [])

  return (
    <section
      data-risk-operational-register
      aria-busy={isLoading || isFetching}
      className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      {/* 区块标题 + 汇总 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">风险登记底册</h3>
          <span
            data-risk-register-total
            className="font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            共 {allRisks.length} 条
          </span>
        </div>
        {actionError ? (
          <p
            role="alert"
            aria-label="风险操作失败"
            data-risk-register-action-error
            className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
          >
            {actionError}
          </p>
        ) : null}
      </div>

      {/* 矩阵单元格联动过滤胶囊 */}
      {cellFilter ? (
        <div
          data-risk-cell-filter-chip
          className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 py-1.5"
        >
          <p className="text-[11px] text-[var(--nx-text-secondary)]">
            <span className="text-[var(--nx-accent)]">矩阵单元格筛选</span>：概率{' '}
            {cellFilter.probability}（{RISK_SCALE_LABELS[cellFilter.probability - 1]}）× 影响{' '}
            {cellFilter.impact}（{RISK_SCALE_LABELS[cellFilter.impact - 1]}）
            <span className="text-[var(--nx-text-muted)]">
              {' '}
              · {
                RISK_TONE_LABELS[riskExposureTone(cellFilter.probability, cellFilter.impact)]
              } · {cellFilteredCount} 条
            </span>
          </p>
          <button
            type="button"
            data-risk-cell-filter-clear
            onClick={() => {
              onClearCellFilter()
              setPage(1)
            }}
            className="flex h-6 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            <X className="h-3 w-3" aria-hidden />
            清除筛选
          </button>
        </div>
      ) : null}

      {/* 多维筛选工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="risk-ops-filter-category">
          按分类筛选风险
        </label>
        <select
          id="risk-ops-filter-category"
          data-risk-filter-category
          aria-label="按分类筛选风险"
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value as RiskCategory | 'all')}
          className={selectClass}
        >
          <option value="all">全部分类</option>
          {(Object.keys(RISK_CATEGORY_LABELS) as RiskCategory[]).map((key) => (
            <option key={key} value={key}>
              {RISK_CATEGORY_LABELS[key]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="risk-ops-filter-status">
          按状态筛选风险
        </label>
        <select
          id="risk-ops-filter-status"
          data-risk-filter-status
          aria-label="按状态筛选风险"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as RiskStatus | 'all')}
          className={selectClass}
        >
          <option value="all">全部状态</option>
          {(Object.keys(RISK_STATUS_LABELS) as RiskStatus[]).map((key) => (
            <option key={key} value={key}>
              {RISK_STATUS_LABELS[key]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="risk-ops-filter-min-score">
          最低敞口分值
        </label>
        <select
          id="risk-ops-filter-min-score"
          data-risk-filter-min-score
          aria-label="最低敞口分值"
          value={minScore === null ? 'all' : String(minScore)}
          onChange={(event) =>
            setMinScore(event.target.value === 'all' ? null : Number(event.target.value))
          }
          className={selectClass}
        >
          <option value="all">最低分不限</option>
          {scoreOptions.map((value) => (
            <option key={value} value={value}>
              ≥ {value} 分
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="risk-ops-filter-max-score">
          最高敞口分值
        </label>
        <select
          id="risk-ops-filter-max-score"
          data-risk-filter-max-score
          aria-label="最高敞口分值"
          value={maxScore === null ? 'all' : String(maxScore)}
          onChange={(event) =>
            setMaxScore(event.target.value === 'all' ? null : Number(event.target.value))
          }
          className={selectClass}
        >
          <option value="all">最高分不限</option>
          {scoreOptions.map((value) => (
            <option key={value} value={value}>
              ≤ {value} 分
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="risk-ops-filter-keyword">
          搜索风险关键字
        </label>
        <input
          id="risk-ops-filter-keyword"
          data-risk-filter-keyword
          type="text"
          value={keyword}
          maxLength={255}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索标题 / 描述 / 编号…"
          className="h-7 w-44 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        />
        <Search className="h-3.5 w-3.5 -ml-1.5 text-[var(--nx-text-muted)]" aria-hidden />
        {hasLocalFilter ? (
          <button
            type="button"
            data-risk-filter-reset
            onClick={clearAllFilters}
            className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            <FilterX className="h-3 w-3" aria-hidden />
            重置筛选
          </button>
        ) : null}

        <div className="ml-auto flex items-center gap-1 text-[11px] text-[var(--nx-text-muted)]">
          <button
            type="button"
            data-risk-page-prev
            aria-label="上一页"
            disabled={safePage <= 1 || isLoading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="flex h-6 w-6 items-center justify-center rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span data-risk-page-info className="whitespace-nowrap">
            {safePage} / {totalPages} 页
          </span>
          <button
            type="button"
            data-risk-page-next
            aria-label="下一页"
            disabled={safePage >= totalPages || isLoading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="flex h-6 w-6 items-center justify-center rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {/* 表格主体 */}
      {isLoading && !risks ? (
        <div
          data-risk-register-skeleton
          role="status"
          aria-label="正在加载风险登记底册"
          aria-busy="true"
          className="space-y-1.5"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-11 animate-pulse rounded-sm bg-[var(--nx-bg-1)]"
              aria-hidden
            />
          ))}
        </div>
      ) : isError ? (
        <div
          role="alert"
          aria-label="风险登记底册加载错误"
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-8 text-center"
        >
          <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">
            风险登记底册加载失败，请稍后重试
          </p>
          <button
            type="button"
            data-risk-register-retry
            onClick={() => void refetch()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新载入
          </button>
        </div>
      ) : filteredRows.length === 0 ? (
        <div
          data-risk-register-empty
          className="flex flex-col items-center gap-2.5 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <p className="text-sm text-[var(--nx-text-secondary)]">
            {hasLocalFilter ? '未找到匹配的记录' : '当前项目尚未登记风险'}
          </p>
          {hasLocalFilter ? (
            <button
              type="button"
              data-risk-register-empty-reset
              onClick={clearAllFilters}
              className="h-8 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              清除筛选条件
            </button>
          ) : (
            <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
              在工作台点击「新建风险」登记首条风险，或前往矩阵视图查看分布。
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table
            data-risk-table
            aria-label="风险登记底册"
            className="w-full border-collapse text-left"
          >
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-[var(--nx-border-hairline)]">
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      scope="col"
                      className="whitespace-nowrap px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const risk = row.original
                return (
                  <tr
                    key={risk.id}
                    data-risk-row={risk.id}
                    data-risk-row-tone={riskExposureTone(risk.probability, risk.impact)}
                    className="border-b border-[var(--nx-border-hairline)]/60 align-top transition-colors hover:bg-[var(--nx-bg-1)]/60"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-2 py-2 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 两步确认删除弹窗 */}
      {deletingRisk ? (
        <div data-risk-delete-dialog-overlay className="fixed inset-0 z-50" role="presentation">
          <button
            type="button"
            aria-label="关闭删除确认弹窗"
            tabIndex={-1}
            onClick={() => setDeletingRisk(null)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="确认删除风险"
            data-risk-delete-dialog
            ref={deleteDialogRef}
            tabIndex={-1}
            className="absolute left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
          >
            <header className="border-b border-[var(--nx-border-hairline)] px-5 py-4">
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">确认删除风险</h3>
            </header>
            <div className="px-5 py-4">
              <p className="text-[13px] text-[var(--nx-text-secondary)]">
                「{deletingRisk.title}」将从登记底册中移除，此操作不可撤销。
              </p>
              <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
                {deletingRisk.riskCode ?? `#${deletingRisk.id}`} ·{' '}
                {RISK_STATUS_LABELS[deletingRisk.status] ?? deletingRisk.status}
              </p>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
              <button
                type="button"
                data-risk-delete-cancel
                onClick={() => setDeletingRisk(null)}
                disabled={deleteMutation.isPending}
                className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-risk-delete-confirm
                aria-label={`确认删除 ${deletingRisk.title}`}
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deletingRisk.id)}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.12)] px-4 text-xs font-medium text-[var(--nx-status-danger)] transition-colors hover:bg-[var(--nx-status-danger)] hover:text-white disabled:opacity-50"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                )}
                确认删除
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default RiskOperationalTable
