'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Textarea } from '@/components/ui/Textarea'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import {
  useAssistantRuns,
  useAssistantRunDetail,
  useSubmitAssistantMessage,
} from '@/hooks/use-triz-assistant'
import type { AiTrizAssistantDestination } from '@aiproj/types'

// ── 置信度 Badge 映射 ──
const confidenceVariant: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  high: 'success',
  medium: 'warning',
  low: 'neutral',
  fallback: 'danger',
}

const confidenceLabel: Record<string, string> = {
  high: '高置信',
  medium: '中置信',
  low: '低置信',
  fallback: '降级',
}

const warningLabel: Record<string, string> = {
  SOURCE_UNAVAILABLE: '来源不可用',
  SOURCE_STALE: '来源已陈旧',
  SOURCE_PERMISSION_DENIED: '来源无权限',
  CONTEXT_TRUNCATED: '上下文已截断',
  MISSING_INFORMATION: '信息不足',
  AMBIGUOUS_INTENT: '意图模糊',
  DESTINATION_UNAVAILABLE: '目标不可用',
  AI_FALLBACK: 'AI 已降级',
  AI_HALLUCINATION_DETECTED: '幻觉检测',
  AI_BUDGET_EXCEEDED: 'AI 预算超限',
  AI_PROVIDER_ERROR: 'AI 服务错误',
  STALE_ACTION_BLOCKED: '操作已过期',
  FEATURE_FLAG_DISABLED: '功能已禁用',
  CROSS_ORGANIZATION_BLOCKED: '跨组织已阻断',
  INACCESSIBLE_TARGET: '目标不可访问',
}

// ── 目的地图标标签 ──
const destinationLabel: Record<AiTrizAssistantDestination, string> = {
  clarification_cards: '澄清卡片',
  contradiction_matrix: '矛盾矩阵',
  technical_contradiction_analyzer: '技术矛盾分析',
  physical_contradiction_analyzer: '物理矛盾分析',
  ifr_visualization: 'IFR 可视化',
  function_analysis_diagram: '功能分析图',
  resource_analyzer: '资源分析',
  evolution_trend_analysis: '进化趋势',
  recommendation_rationale: '推荐理由',
  innovation_workbench: '创新工作台',
  decision_center: '决策中心',
  draft_preview: 'Draft 预览',
}

// ── 主组件 ──
export default function TrizAssistantPanel() {
  const params = useParams()
  const projectId = params?.projectId as string

  const [message, setMessage] = useState('')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const runsQuery = useAssistantRuns(projectId, { page: 1, perPage: 20, sort: '-createdAt' })
  const runDetailQuery = useAssistantRunDetail(projectId, selectedRunId ?? '')
  const submitMutation = useSubmitAssistantMessage(projectId)

  const handleSubmit = async () => {
    if (!message.trim()) return
    try {
      const result = await submitMutation.mutateAsync({ message: message.trim() })
      setMessage('')
      setSelectedRunId(result.data.runId)
    } catch {
      // 错误由 mutation state 展示
    }
  }

  const runs = runsQuery.data?.data ?? []
  const runDetail = runDetailQuery.data?.data
  const latestResponse = runDetail?.latestResponse

  return (
    <div className="flex h-full gap-4 p-4">
      {/* ── 左侧：运行历史 ── */}
      <aside className="w-72 flex-shrink-0 space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">助手会话</h3>
        {runsQuery.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
        ) : runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无会话记录</p>
        ) : (
          runs.map((run) => (
            <Card
              key={run.runId}
              className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                selectedRunId === run.runId ? 'border-primary' : ''
              }`}
              onClick={() => setSelectedRunId(run.runId)}
            >
              <CardContent className="p-3">
                <p className="text-xs font-medium truncate">
                  {run.intentSummary.slice(0, 60)}
                  {run.intentSummary.length > 60 ? '…' : ''}
                </p>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge variant={run.fallback ? 'danger' : 'neutral'}>
                    {run.fallback ? '降级' : '正常'}
                  </Badge>
                  {run.warningCodes.slice(0, 2).map((w) => (
                    <Badge key={w} variant="warning">
                      {warningLabel[w] ?? w}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </aside>

      {/* ── 主区域：对话与推荐 ── */}
      <main className="flex-1 flex flex-col space-y-4">
        {/* 推荐卡片 */}
        {latestResponse && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">推荐 TRIZ 工具</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {latestResponse.routeDecisions
                .filter((d) => d.confidence === 'high' || d.confidence === 'medium')
                .map((decision) => (
                  <Card key={decision.routeId}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">
                          {destinationLabel[decision.destination]}
                        </CardTitle>
                        <Badge variant={confidenceVariant[decision.confidence]}>
                          {confidenceLabel[decision.confidence]}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground">{decision.reason}</p>
                      {decision.warnings.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {decision.warnings.map((w) => (
                            <Badge key={w} variant="warning">
                              {warningLabel[w] ?? w}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
            </div>
          </section>
        )}

        {/* 推荐动作 */}
        {latestResponse && latestResponse.recommendedActions.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">建议操作</h3>
            <div className="flex flex-wrap gap-2">
              {latestResponse.recommendedActions.map((action) => (
                <Button
                  key={action.actionId}
                  variant="outline"
                  size="sm"
                  disabled={action.isStale}
                  title={action.description}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </section>
        )}

        {/* 澄清提示 */}
        {latestResponse && latestResponse.clarificationPrompts.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">需要补充信息</h3>
            {latestResponse.clarificationPrompts.map((prompt) => (
              <Alert key={prompt.promptId}>
                <AlertDescription>
                  <p className="text-sm">{prompt.question}</p>
                  {prompt.quickOptions && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {prompt.quickOptions.map((opt) => (
                        <Button key={opt} variant="ghost" size="sm" onClick={() => setMessage(opt)}>
                          {opt}
                        </Button>
                      ))}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            ))}
          </section>
        )}

        {/* AI 降级状态 */}
        {latestResponse?.fallback && (
          <Alert variant="warning">
            <AlertDescription>
              AI 增强已降级为确定性建议
              {latestResponse.degradedReason && `（${latestResponse.degradedReason}）`}
            </AlertDescription>
          </Alert>
        )}

        {/* 警告列表 */}
        {latestResponse && latestResponse.warnings.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {latestResponse.warnings.map((w) => (
              <Badge key={w} variant="warning">
                {warningLabel[w] ?? w}
              </Badge>
            ))}
          </div>
        )}

        {/* 输入区 */}
        <div className="mt-auto flex items-end gap-2 pt-4 border-t">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="描述你的 TRIZ 问题，例如：'如何改善质量但降低速度？'"
            rows={2}
            className="flex-1 resize-none"
            disabled={submitMutation.isPending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
          />
          <Button
            onClick={handleSubmit}
            disabled={!message.trim() || submitMutation.isPending}
            size="sm"
          >
            {submitMutation.isPending ? '分析中…' : '提交'}
          </Button>
        </div>
      </main>
    </div>
  )
}
