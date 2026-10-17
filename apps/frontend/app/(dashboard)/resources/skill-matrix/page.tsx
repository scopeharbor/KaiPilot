'use client'

import { useResourceSkillMatrixSummary } from '@/hooks/use-resource-skill-matrix'
import { usePermissions } from '@/hooks/use-permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { AlertCircle, Users, Wrench, Zap } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import {
  formatCoveragePercent,
  formatCapacityHours,
  getGapSeverityColor,
  getGapSeverityLabel,
} from '@/lib/resource-skill-matrix-ui'

/**
 * 资源技能矩阵工作台（v3-resource-skill-matrix §5.3–5.6）。
 *
 * 路由：`/resources/skill-matrix`
 * 首屏：技能覆盖率、关键缺口、候选资源、Skill advisory、warning 与下钻入口。
 */
export default function ResourceSkillMatrixPage() {
  const { currentOrganizationId } = useAuthStore()
  const orgId = currentOrganizationId ?? 1
  const { canAny } = usePermissions()
  const hasAccess = canAny(['org:view', 'resource:view', 'portfolio:view'])
  const { data: summary, isLoading, error } = useResourceSkillMatrixSummary(orgId)

  if (!hasAccess) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>您没有资源技能矩阵访问权限。</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载资源技能矩阵失败，请稍后重试。</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (isLoading || !summary) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  const {
    overallCoverageRatio,
    totalGaps,
    totalCandidateResources,
    totalSkillAdvisories,
    coverageBySkill,
    criticalGaps,
    warnings,
  } = summary

  const isEmpty = coverageBySkill.length === 0 && criticalGaps.length === 0

  if (isEmpty) {
    return (
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">资源技能矩阵</h1>
          <p className="mt-1 text-sm text-muted-foreground">当前组织暂无资源或任务需求数据</p>
        </div>
        <EmptyState
          icon={Users}
          title="暂无技能数据"
          description="添加资源并登记技能标签后，矩阵将自动聚合展示。"
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* 页面标题 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">资源技能矩阵</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            组织级技能覆盖、缺口与 Compiler Skill advisory 总览
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          计算时间：
          {summary.meta.calculatedAt
            ? new Date(summary.meta.calculatedAt).toLocaleString('zh-CN')
            : '—'}
        </div>
      </div>

      {/* Warning 徽标 */}
      {warnings.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {warnings.map((warning, i) => (
            <Badge
              key={i}
              variant={
                warning.severity === 'critical'
                  ? 'danger'
                  : warning.severity === 'warning'
                    ? 'warning'
                    : 'primary'
              }
            >
              {warning.message}
            </Badge>
          ))}
        </div>
      )}

      {/* KPI 条 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <Users className="h-8 w-8 text-blue-600" />
            <div>
              <p className="text-2xl font-bold">{formatCoveragePercent(overallCoverageRatio)}</p>
              <p className="text-xs text-muted-foreground">技能覆盖率</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="h-8 w-8 text-red-600" />
            <div>
              <p className="text-2xl font-bold">{totalGaps}</p>
              <p className="text-xs text-muted-foreground">技能缺口</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <Wrench className="h-8 w-8 text-green-600" />
            <div>
              <p className="text-2xl font-bold">{totalCandidateResources}</p>
              <p className="text-xs text-muted-foreground">候选资源</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <Zap className="h-8 w-8 text-purple-600" />
            <div>
              <p className="text-2xl font-bold">{totalSkillAdvisories}</p>
              <p className="text-xs text-muted-foreground">Skill advisory</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 技能覆盖明细 */}
      <Card>
        <CardHeader>
          <CardTitle>技能覆盖明细</CardTitle>
        </CardHeader>
        <CardContent>
          {coverageBySkill.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无覆盖数据</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-3 font-medium">技能</th>
                    <th className="py-2 pr-3 font-medium">资源数</th>
                    <th className="py-2 pr-3 font-medium">可用容量</th>
                    <th className="py-2 pr-3 font-medium">已分配</th>
                    <th className="py-2 pr-3 font-medium">覆盖率</th>
                    <th className="py-2 font-medium">资源覆盖率</th>
                  </tr>
                </thead>
                <tbody>
                  {coverageBySkill.map((cov) => (
                    <tr key={cov.skillKey} className="border-b">
                      <td className="py-2 pr-3 font-medium">{cov.skillKey}</td>
                      <td className="py-2 pr-3">
                        {cov.skilledResources}/{cov.totalResources}
                      </td>
                      <td className="py-2 pr-3">
                        {formatCapacityHours(cov.totalAvailableCapacityHours)}
                      </td>
                      <td className="py-2 pr-3">
                        {formatCapacityHours(cov.totalAllocatedCapacityHours)}
                      </td>
                      <td className="py-2 pr-3 font-semibold">
                        {formatCoveragePercent(cov.coverageRatio)}
                      </td>
                      <td className="py-2">{formatCoveragePercent(cov.resourceCoverageRatio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 严重缺口 */}
      {criticalGaps.length > 0 && (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-700">
              <AlertCircle className="h-5 w-5" />
              严重技能缺口
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {criticalGaps.map((gap) => (
                <div
                  key={gap.skillKey}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <div>
                    <span className="font-semibold">{gap.skillKey}</span>
                    <Badge
                      variant="danger"
                      className="ml-2"
                      style={{
                        backgroundColor: getGapSeverityColor(gap.severity),
                      }}
                    >
                      {getGapSeverityLabel(gap.severity)}
                    </Badge>
                  </div>
                  <div className="flex gap-4 text-sm">
                    <span>需求 {gap.requirementCount} 项</span>
                    <span>缺口 {formatCapacityHours(gap.gapCapacityHours)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 数据新鲜度 */}
      <div className="text-xs text-muted-foreground">
        来源新鲜度：
        {summary.meta.sourceFreshness.map((sf, i) => (
          <span key={i} className="ml-2">
            {sf.source}
            {sf.stale ? '（过时）' : '（当前）'}
          </span>
        ))}
      </div>
    </div>
  )
}
