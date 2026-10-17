'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import {
  useRecommendationsList,
  useRefreshRecommendations,
  useUpdateRecommendationStatus,
} from '@/lib/api/use-recommendations'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { EmptyState } from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/Toast'
import {
  RECOMMENDATION_STATUSES,
  RECOMMENDATION_SOURCES,
  RECOMMENDATION_SEVERITY_LABELS,
  RECOMMENDATION_SOURCE_LABELS,
  RECOMMENDATION_STATUS_LABELS,
} from '@aiproj/types'

const severityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  info: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
}

export default function RecommendationsPage() {
  const params = useParams()
  const projectId = Number(params.id)

  const [statusFilter, setStatusFilter] = useState<string>('')
  const [sourceFilter, setSourceFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')

  const filters: Record<string, unknown> = {}
  if (statusFilter) filters.status = statusFilter
  if (sourceFilter) filters.sourceType = sourceFilter
  if (searchQuery) filters.q = searchQuery

  const { data, isLoading, error, refetch } = useRecommendationsList(projectId, filters)
  const refreshMutation = useRefreshRecommendations(projectId)
  const statusMutation = useUpdateRecommendationStatus(projectId)

  const handleRefresh = () => {
    refreshMutation.mutate(undefined, {
      onSuccess: () => {
        toast({ title: '推荐已刷新', description: '已完成推荐候选收集' })
      },
      onError: () => {
        toast({ title: '刷新失败', description: '请稍后重试', variant: 'error' })
      },
    })
  }

  const handleAccept = (recId: number) => {
    statusMutation.mutate(
      { recId, status: 'accepted' },
      {
        onSuccess: () => toast({ title: '已接受推荐' }),
      },
    )
  }

  const handleDismiss = (recId: number) => {
    statusMutation.mutate(
      { recId, status: 'dismissed' },
      {
        onSuccess: () => toast({ title: '已忽略推荐' }),
      },
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert variant="danger">
          <AlertDescription>加载推荐列表失败，请稍后重试</AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => refetch()}>
          重试
        </Button>
      </div>
    )
  }

  const listData = data?.data ?? []
  const summary = data?.summary

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">智能推荐</h1>
          {summary && (
            <p className="text-sm text-muted-foreground mt-1">
              共 {summary.totalCount} 条推荐，其中 {summary.criticalCount} 条严重、
              {summary.highCount} 条高优先级
            </p>
          )}
        </div>
        <Button onClick={handleRefresh} disabled={refreshMutation.isPending}>
          {refreshMutation.isPending ? '刷新中...' : '刷新推荐'}
        </Button>
      </div>

      {/* 筛选栏 */}
      <div className="flex gap-4 flex-wrap">
        <div className="w-40">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}>
            <SelectTrigger>
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              {RECOMMENDATION_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {RECOMMENDATION_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v === 'all' ? '' : v)}>
            <SelectTrigger>
              <SelectValue placeholder="全部来源" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部来源</SelectItem>
              {RECOMMENDATION_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {RECOMMENDATION_SOURCE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <Input
            placeholder="搜索推荐..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 推荐列表 */}
      {listData.length === 0 ? (
        <EmptyState
          title="暂无推荐"
          description="当前项目暂无待处理推荐，可点击刷新按钮收集最新候选"
        />
      ) : (
        <div className="space-y-3">
          {listData.map((rec) => (
            <Card key={rec.id} className={rec.stale ? 'opacity-60' : ''}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{rec.title}</CardTitle>
                    <p className="text-sm text-muted-foreground line-clamp-2">{rec.summary}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Badge className={severityColors[rec.severity]}>
                      {RECOMMENDATION_SEVERITY_LABELS[rec.severity]}
                    </Badge>
                    <Badge variant="outline">
                      {
                        RECOMMENDATION_STATUS_LABELS[
                          rec.status as keyof typeof RECOMMENDATION_STATUS_LABELS
                        ]
                      }
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex gap-2 text-sm text-muted-foreground">
                    <span>{RECOMMENDATION_SOURCE_LABELS[rec.sourceType]}</span>
                    {rec.expiresAt && (
                      <span>过期: {new Date(rec.expiresAt).toLocaleDateString('zh-CN')}</span>
                    )}
                    {rec.stale && <Badge variant="neutral">已过期</Badge>}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAccept(rec.id)}
                      disabled={
                        statusMutation.isPending ||
                        rec.status === 'accepted' ||
                        rec.status === 'converted'
                      }
                    >
                      接受
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDismiss(rec.id)}
                      disabled={statusMutation.isPending || rec.status === 'dismissed'}
                    >
                      忽略
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
