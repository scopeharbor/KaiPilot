'use client'

import { useState, useCallback } from 'react'
import {
  usePmoRecommendationList,
  usePmoRecommendationSummary,
  usePmoRecommendationDetail,
  useRefreshPmoRecommendations,
} from '@/hooks/use-pmo-ai-priority-recommendations'
import { usePermissions } from '@/hooks/use-permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/Sheet'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  Eye,
  Sparkles,
  XCircle,
  ChevronRight,
  BarChart3,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PmoRecommendationQueueItem, PmoRecommendationListQuery } from '@aiproj/types'
import { RECOMMENDATION_STATUS_LABELS } from '@aiproj/types'

// ─── 状态标签常量 ──────────────────────────────────────────────────────────────

const SEVERITY_BADGE = {
  critical: { color: 'bg-red-100 text-red-700 border-red-200', icon: AlertCircle },
  high: { color: 'bg-orange-100 text-orange-700 border-orange-200', icon: AlertTriangle },
  medium: { color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: Clock },
  low: { color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Eye },
  info: { color: 'bg-gray-100 text-gray-600 border-gray-200', icon: BarChart3 },
}

const STATUS_BADGE: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700 border-blue-200',
  reviewing: 'bg-purple-100 text-purple-700 border-purple-200',
  accepted: 'bg-green-100 text-green-700 border-green-200',
  dismissed: 'bg-gray-100 text-gray-500 border-gray-200',
  snoozed: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  converted: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  expired: 'bg-gray-50 text-gray-400 border-gray-100',
}

const AI_STATUS_BADGE = {
  none: { label: '无 AI', color: 'bg-gray-100 text-gray-500' },
  generating: { label: '生成中...', color: 'bg-blue-100 text-blue-600' },
  available: { label: 'AI 理由可用', color: 'bg-green-100 text-green-700' },
  stale: { label: 'AI 过期', color: 'bg-yellow-100 text-yellow-700' },
  failed: { label: 'AI 失败', color: 'bg-red-100 text-red-700' },
  unavailable: { label: 'AI 不可用', color: 'bg-gray-100 text-gray-400' },
}

// ─── Page Component ────────────────────────────────────────────────────────────

export default function PmoAiPriorityRecommendationsPage() {
  const { canAny } = usePermissions()
  const hasAccess = canAny(['portfolio:view'])

  const [filters, setFilters] = useState<PmoRecommendationListQuery>({})
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data, isLoading, error } = usePmoRecommendationList(filters)
  const { data: summaryData } = usePmoRecommendationSummary()
  const refreshMutation = useRefreshPmoRecommendations()

  const handleRefresh = useCallback(() => {
    refreshMutation.mutate()
  }, [refreshMutation])

  // ─── 权限不足 ──────────────────────────────────────────────────────────────

  if (!hasAccess) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>您没有 PMO 组合管理的访问权限。请联系管理员。</AlertDescription>
        </Alert>
      </div>
    )
  }

  // ─── 加载态 ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return <PmoRecommendationsSkeleton />
  }

  // ─── 错误态 ────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        <Alert variant="danger" className="max-w-md">
          <XCircle className="h-4 w-4" />
          <AlertDescription>加载推荐数据失败，请稍后重试。</AlertDescription>
        </Alert>
      </div>
    )
  }

  const items = data?.data ?? []
  const meta = data?.meta
  const summary = data?.summary ?? summaryData

  return (
    <div className="space-y-6 p-6">
      {/* ─── 页头 + 摘要 KPI ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">PMO AI 优先级推荐</h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI 辅助优先级关注队列——基于确定性评分的推荐草案，所有建议需人工审查
          </p>
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={refreshMutation.isPending}>
          <RefreshCw className={cn('mr-2 h-4 w-4', refreshMutation.isPending && 'animate-spin')} />
          刷新推荐
        </Button>
      </div>

      {/* ─── 摘要 KPI 条 ─────────────────────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <KpiCard label="总计" value={summary.totalCount} />
          <KpiCard
            label="严重"
            value={summary.criticalCount}
            variant={summary.criticalCount > 0 ? 'danger' : 'default'}
          />
          <KpiCard
            label="高"
            value={summary.highCount}
            variant={summary.highCount > 0 ? 'warning' : 'default'}
          />
          <KpiCard label="待处理" value={summary.newCount} variant="info" />
          <KpiCard label="审查中" value={summary.reviewingCount} />
          <KpiCard label="已采纳" value={summary.acceptedCount} />
          <KpiCard label="已过期" value={summary.staleCount} />
          <KpiCard
            label="AI 理由"
            value={summary.aiAvailableCount}
            variant={summary.aiAvailableCount > 0 ? 'success' : 'default'}
          />
        </div>
      )}

      {/* ─── 过滤器 ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <Select
          value={filters.status ?? 'all'}
          onValueChange={(v) =>
            setFilters((f) => ({
              ...f,
              status: v === 'all' ? undefined : (v as PmoRecommendationListQuery['status']),
            }))
          }
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="new">新推荐</SelectItem>
            <SelectItem value="reviewing">审查中</SelectItem>
            <SelectItem value="accepted">已采纳</SelectItem>
            <SelectItem value="dismissed">已忽略</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.severity ?? 'all'}
          onValueChange={(v) =>
            setFilters((f) => ({
              ...f,
              severity: v === 'all' ? undefined : (v as PmoRecommendationListQuery['severity']),
            }))
          }
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="严重度" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部严重度</SelectItem>
            <SelectItem value="critical">严重</SelectItem>
            <SelectItem value="high">高</SelectItem>
            <SelectItem value="medium">中</SelectItem>
            <SelectItem value="low">低</SelectItem>
          </SelectContent>
        </Select>

        {meta && (
          <p className="ml-auto self-center text-sm text-muted-foreground">
            共 {meta.total} 条推荐
          </p>
        )}
      </div>

      {/* ─── 空态 ────────────────────────────────────────────────────────────── */}
      {items.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16">
            <CheckCircle className="h-12 w-12 text-green-400" />
            <p className="text-lg font-medium text-muted-foreground">当前没有需要关注的推荐</p>
            <p className="text-sm text-muted-foreground">
              所有项目状态良好，或尚未刷新推荐。点击右上角"刷新推荐"更新。
            </p>
          </CardContent>
        </Card>
      )}

      {/* ─── 推荐队列 ────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {items.map((item) => (
          <RecommendationCard key={item.id} item={item} onSelect={() => setSelectedId(item.id)} />
        ))}
      </div>

      {/* ─── 分页 ────────────────────────────────────────────────────────────── */}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={meta.page <= 1}
            onClick={() => setFilters((f) => ({ ...f }))}
          >
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {meta.page} / {meta.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={meta.page >= meta.totalPages}
            onClick={() => setFilters((f) => ({ ...f }))}
          >
            下一页
          </Button>
        </div>
      )}

      {/* ─── 详情抽屉 ────────────────────────────────────────────────────────── */}
      <Sheet open={!!selectedId} onOpenChange={() => setSelectedId(null)}>
        <SheetContent className="w-full max-w-lg overflow-y-auto">
          {selectedId && (
            <RecommendationDetailDrawer id={selectedId} onClose={() => setSelectedId(null)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ─── KPI 小卡片 ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  variant = 'default',
}: {
  label: string
  value: number
  variant?: 'default' | 'danger' | 'warning' | 'info' | 'success'
}) {
  const colorMap = {
    default: '',
    danger: 'bg-red-50/50',
    warning: 'bg-orange-50/50',
    info: 'bg-blue-50/50',
    success: 'bg-green-50/50',
  }
  return (
    <div className={cn('rounded border bg-white p-3 shadow-sm', colorMap[variant])}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  )
}

// ─── 推荐卡片 ─────────────────────────────────────────────────────────────────

function RecommendationCard({
  item,
  onSelect,
}: {
  item: PmoRecommendationQueueItem
  onSelect: () => void
}) {
  const sev = SEVERITY_BADGE[item.severity as keyof typeof SEVERITY_BADGE] ?? SEVERITY_BADGE.info
  const statusBadge = STATUS_BADGE[item.status] ?? ''
  const aiBadge =
    AI_STATUS_BADGE[item.aiStatus as keyof typeof AI_STATUS_BADGE] ?? AI_STATUS_BADGE.none

  return (
    <Card
      className={cn('cursor-pointer transition-shadow hover:shadow-md', item.stale && 'opacity-60')}
      onClick={onSelect}
    >
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        {/* 严重度图标 */}
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border',
            sev.color,
          )}
        >
          <sev.icon className="h-5 w-5" />
        </div>

        {/* 内容 */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium truncate">{item.title}</p>
            <Badge variant="outline" className={statusBadge}>
              {RECOMMENDATION_STATUS_LABELS[item.status] ?? item.status}
            </Badge>
            {item.stale && (
              <Badge variant="outline" className="bg-yellow-100 text-yellow-700 border-yellow-200">
                数据过期
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{item.summary}</p>
        </div>

        {/* 元数据 */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className={cn('rounded px-2 py-0.5 border text-xs', aiBadge.color)}>
            {aiBadge.label}
          </span>
          {item.priorityContext.scoringAvailable && item.priorityContext.priorityScore && (
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono">
              {item.priorityContext.priorityScore.toFixed(0)}
            </span>
          )}
          <span className="text-xs">{item.projectName}</span>
          <ChevronRight className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  )
}

// ─── 详情抽屉 ─────────────────────────────────────────────────────────────────

function RecommendationDetailDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, isLoading, error } = usePmoRecommendationDetail(id)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  if (error || !data?.data) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Alert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载推荐详情失败</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      </div>
    )
  }

  const { record, sourceWarnings } = data.data
  const sev = SEVERITY_BADGE[record.severity as keyof typeof SEVERITY_BADGE] ?? SEVERITY_BADGE.info
  const aiBadge =
    AI_STATUS_BADGE[record.aiStatus as keyof typeof AI_STATUS_BADGE] ?? AI_STATUS_BADGE.none

  return (
    <div className="space-y-6">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border',
              sev.color,
            )}
          >
            <sev.icon className="h-5 w-5" />
          </div>
          <span className="text-lg">{record.title}</span>
        </SheetTitle>
        <SheetDescription>PMO AI 优先级推荐详情</SheetDescription>
      </SheetHeader>

      {/* 推荐摘要 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">推荐摘要</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{record.summary}</p>
          <p className="text-sm text-muted-foreground">建议行动：{record.suggestedAction}</p>
        </CardContent>
      </Card>

      {/* 优先级上下文 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">优先级上下文</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">得分</span>
              <p className="font-mono">{record.priorityContext.priorityScore?.toFixed(0) ?? '—'}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">等级</span>
              <p>{record.priorityContext.priorityLevel}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">排名</span>
              <p>{record.priorityContext.rank ?? '—'}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">评分可用</span>
              <p>{record.priorityContext.scoringAvailable ? '是' : '否'}</p>
            </div>
          </div>
          {record.priorityContext.topDimensionContributors.length > 0 && (
            <div className="mt-3">
              <span className="text-xs text-muted-foreground">关键贡献维度</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {record.priorityContext.topDimensionContributors.map((dim) => (
                  <Badge key={dim} variant="outline" className="text-xs">
                    {dim}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI 理由（如果可用） */}
      {record.aiMetadata && record.aiMetadata.narrative && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-blue-500" />
              AI 推荐理由
              <span className={cn('ml-auto rounded px-2 py-0.5 text-xs border', aiBadge.color)}>
                {aiBadge.label}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded bg-blue-50 p-4 text-sm leading-relaxed text-blue-900">
              <Alert className="mb-3 border-blue-200 bg-blue-100">
                <AlertCircle className="h-3 w-3" />
                <AlertDescription className="text-xs">
                  以下内容为 AI 生成的推荐理由草案，仅供参考，不是正式项目决策。
                </AlertDescription>
              </Alert>
              <p className="whitespace-pre-wrap">{record.aiMetadata.narrative}</p>
              {record.aiMetadata.provider && (
                <p className="mt-3 text-xs text-muted-foreground">
                  生成方：{record.aiMetadata.provider} / {record.aiMetadata.model}
                  {' · '}
                  {record.aiMetadata.generatedAt
                    ? new Date(record.aiMetadata.generatedAt).toLocaleString('zh-CN')
                    : '—'}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 来源信号 */}
      {record.sourceSignals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              来源信号（{record.sourceSignals.length}）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {record.sourceSignals.map((sig, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'rounded border p-3 text-sm',
                    !sig.available && 'opacity-50',
                    sig.stale && 'border-yellow-200 bg-yellow-50',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {sig.source}
                    </Badge>
                    {!sig.available && (
                      <Badge variant="outline" className="text-xs bg-red-50 text-red-600">
                        不可用
                      </Badge>
                    )}
                    {sig.stale && (
                      <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-600">
                        过期
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1">{sig.summary}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 警告 */}
      {sourceWarnings.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              警告（{sourceWarnings.length}）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {sourceWarnings.map((w, idx) => (
                <li key={idx} className="text-yellow-800">
                  {w.code}: {w.message}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── 骨架屏 ────────────────────────────────────────────────────────────────────

function PmoRecommendationsSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-2 h-4 w-96" />
        </div>
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    </div>
  )
}
