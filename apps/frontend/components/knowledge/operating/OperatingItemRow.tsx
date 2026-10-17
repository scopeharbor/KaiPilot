'use client'

/**
 * v3-knowledge-memory-operating-layer —— 统一队列单行。
 *
 * 行为（spec §5.7 / §5.8）：
 * - 渲染 4 kind 各自的「行内证据标签」：knowledge 显示 layer / lifecycle / provenance 摘要；
 *   memory 显示 scope / basis count / status detail；skill draft 显示 base / current / plugin
 *   provenance；retrieval signal 显示 window / coverage。
 * - 行点击 → 触发 onSelect(scopedRef)，由上层管理 drawer / URL state。
 * - 严禁把 memory 标为「事实」「已核实」「权威」等可升格字样。
 */
import {
  OperatingKindBadge,
  OperatingL3Watermarks,
  OperatingMemoryInferenceBadge,
  OperatingPriorityBadge,
  OperatingRetrievalSignalBadges,
  OperatingSafeLabels,
  OperatingSkillMethodologyBadge,
  OperatingStatusBadge,
} from './OperatingStatusBadge'
import { cn } from '@/lib/utils'
import type {
  CopilotMemoryOperatingProjection,
  KnowledgeItemOperatingProjection,
  KnowledgeMemoryOperatingItem,
  KnowledgeMemoryOperatingKind,
  KnowledgeMemoryScopedRef,
  RetrievalSignalOperatingProjection,
  SkillKnowledgeDraftOperatingProjection,
} from '@aiproj/types'

export function OperatingItemRow({
  item,
  selected = false,
  onSelect,
}: {
  item: KnowledgeMemoryOperatingItem
  selected?: boolean
  onSelect: (scopedRef: KnowledgeMemoryScopedRef) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.scopedRef)}
      aria-pressed={selected}
      className={cn(
        'w-full text-left rounded-lg border p-3 transition-colors cursor-pointer',
        selected
          ? 'border-primary bg-primary-50/40'
          : 'hover:bg-accent hover:text-accent-foreground',
      )}
      data-testid={`operating-row-${item.kind}-${item.scopedRef.ref}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <OperatingKindBadge kind={item.kind} />
            <OperatingStatusBadge status={item.status} />
            <OperatingPriorityBadge priority={item.priority} />
            {item.kind === 'knowledge_item' && <OperatingL3Watermarks knowledge={item} />}
            {item.kind === 'copilot_memory' && <OperatingMemoryInferenceBadge memory={item} />}
            {item.kind === 'skill_knowledge_draft' && (
              <OperatingSkillMethodologyBadge draft={item} />
            )}
            {item.kind === 'retrieval_signal' && <OperatingRetrievalSignalBadges signal={item} />}
          </div>
          <div className="font-medium truncate">{itemTitle(item)}</div>
          <KindEvidence item={item} />
          <OperatingSafeLabels item={item} />
          <div className="text-[10px] text-muted-foreground font-mono">
            ref: {item.scopedRef.kind}:{item.scopedRef.ref} · {item.updatedAt}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-muted-foreground">
          <div>{item.freshnessState}</div>
          <div>{item.visibility}</div>
        </div>
      </div>
    </button>
  )
}

function itemTitle(item: KnowledgeMemoryOperatingItem): string {
  if (item.kind === 'knowledge_item') return item.title
  if (item.kind === 'copilot_memory') return `${item.memoryScope} memory · ${item.statusDetail}`
  if (item.kind === 'skill_knowledge_draft') return `${item.skillName} · draft ${item.draftStatus}`
  return `${item.retrievalKind} · ${item.queryCategory}`
}

function KindEvidence({ item }: { item: KnowledgeMemoryOperatingItem }) {
  if (item.kind === 'knowledge_item') {
    return <KnowledgeItemEvidence knowledge={item} />
  }
  if (item.kind === 'copilot_memory') {
    return <CopilotMemoryEvidence memory={item} />
  }
  if (item.kind === 'skill_knowledge_draft') {
    return <SkillDraftEvidence draft={item} />
  }
  return <RetrievalSignalEvidence signal={item} />
}

function KnowledgeItemEvidence({ knowledge }: { knowledge: KnowledgeItemOperatingProjection }) {
  return (
    <div className="text-xs text-muted-foreground space-y-1">
      <div>
        layer={knowledge.layer} · lifecycle={knowledge.lifecycle} · provenance=
        {knowledge.provenance.length}
      </div>
      {knowledge.attentionBasis.note && (
        <div className="text-[11px]">basis: {knowledge.attentionBasis.note}</div>
      )}
    </div>
  )
}

function CopilotMemoryEvidence({ memory }: { memory: CopilotMemoryOperatingProjection }) {
  return (
    <div className="text-xs text-muted-foreground space-y-1">
      <div>
        scope={memory.memoryScope} · status={memory.statusDetail} · basis={memory.basisCount} ·
        size={memory.summaryByteSize}B
      </div>
      <div className="text-[11px]">
        {memory.hasLiveFactConflict
          ? '⚠ 与实时项目事实冲突；以 live fact 为准。'
          : '未与实时项目事实冲突（按 injector 派生）'}
      </div>
    </div>
  )
}

function SkillDraftEvidence({ draft }: { draft: SkillKnowledgeDraftOperatingProjection }) {
  return (
    <div className="text-xs text-muted-foreground space-y-1">
      <div>
        base={draft.baseVersion} · current={draft.currentVersion} · sections={draft.sectionCount}
      </div>
      <div className="text-[11px]">reason: {draft.attentionBasis.reasonCode}</div>
    </div>
  )
}

function RetrievalSignalEvidence({ signal }: { signal: RetrievalSignalOperatingProjection }) {
  return (
    <div className="text-xs text-muted-foreground space-y-1">
      <div>
        sample={signal.sampleCount} · zero-rate={signal.zeroResultRate.toFixed(2)} · permExcl=
        {signal.permissionExcludedCount}
      </div>
      <div className="text-[11px]">reason: {signal.attentionBasis.reasonCode}</div>
    </div>
  )
}

// 抑制未使用导入静态噪声
export type _OperatingItemRowExports = KnowledgeMemoryOperatingKind
export const _operatingKindExports = {} as { _kind: KnowledgeMemoryOperatingKind }
