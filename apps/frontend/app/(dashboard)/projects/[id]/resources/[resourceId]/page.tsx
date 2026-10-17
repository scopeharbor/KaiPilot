'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, BarChart3, Plus, Trash2 } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useState } from 'react'
import PermissionGuard from '@/components/PermissionGuard'
import { Alert } from '@/components/ui/Alert'
import { BrandLoader } from '@/components/ui/BrandLogo'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import {
  allocationKeys,
  allocationsApi,
  availabilityApi,
  availabilityKeys,
  resourceKeys,
  resourcesApi,
  type ResourceAvailabilityException,
  type ResourceAllocation,
  type ResourceType,
  type AllocationType,
} from '@/lib/api/resources'
import type { DateAllocationSummary } from '@/lib/api/resources'
import { invalidateResourceQueries } from '@/lib/resource-query-invalidation'
import { useAuthStore } from '@/stores/auth-store'

const resourceTypeLabels: Record<ResourceType, string> = {
  human: '人员',
  material: '物料',
  equipment: '设备',
  budget: '预算',
}

const allocationTypeLabels: Record<AllocationType, string> = {
  assigned: '指派',
  allocated: '分配',
  reserved: '预留',
}

export default function ResourceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const projectId = Number(params.id)
  const resourceId = Number(params.resourceId)
  const [tab, setTab] = useState('info')
  const currentUserId = useAuthStore((state) => state.user?.id ?? null)

  const {
    data: res,
    isLoading,
    error,
  } = useQuery({
    queryKey: resourceKeys.detail(projectId, resourceId),
    queryFn: () => resourcesApi.get(projectId, resourceId),
  })

  const resource = res?.data

  const { data: allocData } = useQuery({
    queryKey: allocationKeys.lists(projectId, resourceId),
    queryFn: () => allocationsApi.list(projectId, resourceId, { perPage: 50 }),
  })

  const { data: availabilityData } = useQuery({
    queryKey: availabilityKeys.list(projectId, resourceId),
    queryFn: () => availabilityApi.list(projectId, resourceId, { perPage: 50 }),
  })

  const deleteResource = useMutation({
    mutationFn: () => resourcesApi.delete(projectId, resourceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourceKeys.lists(projectId) })
      void queryClient.invalidateQueries({ queryKey: resourceKeys.all })
      router.push(`/projects/${projectId}/resources`)
    },
  })

  if (isLoading)
    return (
      <div className="space-y-4 p-6" aria-busy="true">
        <BrandLoader size={56} label="正在载入资源详情…" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  if (error || !resource) return <Alert className="m-6">资源不存在或加载失败</Alert>

  return (
    <PermissionGuard
      require="resource:view"
      fallback={<div className="p-6 text-muted-foreground">无权查看</div>}
    >
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push(`/projects/${projectId}/resources`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{resource.name}</h1>
              <p className="text-sm text-muted-foreground">
                {resourceTypeLabels[resource.resourceType]} · {resource.role} ·{' '}
                {resource.status === 'active' ? '活跃' : '停用'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <PermissionGuard require="resource:view">
              <Button variant="outline" onClick={() => setTab('load')}>
                <BarChart3 className="mr-2 h-4 w-4" /> 负载
              </Button>
            </PermissionGuard>
            <PermissionGuard require="resource:manage">
              <Button
                variant="danger"
                onClick={() => {
                  if (confirm('确认删除？')) deleteResource.mutate()
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" /> 删除
              </Button>
            </PermissionGuard>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="info">基本信息</TabsTrigger>
            <TabsTrigger value="allocations">分配 ({allocData?.meta?.total ?? 0})</TabsTrigger>
            <TabsTrigger value="availability">
              可用性 ({availabilityData?.meta?.total ?? 0})
            </TabsTrigger>
            <TabsTrigger value="load">负载</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>详情</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">邮箱</Label>
                  <p>{resource.email ?? '-'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">日产能</Label>
                  <p>{resource.dailyCapacityHours} 小时</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">时区</Label>
                  <p>{resource.timezone}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">工作日</Label>
                  <p>{resource.workDays}</p>
                </div>
                {resource.skillTags && (
                  <div className="col-span-2">
                    <Label className="text-muted-foreground">技能标签</Label>
                    <p>{resource.skillTags}</p>
                  </div>
                )}
                {resource.costPerUnitCents != null && (
                  <div>
                    <Label className="text-muted-foreground">单位成本</Label>
                    <p>{(resource.costPerUnitCents / 100).toFixed(2)} 元</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="allocations">
            <AllocationsTab
              projectId={projectId}
              resourceId={resourceId}
              allocations={allocData?.data ?? []}
            />
          </TabsContent>

          <TabsContent value="availability">
            <AvailabilityTab
              projectId={projectId}
              resourceId={resourceId}
              exceptions={availabilityData?.data ?? []}
              canSelfEdit={resource.userId !== null && resource.userId === currentUserId}
            />
          </TabsContent>

          <TabsContent value="load">
            <LoadTab projectId={projectId} resourceId={resourceId} />
          </TabsContent>
        </Tabs>
      </div>
    </PermissionGuard>
  )
}

function AvailabilityTab({
  projectId,
  resourceId,
  exceptions,
  canSelfEdit,
}: {
  projectId: number
  resourceId: number
  exceptions: ResourceAvailabilityException[]
  canSelfEdit: boolean
}) {
  const queryClient = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const [showForm, setShowForm] = useState(false)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [capacityOverrideHours, setCapacityOverrideHours] = useState('0')
  const [reason, setReason] = useState('')

  const create = useMutation({
    mutationFn: () =>
      availabilityApi.create(projectId, resourceId, {
        startDate,
        endDate,
        capacityOverrideHours: Number(capacityOverrideHours),
        reason,
        status: 'planned',
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: availabilityKeys.list(projectId, resourceId) }),
        invalidateResourceQueries(queryClient, projectId),
      ])
      setShowForm(false)
      setCapacityOverrideHours('0')
      setReason('')
    },
  })

  const del = useMutation({
    mutationFn: (id: number) => availabilityApi.delete(projectId, resourceId, id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: availabilityKeys.list(projectId, resourceId) }),
        invalidateResourceQueries(queryClient, projectId),
      ])
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">可用性例外</h3>
        <AvailabilityEditGate canSelfEdit={canSelfEdit}>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            <Plus className="mr-1 h-3 w-3" /> 添加例外
          </Button>
        </AvailabilityEditGate>
      </div>

      {showForm && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="grid gap-3 md:grid-cols-[140px_140px_120px_1fr]">
              <div className="space-y-1">
                <Label className="text-xs">开始日期</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">结束日期</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">容量(h)</Label>
                <Input
                  type="number"
                  min={0}
                  max={24}
                  value={capacityOverrideHours}
                  onChange={(e) => setCapacityOverrideHours(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">原因</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            </div>
            {create.error ? (
              <p className="text-sm text-danger">保存失败，请检查日期和原因。</p>
            ) : null}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => create.mutate()}
                disabled={!reason.trim() || create.isPending}
              >
                {create.isPending ? '保存中…' : '保存例外'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>日期</TableHead>
            <TableHead>容量覆写</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>原因</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {exceptions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                暂无可用性例外
              </TableCell>
            </TableRow>
          ) : (
            exceptions.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  {item.startDate} ~ {item.endDate}
                </TableCell>
                <TableCell>{item.capacityOverrideHours}h</TableCell>
                <TableCell>{item.status}</TableCell>
                <TableCell>{item.reason}</TableCell>
                <TableCell>
                  <AvailabilityEditGate canSelfEdit={canSelfEdit}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm('删除可用性例外？')) del.mutate(item.id)
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </AvailabilityEditGate>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function AvailabilityEditGate({
  canSelfEdit,
  children,
}: {
  canSelfEdit: boolean
  children: ReactNode
}) {
  if (canSelfEdit) return <>{children}</>
  return <PermissionGuard require="resource:manage">{children}</PermissionGuard>
}

function LoadTab({ projectId, resourceId }: { projectId: number; resourceId: number }) {
  const today = new Date().toISOString().slice(0, 10)
  const weekLater = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  const { data, isLoading } = useQuery({
    queryKey: resourceKeys.load(projectId, {
      from: today,
      to: weekLater,
      view: 'team',
      resourceId,
    }),
    queryFn: () =>
      resourcesApi.load(projectId, { from: today, to: weekLater, view: 'team', resourceId }),
  })

  if (isLoading) return <Skeleton className="h-32 w-full" />
  const loadResult =
    data && 'resources' in data
      ? (
          data as {
            resources: { days: DateAllocationSummary[]; overallUtilizationPercent: number }[]
          }
        ).resources[0]
      : null
  if (!loadResult) return <p className="text-muted-foreground">暂无负载数据</p>

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          负载概览 ({today} ~ {weekLater})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-4">
          <span className="text-sm">综合利用率: </span>
          <span
            className={`text-lg font-bold ${loadResult.overallUtilizationPercent > 100 ? 'text-red-500' : loadResult.overallUtilizationPercent > 80 ? 'text-yellow-500' : 'text-green-500'}`}
          >
            {loadResult.overallUtilizationPercent}%
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {loadResult.days.map((d: DateAllocationSummary) => {
            const pct = d.totalAllocatedPercent
            const color =
              pct > 100
                ? 'bg-red-400'
                : pct > 80
                  ? 'bg-yellow-400'
                  : pct > 0
                    ? 'bg-green-400'
                    : 'bg-gray-100'
            return (
              <div key={d.date} className="flex flex-col items-center">
                <div className={`h-8 w-full rounded ${color}`} title={`${d.date}: ${pct}%`} />
                <span className="mt-1 text-[10px] text-muted-foreground">{d.date.slice(5)}</span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function AllocationsTab({
  projectId,
  resourceId,
  allocations,
}: {
  projectId: number
  resourceId: number
  allocations: ResourceAllocation[]
}) {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [allocPercent, setAllocPercent] = useState('100')

  const create = useMutation({
    mutationFn: () =>
      allocationsApi.create(projectId, resourceId, {
        taskId: Number(taskId),
        allocationPercent: Number(allocPercent),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: allocationKeys.lists(projectId, resourceId) })
      void invalidateResourceQueries(queryClient, projectId)
      setShowForm(false)
      setTaskId('')
      setAllocPercent('100')
    },
  })

  const del = useMutation({
    mutationFn: (id: number) => allocationsApi.delete(projectId, resourceId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: allocationKeys.lists(projectId, resourceId) })
      void invalidateResourceQueries(queryClient, projectId)
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">任务分配</h3>
        <PermissionGuard require="resource:manage">
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            <Plus className="mr-1 h-3 w-3" /> 添加分配
          </Button>
        </PermissionGuard>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">任务 ID</Label>
                <Input
                  placeholder="任务 ID"
                  value={taskId}
                  onChange={(e) => setTaskId(e.target.value)}
                />
              </div>
              <div className="w-24 space-y-1">
                <Label className="text-xs">比例 %</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={allocPercent}
                  onChange={(e) => setAllocPercent(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => create.mutate()}
                disabled={!taskId.trim() || create.isPending}
              >
                {create.isPending ? '创建...' : '确认'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>任务 ID</TableHead>
            <TableHead>比例</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>开始</TableHead>
            <TableHead>结束</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {allocations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                暂无分配
              </TableCell>
            </TableRow>
          ) : (
            allocations.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.taskId}</TableCell>
                <TableCell>{a.allocationPercent}%</TableCell>
                <TableCell>{allocationTypeLabels[a.allocationType]}</TableCell>
                <TableCell>{a.startDate ?? '-'}</TableCell>
                <TableCell>{a.endDate ?? '-'}</TableCell>
                <TableCell>
                  <PermissionGuard require="resource:manage">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm('删除分配？')) del.mutate(a.id)
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </PermissionGuard>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
