'use client'

import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Separator } from '@/components/ui/Separator'
import { Skeleton } from '@/components/ui/Skeleton'
import type { AttributionDetail } from '@/lib/api/traceability'

// ---------------------------------------------------------------------------
// 常量：中文标签
// ---------------------------------------------------------------------------

const GENERATED_BY_LABELS: Record<string, string> = {
  llm: 'LLM 生成',
  deterministic_rule: '确定性规则',
  user_edit: '用户编辑',
  undefined: '未知来源',
}

const GENERATED_BY_BADGE_VARIANT: Record<string, 'ai' | 'info' | 'primary' | 'neutral'> = {
  llm: 'ai',
  deterministic_rule: 'info',
  user_edit: 'primary',
}

const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: '待审查',
  reviewed_and_accepted: '已确认',
  reviewed_with_changes: '已修改',
  reviewed_and_rejected: '已拒绝',
}

const REVIEW_STATUS_VARIANT: Record<string, 'warning' | 'success' | 'primary' | 'danger'> = {
  pending: 'warning',
  reviewed_and_accepted: 'success',
  reviewed_with_changes: 'primary',
  reviewed_and_rejected: 'danger',
}

const ARTIFACT_KIND_LABELS: Record<string, string> = {
  context_packet: '上下文包',
  model_output: '模型输出',
  validation_feedback: '验证反馈',
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function generatedByLabel(kind: string): string {
  return GENERATED_BY_LABELS[kind] ?? kind
}

function generatedByBadgeVariant(kind: string): 'ai' | 'info' | 'primary' | 'neutral' {
  return GENERATED_BY_BADGE_VARIANT[kind] ?? 'neutral'
}

function reviewStatusLabel(status: string): string {
  return REVIEW_STATUS_LABELS[status] ?? status
}

function reviewStatusVariant(status: string): 'warning' | 'success' | 'primary' | 'danger' {
  return REVIEW_STATUS_VARIANT[status] ?? 'warning'
}

function artifactKindLabel(kind: string): string {
  return ARTIFACT_KIND_LABELS[kind] ?? kind
}

function confidencePercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

// ---------------------------------------------------------------------------
// 骨架屏
// ---------------------------------------------------------------------------

export function SourceAttributionDetailSkeleton() {
  return (
    <Card variant="outlined">
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export interface SourceAttributionDetailProps {
  attribution: AttributionDetail
}

/**
 * 来源归因详情 —— 展示单条 attribution 的完整信息。
 *
 * 只读展示：
 * - 生成方式与模型信息（provider、model、ruleId）
 * - 阶段与字段路径
 * - 置信度与假设
 * - 摘要与证据片段
 * - 人工审查状态与审查人
 * - 来源引用列表
 */
export function SourceAttributionDetail({ attribution }: SourceAttributionDetailProps) {
  return (
    <Card variant="outlined">
      <CardHeader>
        <CardTitle>归因详情</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* 生成信息 */}
        <section className="space-y-2">
          <h4 className="text-sm font-medium text-gray-800">生成信息</h4>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={generatedByBadgeVariant(attribution.generatedBy.kind)}>
              {generatedByLabel(attribution.generatedBy.kind)}
            </Badge>
            {attribution.generatedBy.provider && (
              <Badge variant="outline">{attribution.generatedBy.provider}</Badge>
            )}
            {attribution.generatedBy.model && (
              <Badge variant="outline">{attribution.generatedBy.model}</Badge>
            )}
            {attribution.generatedBy.ruleId && (
              <Badge variant="outline">规则: {attribution.generatedBy.ruleId}</Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">阶段</span>
              <div className="font-medium">{attribution.stageId}</div>
            </div>
            {attribution.fieldPath && (
              <div>
                <span className="text-gray-500">字段</span>
                <div className="font-medium">{attribution.fieldPath}</div>
              </div>
            )}
            {attribution.draftSessionId && (
              <div>
                <span className="text-gray-500">草案会话</span>
                <div className="font-medium">#{attribution.draftSessionId}</div>
              </div>
            )}
          </div>
        </section>

        <Separator />

        {/* 置信度 */}
        <section className="space-y-2">
          <h4 className="text-sm font-medium text-gray-800">置信度与假设</h4>
          <div className="text-sm">
            <span className="text-gray-500">置信度：</span>
            <span className="font-medium">{confidencePercent(attribution.confidence)}</span>
          </div>
          {attribution.assumptions && attribution.assumptions.length > 0 && (
            <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
              {attribution.assumptions.map((assumption, i) => (
                <li key={i}>{assumption}</li>
              ))}
            </ul>
          )}
          {(!attribution.assumptions || attribution.assumptions.length === 0) && (
            <p className="text-sm text-gray-500">无假设记录</p>
          )}
        </section>

        <Separator />

        {/* 摘要 */}
        <section className="space-y-2">
          <h4 className="text-sm font-medium text-gray-800">摘要</h4>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{attribution.summary}</p>
        </section>

        {/* 证据片段 */}
        {attribution.evidenceSnippets && attribution.evidenceSnippets.length > 0 && (
          <>
            <Separator />
            <section className="space-y-2">
              <h4 className="text-sm font-medium text-gray-800">证据片段</h4>
              <div className="space-y-2">
                {attribution.evidenceSnippets.map((snippet, i) => (
                  <div
                    key={i}
                    className="rounded-[var(--radius-sm)] bg-gray-50 p-3 text-sm text-gray-700"
                  >
                    {snippet.label && (
                      <div className="text-xs text-gray-500 mb-1">{snippet.label}</div>
                    )}
                    <pre className="whitespace-pre-wrap font-mono text-xs">{snippet.snippet}</pre>
                    {snippet.contentHash && (
                      <div className="text-[10px] text-gray-400 mt-1">
                        hash: {snippet.contentHash.substring(0, 12)}...
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {/* 人工审查 */}
        <Separator />
        <section className="space-y-2">
          <h4 className="text-sm font-medium text-gray-800">人工审查</h4>
          <div className="flex items-center gap-2">
            <Badge variant={reviewStatusVariant(attribution.humanReviewStatus)}>
              {reviewStatusLabel(attribution.humanReviewStatus)}
            </Badge>
            {attribution.humanReviewedBy && (
              <span className="text-sm text-gray-500">审查人: #{attribution.humanReviewedBy}</span>
            )}
          </div>
        </section>

        {/* 来源引用 */}
        {attribution.sourceRefs.length > 0 && (
          <>
            <Separator />
            <section className="space-y-2">
              <h4 className="text-sm font-medium text-gray-800">来源引用</h4>
              <div className="space-y-1">
                {attribution.sourceRefs.map((ref, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-1">
                    <Badge variant="outline" className="text-[11px] shrink-0">
                      {artifactKindLabel(ref.artifactKind)}
                    </Badge>
                    <span className="text-gray-600 truncate font-mono text-xs">{ref.refId}</span>
                    {ref.label && <span className="text-gray-400 text-xs">({ref.label})</span>}
                    <span className="text-gray-400 text-xs ml-auto">v{ref.version}</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  )
}
