'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  useEvolutionTrendAnalyses,
  useEvolutionTrendScores,
  useEvolutionTrendRisks,
  useEvolutionTrendHistory,
  useCreateEvolutionTrendAnalysis,
  useReviewEvolutionTrendRisk,
  useExplainEvolutionTrendRisk,
  useEvolutionWorkbenchPreview,
  useEvolutionDecisionPreview,
  useEvolutionDraftPreview,
  useEvolutionRiskPreview,
} from '@/hooks/use-evolution-trend-analysis'
import type { EvolutionTrendAiExplanation } from '@aiproj/types'
import { EVOLUTION_TREND_LABELS, TREND_RISK_TYPE_LABELS } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 审查面 Props
// ---------------------------------------------------------------------------

export interface TrizEvolutionTrendAnalysisProps {
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

const severityColors: Record<string, string> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
}

const stageLabels: Record<string, string> = {
  nascent: '萌芽期',
  developing: '发展期',
  established: '成熟期',
  advanced: '领先期',
}

const directionLabels: Record<string, string> = {
  improving: '↗ 改善中',
  stable: '→ 稳定',
  declining: '↘ 下滑',
  unknown: '? 未知',
}

const riskStatusLabels: Record<string, string> = {
  unreviewed: '待审查',
  reviewed: '已审查',
  previewed: '已预览',
  blocked_stale: '已过期',
  dismissed: '已驳回',
}

// ---------------------------------------------------------------------------
// 审查面组件
// ---------------------------------------------------------------------------

export default function TrizEvolutionTrendAnalysis({
  projectId,
  canView = false,
  canManage = false,
  canAiExplain = false,
}: TrizEvolutionTrendAnalysisProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedRunId = Number(searchParams.get('runId') ?? 0)

  const [creating, setCreating] = useState(false)
  const [detailRunId, setDetailRunId] = useState<number>(selectedRunId || 0)
  const [aiState, setAiState] = useState<{
    loading: boolean
    explanation: EvolutionTrendAiExplanation | null
    riskKey: string | null
  }>({ loading: false, explanation: null, riskKey: null })

  // 列表
  const { data: runsData, isLoading: runsLoading } = useEvolutionTrendAnalyses(projectId, {
    perPage: 20,
  })

  // 详情
  const { data: trendsData } = useEvolutionTrendScores(projectId, detailRunId, {})
  const { data: risksData } = useEvolutionTrendRisks(projectId, detailRunId, {})
  const { data: historyData } = useEvolutionTrendHistory(projectId, detailRunId, {})

  // mutations
  const createMut = useCreateEvolutionTrendAnalysis()
  const reviewMut = useReviewEvolutionTrendRisk()
  const explainMut = useExplainEvolutionTrendRisk()
  const workbenchMut = useEvolutionWorkbenchPreview()
  const decisionMut = useEvolutionDecisionPreview()
  const draftMut = useEvolutionDraftPreview()
  const riskPreviewMut = useEvolutionRiskPreview()

  // URL sync
  useEffect(() => {
    if (detailRunId && detailRunId !== selectedRunId) {
      const params = new URLSearchParams(searchParams.toString())
      params.set('runId', String(detailRunId))
      router.replace(`?${params.toString()}`, { scroll: false })
    }
  }, [detailRunId])

  // ── permission gate ──
  if (!canView) {
    return (
      <div className="p-8 text-sm text-muted-foreground text-center">
        无权限查看 TRIZ 进化趋势分析
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 头部：标题 + 创建按钮 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">TRIZ 进化趋势分析</h2>
          <p className="text-sm text-muted-foreground">
            8 大趋势评分、风险预警候选、历史对比与审查预览
          </p>
        </div>
        {canManage && (
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={creating}
            onClick={async () => {
              setCreating(true)
              try {
                const result = await createMut.mutateAsync({ projectId })
                setDetailRunId(result.id)
              } finally {
                setCreating(false)
              }
            }}
          >
            {creating ? '创建中…' : '新建分析运行'}
          </button>
        )}
      </div>

      {/* 运行列表 */}
      {runsLoading ? (
        <div className="p-4 text-sm text-muted-foreground">加载中…</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(runsData?.data ?? []).map((run) => (
            <button
              key={run.id}
              className={`rounded-lg border p-4 text-left transition hover:border-primary/50 ${
                detailRunId === run.id ? 'border-primary bg-primary/5' : 'border-border'
              }`}
              onClick={() => setDetailRunId(run.id)}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono">#{run.id}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full bg-${severityColors[run.status] ?? 'neutral'}/10 text-${severityColors[run.status] ?? 'neutral'}`}
                >
                  {runStatusLabels[run.status] ?? run.status}
                </span>
              </div>
              <div className="mt-2 text-sm">
                <span className="font-medium">8 趋势</span>
                {run.riskCount > 0 && (
                  <span className="ml-2 text-muted-foreground">· {run.riskCount} 个风险候选</span>
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {new Date(run.createdAt).toLocaleDateString('zh-CN')}
              </div>
            </button>
          ))}
          {(runsData?.data ?? []).length === 0 && (
            <div className="col-span-full p-6 text-center text-sm text-muted-foreground">
              尚无进化趋势分析运行
            </div>
          )}
        </div>
      )}

      {/* 详情面板 */}
      {detailRunId > 0 && (
        <div className="flex flex-col gap-6 rounded-lg border border-border p-6">
          {/* 8 趋势卡片网格 */}
          <div>
            <h3 className="mb-3 text-sm font-semibold">8 大趋势评分</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(trendsData?.data ?? []).map((trend) => (
                <div
                  key={trend.trendKey}
                  className={`rounded-lg border p-3 ${
                    trend.severity === 'critical'
                      ? 'border-danger/50 bg-danger/5'
                      : trend.severity === 'high'
                        ? 'border-warning/50 bg-warning/5'
                        : 'border-border'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">
                      {EVOLUTION_TREND_LABELS[trend.trendId] ?? trend.trendId}
                    </span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded bg-${severityColors[trend.severity]}/10`}
                    >
                      {trend.score.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {stageLabels[trend.stage]} · {directionLabels[trend.direction]}
                  </div>
                  {trend.warningCodes.length > 0 && (
                    <div className="mt-1 text-xs text-warning">
                      警告: {trend.warningCodes.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 风险候选队列 */}
          <div>
            <h3 className="mb-3 text-sm font-semibold">风险预警候选</h3>
            <div className="flex flex-col gap-2">
              {(risksData?.data ?? []).map((risk) => (
                <div
                  key={risk.riskKey}
                  className={`rounded-lg border p-4 ${
                    risk.severity === 'critical'
                      ? 'border-danger/50 bg-danger/5'
                      : risk.severity === 'high'
                        ? 'border-warning/50 bg-warning/5'
                        : 'border-border'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">
                        {TREND_RISK_TYPE_LABELS[risk.riskType] ?? risk.title}
                      </span>
                      <span
                        className={`ml-2 text-xs px-1.5 py-0.5 rounded bg-${severityColors[risk.severity]}/10`}
                      >
                        {riskStatusLabels[risk.status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {canAiExplain && (
                        <button
                          className="text-xs underline text-muted-foreground hover:text-foreground"
                          disabled={aiState.loading}
                          onClick={async () => {
                            setAiState({ loading: true, explanation: null, riskKey: risk.riskKey })
                            try {
                              const result = await explainMut.mutateAsync({
                                projectId,
                                runId: detailRunId,
                                riskId: risk.id!,
                              })
                              setAiState({
                                loading: false,
                                explanation: result.explanation,
                                riskKey: risk.riskKey,
                              })
                            } catch {
                              setAiState({ loading: false, explanation: null, riskKey: null })
                            }
                          }}
                        >
                          查看说明
                        </button>
                      )}
                      {canManage && risk.status !== 'blocked_stale' && (
                        <>
                          <button
                            className="text-xs underline text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              reviewMut.mutate({
                                projectId,
                                runId: detailRunId,
                                riskId: risk.id!,
                                body: { action: 'mark_reviewed' },
                              })
                            }
                          >
                            记录审查
                          </button>
                          <button
                            className="text-xs underline text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              workbenchMut.mutate({
                                projectId,
                                runId: detailRunId,
                                riskId: risk.id!,
                              })
                            }
                          >
                            加入方案篮子
                          </button>
                          <button
                            className="text-xs underline text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              decisionMut.mutate({
                                projectId,
                                runId: detailRunId,
                                riskId: risk.id!,
                              })
                            }
                          >
                            进入决策预览
                          </button>
                          <button
                            className="text-xs underline text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              draftMut.mutate({
                                projectId,
                                runId: detailRunId,
                                riskId: risk.id!,
                              })
                            }
                          >
                            进入草案预览
                          </button>
                          <button
                            className="text-xs underline text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              riskPreviewMut.mutate({
                                projectId,
                                runId: detailRunId,
                                riskId: risk.id!,
                              })
                            }
                          >
                            生成风险预览
                          </button>
                        </>
                      )}
                      {risk.status === 'blocked_stale' && (
                        <span className="text-xs text-muted-foreground">来源已过期</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{risk.rationaleSummary}</div>
                  {/* AI 解释展示 */}
                  {aiState.riskKey === risk.riskKey && aiState.loading && (
                    <div className="mt-2 text-xs italic text-muted-foreground">生成说明中…</div>
                  )}
                  {aiState.riskKey === risk.riskKey && aiState.explanation && (
                    <div
                      className={`mt-2 rounded border p-3 text-xs ${aiState.explanation.isFallback ? 'border-warning/30 bg-warning/5' : 'border-border'}`}
                    >
                      <p>{aiState.explanation.narrative}</p>
                      {aiState.explanation.degradedReason && (
                        <p className="mt-1 text-warning">
                          降级原因: {aiState.explanation.degradedReason}
                        </p>
                      )}
                      {aiState.explanation.isFallback && (
                        <p className="mt-1 text-warning">（确定性摘要，非 AI 生成）</p>
                      )}
                      {aiState.explanation.cost && (
                        <p className="mt-1 text-muted-foreground">
                          模型: {aiState.explanation.cost.model ?? 'N/A'} · 延迟:{' '}
                          {aiState.explanation.cost.latencyMs ?? 'N/A'}ms
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {(risksData?.data ?? []).length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">无风险预警候选</div>
              )}
            </div>
          </div>

          {/* 历史对比 */}
          {historyData && (
            <div>
              <h3 className="mb-3 text-sm font-semibold">历史对比</h3>
              <div className="rounded-lg border border-border p-4">
                {historyData.stale && (
                  <div className="mb-2 text-xs text-warning">
                    ⚠ 来源 hash 已变化，当前快照可能过时
                  </div>
                )}
                {historyData.forecastSuppressed && (
                  <div className="mb-2 text-xs text-muted-foreground">
                    历史样本不足，趋势预测已抑制
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {historyData.trendDeltas.map((delta) => (
                    <div key={delta.trendId} className="text-xs">
                      <span className="font-medium">
                        {EVOLUTION_TREND_LABELS[delta.trendId] ?? delta.trendId}
                      </span>
                      <span
                        className={`ml-1 ${delta.scoreDelta > 0.05 ? 'text-success' : delta.scoreDelta < -0.05 ? 'text-danger' : 'text-muted-foreground'}`}
                      >
                        {delta.scoreDelta > 0 ? '+' : ''}
                        {delta.scoreDelta.toFixed(3)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  新增风险: {historyData.riskDeltaSummary.newRiskCount} · 解决风险:{' '}
                  {historyData.riskDeltaSummary.resolvedRiskCount} · 持续:{' '}
                  {historyData.riskDeltaSummary.persistentRiskCount}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
