'use client'

import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Separator } from '@/components/ui/Separator'
import { Skeleton } from '@/components/ui/Skeleton'
import type { EntitySourceAttribution, FieldAttribution } from '@/lib/api/traceability'

// ---------------------------------------------------------------------------
// 生成方式 → 中文标签
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

// ---------------------------------------------------------------------------
// 人工审查状态 → 中文标签与语义色
// ---------------------------------------------------------------------------

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

function confidencePercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

// ---------------------------------------------------------------------------
// 属性标签映射
// ---------------------------------------------------------------------------

const FIELD_PATH_LABELS: Record<string, string> = {
  title: '标题',
  description: '描述',
  status: '状态',
  priority: '优先级',
  startDate: '开始日期',
  endDate: '截止日期',
  estimatedHours: '预估工时',
  assigneeId: '负责人',
  category: '分类',
  probability: '概率',
  impact: '影响',
  mitigationStrategy: '缓解策略',
}

function fieldLabel(path: string): string {
  return FIELD_PATH_LABELS[path] ?? path
}

// ---------------------------------------------------------------------------
// 骨架屏
// ---------------------------------------------------------------------------

export function EntitySourceSummarySkeleton() {
  return (
    <Card variant="outlined">
      <CardHeader>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-48" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export interface EntitySourceSummaryProps {
  attribution: EntitySourceAttribution
}

/**
 * 实体来源归因卡片 —— 展示一个实体的 AI/规则/用户来源信息。
 *
 * 只读展示：生成方式(LLM/规则/用户)、阶段、置信度、证据数、人工审查状态。
 * 若实体无 entityAttribution（例如实体不存在），显示空状态。
 */
export function EntitySourceSummary({ attribution }: EntitySourceSummaryProps) {
  const { entityAttribution, fieldAttributions, entityType, entityId } = attribution

  return (
    <Card variant="outlined">
      <CardHeader>
        <CardTitle>来源追溯</CardTitle>
        <CardDescription>
          {entityType} · {entityId}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 实体级归因 */}
        {entityAttribution ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={generatedByBadgeVariant(entityAttribution.generatedBy)}>
                {generatedByLabel(entityAttribution.generatedBy)}
              </Badge>
              {entityAttribution.stageId !== 'deterministic' && (
                <Badge variant="outline">阶段: {entityAttribution.stageId}</Badge>
              )}
              <Badge variant={reviewStatusVariant(entityAttribution.humanReviewStatus)}>
                {reviewStatusLabel(entityAttribution.humanReviewStatus)}
              </Badge>
            </div>

            <p className="text-sm text-gray-600">{entityAttribution.summary}</p>

            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-gray-500">置信度</span>
                <div className="font-medium">{confidencePercent(entityAttribution.confidence)}</div>
              </div>
              <div>
                <span className="text-gray-500">证据数</span>
                <div className="font-medium">{entityAttribution.evidenceCount}</div>
              </div>
              <div>
                <span className="text-gray-500">来源引用</span>
                <div className="font-medium">{entityAttribution.sourceRefCount}</div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">暂无来源归因信息</p>
        )}

        {/* 字段级归因 */}
        {fieldAttributions.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-sm font-medium text-gray-800 mb-2">字段级别归因</h4>
              <div className="space-y-2">
                {fieldAttributions.map((fa: FieldAttribution) => (
                  <FieldAttributionRow key={fa.attributionId} field={fa} />
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 内部组件：字段归因行
// ---------------------------------------------------------------------------

function FieldAttributionRow({ field }: { field: FieldAttribution }) {
  return (
    <div className="flex items-start gap-2 text-sm py-1">
      <Badge variant="outline" className="shrink-0 min-w-[4rem] justify-center">
        {fieldLabel(field.fieldPath)}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant={generatedByBadgeVariant(field.generatedBy)} className="text-[11px]">
            {generatedByLabel(field.generatedBy)}
          </Badge>
          <span className="text-gray-500">{confidencePercent(field.confidence)}</span>
        </div>
        <p className="text-gray-600 truncate">{field.summary}</p>
      </div>
    </div>
  )
}
