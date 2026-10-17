'use client'

import { useState, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useResourceContentionSummary,
  useResourceContentionItems,
  useResourceContentionMatrix,
  useResourceContentionDetail,
  useResourceContentionSuggestions,
} from '@/hooks/use-resource-contention-detection'
import { Card, CardContent } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Clock,
  EyeOff,
  Grid3X3,
  Info,
  List,
  ShieldAlert,
  UserX,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  ResourceContentionSeverity,
  ResourceContentionReasonCode,
  ResourceContentionRedactionState,
  ResourceContentionQuery,
} from '@aiproj/types'
import { RESOURCE_CONTENTION_WARNING_CODES } from '@aiproj/types'

// ─── Chinese Labels ──────────────────────────────────────────────────────────

const SEVERITY_LABELS: Record<ResourceContentionSeverity, string> = {
  info: '信息',
  warning: '提示',
  high: '高风险',
  critical: '严重',
}

const SEVERITY_ICONS: Record<
  ResourceContentionSeverity,
  React.ComponentType<{ className?: string }>
> = {
  info: Info,
  warning: AlertTriangle,
  high: AlertCircle,
  critical: ShieldAlert,
}

const SEVERITY_COLORS: Record<ResourceContentionSeverity, string> = {
  info: 'text-blue-600 bg-blue-50 border-blue-200',
  warning: 'text-yellow-700 bg-yellow-50 border-yellow-200',
  high: 'text-orange-700 bg-orange-50 border-orange-200',
  critical: 'text-red-700 bg-red-50 border-red-200',
}

const REASON_LABELS: Record<ResourceContentionReasonCode, string> = {
  'cross-project-overload': '跨项目过载',
  'unavailable-allocation': '不可用分配',
  'critical-skill-contention': '关键技能争用',
  'duplicate-reservation': '重复预留',
  'demand-window-contention': '需求窗口争用',
  'draft-allocation-contention': '调配草案冲突',
}

const REDACTION_LABELS: Record<ResourceContentionRedactionState, string> = {
  visible: '可见',
  redacted: '已脱敏',
  forbidden: '无权限',
  unavailable: '不可用',
  partial: '部分可见',
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ResourceContentionDetectionPage() {
  const searchParams = useSearchParams()
  // 权限来自同步的 auth store，没有加载态可等。
  usePermissions()

  // URL-restorable filters
  const [severity, setSeverity] = useState<ResourceContentionSeverity | ''>(
    (searchParams.get('severity') as ResourceContentionSeverity) || '',
  )
  const [reasonCode, setReasonCode] = useState<ResourceContentionReasonCode | ''>(
    (searchParams.get('reasonCode') as ResourceContentionReasonCode) || '',
  )
  const [viewMode, setViewMode] = useState<'list' | 'matrix'>(
    (searchParams.get('view') as 'list' | 'matrix') || 'matrix',
  )
  const [page, setPage] = useState(Number(searchParams.get('page') || 1))
  const [selectedContentionId, setSelectedContentionId] = useState<string | null>(
    searchParams.get('detail') || null,
  )

  const query: ResourceContentionQuery = useMemo(
    () => ({
      severity: severity || undefined,
      reasonCode: reasonCode || undefined,
      page,
      perPage: 20,
    }),
    [severity, reasonCode, page],
  )

  const summary = useResourceContentionSummary(query)
  const items = useResourceContentionItems(query)
  const matrix = useResourceContentionMatrix(viewMode === 'matrix' ? query : undefined)
  useResourceContentionDetail(selectedContentionId)
  const suggestions = useResourceContentionSuggestions(selectedContentionId, 'rule')

  const isLoading = summary.isLoading || items.isLoading
  const hasError = summary.isError || items.isError

  // ── Loading State ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 p-6" role="status" aria-label="正在加载资源争用数据">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  // ── Error State ────────────────────────────────────────────────────────
  if (hasError) {
    return (
      <div className="p-6">
        <Alert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载资源争用数据失败，请刷新重试。</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => {
            summary.refetch()
            items.refetch()
          }}
        >
          重试
        </Button>
      </div>
    )
  }

  const summaryData = summary.data
  const itemsData = items.data
  const matrixData = matrix.data

  // ── Empty State ────────────────────────────────────────────────────────
  if (summaryData && summaryData.totalContentions === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Zap className="h-16 w-16 text-muted-foreground/40" />
        <EmptyState
          title="暂未检测到资源争用"
          description="当前时间窗口内无跨项目过载、不可用分配或其他资源争用。"
          icon={Zap}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/organization" className="hover:underline">
          组织管理
        </Link>
        <span>/</span>
        <Link href="/organization/resource-pool" className="hover:underline">
          资源池
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">资源争用</span>
      </div>

      <h1 className="text-2xl font-bold" id="page-title">
        资源争用检测
      </h1>

      {/* Severity Summary Cards */}
      {summaryData && (
        <div
          className="grid grid-cols-2 gap-4 sm:grid-cols-4"
          role="region"
          aria-label="争用严重度摘要"
        >
          {(
            Object.entries(summaryData.severityCounts) as [ResourceContentionSeverity, number][]
          ).map(([sev, count]) => {
            const Icon = SEVERITY_ICONS[sev] ?? AlertTriangle
            return (
              <Card
                key={sev}
                className={cn('border', SEVERITY_COLORS[sev])}
                role="status"
                aria-label={`${SEVERITY_LABELS[sev]}: ${count} 项`}
              >
                <CardContent className="flex items-center gap-3 p-4">
                  <Icon className="h-8 w-8" aria-hidden="true" />
                  <div>
                    <div className="text-lg font-bold">{count}</div>
                    <div className="text-sm">{SEVERITY_LABELS[sev]}</div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3" role="toolbar" aria-label="争用筛选器">
        {/* Severity Filter */}
        <select
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value as ResourceContentionSeverity | '')
            setPage(1)
          }}
          className="rounded border px-3 py-1.5 text-sm"
          aria-label="按严重度筛选"
        >
          <option value="">全部严重度</option>
          {Object.entries(SEVERITY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        {/* Reason Filter */}
        <select
          value={reasonCode}
          onChange={(e) => {
            setReasonCode(e.target.value as ResourceContentionReasonCode | '')
            setPage(1)
          }}
          className="rounded border px-3 py-1.5 text-sm"
          aria-label="按原因筛选"
        >
          <option value="">全部原因</option>
          {Object.entries(REASON_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        {/* View Toggle */}
        <div className="flex rounded border" role="radiogroup" aria-label="视图切换">
          <button
            onClick={() => setViewMode('matrix')}
            className={cn(
              'flex items-center gap-1 px-3 py-1.5 text-sm',
              viewMode === 'matrix' && 'bg-primary text-primary-foreground',
            )}
            role="radio"
            aria-checked={viewMode === 'matrix'}
            aria-label="矩阵视图"
          >
            <Grid3X3 className="h-4 w-4" aria-hidden="true" />
            矩阵
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'flex items-center gap-1 px-3 py-1.5 text-sm',
              viewMode === 'list' && 'bg-primary text-primary-foreground',
            )}
            role="radio"
            aria-checked={viewMode === 'list'}
            aria-label="列表视图"
          >
            <List className="h-4 w-4" aria-hidden="true" />
            列表
          </button>
        </div>
      </div>

      {/* Warnings */}
      {summaryData?.warnings && summaryData.warnings.length > 0 && (
        <div className="space-y-1">
          {summaryData.warnings.map((w, i) => (
            <Alert key={i} variant="warning" className="text-sm">
              <AlertDescription>{w.message}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Matrix View */}
      {viewMode === 'matrix' && matrixData && (
        <div className="overflow-x-auto rounded border" role="grid" aria-label="资源争用矩阵">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted">
                <th className="sticky left-0 bg-muted p-2 text-left" scope="col">
                  资源
                </th>
                <th className="p-2 text-center" scope="col">
                  争用数
                </th>
                <th className="p-2 text-center" scope="col">
                  最高严重度
                </th>
              </tr>
            </thead>
            <tbody>
              {matrixData.rows.map((row) => (
                <tr
                  key={row.resourceId}
                  className="border-t hover:bg-muted/50 cursor-pointer"
                  onClick={() => {
                    // Open first cell drill-down content
                    const cell = row.cells.find((c) => c.severity)
                    if (cell) setSelectedContentionId(String(row.resourceId))
                  }}
                  tabIndex={0}
                  role="row"
                  aria-label={`资源: ${row.resourceName ?? '已脱敏'}, 争用数: ${row.totalContentions}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ')
                      setSelectedContentionId(String(row.resourceId))
                  }}
                >
                  <td className="sticky left-0 bg-background p-2 font-medium">
                    {row.resourceName ?? (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <EyeOff className="h-3 w-3" aria-hidden="true" />
                        已脱敏
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-center">{row.totalContentions}</td>
                  <td className="p-2 text-center">
                    {row.maxSeverity ? (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border',
                          SEVERITY_COLORS[row.maxSeverity],
                        )}
                      >
                        {SEVERITY_LABELS[row.maxSeverity]}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && itemsData && (
        <div className="space-y-3" role="list" aria-label="争用列表">
          {itemsData.data.length === 0 ? (
            <EmptyState
              title="当前筛选条件下无争用记录"
              description="调整筛选条件或扩大日期窗口后重试。"
            />
          ) : (
            itemsData.data.map((item) => (
              <Card
                key={item.contentionId}
                className={cn(
                  'cursor-pointer border transition-colors hover:bg-muted/50',
                  selectedContentionId === item.contentionId && 'ring-2 ring-primary',
                )}
                onClick={() =>
                  setSelectedContentionId(
                    selectedContentionId === item.contentionId ? null : item.contentionId,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setSelectedContentionId(
                      selectedContentionId === item.contentionId ? null : item.contentionId,
                    )
                  }
                }}
                tabIndex={0}
                role="listitem"
                aria-label={`争用: ${item.reasonCode}, 严重度: ${SEVERITY_LABELS[item.severity]}`}
              >
                <CardContent className="flex items-start gap-4 p-4">
                  {/* Severity Badge */}
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border',
                      SEVERITY_COLORS[item.severity],
                    )}
                  >
                    {(() => {
                      const Icon = SEVERITY_ICONS[item.severity] ?? AlertTriangle
                      return <Icon className="h-3 w-3" aria-hidden="true" />
                    })()}
                    {SEVERITY_LABELS[item.severity]}
                  </span>

                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {REASON_LABELS[item.reasonCode] ?? item.reasonCode}
                      </span>
                      {item.redactionState !== 'visible' && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <EyeOff className="h-3 w-3" aria-hidden="true" />
                          {REDACTION_LABELS[item.redactionState]}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>资源: {item.resourceName ?? '已脱敏'}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {item.from} ~ {item.to}
                      </span>
                      {item.loadPercent !== null && <span>负载: {item.loadPercent}%</span>}
                    </div>
                  </div>
                </CardContent>

                {/* Detail Panel */}
                {selectedContentionId === item.contentionId && (
                  <div className="border-t p-4 space-y-3 bg-muted/20">
                    <h3 className="text-sm font-semibold" id="detail-title">
                      处置建议
                    </h3>
                    {item.remediationHint && (
                      <p className="text-sm text-muted-foreground">{item.remediationHint}</p>
                    )}

                    {/* Suggestions */}
                    {suggestions.data && suggestions.data.length > 0 && (
                      <div className="space-y-1" role="list" aria-label="建议动作">
                        <p className="text-xs text-muted-foreground font-medium">
                          建议动作（仅供参考，不自动执行）：
                        </p>
                        {suggestions.data[0]!.candidateActions.map((action, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm" role="listitem">
                            <span className="text-xs text-muted-foreground">
                              {(i + 1).toString().padStart(2, '0')}
                            </span>
                            <span>{action}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Advisory Note */}
                    <Alert variant="info" className="text-xs">
                      <Info className="h-3 w-3" />
                      <AlertDescription>
                        以上建议仅供审查，不会自动修改分配、任务负责人、任务日期或工作日历。
                      </AlertDescription>
                    </Alert>
                  </div>
                )}
              </Card>
            ))
          )}

          {/* Pagination */}
          {(itemsData.meta.totalPages ?? 0) > 1 && (
            <div
              className="flex items-center justify-center gap-4 pt-4"
              role="navigation"
              aria-label="分页"
            >
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="上一页"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                上一页
              </Button>
              <span className="text-sm text-muted-foreground" aria-live="polite">
                第 {itemsData.meta.page} / {itemsData.meta.totalPages} 页（共 {itemsData.meta.total}{' '}
                项）
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= (itemsData.meta.totalPages ?? 1)}
                onClick={() => setPage((p) => p + 1)}
                aria-label="下一页"
              >
                下一页
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Freshness + Redaction Info */}
      {summaryData?.sourceFreshness && (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {summaryData.sourceFreshness
            .filter((f) => f.isStale)
            .map((f) => (
              <span
                key={f.source}
                className="flex items-center gap-1 rounded bg-yellow-50 px-2 py-1 text-yellow-700"
              >
                <Clock className="h-3 w-3" aria-hidden="true" />
                数据来源 &quot;{f.source}&quot; 可能过期
              </span>
            ))}
          {summaryData.warnings
            .filter((w) => w.code === RESOURCE_CONTENTION_WARNING_CODES.PERMISSION_REDACTED)
            .map((w) => (
              <span
                key={w.code}
                className="flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-gray-600"
              >
                <UserX className="h-3 w-3" aria-hidden="true" />
                {w.message}
              </span>
            ))}
        </div>
      )}
    </div>
  )
}
