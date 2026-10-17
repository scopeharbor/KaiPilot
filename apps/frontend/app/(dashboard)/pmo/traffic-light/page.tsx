'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  useTrafficLightList,
  useTrafficLightCounts,
  useUpsertTrafficLightReview,
} from '@/hooks/use-pmo-traffic-light'
import { usePermissions } from '@/hooks/use-permissions'
import { Card, CardContent } from '@/components/ui/Card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/Dialog'
import { Textarea } from '@/components/ui/Textarea'
import { AlertCircle, BarChart3, ArrowUpDown, Clock, Eye, FileEdit } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  PortfolioTrafficLightItem,
  TrafficLightStatus,
  TrafficLightReviewState,
  PortfolioTrafficLightSortKey,
} from '@aiproj/types'
import {
  TRAFFIC_LIGHT_STATUS_LABELS,
  TRAFFIC_LIGHT_REVIEW_STATE_LABELS,
  TRAFFIC_LIGHT_STATUSES,
} from '@aiproj/types'

/** 交通灯灯色 → Tailwind 色环 */
const STATUS_COLOR: Record<TrafficLightStatus, string> = {
  red: 'bg-red-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
  gray: 'bg-gray-300',
}

const STATUS_DOT: Record<TrafficLightStatus, string> = {
  red: 'bg-red-500 ring-red-200',
  yellow: 'bg-yellow-500 ring-yellow-200',
  green: 'bg-green-500 ring-green-200',
  gray: 'bg-gray-300 ring-gray-100',
}

const SEVERITY_LABELS: Record<string, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
}

/**
 * PMO 组合交通灯工作台（v3-pmo-portfolio-traffic-light §5.2）。
 *
 * 路由：/pmo/traffic-light
 * 首屏：灯色汇总 + 筛选工具栏 + 项目表格 + 证据抽屉 + 复核控件
 */
export default function PmoTrafficLightPage() {
  const router = useRouter()
  const { canAny } = usePermissions()
  const hasAccess = canAny(['portfolio:view'])
  const canReview = canAny(['portfolio:manage'])

  // 筛选状态
  const [page, setPage] = useState(1)
  const [perPage] = useState(20)
  const [sort, setSort] = useState<PortfolioTrafficLightSortKey>('traffic_light')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [filterStatus, setFilterStatus] = useState<TrafficLightStatus | undefined>()

  // 复核 Dialog 状态
  const [reviewProject, setReviewProject] = useState<PortfolioTrafficLightItem | null>(null)
  const [reviewState, setReviewState] = useState<TrafficLightReviewState>('acknowledged')
  const [reviewNote, setReviewNote] = useState('')

  // 数据
  const {
    data: listData,
    isLoading,
    error,
  } = useTrafficLightList({
    page,
    perPage,
    sort,
    order,
    filterStatus,
  })
  const { data: countsData } = useTrafficLightCounts()

  const items = listData?.data ?? []
  const meta = listData?.meta
  const counts = countsData ?? { red: 0, yellow: 0, green: 0, gray: 0, total: 0, calculatedAt: '' }

  // 复核 mutation
  const reviewMutation = useUpsertTrafficLightReview(reviewProject?.projectId ?? 0)

  const handleReview = useCallback(async () => {
    if (!reviewProject) return
    await reviewMutation.mutateAsync({ reviewState, note: reviewNote || undefined })
    setReviewProject(null)
    setReviewNote('')
  }, [reviewProject, reviewMutation, reviewState, reviewNote])

  // 权限不足降级
  if (!hasAccess) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>您没有 PMO 组合交通灯访问权限。</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* 复核 Dialog：provider 必须包裹下方表格里的 DialogTrigger（否则
          「DialogTrigger must be used within Dialog」→ 整页 error boundary 崩溃）；
          DialogContent 为 portal 渲染，位置不受影响 */}
      <Dialog
        open={!!reviewProject}
        onOpenChange={(open) => {
          if (!open) setReviewProject(null)
        }}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-7 w-7 text-teal-600" />
            <h1 className="text-2xl font-bold tracking-tight">PMO 组合交通灯</h1>
            {counts.total > 0 && (
              <span className="text-sm text-gray-500">
                共 {counts.total} 个项目 ·{' '}
                {counts.calculatedAt
                  ? `更新于 ${new Date(counts.calculatedAt).toLocaleTimeString('zh-CN')}`
                  : ''}
              </span>
            )}
          </div>
        </div>

        {/* 灯色汇总卡 */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {TRAFFIC_LIGHT_STATUSES.map((status) => (
            <Card
              key={status}
              className={cn(
                'cursor-pointer transition-shadow hover:shadow-md',
                filterStatus === status && 'ring-2 ring-teal-500',
              )}
              onClick={() => setFilterStatus(filterStatus === status ? undefined : status)}
            >
              <CardContent className="flex items-center gap-3 p-4">
                <span className={cn('h-4 w-4 rounded-full ring-4', STATUS_DOT[status])} />
                <div>
                  <div className="text-sm font-medium text-gray-500">
                    {TRAFFIC_LIGHT_STATUS_LABELS[status]}
                  </div>
                  <div className="text-2xl font-bold">{counts[status]}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 筛选工具栏 */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">排序：</span>
            <Select value={sort} onValueChange={(v) => setSort(v as PortfolioTrafficLightSortKey)}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="traffic_light">交通灯</SelectItem>
                <SelectItem value="project_name">项目名</SelectItem>
                <SelectItem value="severity_critical">严重度</SelectItem>
                <SelectItem value="severity_high">高严重度</SelectItem>
                <SelectItem value="updated_at">更新时间</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}
            >
              <ArrowUpDown className="h-4 w-4" />
              {order === 'desc' ? '降序' : '升序'}
            </Button>
          </div>
          {filterStatus && (
            <Badge
              variant="neutral"
              className="cursor-pointer"
              onClick={() => setFilterStatus(undefined)}
            >
              {TRAFFIC_LIGHT_STATUS_LABELS[filterStatus]} ×
            </Badge>
          )}
          <div className="ml-auto text-sm text-gray-500">
            {meta && `第 ${meta.page}/${meta.totalPages} 页 · 共 ${meta.total} 条`}
          </div>
        </div>

        {/* 项目表格 */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <Alert variant="danger">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>加载交通灯数据失败，请稍后重试。</AlertDescription>
          </Alert>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="flex min-h-[200px] items-center justify-center p-8">
              <div className="text-center text-gray-500">
                <BarChart3 className="mx-auto h-8 w-8 text-gray-300" />
                <p className="mt-2">
                  {filterStatus
                    ? `没有"${TRAFFIC_LIGHT_STATUS_LABELS[filterStatus]}"项目`
                    : '暂无项目数据'}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">灯色</TableHead>
                  <TableHead>项目名称</TableHead>
                  <TableHead className="w-24">严重度</TableHead>
                  <TableHead className="hidden md:table-cell">Warnings</TableHead>
                  <TableHead className="hidden md:table-cell w-20">数据新鲜度</TableHead>
                  <TableHead className="w-24">复核</TableHead>
                  <TableHead className="w-24">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TrafficLightRow
                    key={item.projectId}
                    item={item}
                    canReview={canReview}
                    onReview={setReviewProject}
                    onViewDetail={(id) => router.push(`/projects/${id}`)}
                  />
                ))}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* 分页 */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className="text-sm text-gray-500">
              {meta.page} / {meta.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.totalPages}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        )}

        {/* 复核 DialogContent（portal 渲染；provider 已上移到页面顶部包裹表格，
          使表格中的 DialogTrigger 处于 provider 子树内） */}
        <DialogContent>
          <DialogHeader>
            <DialogTitle>复核项目：{reviewProject?.projectName}</DialogTitle>
            <DialogDescription>
              当前灯色：{reviewProject && TRAFFIC_LIGHT_STATUS_LABELS[reviewProject.trafficLight]}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <span className="text-sm font-medium">复核状态</span>
              <Select
                value={reviewState}
                onValueChange={(v) => setReviewState(v as TrafficLightReviewState)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="acknowledged">
                    {TRAFFIC_LIGHT_REVIEW_STATE_LABELS.acknowledged}
                  </SelectItem>
                  <SelectItem value="needs_follow_up">
                    {TRAFFIC_LIGHT_REVIEW_STATE_LABELS.needs_follow_up}
                  </SelectItem>
                  <SelectItem value="false_positive">
                    {TRAFFIC_LIGHT_REVIEW_STATE_LABELS.false_positive}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <span className="text-sm font-medium">备注</span>
              <Textarea
                className="mt-1"
                placeholder="复核备注（可选）"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReviewProject(null)}>
                取消
              </Button>
              <Button onClick={handleReview} disabled={reviewMutation.isPending}>
                {reviewMutation.isPending ? '提交中...' : '确认复核'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 单个交通灯行组件 */
function TrafficLightRow({
  item,
  canReview,
  onReview,
  onViewDetail,
}: {
  item: PortfolioTrafficLightItem
  canReview: boolean
  onReview: (item: PortfolioTrafficLightItem) => void
  onViewDetail: (projectId: number) => void
}) {
  const staleBadge = item.sourceFreshness.overallStale
  const reviewStale = item.reviewState.stale

  return (
    <TableRow>
      {/* 灯色 */}
      <TableCell>
        <span
          className={cn('inline-block h-3 w-3 rounded-full', STATUS_COLOR[item.trafficLight])}
          title={TRAFFIC_LIGHT_STATUS_LABELS[item.trafficLight]}
        />
      </TableCell>

      {/* 项目名称 */}
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="font-medium">{item.projectName}</span>
          {staleBadge && (
            <Badge variant="neutral" className="text-xs">
              <Clock className="mr-1 h-3 w-3" />
              数据过期
            </Badge>
          )}
          {item.warnings.length > 0 && (
            <Badge variant="outline" className="text-xs text-yellow-600">
              <AlertCircle className="mr-1 h-3 w-3" />
              {item.warnings.length} 警告
            </Badge>
          )}
        </div>
        {item.warnings.length > 0 && (
          <div className="mt-1 hidden md:block">
            {item.warnings.slice(0, 2).map((w, i) => (
              <span key={i} className="mr-2 text-xs text-gray-400">
                {w.message}
              </span>
            ))}
          </div>
        )}
      </TableCell>

      {/* 严重度 */}
      <TableCell>
        <div className="space-y-0.5">
          {item.severityCounts.critical > 0 && (
            <Badge variant="danger" className="text-xs">
              {SEVERITY_LABELS.critical} {item.severityCounts.critical}
            </Badge>
          )}
          {item.severityCounts.high > 0 && (
            <Badge variant="danger" className="text-xs bg-orange-500">
              {SEVERITY_LABELS.high} {item.severityCounts.high}
            </Badge>
          )}
          {item.severityCounts.medium > 0 && (
            <Badge variant="neutral" className="text-xs bg-yellow-500 text-white">
              {SEVERITY_LABELS.medium} {item.severityCounts.medium}
            </Badge>
          )}
        </div>
      </TableCell>

      {/* Warnings */}
      <TableCell className="hidden md:table-cell">
        {item.warnings.length > 0 ? (
          <span className="text-xs text-gray-500">
            {item.warnings.map((w) => w.code).join(', ')}
          </span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </TableCell>

      {/* 数据新鲜度 */}
      <TableCell className="hidden md:table-cell">
        {staleBadge ? (
          <Badge variant="neutral" className="text-xs text-yellow-600">
            过期
          </Badge>
        ) : (
          <span className="text-xs text-green-500">新鲜</span>
        )}
      </TableCell>

      {/* 复核状态 */}
      <TableCell>
        {item.reviewState.reviewState !== 'acknowledged' || item.reviewState.reviewedAt ? (
          <div className="flex items-center gap-1">
            <Badge
              variant="outline"
              className={cn('text-xs', reviewStale && 'text-yellow-600 border-yellow-300')}
            >
              {TRAFFIC_LIGHT_REVIEW_STATE_LABELS[item.reviewState.reviewState]}
            </Badge>
            {reviewStale && (
              // Lucide 图标不接受 title，改由外层 span 承载 hover 提示。
              <span title="复核已过期">
                <Clock className="h-3 w-3 text-yellow-500" />
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </TableCell>

      {/* 操作 */}
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onViewDetail(item.projectId)}
            title="查看项目"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {canReview && (
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" onClick={() => onReview(item)} title="复核">
                <FileEdit className="h-4 w-4" />
              </Button>
            </DialogTrigger>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
