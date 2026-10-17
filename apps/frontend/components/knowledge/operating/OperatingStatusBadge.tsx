'use client'

/**
 * v3-knowledge-memory-operating-layer —— status / safe-label 标识。
 *
 * 设计 §5.8 / 5.10：四 kind 必须有可区分的语义标识
 *   - knowledge_item：layer 标签 + L3 双水印「SYNTHETIC」+「eval-only」
 *   - copilot_memory：「推断记忆」+ 任何 evaluation 后永远是 inference
 *   - skill_knowledge_draft：「方法论候选」+ plugin provenance（disabled/uninstalled）
 *   - retrieval_signal：「检索质量信号」+ window/coverage
 *
 * 严禁 color-only：所有状态必须同时携带文字（spec 5.10 强制 non-color-only 编码）。
 * 严禁把 memory 标记为「事实」「权威」「已核实」等可升格字样。
 */
import { Badge } from '@/components/ui/Badge'
import type {
  CopilotMemoryOperatingProjection,
  KnowledgeItemOperatingProjection,
  KnowledgeMemoryOperatingItem,
  KnowledgeMemoryOperatingStatus,
  RetrievalSignalOperatingProjection,
  SkillKnowledgeDraftOperatingProjection,
} from '@aiproj/types'
import { cn } from '@/lib/utils'

const STATUS_LABEL: Record<
  KnowledgeMemoryOperatingStatus,
  {
    label: string
    variant:
      'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'ai' | 'outline' | 'solid'
  }
> = {
  ready: { label: '稳定', variant: 'success' },
  needs_review: { label: '需审查', variant: 'warning' },
  stale_or_unconfirmed: { label: '陈旧/未确认', variant: 'warning' },
  conflict: { label: '冲突', variant: 'danger' },
  provenance_gap: { label: '来源缺失', variant: 'warning' },
  synthetic_eval_only: { label: '合成/仅 Eval', variant: 'ai' },
  retention_attention: { label: '保留期治理', variant: 'info' },
  retrieval_gap: { label: '检索缺口', variant: 'info' },
  degraded: { label: '依赖降级', variant: 'danger' },
}

const PRIORITY_LABEL: Record<
  'p0' | 'p1' | 'p2' | 'p3',
  {
    label: string
    variant:
      'neutral' | 'primary' | 'warning' | 'danger' | 'info' | 'success' | 'ai' | 'outline' | 'solid'
  }
> = {
  p0: { label: 'P0 必处置', variant: 'danger' },
  p1: { label: 'P1 高', variant: 'warning' },
  p2: { label: 'P2 中', variant: 'info' },
  p3: { label: 'P3 低', variant: 'neutral' },
}

export function OperatingStatusBadge({ status }: { status: KnowledgeMemoryOperatingStatus }) {
  const meta = STATUS_LABEL[status]
  return <Badge variant={meta.variant}>{meta.label}</Badge>
}

export function OperatingPriorityBadge({ priority }: { priority: 'p0' | 'p1' | 'p2' | 'p3' }) {
  const meta = PRIORITY_LABEL[priority]
  return <Badge variant={meta.variant}>{meta.label}</Badge>
}

const KIND_LABEL: Record<KnowledgeMemoryOperatingItem['kind'], string> = {
  knowledge_item: '知识条目',
  copilot_memory: '推断记忆',
  skill_knowledge_draft: 'Skill 知识草稿',
  retrieval_signal: '检索质量信号',
}

/** 单一 kind 标识：只显示文字（不靠颜色） */
export function OperatingKindBadge({ kind }: { kind: KnowledgeMemoryOperatingItem['kind'] }) {
  return <Badge variant="outline">{KIND_LABEL[kind]}</Badge>
}

export function OperatingKindLabel(kind: KnowledgeMemoryOperatingItem['kind']): string {
  return KIND_LABEL[kind]
}

/**
 * L3 / memory inference / Skill methodology / retrieval signal 安全标签。
 * 同时携带文字（spec §5.10 强制 non-color-only）。
 */
export function OperatingSafeLabels({ item }: { item: KnowledgeMemoryOperatingItem }) {
  const labels = (item.safeLabels ?? []).slice(0, 6)
  if (labels.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1" aria-label="safe-labels">
      {labels.map((label) => (
        <Badge key={label} variant="outline" className="text-[10px]">
          {label}
        </Badge>
      ))}
    </div>
  )
}

/**
 * memory inference 显式标识（spec §3.5 强约束：恒为 inference，不得升格 fact）。
 * 复用于 row + detail。
 */
export function OperatingMemoryInferenceBadge({
  memory: _memory,
}: {
  memory: CopilotMemoryOperatingProjection
}) {
  return (
    <Badge variant="ai" aria-label="inference-only">
      推断记忆 · 永不升格事实
    </Badge>
  )
}

/**
 * L3 双水印（spec：SYNTHETIC + eval-only）。
 * 复用于 row + detail。
 */
export function OperatingL3Watermarks({
  knowledge,
}: {
  knowledge: KnowledgeItemOperatingProjection
}) {
  if (knowledge.layer !== 'L3') return null
  return (
    <div className="flex items-center gap-1">
      <Badge variant="ai">SYNTHETIC</Badge>
      <Badge variant="ai">eval-only</Badge>
    </div>
  )
}

/**
 * Skill methodology 候选标识（spec §3.7：恒为 methodology candidate）。
 */
export function OperatingSkillMethodologyBadge({
  draft,
}: {
  draft: SkillKnowledgeDraftOperatingProjection
}) {
  return (
    <div className="flex items-center gap-1">
      <Badge variant="info">方法论候选</Badge>
      {draft.baseStale && <Badge variant="warning">base-stale</Badge>}
      {draft.pluginProvenance.kind === 'plugin' && (
        <Badge
          variant={draft.pluginProvenance.disabled ? 'warning' : 'neutral'}
          className={cn(
            'text-[10px]',
            draft.pluginProvenance.uninstalled && 'border-danger/50 text-danger',
          )}
        >
          plugin:{draft.pluginProvenance.pluginId || 'unknown'}
          {draft.pluginProvenance.disabled ? ' · disabled' : ''}
          {draft.pluginProvenance.uninstalled ? ' · uninstalled' : ''}
        </Badge>
      )}
    </div>
  )
}

/**
 * Retrieval signal 窗口 + coverage（spec §5.10 必有 window/coverage/degraded）。
 */
export function OperatingRetrievalSignalBadges({
  signal,
}: {
  signal: RetrievalSignalOperatingProjection
}) {
  return (
    <div className="flex items-center gap-1">
      <Badge variant="outline">
        window: {signal.windowStart} → {signal.windowEnd}
      </Badge>
      {signal.degraded && <Badge variant="danger">adapter degraded</Badge>}
      {signal.truncated && <Badge variant="warning">truncated</Badge>}
      {signal.sampleCount === 0 && <Badge variant="info">no observation</Badge>}
      {signal.attentionBasis.reasonCode !== 'normal' && (
        <Badge variant="outline">{signal.attentionBasis.reasonCode}</Badge>
      )}
    </div>
  )
}
