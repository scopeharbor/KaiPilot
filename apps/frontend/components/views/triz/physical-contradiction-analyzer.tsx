'use client'

import { useState } from 'react'
import type { PhysicalAnalysisRun, PhysicalContradictionCandidate } from '@aiproj/types'
import {
  usePhysicalAnalyses,
  usePhysicalCandidates,
  useCreatePhysicalAnalysis,
  useReviewPhysicalCandidate,
  useExplainPhysicalCandidate,
} from '@/hooks/use-physical-contradiction'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

// ---------------------------------------------------------------------------
// 运行状态中文映射
// ---------------------------------------------------------------------------
const runStatusLabels: Record<string, string> = {
  queued: '排队中',
  completed: '已完成',
  completed_with_warnings: '已完成（有警告）',
  failed: '失败',
  stale: '已过期',
  archived: '已归档',
}

const runStatusVariant: Record<string, 'primary' | 'danger' | 'neutral' | 'outline'> = {
  queued: 'neutral',
  completed: 'primary',
  completed_with_warnings: 'outline',
  failed: 'danger',
  stale: 'neutral',
  archived: 'outline',
}

const severityLabels: Record<string, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
}

const severityVariant: Record<string, 'danger' | 'primary' | 'neutral' | 'outline'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'neutral',
  low: 'outline',
}

const axisLabels: Record<string, string> = {
  time: '时间',
  space: '空间',
  condition: '条件',
  stakeholder: '干系人',
  level: '层级',
  phase: '阶段',
  resource_state: '资源状态',
  none: '无',
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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface PhysicalContradictionAnalyzerProps {
  projectId: number
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------
export default function PhysicalContradictionAnalyzer({
  projectId,
}: PhysicalContradictionAnalyzerProps) {
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)

  const {
    data: analysesData,
    isLoading: loadingRuns,
    isError: runsError,
  } = usePhysicalAnalyses(projectId)

  const createMutation = useCreatePhysicalAnalysis(projectId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">物理矛盾分析</h2>
          <p className="text-sm text-muted-foreground">
            识别项目中同一参数在不同条件下的相反要求，提供分离原则建议
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
          分析运行已创建：产生 {createMutation.data.candidates?.length ?? 0} 个候选矛盾。
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setSelectedRunId(createMutation.data?.id ?? null)
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
          无法加载分析历史。请确认拥有物理矛盾分析权限。
        </div>
      ) : !analysesData?.data?.length ? (
        <div className="rounded-md bg-muted p-8 text-center text-sm text-muted-foreground">
          尚未有物理矛盾分析。点击「新建分析」开始。
        </div>
      ) : (
        <div className="space-y-4">
          {analysesData.data.map((run: PhysicalAnalysisRun) => (
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

      {selectedRunId !== null && <CandidateList projectId={projectId} runId={selectedRunId} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 候选列表组件
// ---------------------------------------------------------------------------
function CandidateList({ projectId, runId }: { projectId: number; runId: number }) {
  const { data, isLoading, isError } = usePhysicalCandidates(projectId, runId)
  const reviewMutation = useReviewPhysicalCandidate(projectId, runId)
  const explainMutation = useExplainPhysicalCandidate(projectId, runId)
  const [activeExplainKey, setActiveExplainKey] = useState<string | null>(null)
  const [explanationText, setExplanationText] = useState('')

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
        本次分析未发现物理矛盾候选。这可能表示项目中不存在明显的同参数相反要求。
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">分析候选（{candidates.length}）</h3>

      {candidates.map((candidate: PhysicalContradictionCandidate) => (
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
                    {paramLabels[candidate.parameterKey] ?? candidate.parameterKey}
                  </Badge>
                  <Badge variant="neutral">
                    {axisLabels[candidate.separationAxis] ?? candidate.separationAxis}分离
                  </Badge>
                  {candidate.status === 'blocked_stale' && <Badge variant="danger">已过期</Badge>}
                  {candidate.warningCodes?.length > 0 && (
                    <Badge variant="outline" className="text-amber-600">
                      {candidate.warningCodes.length} 个警告
                    </Badge>
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium">要求A：{candidate.requirementA.summary}</p>
                  <p className="text-sm font-medium">要求B：{candidate.requirementB.summary}</p>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {candidate.rationaleSummary}
                  </p>
                </div>

                {candidate.principleRefs?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {candidate.principleRefs.map((p) => (
                      <span
                        key={p.principleKey}
                        className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                        title={p.advice}
                      >
                        {p.name}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 text-xs text-muted-foreground">
                  <span>置信度：{(candidate.confidence * 100).toFixed(0)}%</span>
                  {candidate.ruleId && <span>规则：{candidate.ruleId}</span>}
                </div>
              </div>

              <div className="flex shrink-0 flex-col gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setActiveExplainKey(candidate.candidateKey)
                    explainMutation.mutate(candidate.candidateKey, {
                      onSuccess: (data) => {
                        setExplanationText(data.explanation?.narrative ?? '无法生成解释')
                      },
                    })
                  }}
                  disabled={explainMutation.isPending}
                >
                  说明
                </Button>
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
              </div>
            </div>

            {activeExplainKey === candidate.candidateKey && explanationText && (
              <div className="mt-3 rounded-md bg-muted p-3 text-sm">
                <p className="font-medium">分析说明</p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{explanationText}</p>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
