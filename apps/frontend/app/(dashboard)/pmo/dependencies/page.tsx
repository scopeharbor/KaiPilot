'use client'

// 跨项目依赖 CRUD + 图谱工作台（v3-multi-project-dependency-crud §8.4-8.8 + v3-multi-project-dependency-graph §5）

import { useMemo, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useOrganizationId } from '@/hooks/use-organization-id'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useMpdList,
  useMpdDetail,
  useMpdCreatePreview,
  useMpdConfirmCreate,
  useMpdUpdatePreview,
  useMpdConfirmUpdate,
  useMpdArchivePreview,
  useMpdConfirmArchive,
  useMpdRestorePreview,
  useMpdConfirmRestore,
  useMpdDeletePreview,
  useMpdConfirmDelete,
} from '@/hooks/use-multi-project-dependencies'
import { useMpdGraph } from '@/hooks/use-multi-project-dependencies'
import MultiProjectDependencyGraph from '@/components/views/pmo/MultiProjectDependencyGraph'
import type {
  DepListFilters,
  MultiProjectDependency,
  MultiProjectDependencyCategory,
  MultiProjectDependencyPreview,
  MultiProjectDependencyRiskLevel,
  MultiProjectDependencyStatus,
  MultiProjectDependencyType,
  MultiProjectEndpointRef,
  MultiProjectGraphQuery,
  MultiProjectGraphResponse,
  GraphViewMode,
  GraphLayoutMode,
  GraphSelectedRef,
} from '@aiproj/types'
import { normalizeGraphViewFilters, isValidGraphViewMode } from '@aiproj/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/Alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/Sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
import { AlertCircle, Plus, Archive, RotateCcw, Trash2, Eye, List, GitGraph } from 'lucide-react'

// ── 从 URL 读取视图模式 ──
function useViewFromUrl(searchParams: URLSearchParams): GraphViewMode {
  const raw = searchParams.get('view')
  if (raw && isValidGraphViewMode(raw)) return raw as GraphViewMode
  return 'list'
}

// ── 后端真实契约读取（本页无 mpd-adapter 归一保护） ──
// 3.4 收敛 api 泛型后，list/detail 的解包结果就是后端 depRowToContract 的产物：
// 嵌套 providerEndpoint/consumerEndpoint、数字 id、riskLevel（共享 DTO 与它的形状漂移
// 见 design §7 第 12 条，本 change 不重写 DTO）。故这里按真实契约命名读取，
// 并保留旧 CRUD DTO 的 provider/consumer/risk 兜底——页面既有测试的 mock 仍按旧形态构造。
type MpdEndpoint = Partial<MultiProjectEndpointRef> & {
  /** 旧 CRUD DTO（DepEndpointSummary）形态 */
  label?: string
  isRedacted?: boolean
}

type MpdDepRow = MultiProjectDependency & {
  /** 旧 CRUD DTO（DepListItem/DepDetail）形态 */
  provider?: MpdEndpoint
  consumer?: MpdEndpoint
  risk?: string
}

function endpointOf(row: MpdDepRow, side: 'provider' | 'consumer'): MpdEndpoint | undefined {
  return side === 'provider'
    ? (row.providerEndpoint ?? row.provider)
    : (row.consumerEndpoint ?? row.consumer)
}

/**
 * 端点展示标签：脱敏一律显示 ***。
 * 真实契约（MultiProjectEndpointRef）没有 label，按端点类型取名称字段；
 * 旧 CRUD DTO 形态（DepEndpointSummary）的 label 就是它的展示值，且真实行不会带 label，
 * 故 label 存在时以它为准。
 */
function endpointLabel(endpoint: MpdEndpoint | undefined): string {
  if (!endpoint) return '—'
  if (endpoint.redacted === true || endpoint.isRedacted === true) return '***'
  return (
    endpoint.label ??
    endpoint.taskName ??
    endpoint.milestoneName ??
    endpoint.projectName ??
    endpoint.externalLabel ??
    '—'
  )
}

/** 风险等级：真实契约为 riskLevel，旧 CRUD DTO 为 risk。 */
function rowRisk(row: MpdDepRow): string {
  return row.riskLevel ?? row.risk ?? ''
}

export default function MultiProjectDependenciesWorkbench() {
  // 组织未解析出来时用 0 占位：下游 hook 均以 enabled: Boolean(orgId) 禁用查询。
  const orgId = useOrganizationId() ?? 0
  const router = useRouter()
  const searchParams = useSearchParams()
  const { canAny } = usePermissions()

  // 视图模式：list | graph
  const viewMode = useViewFromUrl(searchParams)

  // 从 URL 恢复过滤器：URL 仍沿用页面自己的键名（projectScope/risk），
  // 字段名与取值以后端 validator 对齐后的 DepListFilters 为准（3.2）。
  const filters: DepListFilters = useMemo(
    () => ({
      projectIds: searchParams
        .get('projectScope')
        ?.split(',')
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0),
      status: searchParams.get('status')?.split(',').filter(Boolean) as
        MultiProjectDependencyStatus[] | undefined,
      riskLevel: (searchParams.get('risk') ?? undefined) as
        MultiProjectDependencyRiskLevel | undefined,
      type: (searchParams.get('type') ?? undefined) as MultiProjectDependencyType | undefined,
      category: (searchParams.get('category') ?? undefined) as
        MultiProjectDependencyCategory | undefined,
      dateFrom: searchParams.get('dateFrom') ?? undefined,
      dateTo: searchParams.get('dateTo') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      page: Number(searchParams.get('page')) || 1,
      perPage: Number(searchParams.get('perPage')) || 20,
      sort: searchParams.get('sort') ?? '-createdAt',
    }),
    [searchParams],
  )

  const { data, isLoading, isError, error } = useMpdList(orgId, filters)

  // 列表行按后端真实契约读取（DepListItem 的 provider/risk 是另一套形状，见 design §7 第 12 条）。
  const rows = (data?.data ?? []) as unknown as MpdDepRow[]

  // ── 图谱查询 （从 URL 恢复，与列表筛选器共享 project/status/risk/category） ──
  const graphQuery: MultiProjectGraphQuery | null = useMemo(() => {
    if (viewMode !== 'graph') return null
    const graphFilters = normalizeGraphViewFilters({
      projectScope: filters.projectIds ?? [],
      // 列表筛选器已与图谱同源（3.2 对齐后的 MultiProjectDependency* 枚举），按 URL 原值透传由后端裁决。
      category: filters.category,
      status: filters.status,
      risk: filters.riskLevel,
      depth: searchParams.get('depth') ? Number(searchParams.get('depth')) : 3,
      nodeLimit: searchParams.get('nodeLimit') ? Number(searchParams.get('nodeLimit')) : 200,
      edgeLimit: searchParams.get('edgeLimit') ? Number(searchParams.get('edgeLimit')) : 500,
      freshnessThreshold:
        (searchParams.get('freshness') as 'fresh' | 'stale' | 'all' | null) ?? 'all',
      layoutMode: (searchParams.get('layoutMode') as GraphLayoutMode) ?? 'layered',
    })
    return {
      projectIds: graphFilters.projectScope,
      endpointType: undefined,
      category: graphFilters.category,
      status: graphFilters.status,
      riskLevel: graphFilters.risk,
      maxDepth: graphFilters.depth,
      nodeLimit: graphFilters.nodeLimit,
      edgeLimit: graphFilters.edgeLimit,
      freshnessThreshold: graphFilters.freshnessThreshold,
    }
  }, [viewMode, searchParams, filters])

  const {
    data: graphData,
    isLoading: graphLoading,
    isError: graphError,
    error: graphErrorObj,
  } = useMpdGraph(orgId, graphQuery, viewMode === 'graph')

  // 3.4 之后 useMpdGraph 的 data 已是解包后的裸响应（MultiProjectGraphResponse）；
  // 旧信封形态（{ data: … }）仅为兼容既有 mock 保留一层读取。
  const graphResponse = useMemo<MultiProjectGraphResponse | null>(() => {
    if (!graphData) return null
    const raw = graphData as MultiProjectGraphResponse & {
      data?: MultiProjectGraphResponse | null
    }
    return Array.isArray(raw.nodes) ? raw : (raw.data ?? null)
  }, [graphData])

  // ── 图谱选中状态 ──
  const [graphSelectedRef, setGraphSelectedRef] = useState<GraphSelectedRef | null>(null)
  const [preview, setPreview] = useState<MultiProjectDependencyPreview | null>(null)
  const [confirmResult, setConfirmResult] = useState<MultiProjectDependency | null>(null)
  const [_showCreateDialog, setShowCreateDialog] = useState(false)
  const [showDetailSheet, setShowDetailSheet] = useState(false)
  const [selectedDepId, setSelectedDepId] = useState<string | null>(null)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState('')

  // ── Mutations ──
  useMpdCreatePreview(orgId)
  const confirmCreate = useMpdConfirmCreate(orgId)
  useMpdUpdatePreview(orgId)
  const confirmUpdate = useMpdConfirmUpdate(orgId)
  const archivePreview = useMpdArchivePreview(orgId)
  const confirmArchive = useMpdConfirmArchive(orgId)
  const restorePreview = useMpdRestorePreview(orgId)
  const confirmRestore = useMpdConfirmRestore(orgId)
  const deletePreview = useMpdDeletePreview(orgId)
  const confirmDelete = useMpdConfirmDelete(orgId)

  // ── 权限检查 ──
  const canManage = canAny(['dependency.manage', 'pmo'])
  const canView = canAny(['dependency.view', 'dependency.manage', 'pmo'])

  // ── 功能禁用 ──
  if (isError && (error as { code?: string } | null)?.code === 'FEATURE_DISABLED') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>跨项目依赖管理</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="danger">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>功能未启用</AlertTitle>
            <AlertDescription>跨项目依赖 CRUD 功能当前已禁用。</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  // ── 无权限 ──
  if (!canView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>跨项目依赖管理</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>无权限</AlertTitle>
            <AlertDescription>你没有查看跨项目依赖的权限。</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  // ── 状态标签 ──
  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-800',
      archived: 'bg-gray-100 text-gray-800',
      deleted: 'bg-red-100 text-red-800',
    }
    return <Badge className={colors[status] ?? ''}>{status}</Badge>
  }

  const riskBadge = (risk: string) => {
    const colors: Record<string, string> = {
      none: 'bg-gray-100 text-gray-600',
      low: 'bg-blue-100 text-blue-800',
      medium: 'bg-yellow-100 text-yellow-800',
      high: 'bg-orange-100 text-orange-800',
      critical: 'bg-red-100 text-red-800',
    }
    return <Badge className={colors[risk] ?? ''}>{risk}</Badge>
  }

  // ── 处理确认 ──
  const handleConfirm = useCallback(
    async (mutation: typeof confirmCreate, p: MultiProjectDependencyPreview) => {
      const result = await mutation.mutateAsync({
        previewId: p.previewId,
        confirmationHash: p.confirmationHash,
        idempotencyKey: idempotencyKey || `mpd-${Date.now()}`,
      })
      // confirm 端点只回依赖实体本身（controller 透传 service 的 result.data，
      // 幂等重放标记不随响应下发），故不再按 DepConfirmResult 的信封读 result.data。
      setConfirmResult(result as unknown as MultiProjectDependency)
      setPreview(null)
      setShowPreviewDialog(false)
    },
    [idempotencyKey],
  )

  return (
    <div className="space-y-6 p-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">跨项目依赖管理</h1>
          <p className="text-sm text-muted-foreground">管理组织级跨项目依赖事实</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 视图切换 */}
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === 'list' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString())
                params.set('view', 'list')
                router.push(`?${params.toString()}`)
              }}
            >
              <List className="mr-1 h-4 w-4" />
              列表
            </Button>
            <Button
              variant={viewMode === 'graph' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString())
                params.set('view', 'graph')
                router.push(`?${params.toString()}`)
              }}
            >
              <GitGraph className="mr-1 h-4 w-4" />
              图谱
            </Button>
          </div>
          {canManage && viewMode === 'list' && (
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              新建依赖
            </Button>
          )}
        </div>
      </div>

      {/* 过滤器 */}
      <Card>
        <CardContent className="flex flex-wrap gap-3 pt-6">
          <Input
            placeholder="搜索..."
            className="max-w-[200px]"
            defaultValue={filters.search}
            onChange={(e) => {
              const params = new URLSearchParams(searchParams.toString())
              if (e.target.value) params.set('search', e.target.value)
              else params.delete('search')
              router.push(`?${params.toString()}`)
            }}
          />
          <Select
            defaultValue={filters.status?.[0] ?? 'all'}
            onValueChange={(v) => {
              const params = new URLSearchParams(searchParams.toString())
              if (v !== 'all') params.set('status', v)
              else params.delete('status')
              router.push(`?${params.toString()}`)
            }}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="active">活跃</SelectItem>
              <SelectItem value="archived">已归档</SelectItem>
            </SelectContent>
          </Select>
          <Select
            defaultValue={filters.riskLevel ?? 'all'}
            onValueChange={(v) => {
              const params = new URLSearchParams(searchParams.toString())
              if (v !== 'all') params.set('risk', v)
              else params.delete('risk')
              router.push(`?${params.toString()}`)
            }}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="风险等级" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部风险</SelectItem>
              <SelectItem value="critical">严重</SelectItem>
              <SelectItem value="high">高</SelectItem>
              <SelectItem value="medium">中</SelectItem>
              <SelectItem value="low">低</SelectItem>
              <SelectItem value="none">无</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* ── 内容区域 ── */}
      {viewMode === 'graph' ? (
        /* ── 图谱视图 ── */
        <MultiProjectDependencyGraph
          response={graphResponse}
          layoutMode={(searchParams.get('layoutMode') as GraphLayoutMode) ?? 'layered'}
          isLoading={graphLoading}
          isError={graphError}
          errorMessage={(graphErrorObj as { message?: string } | null)?.message}
          isEmpty={!graphResponse || graphResponse.nodes.length === 0}
          isFeatureDisabled={
            (graphErrorObj as { code?: string } | null)?.code === 'FEATURE_DISABLED'
          }
          isNoPermission={(graphErrorObj as { code?: string } | null)?.code === 'PERMISSION_DENIED'}
          onSelectNode={(nodeId) => setGraphSelectedRef({ type: 'node', nodeId })}
          onSelectEdge={(edgeId) => setGraphSelectedRef({ type: 'edge', edgeId })}
          onStartImpactHandoff={(handoff) => {
            // §5.8 只读影响分析交接：携带有界 source ref 进入 impact analysis plan
            const params = new URLSearchParams()
            params.set('impactSource', handoff.sourceType)
            params.set('impactSourceId', String(handoff.sourceId))
            params.set('impactSourceLabel', handoff.sourceLabel)
            router.push(`/pmo/impact-analysis?${params.toString()}`)
          }}
          selectedRef={graphSelectedRef}
          organizationId={orgId}
        />
      ) : (
        /* ── 列表视图 ── */
        <>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <Alert variant="danger">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>加载失败</AlertTitle>
              <AlertDescription>{(error as Error).message ?? '未知错误'}</AlertDescription>
            </Alert>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <p className="text-muted-foreground">暂无跨项目依赖记录</p>
                {canManage && (
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => setShowCreateDialog(true)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    创建第一条依赖
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {/* 桌面表格 */}
              <div className="hidden md:block rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>提供者</TableHead>
                      <TableHead>消费者</TableHead>
                      <TableHead>分类</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>风险</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((dep) => (
                      <TableRow key={dep.id}>
                        <TableCell className="max-w-[150px] truncate">
                          {endpointLabel(endpointOf(dep, 'provider'))}
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {endpointLabel(endpointOf(dep, 'consumer'))}
                        </TableCell>
                        <TableCell>{dep.category}</TableCell>
                        <TableCell>{dep.type}</TableCell>
                        <TableCell>{statusBadge(dep.status)}</TableCell>
                        <TableCell>{riskBadge(rowRisk(dep))}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedDepId(String(dep.id))
                                setShowDetailSheet(true)
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {canManage && dep.status === 'active' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  const p = await archivePreview.mutateAsync(String(dep.id))
                                  setPreview(p as unknown as MultiProjectDependencyPreview)
                                  setShowPreviewDialog(true)
                                }}
                              >
                                <Archive className="h-4 w-4" />
                              </Button>
                            )}
                            {canManage && dep.status === 'archived' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={async () => {
                                    const p = await restorePreview.mutateAsync(String(dep.id))
                                    setPreview(p as unknown as MultiProjectDependencyPreview)
                                    setShowPreviewDialog(true)
                                  }}
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={async () => {
                                    const p = await deletePreview.mutateAsync(String(dep.id))
                                    setPreview(p as unknown as MultiProjectDependencyPreview)
                                    setShowPreviewDialog(true)
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* 移动端列表 */}
              <div className="md:hidden space-y-3">
                {rows.map((dep) => (
                  <Card key={dep.id}>
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium truncate max-w-[200px]">
                          {endpointLabel(endpointOf(dep, 'provider'))}
                        </span>
                        {statusBadge(dep.status)}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        <span>{dep.category}</span>
                        <span>·</span>
                        <span>{dep.type}</span>
                        <span>·</span>
                        {riskBadge(rowRisk(dep))}
                      </div>
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedDepId(String(dep.id))
                            setShowDetailSheet(true)
                          }}
                        >
                          查看
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* 分页信息 */}
              {data?.meta && (
                <div className="text-sm text-muted-foreground text-center">
                  共 {data.meta.total} 条，第 {data.meta.page}/{data.meta.totalPages} 页
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* 详情抽屉 */}
      <Sheet open={showDetailSheet} onOpenChange={setShowDetailSheet}>
        <SheetContent className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle>依赖详情</SheetTitle>
            <SheetDescription>跨项目依赖的详细信息</SheetDescription>
          </SheetHeader>
          {selectedDepId && <MpdDetailPanel depId={selectedDepId} orgId={orgId} />}
        </SheetContent>
      </Sheet>

      {/* 预览确认对话框 */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认操作</DialogTitle>
            <DialogDescription>
              {preview?.warningCodes.length ? (
                <span className="text-amber-600">警告: {preview.warningCodes.join(', ')}</span>
              ) : (
                '预览已生成，请确认执行'
              )}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="font-medium">操作:</span> {preview.operation}
              </div>
              <div className="text-sm">
                <span className="font-medium">过期时间:</span>{' '}
                {new Date(preview.expiresAt).toLocaleString()}
              </div>
              <Input
                placeholder="幂等键（可选）"
                value={idempotencyKey}
                onChange={(e) => setIdempotencyKey(e.target.value)}
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowPreviewDialog(false)}>
                  取消
                </Button>
                <Button
                  onClick={() => {
                    const previewOp = preview.operation
                    if (previewOp.includes('create')) handleConfirm(confirmCreate, preview)
                    else if (previewOp.includes('update')) handleConfirm(confirmUpdate, preview)
                    else if (previewOp.includes('archive')) handleConfirm(confirmArchive, preview)
                    else if (previewOp.includes('restore')) handleConfirm(confirmRestore, preview)
                    else if (previewOp.includes('delete')) handleConfirm(confirmDelete, preview)
                  }}
                >
                  确认
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 确认结果 */}
      {confirmResult && (
        <Alert>
          <AlertTitle>操作成功</AlertTitle>
          <AlertDescription>依赖 {confirmResult.id} 已处理</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

// ── 详情面板子组件 ──

function MpdDetailPanel({ depId, orgId }: { depId: string; orgId: number | string }) {
  const { data, isLoading, isError } = useMpdDetail(orgId, depId)

  if (isLoading) return <Skeleton className="h-40 w-full" />
  if (isError || !data) {
    return (
      <Alert variant="danger">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>加载失败</AlertTitle>
      </Alert>
    )
  }

  // 详情与列表同源：后端 depRowToContract 的产物（嵌套 providerEndpoint/consumerEndpoint、
  // riskLevel、evidenceRefs——CRUD DTO 的 provider/risk/evidenceSummary 在真实响应里不存在）。
  const dep = data as unknown as MpdDepRow
  const evidence = (dep.evidenceRefs ?? [])
    .map((ref) => ref.summary)
    .filter((summary) => Boolean(summary))
  return (
    <div className="space-y-4 py-4">
      <div>
        <span className="text-sm text-muted-foreground">提供者</span>
        <p className="font-medium">{endpointLabel(endpointOf(dep, 'provider'))}</p>
      </div>
      <div>
        <span className="text-sm text-muted-foreground">消费者</span>
        <p className="font-medium">{endpointLabel(endpointOf(dep, 'consumer'))}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="text-sm text-muted-foreground">分类</span>
          <p>{dep.category}</p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">类型</span>
          <p>{dep.type}</p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">状态</span>
          <p>{dep.status}</p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">风险</span>
          <p>{rowRisk(dep)}</p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">延迟天数</span>
          <p>{dep.lagDays}</p>
        </div>
        <div>
          <span className="text-sm text-muted-foreground">缓冲天数</span>
          <p>{dep.bufferDays}</p>
        </div>
      </div>
      {evidence.length > 0 && (
        <div>
          <span className="text-sm text-muted-foreground">证据摘要</span>
          <p className="text-sm">{evidence.join('；')}</p>
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        创建于 {new Date(dep.createdAt).toLocaleString()}
      </div>
    </div>
  )
}
