'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  useResourceAnalyses,
  useResourceSnapshots,
  useResourceOpportunities,
  useCreateResourceAnalysis,
  useReviewResourceOpportunity,
  useExplainResourceOpportunity,
  useWorkbenchPreview,
  useDecisionPreview,
  useDraftPreview,
  useResourcePreview,
} from '@/hooks/use-resource-analyzer'
import type {
  ResourceAnalysisRun,
  ResourceOpportunityAiExplanation,
  ResourceOpportunityCandidate,
  ResourceSnapshot,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 审查面 Props
// ---------------------------------------------------------------------------

export interface TrizResourceAnalyzerProps {
  projectId: number
  canView?: boolean
  canManage?: boolean
  canAiExplain?: boolean
}

// ---------------------------------------------------------------------------
// 中文映射
// ---------------------------------------------------------------------------

const runStatusLabels: Record<string, string> = {
  queued: '排队中',
  completed: '已完成',
  completed_with_warnings: '已完成（有警告）',
  failed: '失败',
  stale: '已过期',
  archived: '已归档',
}

const severityLabels: Record<string, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
}

const severityVariant: Record<string, string> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
}

const opportunityTypeLabels: Record<string, string> = {
  idle_capacity: '闲置能力',
  substitute_resource: '替代资源',
  reuse_existing_asset: '复用现有资产',
  external_low_cost_resource: '外部低成本资源',
  information_gap: '信息资源缺口',
  automation_opportunity: '自动化机会',
  overload_relief: '过载缓解',
  environmental_resource: '环境资源',
  constraint_as_resource: '约束转用',
}

const warningLabels: Record<string, string> = {
  DATA_SOURCE_UNAVAILABLE: '数据来源不可用',
  INSUFFICIENT_RESOURCE_SOURCE: '资源来源不足',
  PERMISSION_RESTRICTED: '部分来源因权限被隐藏',
  SOURCE_STALE: '来源数据已过期',
  SOURCE_HIDDEN: '来源数据已脱敏',
  EXTERNAL_SOURCE_NOT_AUTHORIZED: '外部来源未授权',
  BUDGET_SOURCE_DEGRADED: '预算来源已降级',
  AI_EXPLANATION_FALLBACK: 'AI 解释已降级',
  AI_EXPLANATION_BLOCKED: 'AI 解释被阻断',
  HANDOFF_BLOCKED_STALE: '交接因来源过期被阻止',
}

const resourceKindLabels: Record<string, string> = {
  human: '人力',
  technical: '技术',
  information: '信息',
  time: '时间',
  space: '空间',
  financial: '财务',
  environmental: '环境',
  functional: '功能',
  material: '物质',
  field: '场',
}

const originLabels: Record<string, string> = {
  project_registry: '项目登记册',
  organization_pool: '组织资源池',
  task_assignment: '任务分配',
  risk_register: '风险登记册',
  knowledge_base: '知识库',
  compiler_triz: 'Compiler 产物',
  function_analysis: '功能分析',
  ifr_analysis: 'IFR 分析',
  workbench: '创新工作台',
  decision_log: '决策日志',
  user_supplied: '用户补充',
}

const utilizationLabels: Record<string, string> = {
  fully_utilized: '已饱和',
  partially_utilized: '部分利用',
  idle: '闲置',
  overloaded: '超载',
  unavailable: '不可用',
  unknown: '未知',
}

const availabilityLabels: Record<string, string> = {
  high: '可用度高',
  medium: '可用度中',
  low: '可用度低',
  none: '不可用',
  unknown: '可用度未知',
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export default function TrizResourceAnalyzer({
  projectId,
  canView = false,
  canManage = false,
  canAiExplain = false,
}: TrizResourceAnalyzerProps) {
  // 与邻近 TRIZ 页面一致：从 URL query 恢复选中运行（§7.11）
  const searchParams = useSearchParams()
  const router = useRouter()
  const runIdParam = searchParams?.get('runId') ?? null
  const initialRunId = runIdParam ? Number(runIdParam) : null

  const [selectedRunId, setSelectedRunId] = useState<number | null>(
    Number.isFinite(initialRunId) && initialRunId ? initialRunId : null,
  )
  const [selectedOppId, setSelectedOppId] = useState<number | null>(null)
  const [explanation, setExplanation] = useState<ResourceOpportunityAiExplanation | null>(null)
  const [previewResult, setPreviewResult] = useState<string | null>(null)
  const [copyResult, setCopyResult] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<string>('')
  const [originFilter, setOriginFilter] = useState<string>('')

  useEffect(() => {
    if (selectedRunId !== null && selectedRunId !== initialRunId) {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('runId', String(selectedRunId))
      router?.replace(`?${params.toString()}`, { scroll: false })
    }
  }, [selectedRunId, initialRunId, router, searchParams])

  // 无 view 权限时不发起任何查询，避免暴露运行数量与来源存在性
  const enabledProjectId = canView ? projectId : 0

  const { data: runsData, isLoading: loadingRuns } = useResourceAnalyses(enabledProjectId, {
    perPage: 20,
  })

  const { data: snapshotsData, isLoading: loadingSnapshots } = useResourceSnapshots(
    enabledProjectId,
    selectedRunId ?? 0,
    {
      perPage: 100,
      ...(kindFilter ? { resourceKind: kindFilter } : {}),
      ...(originFilter ? { origin: originFilter } : {}),
    },
  )

  const { data: oppsData, isLoading: loadingOpps } = useResourceOpportunities(
    enabledProjectId,
    selectedRunId ?? 0,
    { perPage: 50 },
  )

  const createMutation = useCreateResourceAnalysis()
  const reviewMutation = useReviewResourceOpportunity()
  const explainMutation = useExplainResourceOpportunity()
  const wbPreview = useWorkbenchPreview()
  const decPreview = useDecisionPreview()
  const draftPreview = useDraftPreview()
  const resPreview = useResourcePreview()

  const runs: ResourceAnalysisRun[] = runsData?.data ?? []
  const snapshots: ResourceSnapshot[] = snapshotsData?.data ?? []

  const handleCreate = () => {
    createMutation.mutate(
      { projectId },
      {
        onSuccess: (data) => {
          setSelectedRunId(data.id)
          setSelectedOppId(null)
          setExplanation(null)
          setPreviewResult(null)
          setCopyResult(null)
        },
      },
    )
  }

  const handleReview = (
    oppId: number | undefined,
    action: 'mark_reviewed' | 'mark_unreviewed' | 'dismiss',
  ) => {
    if (!selectedRunId || !oppId) return
    reviewMutation.mutate({
      projectId,
      runId: selectedRunId,
      opportunityId: oppId,
      body: { action },
    })
  }

  const handleExplain = (oppId: number | undefined) => {
    if (!selectedRunId || !oppId) return
    explainMutation.mutate(
      { projectId, runId: selectedRunId, opportunityId: oppId },
      {
        onSuccess: (data) => {
          setExplanation(data.explanation)
        },
      },
    )
  }

  /** 复制低敏引用摘要（仅剪贴板，不生成文件、不写正式数据，§7.12）。 */
  const handleCopyReference = async (opp: ResourceOpportunityCandidate) => {
    const text = [
      `资源机会候选 ${opp.opportunityKey}`,
      `类型: ${opportunityTypeLabels[opp.opportunityType] ?? opp.opportunityType}`,
      `严重度: ${severityLabels[opp.severity] ?? opp.severity}`,
      `理由: ${opp.rationaleSummary}`,
      '（仅供审查参考，不自动执行）',
    ].join('\n')
    try {
      await navigator.clipboard?.writeText(text)
      setCopyResult('引用摘要已复制到剪贴板。')
    } catch {
      setCopyResult('复制失败，请手动选择文本。')
    }
  }

  const handlePreview = (
    oppId: number | undefined,
    kind: 'workbench' | 'decision' | 'draft' | 'resource',
  ) => {
    if (!selectedRunId || !oppId) return
    const labels: Record<string, string> = {
      workbench: '方案篮子',
      decision: '决策记录',
      draft: '草案层',
      resource: '资源',
    }
    const mut =
      kind === 'workbench'
        ? wbPreview
        : kind === 'decision'
          ? decPreview
          : kind === 'draft'
            ? draftPreview
            : resPreview
    mut.mutate(
      { projectId, runId: selectedRunId, opportunityId: oppId },
      {
        onSuccess: () => {
          setPreviewResult(`${labels[kind]}预览已生成：需人工确认后才写入正式记录。`)
        },
        onError: (error) => {
          setPreviewResult(
            `预览未生成：${(error as Error)?.message ?? '来源可能已过期，请重新运行分析'}`,
          )
        },
      },
    )
  }

  // ── 渲染 ──

  if (!canView) {
    return <div className="p-6 text-center text-muted-foreground">您没有 TRIZ 资源分析权限。</div>
  }

  if (loadingRuns) {
    return (
      <div className="p-6 space-y-3">
        <div className="h-6 w-48 bg-muted animate-pulse rounded" />
        <div className="h-4 w-64 bg-muted animate-pulse rounded" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">TRIZ 资源分析器</h2>
        {canManage && (
          <button
            onClick={handleCreate}
            disabled={createMutation.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {createMutation.isPending ? '分析中…' : '新建资源分析'}
          </button>
        )}
      </div>

      {createMutation.isError && (
        <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          分析失败: {(createMutation.error as Error)?.message ?? '未知错误'}
        </div>
      )}

      {/* 运行列表 */}
      {runs.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground text-sm">
          暂无资源分析运行。点击「新建资源分析」开始盘点项目可利用资源。
        </div>
      ) : (
        <div className="space-y-4">
          {/* 运行选择器 */}
          <div className="flex flex-wrap gap-2">
            {runs.map((run) => (
              <button
                key={run.id}
                onClick={() => {
                  setSelectedRunId(run.id)
                  setSelectedOppId(null)
                  setExplanation(null)
                  setPreviewResult(null)
                  setCopyResult(null)
                }}
                className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                  selectedRunId === run.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted'
                }`}
              >
                #{run.id} · {runStatusLabels[run.status] ?? run.status}
                {run.resourceCount > 0 && (
                  <span className="ml-1 opacity-60">
                    ({run.resourceCount} 资源 / {run.opportunityCount} 机会)
                  </span>
                )}
              </button>
            ))}
          </div>

          {selectedRunId && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              {/* 资源全景 */}
              <section className="space-y-3" aria-label="资源全景">
                <h3 className="text-sm font-medium">资源全景</h3>

                {/* 筛选 */}
                <div className="flex flex-wrap gap-2">
                  <label className="sr-only" htmlFor="resource-kind-filter">
                    按资源类型筛选
                  </label>
                  <select
                    id="resource-kind-filter"
                    value={kindFilter}
                    onChange={(e) => setKindFilter(e.target.value)}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                  >
                    <option value="">全部类型</option>
                    {Object.entries(resourceKindLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>

                  <label className="sr-only" htmlFor="resource-origin-filter">
                    按资源来源筛选
                  </label>
                  <select
                    id="resource-origin-filter"
                    value={originFilter}
                    onChange={(e) => setOriginFilter(e.target.value)}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                  >
                    <option value="">全部来源</option>
                    {Object.entries(originLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                {loadingSnapshots ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
                    ))}
                  </div>
                ) : snapshots.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    当前筛选条件下没有可见资源快照。
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {snapshots.map((snap) => (
                      <li key={snap.resourceKey} className="rounded-md border border-border p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{snap.label}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {resourceKindLabels[snap.resourceKind] ?? snap.resourceKind}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {originLabels[snap.origin] ?? snap.origin}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>
                            {utilizationLabels[snap.utilizationState] ?? snap.utilizationState}
                          </span>
                          <span>·</span>
                          <span>{availabilityLabels[snap.availability] ?? snap.availability}</span>
                          {snap.capacity && (
                            <>
                              <span>·</span>
                              <span>{snap.capacity}</span>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* 机会队列 */}
              <section className="space-y-3" aria-label="资源机会候选">
                <h3 className="text-sm font-medium">资源机会候选</h3>

                {loadingOpps ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-20 animate-pulse rounded-md bg-muted" />
                    ))}
                  </div>
                ) : (oppsData?.data?.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground">该运行未检测到资源机会候选。</div>
                ) : (
                  <div className="space-y-2">
                    {oppsData?.data?.map((opp) => (
                      <OpportunityCard
                        key={opp.opportunityKey}
                        opp={opp}
                        selected={selectedOppId === opp.id}
                        canManage={canManage}
                        canAiExplain={canAiExplain}
                        explanation={selectedOppId === opp.id ? explanation : null}
                        previewResult={selectedOppId === opp.id ? previewResult : null}
                        copyResult={selectedOppId === opp.id ? copyResult : null}
                        onClick={() => {
                          setSelectedOppId(opp.id ?? null)
                          setExplanation(null)
                          setPreviewResult(null)
                          setCopyResult(null)
                        }}
                        onReview={(action) => handleReview(opp.id, action)}
                        onExplain={() => handleExplain(opp.id)}
                        onPreview={(kind) => handlePreview(opp.id, kind)}
                        onCopyReference={() => handleCopyReference(opp)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 机会卡片
// ---------------------------------------------------------------------------

function OpportunityCard({
  opp,
  selected,
  canManage,
  canAiExplain,
  explanation,
  previewResult,
  copyResult,
  onClick,
  onReview,
  onExplain,
  onPreview,
  onCopyReference,
}: {
  opp: ResourceOpportunityCandidate
  selected: boolean
  canManage: boolean
  canAiExplain: boolean
  explanation: ResourceOpportunityAiExplanation | null
  previewResult: string | null
  copyResult: string | null
  onClick: () => void
  onReview: (action: 'mark_reviewed' | 'mark_unreviewed' | 'dismiss') => void
  onExplain: () => void
  onPreview: (kind: 'workbench' | 'decision' | 'draft' | 'resource') => void
  onCopyReference: () => void
}) {
  const isStale = opp.status === 'blocked_stale'

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer rounded-md border p-3 transition-colors hover:bg-muted/50 ${
        selected ? 'border-primary bg-primary/5' : 'border-border'
      } ${isStale ? 'opacity-60' : ''}`}
    >
      {/* 标题行 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{opp.title}</span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              severityVariant[opp.severity] === 'danger'
                ? 'bg-danger/10 text-danger'
                : severityVariant[opp.severity] === 'warning'
                  ? 'bg-warning/10 text-warning'
                  : severityVariant[opp.severity] === 'info'
                    ? 'bg-info/10 text-info'
                    : 'bg-muted text-muted-foreground'
            }`}
          >
            {severityLabels[opp.severity] ?? opp.severity}
          </span>
          <span className="text-xs text-muted-foreground">
            {opportunityTypeLabels[opp.opportunityType] ?? opp.opportunityType}
          </span>
          {isStale && (
            <span className="rounded bg-warning/10 px-1.5 py-0.5 text-xs text-warning">
              来源已过期
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          置信度: {Math.round(opp.confidence * 100)}%
        </span>
      </div>

      {/* 理由 */}
      <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">{opp.rationaleSummary}</p>

      {/* 源引用 */}
      {opp.resourceRefs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {opp.resourceRefs.slice(0, 3).map((ref, i) => (
            <span
              key={i}
              className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
            >
              {ref.lowSensitiveTitle}
            </span>
          ))}
          {opp.resourceRefs.length > 3 && (
            <span className="text-xs text-muted-foreground">+{opp.resourceRefs.length - 3}</span>
          )}
        </div>
      )}

      {/* 警告 */}
      {opp.warningCodes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {opp.warningCodes.map((code) => (
            <span key={code} className="rounded bg-warning/5 px-1.5 py-0.5 text-xs text-warning">
              ⚠ {warningLabels[code] ?? code}
            </span>
          ))}
        </div>
      )}

      {/* 选中详情 */}
      {selected && (
        <div className="mt-3 space-y-3 border-t pt-3">
          {/* 详情信息 */}
          <div className="text-sm text-muted-foreground">
            <p>建议操作: {opp.suggestedActions.join('、')}</p>
          </div>

          {/* AI 说明区 */}
          {canAiExplain && !explanation && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onExplain()
              }}
              className="text-xs text-primary hover:underline"
            >
              生成分析说明（仅供参考，不自动执行）
            </button>
          )}
          {explanation && (
            <div className="rounded border border-border bg-muted/30 p-3 text-sm">
              <p className="text-xs text-muted-foreground mb-1">分析说明（仅供参考，不自动执行）</p>
              <p className="whitespace-pre-wrap">{explanation.narrative}</p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{explanation.isFallback ? '来源：确定性降级说明' : '来源：模型生成'}</span>
                <span>
                  {explanation.hallucinationChecked ? '反幻觉校验：已通过' : '反幻觉校验：未通过'}
                </span>
                <span>
                  {explanation.cost
                    ? `成本：${(explanation.cost.promptTokens ?? 0) + (explanation.cost.completionTokens ?? 0)} tokens`
                    : '成本：未计费'}
                </span>
              </div>
              {explanation.degradedReason && (
                <p className="mt-1 text-xs text-warning">降级原因：{explanation.degradedReason}</p>
              )}
            </div>
          )}

          {/* 审查动作 */}
          {canManage && opp.status !== 'blocked_stale' && (
            <div className="flex flex-wrap gap-2">
              {opp.status === 'unreviewed' || opp.status === 'dismissed' ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onReview('mark_reviewed')
                  }}
                  className="rounded border border-border px-2.5 py-1 text-xs hover:bg-muted"
                >
                  记录审查
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onReview('mark_unreviewed')
                  }}
                  className="rounded border border-border px-2.5 py-1 text-xs hover:bg-muted"
                >
                  标记未审查
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onPreview('workbench')
                }}
                className="rounded border border-border px-2.5 py-1 text-xs hover:bg-muted"
              >
                加入方案篮子
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onPreview('decision')
                }}
                className="rounded border border-border px-2.5 py-1 text-xs hover:bg-muted"
              >
                生成决策记录预览
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onPreview('draft')
                }}
                className="rounded border border-border px-2.5 py-1 text-xs hover:bg-muted"
              >
                进入草案预览
              </button>
              {opp.opportunityType === 'overload_relief' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onPreview('resource')
                  }}
                  className="rounded border border-border px-2.5 py-1 text-xs hover:bg-muted"
                >
                  生成资源预览
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onReview('dismiss')
                }}
                className="rounded border border-danger/30 px-2.5 py-1 text-xs text-danger hover:bg-danger/5"
              >
                驳回
              </button>
            </div>
          )}

          {/* 低敏引用复制：仅剪贴板，不生成文件、不写正式数据 */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCopyReference()
            }}
            className="text-xs text-muted-foreground hover:underline"
          >
            复制引用摘要
          </button>

          {previewResult && <div className="text-xs text-muted-foreground">{previewResult}</div>}
          {copyResult && <div className="text-xs text-muted-foreground">{copyResult}</div>}
        </div>
      )}
    </div>
  )
}
