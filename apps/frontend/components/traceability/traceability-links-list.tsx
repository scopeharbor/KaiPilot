'use client'

import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Separator } from '@/components/ui/Separator'
import { Skeleton } from '@/components/ui/Skeleton'
import type { TraceabilityLink } from '@/lib/api/traceability'

// ---------------------------------------------------------------------------
// 常量：中文标签
// ---------------------------------------------------------------------------

const RELATION_TYPE_LABELS: Record<string, string> = {
  decomposes_into: '分解为',
  composed_of: '组成',
  contains: '包含',
  depends_on: '依赖',
  assigned_to: '分配给',
  validates: '验证',
  tracks: '追踪',
  affects: '影响',
  mitigated_by: '缓解于',
  led_by: '领导于',
  raci: 'RACI',
  blocked_by: '阻塞于',
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  objective: '目标',
  deliverable: '交付物',
  work_package: '工作包',
  task: '任务',
  milestone: '里程碑',
  risk: '风险',
  resource: '资源',
}

const DIRECTION_LABELS: Record<string, string> = {
  unidirectional: '单向',
  bidirectional: '双向',
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function relationTypeLabel(type: string): string {
  return RELATION_TYPE_LABELS[type] ?? type
}

function entityTypeLabel(type: string): string {
  return ENTITY_TYPE_LABELS[type] ?? type
}

function directionLabel(dir: string): string {
  return DIRECTION_LABELS[dir] ?? dir
}

/** 强度阈值：Decimal(3,2) 映射为中文语义 (1=strong, 0.6=medium, 0.3=weak, <0.3=tentative)。 */
function strengthLabel(strength: number | string): string {
  const s = Number(strength)
  if (Number.isNaN(s)) return String(strength)
  if (s >= 0.8) return '强'
  if (s >= 0.4) return '中'
  if (s >= 0.1) return '弱'
  return '暂定'
}

function strengthVariant(s: number | string): 'success' | 'warning' | 'info' | 'neutral' {
  const n = Number(s)
  if (Number.isNaN(n)) return 'neutral'
  if (n >= 0.8) return 'success'
  if (n >= 0.4) return 'warning'
  return 'info'
}

// ---------------------------------------------------------------------------
// 骨架屏
// ---------------------------------------------------------------------------

export function TraceabilityLinksListSkeleton() {
  return (
    <Card variant="outlined">
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export interface TraceabilityLinksListProps {
  links: TraceabilityLink[]
}

/**
 * 追溯链接列表 —— 展示项目的全部七类追溯关系。
 *
 * 只读展示：
 * - 关系类型（分解/组成/包含/依赖/分配给/验证/追踪/影响等）
 * - 源实体、目标实体及其类型
 * - 方向、强度
 * - 关联的 attribution 编号
 */
export function TraceabilityLinksList({ links }: TraceabilityLinksListProps) {
  if (links.length === 0) {
    return (
      <Card variant="outlined">
        <CardHeader>
          <CardTitle>追溯链接</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">暂无追溯链接。项目数据尚未经过 Compiler 处理。</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card variant="outlined">
      <CardHeader>
        <CardTitle>追溯链接 ({links.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {links.map((link, i) => (
          <div key={link.linkId}>
            {i > 0 && <Separator className="mb-3" />}
            <TraceabilityLinkRow link={link} />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 内部组件：单条链接行
// ---------------------------------------------------------------------------

function TraceabilityLinkRow({ link }: { link: TraceabilityLink }) {
  return (
    <div className="space-y-2">
      {/* 关系类型徽章 */}
      <div className="flex items-center gap-2">
        <Badge variant="primary">{relationTypeLabel(link.relationType)}</Badge>
        <Badge variant={strengthVariant(link.strength)}>{strengthLabel(link.strength)}</Badge>
        <Badge variant="outline">{directionLabel(link.direction)}</Badge>
      </div>

      {/* 源 → 目标 */}
      <div className="flex items-center gap-2 text-sm">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[11px]">
              {entityTypeLabel(link.sourceEntityType)}
            </Badge>
            <span className="font-mono text-xs text-gray-700 truncate">{link.sourceEntityId}</span>
          </div>
        </div>

        <svg
          className="h-4 w-6 shrink-0 text-gray-400"
          viewBox="0 0 24 8"
          fill="none"
          aria-hidden="true"
        >
          {link.direction === 'bidirectional' ? (
            <>
              <path d="M2 4h20" stroke="currentColor" strokeWidth="1.5" />
              <path d="M22 4l-4-3v6z" fill="currentColor" />
              <path d="M2 4l4-3v6z" fill="currentColor" />
            </>
          ) : (
            <>
              <path d="M0 4h22" stroke="currentColor" strokeWidth="1.5" />
              <path d="M22 4l-4-3v6z" fill="currentColor" />
            </>
          )}
        </svg>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[11px]">
              {entityTypeLabel(link.targetEntityType)}
            </Badge>
            <span className="font-mono text-xs text-gray-700 truncate">{link.targetEntityId}</span>
          </div>
        </div>
      </div>

      {/* 元数据 */}
      <div className="flex items-center gap-3 text-xs text-gray-500">
        {link.attributionId && <span>归因: #{link.attributionId}</span>}
        <span>创建于: {new Date(link.createdAt).toLocaleString('zh-CN')}</span>
      </div>
    </div>
  )
}
