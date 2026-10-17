'use client'

import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAuthStore } from '@/stores/auth-store'
import { useTrizCompilerDashboardSummary } from '@/hooks/use-triz-compiler-analysis'
import { type TrizAnalysisStatus, type TrizHandoffStatus } from '@aiproj/types'
import { AlertTriangle, Ban, ChevronRight, FileText } from 'lucide-react'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<TrizAnalysisStatus, string> = {
  pending: '待分析',
  completed: '已完成',
  failed: '分析失败',
  needs_human_review: '需复核',
}

const STATUS_VARIANTS: Record<TrizAnalysisStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  pending: 'info',
  completed: 'success',
  failed: 'danger',
  needs_human_review: 'warning',
}

const HANDOFF_LABELS: Record<TrizHandoffStatus, string> = {
  none: '未提交',
  candidate_created: '候选已创建',
  stale: '已过期',
  handed_off: '已提交',
}

// ---------------------------------------------------------------------------
// TrizDashboardSummaryProps
// ---------------------------------------------------------------------------

interface TrizDashboardSummaryProps {
  projectId: number
  onNavigate?: () => void
}

// ---------------------------------------------------------------------------
// TrizDashboardSummary
// ---------------------------------------------------------------------------

export function TrizDashboardSummary({ projectId, onNavigate }: TrizDashboardSummaryProps) {
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const canView = hasPermission('contradiction:view')

  const { data: summary, isLoading, isError } = useTrizCompilerDashboardSummary(projectId)

  // 权限空态：无 contradiction:view 权限
  if (!canView) {
    return (
      <Card variant="outlined" className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">TRIZ 矛盾分析</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-gray-400">
          <Ban className="h-4 w-4" />
          <span>无权限查看</span>
        </CardContent>
      </Card>
    )
  }

  // 加载态
  if (isLoading) {
    return (
      <Card variant="outlined" className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">TRIZ 矛盾分析</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-3/4 mb-2" />
          <Skeleton className="h-3 w-1/2" />
        </CardContent>
      </Card>
    )
  }

  // 空态或错误态
  if (isError || !summary?.trizCompilerSummary) {
    return (
      <Card variant="outlined" className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">TRIZ 矛盾分析</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-gray-400">
          <FileText className="h-4 w-4" />
          <span>暂无分析数据</span>
        </CardContent>
      </Card>
    )
  }

  const s = summary.trizCompilerSummary

  return (
    <Card
      variant="outlined"
      className="h-full cursor-pointer transition-colors hover:bg-gray-50"
      onClick={onNavigate}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">TRIZ 矛盾分析</CardTitle>
          <Badge variant={STATUS_VARIANTS[s.status]}>{STATUS_LABELS[s.status]}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5 text-sm">
          {/* 警告计数 */}
          {s.warningCount > 0 && (
            <div className="flex items-center gap-1.5">
              <AlertTriangle
                className={`h-3.5 w-3.5 ${
                  s.blockingWarningCount > 0 ? 'text-danger' : 'text-warning'
                }`}
              />
              <span className="text-gray-700">
                {s.blockingWarningCount > 0
                  ? `${s.blockingWarningCount} 条阻断警告`
                  : `${s.warningCount} 条警告`}
              </span>
            </div>
          )}

          {/* 矛盾与解决路径计数 */}
          <div className="flex items-center gap-3 text-gray-500">
            <span>{s.sourceContradictionCount} 矛盾</span>
            <span>{s.resolutionPathCount} 解决路径</span>
          </div>

          {/* Handoff 状态 */}
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Handoff: {HANDOFF_LABELS[s.handoffStatus]}</span>
            {onNavigate && <ChevronRight className="h-3.5 w-3.5 text-gray-300" />}
          </div>

          {/* 参数张力预览 */}
          {s.topTensions.length > 0 && (
            <div className="pt-1">
              {s.topTensions.map((tension, idx) => (
                <p key={idx} className="text-xs text-gray-400 truncate">
                  {tension}
                </p>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
