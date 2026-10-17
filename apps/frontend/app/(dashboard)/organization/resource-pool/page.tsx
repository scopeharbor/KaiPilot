'use client'

import { useState, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useOrganizationResourcePoolSummary,
  useOrganizationResourcePoolResources,
  useOrganizationResourcePoolSkills,
  useOrganizationResourcePoolCapacity,
  useOrganizationResourcePoolConflicts,
  useOrganizationResourcePoolDemandGaps,
} from '@/hooks/use-organization-resource-pool'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
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
  LayoutGrid as LayoutGridIcon,
  List,
  Users,
  Wrench,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  OrganizationResourcePoolSummary,
  OrganizationResourcePoolResourceRow,
  OrganizationResourcePoolSkillItem,
  OrganizationResourcePoolConflict,
  OrganizationResourcePoolDemandGap,
  OrganizationResourcePoolCapacityMatrix,
  OrganizationResourcePoolLoadStatus,
  OrganizationResourcePoolWarning,
  OrganizationResourcePoolQuery,
  OrganizationResourcePoolEnvelope,
} from '@aiproj/types'

// ── 中文标签 ────────────────────────────────────────────────────────────────

const LOAD_LABELS: Record<string, string> = {
  idle: '空闲',
  normal: '正常',
  high: '高负载',
  overloaded: '过载',
  unavailable: '不可用',
}

const SEVERITY_LABELS: Record<string, string> = {
  info: '信息',
  warning: '警告',
  error: '错误',
  critical: '严重',
}

const LOAD_COLORS: Record<string, string> = {
  idle: 'bg-slate-100 text-slate-600',
  normal: 'bg-emerald-100 text-emerald-700',
  high: 'bg-amber-100 text-amber-700',
  overloaded: 'bg-red-100 text-red-700',
  unavailable: 'bg-gray-200 text-gray-500',
}

const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
  critical: 'bg-red-200 text-red-800',
}

const VIEW_TABS: Array<{ key: string; label: string; icon: React.ReactNode }> = [
  { key: 'matrix', label: '容量矩阵', icon: <Grid3X3 className="h-4 w-4" /> },
  { key: 'list', label: '资源列表', icon: <List className="h-4 w-4" /> },
  { key: 'skills', label: '技能覆盖', icon: <Wrench className="h-4 w-4" /> },
  { key: 'conflicts', label: '冲突', icon: <AlertTriangle className="h-4 w-4" /> },
  { key: 'demand_gaps', label: '需求缺口', icon: <Zap className="h-4 w-4" /> },
]

// ── 格式工具 ────────────────────────────────────────────────────────────────

function fmtHours(h: number): string {
  if (h === 0) return '0h'
  return `${h.toFixed(1)}h`
}

function fmtPercent(p: number): string {
  return `${p.toFixed(0)}%`
}

function fmtWarning(w: OrganizationResourcePoolWarning): string {
  return w.message
}

// ── 路由状态恢复 ────────────────────────────────────────────────────────────

function useResourcePoolState() {
  const searchParams = useSearchParams()
  return {
    view: searchParams.get('view') || 'matrix',
    page: Number(searchParams.get('page') || '1'),
    sort: searchParams.get('sort') || 'utilization',
    order: searchParams.get('order') || 'desc',
    loadStatus: searchParams.get('loadStatus') || '',
    conflictSeverity: searchParams.get('conflictSeverity') || '',
    role: searchParams.get('role') || '',
    skill: searchParams.get('skill') || '',
    search: searchParams.get('search') || '',
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 主页面
// ═══════════════════════════════════════════════════════════════════════════════

export default function OrganizationResourcePoolPage() {
  const state = useResourcePoolState()
  const { canAny } = usePermissions()
  const hasAccess = canAny(['org:view', 'portfolio:view', 'resource:view'])

  const [activeView, setActiveView] = useState(state.view)
  const [page, setPage] = useState(state.page)

  const query: OrganizationResourcePoolQuery = useMemo(
    () => ({
      view: activeView as OrganizationResourcePoolQuery['view'],
      page,
      sort: state.sort as OrganizationResourcePoolQuery['sort'],
      order: state.order as OrganizationResourcePoolQuery['order'],
      loadStatus: (state.loadStatus || undefined) as OrganizationResourcePoolQuery['loadStatus'],
      conflictSeverity: (state.conflictSeverity ||
        undefined) as OrganizationResourcePoolQuery['conflictSeverity'],
      role: state.role || undefined,
      skill: state.skill || undefined,
      search: state.search || undefined,
    }),
    [
      activeView,
      page,
      state.sort,
      state.order,
      state.loadStatus,
      state.conflictSeverity,
      state.role,
      state.skill,
      state.search,
    ],
  )

  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
  } = useOrganizationResourcePoolSummary(query)

  const { data: resourcesData, isLoading: resourcesLoading } =
    useOrganizationResourcePoolResources(query)

  const { data: skills, isLoading: skillsLoading } = useOrganizationResourcePoolSkills(query)

  const { data: capacity, isLoading: capacityLoading } = useOrganizationResourcePoolCapacity(query)

  const { data: conflictsData, isLoading: conflictsLoading } =
    useOrganizationResourcePoolConflicts(query)

  const { data: gapsData, isLoading: gapsLoading } = useOrganizationResourcePoolDemandGaps(query)

  // ── 权限不足 ──────────────────────────────────────────────────────────────

  if (!hasAccess) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>您没有组织资源池访问权限。</AlertDescription>
        </Alert>
      </div>
    )
  }

  // ── 错误 ──────────────────────────────────────────────────────────────────

  if (summaryError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载组织资源池失败，请稍后重试。</AlertDescription>
        </Alert>
      </div>
    )
  }

  // ── 加载态 ────────────────────────────────────────────────────────────────

  if (summaryLoading || !summary) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-[400px]" />
      </div>
    )
  }

  // ── 空组织 ────────────────────────────────────────────────────────────────

  if (summary.resourceCount === 0 && summary.capacity.totalHours === 0) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Link href="/organization">
            <Button variant="ghost" size="icon" aria-label="返回组织总览">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">组织资源池</h1>
        </div>
        <EmptyState
          icon={Users}
          title="当前组织没有可见项目或资源"
          description="创建项目和资源后，可在此查看组织级资源池汇总"
        />
      </div>
    )
  }

  // ── 正常渲染 ─────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/organization">
            <Button variant="ghost" size="icon" aria-label="返回组织总览">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">组织资源池</h1>
          {summary.warnings.length > 0 && (
            <div className="flex gap-1">
              {summary.warnings.map((w, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                  title={fmtWarning(w)}
                >
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  {w.code}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>更新于 {new Date(summary.meta.calculatedAt).toLocaleTimeString('zh-CN')}</span>
          <span>· {summary.meta.visibleProjectCount} 个项目</span>
        </div>
      </div>

      {/* KPI 条 */}
      <KpiStrip summary={summary} />

      {/* 视图切换 */}
      <ViewTabs activeView={activeView} onViewChange={setActiveView} />

      {/* 视图内容 */}
      <div className="min-h-[300px]">
        {activeView === 'matrix' && (
          <CapacityMatrixView
            data={capacity}
            loading={capacityLoading}
            resources={resourcesData?.data ?? []}
          />
        )}
        {activeView === 'list' && (
          <ResourceListView
            data={resourcesData}
            loading={resourcesLoading}
            page={page}
            onPageChange={setPage}
          />
        )}
        {activeView === 'skills' && <SkillsView data={skills} loading={skillsLoading} />}
        {activeView === 'conflicts' && (
          <ConflictsView
            data={conflictsData}
            loading={conflictsLoading}
            page={page}
            onPageChange={setPage}
          />
        )}
        {activeView === 'demand_gaps' && (
          <DemandGapsView
            data={gapsData}
            loading={gapsLoading}
            page={page}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// KPI 条
// ═══════════════════════════════════════════════════════════════════════════════

function KpiStrip({ summary }: { summary: OrganizationResourcePoolSummary }) {
  const metrics = summary.metrics
  const find = (key: string) => metrics.find((m) => m.key === key)

  const items = [
    { label: '资源总数', value: find('org_respool_total_resources')?.value, unit: '' },
    { label: '总容量', value: find('org_respool_total_capacity_hours')?.value, unit: 'h' },
    { label: '已分配', value: find('org_respool_allocated_capacity_hours')?.value, unit: 'h' },
    { label: '利用率', value: find('org_respool_avg_utilization_percent')?.value, unit: '%' },
    { label: '过载', value: find('org_respool_overloaded_resources')?.value, unit: '' },
    { label: '冲突', value: find('org_respool_conflict_count')?.value, unit: '' },
    { label: '需求缺口', value: find('org_respool_demand_gap_count')?.value, unit: '' },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
      {items.map((item) => (
        <Card key={item.label} className="py-3">
          <CardContent className="flex flex-col items-center gap-1 p-2 text-center">
            <span className="text-xs text-muted-foreground">{item.label}</span>
            <span className="text-xl font-bold tabular-nums">
              {item.value !== null && item.value !== undefined
                ? item.unit === 'h'
                  ? fmtHours(item.value)
                  : item.unit === '%'
                    ? fmtPercent(item.value)
                    : String(item.value)
                : '—'}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 视图切换
// ═══════════════════════════════════════════════════════════════════════════════

function ViewTabs({
  activeView,
  onViewChange,
}: {
  activeView: string
  onViewChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b pb-2" role="tablist">
      {VIEW_TABS.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={activeView === tab.key}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            activeView === tab.key
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
          onClick={() => onViewChange(tab.key)}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 容量矩阵视图
// ═══════════════════════════════════════════════════════════════════════════════

function CapacityMatrixView({
  data,
  loading,
}: {
  data?: OrganizationResourcePoolCapacityMatrix
  loading: boolean
  resources: OrganizationResourcePoolResourceRow[]
}) {
  if (loading) return <Skeleton className="h-[400px]" />
  if (!data || data.rows.length === 0) {
    return (
      <EmptyState
        icon={LayoutGridIcon}
        title="无容量数据"
        description="在日期窗口内没有可显示的资源容量数据"
      />
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium">资源</th>
            <th className="px-2 py-2 text-center font-medium">角色</th>
            <th className="px-2 py-2 text-center font-medium">状态</th>
            <th className="px-2 py-2 text-center font-medium">总容量</th>
            <th className="px-2 py-2 text-center font-medium">已分配</th>
            <th className="px-2 py-2 text-center font-medium">剩余</th>
            <th className="px-2 py-2 text-center font-medium">利用率</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.resourceId} className="border-b hover:bg-muted/30">
              <td className="sticky left-0 z-10 bg-background px-3 py-2 font-medium">
                {row.redacted ? (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <EyeOff className="h-3 w-3" />
                    已脱敏
                  </span>
                ) : (
                  (row.resourceName ?? `资源 #${row.resourceId}`)
                )}
              </td>
              <td className="px-2 py-2 text-center text-muted-foreground">{row.role ?? '—'}</td>
              <td className="px-2 py-2 text-center">
                <LoadBadge status={row.loadStatus} />
              </td>
              <td className="px-2 py-2 text-center tabular-nums">
                {fmtHours(row.totalCapacityHours)}
              </td>
              <td className="px-2 py-2 text-center tabular-nums">
                {fmtHours(row.totalAllocatedHours)}
              </td>
              <td className="px-2 py-2 text-center tabular-nums">
                {fmtHours(row.totalRemainingHours)}
              </td>
              <td className="px-2 py-2 text-center">
                <UtilizationBar percent={row.utilizationPercent} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 资源列表视图
// ═══════════════════════════════════════════════════════════════════════════════

function ResourceListView({
  data,
  loading,
  page,
  onPageChange,
}: {
  data?: OrganizationResourcePoolEnvelope<OrganizationResourcePoolResourceRow[]>
  loading: boolean
  page: number
  onPageChange: (p: number) => void
}) {
  if (loading) return <Skeleton className="h-[400px]" />
  if (!data || data.data.length === 0) {
    return <EmptyState icon={List} title="无资源数据" description="没有可见资源" />
  }

  const totalPages = data.meta.totalPages || 1

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left font-medium">名称</th>
              <th className="px-2 py-2 text-left font-medium">类型</th>
              <th className="px-2 py-2 text-left font-medium">角色</th>
              <th className="px-2 py-2 text-left font-medium">技能</th>
              <th className="px-2 py-2 text-center font-medium">状态</th>
              <th className="px-2 py-2 text-center font-medium">利用率</th>
              <th className="px-2 py-2 text-center font-medium">冲突</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((row) => (
              <tr key={row.resourceId} className="border-b hover:bg-muted/30">
                <td className="px-3 py-2 font-medium">
                  {row.redacted ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <EyeOff className="h-3 w-3" />
                      已脱敏
                    </span>
                  ) : (
                    (row.resourceName ?? `资源 #${row.resourceId}`)
                  )}
                </td>
                <td className="px-2 py-2 text-muted-foreground">{row.resourceType ?? '—'}</td>
                <td className="px-2 py-2 text-muted-foreground">{row.role ?? '—'}</td>
                <td className="px-2 py-2">
                  {row.skillTags ? (
                    <div className="flex flex-wrap gap-1">
                      {row.skillTags.slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {tag}
                        </span>
                      ))}
                      {row.skillTags.length > 3 && (
                        <span className="text-xs text-muted-foreground">
                          +{row.skillTags.length - 3}
                        </span>
                      )}
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-2 py-2 text-center">
                  <LoadBadge status={row.loadStatus} />
                </td>
                <td className="px-2 py-2 text-center">
                  <UtilizationBar percent={row.utilizationPercent} />
                </td>
                <td className="px-2 py-2 text-center">
                  {row.conflictFlags.length > 0 ? (
                    <div className="flex justify-center gap-1">
                      {row.conflictFlags.map((flag) => (
                        <span
                          key={flag}
                          className={cn(
                            'rounded px-1.5 py-0.5 text-xs font-medium',
                            SEVERITY_COLORS[flag] || 'bg-gray-100 text-gray-600',
                          )}
                        >
                          {SEVERITY_LABELS[flag] ?? flag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            下一页
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 技能覆盖视图
// ═══════════════════════════════════════════════════════════════════════════════

function SkillsView({
  data,
  loading,
}: {
  data?: OrganizationResourcePoolSkillItem[]
  loading: boolean
}) {
  if (loading) return <Skeleton className="h-[400px]" />
  if (!data || data.length === 0) {
    return <EmptyState icon={Wrench} title="无技能数据" description="没有可见的技能覆盖信息" />
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((item, i) => (
        <Card key={item.skill ?? `redacted-${i}`}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              {item.redacted ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <EyeOff className="h-3.5 w-3.5" />
                  低基数已脱敏
                </span>
              ) : (
                <span>{item.skill}</span>
              )}
              {item.gap && (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                  缺口
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">资源数</span>
              <span className="font-medium tabular-nums">
                {item.resourceCount !== null ? item.resourceCount : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">容量</span>
              <span className="font-medium tabular-nums">
                {item.capacityHours !== null ? fmtHours(item.capacityHours) : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">已分配</span>
              <span className="font-medium tabular-nums">
                {item.allocatedHours !== null ? fmtHours(item.allocatedHours) : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">剩余</span>
              <span className="font-medium tabular-nums">
                {item.remainingHours !== null ? fmtHours(item.remainingHours) : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">需求数</span>
              <span className="font-medium tabular-nums">
                {item.demandCount !== null ? item.demandCount : '—'}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 冲突视图
// ═══════════════════════════════════════════════════════════════════════════════

function ConflictsView({
  data,
  loading,
  page,
  onPageChange,
}: {
  data?: OrganizationResourcePoolEnvelope<OrganizationResourcePoolConflict[]>
  loading: boolean
  page: number
  onPageChange: (p: number) => void
}) {
  if (loading) return <Skeleton className="h-[400px]" />
  if (!data || data.data.length === 0) {
    return <EmptyState icon={AlertTriangle} title="无冲突" description="当前没有检测到资源冲突" />
  }

  const totalPages = data.meta.totalPages || 1

  return (
    <div className="space-y-3">
      {data.data.map((conflict) => (
        <Card key={conflict.conflictId}>
          <CardContent className="flex items-start gap-3 p-4">
            <span
              className={cn(
                'mt-0.5 rounded px-1.5 py-0.5 text-xs font-medium',
                SEVERITY_COLORS[conflict.severity] || 'bg-gray-100',
              )}
            >
              {SEVERITY_LABELS[conflict.severity] ?? conflict.severity}
            </span>
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium">{conflict.description}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {conflict.resourceName && <span>资源: {conflict.resourceName}</span>}
                {conflict.date && <span>日期: {conflict.date}</span>}
                {conflict.projectNames && conflict.projectNames.length > 0 && (
                  <span>项目: {conflict.projectNames.join(', ')}</span>
                )}
              </div>
              {conflict.remediationHint && (
                <p className="text-xs text-muted-foreground">建议: {conflict.remediationHint}</p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            下一页
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 需求缺口视图
// ═══════════════════════════════════════════════════════════════════════════════

function DemandGapsView({
  data,
  loading,
  page,
  onPageChange,
}: {
  data?: OrganizationResourcePoolEnvelope<OrganizationResourcePoolDemandGap[]>
  loading: boolean
  page: number
  onPageChange: (p: number) => void
}) {
  if (loading) return <Skeleton className="h-[400px]" />
  if (!data || data.data.length === 0) {
    return <EmptyState icon={Zap} title="无需求缺口" description="当前没有未满足的资源需求" />
  }

  const totalPages = data.meta.totalPages || 1

  return (
    <div className="space-y-3">
      {/* v3-resource-gap-analysis §8.6: 从组织资源池 demand-gaps 跳转到统一工作台 */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          需要多维透视缺口画像？查看角色、技能、时间桶、项目、组合等多维度分析
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/organization/resource-gaps`}>
            打开统一缺口工作台
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      {data.data.map((gap) => (
        <Card key={gap.gapId}>
          <CardContent className="flex items-start gap-3 p-4">
            <span className="mt-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
              {gap.priority ?? 'medium'}
            </span>
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium">
                {gap.redacted ? '已脱敏' : `${gap.skill ?? gap.role ?? '未知技能'} — 缺口`}
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {gap.projectName && <span>项目: {gap.projectName}</span>}
                {gap.role && <span>角色: {gap.role}</span>}
                {gap.dateWindow && (
                  <span>
                    窗口: {gap.dateWindow.from} ~ {gap.dateWindow.to}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            下一页
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 共享小组件
// ═══════════════════════════════════════════════════════════════════════════════

function LoadBadge({ status }: { status: OrganizationResourcePoolLoadStatus }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
        LOAD_COLORS[status] || 'bg-gray-100 text-gray-600',
      )}
    >
      {LOAD_LABELS[status] ?? status}
    </span>
  )
}

function UtilizationBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent))
  const color =
    clamped <= 10
      ? 'bg-slate-400'
      : clamped <= 80
        ? 'bg-emerald-500'
        : clamped <= 100
          ? 'bg-amber-500'
          : 'bg-red-500'

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{fmtPercent(percent)}</span>
    </div>
  )
}
