'use client'

/**
 * v3-knowledge-memory-operating-layer —— 运营总览卡。
 *
 * 行为（spec §5.5）：
 * - 显示四 lane counts + 9 个 attention facet 计数 + coverage / degraded 标；
 * - 禁止 color-only（必带文字）；
 * - 禁止 false-zero：若某 lane total=0 同时 degraded=true，必须显式说明
 *   「依赖降级、计数不可信」；
 * - 禁止把 0 + degraded 叙述为「组织没有该类内容」（spec §3 跨租防泄露）。
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { OperatingKindBadge, OperatingStatusBadge } from './OperatingStatusBadge'
import type {
  KnowledgeMemoryOperatingStatus,
  OperatingLaneCount,
  OperatingSummary,
} from '@aiproj/types'

const LANE_ORDER: readonly KnowledgeMemoryOperatingStatus[] = [
  'needs_review',
  'stale_or_unconfirmed',
  'conflict',
  'provenance_gap',
  'synthetic_eval_only',
  'retention_attention',
  'retrieval_gap',
  'degraded',
]

export function OperatingSummaryCard({ summary }: { summary: OperatingSummary }) {
  const degradedLanes = summary.lanes.filter((l) => l.degraded)
  const hiddenLanes = summary.lanes.filter((l) => l.coverage === 'hidden')
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">运营总览</CardTitle>
        <p className="text-xs text-muted-foreground">
          生成于 {summary.generatedAt}（{summary.lanes.length} 个 lane，{summary.totalAttention} 个
          待处置项）
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Lane counts */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="lane-counts">
          {summary.lanes.map((lane) => (
            <LaneCountTile key={lane.lane} lane={lane} />
          ))}
        </div>

        {/* Attention facet counts */}
        <div>
          <h3 className="text-sm font-semibold mb-2">按 attention facet 聚合</h3>
          <div className="flex flex-wrap gap-2" aria-label="facet-counts">
            {LANE_ORDER.map((facet) => {
              const n = summary.attentionFacetCounts[facet]
              return (
                <div
                  key={facet}
                  className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs"
                >
                  <OperatingStatusBadge status={facet} />
                  <span className="font-mono">×{n}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Coverage warnings */}
        {(degradedLanes.length > 0 || hiddenLanes.length > 0 || summary.anyLaneDegraded) && (
          <div className="rounded border border-warning/40 bg-warning-bg/30 p-3 text-xs space-y-1">
            {degradedLanes.map((lane) => (
              <div key={lane.lane}>
                <Badge variant="warning">依赖降级</Badge>
                <span className="ml-2">
                  {getLaneLabel(lane.lane)} lane 读取失败，已标 degraded；显示计数 0 不可信， 需以
                  partial 状态理解。
                </span>
              </div>
            ))}
            {hiddenLanes.map((lane) => (
              <div key={lane.lane}>
                <Badge variant="info">隐藏</Badge>
                <span className="ml-2">
                  {getLaneLabel(lane.lane)} lane 当前 scope 内全部对象不可见（按权限排除）， 计数 0
                  反映权限而非内容。
                </span>
              </div>
            ))}
          </div>
        )}

        {summary.lanes.length === 0 && (
          <p className="text-sm text-muted-foreground">暂无任何 lane 数据。</p>
        )}
      </CardContent>
    </Card>
  )
}

function LaneCountTile({ lane }: { lane: OperatingLaneCount }) {
  return (
    <div className="rounded border p-2 text-xs space-y-1">
      <div className="flex items-center gap-1">
        <OperatingKindBadge kind={lane.lane} />
        {lane.degraded && <Badge variant="danger">degraded</Badge>}
      </div>
      <div className="font-mono text-base" aria-label={`${lane.lane} total`}>
        {lane.coverage === 'degraded' ? '?' : lane.total}
      </div>
      <div className="text-muted-foreground">
        待处置 {lane.coverage === 'degraded' ? '?' : lane.attentionCount}
      </div>
      <div className="text-muted-foreground text-[10px]">{coverageLabel(lane.coverage)}</div>
    </div>
  )
}

function getLaneLabel(kind: string): string {
  switch (kind) {
    case 'knowledge_item':
      return '知识条目'
    case 'copilot_memory':
      return '推断记忆'
    case 'skill_knowledge_draft':
      return 'Skill 知识草稿'
    case 'retrieval_signal':
      return '检索质量信号'
    default:
      return kind
  }
}

function coverageLabel(c: OperatingLaneCount['coverage']): string {
  switch (c) {
    case 'complete':
      return '完整'
    case 'partial':
      return '部分'
    case 'degraded':
      return '降级'
    case 'hidden':
      return '不可见'
    case 'empty':
      return '无对象'
    case 'unavailable':
      return '不可用'
  }
}
