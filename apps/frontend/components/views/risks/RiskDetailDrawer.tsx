'use client'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/Sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { CommentThread } from '@/components/views/comments/CommentThread'
import { useTransitionRiskStatus } from '@/hooks/use-risks'
import { useResponsePlans, useRiskHistory } from '@/hooks/use-risks-v2'
import { RISK_ALLOWED_TRANSITIONS, type RiskStatus } from '@aiproj/types'
import type { Risk } from '@/lib/api/risks'
import type { RiskLevel, ResponseStrategyType } from '@/lib/api/risks-v2'

const STATUS_LABELS: Record<RiskStatus, string> = {
  identified: '已识别',
  analyzing: '分析中',
  mitigating: '缓解中',
  resolved: '已解决',
  accepted: '已接受',
  closed: '已关闭',
}

const CATEGORY_LABELS: Record<string, string> = {
  technical: '技术',
  schedule: '进度',
  cost: '成本',
  resource: '资源',
  external: '外部',
  organizational: '组织',
  legal: '法律',
  other: '其他',
}

const LEVEL_VARIANTS: Record<RiskLevel, 'neutral' | 'success' | 'warning' | 'danger'> = {
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
}

const LEVEL_LABELS: Record<RiskLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
}

const STRATEGY_LABELS: Record<ResponseStrategyType, string> = {
  avoid: '规避',
  mitigate: '缓解',
  transfer: '转移',
  accept: '接受',
  contingency: '应急',
  escalate: '升级',
}

const PLAN_STATUS_LABELS: Record<string, string> = {
  planned: '已计划',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
  overdue: '已逾期',
}

interface RiskDetailDrawerProps {
  risk: Risk | null
  projectId: number
  open: boolean
  onClose: () => void
}

export function RiskDetailDrawer({ risk, projectId, open, onClose }: RiskDetailDrawerProps) {
  const transitionMutation = useTransitionRiskStatus(projectId, risk?.id ?? 0)
  const { data: plansRes } = useResponsePlans(projectId, risk?.id ?? null)
  const { data: historyRes } = useRiskHistory(projectId, risk?.id ?? null)

  if (!risk) return null

  const currentStatus = risk.status as RiskStatus
  const allowedTransitions = RISK_ALLOWED_TRANSITIONS[currentStatus] ?? []
  const riskLevel = (risk as Risk & { riskLevel?: RiskLevel }).riskLevel
  const plans = plansRes?.data ?? []
  const history = historyRes?.data ?? []

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{risk.title}</SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="detail" className="mt-6">
          <TabsList>
            <TabsTrigger value="detail">详细信息</TabsTrigger>
            {projectId && <TabsTrigger value="plans">应对计划</TabsTrigger>}
            {projectId && <TabsTrigger value="history">风险历史</TabsTrigger>}
            {projectId && <TabsTrigger value="comments">评论</TabsTrigger>}
          </TabsList>

          {/* ---- 详细信息 Tab ---- */}
          <TabsContent value="detail" className="space-y-6">
            {/* 标签 */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{CATEGORY_LABELS[risk.category] ?? risk.category}</Badge>
              <Badge>{STATUS_LABELS[currentStatus]}</Badge>
              {riskLevel && (
                <Badge variant={LEVEL_VARIANTS[riskLevel]}>{LEVEL_LABELS[riskLevel]}</Badge>
              )}
              {(risk as Risk & { priority?: string }).priority && (
                <Badge variant="info">{(risk as Risk & { priority?: string }).priority}</Badge>
              )}
              {risk.aiMetadata?.aiMarker && <Badge variant="ai">AI 生成</Badge>}
            </div>

            {/* 描述 */}
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{risk.description}</p>

            {/* 概率/影响/得分 */}
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-500">概率</span>
                <div className="font-medium">{risk.probability}</div>
              </div>
              <div>
                <span className="text-gray-500">影响</span>
                <div className="font-medium">{risk.impact}</div>
              </div>
              <div>
                <span className="text-gray-500">得分</span>
                <div className="font-medium">{risk.score}</div>
              </div>
            </div>

            {/* V2 触发条件 */}
            {(risk as Risk & { triggerCondition?: string | null }).triggerCondition && (
              <div className="space-y-1">
                <h4 className="font-medium text-gray-900 text-sm">触发条件</h4>
                <p className="text-sm text-gray-700">
                  {(risk as Risk & { triggerCondition?: string | null }).triggerCondition}
                </p>
              </div>
            )}

            {/* 复查日期 */}
            {(risk as Risk & { nextReviewAt?: string | null }).nextReviewAt && (
              <div className="space-y-1">
                <h4 className="font-medium text-gray-900 text-sm">复查安排</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">下次复查</span>
                    <div className="font-medium">
                      {new Date(
                        (risk as Risk & { nextReviewAt?: string | null }).nextReviewAt!,
                      ).toLocaleDateString('zh-CN')}
                    </div>
                  </div>
                  {(risk as Risk & { lastReviewAt?: string | null }).lastReviewAt && (
                    <div>
                      <span className="text-gray-500">上次复查</span>
                      <div className="font-medium">
                        {new Date(
                          (risk as Risk & { lastReviewAt?: string | null }).lastReviewAt!,
                        ).toLocaleDateString('zh-CN')}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 关闭原因（仅 closed 状态） */}
            {currentStatus === 'closed' && (
              <div className="space-y-1">
                <h4 className="font-medium text-gray-900 text-sm">关闭信息</h4>
                {(risk as Risk & { closedReason?: string | null }).closedReason && (
                  <div className="text-sm">
                    <span className="text-gray-500">原因：</span>
                    <span className="text-gray-700">
                      {(risk as Risk & { closedReason?: string | null }).closedReason}
                    </span>
                  </div>
                )}
                {(risk as Risk & { closedNotes?: string | null }).closedNotes && (
                  <div className="text-sm">
                    <span className="text-gray-500">备注：</span>
                    <span className="text-gray-700">
                      {(risk as Risk & { closedNotes?: string | null }).closedNotes}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* 缓解策略 */}
            {(risk.mitigationStrategy || risk.contingencyPlan || risk.triggerEvent) && (
              <div className="space-y-2">
                <h4 className="font-medium text-gray-900">缓解策略</h4>
                {risk.mitigationStrategy && (
                  <div className="text-sm">
                    <span className="text-gray-500">策略：</span>
                    <span className="text-gray-700">{risk.mitigationStrategy}</span>
                  </div>
                )}
                {risk.contingencyPlan && (
                  <div className="text-sm">
                    <span className="text-gray-500">应急计划：</span>
                    <span className="text-gray-700">{risk.contingencyPlan}</span>
                  </div>
                )}
                {risk.triggerEvent && (
                  <div className="text-sm">
                    <span className="text-gray-500">触发事件：</span>
                    <span className="text-gray-700">{risk.triggerEvent}</span>
                  </div>
                )}
              </div>
            )}

            {/* 残余评估 */}
            {risk.residualProbability !== null && risk.residualImpact !== null && (
              <div className="space-y-2">
                <h4 className="font-medium text-gray-900">残余风险</h4>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">残余概率</span>
                    <div className="font-medium">{risk.residualProbability}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">残余影响</span>
                    <div className="font-medium">{risk.residualImpact}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">残余得分</span>
                    <div className="font-medium">{risk.residualScore}</div>
                  </div>
                </div>
              </div>
            )}

            {/* AI 元数据 */}
            {risk.aiMetadata?.aiMarker && (
              <div className="space-y-2">
                <h4 className="font-medium text-gray-900">AI 信息</h4>
                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-gray-500">置信度：</span>
                    {Math.round(risk.aiMetadata.aiMarker.confidence * 100)}%
                  </div>
                  <div>
                    <span className="text-gray-500">来源：</span>
                    {risk.aiMetadata.aiMarker.source}
                  </div>
                  <div>
                    <span className="text-gray-500">理由：</span>
                    {risk.aiMetadata.aiMarker.reason}
                  </div>
                </div>
              </div>
            )}

            {/* 状态推进 */}
            {allowedTransitions.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium text-gray-900">状态推进</h4>
                <div className="flex flex-wrap gap-2">
                  {allowedTransitions.map((target) => (
                    <Button
                      key={target}
                      variant="outline"
                      size="sm"
                      disabled={transitionMutation.isPending}
                      onClick={() => transitionMutation.mutate(target)}
                    >
                      → {STATUS_LABELS[target]}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ---- 应对计划 Tab ---- */}
          {projectId && (
            <TabsContent value="plans" className="space-y-3">
              {plans.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">暂无应对计划</div>
              ) : (
                plans.map((plan) => (
                  <div key={plan.id} className="p-3 rounded-lg border border-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-800">
                        {STRATEGY_LABELS[plan.strategyType]} — {plan.actionDescription.slice(0, 60)}
                      </span>
                      <Badge
                        variant={
                          plan.status === 'completed'
                            ? 'success'
                            : plan.status === 'cancelled'
                              ? 'neutral'
                              : plan.status === 'overdue'
                                ? 'danger'
                                : 'info'
                        }
                      >
                        {PLAN_STATUS_LABELS[plan.status] ?? plan.status}
                      </Badge>
                    </div>
                    {plan.targetDate && (
                      <div className="text-xs text-gray-500 mt-1">
                        目标日期：{new Date(plan.targetDate).toLocaleDateString('zh-CN')}
                      </div>
                    )}
                    {plan.completionEvidence && (
                      <div className="text-xs text-gray-500 mt-1">
                        完成证据：{plan.completionEvidence}
                      </div>
                    )}
                  </div>
                ))
              )}
            </TabsContent>
          )}

          {/* ---- 风险历史 Tab ---- */}
          {projectId && (
            <TabsContent value="history" className="space-y-3">
              {history.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">暂无历史记录</div>
              ) : (
                history.map((entry) => (
                  <div key={entry.id} className="p-3 rounded-lg border border-border">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800">{entry.eventType}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(entry.occurredAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    {entry.summary && Object.keys(entry.summary).length > 0 && (
                      <div className="text-xs text-gray-500 mt-1">
                        {Object.entries(entry.summary).map(([k, v]) => (
                          <span key={k} className="mr-3">
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="text-xs text-gray-400 mt-1">
                      来源: {entry.sourceType}
                      {entry.sourceRef ? ` / ${entry.sourceRef}` : ''}
                    </div>
                  </div>
                ))
              )}
            </TabsContent>
          )}

          {/* ---- 评论 Tab ---- */}
          {projectId && (
            <TabsContent value="comments" className="space-y-3">
              <CommentThread projectId={projectId} entityType="risk" entityId={risk.id} />
            </TabsContent>
          )}
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
