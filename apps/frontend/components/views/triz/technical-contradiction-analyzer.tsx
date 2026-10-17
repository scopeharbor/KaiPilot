'use client'

import { useState } from 'react'
import type { TechnicalAnalysisRun, TechnicalContradictionCandidate } from '@aiproj/types'
import {
  useTechnicalAnalyses,
  useTechnicalCandidates,
  useCreateTechnicalAnalysis,
  useReviewTechnicalCandidate,
  useExplainTechnicalCandidate,
  useTechnicalConfirmationPreview,
  useTechnicalHandoffPreview,
} from '@/hooks/use-technical-contradiction'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

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

const runStatusVariant: Record<
  string,
  'neutral' | 'danger' | 'info' | 'outline' | 'success' | 'warning'
> = {
  queued: 'info',
  completed: 'success',
  completed_with_warnings: 'warning',
  failed: 'danger',
  stale: 'warning',
  archived: 'outline',
}

const severityLabels: Record<string, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
}

const severityVariant: Record<string, 'danger' | 'warning' | 'neutral' | 'outline'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'outline',
}

const paramLabels: Record<string, string> = {
  scope: '范围',
  duration: '工期',
  resource_load: '资源负载',
  quality: '质量',
  stability: '稳定性',
  risk_level: '风险水平',
  cost: '成本',
  information_completeness: '信息完整度',
  flexibility: '灵活性',
  throughput: '吞吐',
  uncertainty: '不确定性',
  maintainability: '可维护性',
}

const candidateStatusLabels: Record<string, string> = {
  unreviewed: '待审查',
  reviewed: '已审查',
  previewed: '已预览',
  blocked_stale: '已过期',
  dismissed: '已忽略',
}

const warningLabels: Record<string, string> = {
  SOURCE_UNAVAILABLE: '来源不可用',
  SOURCE_STALE: '来源过期',
  PERMISSION_RESTRICTED: '权限受限',
  INSUFFICIENT_EVIDENCE: '证据不足',
  OUTSIDE_REGISTRY: '超出目录',
  AMBIGUOUS_PARAMETER_PAIR: '参数对模糊',
  REGISTRY_MISS: '原理未收录',
  AI_EXPLANATION_FALLBACK: 'AI 已降级',
  AI_EXPLANATION_BLOCKED: 'AI 被阻断',
  HANDOFF_BLOCKED_STALE: '交接被阻止',
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface TechnicalContradictionAnalyzerProps {
  projectId: number
  /** 权限标记：缺权限时隐藏敏感内容 */
  canAnalyze?: boolean
  canManage?: boolean
  canAiExplain?: boolean
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------
export default function TechnicalContradictionAnalyzer({
  projectId,
  canAnalyze = true,
  canManage = true,
  canAiExplain = true,
}: TechnicalContradictionAnalyzerProps) {
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)

  const {
    data: analysesData,
    isLoading: loadingRuns,
    isError: runsError,
  } = useTechnicalAnalyses(projectId)

  const createMutation = useCreateTechnicalAnalysis(projectId)

  // 权限不足时隐藏敏感内容（计数、来源、参数标签）
  if (!canAnalyze) {
    return (
      <div className="rounded-md bg-muted p-6 text-center text-sm text-muted-foreground">
        您没有技术矛盾分析权限。
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">技术矛盾分析</h2>
          <p className="text-sm text-muted-foreground">
            识别项目中改善某参数会恶化另一参数的技术矛盾，提供发明原理建议供审查
          </p>
        </div>

        <Button onClick={() => createMutation.mutate({})} disabled={createMutation.isPending}>
          {createMutation.isPending ? '分析中...' : '新建分析'}
        </Button>
      </div>

      {createMutation.isError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          创建分析失败，请检查权限或稍后重试。
        </div>
      )}

      {createMutation.isSuccess && createMutation.data && (
        <div className="rounded-md bg-primary/10 p-3 text-sm">
          分析运行已创建：产生{' '}
          {(createMutation.data as { candidates?: unknown[] }).candidates?.length ?? 0} 个候选矛盾。
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setSelectedRunId((createMutation.data as { id: number }).id ?? null)
            }}
          >
            查看结果
          </Button>
        </div>
      )}

      {loadingRuns ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : runsError ? (
        <div className="rounded-md bg-muted p-6 text-center text-sm text-muted-foreground">
          无法加载分析历史。请确认拥有技术矛盾分析权限。
        </div>
      ) : !analysesData?.data?.length ? (
        <div className="rounded-md bg-muted p-8 text-center text-sm text-muted-foreground">
          尚未有技术矛盾分析。点击「新建分析」开始。
        </div>
      ) : (
        <div className="space-y-4">
          {analysesData.data.map((run: TechnicalAnalysisRun) => (
            <Card
              key={run.id}
              className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                selectedRunId === run.id ? 'ring-2 ring-primary' : ''
              }`}
              onClick={() => setSelectedRunId(run.id)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">分析 #{run.id}</CardTitle>
                  <Badge variant={runStatusVariant[run.status] ?? 'neutral'}>
                    {runStatusLabels[run.status] ?? run.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <span>候选数：{run.candidateCount}</span>
                  <span>创建：{new Date(run.createdAt).toLocaleDateString('zh-CN')}</span>
                  <span>版本：{run.ruleVersion}</span>
                </div>
                {run.warningSummary?.length > 0 && (
                  <div className="mt-2 text-xs text-amber-600">
                    ⚠ {run.warningSummary.length} 个警告
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedRunId !== null && (
        <CandidateList
          projectId={projectId}
          runId={selectedRunId}
          canManage={canManage}
          canAiExplain={canAiExplain}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 候选列表组件
// ---------------------------------------------------------------------------
function CandidateList({
  projectId,
  runId,
  canManage,
  canAiExplain,
}: {
  projectId: number
  runId: number
  canManage: boolean
  canAiExplain: boolean
}) {
  const { data, isLoading, isError } = useTechnicalCandidates(projectId, runId)
  const reviewMutation = useReviewTechnicalCandidate(projectId, runId)
  const explainMutation = useExplainTechnicalCandidate(projectId, runId)
  const confirmationMutation = useTechnicalConfirmationPreview(projectId, runId)
  const handoffMutation = useTechnicalHandoffPreview(projectId, runId)
  const [activeExplainKey, setActiveExplainKey] = useState<string | null>(null)
  const [explanationText, setExplanationText] = useState('')
  const [drawerCandidate, setDrawerCandidate] = useState<TechnicalContradictionCandidate | null>(
    null,
  )

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
        无法加载候选列表。
      </div>
    )
  }

  const candidates = data?.data ?? []

  if (candidates.length === 0) {
    return (
      <div className="rounded-md bg-muted p-6 text-center text-sm text-muted-foreground">
        本次分析未发现技术矛盾候选。这可能表示项目中不存在明显的参数对立关系。
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">分析候选（{candidates.length}）</h3>

      {candidates.map((candidate: TechnicalContradictionCandidate) => (
        <Card
          key={candidate.candidateKey}
          className={candidate.status === 'blocked_stale' ? 'opacity-60' : ''}
        >
          <CardContent className="py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={severityVariant[candidate.severity] ?? 'neutral'}>
                    {severityLabels[candidate.severity] ?? candidate.severity}
                  </Badge>
                  <Badge variant="outline">
                    改善：
                    {paramLabels[candidate.improvingParameterKey] ??
                      candidate.improvingParameterKey}
                  </Badge>
                  <Badge variant="outline">
                    恶化：
                    {paramLabels[candidate.worseningParameterKey] ??
                      candidate.worseningParameterKey}
                  </Badge>
                  <Badge variant="neutral">
                    {candidateStatusLabels[candidate.status] ?? candidate.status}
                  </Badge>
                  {candidate.status === 'blocked_stale' && (
                    <Badge variant="danger">来源已过期</Badge>
                  )}
                  {candidate.warningCodes?.length > 0 && (
                    <Badge variant="outline" className="text-amber-600">
                      {candidate.warningCodes.length} 个警告
                    </Badge>
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium">{candidate.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {candidate.rationaleSummary}
                  </p>
                </div>

                {candidate.principleRefs?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {candidate.principleRefs.map((p) => (
                      <span
                        key={p.principleId}
                        className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                        title={p.advice}
                      >
                        {p.name}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>置信度：{(candidate.confidence * 100).toFixed(0)}%</span>
                  <span>影响分：{candidate.impactScore.toFixed(2)}</span>
                  {candidate.ruleId && <span>规则：{candidate.ruleId}</span>}
                  <span>来源新鲜度：{candidate.status === 'blocked_stale' ? '过期' : '新鲜'}</span>
                </div>

                {candidate.warningCodes?.length > 0 && (
                  <div className="flex flex-wrap gap-1 text-xs">
                    {candidate.warningCodes.map((w) => (
                      <span key={w} className="text-amber-600">
                        ⚠ {warningLabels[w] ?? w}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 flex-col gap-1">
                <Button variant="ghost" size="sm" onClick={() => setDrawerCandidate(candidate)}>
                  详情
                </Button>
                {canAiExplain && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setActiveExplainKey(candidate.candidateKey)
                      explainMutation.mutate(candidate.candidateKey, {
                        onSuccess: (data: { explanation: { narrative: string } }) => {
                          setExplanationText(data.explanation?.narrative ?? '无法生成说明')
                        },
                      })
                    }}
                    disabled={explainMutation.isPending}
                  >
                    说明
                  </Button>
                )}
                {canManage && candidate.status !== 'blocked_stale' && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        reviewMutation.mutate({
                          candidateKey: candidate.candidateKey,
                          body: { action: 'mark_reviewed' },
                        })
                      }
                    >
                      标记已审
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => confirmationMutation.mutate(candidate.candidateKey)}
                      disabled={confirmationMutation.isPending}
                    >
                      确认预览
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        handoffMutation.mutate({
                          candidateKey: candidate.candidateKey,
                          targetType: 'decision_log',
                        })
                      }
                      disabled={handoffMutation.isPending}
                    >
                      交接预览
                    </Button>
                  </>
                )}
              </div>
            </div>

            {activeExplainKey === candidate.candidateKey && explanationText && (
              <div className="mt-3 rounded-md bg-muted p-3 text-sm">
                <p className="font-medium">分析说明（仅供参考，不自动执行）</p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{explanationText}</p>
              </div>
            )}

            {confirmationMutation.data &&
              confirmationMutation.variables === candidate.candidateKey && (
                <div className="mt-3 rounded-md bg-primary/5 p-3 text-xs">
                  <p className="font-medium">确认预览（需人工确认后才写入正式矛盾记录）</p>
                  <p className="mt-1 text-muted-foreground">
                    投影类型：{confirmationMutation.data.projectedType}； 改善：
                    {paramLabels[confirmationMutation.data.improvingParameterKey] ??
                      confirmationMutation.data.improvingParameterKey}
                    ； 恶化：
                    {paramLabels[confirmationMutation.data.worseningParameterKey] ??
                      confirmationMutation.data.worseningParameterKey}
                  </p>
                </div>
              )}

            {handoffMutation.data &&
              handoffMutation.variables?.candidateKey === candidate.candidateKey && (
                <div className="mt-3 rounded-md bg-primary/5 p-3 text-xs">
                  <p className="font-medium">
                    交接预览（目标：{handoffMutation.data.targetType}，不自动应用）
                  </p>
                  {handoffMutation.data.stale && (
                    <p className="mt-1 text-amber-600">来源已过期，交接被阻止。</p>
                  )}
                </div>
              )}
          </CardContent>
        </Card>
      ))}

      {drawerCandidate && (
        <DetailDrawer candidate={drawerCandidate} onClose={() => setDrawerCandidate(null)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 详情抽屉
// ---------------------------------------------------------------------------
function DetailDrawer({
  candidate,
  onClose,
}: {
  candidate: TechnicalContradictionCandidate
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/30 sm:items-center sm:justify-end">
      <div className="h-[80vh] w-full max-w-md overflow-y-auto rounded-t-lg border bg-background p-4 shadow-lg sm:rounded-l-lg">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-base font-semibold">候选详情</h4>
          <Button variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <p className="text-muted-foreground">标题</p>
            <p className="font-medium">{candidate.title}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-muted-foreground">改善参数</p>
              <p>
                {paramLabels[candidate.improvingParameterKey] ?? candidate.improvingParameterKey}
              </p>
              <p className="text-xs text-muted-foreground">{candidate.improvingDirection}</p>
            </div>
            <div>
              <p className="text-muted-foreground">恶化参数</p>
              <p>
                {paramLabels[candidate.worseningParameterKey] ?? candidate.worseningParameterKey}
              </p>
              <p className="text-xs text-muted-foreground">{candidate.worseningDirection}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <p className="text-muted-foreground">严重度</p>
              <p>{severityLabels[candidate.severity] ?? candidate.severity}</p>
            </div>
            <div>
              <p className="text-muted-foreground">置信度</p>
              <p>{(candidate.confidence * 100).toFixed(0)}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">影响分</p>
              <p>{candidate.impactScore.toFixed(2)}</p>
            </div>
          </div>
          <div>
            <p className="text-muted-foreground">确定性理由</p>
            <p className="whitespace-pre-wrap">{candidate.rationaleSummary}</p>
          </div>
          {candidate.principleRefs?.length > 0 && (
            <div>
              <p className="text-muted-foreground">建议发明原理</p>
              <ul className="mt-1 space-y-1">
                {candidate.principleRefs.map((p) => (
                  <li key={p.principleId} className="text-xs">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground">
                      （相关度 {(p.relevance * 100).toFixed(0)}%）
                    </span>
                    <p className="text-muted-foreground">{p.advice}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {candidate.evidenceRefs?.length > 0 && (
            <div>
              <p className="text-muted-foreground">证据引用（低敏）</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {candidate.evidenceRefs.map((e, i) => (
                  <li key={i}>
                    {e.entityType} #{e.entityId}：{e.lowSensitiveTitle}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {candidate.warningCodes?.length > 0 && (
            <div>
              <p className="text-muted-foreground">警告</p>
              <ul className="mt-1 space-y-0.5 text-xs text-amber-600">
                {candidate.warningCodes.map((w) => (
                  <li key={w}>⚠ {warningLabels[w] ?? w}</li>
                ))}
              </ul>
            </div>
          )}
          {candidate.aiExplanationRef && (
            <div>
              <p className="text-muted-foreground">AI 解释引用</p>
              <p className="text-xs">{candidate.aiExplanationRef}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
