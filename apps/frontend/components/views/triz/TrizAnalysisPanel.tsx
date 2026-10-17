'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Alert } from '@/components/ui/Alert'
import { Skeleton } from '@/components/ui/Skeleton'
import { Separator } from '@/components/ui/Separator'
import { useAuthStore } from '@/stores/auth-store'
import { useTrizAnalysisDetail, useTrizDraftHandoff } from '@/hooks/use-triz-compiler-analysis'
import {
  sortWarningsBySeverity,
  getWarningCodeLabel,
  canHandoffResolutionPath,
  type TrizAnalysisArtifact,
  type TrizResolutionPath,
  type TrizAnalysisWarning,
  type TrizWarningSeverity,
  type TrizAnalysisStatus,
  type TrizHandoffStatus,
  type TrizAnalysisMode,
} from '@aiproj/types'
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Ban } from 'lucide-react'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<TrizAnalysisStatus, string> = {
  pending: '待分析',
  completed: '已完成',
  failed: '分析失败',
  needs_human_review: '需人工复核',
}

const STATUS_VARIANTS: Record<
  TrizAnalysisStatus,
  'success' | 'warning' | 'danger' | 'info' | 'neutral'
> = {
  pending: 'info',
  completed: 'success',
  failed: 'danger',
  needs_human_review: 'warning',
}

const MODE_LABELS: Record<TrizAnalysisMode, string> = {
  deterministic: '确定性模式',
  hybrid: '混合模式',
}

const HANDOFF_LABELS: Record<TrizHandoffStatus, string> = {
  none: '未提交',
  candidate_created: '候选已创建',
  stale: '已过期',
  handed_off: '已提交',
}

const HANDOFF_VARIANTS: Record<TrizHandoffStatus, 'success' | 'warning' | 'info' | 'neutral'> = {
  none: 'info',
  candidate_created: 'success',
  stale: 'warning',
  handed_off: 'neutral',
}

const WARNING_SEVERITY_VARIANTS: Record<TrizWarningSeverity, 'danger' | 'warning' | 'info'> = {
  blocking: 'danger',
  warning: 'warning',
  info: 'info',
}

const RELEVANCE_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ---------------------------------------------------------------------------
// TrizAnalysisPanelProps
// ---------------------------------------------------------------------------

interface TrizAnalysisPanelProps {
  runId: number
  artifactId: string
}

// ---------------------------------------------------------------------------
// 主面板
// ---------------------------------------------------------------------------

export function TrizAnalysisPanel({ runId, artifactId }: TrizAnalysisPanelProps) {
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const canView = hasPermission('contradiction:view')

  const { data: artifact, isLoading, isError, error } = useTrizAnalysisDetail(runId, artifactId)

  // 权限空态：无 contradiction:view 权限
  if (!canView) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-800">TRIZ 矛盾分析</h3>
        <Card variant="outlined">
          <CardContent className="py-8 text-center">
            <Ban className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm text-gray-500">当前角色无权查看 TRIZ 矛盾分析。</p>
          </CardContent>
        </Card>
      </section>
    )
  }

  if (isLoading) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-800">TRIZ 矛盾分析</h3>
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </section>
    )
  }

  if (isError) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-800">TRIZ 矛盾分析</h3>
        <Alert variant="danger" title="加载失败">
          <p>{error instanceof Error ? error.message : '无法加载分析数据，请稍后重试。'}</p>
        </Alert>
      </section>
    )
  }

  if (!artifact) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-800">TRIZ 矛盾分析</h3>
        <Card variant="outlined">
          <CardContent className="py-8 text-center">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm text-gray-500">暂无分析数据</p>
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">TRIZ 矛盾分析</h2>
          <Badge variant="neutral">{MODE_LABELS[artifact.mode]}</Badge>
          <Badge variant={STATUS_VARIANTS[artifact.status]}>{STATUS_LABELS[artifact.status]}</Badge>
          {artifact.requiresHumanReview && (
            <Badge variant="warning">
              <AlertTriangle className="h-3 w-3 mr-1" />
              需人工复核
            </Badge>
          )}
        </div>
        <span className="text-xs text-gray-400">
          版本 {artifact.schemaVersion} · 生成于 {formatDate(artifact.createdAt)}
        </span>
      </div>

      {/* 全局警告 */}
      {artifact.warnings.length > 0 && (
        <div className="space-y-2">
          {sortWarningsBySeverity(artifact.warnings).map((w, idx) => (
            <WarningAlert key={`${w.code}-${idx}`} warning={w} />
          ))}
        </div>
      )}

      {/* 来源矛盾 */}
      <SourceContradictionsSection contradictions={artifact.sourceContradictions} />

      {/* 参数张力 */}
      <ParameterTensionsSection tensions={artifact.parameterTensions} />

      {/* 候选原理 */}
      <PrincipleCandidatesSection candidates={artifact.principleCandidates} />

      {/* 解决路径（建议型，不含执行按钮） */}
      <ResolutionPathsSection
        paths={artifact.resolutionPaths}
        warnings={artifact.warnings}
        runId={runId}
        artifactId={artifactId}
        handoffStatus={artifact.handoff.status}
      />

      {/* AI 综合说明（仅 hybrid 模式） */}
      {artifact.aiNarrative && <AiNarrativeSection narrative={artifact.aiNarrative} />}

      {/* Handoff 状态 */}
      <HandoffStatusCard handoff={artifact.handoff} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// WarningAlert
// ---------------------------------------------------------------------------

function WarningAlert({ warning }: { warning: TrizAnalysisWarning }) {
  return (
    <Alert
      variant={WARNING_SEVERITY_VARIANTS[warning.severity]}
      title={getWarningCodeLabel(warning.code)}
      icon={<AlertTriangle className="h-5 w-5" />}
    >
      <div className="space-y-1">
        <p className="text-sm">{warning.message}</p>
        {warning.sourceKey && (
          <p className="text-xs text-gray-500">关联矛盾: {warning.sourceKey}</p>
        )}
        {warning.pathId && <p className="text-xs text-gray-500">关联路径: {warning.pathId}</p>}
      </div>
    </Alert>
  )
}

// ---------------------------------------------------------------------------
// SourceContradictionsSection
// ---------------------------------------------------------------------------

interface SourceContradictionsSectionProps {
  contradictions: TrizAnalysisArtifact['sourceContradictions']
}

function SourceContradictionsSection({ contradictions }: SourceContradictionsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (contradictions.length === 0) {
    return (
      <Card variant="outlined">
        <CardHeader>
          <CardTitle>来源矛盾 (0)</CardTitle>
          <CardDescription>无矛盾数据</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const displayList = isExpanded ? contradictions : contradictions.slice(0, 5)

  return (
    <Card variant="outlined">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>来源矛盾 ({contradictions.length})</CardTitle>
          </div>
          {contradictions.length > 5 && (
            <Button variant="ghost" size="sm" onClick={() => setIsExpanded((prev) => !prev)}>
              {isExpanded ? '收起' : `查看全部 ${contradictions.length} 条`}
            </Button>
          )}
        </div>
        <CardDescription>已确认的来源矛盾低敏引用</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {displayList.map((cd) => (
          <div key={cd.key} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-gray-900 truncate">{cd.title}</span>
                <Badge variant="neutral">{cd.type === 'technical' ? '技术' : '物理'}</Badge>
                <Badge variant={cd.stale ? 'warning' : 'success'}>
                  {cd.stale ? '已过期' : cd.status}
                </Badge>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs text-gray-400">
                  置信度 {(cd.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            {cd.improvingParameterKey && cd.worseningParameterKey && (
              <p className="mt-1 text-xs text-gray-500">
                改善: {cd.improvingParameterKey} / 恶化: {cd.worseningParameterKey}
              </p>
            )}
            {cd.parameterKey && (
              <p className="mt-1 text-xs text-gray-500">参数: {cd.parameterKey}</p>
            )}
            {cd.suggestedPrinciples.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {cd.suggestedPrinciples.map((p) => (
                  <Badge key={p.principleId} variant="outline">
                    {p.name}
                  </Badge>
                ))}
              </div>
            )}
            {cd.stale && cd.staleReason && (
              <p className="mt-1 text-xs text-danger">{cd.staleReason}</p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// ParameterTensionsSection
// ---------------------------------------------------------------------------

interface ParameterTensionsSectionProps {
  tensions: TrizAnalysisArtifact['parameterTensions']
}

function ParameterTensionsSection({ tensions }: ParameterTensionsSectionProps) {
  if (tensions.length === 0) return null

  return (
    <Card variant="outlined">
      <CardHeader>
        <CardTitle>参数张力 ({tensions.length})</CardTitle>
        <CardDescription>矛盾的参数维度摘要</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {tensions.map((t, idx) => (
          <div key={idx} className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium text-gray-900">{t.technicalSummary}</p>
            {t.physicalSummary && <p className="mt-1 text-gray-600">{t.physicalSummary}</p>}
            {t.sourceKeys.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {t.sourceKeys.map((key) => (
                  <Badge key={key} variant="outline">
                    {key}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// PrincipleCandidatesSection
// ---------------------------------------------------------------------------

interface PrincipleCandidatesSectionProps {
  candidates: TrizAnalysisArtifact['principleCandidates']
}

function PrincipleCandidatesSection({ candidates }: PrincipleCandidatesSectionProps) {
  if (candidates.length === 0) return null

  const relevanceVariants: Record<string, 'success' | 'warning' | 'neutral'> = {
    high: 'success',
    medium: 'warning',
    low: 'neutral',
  }

  return (
    <Card variant="outlined">
      <CardHeader>
        <CardTitle>候选发明原理 ({candidates.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {candidates.map((c) => (
          <div key={c.principleId} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{c.principleId}</span>
                <span>{c.name}</span>
                {c.chineseName && <span className="text-gray-500">({c.chineseName})</span>}
              </div>
              <Badge variant={relevanceVariants[c.relevance]}>
                {RELEVANCE_LABELS[c.relevance] ?? c.relevance}
              </Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// ResolutionPathsSection — 建议型解决路径，不含执行按钮
// ---------------------------------------------------------------------------

interface ResolutionPathsSectionProps {
  paths: TrizResolutionPath[]
  warnings: TrizAnalysisWarning[]
  runId: number
  artifactId: string
  handoffStatus: TrizHandoffStatus
}

function ResolutionPathsSection({
  paths,
  warnings,
  runId,
  artifactId,
  handoffStatus,
}: ResolutionPathsSectionProps) {
  const [expandedPathId, setExpandedPathId] = useState<string | null>(null)
  const handoffMutation = useTrizDraftHandoff(runId, artifactId)
  const [handoffError, setHandoffError] = useState<string | null>(null)

  const toggleExpand = (pathId: string) => {
    setExpandedPathId((prev) => (prev === pathId ? null : pathId))
  }

  if (paths.length === 0) return null

  const canHandoffOverall = handoffStatus === 'none' || handoffStatus === 'stale'

  return (
    <Card variant="outlined">
      <CardHeader>
        <CardTitle>建议解决路径 ({paths.length})</CardTitle>
        <CardDescription>
          以下为解决建议，需要人工审阅后方可执行。不自动应用、不自动排程、不自动平衡资源。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {paths.map((path) => {
          const isExpanded = expandedPathId === path.pathId
          const handoffCheck = canHandoffResolutionPath(path, warnings)

          return (
            <div key={path.pathId} className="rounded-lg border border-border overflow-hidden">
              {/* 路径头 */}
              <button
                type="button"
                onClick={() => toggleExpand(path.pathId)}
                className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-sm font-medium text-gray-900 truncate">{path.name}</span>
                  {path.requiresHumanReview && (
                    <Badge variant="warning">
                      <AlertTriangle className="h-3 w-3 mr-0.5" />
                      需复核
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  )}
                </div>
              </button>

              {/* 展开内容 */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-3">
                  <Separator />
                  <p className="text-sm text-gray-600 leading-relaxed">{path.description}</p>

                  {/* 适用条件 */}
                  {path.applicability.length > 0 && (
                    <div>
                      <span className="text-xs font-medium text-gray-500">适用条件</span>
                      <ul className="mt-1 list-disc list-inside space-y-0.5">
                        {path.applicability.map((a, idx) => (
                          <li key={idx} className="text-xs text-gray-600">
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 不适用条件 */}
                  {path.nonApplicability.length > 0 && (
                    <div>
                      <span className="text-xs font-medium text-gray-500">不适用条件</span>
                      <ul className="mt-1 list-disc list-inside space-y-0.5">
                        {path.nonApplicability.map((n, idx) => (
                          <li key={idx} className="text-xs text-gray-500">
                            {n}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 关联原理 */}
                  {path.principleIds.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {path.principleIds.map((pid) => (
                        <Badge key={pid} variant="outline">
                          {pid}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* 路径警告 */}
                  {path.warnings.length > 0 && (
                    <div className="space-y-1">
                      {path.warnings.map((w, idx) => (
                        <WarningAlert key={`pw-${idx}`} warning={w} />
                      ))}
                    </div>
                  )}

                  {/* Handoff 按钮（建议型，触发草稿候选创建，非自动执行） */}
                  {canHandoffOverall && (
                    <div className="pt-2">
                      {!handoffCheck.allowed ? (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled
                            title={handoffCheck.reason ?? undefined}
                          >
                            提交为草稿候选
                          </Button>
                          <span className="text-xs text-gray-400">{handoffCheck.reason}</span>
                        </div>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={handoffMutation.isPending}
                            onClick={async () => {
                              setHandoffError(null)
                              try {
                                await handoffMutation.mutateAsync({
                                  selectedPathId: path.pathId,
                                })
                              } catch (e: unknown) {
                                setHandoffError(e instanceof Error ? e.message : '提交失败')
                              }
                            }}
                          >
                            {handoffMutation.isPending ? (
                              <>
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                提交中…
                              </>
                            ) : (
                              '提交为草稿候选'
                            )}
                          </Button>
                          {handoffError && (
                            <p className="mt-1 text-xs text-danger">{handoffError}</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// AiNarrativeSection
// ---------------------------------------------------------------------------

interface AiNarrativeSectionProps {
  narrative: NonNullable<TrizAnalysisArtifact['aiNarrative']>
}

function AiNarrativeSection({ narrative }: AiNarrativeSectionProps) {
  return (
    <Card variant="outlined">
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>AI 综合说明</CardTitle>
          {narrative.hallucinationChecked && (
            <Badge variant={narrative.hallucinationPassed ? 'success' : 'danger'}>
              {narrative.hallucinationPassed ? '反幻觉校验通过' : '反幻觉校验未通过'}
            </Badge>
          )}
        </div>
        <CardDescription>
          由 {narrative.provider}/{narrative.model} 生成
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-600 leading-relaxed">{narrative.summary}</p>

        {narrative.tokenUsage && (
          <div className="text-xs text-gray-400">
            Token 用量: 输入 {narrative.tokenUsage.input} · 输出 {narrative.tokenUsage.output} ·
            总计 {narrative.tokenUsage.total}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// HandoffStatusCard
// ---------------------------------------------------------------------------

interface HandoffStatusCardProps {
  handoff: TrizAnalysisArtifact['handoff']
}

function HandoffStatusCard({ handoff }: HandoffStatusCardProps) {
  return (
    <Card variant="outlined">
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>处理状态</CardTitle>
          <Badge variant={HANDOFF_VARIANTS[handoff.status]}>{HANDOFF_LABELS[handoff.status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {handoff.draftSessionRef && (
          <p className="text-gray-600">草稿会话: {handoff.draftSessionRef}</p>
        )}
        {handoff.selectedPathId && (
          <p className="text-gray-600">选定路径 ID: {handoff.selectedPathId}</p>
        )}
        {handoff.handedOffAt && (
          <p className="text-gray-500 text-xs">提交时间: {formatDate(handoff.handedOffAt)}</p>
        )}
        {handoff.blockedReason && (
          <Alert variant="warning" title="提交被阻断">
            <p className="text-sm">{handoff.blockedReason}</p>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
