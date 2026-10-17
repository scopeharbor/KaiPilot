'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { usePortfolioSummary } from '@/hooks/use-portfolio-dashboard'
import { usePermissions } from '@/hooks/use-permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import {
  AlertCircle,
  BarChart3,
  CheckCircle,
  Clock,
  AlertTriangle,
  Building2,
  Gavel,
  ShieldAlert,
  TrendingUp,
  Layers,
  LayoutDashboard,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { PmoInvestmentDistributionSection } from '@/components/views/pmo/PmoInvestmentDistributionSection'

/** 分组视图工作台（动态导入，避免首屏包体积过大） */
const PmoGroupingViewWorkbench = dynamic(
  () => import('./grouping-views/page').then((m) => m.default),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> },
)

/**
 * PMO 组合 Dashboard 页面（v3-pmo-portfolio-dashboard §5.3）。
 *
 * 路由：/pmo/portfolio-dashboard
 * 首屏：KPI 条 + 交通灯摘要 + freshness/warning badges + 项目概览
 */
type PmoTab = 'overview' | 'grouping-views'

export default function PmoPortfolioDashboardPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<PmoTab>('overview')
  const { canAny } = usePermissions()
  const hasAccess = canAny(['portfolio:view'])

  const { data, isLoading, error } = usePortfolioSummary()
  const summary = data

  // 权限不足时显示降级
  if (!hasAccess) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>您没有 PMO 组合 Dashboard 访问权限。</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载 PMO Dashboard 失败，请稍后重试。</AlertDescription>
        </Alert>
      </div>
    )
  }

  const kpis = summary?.kpis ?? []
  const warnings = summary?.warnings ?? []
  const trafficLight = summary?.trafficLight

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* 标题 */}
      <div className="flex items-center gap-3">
        <BarChart3 className="h-7 w-7 text-teal-600" />
        <h1 className="text-2xl font-bold tracking-tight">PMO 组合总览</h1>
        {summary && (
          <span className="text-sm text-gray-500">
            共 {summary.meta.visibleProjectCount} 个项目
          </span>
        )}
      </div>

      {/* 子导航 */}
      <div className="flex gap-2">
        <Button
          variant={activeTab === 'overview' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('overview')}
        >
          <LayoutDashboard className="mr-1 h-4 w-4" />
          组合总览
        </Button>
        <Button
          variant={activeTab === 'grouping-views' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('grouping-views')}
        >
          <Layers className="mr-1 h-4 w-4" />
          分组视图
        </Button>
        <Button variant="outline" size="sm" onClick={() => router.push('/pmo/priority-scoring')}>
          <TrendingUp className="mr-1 h-4 w-4" />
          优先级评分
        </Button>
        {canAny(['pmo_decision:view']) && (
          <Button variant="outline" size="sm" onClick={() => router.push('/pmo/decisions')}>
            <Gavel className="mr-1 h-4 w-4" />
            决策工作台
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push('/organization/resource-pool')}
        >
          <Users className="mr-1 h-4 w-4" />
          组织资源池
        </Button>
      </div>

      {/* Tab 内容 */}
      {activeTab === 'overview' ? (
        <>
          {/* KPI 条 */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <Skeleton className="h-4 w-20 mb-2" />
                      <Skeleton className="h-8 w-12" />
                    </CardContent>
                  </Card>
                ))
              : kpis.slice(0, 10).map((kpi) => (
                  <Card
                    key={kpi.key}
                    className={cn(
                      kpi.status === 'forbidden' && 'opacity-50',
                      'cursor-pointer transition-shadow hover:shadow-md',
                    )}
                    onClick={() => router.push(`/projects`)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        {kpi.key === 'at_risk_projects' ? (
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                        ) : kpi.key === 'blocked_projects' ? (
                          <ShieldAlert className="h-4 w-4 text-orange-500" />
                        ) : kpi.key === 'active_projects' ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : kpi.key === 'overall_progress_avg' ? (
                          <Clock className="h-4 w-4 text-blue-500" />
                        ) : (
                          <Building2 className="h-4 w-4 text-gray-500" />
                        )}
                        <span className="text-xs font-medium text-gray-500 uppercase">
                          {kpiLabel(kpi.key)}
                        </span>
                      </div>
                      <div className="mt-1 text-2xl font-bold">
                        {kpi.value === null
                          ? '—'
                          : `${kpi.value}${kpi.unit === 'percent' ? '%' : ''}`}
                      </div>
                      {kpi.warnings && kpi.warnings.length > 0 && (
                        <div className="mt-1 text-xs text-gray-400">{kpi.warnings[0]?.message}</div>
                      )}
                    </CardContent>
                  </Card>
                ))}
          </div>

          {/* 交通灯摘要 */}
          {trafficLight && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertCircle className="h-4 w-4 text-gray-500" />
                  交通灯状态
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!trafficLight.available ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <AlertCircle className="h-3 w-3" />
                    {trafficLight.warnings[0]?.message ?? '交通灯能力未启用'}
                  </div>
                ) : (
                  <div className="flex gap-4">
                    <div className="flex items-center gap-1">
                      <span className="h-3 w-3 rounded-full bg-red-500" />
                      <span className="text-sm">红 {trafficLight.redCount}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="h-3 w-3 rounded-full bg-yellow-500" />
                      <span className="text-sm">黄 {trafficLight.yellowCount}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="h-3 w-3 rounded-full bg-green-500" />
                      <span className="text-sm">绿 {trafficLight.greenCount}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="h-3 w-3 rounded-full bg-gray-300" />
                      <span className="text-sm">灰 {trafficLight.grayCount}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Freshness + Warnings */}
          {warnings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  提示 ({warnings.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm text-gray-600">
                  {warnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-400" />
                      {w.message}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {/* 投入分布区块（v3-pmo-investment-distribution §5.4） */}
          <PmoInvestmentDistributionSection />
        </>
      ) : (
        /* 分组视图工作台 */
        <PmoGroupingViewWorkbench />
      )}
    </div>
  )
}

/** 指标键 → 中文标签 */
function kpiLabel(key: string): string {
  const labels: Record<string, string> = {
    total_projects: '项目总数',
    active_projects: '活跃项目',
    archived_projects: '已归档',
    at_risk_projects: '风险项目',
    blocked_projects: '暂停项目',
    overall_progress_avg: '平均进度',
    delivery_on_track_percent: '按期交付',
    overdue_project_percent: '延期项目',
    health_red_percent: '健康红色',
    health_yellow_percent: '健康黄色',
    health_green_percent: '健康绿色',
    risk_high_percent: '高风险',
    risk_critical_count: '严重风险',
    resource_overload_percent: '资源超载',
    prediction_high_severity_percent: '预测高压',
    source_freshness_stale_percent: '数据过期',
    metric_unavailable_count: '不可用指标',
  }
  return labels[key] ?? key
}
