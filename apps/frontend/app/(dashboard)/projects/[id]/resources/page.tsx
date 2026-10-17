'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BarChart3, CheckCircle2, Plus, Save, Sparkles, Users } from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import PermissionGuard from '@/components/PermissionGuard'
import { Badge } from '@/components/ui/Badge'
import { BrandLoader } from '@/components/ui/BrandLogo'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Skeleton } from '@/components/ui/Skeleton'
import { SaveViewDialog } from '@/components/views/custom-views/SaveViewDialog'
import { useCustomViewManager } from '@/components/views/custom-views/CustomViewManager'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
import {
  requirementKeys,
  resourceConflictTypeLabel,
  resourceKeys,
  resourcePlanningKeys,
  resourcesApi,
  type Resource,
  type ResourceLoadStatus,
  type ResourceStatus,
  type ResourceSuggestionPreview,
  type ResourceType,
  type TaskResourceRequirement,
} from '@/lib/api/resources'
import { invalidateResourceQueries } from '@/lib/resource-query-invalidation'
import { resourceAdapter, type ResourceWorkbenchViewMode } from '@/lib/view-config/resource-adapter'

const resourceTypeLabels: Record<ResourceType, string> = {
  human: '人员',
  material: '物料',
  equipment: '设备',
  budget: '预算',
}

const statusLabels: Record<ResourceStatus, string> = {
  active: '活跃',
  inactive: '停用',
}

const loadLabels: Record<ResourceLoadStatus, string> = {
  idle: '空闲',
  available: '可用',
  full: '满载',
  overloaded: '过载',
  unavailable: '不可用',
}

function defaultWindow() {
  const from = new Date().toISOString().slice(0, 10)
  const to = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  return { from, to }
}

function normalizeViewMode(value: string | null | undefined): ResourceWorkbenchViewMode {
  if (value === 'requirements' || value === 'conflicts') return value
  return 'matrix'
}

export default function ProjectResourcesPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const customView = useCustomViewManager()
  const projectId = Number(params.id)
  const initialWindow = useMemo(defaultWindow, [])
  const [from, setFrom] = useState(() => searchParams.get('from') ?? initialWindow.from)
  const [to, setTo] = useState(() => searchParams.get('to') ?? initialWindow.to)
  const [roleFilter, setRoleFilter] = useState(() => searchParams.get('role') ?? '')
  const [skillFilter, setSkillFilter] = useState(() => searchParams.get('skill') ?? '')
  const [loadStatusFilter, setLoadStatusFilter] = useState<ResourceLoadStatus | ''>(
    () => (searchParams.get('loadStatus') as ResourceLoadStatus | null) ?? '',
  )
  const [viewMode, setViewMode] = useState<ResourceWorkbenchViewMode>(() =>
    normalizeViewMode(searchParams.get('mode')),
  )
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [showRequirementForm, setShowRequirementForm] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [role, setRole] = useState('frontend')
  const [allocationPercent, setAllocationPercent] = useState('50')
  const [preview, setPreview] = useState<ResourceSuggestionPreview | null>(null)
  const [selectedRequirementId, setSelectedRequirementId] = useState<number | null>(null)

  useEffect(() => {
    const config = customView.activeConfig
    if (!config || config.baseViewType !== 'resource') return
    setFrom(config.filters?.dateFrom ?? config.scope?.timeRange?.start ?? initialWindow.from)
    setTo(config.filters?.dateTo ?? config.scope?.timeRange?.end ?? initialWindow.to)
    setRoleFilter(String(config.filters?.roles?.[0] ?? ''))
    setSkillFilter(String(config.filters?.skills?.[0] ?? ''))
    setLoadStatusFilter((config.filters?.loadStatuses?.[0] as ResourceLoadStatus | undefined) ?? '')
    setViewMode(normalizeViewMode(config.display?.resourceViewMode))
  }, [customView.activeConfig, initialWindow.from, initialWindow.to])

  const replaceFilters = useCallback(
    (next: {
      from?: string
      to?: string
      role?: string
      skill?: string
      loadStatus?: string
      mode?: ResourceWorkbenchViewMode
    }) => {
      const paramsForUrl = new URLSearchParams(searchParams.toString())
      const values = {
        from,
        to,
        role: roleFilter,
        skill: skillFilter,
        loadStatus: loadStatusFilter,
        mode: viewMode,
        ...next,
      }
      for (const [key, value] of Object.entries(values)) {
        if (value) paramsForUrl.set(key, value)
        else paramsForUrl.delete(key)
      }
      const qs = paramsForUrl.toString()
      router.replace(
        qs ? `/projects/${projectId}/resources?${qs}` : `/projects/${projectId}/resources`,
      )
    },
    [
      from,
      loadStatusFilter,
      projectId,
      roleFilter,
      router,
      searchParams,
      skillFilter,
      to,
      viewMode,
    ],
  )

  const planningFilters = {
    from,
    to,
    ...(roleFilter ? { role: roleFilter } : {}),
    ...(skillFilter ? { skill: skillFilter } : {}),
    ...(loadStatusFilter ? { loadStatus: loadStatusFilter } : {}),
  }

  const currentViewConfig = useMemo(() => {
    const paramsForConfig = new URLSearchParams()
    paramsForConfig.set('from', from)
    paramsForConfig.set('to', to)
    if (roleFilter) paramsForConfig.set('role', roleFilter)
    if (skillFilter) paramsForConfig.set('skill', skillFilter)
    if (loadStatusFilter) paramsForConfig.set('loadStatus', loadStatusFilter)
    paramsForConfig.set('mode', viewMode)
    return resourceAdapter.capture(paramsForConfig, {
      viewMode,
      density: 'comfortable',
    })
  }, [from, loadStatusFilter, roleFilter, skillFilter, to, viewMode])

  const { data: resources, isLoading: resourcesLoading } = useQuery({
    queryKey: resourceKeys.lists(projectId),
    queryFn: () => resourcesApi.list(projectId, { perPage: 100 }),
  })

  const {
    data: planning,
    isLoading: planningLoading,
    error: planningError,
    refetch: refetchPlanning,
  } = useQuery({
    queryKey: resourcePlanningKeys.planning(projectId, planningFilters),
    queryFn: () => resourcesApi.planning(projectId, planningFilters),
  })

  const { data: conflicts } = useQuery({
    queryKey: resourcePlanningKeys.conflicts(projectId, planningFilters),
    queryFn: () => resourcesApi.conflicts(projectId, planningFilters),
  })

  const { data: requirements } = useQuery({
    queryKey: requirementKeys.list(projectId, {
      from,
      to,
      role: roleFilter || undefined,
      perPage: 50,
    }),
    queryFn: () =>
      resourcesApi.requirements(projectId, {
        from,
        to,
        role: roleFilter || undefined,
        perPage: 50,
      }),
  })

  const createRequirement = useMutation({
    mutationFn: () =>
      resourcesApi.createRequirement(projectId, {
        taskId: Number(taskId),
        role,
        allocationPercent: Number(allocationPercent),
        startDate: from,
        endDate: to,
        priority: 'medium',
      }),
    onSuccess: async () => {
      await invalidateResourceWorkspace(queryClient, projectId)
      setShowRequirementForm(false)
      setTaskId('')
      setAllocationPercent('50')
    },
  })

  const previewSuggestion = useMutation({
    mutationFn: (requirementId: number) =>
      resourcesApi.previewSuggestions(projectId, {
        from,
        to,
        allocationCandidates: [{ requirementId }],
      }),
    onSuccess: setPreview,
  })

  const applySuggestion = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error('缺少预览')
      return resourcesApi.applySuggestions(projectId, {
        confirm: true,
        previewHash: preview.previewHash,
        operations: preview.operations,
      })
    },
    onSuccess: async () => {
      setPreview(null)
      setSelectedRequirementId(null)
      await invalidateResourceWorkspace(queryClient, projectId)
    },
  })

  const openRequirements = requirements?.data.filter((item) => item.status === 'open') ?? []
  const activeRequirementId = selectedRequirementId ?? openRequirements[0]?.id ?? null
  const filteredResources = useMemo(() => {
    return (resources?.data ?? []).filter((resource) => {
      const roleMatches = !roleFilter || resource.role === roleFilter
      const skillMatches =
        !skillFilter ||
        parseTags(resource.skillTags).some((tag) =>
          tag.toLowerCase().includes(skillFilter.toLowerCase()),
        )
      return roleMatches && skillMatches
    })
  }, [resources?.data, roleFilter, skillFilter])

  if (resourcesLoading) {
    return (
      <div className="space-y-4 p-6" aria-busy="true">
        <BrandLoader size={56} label="正在载入项目资源…" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <PermissionGuard
      require="resource:view"
      fallback={<div className="p-6 text-muted-foreground">无权查看资源</div>}
    >
      <div className="space-y-6 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">资源工作台</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              统一查看项目资源、容量窗口、需求缺口和分配建议。建议预览不会修改正式数据。
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <DateField
              label="开始"
              value={from}
              onChange={(value) => {
                setFrom(value)
                replaceFilters({ from: value })
              }}
            />
            <DateField
              label="结束"
              value={to}
              onChange={(value) => {
                setTo(value)
                replaceFilters({ to: value })
              }}
            />
            <FilterField
              label="角色"
              value={roleFilter}
              placeholder="member"
              onChange={(value) => {
                setRoleFilter(value)
                replaceFilters({ role: value })
              }}
            />
            <FilterField
              label="技能"
              value={skillFilter}
              placeholder="React"
              onChange={(value) => {
                setSkillFilter(value)
                replaceFilters({ skill: value })
              }}
            />
            <LoadStatusFilter
              value={loadStatusFilter}
              onChange={(value) => {
                setLoadStatusFilter(value)
                replaceFilters({ loadStatus: value })
              }}
            />
            <ViewModeSwitch
              value={viewMode}
              onChange={(value) => {
                setViewMode(value)
                replaceFilters({ mode: value })
              }}
            />
            <Button variant="outline" onClick={() => setSaveDialogOpen(true)}>
              <Save className="mr-2 h-4 w-4" /> 保存视图
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push(`/projects/${projectId}/resources/load?view=team`)}
            >
              <BarChart3 className="mr-2 h-4 w-4" /> 负载视图
            </Button>
            <PermissionGuard require="resource:manage">
              <Button onClick={() => router.push(`/projects/${projectId}/resources/new`)}>
                <Plus className="mr-2 h-4 w-4" /> 添加资源
              </Button>
            </PermissionGuard>
          </div>
        </div>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="资源摘要">
          <SummaryMetric label="资源数" value={planning?.summary.totalResources ?? 0} />
          <SummaryMetric
            label="平均利用率"
            value={`${planning?.summary.averageUtilizationPercent ?? 0}%`}
            tone={(planning?.summary.averageUtilizationPercent ?? 0) > 100 ? 'danger' : 'neutral'}
          />
          <SummaryMetric
            label="过载资源"
            value={planning?.summary.overloadedResources ?? 0}
            tone={(planning?.summary.overloadedResources ?? 0) > 0 ? 'warning' : 'neutral'}
          />
          <SummaryMetric
            label="需求缺口"
            value={planning?.summary.unmetRequirements ?? 0}
            tone={(planning?.summary.unmetRequirements ?? 0) > 0 ? 'warning' : 'neutral'}
          />
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,0.9fr)]">
          <div className="space-y-6">
            <ResourceListCard
              projectId={projectId}
              resources={filteredResources}
              total={filteredResources.length}
              onOpen={(id) => router.push(`/projects/${projectId}/resources/${id}`)}
            />
            {viewMode === 'matrix' ? (
              <PlanningMatrixCard rows={planning?.matrix ?? []} loading={planningLoading} />
            ) : null}
            {planningError ? (
              <FailurePanel
                title="资源规划加载失败"
                description="保留已加载的资源列表，你可以重试当前窗口的规划计算。"
                onRetry={() => void refetchPlanning()}
              />
            ) : null}
          </div>

          <div className="space-y-6">
            {viewMode === 'requirements' || viewMode === 'matrix' ? (
              <RequirementCard
                requirements={requirements?.data ?? []}
                activeRequirementId={activeRequirementId}
                showForm={showRequirementForm}
                taskId={taskId}
                role={role}
                allocationPercent={allocationPercent}
                createPending={createRequirement.isPending}
                createError={createRequirement.error}
                onSelectRequirement={setSelectedRequirementId}
                onToggleForm={() => setShowRequirementForm((value) => !value)}
                onTaskIdChange={setTaskId}
                onRoleChange={setRole}
                onAllocationPercentChange={setAllocationPercent}
                onCreate={() => createRequirement.mutate()}
              />
            ) : null}
            <SuggestionCard
              activeRequirementId={activeRequirementId}
              preview={preview}
              previewPending={previewSuggestion.isPending}
              applyPending={applySuggestion.isPending}
              error={previewSuggestion.error ?? applySuggestion.error}
              onPreview={() => activeRequirementId && previewSuggestion.mutate(activeRequirementId)}
              onApply={() => applySuggestion.mutate()}
            />
            {viewMode === 'conflicts' || viewMode === 'matrix' ? (
              <ConflictCard conflicts={conflicts?.data ?? []} />
            ) : null}
          </div>
        </div>
        <SaveViewDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          projectId={projectId}
          baseViewType="resource"
          currentConfig={currentViewConfig}
        />
      </div>
    </PermissionGuard>
  )
}

function FailurePanel({
  title,
  description,
  onRetry,
}: {
  title: string
  description: string
  onRetry: () => void
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-danger/30 bg-danger-bg p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-danger">{title}</p>
          <p className="mt-1 text-sm text-gray-700">{description}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    </div>
  )
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <Input
        type="date"
        className="h-9 w-36"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

function FilterField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <Input
        className="h-9 w-32"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function LoadStatusFilter({
  value,
  onChange,
}: {
  value: ResourceLoadStatus | ''
  onChange: (value: ResourceLoadStatus | '') => void
}) {
  return (
    <label className="space-y-1 text-xs font-medium text-muted-foreground">
      <span>负载</span>
      <select
        className="h-9 w-28 rounded-[var(--radius-sm)] border border-input bg-background px-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value as ResourceLoadStatus | '')}
      >
        <option value="">全部</option>
        {Object.entries(loadLabels).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}

function ViewModeSwitch({
  value,
  onChange,
}: {
  value: ResourceWorkbenchViewMode
  onChange: (value: ResourceWorkbenchViewMode) => void
}) {
  const options: Array<{ value: ResourceWorkbenchViewMode; label: string }> = [
    { value: 'matrix', label: '矩阵' },
    { value: 'requirements', label: '需求' },
    { value: 'conflicts', label: '冲突' },
  ]
  return (
    <div className="space-y-1 text-xs font-medium text-muted-foreground">
      <span>视图</span>
      <div className="flex h-9 overflow-hidden rounded-[var(--radius-sm)] border border-input bg-background">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`px-3 text-sm ${
              value === option.value ? 'bg-primary-600 text-white' : 'text-gray-700 hover:bg-muted'
            }`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function SummaryMetric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  tone?: 'neutral' | 'warning' | 'danger'
}) {
  const toneClass =
    tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-gray-900'
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={`text-xl font-semibold ${toneClass}`}>{value}</span>
      </CardContent>
    </Card>
  )
}

function ResourceListCard({
  projectId,
  resources,
  total,
  onOpen,
}: {
  projectId: number
  resources: Resource[]
  total: number
  onOpen: (id: number) => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>项目资源 ({total})</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpen(resources[0]?.id ?? projectId)}
          disabled={!resources[0]}
        >
          查看详情
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>日产能</TableHead>
              <TableHead>技能标签</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resources.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState
                    icon={Users}
                    title="暂无资源，请添加"
                    description="添加人员或设备后，资源矩阵会按窗口计算容量与分配压力。"
                  />
                </TableCell>
              </TableRow>
            ) : (
              resources.map((resource) => {
                const tags = parseTags(resource.skillTags)
                return (
                  <TableRow
                    key={resource.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => onOpen(resource.id)}
                  >
                    <TableCell className="font-medium">{resource.name}</TableCell>
                    <TableCell>{resourceTypeLabels[resource.resourceType]}</TableCell>
                    <TableCell>{resource.role}</TableCell>
                    <TableCell>
                      <Badge variant={resource.status === 'active' ? 'success' : 'neutral'}>
                        {statusLabels[resource.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>{resource.dailyCapacityHours}h</TableCell>
                    <TableCell className="max-w-[240px] truncate">
                      {tags.join('、') || '-'}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function PlanningMatrixCard({
  rows,
  loading,
}: {
  rows: NonNullable<Awaited<ReturnType<typeof resourcesApi.planning>>>['matrix']
  loading: boolean
}) {
  const days = rows[0]?.days.slice(0, 10) ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>资源矩阵</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="p-4">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="当前窗口没有资源容量"
            description="调整日期窗口，或先添加项目资源。"
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-32">资源</TableHead>
                  <TableHead>状态</TableHead>
                  {days.map((day) => (
                    <TableHead key={day.date} className="min-w-20 text-center text-xs">
                      {day.date.slice(5)}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">窗口利用率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.resourceId}>
                    <TableCell>
                      <div className="font-medium">{row.resourceName}</div>
                      <div className="text-xs text-muted-foreground">{row.role}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={loadVariant(row.loadStatus)}>
                        {loadLabels[row.loadStatus]}
                      </Badge>
                    </TableCell>
                    {row.days.slice(0, 10).map((day) => (
                      <TableCell key={day.date} className="text-center">
                        <div className="mx-auto h-2 w-full max-w-16 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className={`h-full ${loadBarClass(day.loadPercent)}`}
                            style={{ width: `${Math.min(100, Math.max(0, day.loadPercent))}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {day.loadPercent}%
                        </span>
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-medium">
                      {row.utilizationPercent}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RequirementCard(props: {
  requirements: TaskResourceRequirement[]
  activeRequirementId: number | null
  showForm: boolean
  taskId: string
  role: string
  allocationPercent: string
  createPending: boolean
  createError: unknown
  onSelectRequirement: (id: number) => void
  onToggleForm: () => void
  onTaskIdChange: (value: string) => void
  onRoleChange: (value: string) => void
  onAllocationPercentChange: (value: string) => void
  onCreate: () => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>任务资源需求</CardTitle>
        <PermissionGuard require="resource:manage">
          <Button size="sm" onClick={props.onToggleForm}>
            <Plus className="mr-1 h-3 w-3" /> 新增需求
          </Button>
        </PermissionGuard>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.showForm && (
          <div className="rounded-[var(--radius-md)] border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_120px]">
              <Field label="任务 ID" value={props.taskId} onChange={props.onTaskIdChange} />
              <Field label="角色" value={props.role} onChange={props.onRoleChange} />
              <Field
                label="比例 %"
                value={props.allocationPercent}
                onChange={props.onAllocationPercentChange}
                type="number"
              />
            </div>
            {props.createError ? (
              <p className="mt-2 text-sm text-danger">创建失败，请检查任务 ID 和日期窗口。</p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={props.onCreate}
                disabled={!props.taskId.trim() || props.createPending}
              >
                {props.createPending ? '提交中…' : '创建需求'}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {props.requirements.length === 0 ? (
            <EmptyState
              icon={Users}
              title="当前窗口没有资源需求"
              description="可先为任务添加角色或技能需求，再让系统生成候选分配。"
            />
          ) : (
            props.requirements.slice(0, 6).map((requirement) => (
              <button
                key={requirement.id}
                type="button"
                onClick={() => props.onSelectRequirement(requirement.id)}
                className={`w-full rounded-[var(--radius-md)] border p-3 text-left transition-colors ${
                  props.activeRequirementId === requirement.id
                    ? 'border-primary-200 bg-primary-50'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">任务 #{requirement.taskId}</span>
                  <Badge variant={requirement.status === 'open' ? 'warning' : 'neutral'}>
                    {requirement.status}
                  </Badge>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {requirement.role} · {requirement.allocationPercent ?? '-'}% ·{' '}
                  {requirement.startDate} ~ {requirement.endDate}
                </div>
              </button>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function SuggestionCard({
  activeRequirementId,
  preview,
  previewPending,
  applyPending,
  error,
  onPreview,
  onApply,
}: {
  activeRequirementId: number | null
  preview: ResourceSuggestionPreview | null
  previewPending: boolean
  applyPending: boolean
  error: unknown
  onPreview: () => void
  onApply: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-ai" /> 分配建议
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          先预览候选分配，确认后才会写入正式资源分配。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!activeRequirementId || previewPending}
            onClick={onPreview}
          >
            {previewPending ? '生成中…' : '预览建议'}
          </Button>
          <PermissionGuard require="resource:manage">
            <Button size="sm" disabled={!preview || applyPending} onClick={onApply}>
              <CheckCircle2 className="mr-1 h-3 w-3" />
              {applyPending ? '采纳中…' : '确认采纳'}
            </Button>
          </PermissionGuard>
        </div>
        {preview ? (
          <div className="rounded-[var(--radius-md)] border border-border bg-ai-bg p-3 text-sm">
            <div className="font-medium text-gray-800">
              {preview.operations.length} 项候选操作 · 写入状态：未写入
            </div>
            <div className="mt-1 text-muted-foreground">
              事实源：{preview.deterministicFacts.source} · hash {preview.previewHash.slice(0, 8)}
            </div>
          </div>
        ) : null}
        {error ? <p className="text-sm text-danger">建议处理失败，请刷新后重试。</p> : null}
      </CardContent>
    </Card>
  )
}

function ConflictCard({
  conflicts,
}: {
  conflicts: NonNullable<Awaited<ReturnType<typeof resourcesApi.conflicts>>>['data']
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" /> 冲突清单
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {conflicts.length === 0 ? (
          <p className="text-sm text-muted-foreground">当前窗口未发现资源冲突。</p>
        ) : (
          conflicts.slice(0, 6).map((conflict, index) => (
            <div
              key={`${conflict.type}-${index}`}
              className="rounded-[var(--radius-md)] border border-border p-3"
            >
              <Badge variant={conflict.severity === 'error' ? 'danger' : 'warning'}>
                {resourceConflictTypeLabel(conflict.type)}
              </Badge>
              <p className="mt-2 text-sm">{conflict.message}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function parseTags(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function loadVariant(status: ResourceLoadStatus) {
  if (status === 'overloaded' || status === 'unavailable') return 'danger'
  if (status === 'full') return 'warning'
  if (status === 'available') return 'success'
  return 'neutral'
}

function loadBarClass(percent: number) {
  if (percent > 100) return 'bg-danger'
  if (percent > 80) return 'bg-warning'
  if (percent > 0) return 'bg-success'
  return 'bg-gray-200'
}

async function invalidateResourceWorkspace(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: number,
) {
  await invalidateResourceQueries(queryClient, projectId)
}
