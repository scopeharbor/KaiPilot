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
  Check,
  ChevronLeft,
  ChevronRight,
  FilterX,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {
  deleteRisk,
  listRisks,
  transitionRiskStatus,
  updateRisk,
  type Risk,
  type RiskCategory,
  type RiskListResponse,
  type RiskStatus,
} from '@/lib/api/risks'
import { useAuthStore } from '@/stores/auth-store'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'
import {
  RISK_CATEGORY_LABELS,
  RISK_LEVEL_SHORT_LABELS,
  RISK_SCALE_LABELS,
  RISK_SCALE_OPTIONS,
  RISK_STATUS_LABELS,
  RISK_TONE_LABELS,
  nextRiskStatuses,
  riskExposureTone,
  type RiskCellRef,
  type RiskTone,
} from './risk-meta'
import { invalidateRiskChartData } from './risk-invalidation'

/**
 * 结构化风险登记底册（v3-ui-next-chart-gallery tasks 4.2）。
 *
 * - 数据：既有端点 GET /projects/:projectId/risks（分页遍历拉全量底册，
 *   客户端收敛过滤与分页——矩阵单元格按概率×影响的联动过滤无服务端参数，
 *   必须持全量底册做确定性本地筛选）；
 * - 过滤：按分类 / 状态 / 严重度色带三组受控筛选 + 矩阵单元格联动过滤胶囊；
 * - 受控编辑：状态机推进（transitionRiskStatus）、行内编辑概率/影响/缓解措施
 *   （updateRisk）、两步确认删除（deleteRisk）——全部走既有 risks 端点，
 *   成功即统一失效风险列表与矩阵计数缓存（RL-04/RL-06）；
 * - 权限：risk:manage 全量编辑；risk:update_own 仅可编辑本人负责行的非状态字段；
 *   其余一律只读隐藏编辑入口（W5 RBAC 断言：编辑控件物理隐藏而非报错）；
 * - 三态齐全：加载骨架 / 语义空态 / 错误卡 + 重试；展示层零动态注入（RL-14）。
 */

const PAGE_SIZE = 10

/** 分页遍历拉取项目风险全量底册（perPage 服务端上限 100）。 */
async function fetchAllRisks(projectId: number): Promise<Risk[]> {
  const pageSize = 100
  const all: Risk[] = []
  let page = 1
  for (;;) {
    const res: RiskListResponse = await listRisks(projectId, { page, perPage: pageSize })
    all.push(...(res.data ?? []))
    const totalPages = res.meta?.totalPages ?? 1
    if (page >= totalPages || totalPages <= 0) break
    page += 1
  }
  return all
}

export const riskRegisterLensKey = (projectId: number) =>
  ['risks', 'lens-register', projectId] as const

interface RiskRegisterTableProps {
  projectId: number
  /** 矩阵单元格联动过滤（概率 × 影响）；null = 无单元格筛选 */
  cellFilter: RiskCellRef | null
  /** 清除矩阵单元格筛选（同时复位本地过滤条件由组件自持） */
  onClearCellFilter: () => void
  /** 提供「新建风险」回调时展示入口（受控编辑权限在组件内二次判定） */
  onCreateRiskRequest?: () => void
}

const TONE_TEXT: Record<RiskTone, string> = {
  low: 'text-[var(--nx-status-success)]',
  medium: 'text-[var(--nx-status-warning)]',
  high: 'text-[var(--nx-status-danger)]',
}

export function RiskRegisterTable({
  projectId,
  cellFilter,
  onClearCellFilter,
  onCreateRiskRequest,
}: RiskRegisterTableProps) {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)
  const canManage = can('risk:manage')
  const canUpdateOwn = can('risk:update_own')

  // ---------------- 数据 ----------------
  const {
    data: risks,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: riskRegisterLensKey(projectId),
    queryFn: () => fetchAllRisks(projectId),
    enabled: projectId > 0,
  })

  // ---------------- 本地筛选态 ----------------
  const [categoryFilter, setCategoryFilter] = React.useState<RiskCategory | 'all'>('all')
  const [statusFilter, setStatusFilter] = React.useState<RiskStatus | 'all'>('all')
  const [toneFilter, setToneFilter] = React.useState<RiskTone | 'all'>('all')
  const [page, setPage] = React.useState(1)

  const hasLocalFilter =
    categoryFilter !== 'all' ||
    statusFilter !== 'all' ||
    toneFilter !== 'all' ||
    cellFilter !== null

  React.useEffect(() => {
    setPage(1)
  }, [categoryFilter, statusFilter, toneFilter, cellFilter])

  // ---------------- 受控编辑 ----------------
  const [editingId, setEditingId] = React.useState<number | null>(null)
  const [deletingId, setDeletingId] = React.useState<number | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const invalidateAfterWrite = React.useCallback(
    (error?: unknown) => {
      if (error) {
        setActionError(error instanceof Error ? error.message : '风险操作失败，请重试')
        return
      }
      setActionError(null)
      setEditingId(null)
      setDeletingId(null)
      return invalidateRiskChartData(queryClient)
    },
    [queryClient],
  )

  const updateMutation = useMutation({
    mutationFn: ({
      riskId,
      patch,
    }: {
      riskId: number
      patch: Partial<Pick<Risk, 'probability' | 'impact' | 'mitigationStrategy'>>
    }) => updateRisk(projectId, riskId, patch),
    onSuccess: () => void invalidateAfterWrite(),
    onError: (error) => invalidateAfterWrite(error),
  })

  const deleteMutation = useMutation({
    mutationFn: (riskId: number) => deleteRisk(projectId, riskId),
    onSuccess: () => void invalidateAfterWrite(),
    onError: (error) => invalidateAfterWrite(error),
  })

  const transitionMutation = useMutation({
    mutationFn: ({ riskId, status }: { riskId: number; status: RiskStatus }) =>
      transitionRiskStatus(projectId, riskId, status),
    onSuccess: () => void invalidateAfterWrite(),
    onError: (error) => invalidateAfterWrite(error),
  })

  const anyWritePending =
    updateMutation.isPending || deleteMutation.isPending || transitionMutation.isPending
  const updateBusy = (riskId: number) =>
    updateMutation.isPending && updateMutation.variables?.riskId === riskId
  const deleteBusy = (riskId: number) =>
    deleteMutation.isPending && deleteMutation.variables === riskId
  const transitionBusy = (riskId: number) =>
    transitionMutation.isPending && transitionMutation.variables?.riskId === riskId

  // ---------------- 行权限 ----------------
  /** risk:update_own 本人负责行（无 risk:manage 时） */
  const canEditRow = (risk: Risk) =>
    canManage || (canUpdateOwn && risk.ownerId !== null && risk.ownerId === currentUserId)

  // ---------------- 派生视图 ----------------
  const allRisks = risks ?? []
  const filteredRows = React.useMemo(() => {
    return allRisks.filter((risk) => {
      if (
        cellFilter &&
        (risk.probability !== cellFilter.probability || risk.impact !== cellFilter.impact)
      ) {
        return false
      }
      if (categoryFilter !== 'all' && risk.category !== categoryFilter) return false
      if (statusFilter !== 'all' && risk.status !== statusFilter) return false
      if (toneFilter !== 'all' && riskExposureTone(risk.probability, risk.impact) !== toneFilter)
        return false
      return true
    })
  }, [allRisks, cellFilter, categoryFilter, statusFilter, toneFilter])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const hasCellFilter = cellFilter !== null
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
        cell: ({ row }) => {
          const code = row.original.riskCode
          return (
            <span data-risk-cell-code className="font-mono text-[11px] text-[var(--nx-text-muted)]">
              {code ?? '—'}
            </span>
          )
        },
      },
      {
        accessorKey: 'title',
        header: '标题',
        cell: ({ row }) => {
          const risk = row.original
          return (
            <div className="max-w-56">
              <p className="truncate text-[13px] font-medium text-[var(--nx-text-primary)]">
                {risk.title}
              </p>
              {risk.description ? (
                <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
                  {risk.description}
                </p>
              ) : null}
            </div>
          )
        },
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
          const { probability, impact, score } = row.original
          const scoreValue = Number(score)
          return (
            <span
              aria-label={`敞口得分 ${scoreValue}，${RISK_TONE_LABELS[riskExposureTone(probability, impact)]}`}
              className={cn(
                'font-mono text-xs font-semibold',
                TONE_TEXT[riskExposureTone(probability, impact)],
              )}
            >
              {Number.isFinite(scoreValue) ? scoreValue : '—'}
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
          const canTransition = canManage
          const allowed = nextRiskStatuses(status)
          const busy = transitionBusy(risk.id) || anyWritePending
          if (!canTransition || allowed.length === 0) {
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
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value as RiskStatus
                if (next !== status) transitionMutation.mutate({ riskId: risk.id, status: next })
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
        accessorKey: 'mitigationStrategy',
        header: '缓解措施',
        cell: ({ row }) => {
          const risk = row.original
          const strategy = risk.mitigationStrategy
          return (
            <div
              data-risk-cell-mitigation
              className="max-w-60 whitespace-pre-wrap text-[11px] leading-snug text-[var(--nx-text-secondary)]"
            >
              {strategy ? strategy : <span className="text-[var(--nx-text-muted)]">未填写</span>}
            </div>
          )
        },
      },
      {
        id: 'actions',
        header: '操作',
        cell: ({ row }) => {
          const risk = row.original
          const editable = canEditRow(risk)
          const deletable = canManage
          if (!editable && !deletable) {
            return (
              <span data-risk-cell-actions className="text-[10px] text-[var(--nx-text-muted)]">
                只读
              </span>
            )
          }
          if (deletingId === risk.id) {
            return (
              <div
                data-risk-delete-confirm
                className="flex items-center gap-1.5"
                role="group"
                aria-label={`确认删除 ${risk.title}`}
              >
                <button
                  type="button"
                  data-risk-delete-confirm-ok
                  aria-label={`确认删除 ${risk.title}`}
                  disabled={deleteBusy(risk.id)}
                  onClick={() => deleteMutation.mutate(risk.id)}
                  className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-status-danger)] px-2 text-[11px] text-[var(--nx-status-danger)] transition-colors hover:bg-[var(--nx-status-danger)] hover:text-white disabled:opacity-50"
                >
                  {deleteBusy(risk.id) ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : (
                    <Check className="h-3 w-3" aria-hidden />
                  )}
                  确认删除
                </button>
                <button
                  type="button"
                  aria-label={`取消删除 ${risk.title}`}
                  disabled={deleteBusy(risk.id)}
                  onClick={() => setDeletingId(null)}
                  className="flex h-7 items-center rounded-sm border border-[var(--nx-border-hairline)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
                >
                  取消
                </button>
              </div>
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
                    setEditingId(editingId === risk.id ? null : risk.id)
                    setDeletingId(null)
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
                    setDeletingId(risk.id)
                    setEditingId(null)
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
      canManage,
      canEditRow,
      canUpdateOwn,
      currentUserId,
      anyWritePending,
      deletingId,
      editingId,
      updateBusy,
      deleteBusy,
      transitionBusy,
    ],
  )

  const table = useLegacyTable({
    data: pageRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  })

  const showNewButton = canManage && typeof onCreateRiskRequest === 'function'

  const clearAllFilters = () => {
    setCategoryFilter('all')
    setStatusFilter('all')
    setToneFilter('all')
    onClearCellFilter()
  }

  const selectClass =
    'h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none'

  return (
    <section
      data-risk-register
      aria-busy={isLoading || isFetching}
      className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      {/* 区块标题 + 新建入口 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
            结构化风险登记底册
          </h3>
          <span
            data-risk-register-total
            className="font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            共 {allRisks.length} 条
          </span>
        </div>
        {showNewButton ? (
          <button
            type="button"
            data-risk-create-open
            onClick={onCreateRiskRequest}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            新建风险
          </button>
        ) : null}
      </div>

      {/* 单元格联动过滤胶囊 */}
      {hasCellFilter && cellFilter ? (
        <div
          data-risk-cell-filter-chip
          className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 py-1.5"
        >
          <p className="text-[11px] text-[var(--nx-text-secondary)]">
            <span className="text-[var(--nx-accent)]">矩阵单元格筛选</span>
            ：概率 {cellFilter.probability}（{RISK_SCALE_LABELS[cellFilter.probability - 1]}）× 影响{' '}
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

      {/* 过滤工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="risk-filter-category">
          按分类筛选风险
        </label>
        <select
          id="risk-filter-category"
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
        <label className="sr-only" htmlFor="risk-filter-status">
          按状态筛选风险
        </label>
        <select
          id="risk-filter-status"
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
        <label className="sr-only" htmlFor="risk-filter-tone">
          按严重度筛选风险
        </label>
        <select
          id="risk-filter-tone"
          data-risk-filter-tone
          aria-label="按严重度筛选风险"
          value={toneFilter}
          onChange={(event) => setToneFilter(event.target.value as RiskTone | 'all')}
          className={selectClass}
        >
          <option value="all">全部等级</option>
          <option value="high">{RISK_TONE_LABELS.high}</option>
          <option value="medium">{RISK_TONE_LABELS.medium}</option>
          <option value="low">{RISK_TONE_LABELS.low}</option>
        </select>

        {hasLocalFilter && !hasCellFilter ? (
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

      {/* 行内写操作错误提示 */}
      {actionError ? (
        <p
          role="alert"
          aria-label="风险操作失败"
          data-risk-action-error
          className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
        >
          {actionError}
        </p>
      ) : null}

      {/* 表格主体 */}
      {isLoading && !risks ? (
        <div data-risk-register-skeleton aria-label="登记底册加载中" className="space-y-1.5">
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
          <p className="text-sm text-[var(--nx-text-secondary)]">
            风险登记底册加载失败，请稍后重试
          </p>
          <button
            type="button"
            data-risk-register-retry
            onClick={() => void refetch()}
            className="h-8 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            重新加载
          </button>
        </div>
      ) : filteredRows.length === 0 ? (
        <div
          data-risk-register-empty
          className="flex flex-col items-center gap-2.5 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <p className="text-sm text-[var(--nx-text-secondary)]">
            {hasLocalFilter || hasCellFilter
              ? '没有符合筛选条件的风险记录'
              : '当前项目尚未登记风险'}
          </p>
          {hasLocalFilter || hasCellFilter ? (
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
              点击「新建风险」登记首条风险，或前往项目风险管理工作面录入后返回本镜头查看矩阵分布。
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
                const editorBusy = updateBusy(risk.id)
                return (
                  <React.Fragment key={risk.id}>
                    <tr
                      data-risk-row={risk.id}
                      data-risk-row-tone={riskExposureTone(risk.probability, risk.impact)}
                      data-risk-row-deleting={deletingId === risk.id || undefined}
                      className={cn(
                        'border-b border-[var(--nx-border-hairline)]/60 align-top transition-colors hover:bg-[var(--nx-bg-1)]/60',
                        deletingId === risk.id && 'bg-[rgba(239,68,68,0.06)]',
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-2 py-2 align-middle">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                    {editingId === risk.id ? (
                      <tr data-risk-inline-editor-row>
                        <td colSpan={row.getVisibleCells().length} className="px-2 pb-3">
                          <RiskInlineEditor
                            risk={risk}
                            busy={editorBusy}
                            onCancel={() => setEditingId(null)}
                            onSave={(patch) => updateMutation.mutate({ riskId: risk.id, patch })}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export interface RiskInlinePatch {
  probability: number
  impact: number
  mitigationStrategy: string | null
}

interface RiskInlineEditorProps {
  risk: Risk
  busy: boolean
  onCancel: () => void
  onSave: (patch: RiskInlinePatch) => void
}

/** 行内受控编辑面板：概率 / 影响度调整 + 缓解措施（PATCH /risks/:id）。 */
function RiskInlineEditor({ risk, busy, onCancel, onSave }: RiskInlineEditorProps) {
  const [probability, setProbability] = React.useState(risk.probability)
  const [impact, setImpact] = React.useState(risk.impact)
  const [strategy, setStrategy] = React.useState(risk.mitigationStrategy ?? '')
  const [localError, setLocalError] = React.useState<string | null>(null)

  const scaleOptions = RISK_SCALE_OPTIONS

  return (
    <div
      data-risk-inline-editor
      aria-label={`编辑风险：${risk.title}`}
      className="flex flex-col gap-2.5 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] p-3"
    >
      <p className="text-[11px] font-medium text-[var(--nx-text-secondary)]">
        行内编辑 · {risk.title}
        <span className="ml-2 text-[var(--nx-text-muted)]">
          概率/影响调整后风险等级与矩阵计数将同步刷新
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-secondary)]">
          发生概率
          <select
            data-risk-edit-probability
            aria-label="发生概率等级"
            value={probability}
            disabled={busy}
            onChange={(event) => setProbability(Number(event.target.value))}
            className="h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          >
            {scaleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-secondary)]">
          影响度
          <select
            data-risk-edit-impact
            aria-label="影响度等级"
            value={impact}
            disabled={busy}
            onChange={(event) => setImpact(Number(event.target.value))}
            className="h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          >
            {scaleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-[11px] text-[var(--nx-text-secondary)]">
          缓解措施
          <textarea
            data-risk-edit-mitigation
            aria-label="缓解措施"
            rows={2}
            disabled={busy}
            value={strategy}
            onChange={(event) => setStrategy(event.target.value)}
            placeholder="填写缓解与应对措施（可留空）"
            className="resize-y rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5 text-[11px] leading-relaxed text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-50"
          />
        </label>
      </div>
      {localError ? (
        <p role="alert" className="text-[11px] text-[var(--nx-status-danger)]">
          {localError}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          data-risk-edit-cancel
          onClick={() => {
            setLocalError(null)
            onCancel()
          }}
          className="h-7 rounded-sm border border-[var(--nx-border-hairline)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)]"
        >
          取消
        </button>
        <button
          type="button"
          data-risk-edit-save
          disabled={busy}
          onClick={() => {
            if (
              !Number.isInteger(probability) ||
              probability < 1 ||
              probability > 5 ||
              !Number.isInteger(impact) ||
              impact < 1 ||
              impact > 5
            ) {
              setLocalError('概率与影响度必须是 1-5 的整数等级')
              return
            }
            setLocalError(null)
            onSave({
              probability,
              impact,
              mitigationStrategy: strategy.trim() === '' ? null : strategy.trim(),
            })
          }}
          className="flex h-7 items-center gap-1.5 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Check className="h-3 w-3" aria-hidden />
          )}
          保存修改
        </button>
      </div>
    </div>
  )
}

export default RiskRegisterTable
