'use client'

// v3-triz-contradiction-matrix-ui / tasks §6.1–6.5 / design D4
// TRIZ 矛盾矩阵审查 UI——高密度只读审查界面。
//
// 设计要点（advisory-only，禁止自动执行措辞）：
// - 矩阵只呈现确定性映射（参数对 → 候选发明原理），自身不生成 AI 文案、不调用 AIGateway。
// - 所有操作均为审查导向：查看依据 / 加入方案篮子 / 打开审查 / 复制引用。
// - 权限脱敏：无 contradiction:view 时整体空态；hidden 单元格不泄露来源数量。
// - Handoff 仅创建 Workbench 候选元数据或 Draft Layer 审查输入，不写正式业务数据。

import { useCallback, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Alert } from '@/components/ui/Alert'
import { Skeleton } from '@/components/ui/Skeleton'
import { copyTextToClipboard } from '@/lib/clipboard'
import { Separator } from '@/components/ui/Separator'
import { useAuthStore } from '@/stores/auth-store'
import {
  useTrizContradictionMatrix,
  useTrizContradictionMatrixHandoff,
} from '@/hooks/use-triz-contradiction-matrix'
import {
  getInventivePrinciple,
  getParameter,
  computeMatrixHandoffIdempotencyKey,
  computeMatrixCellKey,
  sortMatrixSourceRefs,
  type ContradictionSeverity,
  type InventivePrincipleId,
  type ProjectParameterKey,
  type MatrixAvailableAction,
  type MatrixCell,
  type MatrixCellState,
  type MatrixContradictionTypeFilter,
  type MatrixFilters,
  type MatrixPhysicalTension,
  type MatrixSeverityFilter,
  type MatrixSortField,
  type MatrixSourceRef,
  type MatrixSourceType,
  type MatrixSourceTypeFilter,
  type MatrixStaleFilter,
  type MatrixStatusFilter,
  type MatrixWarningSummary,
  type SortDirection,
  type TrizContradictionMatrix,
} from '@aiproj/types'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Clock,
  Eye,
  FileSearch,
  Inbox,
  Layers,
  Lock,
  Minus,
  RefreshCw,
  ShieldAlert,
  ShoppingBasket,
  TableProperties,
  XCircle,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// 常量与标签映射
// ---------------------------------------------------------------------------

const SEVERITY_LABELS: Record<ContradictionSeverity, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
}

const SEVERITY_VARIANTS: Record<ContradictionSeverity, 'danger' | 'warning' | 'info' | 'neutral'> =
  {
    critical: 'danger',
    high: 'warning',
    medium: 'info',
    low: 'neutral',
  }

const STATUS_FILTER_LABELS: Record<MatrixStatusFilter, string> = {
  all: '全部状态',
  draft: '草稿',
  confirmed: '已确认',
  dismissed: '已驳回',
  superseded: '已替代',
}

const CONTRADICTION_TYPE_LABELS: Record<MatrixContradictionTypeFilter, string> = {
  all: '技术 + 物理',
  technical: '技术矛盾',
  physical: '物理矛盾',
}

const SEVERITY_FILTER_LABELS: Record<MatrixSeverityFilter, string> = {
  all: '全部严重度',
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
}

const STALE_FILTER_LABELS: Record<MatrixStaleFilter, string> = {
  all: '全部时效',
  stale_only: '仅已过期',
  fresh_only: '仅最新',
}

const SOURCE_TYPE_FILTER_LABELS: Record<MatrixSourceTypeFilter, string> = {
  all: '全部来源',
  contradiction: '矛盾记录',
  triz_analysis: 'TRIZ 分析',
  rationale: '决策依据',
  workbench: '方案篮子',
}

const SORT_FIELD_LABELS: Record<MatrixSortField, string> = {
  parameter_key: '参数',
  severity: '严重度',
  confidence: '置信度',
  source_count: '来源数',
  stale: '时效',
}

const SORT_DIRECTION_LABELS: Record<SortDirection, string> = {
  asc: '升序',
  desc: '降序',
}

const SOURCE_TYPE_LABELS: Record<MatrixSourceType, string> = {
  contradiction: '矛盾记录',
  triz_analysis: 'TRIZ 分析',
  rationale: '决策依据',
  workbench: '方案篮子',
}

const SOURCE_TYPE_VARIANTS: Record<MatrixSourceType, 'neutral' | 'primary' | 'info' | 'ai'> = {
  contradiction: 'neutral',
  triz_analysis: 'info',
  rationale: 'primary',
  workbench: 'ai',
}

const CELL_STATE_EMPTY_LABEL: Record<MatrixCellState, string> = {
  has_sources: '',
  empty: '—',
  hidden: '无权限',
  unavailable: '不可用',
  stale: '',
}

const ACTION_LABELS: Record<MatrixAvailableAction, string> = {
  view_rationale: '查看依据',
  add_to_workbench: '加入方案篮子',
  open_draft_review: '打开审查',
  copy_ref: '复制引用',
}

const ACTION_ICONS: Record<MatrixAvailableAction, React.ReactNode> = {
  view_rationale: <FileSearch className="h-3.5 w-3.5" />,
  add_to_workbench: <ShoppingBasket className="h-3.5 w-3.5" />,
  open_draft_review: <Eye className="h-3.5 w-3.5" />,
  copy_ref: <ClipboardCopy className="h-3.5 w-3.5" />,
}

const CELL_SIZE = 64 // 固定单元格尺寸，避免 hover/focus 时布局位移
const HEADER_SIZE = 140 // 行/列头固定宽度/高度

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function parameterName(key: ProjectParameterKey): string {
  return getParameter(key)?.name ?? key
}

function principleName(id: InventivePrincipleId): string {
  return getInventivePrinciple(id)?.name ?? id
}

function severityBadge(severity: ContradictionSeverity | null) {
  if (!severity) return null
  return <Badge variant={SEVERITY_VARIANTS[severity]}>{SEVERITY_LABELS[severity]}</Badge>
}

function confidenceLabel(range: { min: number; max: number } | null): string {
  if (!range) return '—'
  const minPct = Math.round(range.min * 100)
  const maxPct = Math.round(range.max * 100)
  if (minPct === maxPct) return `${minPct}%`
  return `${minPct}%–${maxPct}%`
}

function copyRefToClipboard(text: string): void {
  void copyTextToClipboard(text)
}

// ---------------------------------------------------------------------------
// TrizContradictionMatrixView（主组件）
// ---------------------------------------------------------------------------

export interface TrizContradictionMatrixViewProps {
  projectId: number
}

export function TrizContradictionMatrixView({ projectId }: TrizContradictionMatrixViewProps) {
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const canView = hasPermission('contradiction:view')

  const [filters, setFilters] = useState<MatrixFilters>({})
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null)
  const [selectedTensionKey, setSelectedTensionKey] = useState<string | null>(null)

  const {
    data: matrix,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useTrizContradictionMatrix(projectId, filters)

  // 权限空态：无 contradiction:view 权限
  if (!canView) {
    return (
      <section className="space-y-3">
        <h3 className="text-md font-semibold text-gray-800">TRIZ 矛盾矩阵</h3>
        <Card variant="outlined">
          <CardContent className="py-10 text-center">
            <Ban className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm text-gray-500">当前角色无权查看 TRIZ 矛盾矩阵。</p>
          </CardContent>
        </Card>
      </section>
    )
  }

  if (isLoading) {
    return (
      <section className="space-y-3">
        <h3 className="text-md font-semibold text-gray-800">TRIZ 矛盾矩阵</h3>
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </section>
    )
  }

  if (isError) {
    return (
      <section className="space-y-3">
        <h3 className="text-md font-semibold text-gray-800">TRIZ 矛盾矩阵</h3>
        <Alert variant="danger" title="加载失败">
          {error instanceof Error ? error.message : '无法加载矛盾矩阵数据，请稍后重试。'}
        </Alert>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          重新加载
        </Button>
      </section>
    )
  }

  if (!matrix) {
    return (
      <section className="space-y-3">
        <h3 className="text-md font-semibold text-gray-800">TRIZ 矛盾矩阵</h3>
        <Card variant="outlined">
          <CardContent className="py-10 text-center">
            <TableProperties className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm text-gray-500">暂无矛盾矩阵数据</p>
          </CardContent>
        </Card>
      </section>
    )
  }

  // 空态：矩阵无任何单元格且无物理矛盾
  const isEmpty = matrix.cells.length === 0 && matrix.physicalTensions.length === 0

  return (
    <div className="space-y-4">
      <MatrixHeader matrix={matrix} isFetching={isFetching} onRefresh={() => void refetch()} />

      {/* 全局 warning 摘要 */}
      {matrix.warningSummary.total > 0 && <WarningSummaryAlert summary={matrix.warningSummary} />}

      {/* 筛选与来源范围控制 */}
      <MatrixFilterToolbar filters={filters} onFiltersChange={setFilters} matrix={matrix} />

      {isEmpty ? (
        <Card variant="outlined">
          <CardContent className="py-12 text-center">
            <Inbox className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm text-gray-500">当前筛选条件下无可见矛盾</p>
            <p className="mt-1 text-xs text-gray-400">
              可尝试放宽筛选条件，或确认矛盾已录入并完成分析。
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4">
          {/* 左侧：矩阵网格 + 物理矛盾 */}
          <div className="space-y-4 min-w-0">
            <MatrixGrid
              matrix={matrix}
              selectedCellKey={selectedCellKey}
              onSelectCell={setSelectedCellKey}
            />
            <PhysicalTensionList
              matrix={matrix}
              selectedTensionKey={selectedTensionKey}
              onSelectTension={setSelectedTensionKey}
            />
          </div>

          {/* 右侧：选中详情面板 */}
          <div className="min-w-0">
            <SelectedDetailPanel
              matrix={matrix}
              selectedCellKey={selectedCellKey}
              selectedTensionKey={selectedTensionKey}
              onClearCell={() => setSelectedCellKey(null)}
              onClearTension={() => setSelectedTensionKey(null)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MatrixHeader
// ---------------------------------------------------------------------------

interface MatrixHeaderProps {
  matrix: TrizContradictionMatrix
  isFetching: boolean
  onRefresh: () => void
}

function MatrixHeader({ matrix, isFetching, onRefresh }: MatrixHeaderProps) {
  const visibleCellCount = matrix.cells.filter(
    (c) => c.state === 'has_sources' || c.state === 'stale',
  ).length
  const hiddenCellCount = matrix.cells.filter((c) => c.state === 'hidden').length
  const staleCellCount = matrix.cells.filter((c) => c.state === 'stale').length

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-md font-semibold text-gray-800">TRIZ 矛盾矩阵</h3>
        <Badge variant="neutral">目录 v{matrix.catalog.version}</Badge>
        <Badge variant="neutral">规则集 v{matrix.catalog.rulesetVersion}</Badge>
        {matrix.zeroModelCost && <Badge variant="success">零模型成本</Badge>}
        <span className="text-xs text-gray-400">计算于 {formatDate(matrix.calculatedAt)}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>可见单元 {visibleCellCount}</span>
          {staleCellCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-warning">
              <Clock className="h-3 w-3" />
              过期 {staleCellCount}
            </span>
          )}
          {hiddenCellCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-gray-400">
              <Lock className="h-3 w-3" />
              无权限 {hiddenCellCount}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isFetching}
          loading={isFetching}
        >
          {!isFetching && <RefreshCw className="h-3.5 w-3.5" />}
          刷新
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// WarningSummaryAlert
// ---------------------------------------------------------------------------

function WarningSummaryAlert({ summary }: { summary: MatrixWarningSummary }) {
  return (
    <Alert variant={summary.blocking > 0 ? 'danger' : 'warning'} title="全局警告摘要">
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span>共 {summary.total} 条</span>
        {summary.blocking > 0 && <Badge variant="danger">阻断 {summary.blocking}</Badge>}
        {summary.warning > 0 && <Badge variant="warning">警告 {summary.warning}</Badge>}
        {summary.info > 0 && <Badge variant="info">提示 {summary.info}</Badge>}
      </div>
      {summary.codes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {summary.codes.map((code) => (
            <Badge key={code} variant="outline">
              {code}
            </Badge>
          ))}
        </div>
      )}
    </Alert>
  )
}

// ---------------------------------------------------------------------------
// MatrixFilterToolbar
// ---------------------------------------------------------------------------

interface MatrixFilterToolbarProps {
  filters: MatrixFilters
  onFiltersChange: (filters: MatrixFilters) => void
  matrix: TrizContradictionMatrix
}

function MatrixFilterToolbar({ filters, onFiltersChange, matrix }: MatrixFilterToolbarProps) {
  const update = useCallback(
    (patch: Partial<MatrixFilters>) => {
      onFiltersChange({ ...filters, ...patch })
    },
    [filters, onFiltersChange],
  )

  return (
    <Card variant="outlined">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">筛选与来源范围</CardTitle>
        <CardDescription>
          矩阵仅呈现确定性映射，不自动生成建议；所有操作均为审查导向。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 来源范围（权限 scope）只读展示 */}
        <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
          <span className="font-medium text-gray-600">来源范围：</span>
          <Badge variant={matrix.scope.hasViewPermission ? 'success' : 'neutral'}>
            {matrix.scope.hasViewPermission ? '可查看矛盾' : '无查看权限'}
          </Badge>
          <Badge variant={matrix.scope.canAccessWorkbench ? 'success' : 'neutral'}>
            {matrix.scope.canAccessWorkbench ? '可访问方案篮子' : '方案篮子不可访问'}
          </Badge>
          <Badge variant={matrix.scope.canAccessRationale ? 'success' : 'neutral'}>
            {matrix.scope.canAccessRationale ? '可访问决策依据' : '决策依据不可访问'}
          </Badge>
        </div>

        <Separator />

        {/* 筛选器组 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <FilterSelect
            label="矛盾类型"
            value={filters.contradictionType ?? 'all'}
            options={CONTRADICTION_TYPE_LABELS}
            onChange={(v) => update({ contradictionType: v as MatrixContradictionTypeFilter })}
          />
          <FilterSelect
            label="状态"
            value={filters.status ?? 'all'}
            options={STATUS_FILTER_LABELS}
            onChange={(v) => update({ status: v as MatrixStatusFilter })}
          />
          <FilterSelect
            label="严重度"
            value={filters.severity ?? 'all'}
            options={SEVERITY_FILTER_LABELS}
            onChange={(v) => update({ severity: v as MatrixSeverityFilter })}
          />
          <FilterSelect
            label="时效"
            value={filters.stale ?? 'all'}
            options={STALE_FILTER_LABELS}
            onChange={(v) => update({ stale: v as MatrixStaleFilter })}
          />
          <FilterSelect
            label="来源类型"
            value={filters.sourceType ?? 'all'}
            options={SOURCE_TYPE_FILTER_LABELS}
            onChange={(v) => update({ sourceType: v as MatrixSourceTypeFilter })}
          />
          <FilterSelect
            label="排序字段"
            value={filters.sort ?? 'parameter_key'}
            options={SORT_FIELD_LABELS}
            onChange={(v) => update({ sort: v as MatrixSortField })}
          />
          <FilterSelect
            label="排序方向"
            value={filters.sortDirection ?? 'asc'}
            options={SORT_DIRECTION_LABELS}
            onChange={(v) => update({ sortDirection: v as SortDirection })}
          />
          <div className="flex items-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onFiltersChange({})}
              className="w-full"
            >
              <XCircle className="h-3.5 w-3.5" />
              重置筛选
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// FilterSelect（原生 select 包装，匹配既有克制风格）
// ---------------------------------------------------------------------------

interface FilterSelectProps {
  label: string
  value: string
  options: Record<string, string>
  onChange: (value: string) => void
}

function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-[var(--radius-sm)] border border-border bg-gray-0 px-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[var(--shadow-focus)]"
      >
        {Object.entries(options).map(([val, lbl]) => (
          <option key={val} value={val}>
            {lbl}
          </option>
        ))}
      </select>
    </label>
  )
}

// ---------------------------------------------------------------------------
// MatrixGrid —— 技术矛盾矩阵网格（sticky 行列头 + 固定单元格）
// ---------------------------------------------------------------------------

interface MatrixGridProps {
  matrix: TrizContradictionMatrix
  selectedCellKey: string | null
  onSelectCell: (cellKey: string | null) => void
}

function MatrixGrid({ matrix, selectedCellKey, onSelectCell }: MatrixGridProps) {
  // improving 轴（行）与 worsening 轴（列）
  const { improvingAxis, worseningAxis, cellMap } = useMemo(() => {
    const improving = matrix.catalog.parameters.filter((p) => p.direction === 'improving')
    const worsening = matrix.catalog.parameters.filter((p) => p.direction === 'worsening')
    const map = new Map<string, MatrixCell>()
    for (const cell of matrix.cells) {
      map.set(cell.cellKey, cell)
    }
    return { improvingAxis: improving, worseningAxis: worsening, cellMap: map }
  }, [matrix])

  if (improvingAxis.length === 0 || worseningAxis.length === 0) {
    return (
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-sm">技术矛盾矩阵</CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center">
          <TableProperties className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-500">目录中无可用的参数轴</p>
        </CardContent>
      </Card>
    )
  }

  // 物理矛盾筛选时技术矩阵区域提示
  if (matrix.filters.contradictionType === 'physical') {
    return (
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-sm">技术矛盾矩阵</CardTitle>
          <CardDescription>当前筛选为「物理矛盾」，技术矩阵已收起</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card variant="outlined">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">技术矛盾矩阵</CardTitle>
          <span className="text-xs text-gray-400">
            改善项 {improvingAxis.length} × 恶化项 {worseningAxis.length}
          </span>
        </div>
        <CardDescription>
          行 = 改善参数，列 = 恶化参数；点击单元格查看来源与候选发明原理。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto border border-border rounded-[var(--radius-sm)] max-h-[520px]">
          <div
            className="inline-block"
            style={{ minWidth: HEADER_SIZE + worseningAxis.length * CELL_SIZE }}
          >
            {/* 表头行：左上角 + worsening 列头 */}
            <div className="flex sticky top-0 z-20 bg-gray-50">
              <div
                className="sticky left-0 z-30 bg-gray-50 border-b border-r border-border flex items-end justify-start p-2"
                style={{ width: HEADER_SIZE, height: HEADER_SIZE, minWidth: HEADER_SIZE }}
              >
                <span className="text-[10px] font-medium text-gray-400 leading-tight">
                  改善 \ 恶化
                </span>
              </div>
              {worseningAxis.map((col) => (
                <div
                  key={col.parameterKey}
                  className="border-b border-border flex items-center justify-center p-1 text-center"
                  style={{ width: CELL_SIZE, height: HEADER_SIZE, minWidth: CELL_SIZE }}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[10px] font-medium text-gray-700 leading-tight line-clamp-2">
                      {col.name}
                    </span>
                    {col.visibleSourceCount > 0 && (
                      <span className="text-[9px] text-gray-400">{col.visibleSourceCount}</span>
                    )}
                    {col.hasHiddenSources && <Lock className="h-2.5 w-2.5 text-gray-300" />}
                  </div>
                </div>
              ))}
            </div>

            {/* 数据行：improving 行头 + 单元格 */}
            {improvingAxis.map((row) => (
              <div key={row.parameterKey} className="flex">
                <div
                  className="sticky left-0 z-10 bg-gray-50 border-r border-border flex items-center p-2"
                  style={{ width: HEADER_SIZE, height: CELL_SIZE, minWidth: HEADER_SIZE }}
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[10px] font-medium text-gray-700 leading-tight line-clamp-2">
                      {row.name}
                    </span>
                    <div className="flex items-center gap-1">
                      {row.visibleSourceCount > 0 && (
                        <span className="text-[9px] text-gray-400">{row.visibleSourceCount}</span>
                      )}
                      {row.hasHiddenSources && <Lock className="h-2.5 w-2.5 text-gray-300" />}
                    </div>
                  </div>
                </div>
                {worseningAxis.map((col) => {
                  const cellKey = computeMatrixCellKey({
                    improvingParameterKey: row.parameterKey,
                    worseningParameterKey: col.parameterKey,
                    catalogVersion: matrix.catalog.version,
                  })
                  const cell = cellMap.get(cellKey)
                  return (
                    <MatrixCellView
                      key={cellKey}
                      cell={cell}
                      cellKey={cellKey}
                      isSelected={selectedCellKey === cellKey}
                      onSelect={onSelectCell}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// MatrixCellView —— 单个矩阵单元（固定尺寸，无 hover 布局位移）
// ---------------------------------------------------------------------------

interface MatrixCellViewProps {
  cell: MatrixCell | undefined
  cellKey: string
  isSelected: boolean
  onSelect: (cellKey: string | null) => void
}

function MatrixCellView({ cell, cellKey, isSelected, onSelect }: MatrixCellViewProps) {
  const state: MatrixCellState = cell?.state ?? 'empty'

  const baseCls =
    'flex flex-col items-center justify-center p-1 border-b border-r border-border transition-colors'
  const sizeStyle = { width: CELL_SIZE, height: CELL_SIZE, minWidth: CELL_SIZE }

  // empty：灰显占位
  if (state === 'empty') {
    return (
      <div className={baseCls} style={sizeStyle} aria-label="无已知矛盾">
        <Minus className="h-3 w-3 text-gray-200" />
      </div>
    )
  }

  // hidden：锁定占位，不泄露数量
  if (state === 'hidden') {
    return (
      <div
        className={`${baseCls} bg-gray-50`}
        style={sizeStyle}
        title={CELL_STATE_EMPTY_LABEL.hidden}
        aria-label={CELL_STATE_EMPTY_LABEL.hidden}
      >
        <Lock className="h-3 w-3 text-gray-300" />
      </div>
    )
  }

  // unavailable：不可用占位
  if (state === 'unavailable') {
    return (
      <div
        className={`${baseCls} bg-danger-bg`}
        style={sizeStyle}
        title={CELL_STATE_EMPTY_LABEL.unavailable}
        aria-label={CELL_STATE_EMPTY_LABEL.unavailable}
      >
        <ShieldAlert className="h-3 w-3 text-danger" />
      </div>
    )
  }

  // has_sources / stale：可点击，展示指标
  const isStale = state === 'stale'
  const bgCls = isSelected
    ? 'bg-primary-50 ring-1 ring-primary-300 ring-inset'
    : isStale
      ? 'bg-warning-bg hover:bg-warning-bg/70'
      : 'bg-gray-0 hover:bg-gray-50'

  return (
    <button
      type="button"
      onClick={() => onSelect(isSelected ? null : cellKey)}
      aria-pressed={isSelected}
      aria-label={`改善 ${cell ? parameterName(cell.improvingParameterKey) : ''} 恶化 ${cell ? parameterName(cell.worseningParameterKey) : ''}`}
      className={`${baseCls} ${bgCls} cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-300`}
      style={sizeStyle}
    >
      {/* 来源数 */}
      <span className="text-[11px] font-semibold text-gray-700 leading-none">
        {cell?.totalVisibleSources ?? 0}
      </span>
      {/* 指标行 */}
      <div className="mt-0.5 flex items-center gap-0.5">
        {cell?.severity && (
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              cell.severity === 'critical'
                ? 'bg-danger'
                : cell.severity === 'high'
                  ? 'bg-warning'
                  : cell.severity === 'medium'
                    ? 'bg-info'
                    : 'bg-gray-300'
            }`}
            title={`严重度：${SEVERITY_LABELS[cell.severity]}`}
          />
        )}
        {cell && cell.warningSummary.total > 0 && (
          // Lucide 图标不接受 title，改由外层 span 承载 hover 提示。
          <span title={`警告 ${cell.warningSummary.total} 条`}>
            <AlertTriangle
              className={`h-2.5 w-2.5 ${
                cell.warningSummary.blocking > 0 ? 'text-danger' : 'text-warning'
              }`}
            />
          </span>
        )}
        {isStale && (
          // Lucide 图标不接受 title，改由外层 span 承载 hover 提示。
          <span title="来源已过期">
            <Clock className="h-2.5 w-2.5 text-warning" />
          </span>
        )}
      </div>
      {/* 候选原理数 */}
      {cell && cell.candidatePrincipleIds.length > 0 && (
        <span className="mt-0.5 text-[9px] text-primary-600 leading-none">
          {cell.candidatePrincipleIds.length} 原理
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// PhysicalTensionList —— 物理矛盾列表
// ---------------------------------------------------------------------------

interface PhysicalTensionListProps {
  matrix: TrizContradictionMatrix
  selectedTensionKey: string | null
  onSelectTension: (tensionKey: string | null) => void
}

function PhysicalTensionList({
  matrix,
  selectedTensionKey,
  onSelectTension,
}: PhysicalTensionListProps) {
  // 技术矛盾筛选时物理区域提示
  if (matrix.filters.contradictionType === 'technical') {
    return (
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-sm">物理矛盾</CardTitle>
          <CardDescription>当前筛选为「技术矛盾」，物理矛盾已收起</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (matrix.physicalTensions.length === 0) {
    return (
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-sm">物理矛盾 (0)</CardTitle>
          <CardDescription>无物理矛盾数据</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card variant="outlined">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">物理矛盾 ({matrix.physicalTensions.length})</CardTitle>
          <Layers className="h-4 w-4 text-gray-400" />
        </div>
        <CardDescription>同一参数的对立要求，独立于技术矩阵。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {matrix.physicalTensions.map((tension) => (
          <PhysicalTensionRow
            key={tension.tensionKey}
            tension={tension}
            isSelected={selectedTensionKey === tension.tensionKey}
            onSelect={onSelectTension}
          />
        ))}
      </CardContent>
    </Card>
  )
}

interface PhysicalTensionRowProps {
  tension: MatrixPhysicalTension
  isSelected: boolean
  onSelect: (tensionKey: string | null) => void
}

function PhysicalTensionRow({ tension, isSelected, onSelect }: PhysicalTensionRowProps) {
  const isClickable = tension.state === 'has_sources' || tension.state === 'stale'
  const bgCls = isSelected
    ? 'bg-primary-50 border-primary-300'
    : tension.state === 'stale'
      ? 'bg-warning-bg/50 border-warning'
      : tension.state === 'unavailable'
        ? 'bg-danger-bg/50 border-danger'
        : 'bg-gray-0 border-border'

  return (
    <button
      type="button"
      disabled={!isClickable}
      onClick={() => onSelect(isSelected ? null : tension.tensionKey)}
      aria-pressed={isSelected}
      className={`w-full text-left rounded-[var(--radius-sm)] border ${bgCls} p-3 transition-colors ${
        isClickable
          ? 'hover:bg-gray-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-300'
          : 'cursor-default'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-gray-800 truncate">
            {parameterName(tension.parameterKey)}
          </span>
          {severityBadge(tension.severity)}
          {tension.isStale && (
            <Badge variant="warning">
              <Clock className="h-3 w-3" />
              已过期
            </Badge>
          )}
          {tension.state === 'hidden' && (
            <Badge variant="neutral">
              <Lock className="h-3 w-3" />
              无权限
            </Badge>
          )}
          {tension.state === 'unavailable' && (
            <Badge variant="danger">
              <ShieldAlert className="h-3 w-3" />
              不可用
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isClickable ? (
            isSelected ? (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-400" />
            )
          ) : null}
        </div>
      </div>
      {tension.opposingRequirements && (
        <p className="mt-1 text-xs text-gray-500 line-clamp-2">{tension.opposingRequirements}</p>
      )}
      {tension.confidence !== null && (
        <p className="mt-0.5 text-[10px] text-gray-400">
          置信度 {Math.round(tension.confidence * 100)}%
        </p>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// SelectedDetailPanel —— 选中详情面板（路由到单元格或物理矛盾详情）
// ---------------------------------------------------------------------------

interface SelectedDetailPanelProps {
  matrix: TrizContradictionMatrix
  selectedCellKey: string | null
  selectedTensionKey: string | null
  onClearCell: () => void
  onClearTension: () => void
}

function SelectedDetailPanel({
  matrix,
  selectedCellKey,
  selectedTensionKey,
  onClearCell,
  onClearTension,
}: SelectedDetailPanelProps) {
  const cell = useMemo(
    () => matrix.cells.find((c) => c.cellKey === selectedCellKey) ?? null,
    [matrix.cells, selectedCellKey],
  )
  const tension = useMemo(
    () => matrix.physicalTensions.find((t) => t.tensionKey === selectedTensionKey) ?? null,
    [matrix.physicalTensions, selectedTensionKey],
  )

  if (!cell && !tension) {
    return (
      <Card variant="outlined" className="xl:sticky xl:top-4">
        <CardContent className="py-10 text-center">
          <FileSearch className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-500">点击矩阵单元或物理矛盾查看详情</p>
          <p className="mt-1 text-xs text-gray-400">
            详情包括参数、候选发明原理、来源引用与审查操作。
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="xl:sticky xl:top-4">
      {cell && <SelectedCellDetail cell={cell} matrix={matrix} onClose={onClearCell} />}
      {tension && !cell && (
        <PhysicalTensionDetail tension={tension} matrix={matrix} onClose={onClearTension} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SelectedCellDetail —— 技术矛盾单元格详情
// ---------------------------------------------------------------------------

interface SelectedCellDetailProps {
  cell: MatrixCell
  matrix: TrizContradictionMatrix
  onClose: () => void
}

function SelectedCellDetail({ cell, matrix, onClose }: SelectedCellDetailProps) {
  const sortedRefs = useMemo(() => sortMatrixSourceRefs(cell.sourceRefs), [cell.sourceRefs])

  return (
    <Card variant="outlined">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm">技术矛盾详情</CardTitle>
            <CardDescription>
              改善「{parameterName(cell.improvingParameterKey)}」↔ 恶化「
              {parameterName(cell.worseningParameterKey)}」
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭详情">
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 状态与指标 */}
        <div className="flex items-center gap-2 flex-wrap">
          {severityBadge(cell.severity)}
          {cell.isStale && (
            <Badge variant="warning">
              <Clock className="h-3 w-3" />
              已过期
            </Badge>
          )}
          <Badge variant="neutral">来源 {cell.totalVisibleSources}</Badge>
          {cell.confidenceRange && (
            <Badge variant="outline">置信度 {confidenceLabel(cell.confidenceRange)}</Badge>
          )}
          {cell.hasHiddenSources && (
            <Badge variant="neutral">
              <Lock className="h-3 w-3" />
              含无权限来源
            </Badge>
          )}
        </div>

        {/* 候选发明原理 */}
        {cell.candidatePrincipleIds.length > 0 && (
          <DetailSection title="候选发明原理">
            <div className="flex flex-wrap gap-1">
              {cell.candidatePrincipleIds.map((pid) => (
                <Badge key={pid} variant="primary">
                  {pid} · {principleName(pid)}
                </Badge>
              ))}
            </div>
          </DetailSection>
        )}

        {/* 来源引用 */}
        {sortedRefs.length > 0 && (
          <DetailSection title="来源引用">
            <SourceRefList refs={sortedRefs} />
          </DetailSection>
        )}

        {/* 警告摘要 */}
        {cell.warningSummary.total > 0 && (
          <DetailSection title="警告摘要">
            <WarningSummaryInline summary={cell.warningSummary} />
          </DetailSection>
        )}

        {/* 过期标记说明 */}
        {cell.isStale && (
          <Alert variant="warning" title="来源已过期">
            该单元格的所有来源 hash 均已过期，引用前请确认上游数据是否已更新。
          </Alert>
        )}

        {/* 决策依据入口（rationale） */}
        {matrix.scope.canAccessRationale && cell.availableActions.includes('view_rationale') && (
          <DetailSection title="决策依据">
            <RationaleEntry
              cellKey={cell.cellKey}
              improvingKey={cell.improvingParameterKey}
              worseningKey={cell.worseningParameterKey}
            />
          </DetailSection>
        )}

        {/* 审查操作 */}
        <CellActions cell={cell} matrix={matrix} />
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// PhysicalTensionDetail —— 物理矛盾详情
// ---------------------------------------------------------------------------

interface PhysicalTensionDetailProps {
  tension: MatrixPhysicalTension
  matrix: TrizContradictionMatrix
  onClose: () => void
}

function PhysicalTensionDetail({ tension, matrix, onClose }: PhysicalTensionDetailProps) {
  const sortedRefs = useMemo(() => sortMatrixSourceRefs(tension.sourceRefs), [tension.sourceRefs])

  return (
    <Card variant="outlined">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm">物理矛盾详情</CardTitle>
            <CardDescription>参数「{parameterName(tension.parameterKey)}」</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭详情">
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 状态与指标 */}
        <div className="flex items-center gap-2 flex-wrap">
          {severityBadge(tension.severity)}
          {tension.isStale && (
            <Badge variant="warning">
              <Clock className="h-3 w-3" />
              已过期
            </Badge>
          )}
          <Badge variant="neutral">来源 {tension.sourceRefs.length}</Badge>
          {tension.confidence !== null && (
            <Badge variant="outline">置信度 {Math.round(tension.confidence * 100)}%</Badge>
          )}
        </div>

        {/* 参数引用 */}
        <DetailSection title="参数引用">
          <p className="text-sm text-gray-700">{parameterName(tension.parameterKey)}</p>
          <p className="mt-0.5 text-xs text-gray-400">{tension.parameterKey}</p>
        </DetailSection>

        {/* 对立要求 */}
        {tension.opposingRequirements && (
          <DetailSection title="对立要求">
            <p className="text-sm text-gray-700 leading-relaxed">{tension.opposingRequirements}</p>
          </DetailSection>
        )}

        {/* 候选发明原理 */}
        {tension.candidatePrincipleIds.length > 0 && (
          <DetailSection title="候选发明原理">
            <div className="flex flex-wrap gap-1">
              {tension.candidatePrincipleIds.map((pid) => (
                <Badge key={pid} variant="primary">
                  {pid} · {principleName(pid)}
                </Badge>
              ))}
            </div>
          </DetailSection>
        )}

        {/* 来源引用 */}
        {sortedRefs.length > 0 && (
          <DetailSection title="来源引用">
            <SourceRefList refs={sortedRefs} />
          </DetailSection>
        )}

        {/* 警告摘要 */}
        {tension.warningSummary.total > 0 && (
          <DetailSection title="警告摘要">
            <WarningSummaryInline summary={tension.warningSummary} />
          </DetailSection>
        )}

        {/* 过期标记说明 */}
        {tension.isStale && (
          <Alert variant="warning" title="来源已过期">
            该物理矛盾的所有来源 hash 均已过期，引用前请确认上游数据是否已更新。
          </Alert>
        )}

        {/* 审查操作 */}
        <TensionActions tension={tension} matrix={matrix} />
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// DetailSection —— 详情区段
// ---------------------------------------------------------------------------

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-gray-500">{title}</span>
      <div>{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SourceRefList —— 来源引用列表（低敏）
// ---------------------------------------------------------------------------

function SourceRefList({ refs }: { refs: MatrixSourceRef[] }) {
  return (
    <ul className="space-y-1.5">
      {refs.map((ref, idx) => (
        <li
          key={`${ref.sourceType}-${ref.ref}-${idx}`}
          className="rounded-[var(--radius-sm)] border border-border bg-gray-50 p-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Badge variant={SOURCE_TYPE_VARIANTS[ref.sourceType]}>
                {SOURCE_TYPE_LABELS[ref.sourceType]}
              </Badge>
              <span className="text-xs font-medium text-gray-700 truncate" title={ref.title}>
                {ref.title}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {ref.isAiGenerated && <Badge variant="ai">AI</Badge>}
              {ref.isFallback && <Badge variant="neutral">降级</Badge>}
              {ref.stale && (
                <Badge variant="warning">
                  <Clock className="h-3 w-3" />
                  过期
                </Badge>
              )}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400">
            <span className="font-mono">{ref.ref}</span>
            {ref.hash && <span className="font-mono truncate">#{ref.hash.slice(0, 8)}</span>}
          </div>
          {ref.severity && <div className="mt-0.5">{severityBadge(ref.severity)}</div>}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// WarningSummaryInline —— 内联警告摘要
// ---------------------------------------------------------------------------

function WarningSummaryInline({ summary }: { summary: MatrixWarningSummary }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-600">共 {summary.total} 条</span>
      {summary.blocking > 0 && <Badge variant="danger">阻断 {summary.blocking}</Badge>}
      {summary.warning > 0 && <Badge variant="warning">警告 {summary.warning}</Badge>}
      {summary.info > 0 && <Badge variant="info">提示 {summary.info}</Badge>}
      {summary.codes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {summary.codes.map((code) => (
            <Badge key={code} variant="outline">
              {code}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RationaleEntry —— 决策依据入口（占位提示，引导到 rationale 链路）
// ---------------------------------------------------------------------------

function RationaleEntry({
  cellKey,
  improvingKey,
  worseningKey,
}: {
  cellKey: string
  improvingKey: ProjectParameterKey
  worseningKey: ProjectParameterKey
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-gray-600">
        可查看该参数对的决策依据记录（改善 {parameterName(improvingKey)} ↔ 恶化{' '}
        {parameterName(worseningKey)}）。
      </p>
      <p className="text-[10px] text-gray-400 font-mono break-all">{cellKey}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CellActions —— 单元格审查操作
// ---------------------------------------------------------------------------

interface CellActionsProps {
  cell: MatrixCell
  matrix: TrizContradictionMatrix
}

function CellActions({ cell, matrix }: CellActionsProps) {
  const handoffMutation = useTrizContradictionMatrixHandoff(matrix.projectId)
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const user = useAuthStore((state) => state.user)
  const organizationId = useAuthStore((state) => state.currentOrganizationId)

  const handleCopyRef = useCallback(() => {
    copyRefToClipboard(cell.cellKey)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }, [cell.cellKey])

  const handleAddToWorkbench = useCallback(async () => {
    if (!user || !organizationId) {
      setHandoffError('无法确定当前用户或组织，请重新登录后重试')
      return
    }
    setHandoffError(null)
    const sourceHashes = cell.sourceRefs.map((r) => r.hash).filter((h): h is string => h !== null)
    const input = {
      target: 'workbench' as const,
      organizationId,
      projectId: matrix.projectId,
      actorId: user.id,
      selectedCells: [cell.cellKey],
      selectedTensions: [],
      sourceRefs: cell.sourceRefs,
      sourceHashes,
      selectedParameterKeys: [cell.improvingParameterKey, cell.worseningParameterKey],
      selectedPrincipleIds: cell.candidatePrincipleIds,
      warningSummary: cell.warningSummary,
      idempotencyKey: computeMatrixHandoffIdempotencyKey({
        projectId: matrix.projectId,
        selectedCells: [cell.cellKey],
        selectedTensions: [],
        sourceHashes,
      }),
      note: null,
    }
    try {
      await handoffMutation.mutateAsync(input)
    } catch (e: unknown) {
      setHandoffError(e instanceof Error ? e.message : '加入方案篮子失败')
    }
  }, [cell, handoffMutation, matrix.projectId, organizationId, user])

  const handleOpenDraftReview = useCallback(async () => {
    if (!user || !organizationId) {
      setHandoffError('无法确定当前用户或组织，请重新登录后重试')
      return
    }
    setHandoffError(null)
    const sourceHashes = cell.sourceRefs.map((r) => r.hash).filter((h): h is string => h !== null)
    const input = {
      target: 'draft_review' as const,
      organizationId,
      projectId: matrix.projectId,
      actorId: user.id,
      selectedCells: [cell.cellKey],
      selectedTensions: [],
      sourceRefs: cell.sourceRefs,
      sourceHashes,
      selectedParameterKeys: [cell.improvingParameterKey, cell.worseningParameterKey],
      selectedPrincipleIds: cell.candidatePrincipleIds,
      warningSummary: cell.warningSummary,
      idempotencyKey: computeMatrixHandoffIdempotencyKey({
        projectId: matrix.projectId,
        selectedCells: [cell.cellKey],
        selectedTensions: [],
        sourceHashes,
      }),
      note: null,
    }
    try {
      await handoffMutation.mutateAsync(input)
    } catch (e: unknown) {
      setHandoffError(e instanceof Error ? e.message : '打开审查失败')
    }
  }, [cell, handoffMutation, matrix.projectId, organizationId, user])

  if (cell.availableActions.length === 0) {
    return <p className="text-xs text-gray-400">当前状态无可用的审查操作。</p>
  }

  return (
    <div className="space-y-2 pt-1">
      <Separator />
      <div className="flex flex-wrap gap-2">
        {cell.availableActions.includes('view_rationale') && (
          <Button variant="ghost" size="sm">
            {ACTION_ICONS.view_rationale}
            {ACTION_LABELS.view_rationale}
          </Button>
        )}
        {cell.availableActions.includes('copy_ref') && (
          <Button variant="outline" size="sm" onClick={handleCopyRef}>
            {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : ACTION_ICONS.copy_ref}
            {copied ? '已复制' : ACTION_LABELS.copy_ref}
          </Button>
        )}
        {cell.availableActions.includes('add_to_workbench') && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleAddToWorkbench}
            disabled={handoffMutation.isPending}
            loading={handoffMutation.isPending}
          >
            {!handoffMutation.isPending && ACTION_ICONS.add_to_workbench}
            {ACTION_LABELS.add_to_workbench}
          </Button>
        )}
        {cell.availableActions.includes('open_draft_review') && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleOpenDraftReview}
            disabled={handoffMutation.isPending}
            loading={handoffMutation.isPending}
          >
            {!handoffMutation.isPending && ACTION_ICONS.open_draft_review}
            {ACTION_LABELS.open_draft_review}
          </Button>
        )}
      </div>
      {handoffError && <p className="text-xs text-danger">{handoffError}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TensionActions —— 物理矛盾审查操作
// ---------------------------------------------------------------------------

interface TensionActionsProps {
  tension: MatrixPhysicalTension
  matrix: TrizContradictionMatrix
}

function TensionActions({ tension, matrix }: TensionActionsProps) {
  const handoffMutation = useTrizContradictionMatrixHandoff(matrix.projectId)
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const user = useAuthStore((state) => state.user)
  const organizationId = useAuthStore((state) => state.currentOrganizationId)

  const handleCopyRef = useCallback(() => {
    copyRefToClipboard(tension.tensionKey)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }, [tension.tensionKey])

  const handleAddToWorkbench = useCallback(async () => {
    if (!user || !organizationId) {
      setHandoffError('无法确定当前用户或组织，请重新登录后重试')
      return
    }
    setHandoffError(null)
    const sourceHashes = tension.sourceRefs
      .map((r) => r.hash)
      .filter((h): h is string => h !== null)
    const input = {
      target: 'workbench' as const,
      organizationId,
      projectId: matrix.projectId,
      actorId: user.id,
      selectedCells: [],
      selectedTensions: [tension.tensionKey],
      sourceRefs: tension.sourceRefs,
      sourceHashes,
      selectedParameterKeys: [tension.parameterKey],
      selectedPrincipleIds: tension.candidatePrincipleIds,
      warningSummary: tension.warningSummary,
      idempotencyKey: computeMatrixHandoffIdempotencyKey({
        projectId: matrix.projectId,
        selectedCells: [],
        selectedTensions: [tension.tensionKey],
        sourceHashes,
      }),
      note: null,
    }
    try {
      await handoffMutation.mutateAsync(input)
    } catch (e: unknown) {
      setHandoffError(e instanceof Error ? e.message : '加入方案篮子失败')
    }
  }, [tension, handoffMutation, matrix.projectId, organizationId, user])

  const handleOpenDraftReview = useCallback(async () => {
    if (!user || !organizationId) {
      setHandoffError('无法确定当前用户或组织，请重新登录后重试')
      return
    }
    setHandoffError(null)
    const sourceHashes = tension.sourceRefs
      .map((r) => r.hash)
      .filter((h): h is string => h !== null)
    const input = {
      target: 'draft_review' as const,
      organizationId,
      projectId: matrix.projectId,
      actorId: user.id,
      selectedCells: [],
      selectedTensions: [tension.tensionKey],
      sourceRefs: tension.sourceRefs,
      sourceHashes,
      selectedParameterKeys: [tension.parameterKey],
      selectedPrincipleIds: tension.candidatePrincipleIds,
      warningSummary: tension.warningSummary,
      idempotencyKey: computeMatrixHandoffIdempotencyKey({
        projectId: matrix.projectId,
        selectedCells: [],
        selectedTensions: [tension.tensionKey],
        sourceHashes,
      }),
      note: null,
    }
    try {
      await handoffMutation.mutateAsync(input)
    } catch (e: unknown) {
      setHandoffError(e instanceof Error ? e.message : '打开审查失败')
    }
  }, [tension, handoffMutation, matrix.projectId, organizationId, user])

  if (tension.availableActions.length === 0) {
    return <p className="text-xs text-gray-400">当前状态无可用的审查操作。</p>
  }

  return (
    <div className="space-y-2 pt-1">
      <Separator />
      <div className="flex flex-wrap gap-2">
        {tension.availableActions.includes('view_rationale') && (
          <Button variant="ghost" size="sm">
            {ACTION_ICONS.view_rationale}
            {ACTION_LABELS.view_rationale}
          </Button>
        )}
        {tension.availableActions.includes('copy_ref') && (
          <Button variant="outline" size="sm" onClick={handleCopyRef}>
            {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : ACTION_ICONS.copy_ref}
            {copied ? '已复制' : ACTION_LABELS.copy_ref}
          </Button>
        )}
        {tension.availableActions.includes('add_to_workbench') && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleAddToWorkbench}
            disabled={handoffMutation.isPending}
            loading={handoffMutation.isPending}
          >
            {!handoffMutation.isPending && ACTION_ICONS.add_to_workbench}
            {ACTION_LABELS.add_to_workbench}
          </Button>
        )}
        {tension.availableActions.includes('open_draft_review') && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleOpenDraftReview}
            disabled={handoffMutation.isPending}
            loading={handoffMutation.isPending}
          >
            {!handoffMutation.isPending && ACTION_ICONS.open_draft_review}
            {ACTION_LABELS.open_draft_review}
          </Button>
        )}
      </div>
      {handoffError && <p className="text-xs text-danger">{handoffError}</p>}
    </div>
  )
}
