'use client'

// 多项目影响分析工作台（v3-multi-project-impact-analysis §8 PMO 影响分析视图）

import { useState, useCallback, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useOrganizationId } from '@/hooks/use-organization-id'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useMultiProjectImpactSnapshots,
  useMultiProjectImpactSnapshot,
  usePlanMultiProjectImpactAnalysis,
  useRunMultiProjectImpactAnalysis,
  useRefreshMultiProjectImpactSnapshot,
  useWhatIfMultiProjectImpact,
  useExportMultiProjectImpact,
  useFollowUpDraftMultiProjectImpact,
  useAiExplanationMultiProjectImpact,
} from '@/hooks/use-multi-project-impact-analysis'
import type {
  MultiProjectImpactScope,
  MultiProjectImpactPlan,
  MultiProjectImpactWhatIfScenario,
  MultiProjectImpactListQuery,
  MultiProjectImpactScenarioType,
  MultiProjectImpactWhatIfResponse,
} from '@aiproj/types'
import {
  MULTI_PROJECT_IMPACT_SCENARIO_TYPES,
  MULTI_PROJECT_IMPACT_SOURCE_TYPES,
  MULTI_PROJECT_IMPACT_SEVERITIES,
  MULTI_PROJECT_IMPACT_SNAPSHOT_STATUSES,
} from '@aiproj/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/Alert'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/Sheet'

// ─── Severity Badge 颜色映射 ──────────────────────────────────────

const severityVariant: Record<string, 'danger' | 'primary' | 'neutral' | 'outline'> = {
  blocker: 'danger',
  critical: 'danger',
  high: 'primary',
  medium: 'neutral',
  low: 'outline',
  none: 'outline',
}

const severityLabel: Record<string, string> = {
  blocker: '阻断',
  critical: '危急',
  high: '高',
  medium: '中',
  low: '低',
  none: '无',
}

const warningLabel: Record<string, string> = {
  hidden_dependency_present: '存在隐藏依赖',
  hidden_project_present: '存在隐藏项目',
  stale_source_data: '源数据已过期',
  ai_unavailable: 'AI 不可用',
  feature_disabled: '功能未启用',
  propagation_depth_limit_reached: '已达传播深度上限',
  node_limit_reached: '已达节点数上限',
  edge_limit_reached: '已达边数上限',
  buffer_absorbed: '延迟被缓冲吸收',
}

const statusLabel: Record<string, string> = {
  pending: '等待中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  stale: '已过期',
}

// ─── URL filter serialization helpers ──────────────────────────────

function serializeQuery(query: MultiProjectImpactListQuery): URLSearchParams {
  const p = new URLSearchParams()
  if (query.projectIds?.length) p.set('projectIds', query.projectIds.join(','))
  if (query.sourceType) p.set('sourceType', query.sourceType)
  if (query.severity) p.set('severity', query.severity)
  if (query.isStale !== undefined) p.set('isStale', String(query.isStale))
  if (query.status) p.set('status', query.status)
  if (query.sort) p.set('sort', query.sort)
  if (query.page && query.page > 1) p.set('page', String(query.page))
  return p
}

/**
 * URL query 是外部输入，不能直接 as 成字面量联合：
 * 非法值应当被丢弃（回落到「不过滤」），而不是带着脏值发给后端。
 */
function narrowTo<T extends string>(allowed: readonly T[], raw: string | null): T | undefined {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined
}

function deserializeQuery(sp: URLSearchParams): MultiProjectImpactListQuery {
  return {
    organizationId: 0,
    projectIds: sp.get('projectIds')?.split(',').map(Number).filter(Boolean) ?? undefined,
    sourceType: narrowTo(MULTI_PROJECT_IMPACT_SOURCE_TYPES, sp.get('sourceType')),
    severity: narrowTo(MULTI_PROJECT_IMPACT_SEVERITIES, sp.get('severity')),
    isStale: sp.has('isStale') ? sp.get('isStale') === 'true' : undefined,
    status: narrowTo(MULTI_PROJECT_IMPACT_SNAPSHOT_STATUSES, sp.get('status')),
    sort: sp.get('sort') ?? undefined,
    page: sp.get('page') ? Number(sp.get('page')) : undefined,
  }
}

// ─── 主组件 ────────────────────────────────────────────────────────

export default function MultiProjectImpactAnalysisPage() {
  // 组织未解析出来时用 0 占位：下游 hook 均以 enabled: Boolean(orgId) 禁用查询。
  const organizationId = useOrganizationId() ?? 0
  const router = useRouter()
  const searchParams = useSearchParams()
  const { hasPermission } = usePermissions()

  // 权限
  const canView =
    hasPermission('multi_project_impact:view') || hasPermission('multi_project_impact:manage')
  const canManage = hasPermission('multi_project_impact:manage')

  // Filters from URL
  const query = useMemo(() => deserializeQuery(searchParams), [searchParams])

  // State
  const [filters, setFilters] = useState<MultiProjectImpactListQuery>({ ...query, organizationId })
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null)
  const [planResult, setPlanResult] = useState<MultiProjectImpactPlan | null>(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [whatIfDrawerOpen, setWhatIfDrawerOpen] = useState(false)
  const [whatIfScenario, setWhatIfScenario] = useState<MultiProjectImpactScenarioType>('delay')
  const [whatIfDelayDays, setWhatIfDelayDays] = useState<number>(7)
  const [whatIfResult, setWhatIfResult] = useState<MultiProjectImpactWhatIfResponse | null>(null)
  const [aiExplanation, setAiExplanation] = useState<string | null>(null)

  // Data
  const {
    data: listData,
    isLoading,
    isError,
  } = useMultiProjectImpactSnapshots(organizationId, filters)
  const { data: selectedSnapshot, isLoading: detailLoading } = useMultiProjectImpactSnapshot(
    organizationId,
    selectedSnapshotId,
  )

  // Mutations
  const planMutation = usePlanMultiProjectImpactAnalysis(organizationId)
  const runMutation = useRunMultiProjectImpactAnalysis(organizationId)
  const refreshMutation = useRefreshMultiProjectImpactSnapshot(organizationId)
  const whatIfMutation = useWhatIfMultiProjectImpact(organizationId)
  const exportMutation = useExportMultiProjectImpact(organizationId)
  useFollowUpDraftMultiProjectImpact(organizationId)
  const aiMutation = useAiExplanationMultiProjectImpact(organizationId)

  // ─── Actions ────────────────────────────────────────────────────

  const handlePlan = useCallback(async () => {
    const scope: MultiProjectImpactScope = {
      projectIds: filters.projectIds ?? [],
      maxPropagationDepth: 5,
      maxNodes: 500,
      maxEdges: 1000,
      maxScenarios: 5,
    }
    try {
      const result = await planMutation.mutateAsync(scope)
      setPlanResult(result)
    } catch {
      /* handled by mutation state */
    }
  }, [filters.projectIds, planMutation])

  const handleRun = useCallback(async () => {
    if (!planResult?.runToken) return
    try {
      await runMutation.mutateAsync(planResult.runToken)
      setPlanResult(null)
    } catch {
      /* handled by mutation state */
    }
  }, [planResult, runMutation])

  const handleRefresh = useCallback(
    async (id: number) => {
      try {
        await refreshMutation.mutateAsync(id)
      } catch {
        /* handled by mutation state */
      }
    },
    [refreshMutation],
  )

  const handleWhatIf = useCallback(async () => {
    if (!selectedSnapshotId) return
    const scenario: MultiProjectImpactWhatIfScenario = {
      scenarioType: whatIfScenario,
      assumption: `假设延期 ${whatIfDelayDays} 天`,
      targetEndpointType: 'project',
      targetEndpointId: filters.projectIds?.[0] ?? 1,
      params: { delayDays: whatIfDelayDays },
    }
    try {
      const result = await whatIfMutation.mutateAsync({
        snapshotId: selectedSnapshotId,
        scenarios: [scenario],
      })
      setWhatIfResult(result)
    } catch {
      /* handled by mutation state */
    }
  }, [selectedSnapshotId, whatIfScenario, whatIfDelayDays, filters.projectIds, whatIfMutation])

  const handleExport = useCallback(
    async (id: number) => {
      try {
        const result = await exportMutation.mutateAsync({ snapshotId: id, format: 'json' })
        // 触发下载
        const blob = new Blob([result.content], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `impact-analysis-${id}.json`
        a.click()
        URL.revokeObjectURL(url)
      } catch {
        /* handled by mutation state */
      }
    },
    [exportMutation],
  )

  const handleAiExplanation = useCallback(
    async (id: number) => {
      try {
        const result = await aiMutation.mutateAsync({ snapshotId: id })
        setAiExplanation(result.explanation)
      } catch {
        /* handled by mutation state */
      }
    },
    [aiMutation],
  )

  const handleViewDetail = useCallback((id: number) => {
    setSelectedSnapshotId(id)
    setDetailDrawerOpen(true)
  }, [])

  const navigateWithFilters = useCallback(
    (newFilters: Partial<MultiProjectImpactListQuery>) => {
      const merged = { ...filters, ...newFilters }
      setFilters(merged)
      const qs = serializeQuery(merged).toString()
      router.push(`?${qs}`)
    },
    [filters, router],
  )

  // ─── No-permission state ────────────────────────────────────────

  if (!canView) {
    return (
      <div className="p-6">
        <Alert variant="danger">
          <AlertTitle>无访问权限</AlertTitle>
          <AlertDescription>您没有多项目影响分析的查看权限，请联系组织管理员。</AlertDescription>
        </Alert>
      </div>
    )
  }

  // ─── Main: workbench view (no landing page) ──────────────────────

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">多项目影响分析</h1>
          <p className="text-sm text-muted-foreground">
            从项目群依赖中计算下游影响、评估缓冲吸收、生成决策建议
          </p>
        </div>
      </div>

      {/* Source selection & Plan/Run */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">分析范围</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="项目 ID（逗号分隔，如 1,2,3）"
              value={filters.projectIds?.join(',') ?? ''}
              onChange={(e) => {
                const ids = e.target.value.split(',').map(Number).filter(Boolean)
                setFilters((f) => ({ ...f, projectIds: ids }))
              }}
              className="max-w-md"
            />
            {canManage && (
              <Button
                onClick={handlePlan}
                disabled={planMutation.isPending || !filters.projectIds?.length}
                size="sm"
              >
                {planMutation.isPending ? '分析计划生成中...' : '创建分析计划'}
              </Button>
            )}
          </div>

          {planResult && (
            <Alert>
              <AlertTitle>分析计划就绪</AlertTitle>
              <AlertDescription className="space-y-1 text-sm">
                <div>范围哈希：{planResult.scopeHash.slice(0, 12)}...</div>
                <div>规则版本：{planResult.ruleVersion}</div>
                <div>预计节点数：{planResult.estimatedCost.approximateNodes}</div>
                <div>预计边数：{planResult.estimatedCost.approximateEdges}</div>
                <div>计划有效期至：{new Date(planResult.expiresAt).toLocaleString('zh-CN')}</div>
                {planResult.warnings.length > 0 && (
                  <div className="text-amber-600">
                    警告：
                    {planResult.warnings.map((w) => warningLabel[w.code] ?? w.code).join('；')}
                  </div>
                )}
                <div className="mt-2">
                  <Button size="sm" onClick={handleRun} disabled={runMutation.isPending}>
                    {runMutation.isPending ? '分析运行中...' : '运行分析'}
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {runMutation.isSuccess && (
            <Alert>
              <AlertTitle>分析完成</AlertTitle>
              <AlertDescription>影响分析快照已生成，可在下方列表查看详情。</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Snapshot List */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <CardTitle className="text-base">影响分析快照</CardTitle>
          <div className="flex flex-wrap gap-2">
            <select
              className="border rounded px-2 py-1 text-sm"
              value={filters.severity ?? ''}
              onChange={(e) =>
                navigateWithFilters({
                  severity: narrowTo(MULTI_PROJECT_IMPACT_SEVERITIES, e.target.value),
                })
              }
            >
              <option value="">全部严重度</option>
              <option value="blocker">阻断</option>
              <option value="critical">危急</option>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={filters.status ?? ''}
              onChange={(e) =>
                navigateWithFilters({
                  status: narrowTo(MULTI_PROJECT_IMPACT_SNAPSHOT_STATUSES, e.target.value),
                })
              }
            >
              <option value="">全部状态</option>
              <option value="completed">已完成</option>
              <option value="stale">已过期</option>
              <option value="failed">失败</option>
            </select>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={filters.isStale ?? false}
                onChange={(e) => navigateWithFilters({ isStale: e.target.checked || undefined })}
              />
              仅过期
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : isError ? (
            <Alert variant="danger">
              <AlertTitle>加载失败</AlertTitle>
              <AlertDescription>无法获取影响分析快照列表，请稍后重试。</AlertDescription>
            </Alert>
          ) : !listData?.data?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>暂无影响分析快照</p>
              <p className="text-sm">请先选择项目范围，创建分析计划并运行分析。</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-2">ID</th>
                    <th className="py-2 pr-2">状态</th>
                    <th className="py-2 pr-2">受影响</th>
                    <th className="py-2 pr-2">最高严重度</th>
                    <th className="py-2 pr-2">深度</th>
                    <th className="py-2 pr-2">生成时间</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {listData.data.map((snapshot) => (
                    <tr key={snapshot.id} className="border-b hover:bg-muted/50">
                      <td className="py-2 pr-2">#{snapshot.id}</td>
                      <td className="py-2 pr-2">
                        <Badge
                          variant={snapshot.isStale ? 'danger' : 'primary'}
                          className="text-xs"
                        >
                          {snapshot.isStale
                            ? '已过期'
                            : (statusLabel[snapshot.status] ?? snapshot.status)}
                        </Badge>
                      </td>
                      <td className="py-2 pr-2">
                        {snapshot.propagationSummary.totalAffectedEndpoints}
                      </td>
                      <td className="py-2 pr-2">
                        {(() => {
                          const dist = snapshot.propagationSummary.severityDistribution
                          const top =
                            ['blocker', 'critical', 'high', 'medium'].find(
                              (s) => dist[s as keyof typeof dist] > 0,
                            ) ?? 'none'
                          return (
                            <Badge variant={severityVariant[top] ?? 'outline'} className="text-xs">
                              {severityLabel[top] ?? top}
                            </Badge>
                          )
                        })()}
                      </td>
                      <td className="py-2 pr-2">{snapshot.propagationSummary.maxDepth}</td>
                      <td className="py-2 pr-2 text-xs">
                        {new Date(snapshot.generatedAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="py-2">
                        <div className="flex gap-1 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewDetail(snapshot.id)}
                          >
                            详情
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRefresh(snapshot.id)}
                            disabled={!canManage || refreshMutation.isPending}
                          >
                            刷新
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleExport(snapshot.id)}
                          >
                            导出
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAiExplanation(snapshot.id)}
                            disabled={aiMutation.isPending}
                          >
                            AI
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {listData?.meta && listData.meta.totalPages > 1 && (
            <div className="flex items-center justify-between pt-3">
              <span className="text-sm text-muted-foreground">
                共 {listData.meta.total} 条，第 {listData.meta.page}/{listData.meta.totalPages} 页
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={listData.meta.page <= 1}
                  onClick={() => navigateWithFilters({ page: listData.meta.page - 1 })}
                >
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={listData.meta.page >= listData.meta.totalPages}
                  onClick={() => navigateWithFilters({ page: listData.meta.page + 1 })}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Snapshot Detail Drawer */}
      <Sheet open={detailDrawerOpen} onOpenChange={setDetailDrawerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>影响分析快照 #{selectedSnapshotId}</SheetTitle>
            <SheetDescription>
              {detailLoading ? '加载中...' : '传播路径与受影响端点'}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            {detailLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : selectedSnapshot ? (
              <>
                {/* 传播路径表 */}
                <div>
                  <h3 className="text-sm font-medium mb-2">传播路径</h3>
                  {selectedSnapshot.propagationSummary.propagationPaths.length === 0 ? (
                    <p className="text-sm text-muted-foreground">无传播路径</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedSnapshot.propagationSummary.propagationPaths.map((path, pi) => (
                        <div key={pi} className="border rounded p-2 text-xs space-y-1">
                          <div className="font-medium">
                            源点：{path.sourceRef.sourceLabel}（{path.sourceRef.sourceType}）
                          </div>
                          <div>
                            深度：{path.depth} | 总延期：{path.totalDelayDays} 天
                          </div>
                          {path.affectedEndpoints.map((ep, ei) => (
                            <div key={ei} className="ml-3 py-1 border-l-2 pl-2">
                              <div className="flex items-center gap-1">
                                {ep.visibility !== 'visible' ? (
                                  <Badge variant="danger" className="text-xs">
                                    脱敏
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant={severityVariant[ep.severity] ?? 'outline'}
                                    className="text-xs"
                                  >
                                    {severityLabel[ep.severity] ?? ep.severity}
                                  </Badge>
                                )}
                                <span>
                                  {ep.visibility === 'visible' ? ep.endpointLabel : '（隐藏）'}
                                </span>
                              </div>
                              <div className="text-muted-foreground">
                                传播延期：{ep.propagatedDelayDays}d | 缓冲吸收：
                                {ep.bufferAbsorbedDays}d | 剩余缓冲：{ep.remainingBufferDays}d
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Warnings */}
                {selectedSnapshot.warnings.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-1 text-amber-600">警告</h3>
                    <ul className="text-xs space-y-1">
                      {selectedSnapshot.warnings.map((w, i) => (
                        <li key={i}>
                          {warningLabel[w.code] ?? w.code}：{w.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* What-if button */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDetailDrawerOpen(false)
                    setWhatIfDrawerOpen(true)
                  }}
                >
                  What-if 对比
                </Button>

                {/* AI explanation */}
                {aiExplanation && (
                  <Alert>
                    <AlertTitle>AI 解释</AlertTitle>
                    <AlertDescription className="text-xs">{aiExplanation}</AlertDescription>
                  </Alert>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">快照不存在</p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* What-if Drawer */}
      <Sheet open={whatIfDrawerOpen} onOpenChange={setWhatIfDrawerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>What-if 场景对比</SheetTitle>
            <SheetDescription>假设性分析，不修改正式计划</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-sm">场景类型</label>
              <select
                className="w-full border rounded px-2 py-1 text-sm mt-1"
                value={whatIfScenario}
                onChange={(e) =>
                  setWhatIfScenario(
                    narrowTo(MULTI_PROJECT_IMPACT_SCENARIO_TYPES, e.target.value) ?? 'delay',
                  )
                }
              >
                {MULTI_PROJECT_IMPACT_SCENARIO_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            {whatIfScenario === 'delay' && (
              <div>
                <label className="text-sm">延期天数</label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={whatIfDelayDays}
                  onChange={(e) => setWhatIfDelayDays(Number(e.target.value))}
                  className="mt-1"
                />
              </div>
            )}
            <Button
              size="sm"
              onClick={handleWhatIf}
              disabled={whatIfMutation.isPending || !selectedSnapshotId}
            >
              {whatIfMutation.isPending ? '计算中...' : '运行对比'}
            </Button>

            {whatIfResult && (
              <div className="space-y-2 mt-3">
                <Alert>
                  <AlertTitle>What-if 结果</AlertTitle>
                  <AlertDescription className="text-xs space-y-1">
                    <div>基线影响数：{whatIfResult.data?.[0]?.baseline?.totalAffected}</div>
                    <div>场景影响数：{whatIfResult.data?.[0]?.scenarioOutput?.totalAffected}</div>
                    <div className="text-muted-foreground italic">
                      ⚠ 此为假设性分析，未修改任何正式计划
                    </div>
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
