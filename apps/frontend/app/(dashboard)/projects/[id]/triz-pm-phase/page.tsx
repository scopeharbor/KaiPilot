'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  usePmPhaseIntegrationRuns,
  useCreatePmPhaseIntegrationRun,
  usePmPhaseIntegrationPhases,
  useReviewPmPhaseIntegrationPhase,
  useExplainPmPhaseIntegrationPhase,
  usePmPhaseIntegrationHandoffPreview,
} from '@/hooks/use-pm-phase-integration'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge, type BadgeProps } from '@/components/ui/Badge'

type BadgeVariant = NonNullable<BadgeProps['variant']>
import { Skeleton } from '@/components/ui/Skeleton'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PM_PHASE_IDS, PM_PHASE_LABELS } from '@aiproj/types'
import type { PhaseReadinessState, PmPhaseId, PhaseHandoffTarget } from '@aiproj/types'
import { useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

export default function TrizPmPhaseIntegrationPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const projectId = Number(params.id)
  const selectedRunId = searchParams.get('runId') ? Number(searchParams.get('runId')) : undefined
  const selectedPhaseId = searchParams.get('phase') ?? undefined

  const [detailPhase, setDetailPhase] = useState<PmPhaseId | null>(
    (selectedPhaseId as PmPhaseId) ?? null,
  )

  const runsQuery = usePmPhaseIntegrationRuns(projectId)
  const phasesQuery = usePmPhaseIntegrationPhases(projectId, selectedRunId)
  const createRun = useCreatePmPhaseIntegrationRun(projectId)
  const reviewPhase = useReviewPmPhaseIntegrationPhase(projectId, selectedRunId)
  const explainPhase = useExplainPmPhaseIntegrationPhase(projectId, selectedRunId)
  const handoffPreview = usePmPhaseIntegrationHandoffPreview(projectId, selectedRunId)

  const handleCreate = useCallback(() => {
    createRun.mutate({ userNotes: '' })
  }, [createRun])

  const handleSelectRun = useCallback(
    (runId: number) => {
      router.push(`?runId=${runId}`, { scroll: false })
    },
    [router],
  )

  const handleSelectPhase = useCallback(
    (phaseId: PmPhaseId) => {
      setDetailPhase(phaseId)
      const newSearch = new URLSearchParams(searchParams.toString())
      newSearch.set('phase', phaseId)
      router.push(`?${newSearch.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const handleReview = useCallback(
    (phaseId: PmPhaseId) => {
      reviewPhase.mutate({ phaseId, reviewNotes: '' })
    },
    [reviewPhase],
  )

  const handleExplain = useCallback(
    (phaseId: PmPhaseId) => {
      explainPhase.mutate({ phaseId })
    },
    [explainPhase],
  )

  const handleHandoff = useCallback(
    (phaseId: PmPhaseId, recommendationId: string, target: PhaseHandoffTarget) => {
      handoffPreview.mutate({ phaseId, recommendationId, target })
    },
    [handoffPreview],
  )

  const phases = phasesQuery.data ?? []
  const selectedPhase = detailPhase ? (phases.find((p) => p.phaseId === detailPhase) ?? null) : null

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">TRIZ-PM 阶段整合</h1>
          <p className="text-sm text-muted-foreground">
            将 TRIZ 分析结果映射到项目管理五阶段，辅助阶段审查与决策
          </p>
        </div>
        <Button onClick={handleCreate} disabled={createRun.isPending} size="sm">
          {createRun.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
          运行阶段分析
        </Button>
      </div>

      {/* 运行列表 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">分析运行记录</CardTitle>
        </CardHeader>
        <CardContent>
          {runsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : runsQuery.isError ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              加载失败
            </div>
          ) : !runsQuery.data?.data?.length ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              暂无分析运行记录，点击"运行阶段分析"创建
            </div>
          ) : (
            <div className="space-y-2">
              {runsQuery.data.data.map((run) => (
                <button
                  key={run.runId}
                  onClick={() => handleSelectRun(Number(run.runId))}
                  className={cn(
                    'w-full flex items-center justify-between rounded-md border p-3 text-left transition-colors hover:bg-muted/50',
                    selectedRunId === Number(run.runId) && 'border-primary bg-primary/5',
                  )}
                >
                  <div>
                    <div className="text-sm font-medium">分析运行 #{run.runId}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(run.createdAt).toLocaleString('zh-CN')}
                      {run.blockedPhaseCount > 0 && (
                        <span className="ml-2 text-amber-600">
                          {run.blockedPhaseCount} 个阻断阶段
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 阶段列表 */}
      {selectedRunId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">阶段快照</CardTitle>
          </CardHeader>
          <CardContent>
            {phasesQuery.isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {PM_PHASE_IDS.map((pid) => (
                  <Skeleton key={pid} className="h-32" />
                ))}
              </div>
            ) : phases.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">暂无阶段数据</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                {PM_PHASE_IDS.map((pid) => {
                  const phase = phases.find((p) => p.phaseId === pid)
                  return (
                    <button
                      key={pid}
                      onClick={() => handleSelectPhase(pid)}
                      className={cn(
                        'rounded-lg border p-3 text-left transition-colors hover:bg-muted/50',
                        detailPhase === pid && 'ring-2 ring-primary',
                        phase?.readiness === 'ready' && 'border-green-200 bg-green-50/50',
                        phase?.readiness === 'blocked_stale' && 'border-red-200 bg-red-50/50',
                        phase?.readiness === 'insufficient_evidence' &&
                          'border-amber-200 bg-amber-50/50',
                        phase?.readiness === 'needs_review' && 'border-blue-200 bg-blue-50/50',
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{PM_PHASE_LABELS[pid]}</span>
                        {phase && <ReadinessBadge readiness={phase.readiness} />}
                      </div>
                      {phase ? (
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <div>{phase.sourceRefs.length} 个来源</div>
                          <div>{phase.recommendations.length} 条推荐</div>
                          {phase.gaps.length > 0 && (
                            <div className="text-amber-600">{phase.gaps.length} 个缺口</div>
                          )}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground italic">数据缺失</div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 阶段详情抽屉 */}
      {selectedPhase && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {PM_PHASE_LABELS[selectedPhase.phaseId]} — 详情
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExplain(selectedPhase.phaseId)}
                  disabled={explainPhase.isPending}
                >
                  {explainPhase.isPending ? (
                    <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                  ) : null}
                  生成说明
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleReview(selectedPhase.phaseId)}
                  disabled={reviewPhase.isPending}
                >
                  记录审查
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Readiness */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">就绪状态：</span>
              <ReadinessBadge readiness={selectedPhase.readiness} />
              {selectedPhase.stale && <Badge variant="danger">数据过期</Badge>}
            </div>

            {/* Warnings */}
            {selectedPhase.warnings.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">
                  警告 ({selectedPhase.warnings.length})
                </div>
                <div className="space-y-1">
                  {selectedPhase.warnings.map((w, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex items-start gap-2 rounded-md px-3 py-2 text-xs',
                        w.severity === 'high'
                          ? 'bg-destructive/10 text-destructive'
                          : w.severity === 'medium'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      {w.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Gaps */}
            {selectedPhase.gaps.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">
                  数据缺口 ({selectedPhase.gaps.length})
                </div>
                <div className="space-y-2">
                  {selectedPhase.gaps.map((gap, i) => (
                    <div key={i} className="rounded-md border p-3 text-sm">
                      <div className="font-medium">{gap.description}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        严重度: {gap.severity} · 推荐: {gap.recommendedAction} · 需人工确认:{' '}
                        {gap.requiresUserConfirmation ? '是' : '否'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {selectedPhase.recommendations.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">
                  推荐审查动作 ({selectedPhase.recommendations.length})
                </div>
                <div className="space-y-2">
                  {selectedPhase.recommendations.map((rec) => (
                    <div key={rec.recommendationId} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{rec.title}</div>
                        <div className="flex items-center gap-1">
                          {rec.handoffTargets.map((target) => (
                            <Button
                              key={target}
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs"
                              onClick={() =>
                                handleHandoff(selectedPhase.phaseId, rec.recommendationId, target)
                              }
                            >
                              预览: {target}
                            </Button>
                          ))}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{rec.description}</div>
                      {rec.sourceRefs.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          关联来源:{' '}
                          {rec.sourceRefs
                            .map((r) => r.title)
                            .filter(Boolean)
                            .join(', ') || '无标题'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Source Refs */}
            {selectedPhase.sourceRefs.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">
                  来源 ({selectedPhase.sourceRefs.length})
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {selectedPhase.sourceRefs.slice(0, 20).map((ref, i) => (
                    <div
                      key={i}
                      className={cn(
                        'rounded-md border px-3 py-2 text-xs',
                        ref.redactionReason && 'border-dashed opacity-50',
                      )}
                    >
                      <div className="font-medium truncate">{ref.title || '(已隐藏)'}</div>
                      <div className="text-muted-foreground">
                        {ref.sourceKind}
                        {ref.redactionReason && ` · ${ref.redactionReason}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Explanation result */}
            {explainPhase.data && (
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium">AI 阶段说明</span>
                    {explainPhase.data.isFallback && <Badge variant="neutral">确定性说明</Badge>}
                  </div>
                  <div className="whitespace-pre-wrap text-muted-foreground">
                    {explainPhase.data.text}
                  </div>
                  {explainPhase.data.degradedReason && (
                    <div className="text-xs text-amber-600 mt-2">
                      降级原因: {explainPhase.data.degradedReason}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Handoff result */}
            {handoffPreview.data && (
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="font-medium">Handoff 预览已生成</span>
                    <Badge variant="outline">previewOnly</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    目标: {handoffPreview.data.target} · 预览 ID: {handoffPreview.data.previewId}
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      )}

      {/* Error states */}
      {(runsQuery.isError || phasesQuery.isError) && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          数据加载失败，请稍后重试
        </div>
      )}
    </div>
  )
}

// ─── Readiness Badge ───────────────────────────────────────────────────────

function ReadinessBadge({ readiness }: { readiness: PhaseReadinessState }) {
  const config: Record<
    PhaseReadinessState,
    { variant: BadgeVariant; icon: LucideIcon; label: string }
  > = {
    ready: { variant: 'success', icon: CheckCircle2, label: '就绪' },
    needs_review: { variant: 'info', icon: AlertCircle, label: '待审查' },
    blocked_stale: { variant: 'danger', icon: AlertTriangle, label: '过期阻断' },
    insufficient_evidence: { variant: 'warning', icon: Clock, label: '证据不足' },
    requires_human_confirmation: { variant: 'info', icon: AlertCircle, label: '待确认' },
  }
  const c = config[readiness] ?? { variant: 'neutral', icon: AlertCircle, label: readiness }
  const Icon = c.icon
  return (
    <Badge variant={c.variant}>
      <Icon className="mr-1 h-3 w-3" />
      {c.label}
    </Badge>
  )
}
