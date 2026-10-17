'use client'

/**
 * PMO 优先级评分工作台页面（v3-pmo-priority-scoring-model §5.3）。
 *
 * 路由：/pmo/priority-scoring
 * 首屏：优先级队列表格 + 评分徽标 + 过滤/分组控件 + 权重版本 + freshness/warning + 安全钻取
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePermissions } from '@/hooks/use-permissions'
import {
  usePriorityScoringSummary,
  usePriorityScoringProjects,
  usePriorityScoringWeights,
} from '@/hooks/use-priority-scoring'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PRIORITY_LEVEL_LABELS, type PriorityLevel } from '@aiproj/types'
import {
  AlertCircle,
  TrendingUp,
  ShieldAlert,
  Clock,
  ArrowUpDown,
  ExternalLink,
  Info,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const LEVEL_COLORS: Record<PriorityLevel, string> = {
  critical: 'bg-red-100 text-red-800 border-red-300',
  high: 'bg-orange-100 text-orange-800 border-orange-300',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  low: 'bg-green-100 text-green-800 border-green-300',
  unranked: 'bg-gray-100 text-gray-500 border-gray-300',
}

const LEVEL_DOT_COLORS: Record<PriorityLevel, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
  unranked: 'bg-gray-300',
}

export default function PmoPriorityScoringPage() {
  const router = useRouter()
  const { canAny } = usePermissions()
  const hasAccess = canAny(['portfolio:view'])

  const [page, setPage] = useState(1)
  const [levelFilter, setLevelFilter] = useState<PriorityLevel[]>([])
  const [sortKey, setSortKey] = useState('priority_score')

  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
  } = usePriorityScoringSummary()

  const {
    data: projectsData,
    isLoading: projectsLoading,
    error: projectsError,
  } = usePriorityScoringProjects({
    page,
    perPage: 50,
    sort: sortKey,
    priorityLevels: levelFilter.length > 0 ? levelFilter : undefined,
  })

  const { data: weights } = usePriorityScoringWeights()

  // 权限不足
  if (!hasAccess) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>您没有 PMO 优先级评分访问权限。</AlertDescription>
        </Alert>
      </div>
    )
  }

  const isLoading = summaryLoading || projectsLoading
  const error = summaryError || projectsError

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-7 w-7 text-amber-600" />
          <h1 className="text-2xl font-bold tracking-tight">优先级评分</h1>
          {summary && (
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-sm text-gray-600">
              {summary.scoredProjects}/{summary.totalProjects} 已评分
            </span>
          )}
          {weights && <span className="text-xs text-gray-400">权重版本 {weights.version}</span>}
        </div>
        <Button variant="outline" size="sm" onClick={() => router.push('/pmo')}>
          返回组合总览
        </Button>
      </div>

      {/* 错误态 */}
      {error && (
        <Alert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载优先级评分失败，请稍后重试。</AlertDescription>
        </Alert>
      )}

      {/* 等级分布摘要 */}
      {isLoading ? (
        <div className="grid grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-3 w-16 mb-2" />
                <Skeleton className="h-6 w-8" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : summary ? (
        // 等级标签在下方项目队列里也会出现，这里给分布区一个语义地标，
        // 既是 a11y 改进，也让测试能把断言收敛到本区域。
        <div className="grid grid-cols-5 gap-3" role="region" aria-label="优先级等级分布">
          {(['critical', 'high', 'medium', 'low', 'unranked'] as PriorityLevel[]).map((level) => (
            <Card
              key={level}
              // 卡片本身是筛选开关，补上可访问名与选中态（原先只有视觉 ring）。
              role="button"
              tabIndex={0}
              aria-pressed={levelFilter.includes(level)}
              aria-label={`${PRIORITY_LEVEL_LABELS[level]}：${summary.levelCounts[level]} 个项目`}
              className={cn(
                'cursor-pointer transition-shadow hover:shadow-md',
                levelFilter.includes(level) && 'ring-2 ring-amber-500',
              )}
              onClick={() =>
                setLevelFilter((prev) =>
                  prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level],
                )
              }
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                  <span className={cn('h-2 w-2 rounded-full', LEVEL_DOT_COLORS[level])} />
                  {PRIORITY_LEVEL_LABELS[level]}
                </div>
                <div className="mt-1 text-2xl font-bold">{summary.levelCounts[level]}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Warnings */}
      {summary?.warnings && summary.warnings.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summary.warnings.map((w, i) => (
            <Badge
              key={i}
              variant="neutral"
              className="flex items-center gap-1 bg-yellow-50 text-yellow-700"
            >
              <AlertCircle className="h-3 w-3" />
              {w.message}
            </Badge>
          ))}
        </div>
      )}

      {/* 排序/过滤控件 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 text-sm text-gray-500">
          <ArrowUpDown className="h-4 w-4" />
          排序：
        </div>
        <select
          className="rounded border border-gray-300 px-2 py-1 text-sm"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
        >
          <option value="priority_score">评分</option>
          <option value="priority_level">等级</option>
          <option value="rank">排名</option>
          <option value="project_name">项目名称</option>
        </select>

        {levelFilter.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setLevelFilter([])}>
            清除过滤 ({levelFilter.length})
          </Button>
        )}
      </div>

      {/* 评分队列表格 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">项目优先级队列</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : projectsData ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="px-2 py-2 font-medium">排名</th>
                    <th className="px-2 py-2 font-medium">项目</th>
                    <th className="px-2 py-2 font-medium">评分</th>
                    <th className="px-2 py-2 font-medium">等级</th>
                    <th className="px-2 py-2 font-medium">主要维度</th>
                    <th className="px-2 py-2 font-medium">状态</th>
                    <th className="px-2 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {projectsData.data.map((item) => (
                    <tr
                      key={item.projectId}
                      className={cn(
                        'border-b hover:bg-gray-50',
                        item.priorityLevel === 'unranked' && 'opacity-50',
                      )}
                    >
                      <td className="px-2 py-2 text-gray-400">
                        {item.rank > 0 ? `#${item.rank}` : '—'}
                      </td>
                      <td className="px-2 py-2 font-medium">{item.projectName}</td>
                      <td className="px-2 py-2">
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-xs font-mono',
                            item.priorityScore >= 80
                              ? 'bg-red-100 text-red-700'
                              : item.priorityScore >= 60
                                ? 'bg-orange-100 text-orange-700'
                                : item.priorityScore >= 40
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-green-100 text-green-700',
                          )}
                        >
                          {item.priorityScore >= 0 ? item.priorityScore.toFixed(1) : '—'}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <Badge className={cn('text-xs', LEVEL_COLORS[item.priorityLevel])}>
                          {PRIORITY_LEVEL_LABELS[item.priorityLevel]}
                        </Badge>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          {item.topReasons.map((r) => (
                            <Badge key={r.dimension} variant="outline" className="text-xs">
                              {r.dimension}
                            </Badge>
                          ))}
                          {item.topReasons.length === 0 && (
                            <span className="text-xs text-gray-400">
                              {item.warnings.length > 0 ? '数据不足' : '无'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          {item.warnings.filter((w) => w.code === 'SOURCE_STALE').length > 0 && (
                            <span title="数据可能过期">
                              <Clock className="h-3.5 w-3.5 text-amber-500" />
                            </span>
                          )}
                          {item.warnings.filter((w) => w.code === 'DIMENSION_FORBIDDEN').length >
                            0 && (
                            <span title="部分维度受限">
                              <ShieldAlert className="h-3.5 w-3.5 text-gray-400" />
                            </span>
                          )}
                          {item.warnings.filter(
                            (w) =>
                              w.code === 'DIMENSION_UNAVAILABLE' || w.code === 'SOURCE_UNAVAILABLE',
                          ).length > 0 && (
                            <span title="部分数据不可用">
                              <Info className="h-3.5 w-3.5 text-gray-400" />
                            </span>
                          )}
                          {item.warnings.length === 0 && (
                            <span className="text-xs text-green-600">正常</span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => router.push(`/projects/${item.projectId}`)}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {projectsData.data.length === 0 && (
                <div className="py-8 text-center text-gray-400">暂无项目评分数据</div>
              )}

              {/* 分页 */}
              {projectsData.meta.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm text-gray-500">共 {projectsData.meta.total} 个项目</span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      上一页
                    </Button>
                    <span className="flex items-center text-sm text-gray-500">
                      {page} / {projectsData.meta.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= projectsData.meta.totalPages}
                      onClick={() => setPage((p) => Math.min(projectsData.meta.totalPages, p + 1))}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
