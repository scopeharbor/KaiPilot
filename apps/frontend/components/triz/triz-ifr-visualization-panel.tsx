/**
 * v3-triz-ifr-visualization —— IFR 可视化审查面（tasks 5.2-5.5, 5.9 P0/P1）。
 *
 * 展示：当前状态 → 中间阶段 → 目标 IFR 的演进路径
 * 包含：理想度评分、趋势摘要、来源 refs、warnings、AI 草稿状态、
 * 保存审查 dialog、handoff dialog。
 */

'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/Dialog'
import { Skeleton } from '@/components/ui/Skeleton'
import { Label } from '@/components/ui/Label'
import { Checkbox } from '@/components/ui/Checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import {
  useTrizIfrPreview,
  useTrizIfrList,
  useSaveTrizIfrReview,
  useTrizIfrAiDraft,
} from '@/hooks/use-triz-ifr-visualization'
import { PermissionGuard } from '@/components/PermissionGuard'
import type { IfrPreview, IfrSavedReview, IfrStage } from '@aiproj/types'

// ── Props ──

interface TrizIfrVisualizationPanelProps {
  projectId: number
}

// ── Helpers ──

function reviewStatusLabel(status: string): string {
  switch (status) {
    case 'draft':
      return '草稿'
    case 'saved':
      return '已保存'
    case 'superseded':
      return '已替换'
    case 'stale':
      return '已过期'
    default:
      return status
  }
}

function stageKindLabel(kind: string): string {
  switch (kind) {
    case 'current':
      return '当前'
    case 'intermediate':
      return '中间'
    case 'target':
      return '目标'
    default:
      return kind
  }
}

function trendLabel(trend: string): string {
  switch (trend) {
    case 'improving':
      return '↑ 增长'
    case 'declining':
      return '↓ 下降'
    case 'decreasing':
      return '↓ 降低'
    case 'increasing':
      return '↑ 上升'
    case 'stable':
      return '→ 稳定'
    case 'unknown':
      return '? 未知'
    default:
      return trend
  }
}

function directionLabel(dir: string): string {
  switch (dir) {
    case 'toward_ideal':
      return '趋向理想解'
    case 'away_from_ideal':
      return '偏离理想解'
    case 'stable':
      return '趋势稳定'
    case 'needs_review':
      return '需要审查'
    default:
      return dir
  }
}

function warningLabel(code: string): string {
  const labels: Record<string, string> = {
    MISSING_COST_DATA: '缺少成本数据',
    MISSING_HARM_DATA: '缺少危害数据',
    MISSING_USEFUL_FUNCTION_DATA: '缺少有用功能数据',
    STALE_SOURCE: '来源已过期',
    SOURCE_UNAVAILABLE: '来源不可用',
    NO_CONTRADICTIONS: '无矛盾数据',
    NO_WORKBENCH_SCHEMES: '无工作台方案',
    NO_DECISION_LOGS: '无决策日志',
    AI_DRAFT_FALLBACK: 'AI 草稿已降级',
    AI_DRAFT_VALIDATION_FAILED: 'AI 草稿验证失败',
    INACCESSIBLE_SOURCE: '来源不可访问',
    LARGE_STAGE_SET: '阶段数量较多',
    HANDOFF_STALE_BLOCKED: 'Handoff 被陈旧数据阻断',
  }
  return labels[code] ?? code
}

// ── Sub-components ──

/** 理想度评分卡片。 */
function IdealityScoreCard({ preview }: { preview: IfrPreview }) {
  const score = preview.idealityScore
  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">理想度评分</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <div
            className="text-3xl font-bold"
            aria-label={`理想度 ${Math.round(score.aggregateScore * 100)}%`}
          >
            {Math.round(score.aggregateScore * 100)}%
          </div>
          <div className="text-sm text-muted-foreground">
            置信度 {Math.round(score.confidence * 100)}% · 公式 v{score.formulaVersion}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          {score.dimensions.map((d) => (
            <div key={d.name} className="text-center">
              <div className="text-muted-foreground">
                {d.name === 'useful_function' ? '有用功能' : d.name === 'cost' ? '成本' : '危害'}
              </div>
              <div className="font-medium">{d.weightedScore.toFixed(3)}</div>
              {!d.hasData && <Badge variant="warning">无数据</Badge>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/** 趋势摘要卡片。 */
function TrendSummaryCard({ preview }: { preview: IfrPreview }) {
  const t = preview.trendSummary
  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">趋势摘要</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2 text-sm mb-2">
          <div>
            <span className="text-muted-foreground">有用功能：</span>
            {trendLabel(t.usefulFunctionTrend)}
          </div>
          <div>
            <span className="text-muted-foreground">成本：</span>
            {trendLabel(t.costTrend)}
          </div>
          <div>
            <span className="text-muted-foreground">危害：</span>
            {trendLabel(t.harmTrend)}
          </div>
        </div>
        <div className="text-sm">
          <Badge
            variant={
              t.overallDirection === 'toward_ideal'
                ? 'success'
                : t.overallDirection === 'away_from_ideal'
                  ? 'warning'
                  : 'outline'
            }
          >
            {directionLabel(t.overallDirection)}
          </Badge>
        </div>
        {t.summaryText && <p className="text-xs text-muted-foreground mt-2">{t.summaryText}</p>}
      </CardContent>
    </Card>
  )
}

/** 阶段路径可视化（SVG/CSS）。 */
function StagePathVisualization({ stages }: { stages: IfrStage[] }) {
  if (stages.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无阶段数据。</p>
  }

  return (
    <div className="relative flex flex-col md:flex-row items-start md:items-center gap-4 py-4">
      {stages.map((stage, idx) => (
        <React.Fragment key={stage.stageId}>
          <div
            className={`flex-shrink-0 w-48 rounded-lg border p-3 ${
              stage.stale ? 'border-warning bg-warning/5' : 'border-border'
            }`}
            aria-label={`${stageKindLabel(stage.kind)}阶段：${stage.label}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Badge
                variant={
                  stage.kind === 'current'
                    ? 'primary'
                    : stage.kind === 'target'
                      ? 'success'
                      : 'outline'
                }
              >
                {stageKindLabel(stage.kind)}
              </Badge>
              {stage.stale && <Badge variant="warning">陈旧</Badge>}
            </div>
            <div className="font-medium text-sm truncate" title={stage.label}>
              {stage.label}
            </div>
            <div
              className="text-xs text-muted-foreground mt-1 line-clamp-2"
              title={stage.description}
            >
              {stage.description}
            </div>
            {stage.relatedPrincipleRefs.length > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                原则: {stage.relatedPrincipleRefs.join(', ')}
              </div>
            )}
          </div>
          {idx < stages.length - 1 && (
            <div className="hidden md:block text-xl text-muted-foreground" aria-hidden="true">
              →
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

/** 来源 refs 列表。 */
function SourceRefsSection({ sourceRefs }: { sourceRefs: IfrPreview['sourceRefs'] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">来源引用</h3>
      {sourceRefs.map((ref) => (
        <div
          key={`${ref.kind}:${ref.refId}`}
          className="flex items-center gap-2 text-sm border rounded p-2"
        >
          <Badge variant="outline">{ref.kind}</Badge>
          <span className="truncate flex-1">{ref.title}</span>
          {ref.stale && <Badge variant="warning">陈旧</Badge>}
        </div>
      ))}
    </div>
  )
}

/** Warnings 摘要。 */
function WarningsSection({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium text-warning">注意事项</h3>
      {warnings.map((w) => (
        <div key={w} className="text-xs text-muted-foreground flex items-center gap-1">
          <Badge variant="warning" className="text-xs">
            !
          </Badge>
          {warningLabel(w)}
        </div>
      ))}
    </div>
  )
}

// ── Main Panel ──

export function TrizIfrVisualizationPanel({ projectId }: TrizIfrVisualizationPanelProps) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [handoffDialogOpen, setHandoffDialogOpen] = useState(false)
  const [handoffConfirmed, setHandoffConfirmed] = useState(false)
  const [saveConfirmed, setSaveConfirmed] = useState(false)
  const [activeTab, setActiveTab] = useState('preview')

  const {
    data: previewData,
    isLoading: previewLoading,
    error: previewError,
  } = useTrizIfrPreview(projectId)
  const { data: listData } = useTrizIfrList(projectId)
  const saveMutation = useSaveTrizIfrReview(projectId)
  const aiDraftMutation = useTrizIfrAiDraft(projectId)

  const handleSave = () => {
    if (!previewData) return
    saveMutation.mutate(
      { confirmation: true, idealState: previewData.data.idealState },
      {
        onSuccess: () => {
          setSaveDialogOpen(false)
          setSaveConfirmed(false)
        },
      },
    )
  }

  const handleAiDraft = () => {
    aiDraftMutation.mutate({})
  }

  if (previewLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (previewError) {
    return (
      <div className="p-4">
        <p className="text-danger">加载 IFR 可视化失败，请检查项目权限后重试。</p>
      </div>
    )
  }

  const preview = previewData?.data

  return (
    <PermissionGuard require="triz_ifr:view">
      <div className="space-y-6 p-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-xl font-semibold">TRIZ 最终理想解 (IFR) 可视化</h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAiDraft}
              disabled={aiDraftMutation.isPending}
            >
              {aiDraftMutation.isPending ? '生成中...' : '生成 AI 草稿'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setSaveDialogOpen(true)}
              disabled={saveMutation.isPending}
            >
              保存审查
            </Button>
          </div>
        </div>

        {/* AI draft result */}
        {aiDraftMutation.data && (
          <Card className="border-info">
            <CardContent className="pt-4">
              <p className="text-sm">
                <Badge
                  variant={
                    aiDraftMutation.data.data.aiDraftState === 'fallback' ? 'warning' : 'info'
                  }
                >
                  {aiDraftMutation.data.data.aiDraftState === 'fallback' ? '确定性降级' : 'AI 草稿'}
                </Badge>
              </p>
              <p className="text-sm mt-2">{aiDraftMutation.data.data.idealStateDraft}</p>
              {aiDraftMutation.data.data.fallbackReason && (
                <p className="text-xs text-muted-foreground mt-1">
                  {aiDraftMutation.data.data.fallbackReason}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="preview">IFR 预览</TabsTrigger>
            <TabsTrigger value="saved">已保存审查</TabsTrigger>
          </TabsList>

          <TabsContent value="preview" className="space-y-6 pt-4">
            {preview ? (
              <>
                {/* Current / Ideal State */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">当前状态</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm">{preview.currentState}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">目标理想态 (IFR)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm">{preview.idealState}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Score + Trends */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <IdealityScoreCard preview={preview} />
                  <TrendSummaryCard preview={preview} />
                </div>

                {/* Stage Path */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">演进路径</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <StagePathVisualization stages={preview.stages} />
                  </CardContent>
                </Card>

                {/* Sources + Warnings */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <SourceRefsSection sourceRefs={preview.sourceRefs} />
                  <WarningsSection warnings={preview.warningSummary} />
                </div>

                {/* Meta */}
                <div className="text-xs text-muted-foreground">
                  Schema v{preview.schemaVersion} · 评分 v{preview.scoreVersion} · Hash:{' '}
                  {preview.outputHash.slice(0, 8)}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">无法加载预览。</p>
            )}
          </TabsContent>

          <TabsContent value="saved" className="pt-4">
            {listData?.data && listData.data.length > 0 ? (
              <div className="space-y-3">
                {listData.data.map((review: IfrSavedReview) => (
                  <Card key={review.ifrId} className="cursor-pointer hover:bg-muted/50">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Badge variant="outline">{reviewStatusLabel(review.reviewStatus)}</Badge>
                          <span className="ml-2 text-sm font-medium">
                            IFR {review.ifrId.slice(0, 8)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(review.createdAt).toLocaleDateString('zh-CN')}
                        </div>
                      </div>
                      <p className="text-sm mt-2 text-muted-foreground line-clamp-2">
                        {review.idealState}
                      </p>
                      <div className="text-xs text-muted-foreground mt-1">
                        理想度 {Math.round(review.idealityScore.aggregateScore * 100)}% ·
                        {review.stages.length} 个阶段
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无已保存的 IFR 审查。</p>
            )}
          </TabsContent>
        </Tabs>

        {/* Save Dialog */}
        <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>保存 IFR 审查</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                保存当前 IFR 审查快照以供后续查阅和趋势比较。保存的快照不会修改正式项目数据。
              </p>
              {preview && (
                <div className="text-xs space-y-1 border rounded p-2">
                  <div>来源数量：{preview.sourceRefs.length}</div>
                  <div>阶段数量：{preview.stages.length}</div>
                  <div>理想度：{Math.round(preview.idealityScore.aggregateScore * 100)}%</div>
                  <div>输出 Hash：{preview.outputHash.slice(0, 8)}</div>
                  {preview.warningSummary.length > 0 && (
                    <div className="text-warning">
                      注意事项：{preview.warningSummary.map((w) => warningLabel(w)).join('、')}
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="save-confirm"
                  checked={saveConfirmed}
                  onCheckedChange={(v: boolean | 'indeterminate') => setSaveConfirmed(!!v)}
                />
                <Label htmlFor="save-confirm" className="text-sm">
                  我确认保存此 IFR 审查快照
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleSave} disabled={!saveConfirmed || saveMutation.isPending}>
                {saveMutation.isPending ? '保存中...' : '确认保存'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Handoff Dialog */}
        <Dialog open={handoffDialogOpen} onOpenChange={setHandoffDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>创建 Handoff 候选</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                将 IFR 差距建议传递到 Innovation Workbench、决策日志或 Draft Layer。 Handoff
                不会修改正式项目数据。
              </p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="handoff-confirm"
                  checked={handoffConfirmed}
                  onCheckedChange={(v) => setHandoffConfirmed(!!v)}
                />
                <Label htmlFor="handoff-confirm" className="text-sm">
                  我确认创建此 Handoff 候选
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setHandoffDialogOpen(false)}>
                取消
              </Button>
              <Button disabled={!handoffConfirmed}>确认创建</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PermissionGuard>
  )
}
