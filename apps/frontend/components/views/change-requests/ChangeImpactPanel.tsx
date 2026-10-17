'use client'

import { useState } from 'react'
import {
  useImpactAnalysis,
  useListImpactAnalyses,
  useCreateImpactAnalysis,
  useRefreshImpactAnalysis,
  useConfirmImpactAnalysis,
  useConfirmStaleImpactAnalysis,
  useGenerateAiExplanation,
} from '@/lib/api/use-change-impact'
import type { ChangeImpactSeverity } from '@/lib/api/change-requests'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'

const SEVERITY_COLORS: Record<ChangeImpactSeverity, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  none: 'bg-gray-50 text-gray-400 dark:bg-gray-900 dark:text-gray-500',
}

const SEVERITY_LABELS: Record<ChangeImpactSeverity, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  none: '无',
}

const STATUS_LABELS: Record<string, string> = {
  completed: '已完成',
  pending: '分析中',
  failed: '失败',
  stale: '已过期',
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  pending: 'bg-blue-100 text-blue-800',
  failed: 'bg-red-100 text-red-800',
  stale: 'bg-gray-100 text-gray-600',
}

interface Props {
  projectId: number
  changeRequestId: number
  hasCreatePermission?: boolean
  hasManagePermission?: boolean
  currentAnalysisId?: number | null
}

export default function ChangeImpactPanel({
  projectId,
  changeRequestId,
  hasCreatePermission = false,
  hasManagePermission = false,
  currentAnalysisId,
}: Props) {
  const [showConfirmInput, setShowConfirmInput] = useState(false)
  const [showStaleConfirmInput, setShowStaleConfirmInput] = useState(false)
  const [confirmReason, setConfirmReason] = useState('')
  const [expandedItem, setExpandedItem] = useState<number | null>(null)

  const { data: listData, isLoading: listLoading } = useListImpactAnalyses(
    projectId,
    changeRequestId,
  )
  const recentAnalyses = listData?.data?.slice(0, 5) ?? []
  const activeAnalysisId = currentAnalysisId ?? recentAnalyses[0]?.id ?? 0

  // 获取最新分析
  const {
    data: analysisData,
    isLoading: analysisLoading,
    error: analysisError,
  } = useImpactAnalysis(activeAnalysisId, projectId)

  const createAnalysis = useCreateImpactAnalysis(projectId, changeRequestId)
  const refreshAnalysis = useRefreshImpactAnalysis(projectId)
  const confirmAnalysis = useConfirmImpactAnalysis(projectId)
  const confirmStale = useConfirmStaleImpactAnalysis(projectId)
  const aiExplanation = useGenerateAiExplanation(projectId)

  const currentAnalysis = activeAnalysisId ? analysisData?.data : undefined
  const isLoading = analysisLoading || listLoading

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />
  }

  if (analysisError && !currentAnalysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>影响分析</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="warning">加载影响分析失败</Alert>
          {hasCreatePermission && (
            <Button className="mt-3" size="sm" onClick={() => createAnalysis.mutate(undefined)}>
              创建分析
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>影响分析</CardTitle>
          {currentAnalysis && (
            <Badge className={STATUS_COLORS[currentAnalysis.status] ?? ''}>
              {STATUS_LABELS[currentAnalysis.status] ?? currentAnalysis.status}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {createAnalysis.isPending && <Alert>正在创建影响分析…</Alert>}
        {createAnalysis.isError && (
          <Alert variant="danger">创建失败：{(createAnalysis.error as Error).message}</Alert>
        )}
        {createAnalysis.isSuccess && <Alert variant="success">影响分析已创建</Alert>}

        {/* 无分析 */}
        {!currentAnalysis && recentAnalyses.length === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <p>尚未生成影响分析</p>
            {hasCreatePermission && (
              <Button className="mt-3" size="sm" onClick={() => createAnalysis.mutate(undefined)}>
                生成影响分析
              </Button>
            )}
          </div>
        )}

        {/* 分析摘要 */}
        {currentAnalysis?.summary && (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              {Object.entries(currentAnalysis.summary.severityDistribution).map(
                ([sev, count]) =>
                  count > 0 && (
                    <Badge key={sev} className={SEVERITY_COLORS[sev as ChangeImpactSeverity]}>
                      {SEVERITY_LABELS[sev as ChangeImpactSeverity]}: {count}
                    </Badge>
                  ),
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              共 <strong>{currentAnalysis.summary.totalAffected}</strong> 个受影响项
              {currentAnalysis.summary.criticalPathAffected && ' · 关键路径受影响'}
              {currentAnalysis.summary.hasBlockingWarnings && ' · 含阻断性警告'}
            </p>

            {/* 维度摘要卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {currentAnalysis.summary.dimensionSummaries.map((ds) => (
                <div key={ds.dimension} className="border rounded p-2 text-xs">
                  <div className="font-medium">{ds.dimension}</div>
                  <div className="text-muted-foreground">
                    {ds.affectedCount} 项 · {SEVERITY_LABELS[ds.highestSeverity]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 过期状态 */}
        {currentAnalysis?.isStale && (
          <Alert variant="warning">
            影响分析已过期：{currentAnalysis.staleReason ?? '数据可能已变更'}
            {hasManagePermission && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => refreshAnalysis.mutate(currentAnalysis.id)}>
                  刷新分析
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowStaleConfirmInput(true)}>
                  确认继续使用
                </Button>
              </div>
            )}
          </Alert>
        )}

        {/* 过期确认输入 */}
        {showStaleConfirmInput && (
          <div className="space-y-2 border rounded p-3">
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={2}
              placeholder="确认继续使用的原因…"
              value={confirmReason}
              onChange={(e) => setConfirmReason(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!confirmReason || confirmStale.isPending}
                onClick={() => {
                  if (currentAnalysis)
                    confirmStale.mutate({ analysisId: currentAnalysis.id, reason: confirmReason })
                }}
              >
                确认
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowStaleConfirmInput(false)
                  setConfirmReason('')
                }}
              >
                取消
              </Button>
            </div>
          </div>
        )}

        {/* Warnings */}
        {currentAnalysis?.warnings && currentAnalysis.warnings.length > 0 && (
          <div className="space-y-1">
            {currentAnalysis.warnings.map((w, i) => (
              <Alert key={i} variant="warning">
                {w.message}
              </Alert>
            ))}
          </div>
        )}

        {/* 受影响项列表 */}
        {currentAnalysis && currentAnalysis.items.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">受影响项（{currentAnalysis.items.length}）</h4>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {currentAnalysis.items.slice(0, 20).map((item, idx) => (
                <div key={idx}>
                  <button
                    className="w-full text-left flex items-center gap-2 text-xs p-2 rounded hover:bg-accent"
                    onClick={() => setExpandedItem(expandedItem === idx ? null : idx)}
                  >
                    <Badge className={SEVERITY_COLORS[item.severity]}>
                      {SEVERITY_LABELS[item.severity]}
                    </Badge>
                    <span className="flex-1 truncate">
                      {item.entityType}:{item.entityId}
                    </span>
                    <span className="text-muted-foreground">{item.ruleId}</span>
                  </button>
                  {expandedItem === idx && (
                    <div className="ml-4 text-xs text-muted-foreground p-2 border-l-2 space-y-1">
                      {item.evidence && <p>{item.evidence}</p>}
                      {item.propagationPath && item.propagationPath.length > 0 && (
                        <div>
                          <span className="font-medium">传播路径：</span>
                          {item.propagationPath.map((p, pi) => (
                            <span key={pi}>
                              {pi > 0 && ' → '}
                              {p.fromEntityType}:{p.fromEntityId} → {p.toEntityType}:{p.toEntityId}
                            </span>
                          ))}
                        </div>
                      )}
                      <p>
                        维度：{item.dimension} · 深度：{item.depth} · 规则：{item.ruleId}
                      </p>
                      {item.requiresReview && <Alert variant="warning">需要人工复核</Alert>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        {hasManagePermission && (
          <div className="flex flex-wrap gap-2 pt-2 border-t">
            {!currentAnalysis && hasCreatePermission && (
              <Button size="sm" onClick={() => createAnalysis.mutate(undefined)}>
                创建分析
              </Button>
            )}
            {currentAnalysis && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => refreshAnalysis.mutate(currentAnalysis.id)}
                >
                  刷新分析
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowConfirmInput(true)}>
                  确认分析
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={aiExplanation.isPending}
                  onClick={() => aiExplanation.mutate({ analysisId: currentAnalysis.id })}
                >
                  {aiExplanation.isPending ? '生成中…' : 'AI 解释'}
                </Button>
              </>
            )}
          </div>
        )}

        {/* 确认输入 */}
        {showConfirmInput && (
          <div className="space-y-2 border rounded p-3">
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={2}
              placeholder="确认原因（可选）"
              value={confirmReason}
              onChange={(e) => setConfirmReason(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={confirmAnalysis.isPending}
                onClick={() => {
                  if (currentAnalysis) {
                    confirmAnalysis.mutate({
                      analysisId: currentAnalysis.id,
                      reason: confirmReason || undefined,
                    })
                    setShowConfirmInput(false)
                  }
                }}
              >
                确认
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowConfirmInput(false)}>
                取消
              </Button>
            </div>
          </div>
        )}

        {/* AI 解释 */}
        {currentAnalysis?.aiExplanation && (
          <div className="border rounded p-3 bg-muted/30">
            <p className="text-xs text-muted-foreground mb-1">
              AI 解释建议
              {currentAnalysis.aiExplanation.needsConfirmation ? '（待人工确认）' : '（已确认）'}
            </p>
            <p className="text-sm">{currentAnalysis.aiExplanation.summary}</p>
          </div>
        )}

        {/* 时间信息 */}
        {currentAnalysis && (
          <p className="text-xs text-muted-foreground">
            生成时间：{new Date(currentAnalysis.createdAt).toLocaleString('zh-CN')}
            {currentAnalysis.ruleVersion && ` · 规则版本：${currentAnalysis.ruleVersion}`}
          </p>
        )}

        {/* 历史分析 */}
        {recentAnalyses.length > 1 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              历史分析（{recentAnalyses.length}）
            </summary>
            <div className="mt-1 space-y-1">
              {recentAnalyses.map((a) => (
                <div key={a.id} className="flex justify-between py-1">
                  <span>{new Date(a.createdAt).toLocaleString('zh-CN')}</span>
                  <Badge className={STATUS_COLORS[a.status] ?? ''}>
                    {STATUS_LABELS[a.status] ?? a.status}
                  </Badge>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
